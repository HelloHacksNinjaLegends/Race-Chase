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

// --- On foot (see lib/character.js) ---

// Speeds in m/s.
export const WALK_SPEED = 2.2;
export const RUN_SPEED = 6;
export const WALK_ACCEL = 14;
export const CHARACTER_RADIUS = 0.45; // the blob's body radius (lib/blobCharacterModel.js)
// How close (meters from the car's body) the character must be to get in.
export const ENTER_CAR_RANGE_M = 1.5;

// --- Orbit-follow camera (see lib/orbitCamera.js) ---
//
// One shared GTA-style camera for all three modes: mouse-drag orbits
// yaw/pitch freely around the target (no auto-snap-back to "behind" it),
// and the scroll wheel sets the orbit distance — each clamped per mode below.
// `eyeHeight` raises the look-at point a bit above the target's ground
// contact point (roughly chest/roof height); for the helicopter this is on
// top of its current altitude, added in CarDriving.jsx's cameraTarget().

export const ORBIT_MIN_PITCH_DEG = 8; // degrees above the horizon — keeps the camera from diving underground
export const ORBIT_MAX_PITCH_DEG = 80; // degrees above the horizon — keeps it from flipping over the top
export const ORBIT_YAW_SENSITIVITY = 0.25; // degrees of yaw per pixel of mouse drag
export const ORBIT_PITCH_SENSITIVITY = 0.2; // degrees of pitch per pixel of mouse drag
export const ORBIT_ZOOM_SENSITIVITY = 0.03; // meters of distance per wheel-delta unit

export const WALK_ORBIT_CAMERA = { minDistance: 3, maxDistance: 18, defaultDistance: 7, defaultPitch: 22, eyeHeight: 1.5 };
export const DRIVE_ORBIT_CAMERA = { minDistance: 4, maxDistance: 35, defaultDistance: 9, defaultPitch: 18, eyeHeight: 1 };
export const FLY_ORBIT_CAMERA = { minDistance: 10, maxDistance: 150, defaultDistance: 28, defaultPitch: 25, eyeHeight: 1.5 };
// Eye-level POV needs zooms past Mapbox's default limit of 22; the orbit
// camera can get close enough (WALK_ORBIT_CAMERA.minDistance) to want it too.
export const CAMERA_MAX_ZOOM = 25;

// --- NPC traffic (see lib/traffic.js) ---

export const TRAFFIC_COUNT = 8;
export const TRAFFIC_SPEED = 9; // m/s, ~32 km/h
