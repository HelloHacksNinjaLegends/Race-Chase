// YVR (Vancouver International Airport), Richmond — where the world's
// default airplanes are parked, one per apron slot below. There's no menu
// here like the dealership: each is just a vehicle sitting in the world
// that boarding (E, same as any car) picks up. They're the only airplanes
// that ever exist — nothing re-spawns one once it's been taken, so this is
// a fixed set, not a source you can pull more from.

import { offsetLngLat, localOffsetMeters, fromLocalMeters, distanceMeters } from './buildingCollision';
import { STREETS_SOURCE_ID } from './constants';

export const AIRPORT_LNGLAT = [-123.1815, 49.1967]; // YVR south terminal apron, roughly
export const AIRPORT_NAME = 'YVR Airfield';
// Roughly aligned with YVR's main runway (08/26), so takeoff starts down it.
export const AIRPORT_HEADING = 95;

// A row of parking spots on the apron, alongside the runway heading, each
// holding one default plane (see lib/planeCatalog.js) — the fallback used
// until (and unless) findTerminalGate() below can snap it to the real
// terminal building instead.
const APRON_FIRST_SLOT_M = 25;
const APRON_SLOT_SPACING_M = 14;

/** Position and heading of apron slot `i` (0 = nearest the runway threshold). */
export function airportSlot(i) {
  const [lng, lat] = offsetLngLat(
    AIRPORT_LNGLAT[0],
    AIRPORT_LNGLAT[1],
    AIRPORT_HEADING + 90,
    APRON_FIRST_SLOT_M + i * APRON_SLOT_SPACING_M
  );
  return { lng, lat, heading: AIRPORT_HEADING };
}

// --- Snapping a parked plane to the real terminal building, gate-style ---
//
// Mapbox's building footprints (the same Streets source lib/buildingCollision.js
// already uses for collision) are only queryable once the relevant vector
// tiles have actually streamed in, which usually hasn't happened yet at the
// moment a session starts far away from the airport. findTerminalGate()
// returns null in that case; callers should keep the apron fallback above
// and retry later — by the time the player is actually close enough to the
// airport to notice, those tiles will normally have loaded.

const GATE_SEARCH_RADIUS_M = 200;
// Standoff from the terminal wall to the plane's fuselage centerline —
// clears the wingtips (lib/airplaneModel.js's wingspan) so it reads as
// parked at the wall, not embedded in it.
const GATE_STANDOFF_M = 7;

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

/**
 * Finds the largest building footprint near `anchorLng`/`anchorLat` (the
 * presumed terminal — the plane's own apron slot makes a good anchor, so
 * multiple planes naturally spread along different points of the same
 * wall) and returns a gate spot alongside its nearest wall: fuselage
 * parallel to the wall, standing off far enough to clear the wingtips.
 * `bridgeWallLng/Lat` and `bridgeHeading`/`bridgeLength` describe a static
 * jet-bridge prop (see lib/jetBridgeModel.js) spanning from that wall to
 * just short of the fuselage. Returns null if no footprint is loaded near
 * there yet.
 */
export function findTerminalGate(map, anchorLng, anchorLat) {
  let features;
  try {
    features = map.querySourceFeatures(STREETS_SOURCE_ID, {
      sourceLayer: 'building',
      filter: ['==', ['get', 'extrude'], 'true']
    });
  } catch (e) {
    return null;
  }

  let bestRing = null;
  let bestArea = 0;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
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
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      if (distanceMeters(anchorLng, anchorLat, cx, cy) > GATE_SEARCH_RADIUS_M) continue;
      const area = (maxX - minX) * (maxY - minY);
      if (area > bestArea) {
        bestArea = area;
        bestRing = outer;
      }
    }
  }
  if (!bestRing) return null;

  // Nearest edge of that footprint to the anchor, worked out in local meters.
  let nearestPoint = null;
  let nearestDist = Infinity;
  let wallDx = 0;
  let wallDy = 0;
  for (let i = 0; i < bestRing.length - 1; i++) {
    const [ax, ay] = localOffsetMeters(anchorLng, anchorLat, bestRing[i][0], bestRing[i][1]);
    const [bx, by] = localOffsetMeters(anchorLng, anchorLat, bestRing[i + 1][0], bestRing[i + 1][1]);
    const point = closestPointOnSegment(0, 0, ax, ay, bx, by);
    const d = Math.hypot(point.x, point.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearestPoint = point;
      wallDx = bx - ax;
      wallDy = by - ay;
    }
  }
  if (!nearestPoint) return null;

  const wallLen = Math.hypot(wallDx, wallDy) || 1;
  // Outward normal, pointing from the wall toward the anchor (which sits outside the building).
  let nx = -wallDy / wallLen;
  let ny = wallDx / wallLen;
  if (nx * nearestPoint.x + ny * nearestPoint.y < 0) {
    nx = -nx;
    ny = -ny;
  }

  const gateX = nearestPoint.x + nx * GATE_STANDOFF_M;
  const gateY = nearestPoint.y + ny * GATE_STANDOFF_M;
  const [lng, lat] = fromLocalMeters(anchorLng, anchorLat, gateX, gateY);
  const heading = (Math.atan2(wallDx, wallDy) * 180) / Math.PI;

  const [wallLng, wallLat] = fromLocalMeters(anchorLng, anchorLat, nearestPoint.x, nearestPoint.y);
  const bridgeLength = GATE_STANDOFF_M - 1; // stop just short of the fuselage skin
  const bridgeHeading = (Math.atan2(nx, ny) * 180) / Math.PI;

  return { lng, lat, heading, bridgeWallLng: wallLng, bridgeWallLat: wallLat, bridgeHeading, bridgeLength };
}
