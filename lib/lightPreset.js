// Time of day for Mapbox Standard's `lightPreset` config property.

export const LIGHT_PRESETS = ['dawn', 'day', 'dusk', 'night'];

// "auto" follows the viewer's local clock; any preset pins it.
export const LIGHT_MODES = ['auto', ...LIGHT_PRESETS];

const LIGHT_MODE_STORAGE_KEY = 'building-picker-light-mode';

/** The preset for a given local time: dawn 5–7, day 7–18, dusk 18–20, night otherwise. */
export function presetForTime(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

export function resolvePreset(mode, date) {
  return mode === 'auto' ? presetForTime(date) : mode;
}

export function loadLightMode() {
  try {
    const saved = window.localStorage.getItem(LIGHT_MODE_STORAGE_KEY);
    if (LIGHT_MODES.includes(saved)) return saved;
  } catch (e) {
    // unavailable — use the default
  }
  return 'auto';
}

export function saveLightMode(mode) {
  try {
    window.localStorage.setItem(LIGHT_MODE_STORAGE_KEY, mode);
  } catch (e) {
    // ignore — the choice just won't persist
  }
}
