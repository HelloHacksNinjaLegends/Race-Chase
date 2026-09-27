// The dealership: a fixed spot on the map, and the only place to get a car.
// Walk up to it on foot and press E to open it; cars obtained there are
// parked on its lot (lotSlot) for the character to walk to and get into.

import { offsetLngLat, distanceMeters } from './buildingCollision';

// On No. 3 Road, Richmond, a short walk north of the default spawn point
// (DRIVE_START), right on the roadway.
export const DEALERSHIP_LNGLAT = [-123.1366, 49.1692];
export const DEALERSHIP_NAME = 'Richmond Motors';

// On foot within this distance, E opens the dealership.
export const DEALERSHIP_RADIUS_M = 12;

// The lot: a row of parking slots along the road, north of the dealership
// pin, with cars facing along the road.
const LOT_HEADING = 0;
const LOT_FIRST_SLOT_M = 10;
const LOT_SLOT_SPACING_M = 7;
export const LOT_SLOT_COUNT = 6;

/** Position and heading of lot slot `i` (0 = nearest the dealership). */
export function lotSlot(i) {
  const [lng, lat] = offsetLngLat(
    DEALERSHIP_LNGLAT[0],
    DEALERSHIP_LNGLAT[1],
    LOT_HEADING,
    LOT_FIRST_SLOT_M + i * LOT_SLOT_SPACING_M
  );
  return { lng, lat, heading: LOT_HEADING };
}

export function isAtDealership(lng, lat) {
  return distanceMeters(lng, lat, DEALERSHIP_LNGLAT[0], DEALERSHIP_LNGLAT[1]) <= DEALERSHIP_RADIUS_M;
}
