// One third-person camera, shared by all four player modes (on foot, car,
// helicopter, airplane). Distance from the subject is fixed per mode — no
// zoom in/out at all.
//
// - On foot: free-look. Click-and-drag orbits yaw/pitch 360° around the
//   character — the cursor stays visible on screen the whole time, no
//   pointer lock (see components/CarDriving.jsx). Pitch is clamped so it
//   can't flip over the top or dip below the ground.
// - In any vehicle (car/helicopter/airplane): free-look is ignored and the
//   camera locks directly behind the vehicle's current heading instead — a
//   plain chase cam, no manual control while driving/flying.
//
// Mapbox's camera is described by center/zoom/pitch/bearing, which always
// pivots around a point at ground level (elevation 0). To orbit around a
// point above that (a walking eye height, a car roof, an aircraft's
// altitude), we solve for the (distance, pitch) pair — measured from that
// ground-level pivot — that reproduces the same camera height and ground
// offset as truly orbiting at `extraHeight` above it (see elevate()). This
// reprojection breaks down once altitude gets large relative to the fixed
// follow distance (the airplane/private jet climbing far outstrips it),
// collapsing the pitch so the camera stops looking like it's rising with
// it — config.trueAltitude (set only on AIRPLANE_ORBIT_CAMERA, see
// lib/constants.js) switches that one mode to Mapbox's free-camera API
// instead: a real 3D position + look-at, immune to that breakdown. Every
// other mode keeps the plain elevate()/jumpTo approach unchanged.

import mapboxgl from 'mapbox-gl';
import { clamp, normalizeDegrees } from './mathUtils';
import { offsetLngLat } from './buildingCollision';

const MAPBOX_FOV = 0.6435011087932844;
const TILE_SIZE = 512;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Zoom at which the Mapbox camera sits `distanceM` meters from `center`. */
function zoomForDistance(map, lat, distanceM) {
  const cameraToCenterPx = (0.5 / Math.tan(MAPBOX_FOV / 2)) * map.getCanvas().clientHeight;
  const metersPerPixelAtZ0 = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / TILE_SIZE;
  return Math.log2((cameraToCenterPx * metersPerPixelAtZ0) / distanceM);
}

/**
 * Re-expresses an orbit of `distance` meters at `pitchDeg` (above the
 * horizon) around a point `extraHeight` meters above Mapbox's ground-level
 * pivot, as an equivalent (distance, pitch) pair measured from that pivot —
 * same camera height and ground offset, extraHeight folded into the height.
 */
function elevate(distance, pitchDeg, extraHeight) {
  if (extraHeight === 0) return { distance, pitch: pitchDeg };
  const rad = (pitchDeg * Math.PI) / 180;
  const horizontal = distance * Math.cos(rad);
  const vertical = distance * Math.sin(rad) + extraHeight;
  return { distance: Math.hypot(horizontal, vertical), pitch: (Math.atan2(vertical, horizontal) * 180) / Math.PI };
}

/**
 * @param {mapboxgl.Map} map
 * @param {{lng, lat, heading}} target  Initial target.
 * @param {object} config  {distance, defaultPitch, eyeHeight}.
 * @param {number} minPitchDeg  @param {number} maxPitchDeg  Pitch clamp range, shared across modes.
 */
export function createOrbitCamera(map, target, config, minPitchDeg, maxPitchDeg) {
  let yaw = target.heading;
  let pitch = config.defaultPitch;
  let locked = false; // set each frame by update() — true in a vehicle: ignores orbit(), forces behind-heading

  function apply(t) {
    const extraHeight = (t.altitude || 0) + config.eyeHeight;
    const { distance: d, pitch: p } = elevate(config.distance, pitch, extraHeight);
    return {
      center: [t.lng, t.lat],
      zoom: zoomForDistance(map, t.lat, d),
      pitch: clamp(90 - p, 0, 85),
      bearing: yaw
    };
  }

  /** True per-frame 3D camera (config.trueAltitude modes only) — see this file's header. */
  function applyFreeCamera(t) {
    const focusAltitude = (t.altitude || 0) + config.eyeHeight;
    const pitchRad = (pitch * Math.PI) / 180;
    const horizontalDist = config.distance * Math.cos(pitchRad);
    const camAltitude = focusAltitude + config.distance * Math.sin(pitchRad);
    // Behind the target: the opposite compass direction from its heading/yaw.
    const [camLng, camLat] = offsetLngLat(t.lng, t.lat, yaw + 180, horizontalDist);

    const camera = map.getFreeCameraOptions();
    camera.position = mapboxgl.MercatorCoordinate.fromLngLat([camLng, camLat], camAltitude);
    camera.lookAtPoint([t.lng, t.lat], undefined, focusAltitude);
    return camera;
  }

  return {
    /** Camera options for easing in from wherever the map currently is. */
    introOptions() {
      return apply(target);
    },

    /** Mouse-look orbit: dx/dy in pixels. No-op while locked (see update()'s isInVehicle). */
    orbit(dx, dy, yawSensitivity, pitchSensitivity) {
      if (locked) return;
      yaw = normalizeDegrees(yaw + dx * yawSensitivity);
      // Reversed: dragging the mouse up moves the camera down (and vice
      // versa), rather than the more common "look up when mouse moves up".
      pitch = clamp(pitch + dy * pitchSensitivity, minPitchDeg, maxPitchDeg);
    },

    /** Switches per-mode config (e.g. getting in/out of a vehicle), clamping pitch into range. */
    setConfig(nextConfig) {
      config = nextConfig;
      pitch = clamp(pitch, minPitchDeg, maxPitchDeg);
    },

    /** The camera's current compass yaw — for resolving on-foot movement to a world heading. */
    get yaw() {
      return yaw;
    },

    /**
     * Moves the map camera for this frame.
     * @param {boolean} isInVehicle  True while driving/flying: free-look is ignored and the camera
     *        locks directly behind the subject's heading; false (on foot) leaves free-look in effect.
     */
    update(nextTarget, isInVehicle) {
      locked = isInVehicle;
      if (locked) {
        yaw = normalizeDegrees(nextTarget.heading);
        pitch = config.defaultPitch;
      }
      if (config.trueAltitude) {
        map.setFreeCameraOptions(applyFreeCamera(nextTarget));
      } else {
        map.jumpTo(apply(nextTarget));
      }
    }
  };
}
