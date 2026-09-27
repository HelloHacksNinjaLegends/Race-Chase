// Airplane visual: the real model (public/models/kenney/plane.glb for the
// commercial plane, pj.glb for the private jet — see def.model), loaded via
// lib/genericAircraftModel.js — no wheel rig or palette recoloring needed,
// each is shown as-is, scaled to fit and grounded. Was a fully procedural
// placeholder before; see lib/genericAircraftModel.js's header for the
// caveats on scale/orientation, unverified in a running browser — pj.glb
// especially, given its near-square footprint (see that file's header).

import { setGenericAircraftModel, cancelGenericAircraftModel } from './genericAircraftModel';

// Matches the old procedural commercial-plane model's approximate
// nose-to-tail length, so the already-tuned AIRPLANE_ORBIT_CAMERA follow
// distance/height (lib/constants.js) should still frame it about the same.
const TARGET_LENGTH_BY_MODEL = {
  plane: 6.4,
  pj: 5 // a private jet reads smaller than the commercial plane
};

// Wheels-to-ground clearance — also the airplane's minimum altitude (see
// lib/airplaneVehicle.js). Unchanged from the old procedural model's value;
// genericAircraftModel.js grounds each new model's own lowest point to
// local y = 0 the same way the old one was built, so this should still
// read the same. Retune here if it looks sunk into or floating above ground.
export const AIRPLANE_GROUND_CLEARANCE = 0.5;

/** Gives `root` the airplane model for `def.model` ('plane' or 'pj'). Mirrors lib/carModel.js's setCarModel. */
export function setAirplaneModel(root, def) {
  const model = def.model || 'plane';
  setGenericAircraftModel(root, model, TARGET_LENGTH_BY_MODEL[model] || TARGET_LENGTH_BY_MODEL.plane);
}

/** Cancels any in-flight model load for `root` (call before disposing it). */
export function cancelAirplaneModel(root) {
  cancelGenericAircraftModel(root);
}
