// NPC traffic: a handful of AI cars that follow road centerlines (keeping
// right on two-way roads) at a fixed speed, picking a random onward segment
// at each intersection and rounding corners on a short curve.
//
// They don't obey traffic rules. The only "AI" is: stop if something is
// directly ahead (the player, a parked car, another NPC). Cars spawn and are
// recycled off-screen, near the player, so they don't pop in or out of view.
//
// Roads come from OpenStreetMap (Overpass) and are refetched as the player
// moves. Until that data arrives — or if Overpass is unreachable — an
// optional `fallbackGraph` (built from the map's own tiles) is used instead.
//
// Pure logic, no three.js: the caller renders NPCs via onSpawn / onDespawn.
// Each NPC object has {lng, lat, heading}, so it works with pointInVehicle()
// and with lib/worldLayer.js directly.

import { fetchRoadGraph } from './roadGraph';
import { offsetLngLat, distanceMeters, localOffsetMeters, fromLocalMeters } from './buildingCollision';
import { pointInVehicle } from './vehicle';
import { CAR_LENGTH, TRAFFIC_COUNT, TRAFFIC_SPEED } from './constants';

// Right-hand traffic: distance from a two-way road's centerline to lane center.
const LANE_OFFSET_M = 1.8;
// Corners are rounded over up to this many meters either side of the node.
const CORNER_M = 7;
// NPCs spawn off-screen in this ring around the player. They're recycled once
// off-screen beyond DESPAWN_M, or anywhere beyond HARD_DESPAWN_M.
const SPAWN_MIN_M = 60;
const SPAWN_MAX_M = 250;
const DESPAWN_M = 300;
const HARD_DESPAWN_M = 550;
// OSM roads are fetched in a square of this "radius" around the player, and
// refetched once the player is REFETCH_DISTANCE_M from the last fetch.
const ROAD_RADIUS_M = 700;
const REFETCH_DISTANCE_M = 350;
const FETCH_RETRY_MS = 30000;
// The map-tile fallback is rebuilt every FALLBACK_REFRESH_MS while it's in
// use and the player has moved FALLBACK_REFRESH_DISTANCE_M, or while it's
// still sparse (tiles loading).
const FALLBACK_REFRESH_MS = 2000;
const FALLBACK_REFRESH_DISTANCE_M = 120;
const FALLBACK_MIN_NODES = 40;
// Smaller than ROAD_RADIUS_M: it only has to cover the spawn ring, and it's rebuilt often.
const FALLBACK_RADIUS_M = SPAWN_MAX_M + 150;
// Points ahead of the NPC's center that must be clear for it to move.
const LOOK_AHEAD_M = [CAR_LENGTH / 2 + 1.5, CAR_LENGTH / 2 + 4];
// After waiting this long on another NPC, drive through it (breaks deadlocks
// at intersections). After waiting STUCK_RESPAWN_S, respawn (off-screen only).
const IGNORE_NPCS_AFTER_S = 3;
const STUCK_RESPAWN_S = 6;
const SPAWN_ATTEMPTS = 12;
const CANDIDATE_REFRESH_MS = 1000;

const COLORS = ['#e8e8e4', '#3b3f45', '#8a9199', '#2d4a6b', '#6b2d2d', '#c9b98f', '#4a5d3a', '#b8c4cc'];
// Kenney Car Kit bodies (lib/carModel.js). `keepPaint` keeps the model's own
// livery (the taxi stays yellow); `style` is the loading placeholder.
const BODIES = [
  { model: 'sedan', style: 'coupe', roofScale: 0.6 },
  { model: 'sedan', style: 'coupe', roofScale: 0.6 },
  { model: 'hatchback-sports', style: 'hatch', roofScale: 0.65 },
  { model: 'suv', style: 'hatch', roofScale: 0.75 },
  { model: 'van', style: 'hatch', roofScale: 0.8 },
  { model: 'taxi', style: 'hatch', roofScale: 0.6, keepPaint: true }
];

/**
 * @param {object}   opts
 * @param {(npc) => void} opts.onSpawn    Called when an NPC appears (create its model here).
 * @param {(npc) => void} opts.onDespawn  Called when an NPC is removed.
 * @param {Function} [opts.fetchGraph]    (lng, lat, radiusM) => Promise<RoadGraph>. Defaults to Overpass.
 * @param {Function} [opts.fallbackGraph] (lng, lat, radiusM) => RoadGraph|null, synchronous.
 * @param {(lng, lat) => boolean} [opts.isVisible]  Whether a point is on screen.
 * @param {() => number} [opts.random]
 */
