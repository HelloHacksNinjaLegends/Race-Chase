// Car models: Kenney's "Car Kit" (CC0, public/models/kenney/License.txt),
// restyled at load time for a glossier, more realistic look.
//
// Every Kenney car uses one material over a palette texture (colormap.png)
// laid out as a grid of color swatches. We sort each model's triangles by the
// swatch they sample — paint, glass, tires, trim, chrome, head/tail lights —
// and give each part its own physically-based material: clear-coated paint
// in the car's own color, reflective glass, emissive lamps whose brightness
// follows the time of day (setLampLevel), plus soft additive glow sprites.
//
// Each car is assembled as a vehicle rig (lib/vehicleRig.js): the body and
// four wheels are separated, the wheel layout is measured from the model,
// and the wheels are placed from those named parameters. Only the cabin
// above the wheel arches is lowered (`roofScale`), so wheels always fit.
//
// Output conventions match the rest of the app: meters, Y up, nose toward
// -Z, wheels on y = 0, centered on the origin.

import * as THREE from 'three';
import { buildBoxCar } from './placeholderCar';
import { buildVehicleRig, spinRigWheels } from './vehicleRig';
import { CAR_LENGTH, CAR_WIDTH } from './constants';
import { isSvjReady, buildSvjModel, loadSvjModel } from './svjCarModel';

const MODEL_BASE_URL = '/models/kenney/';

const PARTS = ['paint', 'glass', 'trim', 'rubber', 'chrome', 'headlight', 'taillight', 'other'];

// Lamps sit within this distance (model units) of the very front / back.
const LAMP_END_ZONE = 0.35;

/** Which part a triangle belongs to, from its palette swatch (8 × 4 grid) and position. */
function partFor(u, v, z, box) {
  const row = Math.min(3, Math.floor(v * 4));
  const col = Math.min(7, Math.floor(u * 8));
  if (row === 1) return 'paint';
  if (row === 3 && col === 0) return 'glass';
  if (row === 3 && col === 1 && z > box.max.z - LAMP_END_ZONE) return 'headlight';
  if (row === 3 && col === 2 && z < box.min.z + LAMP_END_ZONE) return 'taillight';
  if (row === 2 && (col === 1 || col === 2)) return 'rubber';
  if (row === 2 && col === 3) return 'trim';
  if (row === 2 && (col === 5 || col === 6)) return 'chrome';
  return 'other';
}

// --- Shared materials (never disposed; see disposeObject) ---

function shared(material) {
  material.userData.shared = true;
  return material;
}

const LAMP_MATERIALS = {
  headlight: shared(
    new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff1c9', emissiveIntensity: 0.4, roughness: 0.2 })
  ),
  taillight: shared(
    new THREE.MeshStandardMaterial({ color: '#8a1016', emissive: '#ff2424', emissiveIntensity: 0.3, roughness: 0.3 })
  )
};

const FIXED_MATERIALS = {
  glass: shared(new THREE.MeshPhysicalMaterial({ color: '#1d2836', metalness: 0.1, roughness: 0.04, clearcoat: 1 })),
  trim: shared(new THREE.MeshStandardMaterial({ color: '#3a3d45', metalness: 0.2, roughness: 0.55 })),
  rubber: shared(new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.9 })),
  chrome: shared(new THREE.MeshStandardMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.22 })),
  ...LAMP_MATERIALS
};

