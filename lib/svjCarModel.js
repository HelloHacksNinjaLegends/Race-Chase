// The Lamborghini Aventador SVJ model (public/models/kenney/svj.glb) — a
// separate, non-Kenney asset: its own baked paint texture (not a palette to
// recolor the way lib/carModel.js repaints Kenney cars), and its own node
// names (Lamborghini_Aventador_Body/Glass/Wheel_FL/FR/RL/RR, not Kenney's
// wheel-front-left etc.). Used for the "lamborghini" catalog entry in place
// of the shared Kenney sedan-sports placeholder every other supercar entry
// still uses. Assembled as a vehicle rig (lib/vehicleRig.js) exactly like
// lib/carModel.js's Kenney cars, just measured from this model's own wheel
// nodes — real wheelbase/track/radius numbers read from the .glb itself,
// not guessed. Unverified in a running browser: if it looks off (floating,
// sunk, wheels not centered in the arches), this is the file to retune —
// the fallback (buildBoxCar) placeholder shows immediately either way, so a
// bad load never leaves nothing visible.

import * as THREE from 'three';
import { buildVehicleRig } from './vehicleRig';
import { CAR_LENGTH, CAR_WIDTH } from './constants';

const MODEL_URL = '/models/kenney/svj.glb';

const WHEEL_NODE_NAMES = {
  FL: 'Lamborghini_Aventador_Wheel_FL',
  FR: 'Lamborghini_Aventador_Wheel_FR',
  RL: 'Lamborghini_Aventador_Wheel_RL',
  RR: 'Lamborghini_Aventador_Wheel_RR'
};

let templatePromise = null;
let readyTemplate = null;

function prepareTemplate(scene) {
  scene.updateMatrixWorld(true);
  const wheelNodes = {};
  for (const [corner, name] of Object.entries(WHEEL_NODE_NAMES)) {
    wheelNodes[corner] = scene.children.find((n) => n.name === name);
  }
  if (Object.values(wheelNodes).some((n) => !n)) {
    throw new Error('svj.glb is missing one of ' + Object.values(WHEEL_NODE_NAMES).join(', '));
  }
  const bodyNodes = scene.children.filter((n) => !Object.values(wheelNodes).includes(n));
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.userData.shared = true;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m) m.userData.shared = true;
    });
  });

  const wheelBoxes = Object.fromEntries(
    Object.entries(wheelNodes).map(([corner, node]) => [corner, new THREE.Box3().setFromObject(node)])
  );
  const centerOf = (corner) => wheelBoxes[corner].getCenter(new THREE.Vector3());
  const sizeOf = (corner) => wheelBoxes[corner].getSize(new THREE.Vector3());
  const frontZ = (centerOf('FL').z + centerOf('FR').z) / 2;
  const rearZ = (centerOf('RL').z + centerOf('RR').z) / 2;
  const corners = Object.keys(WHEEL_NODE_NAMES);
  const wheels = {
    wheelbase: Math.abs(frontZ - rearZ),
    trackWidth: corners.reduce((sum, c) => sum + Math.abs(centerOf(c).x), 0) / 2,
    radius: corners.reduce((sum, c) => sum + sizeOf(c).y / 2, 0) / 4,
    width: corners.reduce((sum, c) => sum + sizeOf(c).x, 0) / 4,
    axleMidZ: (frontZ + rearZ) / 2
  };

  const bodyBox = new THREE.Box3();
  bodyNodes.forEach((n) => bodyBox.expandByObject(n));

  const sizeFields = ['wheelbase', 'trackWidth', 'radius', 'width'];
  const badWheelNumber = sizeFields.some((k) => !Number.isFinite(wheels[k]) || wheels[k] <= 0);
  if (badWheelNumber || bodyBox.isEmpty()) {
    throw new Error('svj.glb measured to degenerate wheel/body geometry: ' + JSON.stringify(wheels));
  }

  return { wheelNodes, bodyNodes, bodyBox, wheels };
}

function loadTemplate() {
  if (!templatePromise) {
    templatePromise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(MODEL_URL))
      .then((gltf) => {
        const template = prepareTemplate(gltf.scene);
        readyTemplate = template;
        return template;
      });
    templatePromise.catch(() => {
      templatePromise = null; // allow a retry later
    });
  }
  return templatePromise;
}

/**
 * Builds the SVJ as a vehicle rig, fit to the same CAR_LENGTH/CAR_WIDTH
 * every other car uses (so its collision footprint — lib/vehicle.js's
 * pointInVehicle — stays consistent with the rest of the fleet).
 */
function instantiate(template) {
  const bodySize = template.bodyBox.getSize(new THREE.Vector3());
  const bodyCenter = template.bodyBox.getCenter(new THREE.Vector3());
  const s = CAR_LENGTH / bodySize.z; // side profile (Y and Z)
  const sx = CAR_WIDTH / bodySize.x; // width

  // Fail loudly (and fall back to the placeholder — see setCarModel) rather
  // than silently render something invisible or absurdly mis-scaled if the
  // model's geometry doesn't measure the way this file assumes.
  if (!Number.isFinite(s) || !Number.isFinite(sx) || s <= 0 || sx <= 0) {
    throw new Error(
      'svj.glb measured to a degenerate scale (bodySize=' + JSON.stringify(bodySize) + ', s=' + s + ', sx=' + sx + ')'
    );
  }

  // Body: this model faces +Z like Kenney's; the rig faces -Z.
  const body = new THREE.Group();
  template.bodyNodes.forEach((n) => body.add(n.clone(true)));
  body.scale.set(sx, s, s);
  body.rotation.y = Math.PI;

  const wheels = {};
  for (const [corner, node] of Object.entries(template.wheelNodes)) {
    const wheel = node.clone(true);
    wheel.position.set(0, 0, 0);
    const mount = new THREE.Group();
    mount.add(wheel);
    mount.scale.set(sx, s, s);
    mount.rotation.y = Math.PI;
    mount.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    mount.position.copy(center).negate();
    holder.add(mount);
    wheels[corner] = holder;
  }

  const w = template.wheels;
  const params = {
    wheelbase: w.wheelbase * s,
    trackWidth: w.trackWidth * sx,
    wheelRadius: w.radius * s,
    wheelWidth: w.width * sx,
    groundClearance: template.bodyBox.min.y * s,
    axleOffset: -(w.axleMidZ - bodyCenter.z) * s
  };

  return buildVehicleRig({ body, wheels, params, label: 'svj' });
}

/** True once the SVJ model has finished loading (for setCarModel's placeholder-vs-real check). */
export function isSvjReady() {
  return readyTemplate != null;
}

/** Builds the SVJ rig synchronously — only valid after isSvjReady() is true. */
export function buildSvjModel() {
  return instantiate(readyTemplate);
}

/** Starts (or reuses) the SVJ model load; resolves with a built rig. */
export function loadSvjModel() {
  return loadTemplate().then(instantiate);
}
