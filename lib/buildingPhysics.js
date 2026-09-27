// Static box colliders for buildings, added to the shared cannon-es world —
// used by the helicopter/airplane's flight collision, and (tagged with
// GROUND_COLLISION_GROUP) as the rooftop surfaces lib/gravity.js's ground
// raycast can land the character/car on (car/character horizontal
// collision still keeps the existing point-probe footprint check in
// lib/buildingCollision.js; see the note atop lib/physicsWorld.js for why).
// Rebuilt whenever the footprint cache (lib/buildingCollision.js) refreshes,
// using its cheap `version` counter so this doesn't redo the work every frame.

import * as CANNON from 'cannon-es';
import { GROUND_COLLISION_GROUP } from './physicsWorld';

export function createBuildingPhysics({ physics, collider }) {
  let bodies = [];
  let syncedVersion = -1;

  function rebuild() {
    for (const b of bodies) physics.world.removeBody(b);
    bodies = [];

    for (const f of collider.getFootprints()) {
      const centerLng = (f.minX + f.maxX) / 2;
      const centerLat = (f.minY + f.maxY) / 2;
      const center = physics.toLocal(centerLng, centerLat);
      const corner = physics.toLocal(f.maxX, f.maxY);
      const halfX = Math.max(1, Math.abs(corner.x - center.x));
      const halfZ = Math.max(1, Math.abs(corner.z - center.z));
      const halfY = f.height / 2;

      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(halfX, halfY, halfZ)) });
      body.position.set(center.x, f.minHeight + halfY, center.z);
      body.collisionFilterGroup = GROUND_COLLISION_GROUP;
      physics.world.addBody(body);
      bodies.push(body);
    }
    syncedVersion = collider.version;
  }

  return {
    /** Cheap to call every frame — only rebuilds when the footprint cache actually changed. */
    sync() {
      if (collider.version !== syncedVersion) rebuild();
    },
    dispose() {
      for (const b of bodies) physics.world.removeBody(b);
      bodies = [];
    }
  };
}
