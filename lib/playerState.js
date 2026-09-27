// On-foot / in-car state machine.
//
// The player is always in exactly one of two states, and "E" (interact) is
// the only way between them:
//
//   onFoot ──E, next to a car──────────▶ driving
//   onFoot ──E, at the dealership──────▶ (dealership menu; still onFoot)
//   driving ──E────────────────────────▶ onFoot (steps out beside the car)
//
// This module is pure: it decides *what* an interaction does from a snapshot
// of the situation. components/CarDriving.jsx applies the result — moving
// the character, switching controls, and retargeting the camera — in one
// place, so those can't get out of sync.

export const ON_FOOT = 'onFoot';
export const DRIVING = 'driving';

/**
 * @typedef {object} InteractContext
 * @property {'onFoot'|'driving'} state
 * @property {{id: string, name: string}|null} nearestCar  Enterable car in range (on foot).
 * @property {boolean} atDealership                         Within the dealership's interaction zone.
 */

/**
 * What pressing E does right now.
 * Being next to a car wins over the dealership, since cars obtained there
 * are parked right beside it.
 * @param {InteractContext} ctx
 * @returns {{type: 'enterCar', carId: string} | {type: 'exitCar'} | {type: 'openDealership'} | {type: 'none'}}
 */
export function resolveInteract(ctx) {
  if (ctx.state === DRIVING) return { type: 'exitCar' };
  if (ctx.nearestCar) return { type: 'enterCar', carId: ctx.nearestCar.id };
  if (ctx.atDealership) return { type: 'openDealership' };
  return { type: 'none' };
}

/** The HUD prompt for what E would do, or null when E does nothing useful. */
export function interactPrompt(ctx) {
  const action = resolveInteract(ctx);
  switch (action.type) {
    case 'enterCar':
      return 'to drive the ' + ctx.nearestCar.name;
    case 'openDealership':
      return 'to open the dealership';
    default:
      // Getting out is always available while driving; it's in the controls hint.
      return null;
  }
}

/** State after an interaction (the dealership menu doesn't change state). */
export function nextState(state, action) {
  if (action.type === 'enterCar') return DRIVING;
  if (action.type === 'exitCar') return ON_FOOT;
  return state;
}