export function createTraffic({
  onSpawn,
  onDespawn,
  fetchGraph = fetchRoadGraph,
  fallbackGraph = null,
  isVisible = () => false,
  random = Math.random
}) {
  let graph = null;
  let source = null; // 'osm' | 'map'
  let fetching = false;
  let lastFailureAt = -Infinity;
  let osmFailed = false;
  let lastFallbackAt = -Infinity;
  let disposed = false;
  let nextId = 1;
  let candidates = { at: -Infinity, list: [] };
  const npcs = [];

  function ensureRoads(lng, lat, now) {
    const distFromGraph = graph ? distanceMeters(lng, lat, graph.center[0], graph.center[1]) : Infinity;

    const osmFresh = source === 'osm' && distFromGraph < REFETCH_DISTANCE_M;
    if (!osmFresh && !fetching && !disposed && now - lastFailureAt >= FETCH_RETRY_MS) {
      fetching = true;
      fetchGraph(lng, lat, ROAD_RADIUS_M)
        .then((g) => {
          if (disposed || g.nodes.size === 0) return;
          graph = g;
          source = 'osm';
          osmFailed = false;
          candidates.at = -Infinity;
        })
        .catch((err) => {
          console.warn(
            'Could not load OpenStreetMap roads for traffic' +
              (fallbackGraph ? '; using the map’s road data instead.' : '.') +
              ' Retrying in ' + FETCH_RETRY_MS / 1000 + ' s.',
            err
          );
          osmFailed = true;
          lastFailureAt = performance.now();
        })
        .finally(() => {
          fetching = false;
        });
    }

    // Fall back to map-tile roads while OSM data is missing, or so stale the
    // spawn ring is running off its edge.
    const osmUsable = source === 'osm' && distFromGraph < ROAD_RADIUS_M - SPAWN_MAX_M;
    if (!fallbackGraph || osmUsable || now - lastFallbackAt < FALLBACK_REFRESH_MS) return;
    const needsRefresh =
      source !== 'map' || graph.nodes.size < FALLBACK_MIN_NODES || distFromGraph > FALLBACK_REFRESH_DISTANCE_M;
    if (!needsRefresh) return;
    lastFallbackAt = now;
    const g = fallbackGraph(lng, lat, FALLBACK_RADIUS_M);
    if (g && (source !== 'map' || g.nodes.size >= Math.min(graph.nodes.size, FALLBACK_MIN_NODES))) {
      graph = g;
      source = 'map';
      candidates.at = -Infinity;
    }
  }

  function pick(list) {
    return list[Math.floor(random() * list.length)];
  }

  function spawn(lng, lat, now, isOccupied) {
    if (now - candidates.at > CANDIDATE_REFRESH_MS) {
      const list = [];
      for (const node of graph.nodes.values()) {
        if (node.out.length === 0) continue;
        const d = distanceMeters(lng, lat, node.lng, node.lat);
        if (d >= SPAWN_MIN_M && d <= SPAWN_MAX_M) list.push(node);
      }
      candidates = { at: now, list };
    }
    if (candidates.list.length === 0) return;

    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const edge = pick(pick(candidates.list).out);
      const { keepPaint, ...look } = pick(BODIES);
      const body = { ...look, color: keepPaint ? null : pick(COLORS) };
      const npc = {
        id: nextId++,
        prev: null,
        edge,
        next: null,
        t: random() * edge.length, // meters along the edge
        lng: 0,
        lat: 0,
        heading: 0,
        waited: 0, // seconds stopped
        moved: 0, // meters moved this frame
        deadEnd: false,
        ...body
      };
      npc.next = nextEdge(edge);
      placeOnEdge(npc);
      if (isVisible(npc.lng, npc.lat)) continue;
      if (isOccupied(npc.lng, npc.lat) || npcs.some((o) => pointInVehicle(o, npc.lng, npc.lat, 2))) continue;
      npcs.push(npc);
      onSpawn(npc);
      return;
    }
  }

  function despawn(npc) {
    npcs.splice(npcs.indexOf(npc), 1);
    onDespawn(npc);
  }

  /** A random onward edge from the end of `edge` (U-turn only at dead ends), or null. */
  function nextEdge(edge) {
    // Prefer the current graph's copy of the node (it may have been
    // refetched); fall back to the old one, whose edges are still real roads.
    const fresh = graph.nodes.get(edge.to.id);
    const node =
      fresh && distanceMeters(fresh.lng, fresh.lat, edge.to.lng, edge.to.lat) < 1 ? fresh : edge.to;
    if (node.out.length === 0) return null;
    const onward = node.out.filter((e) => distanceMeters(e.to.lng, e.to.lat, edge.from.lng, edge.from.lat) > 1);
    return pick(onward.length ? onward : node.out);
  }

  return {
    /**
     * Advances traffic by one frame.
     * @param {{lng, lat}} player  Where traffic should be centered.
     * @param {(lng, lat) => boolean} isOccupied  Non-NPC obstacles NPCs should stop for.
     */
    update(dt, player, now, isOccupied) {
      ensureRoads(player.lng, player.lat, now);
      if (!graph) return;

      for (const npc of npcs.slice()) {
        const d = distanceMeters(player.lng, player.lat, npc.lng, npc.lat);
        const offScreen = !isVisible(npc.lng, npc.lat);
        const recycle =
          d > HARD_DESPAWN_M ||
          npc.deadEnd ||
          (offScreen && (d > DESPAWN_M || npc.waited > STUCK_RESPAWN_S));
        if (recycle) despawn(npc);
      }
      if (npcs.length < TRAFFIC_COUNT) spawn(player.lng, player.lat, now, isOccupied);

      for (const npc of npcs) {
        const checkNpcs = npc.waited < IGNORE_NPCS_AFTER_S;
        const blocked = LOOK_AHEAD_M.some((ahead) => {
          const [x, y] = offsetLngLat(npc.lng, npc.lat, npc.heading, ahead);
          return isOccupied(x, y) || (checkNpcs && npcs.some((o) => o !== npc && pointInVehicle(o, x, y)));
        });
        if (blocked) {
          npc.waited += dt;
          npc.moved = 0;
          continue;
        }
        npc.waited = 0;

        npc.moved = TRAFFIC_SPEED * dt;
        npc.t += npc.moved;
        while (npc.t >= npc.edge.length) {
          if (!npc.next) {
            // Nowhere to go (one-way dead end) — recycled next frame.
            npc.t = npc.edge.length;
            npc.deadEnd = true;
            break;
          }
          npc.t -= npc.edge.length;
          npc.prev = npc.edge;
          npc.edge = npc.next;
          npc.next = nextEdge(npc.edge);
        }
        placeOnEdge(npc);
      }
    },

    /** True if (lng, lat) is inside any NPC car. */
    blocks(lng, lat) {
      return npcs.some((npc) => pointInVehicle(npc, lng, lat));
    },

    /** 'loading' until roads are available, then 'osm' or 'map' (fallback), plus whether Overpass failed. */
    get status() {
      return { source: source || 'loading', osmFailed };
    },

    get count() {
      return npcs.length;
    },

    dispose() {
      disposed = true;
      npcs.slice().forEach(despawn);
    }
  };
}

