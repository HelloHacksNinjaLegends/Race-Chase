// Vehicle rig: one parent object holding a car body and four wheel pivots,
// placed from named parameters instead of per-model offsets.
//
// Rig space matches the rest of the app: meters, Y up, nose toward -Z,
// driver's side (left) toward -X, ground at y = 0, origin at the body's
// horizontal center.
//
//   root
//   ├── bodyMount      (the body, lowest point at groundClearance)
//   └── wheel pivots   (FL, FR, RL, RR — each spins about its X axle)
//         └── wheel    (centered on the pivot)
//
// Parameters (meters):
//   wheelbase        front-to-rear axle distance
//   trackWidth       left-to-right wheel center distance
//   wheelRadius      tire radius (wheel centers sit at this height)
//   wheelWidth       tire width, along the axle
//   groundClearance  height of the body's lowest point above the ground
//   axleOffset       where the axles' midpoint sits along Z, relative to the
//                    body's center (negative = toward the nose)
//
// On construction the rig checks that no body vertex lies inside any
// wheel's volume and logs a console warning naming the wheel if one does.

import * as THREE from 'three';

export const WHEEL_CORNERS = ['FL', 'FR', 'RL', 'RR'];

// Tolerances for the overlap check, so vertices that merely touch a tire's
// surface (wheel-arch lips) don't count as clipping.
const RADIUS_TOLERANCE = 0.97;
const WIDTH_TOLERANCE = 0.95;
// Each label (model + configuration) is validated once: NPC traffic builds
// the same rigs over and over, and the result can't change between builds.
const validatedLabels = new Set();

/** Wheel center for a corner, in rig space. */
export function wheelPosition(corner, params) {
  const side = corner[1] === 'L' ? -1 : 1;
  const front = corner[0] === 'F';
  const z = params.axleOffset + (front ? -params.wheelbase / 2 : params.wheelbase / 2);
  return new THREE.Vector3((side * params.trackWidth) / 2, params.wheelRadius, z);
}

/**
 * @param {object} opts
 * @param {THREE.Object3D} opts.body     Body without wheels, already in rig orientation and scale.
 * @param {{FL, FR, RL, RR}} opts.wheels Wheel objects, each centered on its own origin, axle along X.
 * @param {object} opts.params           See the parameter list above.
 * @param {string} [opts.label]          Name used in warnings.
 * @param {boolean} [opts.validate=true]
 * @returns {THREE.Group}  root, with userData.rig = { params, pivots, angle, overlaps }
 */
export function buildVehicleRig({ body, wheels, params, label = 'car', validate = true }) {
  const root = new THREE.Group();
  root.name = 'vehicle-rig';

  // Body: centered horizontally, lowest point at groundClearance.
  const bodyMount = new THREE.Group();
  bodyMount.name = 'body';
  bodyMount.add(body);
  root.add(bodyMount);
  root.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(bodyMount);
  const bodyCenter = bodyBox.getCenter(new THREE.Vector3());
  bodyMount.position.set(-bodyCenter.x, params.groundClearance - bodyBox.min.y, -bodyCenter.z);

  const pivots = {};
  for (const corner of WHEEL_CORNERS) {
    const pivot = new THREE.Group();
    pivot.name = 'wheel-' + corner;
    pivot.position.copy(wheelPosition(corner, params));
    pivot.add(wheels[corner]);
    root.add(pivot);
    pivots[corner] = pivot;
  }
  root.updateMatrixWorld(true);

  const shouldValidate = validate && !validatedLabels.has(label);
  if (shouldValidate) validatedLabels.add(label);
  const overlaps = shouldValidate ? findWheelOverlaps(bodyMount, params, root) : [];
  if (overlaps.length > 0) {
    console.warn(
      '[vehicle-rig] "' + label + '": body geometry intersects the wheels — ' +
        overlaps.map((o) => o.corner + ' (' + o.vertices + ' vertices, up to ' + Math.round(o.depth * 100) + ' cm deep)').join(', ') +
        '. Check wheelRadius / groundClearance / body scale.',
      params
    );
  }

  root.userData.rig = { params, pivots, angle: 0, overlaps };
  return root;
}

/**
 * Body vertices (rig space) that fall inside each wheel's cylinder.
 * @returns {{corner: string, vertices: number, depth: number}[]}
 */
export function findWheelOverlaps(bodyMount, params, root) {
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRig = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const centers = WHEEL_CORNERS.map((corner) => [corner, wheelPosition(corner, params)]);
  const radius = params.wheelRadius * RADIUS_TOLERANCE;
  const halfWidth = (params.wheelWidth / 2) * WIDTH_TOLERANCE;
  const found = {};

  bodyMount.traverse((obj) => {
    if (!obj.isMesh) return;
    toRig.multiplyMatrices(inverseRoot, obj.matrixWorld);
    const pos = obj.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRig);
      for (const [corner, c] of centers) {
        if (Math.abs(v.x - c.x) >= halfWidth) continue;
        const d = Math.hypot(v.y - c.y, v.z - c.z);
        if (d >= radius) continue;
        const entry = found[corner] || (found[corner] = { corner, vertices: 0, depth: 0 });
        entry.vertices++;
        entry.depth = Math.max(entry.depth, params.wheelRadius - d);
      }
    }
  });
  return Object.values(found);
}

/** Rolls a rig's wheels by `meters` of travel (negative = reversing). */
export function spinRigWheels(root, meters) {
  const rig = root.userData.rig;
  if (!rig || !meters) return;
  // Rolling toward the nose (-Z) turns the wheel tops forward: negative about +X.
  rig.angle = (rig.angle - meters / rig.params.wheelRadius) % (Math.PI * 2);
  for (const corner of WHEEL_CORNERS) rig.pivots[corner].rotation.x = rig.angle;
}
