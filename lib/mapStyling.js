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

/**
 * Replaces every `["zoom"]` sub-expression inside a style expression with the
 * literal `zoom`, so it evaluates to a constant instead of varying with the
 * map's actual zoom. Non-expression (plain) values pass through unchanged.
 */
function freezeZoomExpression(value, zoom) {
  if (!Array.isArray(value)) return value;
  if (value.length === 1 && value[0] === 'zoom') return zoom;
  return value.map((v) => freezeZoomExpression(v, zoom));
}

/**
 * Freezes Standard's road line-widths at whatever they'd render at `zoom`,
 * so they stop visibly thinning/thickening as play mode's orbit camera fakes
 * distance from the subject by changing the map's real zoom level (see
 * lib/orbitCamera.js) — that's Mapbox's own camera model, there's no
 * distance knob independent of zoom. Best-effort: Standard's imported layers
 * don't all accept direct paint overrides (see this file's header), so a
 * layer that rejects the override is just left alone.
 *
 * @returns {Array<{id: string, width: any}>} the original expressions, to
 *          restore with unfreezeRoadWidths() when leaving play mode.
 */
export function freezeRoadWidths(map, zoom) {
  const originals = [];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'line' || layer['source-layer'] !== 'road') continue;
    const width = layer.paint && layer.paint['line-width'];
    if (width === undefined) continue;
    try {
      map.setPaintProperty(layer.id, 'line-width', freezeZoomExpression(width, zoom));
      originals.push({ id: layer.id, width });
    } catch (e) {
      // This particular Standard layer doesn't allow a direct override — skip it.
    }
  }
  return originals;
}

/** Restores the line-width overrides made by freezeRoadWidths(). */
export function unfreezeRoadWidths(map, originals) {
  for (const { id, width } of originals) {
    try {
      map.setPaintProperty(id, 'line-width', width);
    } catch (e) {
      // Layer may be gone (map/style torn down) — nothing to restore.
    }
  }
}
