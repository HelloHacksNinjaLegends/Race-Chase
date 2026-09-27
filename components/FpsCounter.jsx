'use client';

// A minimal, dependency-free on-screen FPS readout — toggled with P (see
// BuildingMap.jsx). Runs its own requestAnimationFrame loop independent of
// any specific subsystem (Mapbox, the drive-mode render loop), so it reads
// the actual browser frame rate the way a user would perceive it, in every
// mode (browsing or driving/flying).

import { useEffect, useRef, useState } from 'react';

const SAMPLE_MS = 500;

export default function FpsCounter() {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    let frameId = 0;
    lastSampleRef.current = performance.now();
    framesRef.current = 0;

    function tick(now) {
      frameId = requestAnimationFrame(tick);
      framesRef.current++;
      const elapsed = now - lastSampleRef.current;
      if (elapsed >= SAMPLE_MS) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastSampleRef.current = now;
      }
    }
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 10000,
        padding: '3px 8px',
        borderRadius: 4,
        background: 'rgba(0, 0, 0, 0.65)',
        color: fps >= 50 ? '#6f6' : fps >= 30 ? '#fd6' : '#f66',
        font: '600 13px/1.4 monospace',
        pointerEvents: 'none',
        userSelect: 'none'
      }}
    >
      {fps} FPS
    </div>
  );
}
