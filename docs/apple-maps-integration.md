# Apple Maps integration research

## What Apple officially supports on the web

MapKit JS can embed an Apple map, run searches and directions, show user location, add annotations, and draw polygon or polyline overlays. It requires an Apple Maps authorization token and an Apple Developer Program setup.

Official references:

- https://developer.apple.com/documentation/mapkitjs/
- https://developer.apple.com/maps/web/
- https://developer.apple.com/documentation/mapkitjs/overlay

## Building-render limitation

Apple documents its buildings as part of the rendered MapKit map. It does not document an API that exports Apple building meshes, textures, or photogrammetry for use inside Mapbox GL JS or Three.js. Based on the public APIs, Apple building rendering therefore cannot be inserted into the current game as reusable geometry.

## Practical options

1. Keep Mapbox as the game renderer. This preserves the current selectable buildings, collision system, cars, character, and highlighted floor routes.
2. Add an optional separate MapKit JS map view. This could provide Apple search, directions, Look Around, and Apple-rendered map visuals, but it would not share the existing Mapbox 3D scene.
3. Replace the base map with MapKit JS. The route could be redrawn as an Apple polyline, but the current Mapbox vector-building access, collision queries, and custom 3D integration would need to be redesigned.
4. For reusable detailed building models, use licensed 3D assets, OpenStreetMap footprints with generated facades, or a provider that explicitly licenses mesh export.

## Recommendation

Keep Mapbox for gameplay and use its Search Box API for live place and POI names. If Apple credentials become available later, add Apple Look Around or a separate Apple map as an optional place-preview panel rather than trying to copy Apple's building meshes into the game.
