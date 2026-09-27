'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import locations from '@/data/locations.json';
import { CARS, carDisplayName } from '@/lib/carCatalog';
import styles from './RoutePlanner.module.css';

export default function RoutePlanner({
  open,
  mode,
  destination,
  startText,
  destinationText,
  onStartTextChange,
  onDestinationTextChange,
  onStartLocationSelect,
  onDestinationLocationSelect,
  onFieldFocus,
  onSearchLocations,
  onPlan,
  onSwapLocations,
  route,
  remainingDistance,
  remainingDuration,
  status,
  navigationActive,
  navigationMode,
  activeField,
  canUsePlayerLocation,
  selectedCarId,
  walkingSpeed,
  simulationSpeed,
  onToggle,
  onModeChange,
  onCarSelect,
  onWalkingSpeedChange,
  onSimulationSpeedChange,
  onClear,
  onStart,
  onStop
}) {
  return (
    <>
      {!navigationActive && (
        <button type="button" className={'panel ui-button ' + styles.routeButton} onClick={onToggle}>
          {open ? 'Close route planner' : 'Route planner'}
        </button>
      )}
      {(open || navigationActive) && (
        <section className={'panel ' + styles.panel} aria-label="Route planner">
          <div className={styles.header}>
            <div>
              <div className={styles.eyebrow}>{navigationActive ? 'Navigation' : 'Route calculator'}</div>
              <h2 className={styles.title}>{navigationActive ? 'Follow destination' : 'Plan a route'}</h2>
            </div>
            {!navigationActive && <button type="button" className={styles.close} onClick={onToggle} aria-label="Close">x</button>}
          </div>
          {!navigationActive && (
            <>
              <form className={styles.routeForm} onSubmit={(event) => { event.preventDefault(); onPlan(); }}>
                <LocationInput
                  label="Start"
                  value={startText}
                  placeholder="Choose start on map or search"
                  active={activeField === 'start'}
                  includeMyLocation={canUsePlayerLocation}
                  onChange={onStartTextChange}
                  onSelect={onStartLocationSelect}
                  onActivate={() => onFieldFocus('start')}
                  onSearchLocations={onSearchLocations}
                />
                <button type="button" className={styles.swapButton} onClick={onSwapLocations} aria-label="Swap start and destination">
                  <span aria-hidden="true">⇅</span> Swap
                </button>
                <LocationInput
                  label="Destination"
                  value={destinationText}
                  placeholder="Search buildings and places"
                  active={activeField === 'destination'}
                  onChange={onDestinationTextChange}
                  onSelect={onDestinationLocationSelect}
                  onActivate={() => onFieldFocus('destination')}
                  onSearchLocations={onSearchLocations}
                />
                <button type="submit" className={styles.planButton} disabled={status === 'loading'}>
                  {status === 'loading' ? 'Finding route...' : 'Get directions'}
                </button>
              </form>
              <p className={styles.help}>The highlighted field receives your next map click. Search includes saved game places and live Mapbox results.</p>
              <div className={styles.modes} role="group" aria-label="Travel mode">
                <button type="button" className={mode === 'walking' ? styles.selected : ''} onClick={() => onModeChange('walking')}>Walking</button>
                <button type="button" className={mode === 'driving' ? styles.selected : ''} onClick={() => onModeChange('driving')}>Car</button>
              </div>
              {mode === 'driving' && (
                <CarPicker selectedCarId={selectedCarId} onSelect={onCarSelect} />
              )}
            </>
          )}
          {destination && <div className={styles.destination}>Destination set - {destination.lat.toFixed(4)}, {destination.lng.toFixed(4)}</div>}
          {status === 'error' && <div className={styles.error}>Could not find that place or route. Try a nearby destination.</div>}
          {route && (
            <div className={styles.summary}>
              <strong>{formatDistance(navigationActive ? remainingDistance : route.distance)}</strong>
              <span>{formatDuration(navigationActive ? remainingDuration : route.duration)} - {mode === 'walking' ? 'walking' : 'driving'}</span>
            </div>
          )}
          {(route || navigationActive) && (
            <div className={styles.speedControls}>
              {mode === 'walking' && (
                <SpeedControl label="Walking speed" value={walkingSpeed} min={0.5} max={2} step={0.1} onChange={onWalkingSpeedChange} />
              )}
              <SpeedControl label="Simulation speed" value={simulationSpeed} min={0.5} max={3} step={0.25} onChange={onSimulationSpeedChange} />
            </div>
          )}
          {!navigationActive && route && (
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={status === 'loading' || (mode === 'driving' && !selectedCarId)} onClick={() => onStart(false)}>{mode === 'walking' ? 'Walk it' : 'Drive it'}</button>
              <button type="button" className={styles.secondary} disabled={status === 'loading' || (mode === 'driving' && !selectedCarId)} onClick={() => onStart(true)}>Simulate</button>
              <button type="button" className={styles.link} onClick={onClear}>Clear</button>
            </div>
          )}
          {navigationActive && (
            <div className={styles.actions}>
              <span className={styles.live}>{navigationMode === 'simulation' ? 'Simulation running' : 'Route highlighted on floor'}</span>
              <button type="button" className={styles.secondary} onClick={onStop}>End route</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function CarPicker({ selectedCarId, onSelect }) {
  return (
    <div className={styles.carPicker}>
      <div className={styles.sectionLabel}>Choose a simulated car</div>
      <div className={styles.carGrid}>
        {CARS.map((car) => (
            <button
              key={car.id}
              type="button"
              className={selectedCarId === car.id ? styles.carSelected : ''}
              onClick={() => onSelect(car.id)}
            >
              <i style={{ background: car.color }} aria-hidden="true" />
              <span>{carDisplayName(car)}</span>
              <small>{Math.round(car.maxSpeed * 3.6)} km/h</small>
            </button>
        ))}
      </div>
    </div>
  );
}

function SpeedControl({ label, value, min, max, step, onChange }) {
  return (
    <label className={styles.speedControl}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{Number(value).toFixed(2).replace(/\.?0+$/, '')}x</strong>
    </label>
  );
}

function LocationInput({
  label,
  value,
  placeholder,
  active,
  includeMyLocation = false,
  onChange,
  onSelect,
  onActivate,
  onSearchLocations
}) {
  const [focused, setFocused] = useState(false);
  const [remoteMatches, setRemoteMatches] = useState([]);
  const sessionTokenRef = useRef(null);
  const localMatches = useMemo(() => {
    const query = normalize(value);
    if (query.length < 2) return [];
    return locations
      .map((location) => {
        const names = [location.name, ...(location.aliases || [])].map(normalize);
        return { location, score: Math.min(...names.map((name) => textMatchScore(query, name))) };
      })
      .filter(({ score }) => score < 100)
      .sort((a, b) => a.score - b.score || a.location.name.localeCompare(b.location.name))
      .slice(0, 5)
      .map(({ location }) => location);
  }, [value]);

  useEffect(() => {
    const query = value.trim();
    if (!focused || query.length < 2 || /^(my|your|current) location$/i.test(query)) {
      setRemoteMatches([]);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!sessionTokenRef.current) sessionTokenRef.current = createSessionToken();
      const results = await onSearchLocations(query, {
        sessionToken: sessionTokenRef.current,
        signal: controller.signal
      });
      if (!cancelled) setRemoteMatches(results);
    }, 300);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [focused, onSearchLocations, value]);

  const matches = useMemo(() => {
    const query = normalize(value);
    const playerLocation = includeMyLocation && (!query || 'my location'.includes(query))
      ? [{ id: 'player-location', name: 'My location', type: 'Current character', isPlayerLocation: true }]
      : [];
    const seen = new Set(playerLocation.map((location) => normalize(location.name)));
    const combined = [...playerLocation];
    [...localMatches, ...remoteMatches].forEach((location) => {
      const key = normalize(location.name);
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(location);
      }
    });
    return combined.slice(0, 7);
  }, [includeMyLocation, localMatches, remoteMatches, value]);

  const showSuggestions = focused && matches.length > 0;

  return (
    <label className={styles.field + (active ? ' ' + styles.fieldActive : '')}>
      <span>{label}{active ? ' - click map to set' : ''}</span>
      <div className={styles.inputWrap}>
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          onFocus={() => { setFocused(true); onActivate(); }}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
        />
        {showSuggestions && (
          <div className={styles.suggestions} role="listbox">
            {matches.map((location) => (
              <button
                key={location.id}
                type="button"
                role="option"
                aria-selected="false"
                className={styles.suggestion}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setFocused(false);
                  setRemoteMatches([]);
                  onSelect(location);
                  sessionTokenRef.current = null;
                }}
              >
                <span className={styles.suggestionText}>
                  <strong>{location.name}</strong>
                  {location.subtitle && <small>{location.subtitle}</small>}
                </span>
                <small className={styles.suggestionType}>{location.type}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function textMatchScore(query, candidate) {
  if (!query) return 10;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.split(/\s+/).filter(Boolean);
  if (queryTokens.every((token) => candidateTokens.some((candidateToken) => candidateToken.startsWith(token)))) return 2;
  if (candidate.includes(query)) return 3;
  return 100;
}

function createSessionToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `search-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds <= 5) return 'Arrived';
  if (seconds < 60) return '<1 min';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
