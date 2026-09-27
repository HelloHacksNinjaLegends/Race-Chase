// A scattering of trees, real rigid bodies in the shared cannon-es world
// (lib/physicsWorld.js). Standing trees are static box colliders that block
// cars and the character like any other obstacle. A car hitting one above
// TOPPLE_SPEED_MS swaps its body for a dynamic one hinged at the base, so
// gravity (plus a shove in the direction of travel) tips it over believably;
// once it's settled near horizontal it's frozen back to static, permanent
// debris — it never resets upright and stops blocking traffic once fallen.
//
// Rendering: all standing trees share two InstancedMeshes (trunk/canopy)
// parented under a single anchor entity, so placing dozens of them costs 2
// draw calls total instead of 2 each, and only the anchor (not every tree)
// needs its position recomputed by the world layer each frame. A tree that
// topples is hidden from the instanced mesh and becomes a real Mesh Group
// instead, since it alone needs a per-frame pitch/roll while it falls.

import * as CANNON from 'cannon-es';
import { buildTreeObject, buildTreeInstances, setTreeInstance, hideTreeInstance, TREE_TRUNK_RADIUS, TREE_TOTAL_HEIGHT } from './treeModel';
import { offsetLngLat, distanceMeters, localOffsetMeters } from './buildingCollision';
import { CAR_LENGTH } from './constants';
import * as THREE from 'three';

const TREE_COUNT = 45;
const SCATTER_MIN_M = 20;
const SCATTER_MAX_M = 260;
const MIN_TREE_SPACING_M = 14;
const PLACEMENT_ATTEMPTS = 12;
// A little wider than the trunk's visual/physical radius, so the single-point
// collision probe (lib/vehicle.js) reliably registers a hit, like a car's own
// footprint check does against buildings.
const TREE_HIT_RADIUS = TREE_TRUNK_RADIUS + 0.6;
const TOPPLE_SPEED_MS = 6; // ~21.6 km/h
const SETTLE_ANGLE_DEG = 80;
const SETTLE_MIN_ANGLE_DEG = 15;
const SETTLE_ANGULAR_SPEED = 0.02;
const FALL_IMPULSE = 90;

/**
 * @param {object} physics    From createPhysicsWorld().
 * @param {object} sceneWorld From createWorldLayer(): the Three.js side (add/remove).
 * @param {number} centerLng  @param {number} centerLat  Where to scatter trees around — also the
 *        fixed anchor every standing tree's instance transform is baked relative to.
 * @param {(lng: number, lat: number) => boolean} isBlocked  True where a tree shouldn't go
 *        (inside a building footprint, say).
 * @param {() => void} [repaint]
 */
