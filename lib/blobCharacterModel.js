// The on-foot character: a friendly low-poly blob. Same conventions as the
// car models: meters, Y up, facing -Z, resting on y = 0.
//
// No skeleton — the walk is procedural: a bouncy squash-and-stretch, a
// slight side-to-side waddle, and two little feet that step in turn
// (poseBlobCharacter).

import * as THREE from 'three';

export const BLOB_HEIGHT_M = 1.2;
// Eye level, for the first-person camera (lib/constants.js WALK_POV_EYE_HEIGHT_M).
export const BLOB_EYE_HEIGHT_M = 0.95;

const BODY_RADIUS = 0.45;
const BODY_COLOR = '#6fcf97';
const FOOT_COLOR = '#3f9e6d';

export function buildBlobCharacter() {
  const root = new THREE.Group();

  // Everything that squashes lives under `body`, scaled from the ground up.
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, flatShading: true });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(BODY_RADIUS, 2), skin);
  // A slightly tall, bottom-heavy drop shape.
  blob.scale.set(1, BLOB_HEIGHT_M / (2 * BODY_RADIUS) - 0.05, 1);
  blob.position.y = BODY_RADIUS * blob.scale.y + 0.06;
  body.add(blob);

  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#1d2230', roughness: 0.2 });
  const cheek = new THREE.MeshStandardMaterial({ color: '#ff9fb0', roughness: 0.8 });
  const eyeY = BLOB_EYE_HEIGHT_M;
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), white);
    eye.position.set(side * 0.15, eyeY, -0.37);
    eye.scale.set(1, 1.2, 0.6);
    body.add(eye);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), pupil);
    dot.position.set(side * 0.15, eyeY - 0.01, -0.42);
    body.add(dot);
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), cheek);
    blush.position.set(side * 0.27, eyeY - 0.13, -0.3);
    blush.scale.set(1, 0.6, 0.4);
    body.add(blush);
  });

  // Feet stay on the ground (not under `body`), so squashing doesn't sink them.
  const footMaterial = new THREE.MeshStandardMaterial({ color: FOOT_COLOR, roughness: 0.7, flatShading: true });
  const feet = [-1, 1].map((side) => {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), footMaterial);
    foot.scale.set(1, 0.5, 1.4);
    foot.position.set(side * 0.18, 0.05, -0.05);
    root.add(foot);
    return foot;
  });

  root.userData.blob = { body, feet };
  return root;
}

/**
 * Poses the walk cycle.
 * @param {number} phase   Radians; advances with distance walked.
 * @param {number} amount  0 (standing) .. 1 (full stride).
 */
export function poseBlobCharacter(character, phase, amount) {
  const { body, feet } = character.userData.blob;
  // Two bounces per stride (one per step): stretch on the way up, squash on landing.
  const bounce = Math.abs(Math.sin(phase));
  const stretch = 1 + (bounce - 0.5) * 0.12 * amount;
  body.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
  body.position.y = bounce * 0.06 * amount;
  body.rotation.z = Math.sin(phase) * 0.08 * amount; // waddle
  // Feet alternate: forward/back and lifted on the forward swing.
  feet.forEach((foot, i) => {
    const s = Math.sin(phase + i * Math.PI);
    foot.position.z = -0.05 - s * 0.14 * amount;
    foot.position.y = 0.05 + Math.max(0, s) * 0.06 * amount;
  });
}
