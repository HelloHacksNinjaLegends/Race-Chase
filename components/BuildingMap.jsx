'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import styles from './BuildingMap.module.css';
import TokenGate from './TokenGate';
import Hint from './Hint';
import InfoPanel from './InfoPanel';
import PlayToggle from './PlayToggle';
import ControlDock from './ControlDock';
import LightControl from './LightControl';
import GarageButton from './GarageButton';
import DevCashButton from './DevCashButton';
import GaragePanel from './GaragePanel';
import PhonePanel from './PhonePanel';
import FpsCounter from './FpsCounter';
import DealershipPanel from './DealershipPanel';
import DealershipMarker from './DealershipMarker';
import { useEconomy } from '@/hooks/useEconomy';
import { useGarage } from '@/hooks/useGarage';
import { useDealership } from '@/hooks/useDealership';
import { useLightPreset } from '@/hooks/useLightPreset';
import { loadWorld } from '@/lib/worldSave';

// Play mode pulls in three.js, so it's only loaded the first time it's used.
const CarDriving = dynamic(() => import('./CarDriving'), { ssr: false });

import {
  MAPBOX_TOKEN_STORAGE_KEY,
  MAP_STYLE,
  MAP_CENTER,
  MAP_ZOOM,
  MAP_PITCH,
  MAP_BEARING,
  MAX_PIXEL_RATIO,
  MAP_CONFIG,
  STREETS_SOURCE_ID,
  BUILDINGS_LAYER_ID,
  isPlausibleMapboxToken
} from '@/lib/constants';
import { addStreetsSource, addBuildingsLayer } from '@/lib/mapStyling';

// Feature-state target for a building in our own buildings layer.
function buildingRef(id) {
  return { source: STREETS_SOURCE_ID, sourceLayer: 'building', id };
}

