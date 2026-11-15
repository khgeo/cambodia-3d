# Cambodia 3D Landscape

Pick any area in Cambodia on a satellite map and turn it into a 3D scene. The scene is built from the satellite image, terrain and OpenStreetMap data. It runs on GitHub Pages and only loads what the chosen area needs.

**Live site:** https://khgeo.github.io/cambodia-3d/

## How it works
- **2D map (whole country):** MapLibre with Esri World Imagery or Google satellite. Main roads come from `data/overview_roads.geojson` (3 MB). When you zoom in past z12.5, only the z13 OSM tiles in view are loaded.
- **Area of interest:** tap to place a 0.5–4 km square, draw a box, or search a place. The URL hash (`#aoi=w,s,e,n`) makes an area shareable.
- **3D scene (only the area):**
  - Terrain: Mapzen/AWS Terrarium tiles, with optional exaggeration.
  - Ground: satellite imagery at the highest zoom that fits a 4096 px texture, draped on the terrain.
  - Roads: one shader draws every OSM road type, with markings computed in metres:
    - Asphalt with lane, centre and edge lines that follow `lanes` and `oneway`
    - Concrete slabs, paving and bricks
    - Red laterite dirt roads with ruts and soft edges that blend into the image
    - Farm tracks, footpaths
    - Railway (metre gauge) with sleepers and steel rails
  - Bridges: raised decks with parapets and piers.
  - Water: OSM lakes, rivers and canals, plus the sea at 0 m.
  - Buildings: extruded from OSM footprints, with gable or hip roofs on houses, two-tier roofs on pagodas, stupas, flat roofs and windows on taller buildings.
  - Trees: placed where the imagery shows dark-green canopy (an RGB greenness index). Isolated canopy in fields becomes sugar palms.
  - Traffic: motorbikes, cars, tuk-tuks, trucks and buses, with density by road class.
  - Ground styles: Satellite, Enhanced, or Stylised LULC, which is imagery-derived land cover (tree, crop/grass, bare soil, built, water) with a percentage summary.

## Exploring the scene
- **Terrain height** slider (×0 flat … ×3) and **Smooth terrain & grade roads**: these rebuild only the geometry, so they're fast. Roads get a smoothed long profile and the ground is shaped to meet them.
- **Ground**: Satellite, Enhanced (haze removal, colour balance, contrast stretch, sharpening, done in JavaScript so it also works in Safari) or Stylised LULC.
- **Ground detail & grass**: near the camera the ground gets grass, rice-row, cracked-soil and gravel detail chosen by land cover. Rice-field bunds are traced from edges in the image, and 3D grass and rice clumps sway in the wind.
- **Drive**: tap any road. The vehicle follows the network and picks a turn at junctions. You can choose car, motorbike, tuk-tuk, truck or bus, set the speed, turn around, and switch between cockpit and chase camera.
- **Walk**: first person anywhere, off-road too. Use the joystick or WASD/arrow keys, drag to look, and tap the ground to jump there. Buildings and water block you.

## Data
`data/13/{x}/{y}.json` holds 8,951 compact tiles cut from `cambodia-261109_osm.pbf`. They contain roads, rail, waterways, water, land use and buildings, with coordinates delta-encoded in micro-degrees. To rebuild them from a newer PBF:

```
pip install osmium shapely
cd tools && python extract.py cambodia-latest.osm.pbf && python tile.py
```

## Credits
Imagery © Esri, Maxar, Earthstar Geographics (or © Google) · Terrain: Mapzen / AWS Terrain Tiles · © OpenStreetMap contributors (ODbL) · Three.js, MapLibre GL JS.
Geoinformatics and Research Lab, Department of Geography and Land Management, RUPP.
