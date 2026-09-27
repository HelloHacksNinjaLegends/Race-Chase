// A static jet-bridge prop connecting a terminal wall to a parked
// airplane's door (see lib/airportSpawn.js's findTerminalGate) — cosmetic
// only, fixed geometry that doesn't extend/retract like a real one. Built
// along -Z like every other rig in the app: the wall/rotunda end sits at
// the local origin, the tube reaches out toward -Z to the door end, so it
// can be placed with an ordinary lng/lat/heading via lib/worldLayer.js.

import * as THREE from 'three';

const TUBE_WIDTH = 1.8;
const TUBE_HEIGHT = 2.3;
const ROTUNDA_SIZE = 2.6;
const DOOR_HEIGHT = 2.5; // above ground — meets a narrow-body's forward door sill

const materials = {
  tube: new THREE.MeshStandardMaterial({ color: '#c7cdd4', metalness: 0.15, roughness: 0.6 }),
  rotunda: new THREE.MeshStandardMaterial({ color: '#3a5f8a', metalness: 0.1, roughness: 0.5 })
};

/** A jet-bridge Group spanning `length` meters from the wall (origin) to the door (-Z). */
export function buildJetBridge(length) {
  const group = new THREE.Group();

  const rotunda = new THREE.Mesh(new THREE.BoxGeometry(ROTUNDA_SIZE, ROTUNDA_SIZE, ROTUNDA_SIZE), materials.rotunda);
  rotunda.position.set(0, DOOR_HEIGHT, 0);
  group.add(rotunda);

  const tube = new THREE.Mesh(new THREE.BoxGeometry(TUBE_WIDTH, TUBE_HEIGHT, length), materials.tube);
  tube.position.set(0, DOOR_HEIGHT, -length / 2);
  group.add(tube);

  return group;
}
