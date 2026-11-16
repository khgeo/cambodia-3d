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
  - Traffic: motorbikes, cars, remorks, trucks and buses, with density by road class.
  - Ground styles: Satellite, Enhanced, or Stylised LULC, which is imagery-derived land cover (tree, crop/grass, bare soil, built, water) with a percentage summary.

## Exploring the scene
- **Terrain height** slider (×0 flat … ×3) and **Smooth terrain & grade roads**: these rebuild only the geometry, so they're fast. Roads get a smoothed long profile and the ground is shaped to meet them.
- **Ground**: Satellite, Enhanced (haze removal, colour balance, contrast stretch, sharpening, done in JavaScript so it also works in Safari) or Stylised LULC.
- **Ground detail & grass**: near the camera the ground gets grass, rice-row, cracked-soil and gravel detail chosen by land cover. Rice-field bunds are traced from edges in the image, and 3D grass and rice clumps sway in the wind.
- **Drive**: tap any road. The vehicle follows the network and picks a turn at junctions. You can choose car, pickup, motorbike, remork, truck or bus, set the speed, turn around, and switch between cockpit and chase camera.
- **Walk**: first person anywhere, off-road too. Use the joystick or WASD/arrow keys, drag to look, and tap the ground to jump there. Buildings and water block you.

## Panels
Both side panels can be hidden with ⟨ and shown again with ☰.

## Inset map and navigation
In the top-right corner, a north-up inset map shows the satellite image with roads, your position arrow and field of view, a north arrow and a scale bar. Tap ⊕ to change its zoom. **Tap anywhere on the inset map to jump there**: in Walk you stand there, snapped onto a road if one is close; in Drive you start on the nearest road; otherwise the camera flies there. Back on the 2D map, a red arrow shows where you are in 3D, and tapping inside the built area lets you walk, drive or look there. Under the map you can read the heading (compass point and degrees), latitude/longitude, UTM 48N coordinates, the real elevation (not exaggerated) and the speed.
When walking or driving with a mouse or trackpad, the view follows the cursor without dragging. Resting the cursor near a screen edge keeps turning. On touch screens you drag to look.

## Vegetation
- **Sugar palms (Borassus):** tall grey trunks, round crowns of spiky fan leaves and a skirt of dry fronds. They're placed where lone canopy stands in open lowland fields, never inside large forests or on hills and mountains.
- **Coconut palms:** placed near houses.
- **Broadleaf trees:** three crown shapes built from alpha-cut leaf cards, which cast leaf-shaped shadows, tinted from the image.
- **Forest floor (near the viewer, inside canopy):** ferns, shrubs, small fan palms, saplings, bamboo patches, rocks and fallen logs, on leaf-litter ground.

## Water, vehicles and people
- **Water reflections:** the nearest water body mirrors the trees, buildings and sky, rippled by the waves and stronger at low viewing angles. You can turn it off with the **Water reflections** switch.
- **Vehicles:** cars, pickups, motorbikes (some with a passenger), Cambodian remorks, trucks and buses. Their bodies are built from side profiles with wheels, rims, lights and glass.
- **People and cattle:** pedestrians walk along village roads, farmers in conical hats work in the rice fields, and small herds of cows graze near villages.

## Layers: pull apart and explore
**🗂 Layers** separates the landscape into an animated exploded stack around the satellite surface:
- **Above the surface (they rise):** water · roads, rail and bridges · trees and plants · buildings · traffic and people.
- **Below the surface (they sink):** land cover classified from the imagery · elevation (hypsometric tint, hillshade and contours) · topsoil 15–30 cm · subsoil 100–200 cm · geology.

Controls:
- **Level bar:** the vertical slider pulls the layers apart or puts them together.
- **▶ Play tour:** opens the stack, slowly orbits it, and highlights one layer at a time.
- **Isolate:** tap a layer to dim the others and show its legend. Tap it again to show all.
- **Each layer:** a checkbox to show or hide it and a slider for its opacity.
- **On screen:** each slab has a coloured frame and a label, and dashed corner posts tie the stack together.

## Cross-section: soil and geology
Tap **✂ Cross-section**, then tap point A and point B on the ground or on the inset map. A profile opens with these parts:
- **Section:** the ground line at real elevation, with the vertical exaggeration stated. Under it are the soil layers, a weathered zone and the rock unit, drawn with geological patterns (sandstone dots, limestone bricks, granite crosses, volcanic v's and so on). Water along the line is marked.
- **Soil strip:** USDA texture classes for 0–5, 5–15, 15–30, 30–60, 60–100 and 100–200 cm, computed from SoilGrids sand, silt and clay. Topsoil is drawn darker where organic carbon is higher.
- **Legend:** the units and soil classes found along the line.
- **Exports:** PNG and CSV. The CSV has distance, lon/lat, elevation, geology unit, and soil class with sand/silt/clay/SOC at each depth.
- **3D:** a cut wall along the line shows the same layers, and the sides of the block switch from plain brown to the real soil and geology at each edge.

Data:
- **Soil:** ISRIC SoilGrids 2.0, read live as GeoTIFF from its WCS for the area only.
- **Geology:** the Open Development Cambodia *Geology of Cambodia 2006* map, rasterised to 0.002° (`data/geology.png`, 180 KB, unit ids 1–22).
- **Depth assumptions:** depths below the soil are **schematic, not measured.** Young alluvium continues to the bottom of the section. Old alluvium is about 20 m deep over unknown bedrock. Hard rock has a weathered zone about 2–8 m deep. Borehole, well or groundwater data can be added later to replace these assumptions.

## Clouds
When **Fill clouds in 3D** is on, clouds are found in the satellite image: bright, grey, large patches, so small white roofs are ignored. Each cloudy tile is then replaced from a clear source, tried in this order:
1. The other provider (Google or Esri).
2. Older **Esri World Imagery Wayback** versions. Only versions that actually differ at that spot are tried.
3. **Sentinel-2 cloudless 2024** (EOX, 10 m), which never has clouds.

The replacement is colour-matched to the surrounding image, cloud shadows are replaced too, and the edges are feathered. Any area that stays cloudy is marked unknown, so it doesn't count in the land-cover summary and gets no trees.

## Data
`data/13/{x}/{y}.json` holds 8,951 compact tiles cut from `cambodia-261109_osm.pbf`. They contain roads, rail, waterways, water, land use and buildings, with coordinates delta-encoded in micro-degrees. To rebuild them from a newer PBF:

```
pip install osmium shapely
cd tools && python extract.py cambodia-latest.osm.pbf && python tile.py
```

## Credits
Imagery © Esri, Maxar, Earthstar Geographics (or © Google) · Terrain: Mapzen / AWS Terrain Tiles · © OpenStreetMap contributors (ODbL) · Three.js, MapLibre GL JS.
Geoinformatics and Research Lab, Department of Geography and Land Management, RUPP.