export function createTrees({ physics, sceneWorld, centerLng, centerLat, isBlocked, repaint }) {
  // First, just find valid spots — the instanced meshes below are sized to
  // however many actually get placed.
  const spots = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const headingDeg = Math.random() * 360;
      const dist = SCATTER_MIN_M + Math.random() * (SCATTER_MAX_M - SCATTER_MIN_M);
      const [lng, lat] = offsetLngLat(centerLng, centerLat, headingDeg, dist);
      if (isBlocked(lng, lat)) continue;
      if (spots.some((s) => distanceMeters(s.lng, s.lat, lng, lat) < MIN_TREE_SPACING_M)) continue;
      spots.push({ lng, lat });
      break;
    }
  }

  const anchorObject = new THREE.Group();
  const instances = buildTreeInstances(Math.max(spots.length, 1));
  anchorObject.add(instances.trunk, instances.canopy);
  const anchorHandle = sceneWorld.add(anchorObject, { lng: centerLng, lat: centerLat, heading: 0 });

  const trees = spots.map((spot, i) => {
    const [east, north] = localOffsetMeters(centerLng, centerLat, spot.lng, spot.lat);
    setTreeInstance(instances, i, east, -north);

    const { x, z } = physics.toLocal(spot.lng, spot.lat);
    const shape = new CANNON.Box(new CANNON.Vec3(TREE_TRUNK_RADIUS * 1.5, TREE_TOTAL_HEIGHT / 2, TREE_TRUNK_RADIUS * 1.5));
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape });
    body.position.set(x, TREE_TOTAL_HEIGHT / 2, z);
    physics.world.addBody(body);

    return {
      lng: spot.lng,
      lat: spot.lat,
      x,
      z,
      instanceIndex: i,
      object: null, // only built once this tree topples (see topple())
      state: null,
      handle: null,
      body,
      hinge: null,
      anchor: null,
      standing: true,
      settled: false
    };
  });
  if (spots.length === 0) hideTreeInstance(instances, 0); // avoid a phantom tree in the unused capacity-1 slot
  instances.trunk.instanceMatrix.needsUpdate = true;
  instances.canopy.instanceMatrix.needsUpdate = true;
  // Lets Three's per-object frustum culling actually skip the whole batch
  // when it's off-screen, instead of defaulting to "always visible".
  instances.trunk.computeBoundingSphere();
  instances.canopy.computeBoundingSphere();

  function topple(tree, impactHeadingDeg) {
    tree.standing = false;
    hideTreeInstance(instances, tree.instanceIndex);
    instances.trunk.instanceMatrix.needsUpdate = true;
    instances.canopy.instanceMatrix.needsUpdate = true;

    tree.object = buildTreeObject();
    tree.state = { lng: tree.lng, lat: tree.lat, heading: 0, pitch: 0, roll: 0, altitude: 0 };
    tree.handle = sceneWorld.add(tree.object, tree.state);

    physics.world.removeBody(tree.body);

    const body = new CANNON.Body({ mass: 40, shape: tree.body.shapes[0] });
    body.position.set(tree.x, TREE_TOTAL_HEIGHT / 2, tree.z);
    body.angularDamping = 0.55;
    body.linearDamping = 0.4;
    physics.world.addBody(body);

    const anchor = new CANNON.Body({ mass: 0 });
    anchor.position.set(tree.x, 0, tree.z);
    physics.world.addBody(anchor);

    // Hinge axis: horizontal, perpendicular to the direction of impact, so
    // the tree tips away from the car instead of spinning arbitrarily.
    const rad = (impactHeadingDeg * Math.PI) / 180;
    const axis = new CANNON.Vec3(Math.cos(rad), 0, -Math.sin(rad));
    const hinge = new CANNON.HingeConstraint(anchor, body, {
      pivotA: new CANNON.Vec3(0, 0, 0),
      pivotB: new CANNON.Vec3(0, -TREE_TOTAL_HEIGHT / 2, 0),
      axisA: axis,
      axisB: axis
    });
    physics.world.addConstraint(hinge);

    // Second argument is relative to the body's center of mass (which sits at
    // TREE_TOTAL_HEIGHT / 2), not a world point — shove it near the canopy.
    body.applyImpulse(
      new CANNON.Vec3(Math.sin(rad) * FALL_IMPULSE, 0, Math.cos(rad) * FALL_IMPULSE),
      new CANNON.Vec3(0, TREE_TOTAL_HEIGHT * 0.35, 0)
    );

    tree.body = body;
    tree.anchor = anchor;
    tree.hinge = hinge;
    if (repaint) repaint();
  }

  return {
    /** Standing trees block movement like any other obstacle; fallen ones don't. */
    blocksAt(lng, lat) {
      for (const t of trees) {
        if (t.standing && distanceMeters(lng, lat, t.lng, t.lat) < TREE_HIT_RADIUS) return true;
      }
      return false;
    },

    /** Call every frame the car moves, with its current speed (m/s, signed) and heading. */
    checkImpact(carLng, carLat, carHeading, carSpeed) {
      if (Math.abs(carSpeed) < TOPPLE_SPEED_MS) return;
      const hitRadius = TREE_HIT_RADIUS + CAR_LENGTH / 2;
      for (const t of trees) {
        if (!t.standing) continue;
        if (distanceMeters(carLng, carLat, t.lng, t.lat) > hitRadius) continue;
        topple(t, carSpeed >= 0 ? carHeading : (carHeading + 180) % 360);
        return;
      }
    },

    /** Advance fallen trees' visual pose from their physics bodies, and freeze settled ones. */
    sync() {
      for (const t of trees) {
        if (t.standing || t.settled) continue;
        const [lng, lat] = physics.toLngLat(t.body.position.x, t.body.position.z);
        t.state.lng = lng;
        t.state.lat = lat;

        // Not a rigorous Euler decomposition — just how far the trunk's local
        // "up" has tilted away from world up, split into pitch/roll, which is
        // plenty for a believable one-shot fall animation.
        const up = new CANNON.Vec3(0, 1, 0);
        t.body.quaternion.vmult(up, up);
        const tiltDeg = (Math.acos(Math.min(1, Math.max(-1, up.y))) * 180) / Math.PI;
        t.state.pitch = -up.x * tiltDeg;
        t.state.roll = up.z * tiltDeg;

        const settling =
          tiltDeg > SETTLE_ANGLE_DEG || (tiltDeg > SETTLE_MIN_ANGLE_DEG && t.body.angularVelocity.length() < SETTLE_ANGULAR_SPEED);
        if (settling) {
          t.settled = true;
          physics.world.removeConstraint(t.hinge);
          t.body.type = CANNON.Body.STATIC;
          t.body.velocity.set(0, 0, 0);
          t.body.angularVelocity.set(0, 0, 0);
          t.body.updateMassProperties();
        }
      }
    },

    dispose() {
      sceneWorld.remove(anchorHandle);
      for (const t of trees) {
        if (t.handle) sceneWorld.remove(t.handle);
        if (t.hinge) physics.world.removeConstraint(t.hinge);
        if (t.body) physics.world.removeBody(t.body);
        if (t.anchor) physics.world.removeBody(t.anchor);
      }
    }
  };
}
