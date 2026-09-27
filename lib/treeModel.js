// Procedural tree visual: a trunk cylinder + a canopy cone, local origin at
// the base (matches the ground-plane convention lib/worldLayer.js expects).
// Geometries and materials are created once and shared across every tree
// instance, so placing dozens of them is cheap even before the instanced-mesh
// pass (see the render-optimization step).

import * as THREE from 'three';

const TRUNK_RADIUS = 0.18;
const TRUNK_HEIGHT = 2.4;
const CANOPY_RADIUS = 1.6;
const CANOPY_HEIGHT = 3.2;

export const TREE_TRUNK_RADIUS = TRUNK_RADIUS;
export const TREE_TOTAL_HEIGHT = TRUNK_HEIGHT + CANOPY_HEIGHT;

let shared = null;
function sharedAssets() {
  if (!shared) {
    const trunkGeometry = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.7, TRUNK_RADIUS, TRUNK_HEIGHT, 7);
    trunkGeometry.translate(0, TRUNK_HEIGHT / 2, 0);
    const canopyGeometry = new THREE.ConeGeometry(CANOPY_RADIUS, CANOPY_HEIGHT, 8);
    canopyGeometry.translate(0, TRUNK_HEIGHT + CANOPY_HEIGHT / 2 - 0.3, 0);
    shared = {
      trunkGeometry,
      canopyGeometry,
      trunkMaterial: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 }),
      canopyMaterial: new THREE.MeshStandardMaterial({ color: 0x3c7a3d, roughness: 0.9 })
    };
  }
  return shared;
}

/** A single tree as a real Mesh Group — used only for the handful that are
 * currently falling/fallen (they need a per-instance pitch/roll updated every
 * frame); standing trees use buildTreeInstances/setTreeInstance instead, so
 * dozens of them cost 2 draw calls total instead of 2 each. */
export function buildTreeObject() {
  const { trunkGeometry, canopyGeometry, trunkMaterial, canopyMaterial } = sharedAssets();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(trunkGeometry, trunkMaterial), new THREE.Mesh(canopyGeometry, canopyMaterial));
  return group;
}

/** One InstancedMesh each for the trunk/canopy of every standing tree. */
export function buildTreeInstances(count) {
  const { trunkGeometry, canopyGeometry, trunkMaterial, canopyMaterial } = sharedAssets();
  return {
    trunk: new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count),
    canopy: new THREE.InstancedMesh(canopyGeometry, canopyMaterial, count)
  };
}

const scratchMatrix = new THREE.Matrix4();

/** Places standing tree instance `i` at local (x, z) — matches lib/worldLayer.js's "+X east, -Z north". */
export function setTreeInstance(instances, i, x, z) {
  scratchMatrix.makeTranslation(x, 0, z);
  instances.trunk.setMatrixAt(i, scratchMatrix);
  instances.canopy.setMatrixAt(i, scratchMatrix);
}

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** Hides instance `i` (called once, when that tree topples and becomes a real falling Mesh instead). */
export function hideTreeInstance(instances, i) {
  instances.trunk.setMatrixAt(i, HIDDEN_MATRIX);
  instances.canopy.setMatrixAt(i, HIDDEN_MATRIX);
}
