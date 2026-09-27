// Fallback road network built from the map's own Mapbox Streets tiles, for
// when the Overpass API can't be reached (some networks block it). It's
// instant — the data is already loaded for rendering — but only covers
// tiles the map currently has, so it's refreshed as the player moves.
//
// Vector tiles clip each road at tile edges, so the pieces don't share
// endpoints. We merge near-identical vertices, snap dangling piece ends onto
// the road they overlap, and trim the tiny dead-end stubs left over, then
// hand the result to the same graph builder the OSM data uses.

import { buildRoadGraph } from './roadGraph';
import { localOffsetMeters, fromLocalMeters } from './buildingCollision';
import { STREETS_SOURCE_ID } from './constants';

// Mapbox Streets v8 `road` classes that NPC cars drive on.
const DRIVABLE_CLASSES = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'street',
  'street_limited'
]);

const MERGE_M = 0.6; // vertices closer than this are the same point
const SNAP_M = 1.5; // dangling ends this close to another road join it
const STUB_M = 15; // dead-end stubs shorter than this are clipping artifacts
const SEGMENT_CELL_M = 20;

/** Returns a RoadGraph (see lib/roadGraph.js) or null if the map has no road data yet. */
export function buildRoadGraphFromMap(map, lng, lat, radiusM) {
  let features;
  try {
    features = map.querySourceFeatures(STREETS_SOURCE_ID, { sourceLayer: 'road' });
  } catch (e) {
    return null;
  }

  // --- Vertices (local meters around lng/lat), merged within MERGE_M ---
  const verts = []; // { x, y }
  const vertCells = new Map();
  function vertexAt(x, y) {
    const cx = Math.floor(x / MERGE_M);
    const cy = Math.floor(y / MERGE_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = vertCells.get(cx + dx + ',' + (cy + dy));
        if (!list) continue;
        for (const i of list) if (Math.hypot(verts[i].x - x, verts[i].y - y) < MERGE_M) return i;
      }
    }
    verts.push({ x, y });
    const key = cx + ',' + cy;
    if (!vertCells.has(key)) vertCells.set(key, []);
    vertCells.get(key).push(verts.length - 1);
    return verts.length - 1;
  }

  // --- Ways: arrays of vertex indices ---
  const ways = []; // { nodes: number[], oneway: boolean }
  const [west, south] = fromLocalMeters(lng, lat, -radiusM, -radiusM);
  const [east, north] = fromLocalMeters(lng, lat, radiusM, radiusM);
  const inBox = ([x, y]) => x > west && x < east && y > south && y < north;
  for (const f of features) {
    const props = f.properties || {};
    if (!DRIVABLE_CLASSES.has(props.class) || !f.geometry) continue;
    const lines =
      f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      if (!line.some(inBox)) continue;
      const local = line.map(([x, y]) => localOffsetMeters(lng, lat, x, y));
      const nodes = [];
      for (const [x, y] of local) {
        const v = vertexAt(x, y);
        if (nodes[nodes.length - 1] !== v) nodes.push(v);
      }
      if (nodes.length >= 2) ways.push({ nodes, oneway: props.oneway === 'true' || props.oneway === true });
    }
  }
  if (ways.length === 0) return null;

  snapDanglingEnds(verts, ways);

  // --- Hand off to the shared graph builder, via OSM-shaped elements ---
  const elements = verts.map((v, i) => {
    const [vLng, vLat] = fromLocalMeters(lng, lat, v.x, v.y);
    return { type: 'node', id: i, lon: vLng, lat: vLat };
  });
  ways.forEach((w, i) => {
    elements.push({ type: 'way', id: i, nodes: w.nodes, tags: { oneway: w.oneway ? 'yes' : 'no' } });
  });
  const graph = buildRoadGraph(elements, [lng, lat]);
  trimStubs(graph);
  return graph.nodes.size > 0 ? graph : null;
}

/** Joins way ends that stop just short of / on top of another road. Mutates `ways`. */
function snapDanglingEnds(verts, ways) {
  const uses = new Map();
  for (const w of ways) for (const v of w.nodes) uses.set(v, (uses.get(v) || 0) + 1);

  // Spatial hash of segments: cell -> [wayIndex, segIndex]
  const cells = new Map();
  ways.forEach((w, wi) => {
    for (let si = 0; si < w.nodes.length - 1; si++) {
      const a = verts[w.nodes[si]];
      const b = verts[w.nodes[si + 1]];
      const x0 = Math.floor((Math.min(a.x, b.x) - SNAP_M) / SEGMENT_CELL_M);
      const x1 = Math.floor((Math.max(a.x, b.x) + SNAP_M) / SEGMENT_CELL_M);
      const y0 = Math.floor((Math.min(a.y, b.y) - SNAP_M) / SEGMENT_CELL_M);
      const y1 = Math.floor((Math.max(a.y, b.y) + SNAP_M) / SEGMENT_CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx + ',' + cy;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push([wi, si]);
        }
      }
    }
  });

  const inserts = new Map(); // wayIndex -> [{ si, t, v }]
  ways.forEach((w) => {
    for (const end of [0, w.nodes.length - 1]) {
      const v = w.nodes[end];
      if (uses.get(v) !== 1) continue; // already connected
      const p = verts[v];
      const candidates = cells.get(Math.floor(p.x / SEGMENT_CELL_M) + ',' + Math.floor(p.y / SEGMENT_CELL_M)) || [];
      let best = null;
      for (const [wi, si] of candidates) {
        const other = ways[wi];
        const ai = other.nodes[si];
        const bi = other.nodes[si + 1];
        if (ai === v || bi === v) continue;
        const a = verts[ai];
        const b = verts[bi];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d <= SNAP_M && (!best || d < best.d)) best = { d, wi, si, t, ai, bi, len: Math.sqrt(len2) };
      }
      if (!best) continue;
      if (best.t * best.len < MERGE_M) {
        w.nodes[end] = best.ai;
      } else if ((1 - best.t) * best.len < MERGE_M) {
        w.nodes[end] = best.bi;
      } else {
        // Move the end onto the segment and splice it into that road.
        const a = verts[best.ai];
        const b = verts[best.bi];
        verts[v] = { x: a.x + best.t * (b.x - a.x), y: a.y + best.t * (b.y - a.y) };
        if (!inserts.has(best.wi)) inserts.set(best.wi, []);
        inserts.get(best.wi).push({ si: best.si, t: best.t, v });
      }
      uses.set(v, 2);
    }
  });

  for (const [wi, list] of inserts) {
    const nodes = ways[wi].nodes;
    // Highest segment first so earlier indices stay valid; within a segment, farthest first.
    list.sort((p, q) => q.si - p.si || q.t - p.t);
    for (const { si, v } of list) nodes.splice(si + 1, 0, v);
  }
}

/** Removes short dead-end stubs (tile-clipping leftovers) from a RoadGraph. */
function trimStubs(graph) {
  for (let pass = 0; pass < 3; pass++) {
    const neighbors = new Map();
    const link = (a, b) => {
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      neighbors.get(a).add(b);
    };
    for (const node of graph.nodes.values()) {
      for (const e of node.out) {
        link(node, e.to);
        link(e.to, node);
      }
    }
    let removed = 0;
    for (const [node, set] of neighbors) {
      if (set.size !== 1) continue;
      const [other] = set;
      const edge = node.out.find((e) => e.to === other) || other.out.find((e) => e.to === node);
      if (!edge || edge.length >= STUB_M) continue;
      other.out = other.out.filter((e) => e.to !== node);
      graph.nodes.delete(node.id);
      removed++;
    }
    if (removed === 0) break;
  }
}
