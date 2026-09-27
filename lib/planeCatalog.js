// The world's default aircraft — a fixed set, parked at YVR (see
// lib/airportSpawn.js) from the start. Unlike lib/carCatalog.js, none of
// these are ever sold through the dealership or summoned by the phone, and
// there's no way to spawn another one in: the only way to get one is to
// walk up to it at the airport, and once all of them have been taken, that's
// it — nothing regenerates a replacement.
//
// The private jet entries are mechanically just more airplane entries (same
// kind, same physics/camera/HUD path in components/CarDriving.jsx) — a
// different `model` (see lib/airplaneModel.js) and flavor, not a separate
// vehicle class.
//
// Stats: speeds in m/s, accel in m/s², maxBankDeg/rollResponse/yawRate shape
// the banking turn (see lib/airplaneVehicle.js). Speed holds steady once
// set — only S (braking) reduces it, never a passive decay. E climbs
// immediately, no runway speed needed first — an easy takeoff.
//
// Both plane.glb and pj.glb are real models with their own baked paint
// texture (not a palette to recolor), so unlike lib/carCatalog.js's cars,
// there's no per-entry `color` here — every Skyrunner 320 (and every
// Skyrunner Exec) looks the same.

const SKYRUNNER_STATS = {
  kind: 'airplane',
  brand: null,
  name: 'Skyrunner 320',
  model: 'plane',
  maxSpeed: 62, // ~223 km/h cruise
  accel: 5, // m/s² while W or S is held
  maxBankDeg: 28,
  rollResponse: 2.2, // 1/s — how quickly it banks into a turn
  yawRate: 22, // deg/s of turn at full bank
  maxAltitude: 900, // m
  maxClimbRate: 14, // m/s — top speed of the E/Q altitude-hold axis
  climbAccel: 20 // m/s² — how fast it ramps to maxClimbRate while E/Q is held
};

// A little quicker than the 320 — smaller airframe.
const PRIVATE_JET_STATS = {
  ...SKYRUNNER_STATS,
  name: 'Skyrunner Exec',
  model: 'pj',
  maxSpeed: 70, // ~252 km/h cruise
  accel: 6,
  maxAltitude: 1100,
  maxClimbRate: 17,
  climbAccel: 24
};

export const PLANES = [
  { ...SKYRUNNER_STATS, id: 'skyrunner-1' },
  { ...SKYRUNNER_STATS, id: 'skyrunner-2' },
  { ...SKYRUNNER_STATS, id: 'skyrunner-3' },
  { ...PRIVATE_JET_STATS, id: 'skyrunner-exec-1' },
  { ...PRIVATE_JET_STATS, id: 'skyrunner-exec-2' }
];

export function getPlane(id) {
  return PLANES.find((p) => p.id === id) || PLANES[0];
}
