// A helicopter: a real dynamic cannon-es rigid body in the shared physics
// world (lib/physicsWorld.js), so ground contact and building contact are
// genuine — it lands on rooftops instead of clipping through, and can't be
// flown through a tower.
//
// Yaw is driven directly (heli.heading, applied straight to the body's
// quaternion each step) rather than by torque: a full torque-based attitude
// controller adds a lot of tuning risk for a driving-picker side feature, and
// this keeps flight predictable while translation and collision response
// stay on the physics solver — throttle applies a real horizontal force, and
// contacts genuinely stop or deflect the body. Altitude is a separate hold
// axis (not gravity-driven): holding E/Q ramps vertical velocity toward the
// climb/descend rate, and releasing both holds the current altitude exactly
// (velocity.y snaps to 0) rather than drifting or free-falling. Visual
// pitch/roll (nose dips forward, banks in turns) is a cosmetic blend on top,
// applied at render time via lib/worldLayer.js's pitch/roll fields — it
// never feeds back into the collision shape's actual orientation.

import * as CANNON from 'cannon-es';
import { normalizeDegrees, clamp } from './mathUtils';
import { HELICOPTER_GROUND_CLEARANCE } from './helicopterModel';

const HALF_EXTENTS = new CANNON.Vec3(1.0, 0.9, 2.9);
const MASS = 1400; // kg
// Gravity is canceled every step (see stepHelicopter) — a hovering aircraft
// with an altitude-hold axis shouldn't sink under its own weight — so the
// only thing that changes vertical velocity is the explicit E/Q ramp below.
const GRAVITY_N = MASS * 9.82;

export function createHelicopter(physics, lng, lat, heading) {
  const { x, z } = physics.toLocal(lng, lat);
  const body = new CANNON.Body({
    mass: MASS,
    shape: new CANNON.Box(HALF_EXTENTS),
    linearDamping: 0.35,
    angularDamping: 0.98 // yaw is driven directly; this just damps out contact-induced spin
  });
  body.position.set(x, HELICOPTER_GROUND_CLEARANCE + HALF_EXTENTS.y, z);
  body.quaternion.copy(physics.headingToQuaternion(heading));
  physics.world.addBody(body);

  return {
    physics,
    body,
    lng,
    lat,
    heading,
    speed: 0, // m/s horizontal — same field name as car state, for the shared HUD/save code
    verticalSpeed: 0, // m/s, +up — for the camera's moving/stationary check
    altitude: HELICOPTER_GROUND_CLEARANCE,
    pitch: 0,
    roll: 0
  };
}

export function removeHelicopter(heli) {
  heli.physics.world.removeBody(heli.body);
}

/** Moves a helicopter to `lng`/`lat` at ground level, at rest (dealership lot, phone summon). */
export function teleportHelicopter(heli, lng, lat, heading) {
  const { x, z } = heli.physics.toLocal(lng, lat);
  heli.body.position.set(x, HELICOPTER_GROUND_CLEARANCE + HALF_EXTENTS.y, z);
  heli.body.velocity.set(0, 0, 0);
  heli.body.angularVelocity.set(0, 0, 0);
  heli.heading = heading;
  heli.body.quaternion.copy(heli.physics.headingToQuaternion(heading));
  heli.lng = lng;
  heli.lat = lat;
  heli.altitude = HELICOPTER_GROUND_CLEARANCE;
  heli.verticalSpeed = 0;
  heli.pitch = 0;
  heli.roll = 0;
}

/**
 * @param {{throttle: number, steer: number, lift: number}} input  -1..1 each: throttle tilts
 *        the nose to move forward/back, steer yaws left/right, lift is the separate altitude-hold
 *        axis (+1 = E held/climbing, -1 = Q held/descending, 0 = holding the current altitude).
 * @param {object} stats  From lib/carCatalog.js: maxSpeed (m/s), forwardForce (N), yawRate (deg/s),
 *        maxAltitude (m), maxClimbRate (m/s), climbAccel (m/s² ramp toward maxClimbRate).
 */
export function stepHelicopter(heli, input, stats, dt) {
  const { body, physics } = heli;

  heli.heading = normalizeDegrees(heli.heading + input.steer * stats.yawRate * dt);
  body.quaternion.copy(physics.headingToQuaternion(heli.heading));
  body.angularVelocity.set(0, 0, 0);

  const rad = (heli.heading * Math.PI) / 180;
  const forwardX = Math.sin(rad);
  const forwardZ = Math.cos(rad);
  const thrust = input.throttle * stats.forwardForce;
  // No relative point given: applies through the center of mass (no torque) —
  // yaw is driven directly above, so horizontal thrust is all this does.
  // The vertical component exactly cancels gravity every step; altitude only
  // changes via the explicit E/Q ramp below, never by falling.
  body.applyForce(new CANNON.Vec3(forwardX * thrust, GRAVITY_N, forwardZ * thrust));

  // Altitude hold: ramp toward the climb/descend rate while E/Q is held; snap
  // to 0 the instant both are released, so it holds altitude exactly instead
  // of drifting (gravity is already canceled above, so this is the only
  // thing touching vertical velocity).
  if (input.lift !== 0) {
    const targetVy = input.lift * stats.maxClimbRate;
    const maxChange = stats.climbAccel * dt;
    body.velocity.y += clamp(targetVy - body.velocity.y, -maxChange, maxChange);
  } else {
    body.velocity.y = 0;
  }

  // Speed cap on horizontal motion, so it flies like a helicopter with real limits.
  const horizSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  if (horizSpeed > stats.maxSpeed) {
    const k = stats.maxSpeed / horizSpeed;
    body.velocity.x *= k;
    body.velocity.z *= k;
  }
  const minY = HELICOPTER_GROUND_CLEARANCE + HALF_EXTENTS.y;
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
  heli.lng = lng;
  heli.lat = lat;
  heli.altitude = body.position.y - HALF_EXTENTS.y;
  heli.speed = Math.min(horizSpeed, stats.maxSpeed);
  heli.verticalSpeed = body.velocity.y;

  const targetPitch = -input.throttle * 12;
  const targetRoll = -input.steer * 14;
  const k = 1 - Math.exp(-6 * dt);
  heli.pitch += (targetPitch - heli.pitch) * k;
  heli.roll += (targetRoll - heli.roll) * k;

  return { distance: heli.speed * dt, blocked: false };
}
