'use client';

// Map pin for the dealership. Renders nothing into React's tree — it adds a
// Mapbox DOM marker to the map for as long as it's mounted.

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

import styles from './DealershipMarker.module.css';
import { DEALERSHIP_LNGLAT, DEALERSHIP_NAME } from '@/lib/dealership';

export default function DealershipMarker({ map, highlighted }) {
  const elRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;
    const el = document.createElement('div');
    el.className = styles.marker;
    const icon = document.createElement('span');
    icon.className = styles.icon;
    icon.textContent = '$';
    el.append(icon, DEALERSHIP_NAME);
    elRef.current = el;
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(DEALERSHIP_LNGLAT).addTo(map);
    return () => {
      marker.remove();
      elRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (elRef.current) elRef.current.classList.toggle(styles.highlighted, !!highlighted);
  }, [highlighted, map]);

  return null;
}
