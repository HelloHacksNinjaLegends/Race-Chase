'use client';

// Day/night: tracks the chosen light mode (auto or a pinned preset),
// re-evaluates "auto" against the clock every minute, applies the result to
// the map's Standard basemap, and lets "T" cycle modes.

import { useCallback, useEffect, useState } from 'react';

import { LIGHT_MODES, resolvePreset, loadLightMode, saveLightMode } from '@/lib/lightPreset';

const CLOCK_CHECK_MS = 60 * 1000;

/**
 * @param {mapboxgl.Map|null} map  Only touched once `ready` is true.
 * @param {boolean} ready          Whether the map has finished loading.
 * @returns {{mode: string, preset: string, setMode: Function, cycleMode: Function}}
 */
export function useLightPreset(map, ready) {
  const [mode, setModeState] = useState(loadLightMode);
  const [now, setNow] = useState(() => new Date());
  const preset = resolvePreset(mode, now);

  const setMode = useCallback((next) => {
    setModeState(next);
    saveLightMode(next);
  }, []);

  const cycleMode = useCallback(() => {
    setModeState((current) => {
      const next = LIGHT_MODES[(LIGHT_MODES.indexOf(current) + 1) % LIGHT_MODES.length];
      saveLightMode(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (mode !== 'auto') return undefined;
    const timer = setInterval(() => setNow(new Date()), CLOCK_CHECK_MS);
    return () => clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (!ready || !map) return;
    try {
      map.setConfigProperty('basemap', 'lightPreset', preset);
    } catch (e) {
      console.warn('Could not set the light preset', e);
    }
  }, [map, ready, preset]);

  useEffect(() => {
    if (!ready) return undefined;
    function handleKeyDown(e) {
      if (e.code !== 'KeyT' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      cycleMode();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ready, cycleMode]);

  return { mode, preset, setMode, cycleMode };
}
