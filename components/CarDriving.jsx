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
// mapboxRoads.js as a fallback), orbitCamera.js, dealership.js,
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
import { createPhysicsWorld } from '@/lib/physicsWorld';
import { stepGravity } from '@/lib/gravity';
import { createBuildingPhysics } from '@/lib/buildingPhysics';
import { createHelicopter, stepHelicopter, removeHelicopter, teleportHelicopter } from '@/lib/helicopterVehicle';
import { setHelicopterModel, spinRotors } from '@/lib/helicopterModel';
import { createAirplane, stepAirplane, removeAirplane, teleportAirplane } from '@/lib/airplaneVehicle';
import { setAirplaneModel, cancelAirplaneModel } from '@/lib/airplaneModel';
import { getPlane, PLANES } from '@/lib/planeCatalog';
import { airportSlot, findTerminalGate } from '@/lib/airportSpawn';
import { buildJetBridge } from '@/lib/jetBridgeModel';
import { loadWorld, saveWorld } from '@/lib/worldSave';
import { createOrbitCamera } from '@/lib/orbitCamera';
import { freezeRoadWidths, unfreezeRoadWidths } from '@/lib/mapStyling';
import {
  MAP_PITCH,
  DRIVE_START,
  DRIVE_SPAWN_MIN_ZOOM,
  CAR_WIDTH,
  WALK_SPEED,
  CHARACTER_RADIUS,
  ENTER_CAR_RANGE_M,
  ORBIT_MIN_PITCH_DEG,
  ORBIT_MAX_PITCH_DEG,
  ORBIT_YAW_SENSITIVITY,
  ORBIT_PITCH_SENSITIVITY,
  WALK_ORBIT_CAMERA,
  DRIVE_ORBIT_CAMERA,
  HELICOPTER_ORBIT_CAMERA,
  AIRPLANE_ORBIT_CAMERA
} from '@/lib/constants';

const WORLD_LAYER_ID = 'drive-world';
const INTRO_DURATION_MS = 1200;
// Cap on per-frame time step, so a backgrounded tab doesn't make things jump.
const MAX_FRAME_DT = 0.05;
const SAVE_INTERVAL_MS = 2000;
// How often to retry snapping a still-parked default plane to the real
// terminal building (lib/airportSpawn.js's findTerminalGate) — cheap to
// retry since it stops on its own once every default plane is resolved.
const GATE_ATTEMPT_INTERVAL_MS = 1000;
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
  ShiftRight: 'run',
  KeyQ: 'descend'
};
// A quick tap of E (shorter than this) exits a landed helicopter; holding it
// longer is read as "climb" instead — see handleKey's KeyE case.
const HELICOPTER_E_TAP_MS = 250;

