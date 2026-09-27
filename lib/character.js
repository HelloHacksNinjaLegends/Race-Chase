// On-foot character controller: tank-style walking (W/S move along the
// facing direction, A/D turn), with the same "don't walk into solid things"
// probe the car uses. Pure logic — the model is in lib/characterModel.js.

import { offsetLngLat } from './buildingCollision';
import { clamp, normalizeDegrees } from './mathUtils';
import { WALK_SPEED, RUN_SPEED, WALK_BACK_SPEED, WALK_ACCEL, WALK_TURN_RATE, CHARACTER_RADIUS } from './constants';

// One full leg cycle (left + right step) per this many meters walked.
const STRIDE_CYCLE_M = 1.5;

export function createCharacter(lng = 0, lat = 0, heading = 0) {
  return {
    lng,
    lat,
    heading, // degrees clockwise from north
    speed: 0, // m/s, negative when backing up
    walkPhase: 0 // radians, drives the limb swing
  };
}

/**
 * Advances the character by one frame.
 * @param {{forward: number, turn: number, run: boolean}} input  forward/turn in -1..1.
 * @param {(lng: number, lat: number) => boolean} blocks  Whether a point is solid.
 * @returns {{distance: number, blocked: boolean}}
 */
export function stepCharacter(c, input, dt, blocks, speedMultiplier = 1) {
  const target = input.forward > 0
    ? (input.run ? RUN_SPEED : WALK_SPEED) * speedMultiplier
    : input.forward < 0 ? -WALK_BACK_SPEED * speedMultiplier : 0;
  const maxChange = WALK_ACCEL * dt;
  c.speed += clamp(target - c.speed, -maxChange, maxChange);
  c.heading = normalizeDegrees(c.heading + input.turn * WALK_TURN_RATE * dt);

  const distance = c.speed * dt;
  if (distance === 0) return { distance: 0, blocked: false };
  const [nextLng, nextLat] = offsetLngLat(c.lng, c.lat, c.heading, distance);

  const probe = Math.sign(c.speed) * CHARACTER_RADIUS;
  const [curX, curY] = offsetLngLat(c.lng, c.lat, c.heading, probe);
  const [nextX, nextY] = offsetLngLat(nextLng, nextLat, c.heading, probe);
  if (blocks(nextX, nextY) && !blocks(curX, curY)) {
    c.speed = 0;
    return { distance: 0, blocked: true };
  }

  c.lng = nextLng;
  c.lat = nextLat;
  c.walkPhase = (c.walkPhase + (Math.abs(distance) / STRIDE_CYCLE_M) * Math.PI * 2) % (Math.PI * 2);
  return { distance: Math.abs(distance), blocked: false };
}
