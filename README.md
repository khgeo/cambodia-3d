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

More in the Layers panel:
- **Moving around the stack:** use ◀ ▲ ▼ ▶ (or the arrow keys and PageUp/PageDown) to move left, right, up and down the stack, ＋/－ to zoom, and ⤢ to see the whole stack. Tapping a layer flies the camera to it. Right-drag or two-finger drag also pans, including up and down.
- **Spacing slider:** sets how far apart the layers sit.
- **Thicker underground slabs:** soil and rock slabs have sides, so they read as blocks. Geology is the thickest.
- **Deep Earth block:** a column from the soil down to the inner core (6,371 km) on a log-depth scale, showing crust, Moho, lithosphere, asthenosphere, transition zone, lower mantle and outer/inner core. The upper crust is named after the local geological unit.
- **Land cover 2017–2025:** Esri | Impact Observatory 10 m annual land cover (Sentinel-2), loaded live for the area. A year slider and ▶ step through the years, and *Show change since 2017* maps tree loss, new trees and new built-up land.
- **Flood level:** a water sheet set by a chosen elevation (a simple bathtub model, no flow). It reports the share of the area under water and the mean depth, and it works with the layers apart or together.
- **Cross-section through the stack:** a section line drawn while the layers are apart is shown on every slab, joined by a light curtain.

## Interface and language
A narrow icon rail on the left holds everything:
- **Panels:** 🎥 views, 🖼 display, 🌤 environment, 📊 land cover and statistics.
- **Tools:** 🗂 layers, 📐 survey, ✏️ digitize, ✂️ cross-section, 🎯 tactical, 🗺 topographic map.

Hover an icon for its name. On phones the rail moves to the bottom. **ខ្មែរ / EN** switches the whole interface between Khmer and English, and the choice is remembered. Strings are in `js/i18n.js`.

## Land cover: 13 classes
Each 2.5 m cell is classified from the satellite image (water, canopy, green, bare, built). The class is then refined using:
- canopy density
- nearness to houses and water
- slope
- OpenStreetMap roads, buildings, water and land use
- the Esri | Impact Observatory 10 m Sentinel-2 land cover of the latest year

The classes are:

| # | Class |
|---|---|
| 1 | Open water |
| 2 | Flooded / wet vegetation |
| 3 | Dense forest |
| 4 | Open forest / woodland |
| 5 | Shrubland / scattered trees |
| 6 | Orchard / village trees |
| 7 | Paddy rice field |
| 8 | Other cropland |
| 9 | Grassland / pasture |
| 10 | Bare soil / fallow |
| 11 | Sand / riverbank |
| 12 | Built-up |
| 13 | Roads |

These classes are used by the *Land cover* ground style, the statistics panel, the topographic map and the mobility analysis.

## Topographic map (🗺)
Builds an A4, A3 or A2 sheet (landscape or portrait) at an automatic or chosen scale, in Khmer, English or both. It contains:
- **Land cover:** topographic tints with map symbols (forest circles, rice tufts, grass, orchard, marsh).
- **Relief:** hillshade, and contours (interval chosen from the relief) with labelled index contours.
- **Mapped features:** spot heights, water, and roads by class with casings and dashed tracks. Also railways, OSM buildings and houses from the image.
- **Names:** place names and landmarks (pagodas, schools, health centres, markets, peaks, rivers) from a bundled OpenStreetMap extract (`data/places`, made by `tools/places.py`).
- **Optional overlays:** your digitized features, survey points and parcels, and the tactical overlay.
- **Grid:** a UTM 48N grid with labels in the topographic style and DMS corner coordinates.
- **Margin:** a bilingual legend, scale bar, contour interval, true north and grid north with the convergence angle, a location map, sources, and the RUPP Geoinformatics and Research Lab credit.

Download as PNG (150–300 dpi) or PDF.

## Tactical (🎯)
Adapted from the author's **Terrain Ops** and **TacMap KH** QGIS plugins (`tac/` holds the symbol SVGs, the catalogue and `mobility.json`).
- **Symbols:** own, enemy or neutral, with NATO or Khmer/Soviet colours. Point symbols stand on poles in 3D with labels. Line symbols are draped on the ground: axis, front line with semicircles, trenches with ticks, wire, mine line, anti-tank ditch, phase line, boundaries and dimension arrows. Areas include defended area, objective, assembly area, minefield, obstacle and impassable (hatched). Fire sectors and range rings are also available.
- **Line of sight:** between two points or between the nearest own and enemy symbols. Trees and buildings block sight, but those at the observer's and target's own positions do not. Results: profile chart, distance, height change, bearing in degrees and mils, and the share of ground seen.
- **Viewshed:** visible and hidden ground from an observation point within a chosen radius.
- **Mobility:** GO / SLOW-GO / NO-GO from slope, land cover, water, roads, vehicle type (wheeled, tracked, foot) and dry or wet season.

