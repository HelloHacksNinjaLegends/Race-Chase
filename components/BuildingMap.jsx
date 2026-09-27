'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import RoutePlanner from './RoutePlanner';
import locations from '@/data/locations.json';
import { useLightPreset } from '@/hooks/useLightPreset';
import { loadWorld } from '@/lib/worldSave';
import { DEFAULT_CAR_ID } from '@/lib/carCatalog';

// Play mode pulls in three.js, so it's only loaded the first time it's used.
const CarDriving = dynamic(() => import('./CarDriving'), { ssr: false });

import {
  MAPBOX_TOKEN_STORAGE_KEY,
  MAP_STYLE,
  MAP_CENTER,
  MAP_ZOOM,
  MAP_PITCH,
  MAP_BEARING,
  MAP_CONFIG,
  STREETS_SOURCE_ID,
  BUILDINGS_LAYER_ID,
  isPlausibleMapboxToken
} from '@/lib/constants';
import { addStreetsSource, addBuildingsLayer } from '@/lib/mapStyling';
import { distanceMeters } from '@/lib/buildingCollision';

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
  const buildingAddressRequestRef = useRef(0);

  const [mapboxToken, setMapboxToken] = useState(null);
  const [tokenError, setTokenError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [driveMode, setDriveMode] = useState(false);
  const light = useLightPreset(mapReady ? mapRef.current : null, mapReady);
  // Read when the map is created, so it starts at the right time of day.
  const lightPresetRef = useRef(light.preset);
  lightPresetRef.current = light.preset;
  // Whether the player is on foot in play mode.
  const [onFoot, setOnFoot] = useState(true);
  // The latest player position is used by "My location" routing.
  const playerPosRef = useRef(null);
  if (playerPosRef.current === null) {
    const { player } = loadWorld();
    playerPosRef.current = player ? { lng: player.lng, lat: player.lat } : false;
  }
  const [playerPositionAvailable, setPlayerPositionAvailable] = useState(Boolean(playerPosRef.current));
  // H hides all on-screen UI while driving.
  const [hudHidden, setHudHidden] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeMode, setRouteMode] = useState('walking');
  const [routeCarId, setRouteCarId] = useState(DEFAULT_CAR_ID);
  const [walkingSpeed, setWalkingSpeed] = useState(1);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [routeStartText, setRouteStartText] = useState('');
  const [routeDestinationText, setRouteDestinationText] = useState('');
  const [routeStart, setRouteStart] = useState(null);
  const [routeDestination, setRouteDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeStatus, setRouteStatus] = useState('idle');
  const [routeSelecting, setRouteSelecting] = useState('start');
  const [routeProgress, setRouteProgress] = useState({ index: 0, point: null });
  const [navigation, setNavigation] = useState(null);
  const routeOpenRef = useRef(false);
  const routeRequestRef = useRef(0);
  const lastRerouteRef = useRef(0);
  const routeModeRef = useRef(routeMode);
  const routeStartRef = useRef(routeStart);
  const routeSelectingRef = useRef(routeSelecting);
  const routeProgressRef = useRef({ index: 0, point: null });
  const routeRef = useRef(route);
  routeOpenRef.current = routeOpen;
  routeModeRef.current = routeMode;
  routeStartRef.current = routeStart;
  routeSelectingRef.current = routeSelecting;
  routeRef.current = route;

  const canUsePlayerLocation = driveMode && onFoot && playerPositionAvailable && Boolean(playerPosRef.current);
  const remainingRouteSummary = useMemo(() => {
    if (!route) return null;
    const distance = routeCoordinatesDistance(remainingRouteCoordinates(route, routeProgress));
    const fraction = route.distance > 0 ? Math.min(1, distance / route.distance) : 0;
    return { distance, duration: route.duration * fraction };
  }, [route, routeProgress]);

  useEffect(() => {
    if (canUsePlayerLocation || !/^(your|my) location$/i.test(routeStartText)) return;
    setRouteStartText('');
    setRouteStart(null);
    setRouteSelecting('start');
  }, [canUsePlayerLocation, routeStartText]);

  useEffect(() => {
    if (!driveMode) {
      setOnFoot(true);
      setHudHidden(false);
    }
  }, [driveMode]);

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
      antialias: true
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

      map.on('click', (e) => {
        if (!routeOpenRef.current) return;
        const point = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        if (routeSelectingRef.current === 'start') {
          setRouteStart(point);
          setRouteStartText(`Dropped pin (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`);
          setRoute(null);
          setRouteStatus('idle');
          setRouteSelecting('destination');
          return;
        }
        setRouteDestination(point);
        setRouteDestinationText(`Dropped pin (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`);
        if (routeStartRef.current) requestRoute(routeStartRef.current, point, routeModeRef.current);
      });

      map.on('click', BUILDINGS_LAYER_ID, (e) => {
        if (!e.features || !e.features.length) return;
        const feature = e.features[0];
        const lngLat = e.lngLat;
        const addressRequestId = ++buildingAddressRequestRef.current;

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
        const nearbyKnownLocation = findNearestKnownLocation(lngLat.lng, lngLat.lat);
        const knownName = props.name || nearbyKnownLocation?.name || null;
        const details = {
          title: knownName || 'Finding address…',
          name: knownName,
          address: 'Finding address…',
          height: props.height != null ? Math.round(props.height) + ' m' : 'not in dataset',
          minHeight: props.min_height != null ? Math.round(props.min_height) + ' m' : '0 m',
          type: formatBuildingType(type),
          coords: lngLat.lat.toFixed(5) + ', ' + lngLat.lng.toFixed(5)
        };
        setSelectedBuilding(details);
        reverseGeocodeBuilding(lngLat.lng, lngLat.lat).then(({ address, name }) => {
          if (addressRequestId !== buildingAddressRequestRef.current || selectedFeatureIdRef.current !== feature.id) return;
          setSelectedBuilding({
            ...details,
            name: knownName || name || null,
            title: knownName || name || address || 'Address unavailable',
            address: address || 'No street address found'
          });
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

  // Draw the remaining route on the floor and animate direction arrows along it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    const sourceId = 'player-route';
    const arrowsSourceId = 'player-route-arrows';
    const lineId = 'player-route-line';
    const casingId = 'player-route-casing';
    const glowId = 'player-route-glow';
    const arrowsId = 'player-route-arrows-layer';
    if (map.getLayer(arrowsId)) map.removeLayer(arrowsId);
    if (map.getLayer(lineId)) map.removeLayer(lineId);
    if (map.getLayer(casingId)) map.removeLayer(casingId);
    if (map.getLayer(glowId)) map.removeLayer(glowId);
    if (map.getSource(arrowsSourceId)) map.removeSource(arrowsSourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!route) return undefined;
    const visibleCoordinates = remainingRouteCoordinates(route, routeProgressRef.current);
    map.addSource(sourceId, {
      type: 'geojson',
      lineMetrics: true,
      data: routeLineFeature(visibleCoordinates)
    });
    map.addSource(arrowsSourceId, { type: 'geojson', data: arrowFeatureCollection([]) });
    map.addLayer({ id: glowId, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8be7ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 16, 18, 25], 'line-blur': 9, 'line-opacity': 0.72 } });
    map.addLayer({ id: casingId, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#031f35', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 11, 18, 16], 'line-opacity': 0.96 } });
    map.addLayer({ id: lineId, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8fe8ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 18, 10], 'line-opacity': 1 } });
    map.addLayer({
      id: arrowsId,
      type: 'symbol',
      source: arrowsSourceId,
      layout: {
        'text-field': '➤',
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 18, 20],
        'text-rotate': ['-', ['get', 'bearing'], 90],
        'text-rotation-alignment': 'map',
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#087ca8',
        'text-halo-width': 2,
        'text-opacity': 0.96
      }
    });

    let animationFrame = 0;
    let lastArrowUpdate = 0;
    function animateArrows(now) {
      animationFrame = requestAnimationFrame(animateArrows);
      if (now - lastArrowUpdate < 70) return;
      lastArrowUpdate = now;
      const arrowSource = map.getSource(arrowsSourceId);
      const currentRoute = routeRef.current;
      if (!arrowSource || !currentRoute) return;
      const coordinates = remainingRouteCoordinates(currentRoute, routeProgressRef.current);
      arrowSource.setData(arrowFeatureCollection(buildAnimatedRouteArrows(coordinates, now)));
    }
    animationFrame = requestAnimationFrame(animateArrows);
    return () => {
      cancelAnimationFrame(animationFrame);
      if (map.getLayer(arrowsId)) map.removeLayer(arrowsId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(casingId)) map.removeLayer(casingId);
      if (map.getLayer(glowId)) map.removeLayer(glowId);
      if (map.getSource(arrowsSourceId)) map.removeSource(arrowsSourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [route, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('player-route');
    if (!source || !route) return;
    source.setData(routeLineFeature(remainingRouteCoordinates(route, routeProgress)));
  }, [route, routeProgress]);

  async function requestRoute(start, destination, mode = routeMode, showOverview = false) {
    if (!mapboxToken || !destination) return;
    const requestId = ++routeRequestRef.current;
    setRouteStatus('loading');
    const profile = mode === 'walking' ? 'walking' : 'driving';
    try {
      const coords = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
      const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?alternatives=false&geometries=geojson&overview=full&steps=true&access_token=${mapboxToken}`);
      const data = await response.json();
      if (requestId !== routeRequestRef.current) return;
      if (!response.ok || !data.routes?.[0]) throw new Error('No route');
      routeProgressRef.current = { index: 0, point: null };
      setRouteProgress({ index: 0, point: null });
      const nextRoute = { ...data.routes[0], destination, mode };
      setRoute(nextRoute);
      setRouteStatus('ready');
      if (showOverview) showRouteOverview(nextRoute);
    } catch (e) {
      if (requestId === routeRequestRef.current) setRouteStatus('error');
    }
  }

  function showRouteOverview(nextRoute) {
    const map = mapRef.current;
    const coordinates = nextRoute?.geometry?.coordinates;
    if (!map || !coordinates?.length) return;
    const bounds = coordinates.reduce(
      (result, coordinate) => result.extend(coordinate),
      new mapboxgl.LngLatBounds(coordinates[0], coordinates[0])
    );
    const narrow = map.getCanvas().clientWidth <= 640;
    map.fitBounds(bounds, {
      padding: narrow
        ? { top: 230, right: 34, bottom: 70, left: 34 }
        : { top: 70, right: 390, bottom: 70, left: 70 },
      maxZoom: 17,
      pitch: 46,
      bearing: 0,
      duration: 1300,
      essential: true
    });
  }

  function focusMapOnLocation(location) {
    const map = mapRef.current;
    if (!map || !location || !Number.isFinite(location.lng) || !Number.isFinite(location.lat)) return;
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: Math.max(map.getZoom(), 16.5),
      duration: 900,
      essential: true
    });
  }

  async function geocodePlace(query) {
    const value = query.trim();
    const player = playerPosRef.current || { lng: mapRef.current.getCenter().lng, lat: mapRef.current.getCenter().lat };
    if (!value) throw new Error('Place not found');
    if (/^(your|my) location$/i.test(value) || /^current location$/i.test(value)) {
      if (!canUsePlayerLocation) throw new Error('Player location unavailable');
      return player;
    }
    const localLocation = findLocalLocation(value);
    if (localLocation) return toLngLat(localLocation);
    const results = await forwardSearchMapboxLocations(value, 1);
    if (results[0]) return toLngLat(results[0]);
    const proximity = `${player.lng},${player.lat}`;
    const params = new URLSearchParams({ q: value, access_token: mapboxToken, limit: '1', proximity });
    const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    const data = await response.json();
    const feature = data.features?.[0];
    if (!response.ok || !feature?.geometry?.coordinates) throw new Error('Place not found');
    const [lng, lat] = feature.geometry.coordinates;
    return { lng, lat, label: feature.properties?.full_address || feature.properties?.name || value };
  }

  async function reverseGeocodeBuilding(lng, lat) {
    const addressParams = new URLSearchParams({
      longitude: String(lng),
      latitude: String(lat),
      access_token: mapboxToken,
      language: 'en',
      country: 'CA',
      types: 'address',
      limit: '1'
    });
    const placeParams = new URLSearchParams({
      longitude: String(lng),
      latitude: String(lat),
      access_token: mapboxToken,
      language: 'en',
      country: 'CA',
      types: 'poi,address',
      limit: '10'
    });
    try {
      const [addressResponse, placeResponse] = await Promise.all([
        fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${addressParams}`),
        fetch(`https://api.mapbox.com/search/searchbox/v1/reverse?${placeParams}`)
      ]);
      const addressData = await addressResponse.json();
      const placeData = await placeResponse.json();
      const addressFeature = addressData.features?.[0];
      const namedFeature = (placeData.features || []).find((feature) => {
        const properties = feature.properties || {};
        return properties.feature_type === 'poi' && properties.name;
      });
      const address = addressFeature?.properties?.full_address
        || addressFeature?.properties?.name_preferred
        || addressFeature?.properties?.name
        || addressFeature?.place_name
        || (placeData.features || []).find((feature) => feature.properties?.feature_type === 'address')?.properties?.full_address
        || null;
      return {
        address,
        name: namedFeature?.properties?.name_preferred
          || namedFeature?.properties?.name
          || null
      };
    } catch (e) {
      return { address: null, name: null };
    }
  }

  async function searchMapboxLocations(query, { sessionToken, signal } = {}) {
    const value = query.trim();
    if (!mapboxToken || value.length < 2) return [];
    const center = getSearchCenter();
    const params = new URLSearchParams({
      q: value,
      access_token: mapboxToken,
      session_token: sessionToken,
      language: 'en',
      country: 'CA',
      limit: '7',
      proximity: `${center.lng},${center.lat}`
    });
    try {
      const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`, { signal });
      const data = await response.json();
      if (!response.ok) return [];
      return (data.suggestions || []).map((suggestion) => {
        const isAddress = suggestion.feature_type === 'address';
        const name = isAddress
          ? suggestion.full_address || suggestion.address || suggestion.name
          : suggestion.name_preferred || suggestion.name || suggestion.full_address;
        return {
          id: `mapbox-${suggestion.mapbox_id}`,
          mapboxId: suggestion.mapbox_id,
          sessionToken,
          name: name || 'Mapbox result',
          aliases: [],
          type: formatLocationType(suggestion.feature_type),
          subtitle: isAddress
            ? suggestion.place_formatted || ''
            : suggestion.full_address || suggestion.place_formatted || '',
          source: 'Mapbox Search Box'
        };
      }).filter((location) => location.mapboxId);
    } catch (e) {
      return [];
    }
  }

  async function retrieveMapboxLocation(location) {
    if (!location.mapboxId || !location.sessionToken) throw new Error('Place not found');
    const center = getSearchCenter();
    const params = new URLSearchParams({
      access_token: mapboxToken,
      session_token: location.sessionToken,
      language: 'en',
      proximity: `${center.lng},${center.lat}`
    });
    const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(location.mapboxId)}?${params}`);
    const data = await response.json();
    const feature = data.features?.[0];
    const [lng, lat] = feature?.geometry?.coordinates || [];
    if (!response.ok || !Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('Place not found');
    const props = feature.properties || {};
    return {
      lng,
      lat,
      label: props.full_address || props.name || location.name
    };
  }

  async function forwardSearchMapboxLocations(query, limit = 1) {
    const value = query.trim();
    if (!mapboxToken || value.length < 2) return [];
    const center = getSearchCenter();
    const params = new URLSearchParams({
      q: value,
      access_token: mapboxToken,
      language: 'en',
      country: 'CA',
      limit: String(limit),
      proximity: `${center.lng},${center.lat}`
    });
    const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`);
    const data = await response.json();
    if (!response.ok) return [];
    return (data.features || []).map((feature) => {
      const props = feature.properties || {};
      const [lng, lat] = feature.geometry?.coordinates || [];
      return {
        id: `mapbox-forward-${props.mapbox_id || feature.id}`,
        name: props.full_address || props.name || value,
        type: formatLocationType(props.feature_type),
        lng,
        lat,
        source: 'Mapbox Search Box'
      };
    }).filter((location) => Number.isFinite(location.lng) && Number.isFinite(location.lat));
  }

  function getSearchCenter() {
    if (canUsePlayerLocation && playerPosRef.current) return playerPosRef.current;
    return mapRef.current?.getCenter() || { lng: MAP_CENTER[0], lat: MAP_CENTER[1] };
  }

  async function handlePlanRoute() {
    if (!routeDestinationText.trim()) return;
    setRouteStatus('loading');
    try {
      const [start, destination] = await Promise.all([
        routeStart || geocodePlace(routeStartText),
        routeDestination || geocodePlace(routeDestinationText)
      ]);
      setRouteStart(start);
      setRouteDestination(destination);
      focusMapOnLocation(destination);
      if (destination.label) setRouteDestinationText(destination.label);
      requestRoute(start, destination, routeModeRef.current, true);
    } catch (e) {
      setRouteStatus('error');
    }
  }

  function handleStartTextChange(value) {
    setRouteStartText(value);
    setRouteStart(null);
    setRoute(null);
    setRouteStatus('idle');
    setRouteSelecting('start');
  }

  function handleDestinationTextChange(value) {
    setRouteDestinationText(value);
    setRouteDestination(null);
    setRoute(null);
    setRouteStatus('idle');
    setRouteSelecting('destination');
  }

  async function handleStartLocationSelect(location) {
    setRouteStartText(location.name);
    setRouteStatus(location.mapboxId ? 'loading' : 'idle');
    try {
      const start = location.isPlayerLocation
        ? playerPosRef.current
        : location.mapboxId ? await retrieveMapboxLocation(location) : toLngLat(location);
      if (!start) throw new Error('Place not found');
      setRouteStart(start);
      setRouteStartText(start.label || location.name);
      focusMapOnLocation(start);
      setRoute(null);
      setRouteStatus('idle');
      setRouteSelecting('destination');
    } catch (e) {
      setRouteStart(null);
      setRouteStatus('error');
    }
  }

  async function handleDestinationLocationSelect(location) {
    setRouteDestinationText(location.name);
    setRouteStatus(location.mapboxId ? 'loading' : 'idle');
    try {
      const destination = location.mapboxId ? await retrieveMapboxLocation(location) : toLngLat(location);
      setRouteDestination(destination);
      setRouteDestinationText(destination.label || location.name);
      focusMapOnLocation(destination);
      setRoute(null);
      setRouteStatus('idle');
      setRouteSelecting('destination');
      if (routeStartRef.current) requestRoute(routeStartRef.current, destination, routeModeRef.current);
    } catch (e) {
      setRouteDestination(null);
      setRouteStatus('error');
    }
  }

  function handleRouteToggle() {
    if (routeOpen) {
      setRouteOpen(false);
      return;
    }
    if (canUsePlayerLocation) {
      const player = { lng: playerPosRef.current.lng, lat: playerPosRef.current.lat, label: 'My location' };
      setRouteStartText('My location');
      setRouteStart(player);
      setRouteSelecting('destination');
    } else {
      if (/^(your|my) location$/i.test(routeStartText)) {
        setRouteStartText('');
        setRouteStart(null);
      }
      setRouteSelecting(routeStart ? 'destination' : 'start');
    }
    setRouteOpen(true);
  }

  function handleRouteModeChange(mode) {
    setRouteMode(mode);
    if (routeDestination) {
      const start = routeStart || playerPosRef.current || mapRef.current?.getCenter();
      if (start) requestRoute(start, routeDestination, mode);
    }
  }

  function handleSwapRouteLocations() {
    const nextStart = routeDestination;
    const nextDestination = routeStart;
    const nextStartText = routeDestinationText;
    const nextDestinationText = routeStartText;
    setRouteStart(nextStart);
    setRouteDestination(nextDestination);
    setRouteStartText(nextStartText);
    setRouteDestinationText(nextDestinationText);
    setRouteSelecting(nextDestination ? 'destination' : 'start');
    setRoute(null);
    setRouteStatus('idle');
    if (nextStart && nextDestination) requestRoute(nextStart, nextDestination, routeModeRef.current, true);
  }

  function startNavigation(simulate) {
    if (!route || !routeDestination) return;
    if (routeMode === 'driving' && !routeCarId) return;
    routeProgressRef.current = { index: 0, point: null };
    setRouteProgress({ index: 0, point: null });
    const first = route.geometry?.coordinates?.[0];
    const start = first ? { lng: first[0], lat: first[1] } : routeStart;
    setNavigation({
      id: Date.now(),
      start,
      destination: routeDestination,
      mode: routeMode,
      carId: routeMode === 'driving' ? routeCarId : null,
      simulate,
      route
    });
    setRouteOpen(false);
    setDriveMode(true);
  }

  function stopNavigation() {
    setNavigation(null);
    setRouteOpen(false);
  }

  function handleNavigationPose(pose) {
    handlePose(pose);
    if (!navigation || !routeDestination || routeStatus === 'loading') return;
    const now = Date.now();
    const coords = navigation.route?.geometry?.coordinates || [];
    const projected = projectPoseOntoRoute(pose, coords, routeProgressRef.current.index);
    if (projected && projected.index >= routeProgressRef.current.index) {
      const previous = routeProgressRef.current;
      const moved = !previous.point || distanceMeters(previous.point[0], previous.point[1], projected.point[0], projected.point[1]) > 0.35;
      if (projected.index > previous.index || moved) {
        const nextProgress = { index: projected.index, point: projected.point };
        routeProgressRef.current = nextProgress;
        setRouteProgress(nextProgress);
      }
    }
    if (now - lastRerouteRef.current < 900) return;
    if (projected && projected.distance > 22) {
      lastRerouteRef.current = now;
      requestRoute(pose, routeDestination, navigation.mode);
    }
  }

  useEffect(() => {
    if (!navigation || !route || route === navigation.route) return;
    setNavigation((current) => current ? { ...current, route } : current);
  }, [route, navigation]);

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

  function handlePose(pose) {
    playerPosRef.current = pose;
    if (!playerPositionAvailable) setPlayerPositionAvailable(true);
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
              <RoutePlanner
                open={routeOpen}
                mode={routeMode}
                destination={routeDestination}
                route={route}
                remainingDistance={remainingRouteSummary?.distance}
                remainingDuration={remainingRouteSummary?.duration}
                status={routeStatus}
                navigationActive={!!navigation}
                navigationMode={navigation?.simulate ? 'simulation' : 'walking'}
                activeField={routeSelecting}
                canUsePlayerLocation={canUsePlayerLocation}
                selectedCarId={routeCarId}
                walkingSpeed={walkingSpeed}
                simulationSpeed={simulationSpeed}
                onToggle={handleRouteToggle}
                startText={routeStartText}
                destinationText={routeDestinationText}
                onStartTextChange={handleStartTextChange}
                onDestinationTextChange={handleDestinationTextChange}
                onStartLocationSelect={handleStartLocationSelect}
                onDestinationLocationSelect={handleDestinationLocationSelect}
                onFieldFocus={setRouteSelecting}
                onSearchLocations={searchMapboxLocations}
                onPlan={handlePlanRoute}
                onSwapLocations={handleSwapRouteLocations}
                onModeChange={handleRouteModeChange}
                onCarSelect={setRouteCarId}
                onWalkingSpeedChange={setWalkingSpeed}
                onSimulationSpeedChange={setSimulationSpeed}
                onClear={() => { setRoute(null); setRouteStart(null); setRouteDestination(null); setRouteDestinationText(''); setRouteStatus('idle'); }}
                onStart={startNavigation}
                onStop={stopNavigation}
              />
            </ControlDock>
          )}
          {driveMode && (
            <CarDriving
              map={mapRef.current}
              onExit={() => { setDriveMode(false); setNavigation(null); }}
              onDistance={() => {}}
              onPose={handleNavigationPose}
              onModeChange={setOnFoot}
              onOpenDealership={() => {}}
              onFleetChange={() => {}}
              lotRequest={null}
              lightPreset={light.preset}
              paused={false}
              hudHidden={hudHidden}
              navigation={navigation}
              walkingSpeed={walkingSpeed}
              simulationSpeed={simulationSpeed}
            />
          )}
        </>
      )}
    </>
  );
}

function findLocalLocation(query) {
  const normalized = query.trim().toLowerCase();
  return locations.find((location) =>
    [location.name, ...(location.aliases || [])].some((name) => name.toLowerCase() === normalized)
  );
}

function findNearestKnownLocation(lng, lat) {
  let nearest = null;
  let nearestDistance = 90;
  locations.forEach((location) => {
    const distance = distanceMeters(lng, lat, location.lng, location.lat);
    if (distance < nearestDistance) {
      nearest = location;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function toLngLat(location) {
  return { lng: location.lng, lat: location.lat, label: location.name };
}

function formatLocationType(value) {
  if (!value) return 'Place';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBuildingType(value) {
  if (!value || value === 'unspecified') return 'Building';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeLineFeature(coordinates) {
  const safeCoordinates = coordinates.length > 1
    ? coordinates
    : coordinates.length === 1 ? [coordinates[0], coordinates[0]] : [[0, 0], [0, 0]];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: safeCoordinates }
  };
}

function remainingRouteCoordinates(route, progress) {
  const coordinates = route?.geometry?.coordinates || [];
  if (coordinates.length < 2) return coordinates;
  const index = Math.min(Math.max(progress?.index || 0, 0), coordinates.length - 2);
  if (!progress?.point) return coordinates.slice(index);
  return [progress.point, ...coordinates.slice(index + 1)];
}

function routeCoordinatesDistance(coordinates) {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += distanceMeters(
      coordinates[index][0],
      coordinates[index][1],
      coordinates[index + 1][0],
      coordinates[index + 1][1]
    );
  }
  return total;
}

function arrowFeatureCollection(features) {
  return { type: 'FeatureCollection', features };
}

function buildAnimatedRouteArrows(coordinates, now) {
  if (coordinates.length < 2) return [];
  const segments = [];
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index];
    const to = coordinates[index + 1];
    const length = distanceMeters(from[0], from[1], to[0], to[1]);
    if (length < 0.05) continue;
    segments.push({ from, to, start: total, length });
    total += length;
  }
  if (!segments.length) return [];
  const spacing = Math.max(20, Math.min(48, total / 8));
  const phase = ((now / 1000) * 11) % spacing;
  const features = [];
  for (let distance = phase + 5; distance < total && features.length < 28; distance += spacing) {
    const segment = segments.find((candidate) => distance <= candidate.start + candidate.length) || segments[segments.length - 1];
    const ratio = Math.min(1, Math.max(0, (distance - segment.start) / segment.length));
    const lng = segment.from[0] + (segment.to[0] - segment.from[0]) * ratio;
    const lat = segment.from[1] + (segment.to[1] - segment.from[1]) * ratio;
    features.push({
      type: 'Feature',
      properties: { bearing: coordinateBearing(segment.from, segment.to) },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    });
  }
  return features;
}

function coordinateBearing(from, to) {
  const east = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const north = to[1] - from[1];
  return (Math.atan2(east, north) * 180) / Math.PI;
}

function projectPoseOntoRoute(pose, coordinates, startIndex = 0) {
  if (coordinates.length < 2) return null;
  const firstSegment = Math.min(Math.max(startIndex, 0), coordinates.length - 2);
  const lastSegment = Math.min(coordinates.length - 2, firstSegment + 140);
  const metersPerLng = 111320 * Math.cos((pose.lat * Math.PI) / 180);
  const metersPerLat = 111320;
  let nearest = null;
  for (let index = firstSegment; index <= lastSegment; index += 1) {
    const from = coordinates[index];
    const to = coordinates[index + 1];
    const ax = (from[0] - pose.lng) * metersPerLng;
    const ay = (from[1] - pose.lat) * metersPerLat;
    const bx = (to[0] - pose.lng) * metersPerLng;
    const by = (to[1] - pose.lat) * metersPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const projectedX = ax + dx * ratio;
    const projectedY = ay + dy * ratio;
    const distance = Math.hypot(projectedX, projectedY);
    if (!nearest || distance < nearest.distance) {
      nearest = {
        index,
        distance,
        point: [pose.lng + projectedX / metersPerLng, pose.lat + projectedY / metersPerLat]
      };
    }
  }
  return nearest;
}
