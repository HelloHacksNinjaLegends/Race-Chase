'use client';

// Player cash. The exact (fractional) balance lives in a ref so the drive
// loop can add to it every frame; React state and localStorage are only
// updated on a throttle, so earning cash doesn't re-render at 60 fps.

import { useCallback, useEffect, useRef, useState } from 'react';

import { CASH_PER_METER, loadCash, saveCash } from '@/lib/economy';

// Cash is only displayed outside play mode / in paused menus, never while
// it's accumulating, so React state doesn't need frequent updates.
const STATE_FLUSH_MS = 1000;
const STORAGE_FLUSH_MS = 2000;

export function useEconomy() {
  const cashRef = useRef(null);
  if (cashRef.current === null) cashRef.current = loadCash();

  const [cash, setCash] = useState(() => Math.floor(cashRef.current));
  const lastStateFlushRef = useRef(0);
  const lastStorageFlushRef = useRef(0);

  const flush = useCallback((force) => {
    const now = performance.now();
    if (force || now - lastStateFlushRef.current > STATE_FLUSH_MS) {
      lastStateFlushRef.current = now;
      setCash(Math.floor(cashRef.current));
    }
    if (force || now - lastStorageFlushRef.current > STORAGE_FLUSH_MS) {
      lastStorageFlushRef.current = now;
      saveCash(cashRef.current);
    }
  }, []);

  /** Credits cash for `meters` driven. Safe to call every frame. */
  const addDistance = useCallback(
    (meters) => {
      if (!(meters > 0)) return;
      cashRef.current += meters * CASH_PER_METER;
      flush(false);
    },
    [flush]
  );

  /** Deducts `amount` if affordable. Returns whether it went through. */
  const spend = useCallback(
    (amount) => {
      if (amount > cashRef.current) return false;
      cashRef.current -= amount;
      flush(true);
      return true;
    },
    [flush]
  );

  /** Adds `amount` outright (dev tools, rewards). */
  const grant = useCallback(
    (amount) => {
      if (!(amount > 0)) return;
      cashRef.current += amount;
      flush(true);
    },
    [flush]
  );

  // Don't lose the last couple of seconds of earnings on reload / unmount.
  useEffect(() => {
    const save = () => saveCash(cashRef.current);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  /** Pushes the exact balance to React state and storage now. */
  const sync = useCallback(() => flush(true), [flush]);

  return { cash, addDistance, spend, grant, sync };
}
