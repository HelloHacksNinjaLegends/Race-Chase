// A single cannon-es world shared by the new rigid-body systems: trees
// (impact + toppling), helicopters/planes (flight + ground/rooftop
// collision), and — via groundHeightAt() below — the character/car's real
// gravity (see lib/gravity.js).
//
// Car-vs-building and car-vs-NPC collision deliberately stay on the
// existing lightweight point-probe system in lib/vehicle.js / lib/
// buildingCollision.js — building footprints stream in live from map tiles
// as 2D polygons with holes, and migrating that onto rigid bodies every
// tile refresh would risk regressing the tuned driving feel for no
// gameplay benefit. This module is the "real physics" layer for the
// genuinely new rigid-body needs, including the character/car's *vertical*
// motion: they still move/steer with the tuned 2D model, but fall and land
// (on the ground plane or a building's rooftop) for real, found by
// raycasting straight down through this same world.
//
// Coordinate convention (independent of the Three.js render layer in
// lib/worldLayer.js): a fixed [lng, lat] origin, then x = meters east,
// y = meters up, z = meters north. A heading (degrees clockwise from north)
// is a yaw rotation about the Y axis: heading 0 (north) points +Z, heading 90
// (east) points +X — matching lib/buildingCollision.js's offsetLngLat.

import * as CANNON from 'cannon-es';
import { localOffsetMeters, fromLocalMeters } from './buildingCollision';

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

// Collision group for "ground-like" static surfaces (the ground plane and
// every building's rooftop box — see lib/buildingPhysics.js) — kept
// distinct from the default group (1, used by everything else: trees,
// helicopter, aircraft) so groundHeightAt()'s raycast only ever considers
// these, never bumping into a parked vehicle or a tree by accident.
export const GROUND_COLLISION_GROUP = 2;

const raycastResult = new CANNON.RaycastResult();
const RAY_TOP_M = 1000; // well above any building
const RAY_BOTTOM_M = -10;

/** @param {number} originLng @param {number} originLat  Fixed reference point for this world. */
export function createPhysicsWorld(originLng, originLat) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;

  const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  ground.collisionFilterGroup = GROUND_COLLISION_GROUP;
  world.addBody(ground);

  return {
    world,

    /** [lng, lat] -> {x, z} meters in this world's local frame. */
    toLocal(lng, lat) {
      const [east, north] = localOffsetMeters(originLng, originLat, lng, lat);
      return { x: east, z: north };
    },

    /** {x, z} meters -> [lng, lat]. */
    toLngLat(x, z) {
      return fromLocalMeters(originLng, originLat, x, z);
    },

    /** A yaw-only quaternion for `headingDeg` (degrees clockwise from north). */
    headingToQuaternion(headingDeg) {
      const q = new CANNON.Quaternion();
      q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), (headingDeg * Math.PI) / 180);
      return q;
    },

    /** Inverse of headingToQuaternion: reads the yaw back out of a body's orientation. */
    quaternionToHeading(q) {
      const fx = 2 * (q.x * q.z + q.y * q.w);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      return (Math.atan2(fx, fz) * 180) / Math.PI;
    },

    /**
     * The height (meters, this world's Y) of the ground or rooftop directly
     * below `lng`/`lat` — whichever GROUND_COLLISION_GROUP surface is
     * highest there. 0 (bare ground) if the raycast somehow misses (it
     * shouldn't: the ground plane is infinite).
     */
    groundHeightAt(lng, lat) {
      const { x, z } = this.toLocal(lng, lat);
      raycastResult.reset();
      const from = new CANNON.Vec3(x, RAY_TOP_M, z);
      const to = new CANNON.Vec3(x, RAY_BOTTOM_M, z);
      const hit = world.raycastClosest(from, to, { collisionFilterMask: GROUND_COLLISION_GROUP }, raycastResult);
      return hit ? raycastResult.hitPointWorld.y : 0;
    },

    step(dt) {
      world.step(FIXED_DT, dt, MAX_SUBSTEPS);
    },

    dispose() {
      world.constraints.slice().forEach((c) => world.removeConstraint(c));
      world.bodies.slice().forEach((b) => world.removeBody(b));
    }
  };
}
