// Lighting for the three.js layer (cars, character) per Mapbox Standard
// light preset, so 3D objects match the basemap's time of day.
//
// hemi*: sky/ground fill light. sun*: key light. env: reflection strength
// of the environment map (clear-coat paint, glass, chrome). lamps: how "on"
// the car lights are (lib/carModel.js setLampLevel).

export const SCENE_LIGHTING = {
  dawn: { hemiSky: '#ffe2c8', hemiGround: '#6f6a78', hemi: 1.1, sun: '#ffc79a', sunIntensity: 1.6, env: 0.55, lamps: 0.6 },
  day: { hemiSky: '#ffffff', hemiGround: '#8a8f86', hemi: 1.5, sun: '#ffffff', sunIntensity: 2.3, env: 1, lamps: 0 },
  dusk: { hemiSky: '#ffb999', hemiGround: '#4b4458', hemi: 0.85, sun: '#ff9f6b', sunIntensity: 1.1, env: 0.45, lamps: 1 },
  night: { hemiSky: '#5b6b9a', hemiGround: '#15171f', hemi: 0.45, sun: '#9fb4ff', sunIntensity: 0.3, env: 0.18, lamps: 1 }
};
