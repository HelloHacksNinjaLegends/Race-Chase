'use client';

// The cars the player owns, persisted in localStorage. Owning a car doesn't
// put it anywhere: cars only appear in the world at the dealership's lot
// (see CarDriving's deliverToLot), and are then wherever you parked them.

import { useCallback, useEffect, useState } from 'react';

import { CARS } from '@/lib/carCatalog';

const GARAGE_STORAGE_KEY = 'building-picker-garage';

function loadOwned() {
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(GARAGE_STORAGE_KEY));
  } catch (e) {
    // missing / corrupt / unavailable — start fresh
  }
  const known = new Set(CARS.map((c) => c.id));
  const owned = Array.isArray(saved && saved.owned) ? saved.owned.filter((id) => known.has(id)) : [];
  return [...new Set(owned)];
}

export function useGarage() {
  const [owned, setOwned] = useState(loadOwned);

  useEffect(() => {
    try {
      window.localStorage.setItem(GARAGE_STORAGE_KEY, JSON.stringify({ owned }));
    } catch (e) {
      // ignore — garage just won't persist
    }
  }, [owned]);

  const addCar = useCallback((id) => {
    setOwned((list) => (list.includes(id) ? list : [...list, id]));
  }, []);

  return { owned, addCar };
}
