// Procedural low-poly box car, built as a vehicle rig (lib/vehicleRig.js).
// Shown while a car's glTF model (lib/carModel.js) loads, and kept if it
// fails to load. Rig conventions: meters, Y up, nose toward -Z, wheels on
// y = 0.
//
// A box body has no wheel arches, so the wheels sit outboard of it: the
// body is exactly as wide as the gap between the tires' inner faces.

import * as THREE from 'three';
import { buildVehicleRig, WHEEL_CORNERS } from './vehicleRig';
import { CAR_LENGTH, CAR_WIDTH } from './constants';

const WHEEL_WIDTH = 0.28;
const OUTBOARD_GAP = 0.03; // between body side and tire

// Proportions per body style. cabinLength is a fraction of CAR_LENGTH;
// cabinZ is where the cabin is centered (fraction of length, + = rear).
const BODY_STYLES = {
  hatch: { wheelRadius: 0.34, groundClearance: 0.28, bodyHeight: 0.7, cabinHeight: 0.6, cabinLength: 0.5, cabinZ: 0.08, spoiler: false },
  coupe: { wheelRadius: 0.35, groundClearance: 0.26, bodyHeight: 0.6, cabinHeight: 0.48, cabinLength: 0.42, cabinZ: 0.06, spoiler: false },
  // Low, cab-forward, with a rear wing — generic "supercar" silhouette.
  supercar: { wheelRadius: 0.36, groundClearance: 0.22, bodyHeight: 0.5, cabinHeight: 0.4, cabinLength: 0.36, cabinZ: -0.02, spoiler: true }
};

/**
 * @param {{style?: 'hatch'|'coupe'|'supercar', color?: string}} [opts]
 */
export function buildBoxCar({ style = 'hatch', color = '#d9412b' } = {}) {
  const dims = BODY_STYLES[style] || BODY_STYLES.hatch;
  const params = {
    wheelbase: CAR_LENGTH - 1.7,
    trackWidth: CAR_WIDTH - WHEEL_WIDTH,
    wheelRadius: dims.wheelRadius,
    wheelWidth: WHEEL_WIDTH,
    groundClearance: dims.groundClearance,
    axleOffset: 0
  };
  const bodyWidth = params.trackWidth - WHEEL_WIDTH - 2 * OUTBOARD_GAP;

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.15, metalness: 0.1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#222629', roughness: 0.6 });
  const headlight = new THREE.MeshStandardMaterial({ color: '#fff6d6', emissive: '#fff1b8', emissiveIntensity: 0.8 });
  const taillight = new THREE.MeshStandardMaterial({ color: '#b3121b', emissive: '#ff2a2a', emissiveIntensity: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 });

  // Body, built with its bottom at y = 0; the rig lifts it to groundClearance.
  const body = new THREE.Group();
  const halfLen = CAR_LENGTH / 2;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth, dims.bodyHeight, CAR_LENGTH), paint);
  hull.position.y = dims.bodyHeight / 2;
  body.add(hull);

  const cabinLength = CAR_LENGTH * dims.cabinLength;
  const cabinZ = dims.cabinZ * CAR_LENGTH;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.9, dims.cabinHeight, cabinLength), glass);
  cabin.position.set(0, dims.bodyHeight + dims.cabinHeight / 2, cabinZ);
  body.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth * 0.92, 0.08, cabinLength * 0.92), paint);
  roof.position.set(0, dims.bodyHeight + dims.cabinHeight + 0.04, cabinZ);
  body.add(roof);

  if (dims.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth, 0.06, 0.4), trim);
    wing.position.set(0, dims.bodyHeight + 0.32, halfLen - 0.3);
    body.add(wing);
    [-1, 1].forEach((side) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.12), trim);
      strut.position.set((side * bodyWidth) / 3, dims.bodyHeight + 0.15, halfLen - 0.3);
      body.add(strut);
    });
  }

  const lampY = dims.bodyHeight * 0.7;
  const lampGeometry = new THREE.BoxGeometry(0.4, 0.14, 0.06);
  [-1, 1].forEach((side) => {
    const front = new THREE.Mesh(lampGeometry, headlight);
    front.position.set(side * (bodyWidth / 2 - 0.3), lampY, -halfLen - 0.02);
    body.add(front);
    const rear = new THREE.Mesh(lampGeometry, taillight);
    rear.position.set(side * (bodyWidth / 2 - 0.3), lampY, halfLen + 0.02);
    body.add(rear);
  });

  const wheelGeometry = new THREE.CylinderGeometry(dims.wheelRadius, dims.wheelRadius, WHEEL_WIDTH, 16);
  wheelGeometry.rotateZ(Math.PI / 2); // axle along X
  const wheels = Object.fromEntries(WHEEL_CORNERS.map((corner) => [corner, new THREE.Mesh(wheelGeometry, rubber)]));

  return buildVehicleRig({ body, wheels, params, label: 'placeholder ' + style });
}
