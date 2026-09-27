export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Wraps degrees into [-180, 180). */
export function normalizeDegrees(deg) {
  return ((deg % 360) + 540) % 360 - 180;
}

