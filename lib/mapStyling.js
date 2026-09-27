// Layers we add on top of the Mapbox Standard basemap.
//
// Standard keeps its own sources and layers inside an imported style
// (`basemap`), where they can't be feature-state-selected per building,
// data-driven-colored, or read with querySourceFeatures. So Standard's 3D
// buildings are switched off (see MAP_CONFIG in lib/constants.js) and we add
// our own extruded buildings from Mapbox Streets. Collision
// (lib/buildingCollision.js) and the traffic road fallback
// (lib/mapboxRoads.js) read the same source.

import { STREETS_SOURCE_ID, BUILDINGS_LAYER_ID } from './constants';
import { buildingColorExpression } from './buildingColors';

/** Adds the Mapbox Streets vector source used by our buildings, collision and roads. */
export function addStreetsSource(map) {
  map.addSource(STREETS_SOURCE_ID, { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' });
}

/** Adds the clickable 3D buildings layer, extruded from Mapbox Streets building data. */
export function addBuildingsLayer(map) {
  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    source: STREETS_SOURCE_ID,
    'source-layer': 'building',
    filter: ['==', ['get', 'extrude'], 'true'],
    type: 'fill-extrusion',
    // Standard's "middle" slot: above roads and land, below labels.
    slot: 'middle',
    // Mapbox's building data simply isn't present in tiles below roughly
    // neighborhood zoom, so buildings won't show at a city-wide view no
    // matter how low this is set.
    minzoom: 0,
    paint: {
      'fill-extrusion-color': buildingColorExpression(),
      'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
      'fill-extrusion-opacity': 0.95
    }
  });
}
