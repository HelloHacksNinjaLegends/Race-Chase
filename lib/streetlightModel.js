// Procedural streetlight: pole + arm + lamp head, entirely static (no
// per-instance animation), so every streetlight is one instance in three
// shared InstancedMeshes (pole/arm/head) rather than its own Mesh Group —
// hundreds of poles cost 3 draw calls total instead of 3 each. The lamp
// head's emissive brightness follows the day/night cycle via
// setStreetlightLevel, the same 0 (day) .. 1 (night) `lamps` value
// lib/carModel.js's setLampLevel already uses for headlights.

import * as THREE from 'three';

const POLE_HEIGHT = 6.5;
const POLE_RADIUS = 0.09;
const ARM_LENGTH = 1.6;
const ARM_HEIGHT = POLE_HEIGHT - 0.3;
const HEAD_SIZE = 0.32;

function mark(x) {
  x.userData.shared = true;
  return x;
}

let shared = null;
function sharedAssets() {
  if (!shared) {
    shared = {
      poleGeometry: mark(new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS * 1.3, POLE_HEIGHT, 8)),
      armGeometry: mark(new THREE.CylinderGeometry(POLE_RADIUS * 0.7, POLE_RADIUS * 0.7, ARM_LENGTH, 6)),
      headGeometry: mark(new THREE.SphereGeometry(HEAD_SIZE, 10, 8)),
      poleMaterial: mark(new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.6, metalness: 0.3 })),
      lampMaterial: mark(
        new THREE.MeshStandardMaterial({ color: '#fff3cf', emissive: '#fff3cf', emissiveIntensity: 0, roughness: 0.4 })
      )
    };
  }
  return shared;
}

/** One InstancedMesh each for the pole/arm/head of every streetlight, up to `count`. */
export function buildStreetlightInstances(count) {
  const a = sharedAssets();
  return {
    pole: new THREE.InstancedMesh(a.poleGeometry, a.poleMaterial, count),
    arm: new THREE.InstancedMesh(a.armGeometry, a.poleMaterial, count),
    head: new THREE.InstancedMesh(a.headGeometry, a.lampMaterial, count)
  };
}

// Reused scratch objects — setStreetlightInstance only runs at placement
// time (never per frame), but there's no reason to allocate fresh each call.
const dummy = new THREE.Object3D();
const partOffset = new THREE.Object3D();
const partMatrix = new THREE.Matrix4();

/**
 * Places instance `i`'s pole/arm/head at local (x, z), facing `headingDeg`
 * (degrees clockwise from north) — matches lib/worldLayer.js's "+X east,
 * -Z north" convention and its `rotation.y = -heading`.
 */
export function setStreetlightInstance(instances, i, x, z, headingDeg) {
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, -THREE.MathUtils.degToRad(headingDeg), 0);
  dummy.updateMatrix();

  partOffset.position.set(0, POLE_HEIGHT / 2, 0);
  partOffset.rotation.set(0, 0, 0);
  partOffset.updateMatrix();
  instances.pole.setMatrixAt(i, partMatrix.multiplyMatrices(dummy.matrix, partOffset.matrix));

  // Cylinder's default axis is Y; rotating 90° about X lays it along Z, so
  // the arm reaches from the pole (z=0) out to the lamp head at z=-ARM_LENGTH.
  partOffset.position.set(0, ARM_HEIGHT, -ARM_LENGTH / 2);
  partOffset.rotation.set(Math.PI / 2, 0, 0);
  partOffset.updateMatrix();
  instances.arm.setMatrixAt(i, partMatrix.multiplyMatrices(dummy.matrix, partOffset.matrix));

  partOffset.position.set(0, ARM_HEIGHT - 0.15, -ARM_LENGTH);
  partOffset.rotation.set(0, 0, 0);
  partOffset.updateMatrix();
  instances.head.setMatrixAt(i, partMatrix.multiplyMatrices(dummy.matrix, partOffset.matrix));
}

/** 0 (day) .. 1 (night) — the same `lamps` value lib/carModel.js's setLampLevel takes. */
export function setStreetlightLevel(level) {
  sharedAssets().lampMaterial.emissiveIntensity = level * 1.8;
}
