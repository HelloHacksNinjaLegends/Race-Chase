// Real vertical gravity for the character and car — the one thing that
// distinguishes them from the helicopter/plane/private jet, whose altitude
// is instead fully E/Q-controlled with gravity canceled every step (see
// lib/helicopterVehicle.js, lib/airplaneVehicle.js).
//
// Deliberately NOT a full rigid-body conversion: the character/car keep
// their existing tuned 2D horizontal movement and point-probe collision
// (lib/character.js, lib/vehicle.js) untouched — this only adds a genuine
// vertical axis on top, falling under gravity when unsupported and landing
// exactly on whatever's underneath (the ground plane, or a building's
// rooftop), found each step by raycasting straight down through the shared
// cannon-es world (lib/physicsWorld.js's groundHeightAt — see there for why
// a full rigid-body car risked regressing the tuned driving feel for no
// benefit here). `altitude`/`verticalSpeed` use the same field names and
// meaning as the helicopter/airplane's, so the camera and renderer already
// pick them up generically with no further wiring.

const GRAVITY_M_S2 = 20; // brisker than real gravity (9.82) for a snappier arcade fall
const MAX_FALL_SPEED_M_S = 40; // terminal velocity, so a long fall doesn't build up an absurd impact
const GROUND_SNAP_M = 0.05; // within this of the detected ground/rooftop, snap to it instead of stepping

/**
 * Advances `state.altitude`/`state.verticalSpeed` by one frame of real
 * gravity, landing exactly on the ground or rooftop beneath `state.lng`/
 * `state.lat` (via `physics.groundHeightAt`). Call every frame for whichever
 * of the character/car is currently active — parked vehicles and the
 * helicopter/plane/private jet (which manage their own altitude) don't need it.
 */
export function stepGravity(state, physics, dt) {
  const groundY = physics.groundHeightAt(state.lng, state.lat);
  if (state.altitude > groundY + GROUND_SNAP_M) {
    state.verticalSpeed = Math.max(state.verticalSpeed - GRAVITY_M_S2 * dt, -MAX_FALL_SPEED_M_S);
    state.altitude += state.verticalSpeed * dt;
    if (state.altitude < groundY) {
      state.altitude = groundY;
      state.verticalSpeed = 0;
    }
  } else {
    state.altitude = groundY;
    state.verticalSpeed = 0;
  }
}
