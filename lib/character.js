// On-foot character controller: movement is relative to the camera (GTA-
// style) — the character always faces and moves in whatever compass
// direction the pressed WASD combination resolves to (given the camera's
// current yaw), rather than turning in place independently of movement.
// Same "don't walk into solid things" probe the car uses. Pure logic — the
// model is in lib/blobCharacterModel.js.

import { offsetLngLat } from './buildingCollision';
import { clamp, normalizeDegrees } from './mathUtils';
import { WALK_SPEED, RUN_SPEED, WALK_ACCEL, CHARACTER_RADIUS } from './constants';

// One full leg cycle (left + right step) per this many meters walked.
const STRIDE_CYCLE_M = 1.5;

export function createCharacter(lng = 0, lat = 0, heading = 0) {
  return {
    lng,
    lat,
    heading, // degrees clockwise from north — also the facing/movement direction
    speed: 0, // m/s
    walkPhase: 0, // radians, drives the limb swing
    altitude: 0, // meters above true ground — real gravity, see lib/gravity.js
    verticalSpeed: 0 // m/s, +up
  };
}

/**
 * Advances the character by one frame.
 * @param {{moving: boolean, moveHeading: number, run: boolean}} input  moveHeading is the
 *        compass direction (degrees) the pressed keys resolve to, given the camera's yaw.
 * @param {(lng: number, lat: number) => boolean} blocks  Whether a point is solid.
 * @returns {{distance: number, blocked: boolean}}
 */
export function stepCharacter(c, input, dt, blocks) {
  const target = input.moving ? (input.run ? RUN_SPEED : WALK_SPEED) : 0;
  const maxChange = WALK_ACCEL * dt;
  c.speed += clamp(target - c.speed, -maxChange, maxChange);
  if (input.moving) c.heading = normalizeDegrees(input.moveHeading);

  const distance = c.speed * dt;
  if (distance === 0) return { distance: 0, blocked: false };
  const [nextLng, nextLat] = offsetLngLat(c.lng, c.lat, c.heading, distance);

  const [curX, curY] = offsetLngLat(c.lng, c.lat, c.heading, CHARACTER_RADIUS);
  const [nextX, nextY] = offsetLngLat(nextLng, nextLat, c.heading, CHARACTER_RADIUS);
  if (blocks(nextX, nextY) && !blocks(curX, curY)) {
    c.speed = 0;
    return { distance: 0, blocked: true };
  }

  c.lng = nextLng;
  c.lat = nextLat;
  c.walkPhase = (c.walkPhase + (Math.abs(distance) / STRIDE_CYCLE_M) * Math.PI * 2) % (Math.PI * 2);
  return { distance: Math.abs(distance), blocked: false };
}
