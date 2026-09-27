// Kinematic car model: state, per-frame movement, and a footprint test.
// Pure logic — rendering and input live in components/CarDriving.jsx.

import { offsetLngLat, localOffsetMeters } from './buildingCollision';
import { clamp, normalizeDegrees } from './mathUtils';
import {
  CAR_LENGTH,
  CAR_WIDTH,
  DRIVE_MAX_REVERSE_SPEED,
  DRIVE_REVERSE_ACCEL,
  DRIVE_BRAKE,
  DRIVE_COAST_DECEL,
  DRIVE_MAX_TURN_RATE,
  DRIVE_FULL_TURN_SPEED,
  DRIVE_STEER_RESPONSE
} from './constants';

// Collision probe sits just past the bumper.
const PROBE_DISTANCE_M = CAR_LENGTH / 2 + 0.3;

export function createVehicle(lng, lat, heading) {
  return {
    lng,
    lat,
    heading, // degrees clockwise from north
    speed: 0, // m/s, negative when reversing
    steer: 0, // -1..1, eased toward the pressed direction
    altitude: 0, // meters above true ground — real gravity, see lib/gravity.js
    verticalSpeed: 0 // m/s, +up
  };
}

/**
 * Advances `car` by one frame.
 * @param {{throttle: number, steer: number, brake?: boolean}} input  throttle/steer in -1..1;
 *        `brake` stops the car regardless of throttle (used while a menu is open).
 * @param {{maxSpeed: number, accel: number}} stats  From lib/carCatalog.js.
 * @param {(lng: number, lat: number) => boolean} blocks  Whether a point is solid.
 * @returns {{distance: number, blocked: boolean}}  Meters actually moved.
 */
export function stepVehicle(car, input, stats, dt, blocks) {
  // Speed: accelerate, brake (pressing against current motion), or coast.
  const throttle = input.brake ? 0 : input.throttle;
  if (throttle > 0) {
    car.speed += (car.speed < 0 ? DRIVE_BRAKE : stats.accel) * dt;
  } else if (throttle < 0) {
    car.speed -= (car.speed > 0 ? DRIVE_BRAKE : DRIVE_REVERSE_ACCEL) * dt;
  } else {
    const drop = (input.brake ? DRIVE_BRAKE : DRIVE_COAST_DECEL) * dt;
    car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
  }
  car.speed = clamp(car.speed, -DRIVE_MAX_REVERSE_SPEED, stats.maxSpeed);

  // Heading: steering eases in/out, and scales with speed so the car
  // can't turn while stopped. Reversing flips the turn direction.
  const steerTarget = input.brake ? 0 : input.steer;
  car.steer += (steerTarget - car.steer) * (1 - Math.exp(-DRIVE_STEER_RESPONSE * dt));
  const grip = clamp(Math.abs(car.speed) / DRIVE_FULL_TURN_SPEED, 0, 1);
  const nextHeading = car.heading + car.steer * DRIVE_MAX_TURN_RATE * grip * Math.sign(car.speed) * dt;

  const distance = car.speed * dt;
  if (distance === 0) return { distance: 0, blocked: false };
  const [nextLng, nextLat] = offsetLngLat(car.lng, car.lat, nextHeading, distance);

  // Collision: probe the bumper in the direction of travel. Only block
  // moving *into* something solid, so a car that starts inside a footprint
  // (or clips a corner) can still drive out.
  const probe = Math.sign(car.speed) * PROBE_DISTANCE_M;
  const [curX, curY] = offsetLngLat(car.lng, car.lat, car.heading, probe);
  const [nextX, nextY] = offsetLngLat(nextLng, nextLat, nextHeading, probe);
  if (blocks(nextX, nextY) && !blocks(curX, curY)) {
    car.speed = 0;
    return { distance: 0, blocked: true };
  }

  car.lng = nextLng;
  car.lat = nextLat;
  car.heading = normalizeDegrees(nextHeading);
  return { distance: Math.abs(distance), blocked: false };
}

/** True if (lng, lat) lies within the car's rectangular footprint, grown by `margin` meters. */
export function pointInVehicle(car, lng, lat, margin = 0) {
  const [east, north] = localOffsetMeters(car.lng, car.lat, lng, lat);
  const h = (car.heading * Math.PI) / 180;
  const forward = east * Math.sin(h) + north * Math.cos(h);
  const right = east * Math.cos(h) - north * Math.sin(h);
  return Math.abs(forward) <= CAR_LENGTH / 2 + margin && Math.abs(right) <= CAR_WIDTH / 2 + margin;
}
