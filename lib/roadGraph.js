// Drivable road network from OpenStreetMap, as a directed graph of
// centerline segments. Used by lib/traffic.js.

import { runOverpassQuery } from './overpass';
import { distanceMeters } from './buildingCollision';

// Road classes NPC cars drive on (plus their *_link ramps). Footways,
// cycleways, service roads, parking aisles etc. are left out.
const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street';
const METERS_PER_DEG_LAT = 111320;

/**
 * @typedef {{id: number, lng: number, lat: number, out: Edge[]}} RoadNode
 * @typedef {{from: RoadNode, to: RoadNode, length: number, twoWay: boolean}} Edge
 * @typedef {{nodes: Map<number, RoadNode>, center: [number, number]}} RoadGraph
 */

/** Fetches roads within `radiusM` of (lng, lat) and builds a RoadGraph. */
export async function fetchRoadGraph(lng, lat, radiusM) {
  const dLat = radiusM / METERS_PER_DEG_LAT;
  const dLng = radiusM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng].join(',');
  const query =
    '[out:json][timeout:25];' +
    'way["highway"~"^(' + DRIVABLE + ')(_link)?$"]["area"!="yes"](' + bbox + ');' +
    '(._;>;);out body qt;';
  const elements = await runOverpassQuery(query);
  return buildRoadGraph(elements, [lng, lat]);
}

/** Builds a RoadGraph from raw Overpass elements (nodes + ways). */
export function buildRoadGraph(elements, center) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, { id: el.id, lng: el.lon, lat: el.lat, out: [] });
  }

  const used = new Set();
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.nodes)) continue;
    const tags = el.tags || {};
    const oneway =
      tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true'
        ? 1
        : tags.oneway === '-1' || tags.oneway === 'reverse'
          ? -1
          : tags.junction === 'roundabout' || tags.highway === 'motorway'
            ? 1
            : 0;

    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = nodes.get(el.nodes[i]);
      const b = nodes.get(el.nodes[i + 1]);
      if (!a || !b || a === b) continue;
      const length = distanceMeters(a.lng, a.lat, b.lng, b.lat);
      if (length < 0.5) continue;
      const twoWay = oneway === 0;
      if (oneway >= 0) addEdge(a, b, length, twoWay);
      if (oneway <= 0) addEdge(b, a, length, twoWay);
      used.add(a.id);
      used.add(b.id);
    }
  }

  // Drop nodes that aren't part of any drivable edge.
  for (const id of nodes.keys()) {
    if (!used.has(id)) nodes.delete(id);
  }
  return { nodes, center };
}

function addEdge(from, to, length, twoWay) {
  // Overlapping ways (e.g. tile-clipped pieces) can repeat a segment.
  if (from.out.some((e) => e.to === to)) return;
  from.out.push({ from, to, length, twoWay });
}
