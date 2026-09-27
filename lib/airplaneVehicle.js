// An airplane: a real dynamic cannon-es rigid body in the shared physics
// world (lib/physicsWorld.js), so ground/building contact is genuine, same
// as the helicopter (see lib/helicopterVehicle.js's header for why rigid
// bodies rather than the car's point-probe collision).
//
// The one thing that sets it apart from the helicopter: turning is a
// banking roll (yaw follows the current bank angle, easing in, rather than
// being driven directly) so turns build up instead of snapping. Altitude
// works exactly like the helicopter's — E climbs, Q descends, releasing
// both holds level (gravity canceled, pitch ramps vertical velocity) —
// takeoff doesn't need any runway speed first, so E lifts off immediately.

import * as CANNON from 'cannon-es';
import { normalizeDegrees, clamp } from './mathUtils';
import { AIRPLANE_GROUND_CLEARANCE } from './airplaneModel';

const HALF_EXTENTS = new CANNON.Vec3(1.0, 0.9, 3.5);
const MASS = 1100; // kg
const GRAVITY_N = MASS * 9.82;

export function createAirplane(physics, lng, lat, heading) {
  const { x, z } = physics.toLocal(lng, lat);
  const body = new CANNON.Body({
    mass: MASS,
    shape: new CANNON.Box(HALF_EXTENTS),
    linearDamping: 0.2,
    angularDamping: 0.98 // yaw/roll are driven directly; this just damps out contact-induced spin
  });
  body.position.set(x, AIRPLANE_GROUND_CLEARANCE + HALF_EXTENTS.y, z);
  body.quaternion.copy(physics.headingToQuaternion(heading));
  physics.world.addBody(body);

  return {
    physics,
    body,
    lng,
    lat,
    heading,
    speed: 0, // m/s, ground track — same field name as car/heli state, for the shared HUD/save code
    verticalSpeed: 0, // m/s, +up — for the camera's moving/stationary check
    altitude: AIRPLANE_GROUND_CLEARANCE,
    pitch: 0,
    roll: 0
  };
}

export function removeAirplane(plane) {
  plane.physics.world.removeBody(plane.body);
}

/** Moves an airplane to `lng`/`lat` at ground level, at rest. */
export function teleportAirplane(plane, lng, lat, heading) {
  const { x, z } = plane.physics.toLocal(lng, lat);
  plane.body.position.set(x, AIRPLANE_GROUND_CLEARANCE + HALF_EXTENTS.y, z);
  plane.body.velocity.set(0, 0, 0);
  plane.body.angularVelocity.set(0, 0, 0);
  plane.heading = heading;
  plane.body.quaternion.copy(plane.physics.headingToQuaternion(heading));
  plane.lng = lng;
  plane.lat = lat;
  plane.speed = 0;
  plane.altitude = AIRPLANE_GROUND_CLEARANCE;
  plane.verticalSpeed = 0;
  plane.pitch = 0;
  plane.roll = 0;
}

/**
 * @param {{throttle: number, steer: number, lift: number}} input  -1..1 each: throttle
 *        accelerates/decelerates (no reverse), steer banks left/right (which also turns it),
 *        lift is the altitude-hold axis (+1 = climb, -1 = descend, 0 = hold) — always available,
 *        no runway speed needed first.
 * @param {object} stats  From lib/planeCatalog.js: maxSpeed (m/s), accel (m/s²), maxBankDeg,
 *        rollResponse (1/s), yawRate (deg/s at full bank), maxAltitude (m), maxClimbRate (m/s),
 *        climbAccel (m/s²).
 */
export function stepAirplane(plane, input, stats, dt) {
  const { body, physics } = plane;

  // Bank eases toward the steer input, and yaw follows the *current* bank
  // angle rather than the raw input — a turn builds up as it banks in,
  // instead of snapping straight to a new heading.
  const targetRoll = -input.steer * stats.maxBankDeg;
  const rollK = 1 - Math.exp(-stats.rollResponse * dt);
  plane.roll += (targetRoll - plane.roll) * rollK;
  plane.heading = normalizeDegrees(plane.heading + (plane.roll / stats.maxBankDeg) * stats.yawRate * dt);
  body.quaternion.copy(physics.headingToQuaternion(plane.heading));
  body.angularVelocity.set(0, 0, 0);

  // Throttle: W accelerates, S decelerates (no reverse); releasing both
  // holds the current speed exactly — no passive drag/decay while coasting.
  if (input.throttle !== 0) {
    plane.speed = clamp(plane.speed + input.throttle * stats.accel * dt, 0, stats.maxSpeed);
  }
  const rad = (plane.heading * Math.PI) / 180;
  body.velocity.x = Math.sin(rad) * plane.speed;
  body.velocity.z = Math.cos(rad) * plane.speed;

  // Altitude hold, exactly like the helicopter's: gravity canceled every
  // step, velocity.y ramps toward a climb/descend rate while E/Q is held,
  // and snaps to exactly 0 the instant both are released — no drift up or
  // down while holding. No runway speed required — E lifts off immediately,
  // for an easy takeoff.
  const minY = AIRPLANE_GROUND_CLEARANCE + HALF_EXTENTS.y;
  body.applyForce(new CANNON.Vec3(0, GRAVITY_N, 0));
  if (input.lift !== 0) {
    const targetVy = input.lift * stats.maxClimbRate;
    const maxChange = stats.climbAccel * dt;
    body.velocity.y += clamp(targetVy - body.velocity.y, -maxChange, maxChange);
  } else {
    body.velocity.y = 0;
  }

  const maxY = stats.maxAltitude + HALF_EXTENTS.y;
  if (body.position.y > maxY) {
    body.position.y = maxY;
    if (body.velocity.y > 0) body.velocity.y = 0;
  }
  if (body.position.y < minY) {
    body.position.y = minY;
    if (body.velocity.y < 0) body.velocity.y = 0;
  }

  const [lng, lat] = physics.toLngLat(body.position.x, body.position.z);
  plane.lng = lng;
  plane.lat = lat;
  plane.altitude = body.position.y - HALF_EXTENTS.y;
  plane.verticalSpeed = body.velocity.y;

  const targetPitch = clamp(plane.verticalSpeed * 2.5, -12, 12);
  const k = 1 - Math.exp(-6 * dt);
  plane.pitch += (targetPitch - plane.pitch) * k;

  return { distance: plane.speed * dt, blocked: false };
}
