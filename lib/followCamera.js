// Drive-mode camera. Two views, both driving the Mapbox camera:
//
// - chase: third-person, trailing the target's heading and aimed a little
//   ahead of it.
// - pov:   first-person from the driver's seat (or eye level on foot).
//
// Mapbox cameras are described by center/zoom/pitch/bearing, so a POV eye
// position is converted to "the center point `d` meters ahead, at the zoom
// whose camera distance is `d`" — see povTargets(). Every parameter eases
// toward its target, so switching views (or car ↔ on foot) glides instead of
// cutting.

import { offsetLngLat } from './buildingCollision';
import { normalizeDegrees, shortestAngleDelta } from './mathUtils';
import {
  DRIVE_CAMERA_ZOOM,
  DRIVE_CAMERA_PITCH,
  DRIVE_CAMERA_LOOK_AHEAD_M,
  DRIVE_CAMERA_BEARING_RESPONSE,
  WALK_CAMERA_ZOOM,
  WALK_CAMERA_PITCH,
  WALK_CAMERA_LOOK_AHEAD_M,
  WALK_CAMERA_BEARING_RESPONSE,
  POV_PITCH,
  POV_BEARING_RESPONSE,
  DRIVE_POV_EYE_HEIGHT_M,
  DRIVE_POV_EYE_FORWARD_M,
  DRIVE_POV_EYE_SIDE_M,
  WALK_POV_EYE_HEIGHT_M,
  CAMERA_TRANSITION_RESPONSE
} from './constants';

export const CAMERA_VIEWS = ['chase', 'pov'];

const PROFILES = {
  drive: {
    chase: {
      zoom: DRIVE_CAMERA_ZOOM,
      pitch: DRIVE_CAMERA_PITCH,
      lookAhead: DRIVE_CAMERA_LOOK_AHEAD_M,
      side: 0,
      bearingResponse: DRIVE_CAMERA_BEARING_RESPONSE
    },
    pov: {
      pov: true,
      eyeHeight: DRIVE_POV_EYE_HEIGHT_M,
      eyeForward: DRIVE_POV_EYE_FORWARD_M,
      eyeSide: DRIVE_POV_EYE_SIDE_M,
      pitch: POV_PITCH,
      bearingResponse: POV_BEARING_RESPONSE
    }
  },
  walk: {
    chase: {
      zoom: WALK_CAMERA_ZOOM,
      pitch: WALK_CAMERA_PITCH,
      lookAhead: WALK_CAMERA_LOOK_AHEAD_M,
      side: 0,
      bearingResponse: WALK_CAMERA_BEARING_RESPONSE
    },
    pov: {
      pov: true,
      eyeHeight: WALK_POV_EYE_HEIGHT_M,
      eyeForward: 0.1,
      eyeSide: 0,
      pitch: POV_PITCH,
      bearingResponse: POV_BEARING_RESPONSE
    }
  }
};

/** Camera profile for driving or walking, in the given view. */
export function cameraProfile(onFoot, view) {
  return PROFILES[onFoot ? 'walk' : 'drive'][view === 'pov' ? 'pov' : 'chase'];
}

// Zoom range needed for eye-level POV cameras (Mapbox allows up to 25.5).
export const CAMERA_MAX_ZOOM = 25;

// Mapbox's default vertical field of view (radians) and 512-px tiles.
const MAPBOX_FOV = 0.6435011087932844;
const TILE_SIZE = 512;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Zoom at which the Mapbox camera sits `distanceM` meters from the map center. */
function zoomForCameraDistance(map, lat, distanceM) {
  const cameraToCenterPx = (0.5 / Math.tan(MAPBOX_FOV / 2)) * map.getCanvas().clientHeight;
  const metersPerPixelAtZ0 = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / TILE_SIZE;
  return Math.log2((cameraToCenterPx * metersPerPixelAtZ0) / distanceM);
}

/** Center offset / zoom / pitch that put the camera at the profile's eye position. */
function povTargets(map, lat, profile) {
  const pitchRad = (profile.pitch * Math.PI) / 180;
  const distance = profile.eyeHeight / Math.cos(pitchRad);
  return {
    zoom: zoomForCameraDistance(map, lat, distance),
    pitch: profile.pitch,
    lookAhead: profile.eyeForward + distance * Math.sin(pitchRad),
    side: profile.eyeSide
  };
}

/**
 * @param {mapboxgl.Map} map
 * @param {{lng, lat, heading}} target  Initial target.
 * @param {object} profile              Initial profile (from cameraProfile).
 */
export function createFollowCamera(map, target, profile) {
  let bearing = target.heading;
  const start = profile.pov ? povTargets(map, target.lat, profile) : profile;
  let { zoom, pitch, lookAhead, side } = start;

  function centerFor(t) {
    const ahead = offsetLngLat(t.lng, t.lat, bearing, lookAhead);
    return side ? offsetLngLat(ahead[0], ahead[1], bearing + 90, side) : ahead;
  }

  return {
    /** Camera options for easing in from wherever the map currently is. */
    introOptions() {
      return { center: centerFor(target), zoom, pitch, bearing };
    },

    /** Moves the map camera for this frame. */
    update(nextTarget, nextProfile, dt) {
      bearing = normalizeDegrees(
        bearing + shortestAngleDelta(bearing, nextTarget.heading) * (1 - Math.exp(-nextProfile.bearingResponse * dt))
      );
      const goal = nextProfile.pov ? povTargets(map, nextTarget.lat, nextProfile) : nextProfile;
      const k = 1 - Math.exp(-CAMERA_TRANSITION_RESPONSE * dt);
      zoom += (goal.zoom - zoom) * k;
      pitch += (goal.pitch - pitch) * k;
      lookAhead += (goal.lookAhead - lookAhead) * k;
      side += (goal.side - side) * k;
      map.jumpTo({ center: centerFor(nextTarget), zoom, pitch, bearing });
    }
  };
}