/**
 * @param {boolean}  props.paused       True while a menu is open: input is ignored and the car brakes.
 * @param {boolean}  props.hudHidden    Hide the HUD entirely (toggled with H by the parent).
 * @param {string}   props.lightPreset  Current Mapbox Standard light preset (dawn/day/dusk/night).
 * @param {{id: string}} props.lotRequest  A new object each time a car should be parked on the
 *                                         dealership lot (bought, or moved there).
 * @param {{id: string}} props.summonRequest  A new object each time the phone summons an owned
 *                                             car to the player's current location.
 * @param {{id: string}} props.planeSummonRequest  A new object each time the phone summons a
 *                                                  plane/jet to the player's current location —
 *                                                  from anywhere, not just the airport.
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
  summonRequest,
  planeSummonRequest,
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
    altitudeM: null,
    blocked: false,
    onFoot: true,
    interact: null,
    trafficLoading: false
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

    // --- Physics (helicopters/planes, and the character/car's gravity): a
    // shared cannon-es world, anchored at the fixed start point. Car-vs-
    // building/NPC collision stays on the point-probe system above; see
    // lib/physicsWorld.js for why.
    const physics = createPhysicsWorld(DRIVE_START[0], DRIVE_START[1]);
    collider.update(DRIVE_START[0], DRIVE_START[1], performance.now());
    // Building box colliders for the helicopter/plane and the gravity system's
    // ground raycast (see lib/buildingPhysics.js).
    const buildingPhysics = createBuildingPhysics({ physics, collider });

    // --- Owned cars in the world. Each: { def, state, object, handle } ---
    const vehicles = [];
    // Static jet-bridge props added once a default plane's gate is found —
    // see the gate-snap loop in step(), below.
    const jetBridges = [];

    function spawnVehicle(def, lng, lat, heading) {
      const object = new THREE.Group();
      let state;
      if (def.kind === 'helicopter') {
        setHelicopterModel(object, def);
        state = createHelicopter(physics, lng, lat, heading);
      } else if (def.kind === 'airplane') {
        setAirplaneModel(object, def);
        state = createAirplane(physics, lng, lat, heading);
      } else {
        setCarModel(object, def, repaint);
        state = createVehicle(lng, lat, heading);
      }
      const vehicle = { def, state, object, handle: world.add(object, state) };
      vehicles.push(vehicle);
      return vehicle;
    }

    function despawnVehicle(vehicle) {
      world.remove(vehicle.handle);
      if (vehicle.def.kind === 'helicopter') {
        removeHelicopter(vehicle.state);
      } else if (vehicle.def.kind === 'airplane') {
        removeAirplane(vehicle.state);
        cancelAirplaneModel(vehicle.object);
      } else {
        cancelCarModel(vehicle.object);
      }
      disposeObject(vehicle.object);
      vehicles.splice(vehicles.indexOf(vehicle), 1);
    }

    // Moves a parked (not driven) vehicle to lng/lat/heading — used by the
    // dealership lot and the phone summon, for both cars and helicopters.
    function repositionVehicle(vehicle, lng, lat, heading) {
      if (vehicle.def.kind === 'helicopter') {
        teleportHelicopter(vehicle.state, lng, lat, heading);
      } else if (vehicle.def.kind === 'airplane') {
        teleportAirplane(vehicle.state, lng, lat, heading);
      } else {
        Object.assign(vehicle.state, { lng, lat, heading, speed: 0, steer: 0 });
      }
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

    // getCar() falls back to the default car for an unrecognized id, so the
    // plane catalog is checked first — otherwise a saved plane would come
    // back as a starter hatchback.
    function getVehicleDef(id) {
      return getPlane(id) && getPlane(id).id === id ? getPlane(id) : getCar(id);
    }

    for (const p of saved.parked) {
      if (vehicles.some((v) => v.def.id === p.carId)) continue;
      spawnVehicle(getVehicleDef(p.carId), p.lng, p.lat, p.heading);
    }
    if (resume && resume.mode === 'driving' && !vehicles.some((v) => v.def.id === resume.carId)) {
      // Last session ended at the wheel: that car is parked where it stopped.
      spawnVehicle(getVehicleDef(resume.carId), resume.lng, resume.lat, resume.heading);
    }
    // The default airplanes are never bought — each one is just always
    // parked at its own spot on YVR's apron (see lib/airportSpawn.js) until
    // it's flown somewhere else, in which case the save/restore above
    // already put it back there. A plane only gets its default apron spot
    // here the first time it's ever seen; once taken, nothing re-spawns a
    // replacement — this is a fixed set, not a source you can pull more from.
    // `pendingGateSnap` marks one for the gate-snap retry loop in step():
    // once real terminal-building data is available nearby, it gets moved
    // from this apron fallback to an actual gate against the terminal wall.
    PLANES.forEach((def, i) => {
      if (vehicles.some((v) => v.def.id === def.id)) return;
      const slot = airportSlot(i);
      const vehicle = spawnVehicle(def, slot.lng, slot.lat, slot.heading);
      vehicle.pendingGateSnap = true;
    });

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
        collider.contains(lng, lat) ||
        traffic.blocks(lng, lat) ||
        vehicles.some((v) => pointInVehicle(v.state, lng, lat))
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
        // Can't board an aircraft mid-flight — only once it's landed.
        if (v.def.kind !== 'car' && v.state.altitude > 1) continue;
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
        // Once taken, stop trying to snap it to a terminal gate — it's the
        // player's to park wherever they like from here on.
        driven.pendingGateSnap = false;
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
        repositionVehicle(existing, slot.lng, slot.lat, slot.heading);
      } else {
        spawnVehicle(def, slot.lng, slot.lat, slot.heading);
      }
      reportFleet();
      map.triggerRepaint();
    }

    // Phone: summon `def` to wherever the player is standing, parking any
    // other owned car that's currently out so we don't litter the map with
    // duplicates. Only meaningful on foot (the phone UI is closed otherwise).
    function summonCar(def) {
      if (state !== ON_FOOT) return;
      for (const v of vehicles.slice()) {
        if (v.def.id !== def.id) deliverToLot(v.def);
      }
      const spot = summonSpot(character.lng, character.lat, character.heading);
      const existing = vehicles.find((v) => v.def.id === def.id);
      if (existing) {
        repositionVehicle(existing, spot.lng, spot.lat, spot.heading);
      } else {
        spawnVehicle(def, spot.lng, spot.lat, spot.heading);
      }
      reportFleet();
      map.triggerRepaint();
    }

    // Phone: summon a plane/jet to wherever the player is standing — from
    // anywhere, not just the airport. Unlike summonCar, this never touches
    // any other vehicle (planes have no dealership lot to declutter to).
    function summonPlane(def) {
      if (state !== ON_FOOT) return;
      const spot = summonSpot(character.lng, character.lat, character.heading);
      const existing = vehicles.find((v) => v.def.id === def.id);
      if (existing) {
        existing.pendingGateSnap = false; // the player placed it now, not the airport
        repositionVehicle(existing, spot.lng, spot.lat, spot.heading);
      } else {
        spawnVehicle(def, spot.lng, spot.lat, spot.heading);
      }
      reportFleet();
      map.triggerRepaint();
    }

    // A clear-ish spot just ahead of the character (or behind, if that's
    // blocked) to park a freshly summoned car.
    function summonSpot(lng, lat, heading) {
      const distance = CAR_WIDTH + 2;
      const front = offsetLngLat(lng, lat, heading, distance);
      if (!collider.contains(front[0], front[1])) return { lng: front[0], lat: front[1], heading };
      const back = offsetLngLat(lng, lat, heading + 180, distance);
      return { lng: back[0], lat: back[1], heading: heading + 180 };
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

    sessionRef.current = { deliverToLot, setLighting, summonCar, summonPlane };

    // --- Keyboard input ---
    const pressed = { up: false, down: false, left: false, right: false, run: false, ascend: false, descend: false };
    let eKeyDownAt = 0;

    // 'walk' | 'drive' | 'helicopter' | 'airplane' — which orbit-camera config applies right now.
    function playerMode() {
      if (!driven) return 'walk';
      return driven.def.kind === 'car' ? 'drive' : driven.def.kind;
    }
    const ORBIT_CAMERA_BY_MODE = {
      walk: WALK_ORBIT_CAMERA,
      drive: DRIVE_ORBIT_CAMERA,
      helicopter: HELICOPTER_ORBIT_CAMERA,
      airplane: AIRPLANE_ORBIT_CAMERA
    };
    function configFor(mode) {
      return ORBIT_CAMERA_BY_MODE[mode];
    }

    // On foot, WASD is relative to the camera (GTA-style): "up" walks away
    // from the camera, "right" strafes clockwise from it, etc. — not the
    // character's own heading. Returns a compass heading, or null if nothing's pressed.
    function moveHeadingFromCamera() {
      const yawRad = (camera.yaw * Math.PI) / 180;
      const fwdX = Math.sin(yawRad);
      const fwdY = Math.cos(yawRad);
      const rightX = Math.sin(yawRad + Math.PI / 2);
      const rightY = Math.cos(yawRad + Math.PI / 2);
      let ex = 0;
      let ey = 0;
      if (pressed.up) {
        ex += fwdX;
        ey += fwdY;
      }
      if (pressed.down) {
        ex -= fwdX;
        ey -= fwdY;
      }
      if (pressed.right) {
        ex += rightX;
        ey += rightY;
      }
      if (pressed.left) {
        ex -= rightX;
        ey -= rightY;
      }
      if (ex === 0 && ey === 0) return null;
      return (Math.atan2(ex, ey) * 180) / Math.PI;
    }

    function handleKey(e) {
      if (isTypingTarget(e.target)) return;
      const isDown = e.type === 'keydown';
      if (isDown && e.code === 'Escape' && !pausedRef.current) {
        onExitRef.current();
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        const flying = driven && driven.def.kind !== 'car';
        if (flying) {
          // Held: climb. A quick tap (released before it could mean "climb")
          // still gets out, same as E always has for cars.
          if (e.repeat) return;
          if (isDown) {
            eKeyDownAt = performance.now();
            pressed.ascend = true;
          } else {
            pressed.ascend = false;
            if (!pausedRef.current && performance.now() - eKeyDownAt < HELICOPTER_E_TAP_MS) {
              const ctx = interactContext();
              applyInteract(ctx, resolveInteract(ctx));
              lastHudUpdate = 0;
            }
          }
          return;
        }
        if (!isDown || e.repeat || pausedRef.current) return;
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

    // --- On-foot mouse-look: click-and-drag, cursor stays visible on screen
    // the whole time (no pointer lock). In a vehicle this is ignored — see
    // camera.update()'s isInVehicle. ---
    const canvas = map.getCanvas();
    let dragging = false;
    function handlePointerDown(e) {
      if (pausedRef.current || e.button !== 0) return;
      dragging = true;
    }
    function handlePointerUp() {
      dragging = false;
    }
    function handlePointerMove(e) {
      if (!dragging) return;
      camera.orbit(e.movementX, e.movementY, ORBIT_YAW_SENSITIVITY, ORBIT_PITCH_SENSITIVITY);
    }
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);

    // --- Take over the camera ---
    const disabledHandlers = USER_HANDLERS.filter((name) => map[name] && map[name].isEnabled());
    disabledHandlers.forEach((name) => map[name].disable());

    map.addLayer(world.layer);
    setLighting(lightPresetRef.current);
    // Freeze road widths so they don't visibly thin/thicken as the orbit
    // camera fakes distance by changing the map's real zoom (see
    // lib/mapStyling.js) — 16.5 matches the street-level zoom this same
    // session eases back out to on exit, below.
    const frozenRoadWidths = freezeRoadWidths(map, 16.5);

    // Ease from wherever the user was into the follow view before handing
    // control to the per-frame camera.
    let cameraMode = playerMode();
    const camera = createOrbitCamera(map, player(), configFor(cameraMode), ORBIT_MIN_PITCH_DEG, ORBIT_MAX_PITCH_DEG);
    map.easeTo({ ...camera.introOptions(), duration: INTRO_DURATION_MS });
    const introEndsAt = performance.now() + INTRO_DURATION_MS;

    // --- Per-frame loop ---
    let frameId = 0;
    let lastTime = performance.now();
    let lastHudUpdate = 0;
    let blockedUntil = 0;
    let lastHud = null;
    let lastSave = performance.now();
    let lastGateAttempt = 0;
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
      if (driven && driven.def.kind === 'helicopter') {
        const lift = isPaused ? 0 : (pressed.ascend ? 1 : 0) - (pressed.descend ? 1 : 0);
        result = stepHelicopter(driven.state, { throttle: forward, steer: turn, lift }, driven.def, dt);
        spinRotors(driven.object, dt);
        if (result.distance > 0 && onDistanceRef.current) onDistanceRef.current(result.distance);
      } else if (driven && driven.def.kind === 'airplane') {
        const lift = isPaused ? 0 : (pressed.ascend ? 1 : 0) - (pressed.descend ? 1 : 0);
        result = stepAirplane(driven.state, { throttle: forward, steer: turn, lift }, driven.def, dt);
        if (result.distance > 0 && onDistanceRef.current) onDistanceRef.current(result.distance);
      } else if (driven) {
        result = stepVehicle(driven.state, { throttle: forward, steer: turn, brake: isPaused }, driven.def, dt, blocksCar(driven));
        if (result.distance > 0) {
          spinWheels(driven.object, Math.sign(driven.state.speed) * result.distance);
          if (onDistanceRef.current) onDistanceRef.current(result.distance);
        }
      } else {
        const moveHeading = isPaused ? null : moveHeadingFromCamera();
        result = stepCharacter(
          character,
          { moving: moveHeading !== null, moveHeading: moveHeading || 0, run: pressed.run },
          dt,
          blocksWalker
        );
        poseBlobCharacter(characterObject, character.walkPhase, Math.min(Math.abs(character.speed) / WALK_SPEED, 1));
      }
      if (result.blocked) blockedUntil = now + 700;

      buildingPhysics.sync();
      physics.step(dt);

      // Real gravity for whichever of the character/car is active — falls
      // when unsupported, lands on the ground or a building's rooftop (see
      // lib/gravity.js). The helicopter/plane/private jet manage their own
      // altitude instead (E/Q, gravity canceled) and are skipped here.
      if (!driven || driven.def.kind === 'car') stepGravity(me, physics, dt);

      updateView();
      traffic.update(dt, me, now, blocksTraffic);
      for (const npc of npcs) spinWheels(npc.object, npc.moved);

      if (now - lastSave > SAVE_INTERVAL_MS) {
        lastSave = now;
        save();
        reportFleet();
      }

      if (now - lastGateAttempt > GATE_ATTEMPT_INTERVAL_MS) {
        lastGateAttempt = now;
        const pendingPlanes = vehicles.filter((v) => v.def.kind === 'airplane' && v.pendingGateSnap);
        for (const v of pendingPlanes) {
          const gate = findTerminalGate(map, v.state.lng, v.state.lat);
          if (!gate) continue;
          v.pendingGateSnap = false;
          repositionVehicle(v, gate.lng, gate.lat, gate.heading);
          const bridge = buildJetBridge(gate.bridgeLength);
          jetBridges.push(
            world.add(bridge, { lng: gate.bridgeWallLng, lat: gate.bridgeWallLat, heading: gate.bridgeHeading, altitude: 0 })
          );
        }
        if (pendingPlanes.length) map.triggerRepaint();
      }

      const mode = playerMode();
      if (mode !== cameraMode) {
        cameraMode = mode;
        camera.setConfig(configFor(mode));
      }
      camera.update(me, mode !== 'walk');
      // A menu opening mid-drag shouldn't leave the camera still orbiting
      // once the mouse moves over the menu's own UI.
      if (isPaused) dragging = false;
      map.triggerRepaint();

      // HUD + pose reports are throttled so React isn't re-rendering at 60 fps.
      if (now - lastHudUpdate > 100) {
        lastHudUpdate = now;
        if (onPoseRef.current) onPoseRef.current({ lng: me.lng, lat: me.lat, heading: me.heading });
        const next = {
          speedKmh: Math.round(Math.abs(me.speed) * 3.6),
          altitudeM: driven && driven.def.kind !== 'car' ? Math.round(me.altitude) : null,
          blocked: now < blockedUntil,
          onFoot: state === ON_FOOT,
          interact: interactPrompt(interactContext()),
          trafficLoading:
            traffic.status.source === 'loading' && now - trafficStartedAt > TRAFFIC_LOADING_HINT_AFTER_MS
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
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);

      const me = player();
      // The map may already be gone if BuildingMap is tearing it down too.
      try {
        if (map.getLayer(WORLD_LAYER_ID)) map.removeLayer(WORLD_LAYER_ID);
        unfreezeRoadWidths(map, frozenRoadWidths);
        disabledHandlers.forEach((name) => map[name].enable());
        map.easeTo({ center: [me.lng, me.lat], zoom: 16.5, pitch: MAP_PITCH, bearing: me.heading, duration: 900 });
      } catch (e) {
        // map already removed — nothing to restore
      }
      vehicles.slice().forEach(despawnVehicle);
      jetBridges.forEach((handle) => {
        world.remove(handle);
        disposeObject(handle.object);
      });
      traffic.dispose();
      collider.dispose();
      buildingPhysics.dispose();
      physics.dispose();
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

  // The phone: summon an owned car to wherever the player is standing.
  useEffect(() => {
    if (summonRequest && sessionRef.current) sessionRef.current.summonCar(getCar(summonRequest.id));
  }, [summonRequest]);

  // The phone: summon a plane/jet to wherever the player is standing —
  // works from anywhere, not just the airport.
  useEffect(() => {
    if (planeSummonRequest && sessionRef.current) sessionRef.current.summonPlane(getPlane(planeSummonRequest.id));
  }, [planeSummonRequest]);

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
      altitudeM={hud.altitudeM}
      onFoot={hud.onFoot}
      timeOfDay={lightPreset}
      prompt={prompt}
      warning={hud.blocked && !hud.onFoot && !hud.interact ? 'Blocked — reverse or steer away' : null}
      showControls={showControls}
    />
  );
}

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
