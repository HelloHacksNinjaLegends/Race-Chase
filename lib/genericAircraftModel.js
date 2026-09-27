// A plain GLTF model shown as-is — no palette recoloring, no wheel rig —
// scaled to a target length and grounded. Shared by the helicopter,
// commercial plane, and private jet real models (public/models/kenney/
// {heli,plane,pj}.glb): nothing on any of them rolls or needs per-corner
// measurement the way lib/carModel.js's cars do, so they're just loaded,
// uniformly scaled to fit the vehicle's length, and centered/grounded.
//
// NOTE: none of this has been checked in a running browser. In particular:
// - Each model's authored forward axis is assumed to be +Z (Kenney's own
//   convention), hence the 180° flip below to match this app's -Z-nose rigs.
//   If a model renders backwards, pass `flip: false` for it instead.
// - Scale is fit by matching the model's own Z-extent to `targetLength` —
//   if a model's real forward axis isn't Z, this will scale it by the wrong
//   dimension entirely. pj.glb in particular has an almost-square footprint
//   (see the .glb inspection this was built from), so it's the one most at
//   risk of actually being wider than long, or vice versa, from this guess.

import * as THREE from 'three';

const MODEL_BASE_URL = '/models/kenney/';

const templates = new Map();
const readyTemplates = new Map();

function loadTemplate(model) {
  if (!templates.has(model)) {
    const promise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(MODEL_BASE_URL + model + '.glb'))
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.userData.shared = true;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m) m.userData.shared = true;
          });
        });
        readyTemplates.set(model, gltf.scene);
        return gltf.scene;
      });
    promise.catch(() => templates.delete(model)); // allow a retry later
    templates.set(model, promise);
  }
  return templates.get(model);
}

/** A Group built from `template`, scaled so its Z-extent is `targetLength`, centered on X/Z, grounded. */
function instantiate(template, targetLength, flip) {
  const clone = template.clone(true);
  clone.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
  const scale = targetLength / (size.z || 1);

  const inner = new THREE.Group();
  inner.add(clone);
  inner.scale.setScalar(scale);
  if (flip) inner.rotation.y = Math.PI; // model faces +Z; every rig in this app faces -Z

  const wrapper = new THREE.Group();
  wrapper.add(inner);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper);
  const center = box.getCenter(new THREE.Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);

  return wrapper;
}

/**
 * Gives `root` the `model` (a public/models/kenney/*.glb basename): nothing
 * until it loads (subsequent spawns of an already-loaded model are
 * instant), then the real model scaled to `targetLength` meters and
 * grounded. Safe to call again with a new model; stale loads are dropped.
 */
export function setGenericAircraftModel(root, model, targetLength, flip = true) {
  const token = (root.userData.modelToken || 0) + 1;
  root.userData.modelToken = token;

  if (readyTemplates.has(model)) {
    replaceChildren(root, instantiate(readyTemplates.get(model), targetLength, flip));
    return;
  }
  loadTemplate(model)
    .then((template) => {
      if (root.userData.modelToken !== token) return;
      replaceChildren(root, instantiate(template, targetLength, flip));
    })
    .catch((err) => console.warn('Could not load model "' + model + '"', err));
}

/** Cancels any in-flight model load for `root` (call before disposing it). */
export function cancelGenericAircraftModel(root) {
  root.userData.modelToken = -1;
}

function replaceChildren(root, child) {
  root.children.slice().forEach((old) => {
    root.remove(old);
    disposeObject(old);
  });
  root.add(child);
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    materials.forEach((m) => {
      if (!m.userData.shared) m.dispose();
    });
  });
}
