'use client';

// Dealership menu state, plus whether the player is within its range (for
// the map pin's highlight). Opening it is the player state machine's job
// (lib/playerState.js, via CarDriving's onOpenDealership).
// onPose is called ~10×/s; only crossing the range boundary changes state.

import { useCallback, useEffect, useRef, useState } from 'react';

import { isAtDealership } from '@/lib/dealership';

export function useDealership(active) {
  const [open, setOpen] = useState(false);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  const onPose = useCallback(({ lng, lat }) => {
    const inside = isAtDealership(lng, lat);
    if (inside === nearRef.current) return;
    nearRef.current = inside;
    setNear(inside);
  }, []);

  useEffect(() => {
    if (active) return;
    nearRef.current = false;
    setNear(false);
    setOpen(false);
  }, [active]);

  return { open, setOpen, near, onPose };
}
