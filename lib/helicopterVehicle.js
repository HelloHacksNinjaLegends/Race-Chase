// A helicopter: a real dynamic cannon-es rigid body in the shared physics
// world (lib/physicsWorld.js), so gravity, ground contact and building
// contact are genuine — it lands on rooftops instead of clipping through,
// and can't be flown through a tower.
//
// Yaw is driven directly (heli.heading, applied straight to the body's
// quaternion each step) rather than by torque: a full torque-based attitude
// controller adds a lot of tuning risk for a driving-picker side feature, and
// this keeps flight predictable while translation, altitude and collision
// response stay entirely on the physics solver — throttle/lift apply real
// forces, and contacts genuinely stop or deflect the body. Visual pitch/roll
// (nose dips forward, banks in turns) is a cosmetic blend on top, applied at
// render time via lib/worldLayer.js's pitch/roll fields — it never feeds
// back into the collision shape's actual orientation.

import * as CANNON from 'cannon-es';
import { normalizeDegrees, clamp } from './mathUtils';
import { HELICOPTER_GROUND_CLEARANCE } from './helicopterModel';

const HALF_EXTENTS = new CANNON.Vec3(1.0, 0.9, 2.9);
const MASS = 1400; // kg
const GRAVITY_N = MASS * 9.82;
// Idle drift toward the ground when lift is released near the ground, so it
// settles onto its skids instead of hovering exactly in place forever.
const IDLE_SINK_N = GRAVITY_N * 0.4;

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
  heli.pitch = 0;
  heli.roll = 0;
}

/**
 * @param {{throttle: number, steer: number, lift: number}} input  -1..1 each: throttle tilts
 *        the nose to move forward/back, steer yaws left/right, lift is the separate vertical axis.
 * @param {object} stats  From lib/carCatalog.js: maxSpeed (m/s), forwardForce (N), liftForce (N),
 *        yawRate (deg/s), maxAltitude (m), maxClimbRate (m/s).
 */
export function stepHelicopter(heli, input, stats, dt) {
  const { body, physics } = heli;

  heli.heading = normalizeDegrees(heli.heading + input.steer * stats.yawRate * dt);
  body.quaternion.copy(physics.headingToQuaternion(heli.heading));
  body.angularVelocity.set(0, 0, 0);

  const rad = (heli.heading * Math.PI) / 180;
  const forwardX = Math.sin(rad);
  const forwardZ = Math.cos(rad);

  const grounded = body.position.y <= HELICOPTER_GROUND_CLEARANCE + HALF_EXTENTS.y + 0.05;
  const lift = GRAVITY_N + input.lift * stats.liftForce - (grounded && input.lift <= 0 ? IDLE_SINK_N : 0);
  const thrust = input.throttle * stats.forwardForce;
  // No relative point given: applies through the center of mass (no torque) —
  // yaw is driven directly above, so translation is all these forces do.
  body.applyForce(new CANNON.Vec3(forwardX * thrust, lift, forwardZ * thrust));

  // Speed caps, so it flies like a helicopter with real limits rather than an unbounded rocket.
  const horizSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  if (horizSpeed > stats.maxSpeed) {
    const k = stats.maxSpeed / horizSpeed;
    body.velocity.x *= k;
    body.velocity.z *= k;
  }
  body.velocity.y = clamp(body.velocity.y, -stats.maxClimbRate, stats.maxClimbRate);
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

  const targetPitch = -input.throttle * 12;
  const targetRoll = -input.steer * 14;
  const k = 1 - Math.exp(-6 * dt);
  heli.pitch += (targetPitch - heli.pitch) * k;
  heli.roll += (targetRoll - heli.roll) * k;

  return { distance: heli.speed * dt, blocked: false };
}