let glowMaterials = null;
function getGlowMaterials() {
  if (!glowMaterials) {
    const texture = shared(radialGlowTexture());
    const make = (color) =>
      shared(
        new THREE.SpriteMaterial({
          map: texture,
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
    glowMaterials = { headlight: make('#fff0c8'), taillight: make('#ff3030') };
  }
  return glowMaterials;
}

function radialGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Sets how "on" every car's lamps are: 0 = daytime (lamps just catch the
 * light), 1 = night (headlights and taillights glow). Affects all cars.
 */
export function setLampLevel(level) {
  LAMP_MATERIALS.headlight.emissiveIntensity = 0.4 + 2.4 * level;
  LAMP_MATERIALS.taillight.emissiveIntensity = 0.3 + 1.9 * level;
  const glow = getGlowMaterials();
  glow.headlight.opacity = 0.75 * level;
  glow.taillight.opacity = 0.55 * level;
  glow.headlight.visible = glow.taillight.visible = level > 0.01;
}

// Per-color paint and per-atlas textured materials, cached.
const paintCache = new Map();
function paintMaterial(color, atlas) {
  const key = color || 'atlas:' + atlas.uuid;
  if (!paintCache.has(key)) {
    paintCache.set(
      key,
      shared(
        new THREE.MeshPhysicalMaterial({
          color: color || '#ffffff',
          map: color ? null : atlas,
          metalness: 0.5,
          roughness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.06
        })
      )
    );
  }
  return paintCache.get(key);
}
const otherCache = new Map();
function otherMaterial(atlas) {
  if (!otherCache.has(atlas)) {
    otherCache.set(atlas, shared(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6 })));
  }
  return otherCache.get(atlas);
}

// --- Templates: one processed copy of each model, cloned per car ---

const templates = new Map();
// Templates that have finished loading, for synchronous use (see setCarModel).
const readyTemplates = new Map();

function loadTemplate(model) {
  if (!templates.has(model)) {
    const promise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(MODEL_BASE_URL + model + '.glb'))
      .then((gltf) => {
        const template = prepareTemplate(gltf.scene, model);
        readyTemplates.set(model, template);
        return template;
      });
    promise.catch(() => templates.delete(model)); // allow a retry later
    templates.set(model, promise);
  }
  return templates.get(model);
}

// Kenney wheel node names for each rig corner. Other nodes (including the
// SUV's rear-mounted spare, "wheel-back") are part of the body.
const WHEEL_NODE_NAMES = {
  FL: 'wheel-front-left',
  FR: 'wheel-front-right',
  RL: 'wheel-back-left',
  RR: 'wheel-back-right'
};
// Room left above the tire before the cabin compression starts (model units).
const ARCH_MARGIN = 0.04;

/**
 * Regroups every mesh's triangles by part, records lamp positions, and
 * measures the wheel layout. Template space is Kenney's: nose toward +Z,
 * ground at y = 0, arbitrary units.
 */
function prepareTemplate(scene, model) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const lamps = { headlight: [], taillight: [] };
  let atlas = null;
  const centroid = new THREE.Vector3();

  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    atlas = atlas || obj.material.map;
    const geo = obj.geometry;
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    const count = geo.index ? geo.index.count : pos.count;
    const indexAt = geo.index ? (i) => geo.index.getX(i) : (i) => i;
    const buckets = PARTS.map(() => []);

    for (let t = 0; t < count; t += 3) {
      const a = indexAt(t);
      const b = indexAt(t + 1);
      const c = indexAt(t + 2);
      const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
      const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
      centroid
        .set(
          (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
          (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
          (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
        )
        .applyMatrix4(obj.matrixWorld);
      const part = partFor(u, v, centroid.z, box);
      buckets[PARTS.indexOf(part)].push(a, b, c);
      if (lamps[part]) lamps[part].push(centroid.clone());
    }

    const index = [];
    geo.clearGroups();
    buckets.forEach((tris, materialIndex) => {
      if (tris.length === 0) return;
      geo.addGroup(index.length, tris.length, materialIndex);
      index.push(...tris);
    });
    geo.setIndex(index);
    geo.userData.shared = true;
  });

  // Split wheels from body, and measure both.
  const wheelNodes = {};
  for (const [corner, name] of Object.entries(WHEEL_NODE_NAMES)) {
    wheelNodes[corner] = scene.children.find((node) => node.name === name);
  }
  if (Object.values(wheelNodes).some((n) => !n)) {
    throw new Error('Model "' + model + '" is missing one of ' + Object.values(WHEEL_NODE_NAMES).join(', '));
  }
  const bodyNodes = scene.children.filter((node) => !Object.values(wheelNodes).includes(node));

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
    axleMidZ: (frontZ + rearZ) / 2,
    topY: Math.max(...corners.map((c) => wheelBoxes[c].max.y))
  };

  const bodyBox = new THREE.Box3();
  bodyNodes.forEach((node) => bodyBox.expandByObject(node));

  return { model, scene, lamps, atlas, wheelNodes, bodyNodes, bodyBox, wheels, bodies: new Map() };
}