Export as GeoJSON. For planning and training from open data. Confirm by reconnaissance.

## Digitize: your own roads, buildings, trees and ponds
**✏️ Digitize** opens the editor.
- **Road:** tap along a route and choose the type (national, provincial, district, village street, laterite track or footpath). The road is draped on a smoothed long profile with shoulders and textured (asphalt with markings, concrete, laterite or dirt). Every new road joins the **Drive** network.
- **Building:** a rectangle in 3 taps or any polygon, with floors, gable/hip/flat roof, wall and roof colours, and optional stilts (Khmer house). Built with the same builder as OSM buildings, so it has windows that light up at night.
- **Tree:** coconut, sugar palm, mango/round, tall, rain tree or bush, using the same models as the forest.
- **Pond:** water at bank level, with reflections.
- **Delete:** tap a feature to delete it.

Edits are saved in the browser and can be exported or imported as **GeoJSON** (works with QGIS).

## Houses from the image
OpenStreetMap has few buildings in rural Cambodia. When OSM has none nearby, village houses are placed on built-up pixels within about 45 m of a road. They are oriented to the road, with gable or hip roofs, wood or plaster walls, and many on stilts. They can be switched off with *Houses from image*. These are inferred, not mapped.

## Time of day, weather, cinematic flight
- **Time of day (05:00–23:30):** the sun moves east → south → west. Dusk turns orange. At night there are stars and moonlight, and building windows light up.
- **Weather:** clear, haze (burning season), monsoon rain (falling rain, overcast, short visibility) and thunderstorm (wind-driven rain and lightning flashes).
- **🎥 Fly:** a slow cinematic flight around and across the area. Any click or key stops it.

## More realism
- **Junctions:** each road eases into the height of the more important road it joins over about 30 m, so side roads no longer step up or float at junctions.
- **Traffic:** vehicles keep a safe gap to the one ahead and slow down behind it. On two-way roads a faster vehicle pulls out to the left, passes, and pulls back in.
- **Night lights:** street lamps every ~35 m on main roads and town streets, with warm pools of light. Vehicles show headlight beams and red tail lights. Lights also come on in rain and storms.
- **Rice season:** the rice fields can show the image as photographed, or be tinted for planting (flooded, Jun–Jul), growing (green, Aug–Oct), ripening (golden, Nov–Dec) or harvested (stubble, Jan–May). Rice plants grow and shrink to match.
- **⏺ Rec:** records the 3D view (for example the 🎥 flight or a drive) as an MP4 or WebM video.
- **Esc:** leaves Walk or Drive and stops the flight, so you don't have to move the cursor to Exit (which turns the view).
- **Digitizing snaps** to road centrelines and ends, building and house corners, your own features, survey points and parcels. It also squares corners to 90° and closes a shape when you tap its first point. A yellow ring shows a snap and names the target. Turn it off with 🧲.

## Survey: measure, mark and go to
Open **📐 Survey**. It has three tools:
- **📍 Points:** tap to drop points. In Walk mode the surveyor carries a GNSS rover pole (antenna, controller and level bubble), and **Mark** (or the M key) records the point where the pole tip touches the ground. Each point gets an ID, a code (corner, tree, well…), lat/lon, UTM 48N E/N and an elevation. A stake with a flag and a label is drawn at each point.
- **📏 Distance:** a route draped on the terrain. Results: distance along the ground (3D), horizontal distance, straight A→B, climb and descent, height change and grade, steepest slope over 10 m, and bearing. Each segment is labelled with its length and slope, and an elevation profile is drawn.
- **⬠ Area:** a draped, filled polygon. Results: map area and 3D surface area (in m² and ha), 2D and 3D perimeter, and min/mean/max elevation.

**Go to a coordinate:** accepts lat/lon in decimal or degrees-minutes-seconds, or UTM (zone 48N by default).
- **🎯 Stake out** places a pulsing green beacon at the coordinate. The inset map shows a line to it and the distance, bearing and Δh.
- **🚶 Walk there** walks you to it, running if it is far away.
- **⤓ Jump** puts you on the spot.

**Export:** CSV, GeoJSON (points plus the line or area) and KML.

Also in the Survey panel:
- **Cut / fill:** for an area, enter a design level (the mean elevation by default). A pink plane shows the level, and you get cut and fill volumes in m³, the net surplus or shortfall, and the number of truckloads.
- **Parcels:** save a measured area as a named parcel. It is drawn in orange with a name and area label, kept in the browser, and included in the GeoJSON export.
- **Stake-out list:** import a CSV of points (lat/lon or UTM E/N, with or without a header). Use ◀ ▶ to step through them. Marking a point within 0.5 m of a target counts it as staked.

Heights come from the terrain model (a few metres of error). Measurements use the real heights, not the exaggerated view.

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
