// Every car the player can own. The dealership sells from this list and the
// garage stores ids from it.
//
// Brand names are flavor text only: every car is a generic CC0 model from
// Kenney's Car Kit (public/models/kenney), repainted — not a real make.
//
// Stats: maxSpeed in m/s, accel in m/s². Look: `model` (a Kenney .glb name),
// paint `color`, `roofScale` (how much the cabin above the wheel arches is
// lowered; lower = sportier — the arches and wheels are never changed), an
// optional `rig` to override measured wheel parameters (lib/vehicleRig.js),
// and `style` for the box-car placeholder shown while the model loads.

import { DRIVE_MAX_SPEED, DRIVE_ACCEL } from './constants';

export const CARS = [
  {
    id: 'starter',
    kind: 'car',
    brand: null,
    name: 'Starter Hatchback',
    price: 0,
    maxSpeed: DRIVE_MAX_SPEED, // ~80 km/h
    accel: DRIVE_ACCEL,
    style: 'hatch',
    model: 'hatchback-sports',
    roofScale: 0.6,
    color: '#d9412b'
  },
  {
    id: 'coupe',
    kind: 'car',
    brand: null,
    name: 'Sport Coupe',
    price: 2500,
    maxSpeed: 29, // ~105 km/h
    accel: 9,
    style: 'coupe',
    model: 'sedan',
    roofScale: 0.45,
    color: '#2f6fd6'
  },
  {
    id: 'ferrari',
    kind: 'car',
    brand: 'Ferrari',
    name: 'Rosso V8',
    price: 8000,
    maxSpeed: 36, // ~130 km/h
    accel: 11.5,
    style: 'supercar',
    model: 'sedan-sports',
    roofScale: 0.42,
    color: '#c8102e'
  },
  {
    id: 'lamborghini',
    kind: 'car',
    brand: 'Lamborghini',
    name: 'Toro V12',
    price: 12000,
    maxSpeed: 39, // ~140 km/h
    accel: 12,
    style: 'supercar',
    model: 'sedan-sports',
    roofScale: 0.4,
    color: '#8fbf2a'
  },
  {
    id: 'mclaren',
    kind: 'car',
    brand: 'McLaren',
    name: 'Papaya GT',
    price: 18000,
    maxSpeed: 42, // ~150 km/h
    accel: 13.5,
    style: 'supercar',
    model: 'sedan-sports',
    roofScale: 0.38,
    color: '#f07a12'
  },
  {
    id: 'chopper',
    kind: 'helicopter',
    brand: null,
    name: 'Skylark Chopper',
    price: 25000,
    maxSpeed: 34, // ~122 km/h forward flight
    forwardForce: 16000, // N, pitch-tilt thrust
    liftForce: 24000, // N, vertical throttle/lift axis
    yawRate: 65, // deg/s
    maxAltitude: 220, // m
    maxClimbRate: 9, // m/s
    color: '#c2c8cc'
  }
];

export const DEFAULT_CAR_ID = 'starter';

export function getCar(id) {
  return CARS.find((c) => c.id === id) || CARS.find((c) => c.id === DEFAULT_CAR_ID);
}

export function carDisplayName(car) {
  return car.brand ? car.brand + ' ' + car.name : car.name;
}

export function toKmh(metersPerSecond) {
  return Math.round(metersPerSecond * 3.6);
}

/** Seconds from standstill to 100 km/h at the car's constant acceleration. */
export function zeroToHundred(car) {
  return 100 / 3.6 / car.accel;
}
