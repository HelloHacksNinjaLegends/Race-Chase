'use client';

import dynamic from 'next/dynamic';

// Mapbox GL touches window/DOM directly, so it can only run client-side.
const BuildingMap = dynamic(() => import('@/components/BuildingMap'), { ssr: false });

export default function Page() {
  return <BuildingMap />;
}