/**
 * The template's body (no wheels) with everything above the wheel arches
 * scaled vertically by `roofScale`, cached per scale. The Kenney cars are
 * toy-proportioned (tall cabins), so this lowers the roofline without
 * touching the arches — the wheels keep fitting them exactly.
 * @returns {{nodes: THREE.Object3D[], archY: number, compress: (y: number) => number}}
 */
function compressedBody(template, roofScale) {
  if (template.bodies.has(roofScale)) return template.bodies.get(roofScale);
  const archY = template.wheels.topY + ARCH_MARGIN;
  const compress = (y) => (y <= archY ? y : archY + (y - archY) * roofScale);

  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const inverseNormal = new THREE.Matrix3();

  const nodes = template.bodyNodes.map((node) => {
    const copy = node.clone(true);
    // Walk the original and the copy in parallel to reach matching meshes.
    const originals = [];
    node.traverse((o) => originals.push(o));
    let i = 0;
    copy.traverse((o) => {
      const original = originals[i++];
      if (!o.isMesh || roofScale === 1) return;
      const geo = original.geometry.clone();
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const toTemplate = original.matrixWorld;
      inverse.copy(toTemplate).invert();
      normalMatrix.getNormalMatrix(toTemplate);
      inverseNormal.getNormalMatrix(inverse);
      for (let k = 0; k < pos.count; k++) {
        p.fromBufferAttribute(pos, k).applyMatrix4(toTemplate);
        if (p.y <= archY) continue;
        p.y = compress(p.y);
        p.applyMatrix4(inverse);
        pos.setXYZ(k, p.x, p.y, p.z);
        if (nor) {
          // Normals transform by the inverse transpose of diag(1, s, 1).
          n.fromBufferAttribute(nor, k).applyMatrix3(normalMatrix);
          n.y /= roofScale;
          n.normalize().applyMatrix3(inverseNormal).normalize();
          nor.setXYZ(k, n.x, n.y, n.z);
        }
      }
      // clone() copied the original's cached bounds; they're stale now.
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      geo.userData.shared = true;
      o.geometry = geo;
    });
    return copy;
  });

  const result = { nodes, archY, compress };
  template.bodies.set(roofScale, result);
  return result;
}

/**
 * Builds a car from a processed template, as a vehicle rig (lib/vehicleRig.js).
 * Length is fitted to CAR_LENGTH (uniformly in the side profile, so wheels
 * and arches stay round) and width to CAR_WIDTH; `roofScale` lowers the
 * cabin; `rig` can override any measured rig parameter.
 */
