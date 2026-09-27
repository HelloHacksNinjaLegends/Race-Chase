// A Mapbox custom layer that renders a three.js scene of positioned objects
// (player car, parked cars, the on-foot character, traffic) inside the map's
// own WebGL context.
//
// Mapbox hands render() a projection matrix for Mercator world coordinates
// (0..1 across the whole map). We append a model matrix that moves the scene
// origin to the current map center and scales meters into Mercator units,
// flipping Y (Mercator y grows southward) and rotating so three.js's Y-up
// becomes the map's Z-up. After that, model space is: +X east, -Z north,
// +Y up, in meters — and each object is placed by its meter offset from the
// map center, which keeps float precision fine at street scale.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import mapboxgl from 'mapbox-gl';

import { SCENE_LIGHTING } from './sceneLighting';

const ROTATE_Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/**
 * @param {string} id  Layer id.
 * @returns {{layer: object, add: Function, remove: Function, setLighting: Function}}
 *   add(object, state) places `object` (facing -Z) at state.lng/lat, rotated
 *   by state.heading (degrees clockwise from north), every frame; it returns
 *   a handle for remove().
 */
export function createWorldLayer(id) {
  const root = new THREE.Group();
  const entities = new Set();
  let map = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  const modelMatrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();
  let hemi = null;
  let sun = null;
  let environment = null;
  let lighting = SCENE_LIGHTING.day;

  function applyLighting() {
    if (!scene) return;
    hemi.color.set(lighting.hemiSky);
    hemi.groundColor.set(lighting.hemiGround);
    hemi.intensity = lighting.hemi;
    sun.color.set(lighting.sun);
    sun.intensity = lighting.sunIntensity;
    scene.environmentIntensity = lighting.env;
  }

  const layer = {
    id,
    type: 'custom',
    // '3d' shares Mapbox's depth buffer, so buildings correctly hide objects.
    renderingMode: '3d',
    // Mapbox Standard slot: alongside our buildings, below labels.
    slot: 'middle',

    onAdd(m, gl) {
      map = m;
      camera = new THREE.Camera();
      scene = new THREE.Scene();

      // Lights live in model space and don't rotate with objects, so lighting
      // stays fixed to the world.
      hemi = new THREE.HemisphereLight();
      scene.add(hemi);
      sun = new THREE.DirectionalLight();
      sun.position.set(-40, 80, 30);
      scene.add(sun);

      scene.add(root);

      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;

      // A neutral studio environment for reflections (paint, glass, chrome);
      // its strength follows the time of day via applyLighting().
      const pmrem = new THREE.PMREMGenerator(renderer);
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.environment = environment;
      applyLighting();
    },

    render(gl, matrix) {
      const origin = mapboxgl.MercatorCoordinate.fromLngLat(map.getCenter(), 0);
      const s = origin.meterInMercatorCoordinateUnits();

      for (const e of entities) {
        const { lng, lat, heading, altitude = 0, pitch = 0, roll = 0 } = e.state;
        const merc = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        e.object.position.set((merc.x - origin.x) / s, altitude, (merc.y - origin.y) / s);
        // Order 'YXZ': yaw (heading) first, then pitch/roll — only non-zero
        // for objects that tilt off the ground plane (falling trees, aircraft).
        e.object.rotation.set(
          THREE.MathUtils.degToRad(pitch),
          -THREE.MathUtils.degToRad(heading),
          THREE.MathUtils.degToRad(roll),
          'YXZ'
        );
      }

      modelMatrix
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(scaleVector.set(s, -s, s))
        .multiply(ROTATE_Y_UP_TO_Z_UP);
      camera.projectionMatrix.fromArray(matrix).multiply(modelMatrix);

      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      if (scene) scene.remove(root);
      if (environment) environment.dispose();
      environment = null;
      if (renderer) renderer.dispose();
      renderer = null;
      scene = null;
      camera = null;
      map = null;
    }
  };

  return {
    layer,
    add(object, state) {
      const handle = { object, state };
      entities.add(handle);
      root.add(object);
      return handle;
    },
    remove(handle) {
      if (!handle) return;
      entities.delete(handle);
      root.remove(handle.object);
    },
    /** Applies a SCENE_LIGHTING entry (see lib/sceneLighting.js). */
    setLighting(next) {
      lighting = next;
      applyLighting();
      if (map) map.triggerRepaint();
    }
  };
}
