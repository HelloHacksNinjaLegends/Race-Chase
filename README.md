# Race-Chase

A calm driving (and flying) sim on a 3D map of Richmond, Vancouver, and UBC,
built on the Mapbox Standard style: colorful clickable buildings, dawn/day/
dusk/night lighting, a car dealership economy, and third-person, driver's-
seat, or cockpit views.

# Links
[Driving with routes](https://raceroute.vercel.app/)
[Open world driving and flying](https://racechase.vercel.app/)

## Project structure

```
app/
  layout.js          Root layout: fonts, global CSS, page metadata
  page.js            Entry point — loads BuildingMap client-side only
  globals.css        CSS variables and layout tokens, shared .panel /
                     .ui-button / .kbd styles
components/
  BuildingMap.jsx    Main component: map setup, building clicks, and the game
                     state (cash, garage, dealership) around play mode
  TokenGate.jsx      One-time Mapbox token setup screen
  Hint.jsx           "Click a building" / "Enter to play" hint
  InfoPanel.jsx      Slide-in panel with the selected building's details
  LightControl.jsx   Day/night selector (Auto or a pinned preset)
  ControlDock.jsx    Bottom-left stack for the buttons below
  PlayToggle.jsx     Play / Exit play button
  GarageButton.jsx   Cash + "My cars" button
  GaragePanel.jsx    Read-only list of owned cars and where they are
  DevCashButton.jsx  Dev-only "+$10,000" (npm run dev, or ?dev in the URL)
  CarDriving.jsx     Play session: wires the lib/ systems together
  GameHud.jsx        Minimal HUD: speed, view, time of day, prompts
  DealershipPanel.jsx / DealershipMarker.jsx   Car shop and its map pin
  CarList.jsx / ModalPanel.jsx                 Shared pieces of the panels
  PhonePanel.jsx     Phone-style overlay used by the dealership UI
  FpsCounter.jsx     Optional on-screen FPS readout
hooks/
  useEconomy.js      Cash balance (persisted)
  useGarage.js       Owned cars (persisted)
  useDealership.js   Dealership menu state + in-range flag
  useLightPreset.js  Day/night mode, clock tracking, applies lightPreset
lib/
  constants.js       Map defaults, Overpass mirrors, driving / walking /
                     camera / traffic tuning
  playerState.js     On foot <-> vehicle state machine (what E does)
  character.js       On-foot movement
  blobCharacterModel.js  The blob character + walk animation
  vehicle.js         Car physics + footprint test
  vehicleRig.js      Car body + wheel pivots from named parameters, with an
                     overlap check at build time
  carModel.js        Kenney car models: part materials, lamps, rig assembly
  svjCarModel.js     Alternate car model variant
  placeholderCar.js  Box car shown while a model loads
  carCatalog.js      Every car: price, stats, look
  dealership.js      Dealership location, interaction range, lot slots
  economy.js         Cash rate, formatting, storage
  helicopterModel.js / helicopterVehicle.js   Helicopter model + flight physics
  airplaneModel.js / airplaneVehicle.js /
  genericAircraftModel.js / planeCatalog.js   Airplane models + flight physics
  jetBridgeModel.js  Jet bridge model at the airport spawn
  airportSpawn.js    Airport location and aircraft spawn points
  physicsWorld.js    Shared cannon-es physics world setup
  orbitCamera.js     Shared GTA-style mouse-orbit follow camera (walk/drive/fly)
  worldLayer.js      Mapbox custom layer that renders all 3D objects
  worldSave.js       Parked cars + player position between sessions
  buildingCollision.js  Building-footprint collision + geo helpers
  buildingPhysics.js Physics bodies for buildings
  mapStyling.js      Our Mapbox Streets source + 3D buildings layer
  buildingColors.js  Height-based building color expression
  lightPreset.js     Time-of-day presets and the clock mapping
  sceneLighting.js   three.js lighting per time of day
  overpass.js / roadGraph.js / mapboxRoads.js / traffic.js   NPC traffic
  mathUtils.js       Small angle / clamp helpers
```

## Play mode

Press **Enter** (or the Play button). You start on foot as the blob
character: at the map center if you're zoomed in (so you can start
anywhere), or where you left off if you're zoomed out.

| Key | On foot | Driving | Flying |
|---|---|---|---|
| W / S | Walk forward / back | Throttle / brake & reverse | Pitch / throttle |
| A / D | Turn | Steer | Roll / yaw |
| Shift | Run | — | — |
| E | Get into a vehicle you're next to · open the dealership when at it | Get out | Get out |
| C | Camera: third person <-> first person (eased) | third person <-> driver's seat | third person <-> cockpit |
| T | Time of day: Auto → Dawn → Day → Dusk → Night | same | same |
| G | My cars (where each car is parked) | same | same |
| H | Hide / show all on-screen UI | same | same |
| Esc | Leave play mode | same | same |

- **Cars only come from the dealership** ("Richmond Motors", the pin on
  No. 3 Road). Walk up to it and press E. The starter car is free; others
  cost cash, earned by driving. Anything you get is parked on the lot next
  to the dealership. Cars you own stay where you park them — the dealership
  can move one back to its lot.
- **Aircraft** (helicopters and planes) spawn at the airport — see
  `lib/airportSpawn.js` for the location.
- Time of day defaults to **Auto**, which follows your local clock (dawn
  5–7, day 7–18, dusk 18–20, night otherwise). Pick a preset in the top bar
  or with T to pin it; the choice is remembered.
- Brand names at the dealership are flavor text; every car is a generic
  model, repainted. Car models are from Kenney's **Car Kit** (CC0 / public
  domain, [kenney.nl](https://kenney.nl/assets/car-kit)); see
  `public/models/kenney/License.txt`.
- NPC traffic follows OpenStreetMap roads. If the Overpass API can't be
  reached, it uses the road data already in the Mapbox map instead.

## Running it

Requires Node.js (for Next.js 14).

1. Install dependencies:
   ```
   npm install
   ```
2. Start the dev server:
   ```
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000).

The first time you open it, you'll be asked to paste a free Mapbox access
token (see the in-app instructions — no credit card needed). It's saved in
your browser after that.

### Optional: skip the token screen

Copy `.env.local.example` to `.env.local` and fill in
`NEXT_PUBLIC_MAPBOX_TOKEN` with your token, and the app will load straight
into the map without asking.

### Production build

```
npm run build
npm run start
```

## Notes on the data

- **Map**: the Mapbox Standard style (imported as `basemap`). Its own 3D
  buildings and landmark models are switched off; buildings are our own
  extrusions of Mapbox Streets building data, so they can be clicked,
  colored by height, and used for collision. Not every building has height
  data — those render at 8 m and show "not in dataset" when selected.
  Building data isn't in tiles at a city-wide zoom, so buildings only
  appear once you zoom in.
- **Traffic roads**: pulled from OpenStreetMap via the free, keyless
  Overpass API. The public Overpass servers are shared community
  infrastructure with no uptime guarantee; the app tries three mirrors in
  order (giving up on each after 12 seconds). Some networks block Overpass
  entirely — traffic then falls back to the road data already in the map.

## Contributing

This repo is worked on by multiple people, some using AI coding assistants.
See [`AGENTS.md`](./AGENTS.md) for the branching, file-ownership, and PR
rules before making changes.
