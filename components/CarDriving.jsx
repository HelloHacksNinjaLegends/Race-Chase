'use client';

// Play session: the player starts on foot as the blob character and can get
// into any of their cars that are parked in the world (E), drive, and get
// out again (E). Cars only come from the dealership's lot. Mounted by
// BuildingMap (via next/dynamic, so three.js only loads when first used)
// and handed the existing map instance — it never creates or destroys the
// map itself. While mounted it owns the map camera; on unmount it puts
// everything back.
//
// This component only wires things together; the systems live in lib/:
// playerState.js (on foot ↔ driving state machine), vehicle.js (car
// physics), vehicleRig.js + carModel.js (car models), character.js
// (walking), blobCharacterModel.js, traffic.js (NPC cars on OSM roads, with
// mapboxRoads.js as a fallback), followCamera.js, dealership.js,
// worldLayer.js (rendering), buildingCollision.js, and worldSave.js (parked
// cars + player position survive sessions/reloads).

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import GameHud from './GameHud';
import { carDisplayName, getCar } from '@/lib/carCatalog';
import { setCarModel, cancelCarModel, spinWheels, setLampLevel, disposeObject } from '@/lib/carModel';
import { SCENE_LIGHTING } from '@/lib/sceneLighting';
import { buildBlobCharacter, poseBlobCharacter } from '@/lib/blobCharacterModel';
import { ON_FOOT, DRIVING, resolveInteract, interactPrompt, nextState } from '@/lib/playerState';
import { lotSlot, LOT_SLOT_COUNT, isAtDealership } from '@/lib/dealership';
import { createWorldLayer } from '@/lib/worldLayer';
import { createBuildingCollider, offsetLngLat, distanceMeters, localOffsetMeters } from '@/lib/buildingCollision';
import { createVehicle, stepVehicle, pointInVehicle } from '@/lib/vehicle';
import { createCharacter, stepCharacter } from '@/lib/character';
import { createTraffic } from '@/lib/traffic';
import { buildRoadGraphFromMap } from '@/lib/mapboxRoads';
import { loadWorld, saveWorld } from '@/lib/worldSave';
import { createFollowCamera, cameraProfile, CAMERA_MAX_ZOOM } from '@/lib/followCamera';
import { loadCameraView, saveCameraView, nextCameraView } from '@/lib/cameraView';
import {
  MAP_PITCH,
  DRIVE_START,
  DRIVE_SPAWN_MIN_ZOOM,
  CAR_WIDTH,
  WALK_SPEED,
  CHARACTER_RADIUS,
  ENTER_CAR_RANGE_M
} from '@/lib/constants';

const WORLD_LAYER_ID = 'drive-world';
const INTRO_DURATION_MS = 1200;
// Cap on per-frame time step, so a backgrounded tab doesn't make things jump.
const MAX_FRAME_DT = 0.05;
const SAVE_INTERVAL_MS = 2000;
const CONTROLS_HINT_MS = 7000;
// Before showing "Loading traffic…" (the map-tile fallback usually lands first).
const TRAFFIC_LOADING_HINT_AFTER_MS = 4000;

// Map interaction handlers that would fight the follow camera.
const USER_HANDLERS = [
  'dragPan',
  'dragRotate',
  'scrollZoom',
  'boxZoom',
  'doubleClickZoom',
  'touchZoomRotate',
  'touchPitch',
  'keyboard'
];

const KEY_BINDINGS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run'
};

/**
 * @param {boolean}  props.paused       True while a menu is open: input is ignored and the car brakes.
 * @param {boolean}  props.hudHidden    Hide the HUD entirely (toggled with H by the parent).
 * @param {string}   props.lightPreset  Current Mapbox Standard light preset (dawn/day/dusk/night).
 * @param {{id: string}} props.lotRequest  A new object each time a car should be parked on the
 *                                         dealership lot (bought, or moved there).
 * @param {function} props.onExit       Leave play mode.
 * @param {function} props.onDistance   Called with meters driven, every frame the car moves (not on foot).
 * @param {function} props.onPose       Called with the player's {lng, lat, heading} ~10×/s.
 * @param {function} props.onModeChange Called with true/false when the player gets out of / into a car.
 * @param {function} props.onOpenDealership  E pressed at the dealership.
 * @param {function} props.onFleetChange     Called with [{carId, lng, lat, inUse}] when owned cars move.
 */
