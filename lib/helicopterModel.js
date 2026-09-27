// Procedural helicopter visual: boxy cabin + tail boom + spinning main/tail
// rotors, in the same blocky style as the box-car placeholder. Local origin
// at the skids (ground contact), nose toward -Z, matching every other rig in
// the app. Geometries/materials besides the paint color are shared module-
// level singletons, same pattern as lib/treeModel.js and lib/carModel.js.

import * as THREE from 'three';

const CABIN_WIDTH = 1.9;
const CABIN_HEIGHT = 1.5;
const CABIN_LENGTH = 3.0;
const TAIL_LENGTH = 3.4;
const TAIL_WIDTH = 0.3;
const TAIL_HEIGHT = 0.3;
const FIN_HEIGHT = 0.9;
const MAST_HEIGHT = 0.5;
const ROTOR_SPAN = 6.6;
const ROTOR_CHORD = 0.24;
const TAIL_ROTOR_SPAN = 1.0;

// Cabin floor height above the ground — also the helicopter's minimum
// altitude (see lib/helicopterVehicle.js).
export const HELICOPTER_GROUND_CLEARANCE = 0.6;

function mark(x) {
  x.userData.shared = true;
  return x;
}

let shared = null;
function sharedAssets() {
  if (!shared) {
    shared = {
      cabinGeometry: mark(new THREE.BoxGeometry(CABIN_WIDTH, CABIN_HEIGHT, CABIN_LENGTH)),
      glassGeometry: mark(new THREE.BoxGeometry(CABIN_WIDTH * 0.86, CABIN_HEIGHT * 0.55, CABIN_LENGTH * 0.42)),
      tailGeometry: mark(new THREE.BoxGeometry(TAIL_WIDTH, TAIL_HEIGHT, TAIL_LENGTH)),
      finGeometry: mark(new THREE.BoxGeometry(TAIL_WIDTH * 0.8, FIN_HEIGHT, TAIL_WIDTH * 2.2)),
      mastGeometry: mark(new THREE.CylinderGeometry(0.06, 0.06, MAST_HEIGHT, 8)),
      rotorBladeGeometry: mark(new THREE.BoxGeometry(ROTOR_CHORD, 0.04, ROTOR_SPAN)),
      hubGeometry: mark(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10)),
      tailRotorGeometry: mark(new THREE.BoxGeometry(0.05, TAIL_ROTOR_SPAN, 0.12)),
      skidGeometry: mark(new THREE.BoxGeometry(0.08, 0.08, CABIN_LENGTH * 0.9)),
      glassMaterial: mark(new THREE.MeshPhysicalMaterial({ color: '#1d2836', metalness: 0.1, roughness: 0.05, clearcoat: 1 })),
      rotorMaterial: mark(new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.6 })),
      skidMaterial: mark(new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.7 }))
    };
  }
  return shared;
}

const bodyMaterials = new Map();
function bodyMaterial(color) {
  if (!bodyMaterials.has(color)) {
    bodyMaterials.set(color, mark(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.35 })));
  }
  return bodyMaterials.get(color);
}

/**
 * A helicopter Group. `root.userData.mainRotor` / `.tailRotor` are the
 * spinning groups (see spinRotors, which expects the *wrapper* passed to
 * world.add — same convention as lib/carModel.js's setCarModel).
 */
function buildHelicopter(color) {
  const a = sharedAssets();
  const paint = bodyMaterial(color);
  const group = new THREE.Group();
  const cabinY = HELICOPTER_GROUND_CLEARANCE + CABIN_HEIGHT / 2;

  const cabin = new THREE.Mesh(a.cabinGeometry, paint);
  cabin.position.set(0, cabinY, 0);
  group.add(cabin);

  const glass = new THREE.Mesh(a.glassGeometry, a.glassMaterial);
  glass.position.set(0, cabinY + CABIN_HEIGHT * 0.12, -CABIN_LENGTH * 0.32);
  group.add(glass);

  const tailZ = CABIN_LENGTH / 2 + TAIL_LENGTH / 2 - 0.2;
  const tail = new THREE.Mesh(a.tailGeometry, paint);
  tail.position.set(0, cabinY + CABIN_HEIGHT * 0.12, tailZ);
  group.add(tail);

  const finZ = CABIN_LENGTH / 2 + TAIL_LENGTH - 0.35;
  const fin = new THREE.Mesh(a.finGeometry, paint);
  fin.position.set(0, cabinY + CABIN_HEIGHT * 0.12 + FIN_HEIGHT / 2, finZ);
  group.add(fin);

  const mast = new THREE.Mesh(a.mastGeometry, a.rotorMaterial);
  mast.position.set(0, cabinY + CABIN_HEIGHT / 2 + MAST_HEIGHT / 2, 0);
  group.add(mast);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, cabinY + CABIN_HEIGHT / 2 + MAST_HEIGHT, 0);
  mainRotor.add(new THREE.Mesh(a.hubGeometry, a.rotorMaterial));
  const bladeA = new THREE.Mesh(a.rotorBladeGeometry, a.rotorMaterial);
  const bladeB = new THREE.Mesh(a.rotorBladeGeometry, a.rotorMaterial);
  bladeB.rotation.y = Math.PI / 2;
  mainRotor.add(bladeA, bladeB);
  group.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(TAIL_WIDTH / 2 + 0.05, cabinY + CABIN_HEIGHT * 0.12, CABIN_LENGTH / 2 + TAIL_LENGTH - 0.25);
  tailRotor.add(new THREE.Mesh(a.tailRotorGeometry, a.rotorMaterial));
  group.add(tailRotor);

  const skidL = new THREE.Mesh(a.skidGeometry, a.skidMaterial);
  skidL.position.set(-CABIN_WIDTH / 2 + 0.15, 0.04, 0);
  const skidR = new THREE.Mesh(a.skidGeometry, a.skidMaterial);
  skidR.position.set(CABIN_WIDTH / 2 - 0.15, 0.04, 0);
  group.add(skidL, skidR);

  group.userData.mainRotor = mainRotor;
  group.userData.tailRotor = tailRotor;
  return group;
}

/** Gives `root` a helicopter model in `def.color`. Mirrors lib/carModel.js's setCarModel. */
export function setHelicopterModel(root, def) {
  root.add(buildHelicopter(def.color || '#c2c8cc'));
}

const MAIN_ROTOR_RATE = 18; // rad/s
const TAIL_ROTOR_RATE = 30;

/** Spins the rotors of a helicopter built by setHelicopterModel, by one frame (dt seconds). */
export function spinRotors(root, dt) {
  const heli = root.children[0];
  if (!heli) return;
  const main = heli.userData.mainRotor;
  const tail = heli.userData.tailRotor;
  if (main) main.rotation.y += MAIN_ROTOR_RATE * dt;
  if (tail) tail.rotation.x += TAIL_ROTOR_RATE * dt;
}