export default function BuildingMap() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // Selected-building feature-state bookkeeping (imperative, doesn't need to
  // trigger re-renders itself — `selectedBuilding` state below drives the UI).
  const selectedFeatureIdRef = useRef(null);

  const [mapboxToken, setMapboxToken] = useState(null);
  const [tokenError, setTokenError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [driveMode, setDriveMode] = useState(false);
  const light = useLightPreset(mapReady ? mapRef.current : null, mapReady);
  // Read when the map is created, so it starts at the right time of day.
  const lightPresetRef = useRef(light.preset);
  lightPresetRef.current = light.preset;
  const { cash, addDistance, spend, grant, sync: syncCash } = useEconomy();
  const garage = useGarage();
  const dealership = useDealership(driveMode);
  const [garageOpen, setGarageOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const setDealershipOpen = dealership.setOpen;
  // Whether the player is on foot (play mode only), and the latest
  // "park this car on the dealership lot" / "summon this car to me" requests
  // for CarDriving.
  const [onFoot, setOnFoot] = useState(true);
  const [lotRequest, setLotRequest] = useState(null);
  const [summonRequest, setSummonRequest] = useState(null);
  const [planeSummonRequest, setPlaneSummonRequest] = useState(null);
  // Where each owned car is in the world ({carId, lng, lat, inUse}), and the
  // player's last position — for the garage list. Seeded from the save.
  const [fleet, setFleet] = useState(initialFleet);
  const playerPosRef = useRef(null);
  if (playerPosRef.current === null) {
    const { player } = loadWorld();
    playerPosRef.current = player ? { lng: player.lng, lat: player.lat } : false;
  }
  // H hides all on-screen UI while driving.
  const [hudHidden, setHudHidden] = useState(false);
  // P toggles a performance-debugging FPS readout, in any mode.
  const [fpsVisible, setFpsVisible] = useState(false);
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code !== 'KeyP' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setFpsVisible((visible) => !visible);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!driveMode) {
      setOnFoot(true);
      setHudHidden(false);
      setPhoneOpen(false);
      syncCash(); // show the last second of earnings
    }
  }, [driveMode, syncCash]);

  // The phone only makes sense on foot — close it the moment a car is entered.
  useEffect(() => {
    if (!onFoot) setPhoneOpen(false);
  }, [onFoot]);

  useEffect(() => {
    if (!driveMode) return undefined;
    function handleKeyDown(e) {
      if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setHudHidden((hidden) => !hidden);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [driveMode]);

  // Only one menu at a time: arriving at the dealership closes the garage/phone.
  useEffect(() => {
    if (dealership.open) {
      setGarageOpen(false);
      setPhoneOpen(false);
    }
  }, [dealership.open]);

  // Load a saved token (or the optional build-time default) once, on mount.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MAPBOX_TOKEN_STORAGE_KEY);
      if (saved) {
        setMapboxToken(saved);
        return;
      }
    } catch (e) {
      // localStorage unavailable (private mode, etc.) — fall through
    }
    if (process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      setMapboxToken(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
    }
  }, []);

  // Enter toggles play mode ("C" cycles camera views while playing).
  useEffect(() => {
    if (!mapReady) return undefined;
    function handleKeyDown(e) {
      if ((e.code !== 'Enter' && e.code !== 'NumpadEnter') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      // Enter on a focused button already clicks it; don't toggle twice.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || el.isContentEditable)) {
        return;
      }
      setDriveMode((on) => !on);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mapReady]);

  // "G" toggles the garage list (works in and out of play mode).
  useEffect(() => {
    if (!mapReady) return undefined;
    function handleKeyDown(e) {
      if (e.code !== 'KeyG' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setDealershipOpen(false);
      setPhoneOpen(false);
      setGarageOpen((open) => !open);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mapReady, setDealershipOpen]);

  // "Tab" toggles the phone (summon an owned car) while playing, on foot.
  useEffect(() => {
    if (!driveMode) return undefined;
    function handleKeyDown(e) {
      if (e.code !== 'Tab' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!onFoot) return;
      e.preventDefault();
      setDealershipOpen(false);
      setGarageOpen(false);
      setPhoneOpen((open) => !open);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [driveMode, onFoot, setDealershipOpen]);

  // Create (and tear down) the Mapbox map whenever we have a token to try.
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;

    setMapReady(false);
    setDriveMode(false);
    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      pitch: MAP_PITCH,
      bearing: MAP_BEARING,
      config: { ...MAP_CONFIG, basemap: { ...MAP_CONFIG.basemap, lightPreset: lightPresetRef.current } },
      antialias: true,
      // Capped rather than the full window.devicePixelRatio (which is 4x the
      // pixel count on a typical 2x Retina/high-DPI display) — a meaningful
      // GPU cost cut on both Mapbox's own tile rendering and our Three.js
      // layer, which shares this same canvas (see lib/worldLayer.js).
      pixelRatio: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    });
    mapRef.current = map;

    let failed = false;

    function handleMapError(e) {
      const message = (e && e.error && e.error.message) || '';
      if (!failed && /access token|unauthorized|401|403/i.test(message)) {
        failed = true;
        try {
          window.localStorage.removeItem(MAPBOX_TOKEN_STORAGE_KEY);
        } catch (err) {
          // ignore
        }
        setTokenError('Mapbox rejected that token. Double-check you copied the whole public token, starting with "pk.".');
        setMapboxToken(null);
      }
    }
    map.on('error', handleMapError);

    map.on('load', () => {
      if (failed) return;

      addStreetsSource(map);
      addBuildingsLayer(map);

      map.on('click', BUILDINGS_LAYER_ID, (e) => {
        if (!e.features || !e.features.length) return;
        const feature = e.features[0];
        const lngLat = e.lngLat;

        if (selectedFeatureIdRef.current !== null) {
          map.setFeatureState(buildingRef(selectedFeatureIdRef.current), { selected: false });
        }
        selectedFeatureIdRef.current = feature.id;
        map.setFeatureState(buildingRef(feature.id), { selected: true });
        if (process.env.NODE_ENV !== 'production') {
          // Dev check that selection reached the layer (the style migration's riskiest part).
          const state = map.getFeatureState(buildingRef(feature.id));
          if (feature.id == null || !state.selected) {
            console.warn('[building-select] feature state not applied', feature.id, state);
          }
        }

        const props = feature.properties || {};
        const type = props.type || props.class || 'unspecified';
        setSelectedBuilding({
          title: props.name || type.charAt(0).toUpperCase() + type.slice(1) + ' building',
          height: props.height != null ? Math.round(props.height) + ' m' : 'not in dataset',
          minHeight: props.min_height != null ? Math.round(props.min_height) + ' m' : '0 m',
          type,
          coords: lngLat.lat.toFixed(5) + ', ' + lngLat.lng.toFixed(5)
        });
      });

      map.on('mouseenter', BUILDINGS_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', BUILDINGS_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });

      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      selectedFeatureIdRef.current = null;
    };
  }, [mapboxToken]);

  function handleTokenSubmit(rawValue) {
    const value = rawValue.trim();
    if (!isPlausibleMapboxToken(value)) {
      setTokenError('That didn’t look like a valid Mapbox token. Check you copied the whole thing, starting with "pk.".');
      return;
    }
    setTokenError(null);
    try {
      window.localStorage.setItem(MAPBOX_TOKEN_STORAGE_KEY, value);
    } catch (e) {
      // ignore
    }
    setMapboxToken(value);
  }

  // Dealership: buying (or getting a free car) parks it on the lot.
  function handleBuyCar(car) {
    if (!spend(car.price)) return;
    garage.addCar(car.id);
    setLotRequest({ id: car.id });
    setDealershipOpen(false);
  }

  // Dealership: bring an owned car to the lot (or collect one that isn't out yet).
  function handleMoveToLot(id) {
    setLotRequest({ id });
    setDealershipOpen(false);
  }

  // Phone: summon an owned car to the player's current location.
  function handleSummonCar(id) {
    setSummonRequest({ id });
    setPhoneOpen(false);
  }

  // Phone: summon a plane/jet to the player's current location, from anywhere.
  function handleSummonPlane(id) {
    setPlaneSummonRequest({ id });
    setPhoneOpen(false);
  }

  function handlePose(pose) {
    playerPosRef.current = pose;
    dealership.onPose(pose);
  }

  function handleCloseInfo() {
    const map = mapRef.current;
    if (map && selectedFeatureIdRef.current !== null) {
      map.setFeatureState(buildingRef(selectedFeatureIdRef.current), { selected: false });
      selectedFeatureIdRef.current = null;
    }
    setSelectedBuilding(null);
  }

  return (
    <>
      {fpsVisible && <FpsCounter />}

      <div className={styles.mapWrap}>
        <div ref={mapContainerRef} className={styles.map} />
      </div>

      {mapboxToken && !mapReady && <div className={styles.loading}>Loading map…</div>}

      {!mapboxToken && <TokenGate onSubmit={handleTokenSubmit} error={tokenError} />}

      {mapboxToken && mapReady && (
        <>
          {/* Map-browsing chrome is hidden while driving to keep the view calm. */}
          {!driveMode && <LightControl mode={light.mode} preset={light.preset} onChange={light.setMode} />}
          <Hint visible={!selectedBuilding && !driveMode} />
          <InfoPanel building={selectedBuilding} onClose={handleCloseInfo} />
          {!(driveMode && hudHidden) && (
            <ControlDock>
              <PlayToggle active={driveMode} onToggle={() => setDriveMode((on) => !on)} />
              {!driveMode && <GarageButton cash={cash} onClick={() => setGarageOpen((open) => !open)} />}
              {!driveMode && <DevCashButton onGrant={grant} />}
            </ControlDock>
          )}
          <DealershipMarker map={mapRef.current} highlighted={dealership.near} />
          {driveMode && (
            <CarDriving
              map={mapRef.current}
              onExit={() => setDriveMode(false)}
              onDistance={addDistance}
              onPose={handlePose}
              onModeChange={setOnFoot}
              onOpenDealership={() => {
                setGarageOpen(false);
                setDealershipOpen(true);
              }}
              onFleetChange={setFleet}
              lotRequest={lotRequest}
              summonRequest={summonRequest}
              planeSummonRequest={planeSummonRequest}
              lightPreset={light.preset}
              paused={dealership.open || garageOpen || phoneOpen}
              hudHidden={hudHidden}
            />
          )}
          {dealership.open && (
            <DealershipPanel
              cash={cash}
              owned={garage.owned}
              fleet={fleet}
              onBuy={handleBuyCar}
              onMoveToLot={handleMoveToLot}
              onClose={() => setDealershipOpen(false)}
            />
          )}
          {garageOpen && (
            <GaragePanel
              owned={garage.owned}
              fleet={fleet}
              playerPos={playerPosRef.current || null}
              onClose={() => setGarageOpen(false)}
            />
          )}
          {phoneOpen && (
            <PhonePanel
              owned={garage.owned}
              onSummon={handleSummonCar}
              onSummonPlane={handleSummonPlane}
              onClose={() => setPhoneOpen(false)}
            />
          )}
        </>
      )}
    </>
  );
}

/** Owned cars' positions from the last saved play session. */
function initialFleet() {
  const { parked, player } = loadWorld();
  const fleet = parked.map((p) => ({ carId: p.carId, lng: p.lng, lat: p.lat, inUse: false }));
  if (player && player.mode === 'driving') {
    fleet.push({ carId: player.carId, lng: player.lng, lat: player.lat, inUse: false });
  }
  return fleet;
}
