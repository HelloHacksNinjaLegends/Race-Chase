// 2D building-footprint collision for play mode (cars and the character).
//
// Footprints come from the same Mapbox Streets "building" source layer that
// the 3d-buildings extrusion (and click-selection) uses. querySourceFeatures
// decodes every building in every loaded tile, so it's far too slow to call
// often: we keep a cache of footprints around the player and refresh it only
// after they've moved well into it, or when new building tiles have loaded.
// Tile-clipped footprints are fine here: a point inside the building is
// inside exactly one of its clipped pieces.

import { STREETS_SOURCE_ID } from './constants';

// Every probe point is within a few meters of the player, so any cache that
// still reaches CACHE_RADIUS_M - REFRESH_DISTANCE_M around them is complete.
const CACHE_RADIUS_M = 250;
const REFRESH_DISTANCE_M = 120;
// New tiles arrive in bursts; re-query at most this often because of them.
const TILE_REFRESH_MIN_INTERVAL_MS = 1000;
// Buildings starting this far above the ground (overpasses, overhangs,
// skybridges) don't block the road beneath them.
const MAX_BLOCKING_MIN_HEIGHT_M = 3;

const METERS_PER_DEG_LAT = 111320;

/** Returns [lng, lat] moved `meters` along `headingDeg` (clockwise from north). */
export function offsetLngLat(lng, lat, headingDeg, meters) {
  const h = (headingDeg * Math.PI) / 180;
  const dLat = (Math.cos(h) * meters) / METERS_PER_DEG_LAT;
  const dLng = (Math.sin(h) * meters) / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

/** Returns [east, north] meters from (fromLng, fromLat) to (lng, lat). Fine at street scale. */
export function localOffsetMeters(fromLng, fromLat, lng, lat) {
  const east = (lng - fromLng) * METERS_PER_DEG_LAT * Math.cos((fromLat * Math.PI) / 180);
  const north = (lat - fromLat) * METERS_PER_DEG_LAT;
  return [east, north];
}

/** Inverse of localOffsetMeters: the point `east`/`north` meters from (originLng, originLat). */
export function fromLocalMeters(originLng, originLat, east, north) {
  const lng = originLng + east / (METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180));
  const lat = originLat + north / METERS_PER_DEG_LAT;
  return [lng, lat];
}

export function createBuildingCollider(map) {
  // Each entry: { minX, minY, maxX, maxY, rings: [outer, ...holes] }
  let polygons = [];
  let cacheCenter = null;
  let lastRefresh = -Infinity;
  let tilesChanged = true;

  function handleSourceData(e) {
    if (e.sourceId === STREETS_SOURCE_ID && e.tile) tilesChanged = true;
  }
  map.on('sourcedata', handleSourceData);

  function refresh(lng, lat, now) {
    lastRefresh = now;
    cacheCenter = [lng, lat];

    let features;
    try {
      // Same filter as the 3d-buildings layer in lib/mapStyling.js.
      features = map.querySourceFeatures(STREETS_SOURCE_ID, {
        sourceLayer: 'building',
        filter: ['==', ['get', 'extrude'], 'true']
      });
    } catch (e) {
      return;
    }

    const dLat = CACHE_RADIUS_M / METERS_PER_DEG_LAT;
    const dLng = CACHE_RADIUS_M / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    const west = lng - dLng;
    const east = lng + dLng;
    const south = lat - dLat;
    const north = lat + dLat;

    const next = [];
    for (const f of features) {
      const props = f.properties || {};
      if (props.min_height != null && props.min_height > MAX_BLOCKING_MIN_HEIGHT_M) continue;

      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

      for (const rings of polys) {
        const outer = rings[0];
        if (!outer || outer.length < 3) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of outer) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (maxX < west || minX > east || maxY < south || minY > north) continue;
        next.push({ minX, minY, maxX, maxY, rings });
      }
    }
    polygons = next;
  }

  return {
    /** Refreshes the footprint cache if it's stale or the car has moved away from it. */
    update(lng, lat, now) {
      const moved =
        !cacheCenter ||
        distanceMeters(cacheCenter[0], cacheCenter[1], lng, lat) > REFRESH_DISTANCE_M;
      const newTiles = tilesChanged && now - lastRefresh > TILE_REFRESH_MIN_INTERVAL_MS;
      if (moved || newTiles) {
        tilesChanged = false;
        refresh(lng, lat, now);
      }
    },

    dispose() {
      map.off('sourcedata', handleSourceData);
    },

    /** True if the point lies inside any cached building footprint. */
    contains(lng, lat) {
      for (const p of polygons) {
        if (lng < p.minX || lng > p.maxX || lat < p.minY || lat > p.maxY) continue;
        if (!pointInRing(lng, lat, p.rings[0])) continue;
        let inHole = false;
        for (let i = 1; i < p.rings.length; i++) {
          if (pointInRing(lng, lat, p.rings[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
      return false;
    }
  };
}

/** Even-odd ray-casting point-in-polygon test for a single ring. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceMeters(lng1, lat1, lng2, lat2) {
  const dy = (lat2 - lat1) * METERS_PER_DEG_LAT;
  const dx = (lng2 - lng1) * METERS_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
