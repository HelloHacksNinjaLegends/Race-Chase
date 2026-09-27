// Shared constants for the building picker map.

export const MAPBOX_TOKEN_STORAGE_KEY = 'building-picker-mapbox-token';

// Default view: framed roughly over Richmond / Vancouver / UBC.
export const MAP_STYLE = 'mapbox://styles/mapbox/standard';
export const MAP_CENTER = [-123.06, 49.14];
export const MAP_ZOOM = 10.4;
export const MAP_PITCH = 52;
export const MAP_BEARING = -12;

// Mapbox Standard configuration (the style is imported as "basemap").
// Standard's own 3D buildings and landmark models are off: we draw our own
// buildings (lib/mapStyling.js) so they can be selected, colored per
// building, and used for collision. POI labels are off — the map isn't
// about amenities.
export const MAP_CONFIG = {
  basemap: {
    lightPreset: 'day',
    show3dBuildings: false,
    show3dLandmarks: false,
    showPointOfInterestLabels: false
  }
};

// Our own vector source (Mapbox Streets v8) and the buildings layer built on it.
export const STREETS_SOURCE_ID = 'streets';
export const BUILDINGS_LAYER_ID = '3d-buildings';
export const SELECTED_BUILDING_COLOR = '#1f8a70';

// The public Overpass servers are shared community resources with no uptime
// guarantee, so requests fall back through this list in order. Used for the
// road network NPC traffic drives on (lib/roadGraph.js).
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

export function isPlausibleMapboxToken(value) {
  return typeof value === 'string' && value.trim().indexOf('pk.') === 0 && value.trim().length > 20;
}

// --- Drive mode (see components/CarDriving.jsx) ---

// Where the character starts the first time play mode begins from a
// zoomed-out view (No. 3 Road, Richmond, a short walk from the dealership).
// Zoomed in past DRIVE_SPAWN_MIN_ZOOM, they start at the map center instead.
export const DRIVE_START = [-123.1366, 49.1666];
export const DRIVE_SPAWN_MIN_ZOOM = 14;

// Car dimensions, meters.
export const CAR_LENGTH = 4.5;
export const CAR_WIDTH = 1.9;

// Kinematics. DRIVE_MAX_SPEED / DRIVE_ACCEL are the starter car's stats;
// every other car sets its own in lib/carCatalog.js.
// Speeds in m/s, accelerations in m/s², turn rate in deg/s.
export const DRIVE_MAX_SPEED = 22; // ~80 km/h
export const DRIVE_MAX_REVERSE_SPEED = 6;
export const DRIVE_ACCEL = 7;
export const DRIVE_REVERSE_ACCEL = 4;
export const DRIVE_BRAKE = 16;
export const DRIVE_COAST_DECEL = 3.5;
export const DRIVE_MAX_TURN_RATE = 70;
// Below this speed steering is scaled down, so the car can't spin in place.
export const DRIVE_FULL_TURN_SPEED = 6;
// How quickly steering input eases toward the pressed direction (1/s).
export const DRIVE_STEER_RESPONSE = 7;

// Chase camera.
export const DRIVE_CAMERA_ZOOM = 20;
export const DRIVE_CAMERA_PITCH = 70;
export const DRIVE_CAMERA_LOOK_AHEAD_M = 8;
// How quickly the camera's bearing catches up with the car's heading (1/s).
export const DRIVE_CAMERA_BEARING_RESPONSE = 4;

// --- On foot (see lib/character.js) ---

// Speeds in m/s, turn rate in deg/s.
export const WALK_SPEED = 2.2;
export const RUN_SPEED = 6;
export const WALK_BACK_SPEED = 1.4;
export const WALK_ACCEL = 14;
export const WALK_TURN_RATE = 180;
export const CHARACTER_RADIUS = 0.45; // the blob's body radius (lib/blobCharacterModel.js)
// How close (meters from the car's body) the character must be to get in.
export const ENTER_CAR_RANGE_M = 1.5;

// First-person (POV) camera, cycled with "C" (see lib/followCamera.js).
// Eye positions are meters relative to the car / character center:
// forward along the heading, side to the right (negative = left seat).
export const POV_PITCH = 80; // degrees from straight down; 90 would be level
export const POV_BEARING_RESPONSE = 10;
export const DRIVE_POV_EYE_HEIGHT_M = 1.1;
export const DRIVE_POV_EYE_FORWARD_M = -0.15;
export const DRIVE_POV_EYE_SIDE_M = -0.38;
export const WALK_POV_EYE_HEIGHT_M = 0.95; // the blob's eye level
// How quickly the camera glides between views / car ↔ on foot (1/s).
// Lower is calmer; ~2 settles in about 1.5 s.
export const CAMERA_TRANSITION_RESPONSE = 2;

// Follow camera while on foot — closer in than the driving camera.
export const WALK_CAMERA_ZOOM = 21;
export const WALK_CAMERA_PITCH = 66;
export const WALK_CAMERA_LOOK_AHEAD_M = 2;
export const WALK_CAMERA_BEARING_RESPONSE = 5;

// --- NPC traffic (see lib/traffic.js) ---

export const TRAFFIC_COUNT = 8;
export const TRAFFIC_SPEED = 9; // m/s, ~32 km/h
