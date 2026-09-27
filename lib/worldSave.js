// Persists the drive-mode world between sessions and page reloads: where
// each owned car is parked, and where the player was (driving or on foot).

import { CARS } from './carCatalog';
import { PLANES } from './planeCatalog';

const WORLD_STORAGE_KEY = 'building-picker-world';

/**
 * @typedef {{carId: string, lng: number, lat: number, heading: number}} ParkedCar
 * @typedef {{mode: 'driving'|'walking', carId?: string, lng: number, lat: number, heading: number}} PlayerSave
 * @returns {{parked: ParkedCar[], player: PlayerSave|null}}
 */
export function loadWorld() {
  const empty = { parked: [], player: null };
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(WORLD_STORAGE_KEY));
  } catch (e) {
    return empty;
  }
  if (!saved || typeof saved !== 'object') return empty;

  const known = new Set([...CARS, ...PLANES].map((c) => c.id));
  const isPose = (p) => p && [p.lng, p.lat, p.heading].every(Number.isFinite);
  const parked = Array.isArray(saved.parked) ? saved.parked.filter((p) => isPose(p) && known.has(p.carId)) : [];
  let player = isPose(saved.player) ? saved.player : null;
  if (player && player.mode === 'driving' && !known.has(player.carId)) player = null;
  if (player && player.mode !== 'driving' && player.mode !== 'walking') player = null;
  return { parked, player };
}

export function saveWorld(world) {
  try {
    window.localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(world));
  } catch (e) {
    // ignore — the world just won't persist
  }
}
