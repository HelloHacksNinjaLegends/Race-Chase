// Streetlight placement along road centerlines, reusing the same RoadGraph
// (lib/roadGraph.js) NPC traffic already fetches — see lib/traffic.js's
// `graph` getter. Placed once, from whatever graph is available the first
// time it loads (same one-shot-scatter approach as lib/trees.js); it doesn't
// re-place as traffic's road data is refetched further out.
//
// All streetlights are fully static, so they share three InstancedMeshes
// (pole/arm/head) parented under one anchor entity — this is the "many
// identical static props" case instancing helps the most: up to
// MAX_STREETLIGHTS poles cost 3 draw calls total, and only the anchor (not
// every pole) needs repositioning by the world layer each frame.

import * as THREE from 'three';
import { buildStreetlightInstances, setStreetlightInstance } from './streetlightModel';
import { localOffsetMeters, fromLocalMeters, distanceMeters } from './buildingCollision';

const SPACING_M = 35;
// From the road centerline out to the sidewalk-side pole.
const SIDE_OFFSET_M = 7;
const MIN_LIGHT_SPACING_M = 20;
// A cap so the fixed-capacity InstancedMeshes (and the underlying geometry)
// stay reasonably sized even where the road graph is dense.
const MAX_STREETLIGHTS = 150;

function computePositions(graph) {
  const visitedEdges = new Set();
  const positions = [];

  for (const node of graph.nodes.values()) {
    for (const edge of node.out) {
      // Two-way roads store one directed edge each way; place lights once per
      // physical segment regardless.
      const key = Math.min(edge.from.id, edge.to.id) + '_' + Math.max(edge.from.id, edge.to.id);
      if (visitedEdges.has(key)) continue;
      visitedEdges.add(key);

      const [east, north] = localOffsetMeters(edge.from.lng, edge.from.lat, edge.to.lng, edge.to.lat);
      const len = Math.hypot(east, north) || 1;
      const ux = east / len;
      const uy = north / len;
      // Right-hand normal of the direction of travel — the sidewalk side.
      const rx = uy;
      const ry = -ux;
      const heading = (Math.atan2(-rx, -ry) * 180) / Math.PI;

      const steps = Math.max(1, Math.round(edge.length / SPACING_M));
      for (let i = 0; i <= steps; i++) {
        const d = Math.min(edge.length, i * SPACING_M);
        const x = ux * d + rx * SIDE_OFFSET_M;
        const y = uy * d + ry * SIDE_OFFSET_M;
        const [lng, lat] = fromLocalMeters(edge.from.lng, edge.from.lat, x, y);
        positions.push({ lng, lat, heading });
      }
    }
  }
  return positions;
}

/** Evenly samples down to `max` entries, rather than just truncating one area. */
function thin(positions, max) {
  if (positions.length <= max) return positions;
  const kept = [];
  const step = positions.length / max;
  for (let i = 0; i < max; i++) kept.push(positions[Math.floor(i * step)]);
  return kept;
}

/**
 * @param {object} sceneWorld  From createWorldLayer(): the Three.js side (add/remove).
 * @param {object} graph       A RoadGraph (lib/roadGraph.js) — see lib/traffic.js's `graph` getter.
 */
export function createStreetlights(sceneWorld, graph) {
  const candidates = thin(computePositions(graph), MAX_STREETLIGHTS);
  const positions = [];
  for (const p of candidates) {
    if (positions.some((kept) => distanceMeters(kept.lng, kept.lat, p.lng, p.lat) < MIN_LIGHT_SPACING_M)) continue;
    positions.push(p);
  }
  if (positions.length === 0) return { dispose() {} };

  // Anchor at the first streetlight's position: a single entity for the
  // world layer to reposition each frame, instead of one per streetlight —
  // every instance's transform is baked once, relative to this anchor, and
  // never touched again.
  const anchorLng = positions[0].lng;
  const anchorLat = positions[0].lat;
  const anchorObject = new THREE.Group();
  const instances = buildStreetlightInstances(positions.length);
  anchorObject.add(instances.pole, instances.arm, instances.head);

  positions.forEach((p, i) => {
    const [east, north] = localOffsetMeters(anchorLng, anchorLat, p.lng, p.lat);
    setStreetlightInstance(instances, i, east, -north, p.heading);
  });
  instances.pole.instanceMatrix.needsUpdate = true;
  instances.arm.instanceMatrix.needsUpdate = true;
  instances.head.instanceMatrix.needsUpdate = true;
  // Lets Three's per-object frustum culling actually skip the whole batch
  // when it's off-screen, instead of defaulting to "always visible".
  instances.pole.computeBoundingSphere();
  instances.arm.computeBoundingSphere();
  instances.head.computeBoundingSphere();

  const anchorHandle = sceneWorld.add(anchorObject, { lng: anchorLng, lat: anchorLat, heading: 0 });

  return {
    dispose() {
      sceneWorld.remove(anchorHandle);
    }
  };
}
