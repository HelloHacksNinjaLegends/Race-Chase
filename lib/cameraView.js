// Remembers the chosen drive-mode camera view (see lib/followCamera.js).

import { CAMERA_VIEWS } from './followCamera';

const CAMERA_VIEW_STORAGE_KEY = 'building-picker-camera-view';

export function loadCameraView() {
  try {
    const saved = window.localStorage.getItem(CAMERA_VIEW_STORAGE_KEY);
    if (CAMERA_VIEWS.includes(saved)) return saved;
  } catch (e) {
    // unavailable — use the default
  }
  return CAMERA_VIEWS[0];
}

export function saveCameraView(view) {
  try {
    window.localStorage.setItem(CAMERA_VIEW_STORAGE_KEY, view);
  } catch (e) {
    // ignore — the choice just won't persist
  }
}

export function nextCameraView(view) {
  return CAMERA_VIEWS[(CAMERA_VIEWS.indexOf(view) + 1) % CAMERA_VIEWS.length];
}