// --- Geometry: position along an edge, with rounded corners ---

/** Per-edge unit direction (east, north), heading and lane offset, cached on the edge. */
function edgeGeom(edge) {
  if (!edge.geom) {
    const [east, north] = localOffsetMeters(edge.from.lng, edge.from.lat, edge.to.lng, edge.to.lat);
    const len = Math.hypot(east, north) || 1;
    edge.geom = { ux: east / len, uy: north / len, lane: edge.twoWay ? LANE_OFFSET_M : 0 };
  }
  return edge.geom;
}

/** Half-length of the curve joining edge `a` into edge `b` (0 = sharp turn / U-turn). */
function cornerSize(a, b) {
  if (!a || !b) return 0;
  const ga = edgeGeom(a);
  const gb = edgeGeom(b);
  if (ga.ux * gb.ux + ga.uy * gb.uy < -0.5) return 0; // sharper than 120°
  return Math.min(CORNER_M, a.length / 2, b.length / 2);
}

/**
 * Sets npc.lng/lat/heading from its edge and t. Near a node, the path follows
 * a quadratic Bézier from `size` meters before the node to `size` meters
 * after it; u is 0..1 along that curve, so both edges agree at u = 0.5.
 */
function placeOnEdge(npc) {
  const { edge, t } = npc;
  const g = edgeGeom(edge);
  const exitSize = cornerSize(edge, npc.next);
  const entrySize = cornerSize(npc.prev, edge);

  let origin; // node the local coordinates are relative to
  let x;
  let y;
  let tx;
  let ty;
  let lane;
  if (exitSize > 0 && t > edge.length - exitSize) {
    origin = edge.to;
    ({ x, y, tx, ty, lane } = cornerPoint(edge, npc.next, exitSize, (0.5 * (t - (edge.length - exitSize))) / exitSize));
  } else if (entrySize > 0 && t < entrySize) {
    origin = edge.from;
    ({ x, y, tx, ty, lane } = cornerPoint(npc.prev, edge, entrySize, 0.5 + (0.5 * t) / entrySize));
  } else {
    origin = edge.from;
    const f = Math.min(t, edge.length);
    x = g.ux * f;
    y = g.uy * f;
    tx = g.ux;
    ty = g.uy;
    lane = g.lane;
  }

  // Keep right: offset along the tangent's right-hand normal.
  const tLen = Math.hypot(tx, ty) || 1;
  const rx = ty / tLen;
  const ry = -tx / tLen;
  [npc.lng, npc.lat] = fromLocalMeters(origin.lng, origin.lat, x + rx * lane, y + ry * lane);
  npc.heading = (Math.atan2(tx, ty) * 180) / Math.PI;
}

/** Point + tangent on the corner curve from edge a into edge b, relative to their shared node. */
function cornerPoint(a, b, size, u) {
  const ga = edgeGeom(a);
  const gb = edgeGeom(b);
  // P0 = -ua·size, P1 = node (0,0), P2 = ub·size.
  const w0 = (1 - u) * (1 - u);
  const w2 = u * u;
  return {
    x: -ga.ux * size * w0 + gb.ux * size * w2,
    y: -ga.uy * size * w0 + gb.uy * size * w2,
    tx: (1 - u) * ga.ux + u * gb.ux,
    ty: (1 - u) * ga.uy + u * gb.uy,
    lane: ga.lane * (1 - u) + gb.lane * u
  };
}