function instantiate(template, { color, roofScale = 1, rig: rigOverrides, model }) {
  const materials = PARTS.map((part) =>
    part === 'paint' ? paintMaterial(color, template.atlas) : part === 'other' ? otherMaterial(template.atlas) : FIXED_MATERIALS[part]
  );
  const withMaterials = (obj) => {
    obj.traverse((o) => {
      if (o.isMesh) o.material = materials;
    });
    return obj;
  };

  const bodySize = template.bodyBox.getSize(new THREE.Vector3());
  const bodyCenter = template.bodyBox.getCenter(new THREE.Vector3());
  const s = CAR_LENGTH / bodySize.z; // side profile (Y and Z)
  const sx = CAR_WIDTH / bodySize.x; // width

  // Body: Kenney faces +Z, rigs face -Z.
  const { nodes, compress } = compressedBody(template, roofScale);
  const body = new THREE.Group();
  nodes.forEach((node) => body.add(withMaterials(node.clone(true))));
  body.scale.set(sx, s, s);
  body.rotation.y = Math.PI;

  // Wheels, each re-centered on its own origin.
  const wheels = {};
  for (const [corner, node] of Object.entries(template.wheelNodes)) {
    const wheel = withMaterials(node.clone(true));
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
    // Template +Z is the nose; rig -Z is.
    axleOffset: -(w.axleMidZ - bodyCenter.z) * s,
    ...rigOverrides
  };

  const label =
    (model || template.model) + ' @ roofScale ' + roofScale + (rigOverrides ? ' ' + JSON.stringify(rigOverrides) : '');
  const car = buildVehicleRig({ body, wheels, params, label });

  // Glows at the left/right lamp clusters (lamp positions follow the body's compression).
  const glow = getGlowMaterials();
  car.updateMatrixWorld(true);
  const toRig = new THREE.Matrix4().copy(car.matrixWorld).invert().multiply(body.matrixWorld);
  [
    ['headlight', 1.3],
    ['taillight', 0.9]
  ].forEach(([part, spriteSize]) => {
    [-1, 1].forEach((side) => {
      const points = template.lamps[part].filter((pt) => Math.sign(pt.x || 1) === side);
      if (points.length === 0) return;
      const mid = points.reduce((acc, pt) => acc.add(pt), new THREE.Vector3()).divideScalar(points.length);
      mid.y = compress(mid.y);
      mid.applyMatrix4(toRig);
      const sprite = new THREE.Sprite(glow[part]);
      sprite.position.copy(mid);
      sprite.scale.setScalar(spriteSize);
      car.add(sprite);
    });
  });

  return car;
}

/**
 * Gives `root` the model for `def` ({model, color, roofScale, rig, style}):
 * the box-car placeholder immediately, then the real model once loaded.
 * Safe to call again with a new def; stale loads are dropped.
 * @param {() => void} [onChange]  Called whenever the visible model changes.
 */
export function setCarModel(root, def, onChange = () => {}) {
  const token = (root.userData.modelToken || 0) + 1;
  root.userData.modelToken = token;

  // "svj" isn't a Kenney model — a real (non-palette) Lamborghini asset with
  // its own loader; see lib/svjCarModel.js.
  if (def.model === 'svj') {
    if (isSvjReady()) {
      replaceChildren(root, buildSvjModel());
      onChange();
      return;
    }
    replaceChildren(root, buildBoxCar({ style: def.style, color: def.color || '#e8c547' }));
    onChange();
    loadSvjModel()
      .then((rig) => {
        if (root.userData.modelToken !== token) return;
        replaceChildren(root, rig);
        onChange();
      })
      .catch((err) => console.warn('Could not load svj.glb, keeping the placeholder.', err));
    return;
  }

  // Already loaded (e.g. every NPC after the first of its kind): build it now,
  // without creating and uploading a placeholder that's replaced a moment later.
  if (def.model && readyTemplates.has(def.model)) {
    replaceChildren(root, instantiate(readyTemplates.get(def.model), def));
    onChange();
    return;
  }

  replaceChildren(root, buildBoxCar({ style: def.style, color: def.color || '#e8c547' }));
  onChange();

  if (!def.model) return;
  loadTemplate(def.model)
    .then((template) => {
      if (root.userData.modelToken !== token) return;
      replaceChildren(root, instantiate(template, def));
      onChange();
    })
    .catch((err) => {
      console.warn('Could not load car model "' + def.model + '", keeping the placeholder.', err);
    });
}

/** Cancels any in-flight model load for `root` (call before disposing it). */
export function cancelCarModel(root) {
  root.userData.modelToken = -1;
}

/** Rolls the wheels of a car built by setCarModel by `meters` (negative = reversing). */
export function spinWheels(root, meters) {
  const car = root.children[0];
  if (car) spinRigWheels(car, meters);
}

function replaceChildren(root, child) {
  root.children.slice().forEach((old) => {
    root.remove(old);
    disposeObject(old);
  });
  root.add(child);
}

/** Frees GPU resources held by a model's own geometries and materials (shared ones are kept). */
export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    materials.forEach((m) => {
      if (!m.userData.shared) m.dispose();
    });
  });
}