export default function CarDriving({
  map,
  lotRequest,
  paused,
  hudHidden,
  onExit,
  onDistance,
  onPose,
  onModeChange,
  onOpenDealership,
  onFleetChange,
  lightPreset
}) {
  // The controls hint shows for the first few seconds of a drive, then fades.
  const [showControls, setShowControls] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowControls(false), CONTROLS_HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  const [hud, setHud] = useState({
    speedKmh: 0,
    blocked: false,
    onFoot: true,
    interact: null,
    trafficLoading: false,
    view: 'chase'
  });

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onDistanceRef = useRef(onDistance);
  onDistanceRef.current = onDistance;
  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;
  const onOpenDealershipRef = useRef(onOpenDealership);
  onOpenDealershipRef.current = onOpenDealership;
  const onFleetChangeRef = useRef(onFleetChange);
  onFleetChangeRef.current = onFleetChange;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lightPresetRef = useRef(lightPreset);
  lightPresetRef.current = lightPreset;
  // Set by the main effect; lets later effects reach the running session.
  const sessionRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;

    const world = createWorldLayer(WORLD_LAYER_ID);
    const repaint = () => map.triggerRepaint();
    const npcs = new Set(); // live NPC traffic, for wheel spin
    const collider = createBuildingCollider(map);

    // --- Owned cars in the world. Each: { def, state, object, handle } ---
    const vehicles = [];

    function spawnVehicle(def, lng, lat, heading) {
      const object = new THREE.Group();
      setCarModel(object, def, repaint);
      const state = createVehicle(lng, lat, heading);
      const vehicle = { def, state, object, handle: world.add(object, state) };
      vehicles.push(vehicle);
      return vehicle;
    }

    function despawnVehicle(vehicle) {
      world.remove(vehicle.handle);
      cancelCarModel(vehicle.object);
      disposeObject(vehicle.object);
      vehicles.splice(vehicles.indexOf(vehicle), 1);
    }

    // --- The player: always starts on foot (state machine: lib/playerState.js) ---
    //
    // Zoomed in, the character appears at the map center (free spawn).
    // Zoomed out, they resume where the last session left off — beside the
    // car if they were driving — or at DRIVE_START the first time. Parked
    // cars are restored where they were left; no car is ever spawned here.
    const saved = loadWorld();
    const center = map.getCenter();
    const zoomedIn = map.getZoom() >= DRIVE_SPAWN_MIN_ZOOM;
    const resume = zoomedIn ? null : saved.player;

    let state = ON_FOOT;
    let driven = null; // the vehicle being driven, when state === DRIVING
    const character = createCharacter();
    const characterObject = buildBlobCharacter();
    let characterHandle = null;

    for (const p of saved.parked) {
      if (vehicles.some((v) => v.def.id === p.carId)) continue;
      spawnVehicle(getCar(p.carId), p.lng, p.lat, p.heading);
    }
    if (resume && resume.mode === 'driving' && !vehicles.some((v) => v.def.id === resume.carId)) {
      // Last session ended at the wheel: that car is parked where it stopped.
      spawnVehicle(getCar(resume.carId), resume.lng, resume.lat, resume.heading);
    }

    function player() {
      return driven ? driven.state : character;
    }

    // Put the character down: at `spot` if given, else beside the car when
    // resuming a drive, else the free-spawn / resume / default point.
    function placeCharacter(lng, lat, heading) {
      Object.assign(character, { lng, lat, heading, speed: 0, walkPhase: 0 });
      poseBlobCharacter(characterObject, 0, 0);
      if (!characterHandle) characterHandle = world.add(characterObject, character);
    }

    // --- NPC traffic (rendered here, simulated in lib/traffic.js) ---
    // Refreshed each frame: camera position/bearing and canvas size, for
    // keeping NPC spawns and despawns off-screen.
    const view = { lng: 0, lat: 0, bearing: 0, width: 0, height: 0 };
    function updateView() {
      const cam = map.getFreeCameraOptions().position;
      const camLngLat = cam ? cam.toLngLat() : map.getCenter();
      const canvas = map.getCanvas();
      Object.assign(view, {
        lng: camLngLat.lng,
        lat: camLngLat.lat,
        bearing: map.getBearing(),
        width: canvas.clientWidth,
        height: canvas.clientHeight
      });
    }
    function isOnScreen(lng, lat) {
      // project() mirrors points behind the camera onto the screen, so rule those out first.
      const [east, north] = localOffsetMeters(view.lng, view.lat, lng, lat);
      const b = (view.bearing * Math.PI) / 180;
      if (east * Math.sin(b) + north * Math.cos(b) < 0) return false;
      const p = map.project([lng, lat]);
      const margin = 80;
      return p.x > -margin && p.x < view.width + margin && p.y > -margin && p.y < view.height + margin;
    }

    const traffic = createTraffic({
      fallbackGraph: (lng, lat, radiusM) => buildRoadGraphFromMap(map, lng, lat, radiusM),
      isVisible: isOnScreen,
      onSpawn(npc) {
        npc.object = new THREE.Group();
        setCarModel(npc.object, npc, repaint);
        npc.handle = world.add(npc.object, npc);
        npcs.add(npc);
      },
      onDespawn(npc) {
        npcs.delete(npc);
        world.remove(npc.handle);
        cancelCarModel(npc.object);
        disposeObject(npc.object);
      }
    });

    // --- Collision predicates ---
    function blocksCar(self) {
      return (lng, lat) =>
        collider.contains(lng, lat) ||
        traffic.blocks(lng, lat) ||
        vehicles.some((v) => v !== self && pointInVehicle(v.state, lng, lat));
    }
    function blocksWalker(lng, lat) {
      return (
        collider.contains(lng, lat) || traffic.blocks(lng, lat) || vehicles.some((v) => pointInVehicle(v.state, lng, lat))
      );
    }
    // What NPC cars stop for: the player's cars and the character.
    function blocksTraffic(lng, lat) {
      if (!driven && distanceMeters(character.lng, character.lat, lng, lat) < 1) return true;
      return vehicles.some((v) => pointInVehicle(v.state, lng, lat));
    }
    function isClearForCharacter(lng, lat) {
      return (
        !collider.contains(lng, lat) &&
        !traffic.blocks(lng, lat) &&
        !vehicles.some((v) => pointInVehicle(v.state, lng, lat, CHARACTER_RADIUS))
      );
    }

    // --- Getting in and out (applied only via applyInteract below) ---

    // Beside a car's driver (left) door, or the passenger side if that's blocked.
    function doorSpot(car) {
      const side = CAR_WIDTH / 2 + CHARACTER_RADIUS + 0.4;
      const left = offsetLngLat(car.lng, car.lat, car.heading - 90, side);
      if (isClearForCharacter(left[0], left[1])) return left;
      const right = offsetLngLat(car.lng, car.lat, car.heading + 90, side);
      return isClearForCharacter(right[0], right[1]) ? right : left;
    }

    function nearestEnterableCar() {
      let best = null;
      let bestDistance = Infinity;
      for (const v of vehicles) {
        if (!pointInVehicle(v.state, character.lng, character.lat, ENTER_CAR_RANGE_M)) continue;
        const d = distanceMeters(character.lng, character.lat, v.state.lng, v.state.lat);
        if (d < bestDistance) {
          best = v;
          bestDistance = d;
        }
      }
      return best;
    }

    function interactContext() {
      const car = state === ON_FOOT ? nearestEnterableCar() : null;
      return {
        state,
        nearestCar: car ? { id: car.def.id, name: carDisplayName(car.def), vehicle: car } : null,
        atDealership: state === ON_FOOT && isAtDealership(character.lng, character.lat)
      };
    }

    /** The single place the on-foot / driving state changes. */
    function applyInteract(ctx, action) {
      if (action.type === 'enterCar') {
        world.remove(characterHandle);
        characterHandle = null;
        character.speed = 0;
        driven = ctx.nearestCar.vehicle;
      } else if (action.type === 'exitCar') {
        const car = driven.state;
        car.speed = 0;
        car.steer = 0;
        const [lng, lat] = doorSpot(car);
        placeCharacter(lng, lat, car.heading);
        driven = null;
      } else if (action.type === 'openDealership') {
        releaseAll();
        if (onOpenDealershipRef.current) onOpenDealershipRef.current();
      }
      state = nextState(state, action);
      if (action.type === 'enterCar' || action.type === 'exitCar') {
        releaseAll(); // don't carry held keys across the switch
        reportFleet();
      }
    }

    // Park `def` on the dealership lot: the only way a car enters the world.
    // An owned car that's already out somewhere is moved there instead.
    function deliverToLot(def) {
      const existing = vehicles.find((v) => v.def.id === def.id);
      if (existing && existing === driven) return; // can't happen from the menu (on foot only)
      const others = vehicles.filter((v) => v !== existing);
      let slot = null;
      for (let i = 0; i < LOT_SLOT_COUNT && !slot; i++) {
        const candidate = lotSlot(i);
        const taken = others.some((v) => pointInVehicle(v.state, candidate.lng, candidate.lat, CAR_WIDTH));
        if (!taken) slot = candidate;
      }
      slot = slot || lotSlot(0);
      if (existing) {
        Object.assign(existing.state, { lng: slot.lng, lat: slot.lat, heading: slot.heading, speed: 0, steer: 0 });
      } else {
        spawnVehicle(def, slot.lng, slot.lat, slot.heading);
      }
      reportFleet();
      map.triggerRepaint();
    }

    // Where each owned car is, for the garage list.
    let lastFleetKey = null; // null = never reported, so an empty fleet is reported too
    function reportFleet() {
      const fleet = vehicles.map((v) => ({
        carId: v.def.id,
        lng: v.state.lng,
        lat: v.state.lat,
        inUse: v === driven
      }));
      const key = fleet.map((f) => f.carId + (f.inUse ? '*' : '') + f.lng.toFixed(4) + f.lat.toFixed(4)).join('|');
      if (key === lastFleetKey) return;
      lastFleetKey = key;
      if (onFleetChangeRef.current) onFleetChangeRef.current(fleet);
    }

    // Starting position (see the note at the top of this section).
    if (resume && resume.mode === 'driving') {
      const car = vehicles.find((v) => v.def.id === resume.carId);
      const [lng, lat] = doorSpot(car.state);
      placeCharacter(lng, lat, resume.heading);
    } else if (resume) {
      placeCharacter(resume.lng, resume.lat, resume.heading);
    } else {
      const [lng, lat] = zoomedIn ? [center.lng, center.lat] : DRIVE_START;
      placeCharacter(lng, lat, map.getBearing());
    }
    reportFleet();

    // --- Saving the world ---    // --- Saving the world ---
    function save() {
      const me = player();
      saveWorld({
        parked: vehicles
          .filter((v) => v !== driven)
          .map((v) => ({ carId: v.def.id, lng: v.state.lng, lat: v.state.lat, heading: v.state.heading })),
        player: driven
          ? { mode: 'driving', carId: driven.def.id, lng: me.lng, lat: me.lat, heading: me.heading }
          : { mode: 'walking', lng: me.lng, lat: me.lat, heading: me.heading }
      });
    }
    window.addEventListener('pagehide', save);

    // Match the 3D objects' lighting (and car lamps) to the basemap's time of day.
    function setLighting(preset) {
      const lighting = SCENE_LIGHTING[preset] || SCENE_LIGHTING.day;
      world.setLighting(lighting);
      setLampLevel(lighting.lamps);
    }

    sessionRef.current = { deliverToLot, setLighting };

    // --- Camera view: 'chase' (third person) or 'pov' (first person), cycled with C ---
    let cameraView = loadCameraView();

    // --- Keyboard input ---
    const pressed = { up: false, down: false, left: false, right: false, run: false };

    function handleKey(e) {
      if (isTypingTarget(e.target)) return;
      const isDown = e.type === 'keydown';
      if (isDown && e.code === 'Escape' && !pausedRef.current) {
        onExitRef.current();
        return;
      }
      if (isDown && e.code === 'KeyC') {
        e.preventDefault();
        if (e.repeat) return;
        cameraView = nextCameraView(cameraView);
        saveCameraView(cameraView);
        lastHudUpdate = 0; // show the new view in the HUD right away
        return;
      }
      if (isDown && e.code === 'KeyE') {
        e.preventDefault();
        if (e.repeat || pausedRef.current) return;
        const ctx = interactContext();
        applyInteract(ctx, resolveInteract(ctx));
        lastHudUpdate = 0; // reflect the new state in the HUD right away
        return;
      }
      const action = KEY_BINDINGS[e.code];
      if (!action) return;
      e.preventDefault();
      pressed[action] = isDown;
    }
    function releaseAll() {
      Object.keys(pressed).forEach((k) => {
        pressed[k] = false;
      });
    }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
    window.addEventListener('blur', releaseAll);

    // --- Take over the camera ---
    const disabledHandlers = USER_HANDLERS.filter((name) => map[name] && map[name].isEnabled());
    disabledHandlers.forEach((name) => map[name].disable());
    // Eye-level POV needs zooms past Mapbox's default limit of 22.
    const previousMaxZoom = map.getMaxZoom();
    activeSessions++;
    map.setMaxZoom(CAMERA_MAX_ZOOM);

    map.addLayer(world.layer);
    setLighting(lightPresetRef.current);

    // Ease from wherever the user was into the follow view before handing
    // control to the per-frame camera.
    const camera = createFollowCamera(map, player(), cameraProfile(!driven, cameraView));
    map.easeTo({ ...camera.introOptions(), duration: INTRO_DURATION_MS });
    const introEndsAt = performance.now() + INTRO_DURATION_MS;

    // --- Per-frame loop ---
    let frameId = 0;
    let lastTime = performance.now();
    let lastHudUpdate = 0;
    let blockedUntil = 0;
    let lastHud = null;
    let lastSave = performance.now();
    const trafficStartedAt = performance.now();

    function step(now) {
      frameId = requestAnimationFrame(step);
      const dt = Math.min((now - lastTime) / 1000, MAX_FRAME_DT);
      lastTime = now;

      if (now < introEndsAt) {
        map.triggerRepaint();
        return;
      }

      const me = player();
      collider.update(me.lng, me.lat, now);

      const isPaused = pausedRef.current;
      const forward = isPaused ? 0 : (pressed.up ? 1 : 0) - (pressed.down ? 1 : 0);
      const turn = isPaused ? 0 : (pressed.right ? 1 : 0) - (pressed.left ? 1 : 0);

      let result;
      if (driven) {
        result = stepVehicle(driven.state, { throttle: forward, steer: turn, brake: isPaused }, driven.def, dt, blocksCar(driven));
        if (result.distance > 0) {
          spinWheels(driven.object, Math.sign(driven.state.speed) * result.distance);
          if (onDistanceRef.current) onDistanceRef.current(result.distance);
        }
      } else {
        result = stepCharacter(character, { forward, turn, run: pressed.run }, dt, blocksWalker);
        poseBlobCharacter(characterObject, character.walkPhase, Math.min(Math.abs(character.speed) / WALK_SPEED, 1));
      }
      if (result.blocked) blockedUntil = now + 700;

      updateView();
      traffic.update(dt, me, now, blocksTraffic);
      for (const npc of npcs) spinWheels(npc.object, npc.moved);

      if (now - lastSave > SAVE_INTERVAL_MS) {
        lastSave = now;
        save();
        reportFleet();
      }

      camera.update(me, cameraProfile(!driven, cameraView), dt);
      // In first person on foot, the camera is inside the character's head.
      characterObject.visible = !!driven || cameraView !== 'pov';
      map.triggerRepaint();

      // HUD + pose reports are throttled so React isn't re-rendering at 60 fps.
      if (now - lastHudUpdate > 100) {
        lastHudUpdate = now;
        if (onPoseRef.current) onPoseRef.current({ lng: me.lng, lat: me.lat, heading: me.heading });
        const next = {
          speedKmh: Math.round(Math.abs(me.speed) * 3.6),
          blocked: now < blockedUntil,
          onFoot: state === ON_FOOT,
          interact: interactPrompt(interactContext()),
          trafficLoading:
            traffic.status.source === 'loading' && now - trafficStartedAt > TRAFFIC_LOADING_HINT_AFTER_MS,
          view: cameraView
        };
        if (!lastHud || Object.keys(next).some((k) => next[k] !== lastHud[k])) {
          lastHud = next;
          setHud(next);
        }
      }
    }
    frameId = requestAnimationFrame(step);

    return () => {
      sessionRef.current = null;
      cancelAnimationFrame(frameId);
      save();
      window.removeEventListener('pagehide', save);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', handleKey);
      window.removeEventListener('blur', releaseAll);

      const me = player();
      // The map may already be gone if BuildingMap is tearing it down too.
      try {
        if (map.getLayer(WORLD_LAYER_ID)) map.removeLayer(WORLD_LAYER_ID);
        disabledHandlers.forEach((name) => map[name].enable());
        map.easeTo({ center: [me.lng, me.lat], zoom: 16.5, pitch: MAP_PITCH, bearing: me.heading, duration: 900 });
        // Put the zoom limit back once the camera has pulled out (unless a new
        // drive session has started in the meantime).
        activeSessions--;
        map.once('moveend', () => {
          if (activeSessions === 0) map.setMaxZoom(previousMaxZoom);
        });
      } catch (e) {
        // map already removed — nothing to restore
      }
      vehicles.slice().forEach(despawnVehicle);
      traffic.dispose();
      collider.dispose();
      disposeObject(characterObject);
    };
  }, [map]);

  useEffect(() => {
    if (sessionRef.current) sessionRef.current.setLighting(lightPreset);
  }, [lightPreset]);

  // A car bought or moved at the dealership: park it on the lot.
  useEffect(() => {
    if (lotRequest && sessionRef.current) sessionRef.current.deliverToLot(getCar(lotRequest.id));
  }, [lotRequest]);

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  useEffect(() => {
    if (onModeChangeRef.current) onModeChangeRef.current(hud.onFoot);
  }, [hud.onFoot]);

  if (hudHidden) return null;

  let prompt = hud.trafficLoading ? 'Loading road data for traffic…' : null;
  if (hud.interact) {
    prompt = (
      <>
        Press <kbd>E</kbd> {hud.interact}
      </>
    );
  }

  return (
    <GameHud
      speedKmh={hud.speedKmh}
      view={hud.view}
      onFoot={hud.onFoot}
      timeOfDay={lightPreset}
      prompt={prompt}
      warning={hud.blocked && !hud.onFoot && !hud.interact ? 'Blocked — reverse or steer away' : null}
      showControls={showControls}
    />
  );
}

// Drive sessions currently mounted; the zoom limit is only restored when none are.
let activeSessions = 0;

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
