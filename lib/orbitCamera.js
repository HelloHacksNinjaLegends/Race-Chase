// One GTA-style orbit-follow camera, shared by all three player modes (on
// foot, driving, flying) — replaces the old separate chase/POV cameras.
//
// The camera always looks at the target from a free (yaw, pitch, distance)
// offset: dragging the mouse orbits yaw/pitch with no auto-snap-back to
// "behind" the target, and the scroll wheel sets the distance. It never
// drives which way the target moves — see the on-foot exception in
// lib/character.js / components/CarDriving.jsx, where WASD is resolved
// against the camera's yaw before being turned into a moveHeading.
//
// Mapbox's camera is described by center/zoom/pitch/bearing, which always
// pivots around a point at ground level (elevation 0). To orbit around a
// point above that (a walking eye height, a car roof, a helicopter's
// altitude), we solve for the (distance, pitch) pair — measured from that
// ground-level pivot — that reproduces the same camera height and ground
// offset as truly orbiting at `extraHeight` above it (see elevate()).

import { clamp, normalizeDegrees } from './mathUtils';

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
 * @param {object} config  {minDistance, maxDistance, defaultDistance, defaultPitch, eyeHeight}.
 * @param {number} minPitchDeg  @param {number} maxPitchDeg  Clamp range, shared across modes.
 */
export function createOrbitCamera(map, target, config, minPitchDeg, maxPitchDeg) {
  let yaw = target.heading;
  let pitch = config.defaultPitch;
  let distance = config.defaultDistance;

  function apply(t) {
    const extraHeight = (t.altitude || 0) + config.eyeHeight;
    const { distance: d, pitch: p } = elevate(distance, pitch, extraHeight);
    return {
      center: [t.lng, t.lat],
      zoom: zoomForDistance(map, t.lat, d),
      pitch: clamp(90 - p, 0, 85),
      bearing: yaw
    };
  }

  return {
    /** Camera options for easing in from wherever the map currently is. */
    introOptions() {
      return apply(target);
    },

    /** Mouse-drag orbit: dx/dy in pixels. No auto-snap-back — this is the only way yaw/pitch change. */
    orbit(dx, dy, yawSensitivity, pitchSensitivity) {
      yaw = normalizeDegrees(yaw + dx * yawSensitivity);
      pitch = clamp(pitch - dy * pitchSensitivity, minPitchDeg, maxPitchDeg);
    },

    /** Scroll-wheel zoom: deltaY in wheel-delta units. */
    zoom(deltaY, sensitivity) {
      distance = clamp(distance + deltaY * sensitivity, config.minDistance, config.maxDistance);
    },

    /** Switches per-mode config (e.g. entering/leaving a car), clamping the current distance/pitch into range. */
    setConfig(nextConfig) {
      config = nextConfig;
      distance = clamp(distance, config.minDistance, config.maxDistance);
      pitch = clamp(pitch, minPitchDeg, maxPitchDeg);
    },

    /** The camera's current compass yaw — for resolving on-foot WASD to a world heading. */
    get yaw() {
      return yaw;
    },

    /** Moves the map camera for this frame. */
    update(nextTarget) {
      map.jumpTo(apply(nextTarget));
    }
  };
}
