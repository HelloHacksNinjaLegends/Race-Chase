// A single cannon-es world shared by the new rigid-body systems: trees
// (impact + toppling) and helicopters (flight + ground/rooftop collision).
//
// Car-vs-building and car-vs-NPC collision deliberately stay on the existing
// lightweight point-probe system in lib/vehicle.js / lib/buildingCollision.js
// — building footprints stream in live from map tiles as 2D polygons with
// holes, and migrating that onto rigid bodies every tile refresh would risk
// regressing the tuned driving feel for no gameplay benefit. This module is
// the "real physics" layer for the genuinely new rigid-body needs.
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

/** @param {number} originLng @param {number} originLat  Fixed reference point for this world. */
export function createPhysicsWorld(originLng, originLat) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;

  const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
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

    step(dt) {
      world.step(FIXED_DT, dt, MAX_SUBSTEPS);
    },

    dispose() {
      world.constraints.slice().forEach((c) => world.removeConstraint(c));
      world.bodies.slice().forEach((b) => world.removeBody(b));
    }
  };
}
