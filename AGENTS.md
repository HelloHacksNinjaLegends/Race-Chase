# AGENTS.md — Multi-Agent / Multi-Contributor Rules

This repo is worked on by multiple people, each possibly using a different AI
coding assistant (Claude Code, Cursor, Copilot, etc.) or none at all. These
rules exist so concurrent work doesn't collide. Read this file in full before
making any change, whether you're a human or an AI agent acting on someone's
behalf.

## 1. Claim before you code
- Before starting work, add a row to the In-Progress table below: your
  name/handle, the feature or file(s) you're touching, your branch, and
  today's date.
- If a file or feature is already claimed by someone else, do not touch it.
  Pick something else or coordinate with them directly first.
- Remove your row once your PR is merged.

### In-Progress
| Who | Feature / files | Branch | Started |
|---|---|---|---|
| _(example)_ Hudson | Helicopter physics (new file) | `feat/helicopter-physics` | 2026-09-26 |

## 2. One feature = one branch = one new file where possible
- Never work directly on `main`.
- Branch naming: `feat/<short-feature-name>`, `fix/<short-bug-name>`.
- When adding a new mechanic (a new vehicle type, a new UI panel, a new
  physics behavior), create a NEW FILE for it rather than growing an
  existing shared file. Wire it in with a small, obvious import/registration
  line in the shared file — don't paste the new logic inline into it.
- Only edit an existing shared file when you have to (a bug fix, wiring in a
  new module, a rename). Keep that edit as small and isolated as possible.

## 3. Module ownership map
Keep changes inside the module they belong to. If a feature needs to reach
into another module, that's a signal to coordinate with whoever owns it
first, not to just edit it.

| Module | Files | Owns |
|---|---|---|
| Vehicle rig / physics | `lib/vehicle.js`, `lib/vehicleRig.js`, `lib/carModel.js`, `lib/svjCarModel.js`, `lib/helicopterModel.js`, `lib/helicopterVehicle.js`, `lib/airplaneModel.js`, `lib/airplaneVehicle.js`, `lib/genericAircraftModel.js`, `lib/jetBridgeModel.js`, `lib/planeCatalog.js`, `lib/airportSpawn.js`, `lib/physicsWorld.js`, `components/CarDriving.jsx` | Car/helicopter/airplane movement, collision, wheel rig |
| Character controller | `lib/character.js`, `lib/blobCharacterModel.js`, `lib/playerState.js` | On-foot movement, enter/exit vehicle |
| Camera | `lib/orbitCamera.js` | Shared GTA-style mouse-orbit follow camera (walk/drive/fly) |
| Dealership & economy | `lib/dealership.js`, `lib/economy.js`, `lib/carCatalog.js`, `components/DealershipMarker.jsx`, `components/DealershipPanel.jsx`, `components/CarList.jsx`, `components/PhonePanel.jsx`, `components/GaragePanel.jsx`, `components/GarageButton.jsx` | Unlocking/spawning vehicles, phone UI |
| World/environment | `lib/worldLayer.js`, `lib/buildingCollision.js`, `lib/buildingColors.js`, `lib/buildingPhysics.js`, `lib/mapboxRoads.js`, `lib/mapStyling.js`, `lib/overpass.js`, `lib/roadGraph.js`, `lib/sceneLighting.js`, `lib/lightPreset.js`, `lib/traffic.js`, `lib/worldSave.js`, `components/BuildingMap.jsx`, `components/LightControl.jsx` | Buildings, day/night, NPC traffic (trees/streetlights removed) |
| UI/HUD | `components/GameHud.jsx`, `components/ControlDock.jsx`, `components/Hint.jsx`, `components/InfoPanel.jsx`, `components/ModalPanel.jsx`, `components/PlayToggle.jsx`, `components/DevCashButton.jsx`, `components/TokenGate.jsx` | HUD, panels, phone overlay |

(Keep this table honest — update it whenever the real file structure changes.)

## 4. Keep pulls/merges painless
- `git pull --rebase` before starting work each session.
- Commit small and often — one commit per logical change, not one giant
  commit per feature.
- Before opening a PR: rebase onto latest `main`, resolve conflicts locally,
  and run `npm run build` to confirm it's clean.
- Never force-push a shared branch without warning whoever else might be on it.

## 5. PR requirements
Every PR description must state:
- What changed, in plain language.
- Which files were touched (should mostly match what was claimed above).
- Confirmation that `npm run build` passed.
- Anything intentionally left out of scope for a follow-up.

## 6. Rules specifically for AI coding agents
If you are an AI agent (Claude Code, Cursor, Copilot, etc.) acting on a
contributor's behalf:
- Read this entire file before writing any code.
- Check the In-Progress table. If your assigned task overlaps a claimed
  file/feature, stop and tell the person — don't proceed.
- Add your contributor's row to the In-Progress table yourself when you
  start; remove it (or remind them to) once the PR merges.
- Default to creating a new file for new functionality (rule 2). Only touch
  a file outside your claimed feature if wiring-in requires a one- or
  two-line change (an import, a registration call) — anything larger, stop
  and flag it instead of proceeding on your own judgment.
- Never refactor or "clean up" shared/core files as a side effect of an
  unrelated feature. If something needs restructuring, say so and let a
  human decide.
- Always run the build before considering a task done, and report the
  actual result — don't say it's done without having run it.
