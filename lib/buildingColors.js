// Building colors for our fill-extrusion layer (lib/mapStyling.js).
//
// Color follows height: warm, sunlit tones (sand, clay, cream) for
// house- and low-rise-scale buildings, muted stone/sage in the mid-rise
// band, and cool slate/glass blues for towers. Each building also gets one
// of a few slightly different ramps (by feature id), so neighbors aren't
// identical. All values are soft, low-saturation, so Standard's dawn / dusk /
// night lighting can tint them without anything turning neon.

import { SELECTED_BUILDING_COLOR } from './constants';

// Height stops in meters, shared by every ramp.
const HEIGHT_STOPS = [0, 12, 30, 70, 150];

const RAMPS = [
  ['#e8c9a6', '#dcb28f', '#b9c2b4', '#9fb3c8', '#8aa0bd'],
  ['#e9d8bf', '#d9a88b', '#c4c0b0', '#a7b9cc', '#93a8c4'],
  ['#f0e2cc', '#cfb49a', '#b3bfb9', '#b0bfcf', '#8fa2b8']
];

// Mapbox Streets leaves many small buildings without a height.
const DEFAULT_HEIGHT_M = 8;

function rampExpression(colors) {
  const expr = ['interpolate-lab', ['linear'], ['coalesce', ['get', 'height'], DEFAULT_HEIGHT_M]];
  HEIGHT_STOPS.forEach((stop, i) => expr.push(stop, colors[i]));
  return expr;
}

/** fill-extrusion-color expression: selected highlight, else a height ramp picked by feature id. */
export function buildingColorExpression() {
  const variant = ['%', ['to-number', ['id'], 0], RAMPS.length];
  const byVariant = ['match', variant];
  RAMPS.slice(1).forEach((colors, i) => byVariant.push(i + 1, rampExpression(colors)));
  byVariant.push(rampExpression(RAMPS[0]));
  return ['case', ['boolean', ['feature-state', 'selected'], false], SELECTED_BUILDING_COLOR, byVariant];
}
