// GeoPackage export of the area for QGIS: every vector layer of the scene (OSM roads, rail, water, buildings,
// image houses, contours, spot heights, place names, survey points and parcels, your digitized features, the
// tactical overlay) in EPSG:4326, the satellite image and the 13-class land cover as raster tiles (EPSG:3857),
// and a QGIS style for each layer saved as its default (layer_styles), so the layers open styled.
import { LC } from './landcover.js?v=31';
import { terrainData } from './topomap.js?v=31';

let SQL = null;
async function sqljs() {
  if (SQL) return SQL;
  if (!window.initSqlJs) await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  SQL = await window.initSqlJs({ locateFile: f => 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/' + f }); return SQL;
}
/* ---------- geometry blobs: GeoPackage header + little-endian WKB ---------- */
function gpkgGeom(type, coords, srs = 4326) {
  // type: 1 point [x,y] · 2 linestring [[x,y]…] · 3 polygon [[[x,y]…]…]
  const pts = type === 1 ? [coords] : type === 2 ? coords : coords.flat();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const n = type === 1 ? 16 : type === 2 ? 4 + coords.length * 16 : 4 + coords.reduce((a, r) => a + 4 + r.length * 16, 0);
  const buf = new ArrayBuffer(8 + 32 + 5 + n), dv = new DataView(buf); let o = 0;
  dv.setUint8(o++, 0x47); dv.setUint8(o++, 0x50); dv.setUint8(o++, 0); dv.setUint8(o++, 0b00000011); dv.setInt32(o, srs, true); o += 4;
  for (const v of [x0, x1, y0, y1]) { dv.setFloat64(o, v, true); o += 8; }
  dv.setUint8(o++, 1); dv.setUint32(o, type, true); o += 4;
  const P = ([x, y]) => { dv.setFloat64(o, x, true); o += 8; dv.setFloat64(o, y, true); o += 8; };
  if (type === 1) P(coords); else if (type === 2) { dv.setUint32(o, coords.length, true); o += 4; coords.forEach(P); }
  else { dv.setUint32(o, coords.length, true); o += 4; for (const r of coords) { dv.setUint32(o, r.length, true); o += 4; r.forEach(P); } }
  return new Uint8Array(buf);
}
const WKT4326 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
const WKT3857 = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]';

/* ---------- QGIS styles (QML) ---------- */
const rgba = (hex, a = 255) => { const h = hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a}`; };
const opt = (o) => `<Option type="Map">${Object.entries(o).map(([k, v]) => `<Option type="QString" name="${k}" value="${String(v).replace(/"/g, '&quot;')}"/>`).join('')}</Option>`;
const ddColor = (prop, field) => `<data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option type="Map" name="properties"><Option type="Map" name="${prop}"><Option type="bool" name="active" value="true"/><Option type="QString" name="field" value="${field}"/><Option type="int" name="type" value="2"/></Option></Option><Option type="QString" name="type" value="collection"/></Option></data_defined_properties>`;
const line = (col, w, extra = {}, dd = '') => `<layer class="SimpleLine" enabled="1" pass="0" locked="0">${opt({ line_color: rgba(col), line_width: w, line_width_unit: 'MM', capstyle: 'round', joinstyle: 'round', line_style: 'solid', ...extra })}${dd}</layer>`;
const fill = (col, out, ow = 0.2, extra = {}, dd = '') => `<layer class="SimpleFill" enabled="1" pass="0" locked="0">${opt({ color: rgba(col, extra.alpha ?? 255), outline_color: out ? rgba(out) : '0,0,0,0', outline_width: ow, outline_width_unit: 'MM', outline_style: out ? 'solid' : 'no', style: extra.style || 'solid' })}${dd}</layer>`;
const marker = (shape, col, size, out = '#ffffff', dd = '') => `<layer class="SimpleMarker" enabled="1" pass="0" locked="0">${opt({ name: shape, color: rgba(col), outline_color: rgba(out), size, size_unit: 'MM', outline_width: 0.2, outline_width_unit: 'MM' })}${dd}</layer>`;
const sym = (kind, name, layers) => `<symbol type="${kind}" name="${name}" alpha="1" clip_to_extent="1" force_rhr="0">${layers}</symbol>`;
const single = (kind, layers) => `<renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0"><symbols>${sym(kind, '0', layers)}</symbols></renderer-v2>`;
const categorized = (attr, kind, cats) => `<renderer-v2 type="categorizedSymbol" attr="${attr}" forceraster="0" symbollevels="0" enableorderby="0"><categories>${cats.map((c, i) => `<category render="true" symbol="${i}" value="${c.v}" label="${c.l}"/>`).join('')}</categories><symbols>${cats.map((c, i) => sym(kind, String(i), c.layers)).join('')}</symbols></renderer-v2>`;
const labels = (field, size, color, placement, extra = '') => `<labeling type="simple"><settings calloutType="simple"><text-style fieldName="${field}" isExpression="0" fontFamily="Noto Sans Khmer" fontSize="${size}" fontSizeUnit="Point" textColor="${rgba(color)}" fontWeight="50" namedStyle="Regular" textOpacity="1"><text-buffer bufferDraw="1" bufferSize="0.8" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="0.9"/></text-style><text-format/><placement placement="${placement}" dist="1" distUnits="MM" repeatDistance="80" repeatDistanceUnits="MM" ${extra}/><rendering scaleVisibility="0" obstacle="1"/></settings></labeling>`;
const qml = (body, lab = '') => `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'><qgis version="3.34.0" styleCategories="Symbology|Labeling" labelsEnabled="${lab ? 1 : 0}">${body}${lab}</qgis>`;
const ROADG = [['motorway', 'Motorway / trunk', '#d8442e', 1.2, '#7a1a12'], ['primary', 'Primary road', '#ef8a3a', 1.0, '#8a3a12'], ['secondary', 'Secondary road', '#f7c64a', 0.85, '#7a5a12'], ['tertiary', 'Tertiary road', '#fbe58a', 0.7, '#7a6a3a'],
  ['local', 'Local road / street', '#ffffff', 0.55, '#6b6b6b'], ['track', 'Track (laterite / dirt)', '#8a5a2a', 0.35, null, '5;2'], ['path', 'Path / footpath', '#5a4a3a', 0.25, null, '1.5;1.5']];
const grp = c => c <= 4 ? 'motorway' : c <= 6 ? 'primary' : c <= 8 ? 'secondary' : c <= 10 ? 'tertiary' : c <= 14 ? 'local' : c === 16 ? 'track' : 'path';
const HW = ['', 'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'track', 'footway', 'path', 'cycleway', 'steps', 'construction'];
const roadStyle = () => qml(categorized('grp', 'line', ROADG.map(([v, l, f, w, o, d]) => ({ v, l, layers: (o ? line(o, w + 0.3) : '') + line(f, w, d ? { use_custom_dash: 1, customdash: d, customdash_unit: 'MM' } : {}) }))));

export async function exportGeoPackage(world, say = () => {}) {
  say('Loading SQLite…'); const S = await sqljs(), db = new S.Database();
  const D = world.D, F = world.F, aoi = D.aoi, ll = (x, z) => [+F.lon(x).toFixed(7), +F.lat(z).toFixed(7)], now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  db.run('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
  db.run(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
    CREATE TABLE gpkg_tile_matrix_set (table_name TEXT NOT NULL PRIMARY KEY, srs_id INTEGER NOT NULL, min_x DOUBLE NOT NULL, min_y DOUBLE NOT NULL, max_x DOUBLE NOT NULL, max_y DOUBLE NOT NULL);
    CREATE TABLE gpkg_tile_matrix (table_name TEXT NOT NULL, zoom_level INTEGER NOT NULL, matrix_width INTEGER NOT NULL, matrix_height INTEGER NOT NULL, tile_width INTEGER NOT NULL, tile_height INTEGER NOT NULL, pixel_x_size DOUBLE NOT NULL, pixel_y_size DOUBLE NOT NULL, CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level));
    CREATE TABLE layer_styles (id INTEGER PRIMARY KEY AUTOINCREMENT, f_table_catalog TEXT(256), f_table_schema TEXT(256), f_table_name TEXT(256), f_geometry_column TEXT(256), styleName TEXT(30), styleQML TEXT, styleSLD TEXT, useAsDefault BOOLEAN, description TEXT, owner TEXT(30), ui TEXT(30), update_time DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  const srs = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)');
  srs.run(['Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', '']); srs.run(['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', '']);
  srs.run(['WGS 84 geodetic', 4326, 'EPSG', 4326, WKT4326, 'longitude/latitude']); srs.run(['WGS 84 / Pseudo-Mercator', 3857, 'EPSG', 3857, WKT3857, 'web mercator']); srs.free();
  db.run(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change) VALUES ('layer_styles','attributes','layer_styles','QGIS layer styles','${now}')`);
  let order = 0;
  const layer = (name, title, gtype, fields, rows, style) => {
    if (!rows.length) return 0; const T = { 1: 'POINT', 2: 'LINESTRING', 3: 'POLYGON' }[gtype];
    db.run(`CREATE TABLE "${name}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom ${T}${fields.map(([f, t]) => `, "${f}" ${t}`).join('')})`);
    const st = db.prepare(`INSERT INTO "${name}" (geom${fields.map(([f]) => `,"${f}"`).join('')}) VALUES (?${fields.map(() => ',?').join('')})`);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rows) { const g = r.g; const pts = gtype === 1 ? [g] : gtype === 2 ? g : g.flat(); for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      st.run([gpkgGeom(gtype, g), ...fields.map(([f]) => r[f] ?? null)]); }
    st.free();
    db.run(`INSERT INTO gpkg_contents VALUES (?,?,?,?,?,?,?,?,?,?)`, [name, 'features', title, `${title} – Cambodia 3D Landscape`, now, x0, y0, x1, y1, 4326]);
    db.run(`INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,0,0)`, [name, 'geom', T, 4326]);
    if (style) db.run(`INSERT INTO layer_styles (f_table_catalog,f_table_schema,f_table_name,f_geometry_column,styleName,styleQML,styleSLD,useAsDefault,description,owner,ui) VALUES ('','',?,?,?,?,'',1,?,'','')`, [name, 'geom', title, style, `Cambodia 3D Landscape · ${++order}`]);
    return rows.length;
  };
  const ring = r => { const o = r.map(([x, z]) => ll(x, z)); if (o.length && (o[0][0] !== o[o.length - 1][0] || o[0][1] !== o[o.length - 1][1])) o.push(o[0]); return o; };
  const cnt = {};
  say('Vector layers…');
  cnt.aoi = layer('area_of_interest', 'Area of interest', 3, [['name', 'TEXT'], ['width_m', 'REAL'], ['height_m', 'REAL']], [{ g: [[[aoi.w, aoi.s], [aoi.e, aoi.s], [aoi.e, aoi.n], [aoi.w, aoi.n], [aoi.w, aoi.s]]], name: 'AOI', width_m: D.W, height_m: D.H }],
    qml(single('fill', fill('#000000', '#e01010', 0.6, { alpha: 0 }))));
  cnt.roads = layer('roads', 'Roads (OpenStreetMap)', 2, [['highway', 'TEXT'], ['grp', 'TEXT'], ['surface', 'INTEGER'], ['lanes', 'INTEGER'], ['width_m', 'REAL'], ['oneway', 'INTEGER'], ['bridge', 'INTEGER']],
    (D.roads || []).map(r => ({ g: r.pts.map(([x, z]) => ll(x, z)), highway: HW[r.cls] || '', grp: grp(r.cls), surface: r.surf, lanes: r.lanes, width_m: r.st ? +r.st.w.toFixed(1) : null, oneway: r.flags & 1 ? 1 : 0, bridge: r.flags & 2 ? 1 : 0 })), roadStyle());
  cnt.rail = layer('railways', 'Railways', 2, [['kind', 'TEXT']], (D.rails || []).map(r => ({ g: r.map(([x, z]) => ll(x, z)), kind: 'rail' })),
    qml(single('line', line('#222222', 0.6) + line('#ffffff', 0.35, { use_custom_dash: 1, customdash: '2;2', customdash_unit: 'MM' }))));
  cnt.ww = layer('waterways', 'Rivers, streams and canals', 2, [['kind', 'TEXT']], (D.waterways || []).map(w => ({ g: w.pts.map(([x, z]) => ll(x, z)), kind: ['', 'river', 'canal', 'stream', 'ditch'][w.t] || 'stream' })),
    qml(single('line', line('#3f7fbf', 0.4))));
  cnt.water = layer('water_areas', 'Lakes, ponds and reservoirs', 3, [['kind', 'TEXT']], (D.waterPolys || []).map(rs => ({ g: rs.map(ring), kind: 'water' })), qml(single('fill', fill('#a9cdea', '#3f7fbf', 0.2))));
  const bTypes = ['', 'house', 'apartments', 'commercial', 'industrial', 'school', 'religious', 'hospital', 'public', 'office', 'shed', 'stupa', 'other'];
  cnt.bldg = layer('buildings_osm', 'Buildings (OpenStreetMap)', 3, [['type', 'TEXT'], ['levels', 'INTEGER'], ['height_m', 'REAL']], (D.buildings || []).map(b => ({ g: [ring(b.ring)], type: bTypes[b.t] || String(b.t), levels: b.lv || null, height_m: b.hdm > 20 ? b.hdm / 10 : null })),
    qml(single('fill', fill('#3a3a3a', '#222222', 0.1))));
  cnt.houses = layer('houses_from_image', 'Houses (inferred from the image)', 3, [['roof', 'TEXT'], ['stilts', 'INTEGER'], ['source', 'TEXT']], (world.housesList || []).map(b => ({ g: [ring(b.ring)], roof: b.roof, stilts: b.stilt ? 1 : 0, source: 'inferred from built-up pixels near roads' })),
    qml(single('fill', fill('#6a6a6a', '#333333', 0.1))));
  say('Contours…');
  const td = terrainData(world, 'auto', 10000);
  cnt.contours = layer('contours', `Contours (${td.CI} m)`, 2, [['elev_m', 'REAL'], ['index', 'INTEGER']], td.contours.map(c => ({ g: c.line.map(([x, z]) => ll(x, z)), elev_m: Math.round(c.L * 10) / 10, index: c.idx ? 1 : 0 })),
    qml(categorized('index', 'line', [{ v: '0', l: `Contour ${td.CI} m`, layers: line('#a8662e', 0.14) }, { v: '1', l: `Index contour ${td.CI * td.IDX} m`, layers: line('#a8662e', 0.35) }]),
      `<labeling type="rule-based"><rules key="r"><rule key="r1" filter="&quot;index&quot; = 1"><settings calloutType="simple"><text-style fieldName="elev_m" fontFamily="Noto Sans" fontSize="7" textColor="138,74,30,255"><text-buffer bufferDraw="1" bufferSize="0.7" bufferSizeUnits="MM" bufferColor="255,255,255,255"/></text-style><placement placement="3" repeatDistance="60" repeatDistanceUnits="MM"/></settings></rule></rules></labeling>`));
  cnt.spots = layer('spot_heights', 'Spot heights', 1, [['elev_m', 'REAL']], td.spots.map(([x, z]) => ({ g: ll(x, z), elev_m: Math.round(world.rawElevation(x, z)) })),
    qml(single('marker', marker('circle', '#222222', 1)), labels('elev_m', 7, '#222222', 0)));
  // place names and landmarks (bundled OpenStreetMap extract)
  const places = [];
  for (let i = Math.floor((aoi.w - 102) / 0.25); i <= Math.floor((aoi.e - 102) / 0.25); i++) for (let j = Math.floor((aoi.s - 10) / 0.25); j <= Math.floor((aoi.n - 10) / 0.25); j++) {
    try { for (const [lon, lat, kind, nk, ne, rel] of await (await fetch(`data/places/${i}_${j}.json`)).json()) if (lon >= aoi.w && lon <= aoi.e && lat >= aoi.s && lat <= aoi.n) places.push({ g: [lon, lat], kind, name_km: nk, name_en: ne, religion: rel, label: [nk, ne].filter(Boolean).join(' · ') }); } catch (e) { }
  }
  const PK = [['city', '#111111', 'circle', 2.6], ['town', '#111111', 'circle', 2.2], ['village', '#111111', 'circle', 1.6], ['hamlet', '#333333', 'circle', 1.2], ['place_of_worship', '#b0302a', 'triangle', 2.4], ['school', '#2f5fbf', 'square', 2], ['hospital', '#d02020', 'cross_fill', 2.6], ['clinic', '#d02020', 'cross_fill', 2.2], ['marketplace', '#111111', 'square', 2], ['peak', '#5a3a1a', 'triangle', 2.2]];
  cnt.places = layer('places_landmarks', 'Place names and landmarks (OpenStreetMap)', 1, [['kind', 'TEXT'], ['name_km', 'TEXT'], ['name_en', 'TEXT'], ['religion', 'TEXT'], ['label', 'TEXT']], places,
    qml(categorized('kind', 'marker', [...PK.map(([v, c, s, z]) => ({ v, l: v, layers: marker(s, c, z) })), { v: '', l: 'other', layers: marker('circle', '#555555', 1.2) }]), labels('label', 8, '#111111', 0)));
  // survey
  const sv = world.survey;
  if (sv) {
    cnt.svp = layer('survey_points', 'Survey points', 1, [['id', 'TEXT'], ['code', 'TEXT'], ['easting', 'REAL'], ['northing', 'REAL'], ['utm_zone', 'TEXT'], ['elev_m', 'REAL'], ['time', 'TEXT']],
      sv.points.map(p => ({ g: [p.lon, p.lat], id: p.id, code: p.code, easting: +p.E.toFixed(2), northing: +p.N.toFixed(2), utm_zone: p.zone + 'N', elev_m: +p.h.toFixed(2), time: p.t })), qml(single('marker', marker('triangle', '#e04020', 2.4)), labels('id', 8, '#111111', 0)));
    cnt.parcels = layer('parcels', 'Parcels', 3, [['name', 'TEXT'], ['area_m2', 'REAL'], ['area_ha', 'REAL'], ['surface_area_m2', 'REAL'], ['perimeter_m', 'REAL']],
      sv.parcels.map(p => ({ g: [[...p.coords, p.coords[0]]], name: p.name, area_m2: +p.area.toFixed(1), area_ha: +(p.area / 1e4).toFixed(4), surface_area_m2: +p.area3.toFixed(1), perimeter_m: +p.per.toFixed(2) })), qml(single('fill', fill('#ff9f1c', '#e07b00', 0.5, { alpha: 40 })), labels('name', 9, '#b05a00', 1)));
  }
  // digitized features
  const ed = world.editor;
  if (ed) {
    const f = t => ed.features.filter(q => q.type === t);
    cnt.myRoads = layer('my_roads', 'My roads', 2, [['road_type', 'TEXT'], ['grp', 'TEXT']], f('road').map(q => ({ g: q.coords, road_type: q.props.road, grp: { primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', residential: 'local', track: 'track', path: 'path' }[q.props.road] || 'local' })), roadStyle());
    cnt.myBldg = layer('my_buildings', 'My buildings', 3, [['floors', 'INTEGER'], ['roof', 'TEXT'], ['wall_color', 'TEXT'], ['roof_color', 'TEXT'], ['stilts', 'INTEGER']], f('building').map(q => ({ g: [[...q.coords, q.coords[0]]], floors: q.props.floors, roof: q.props.roof, wall_color: q.props.wall, roof_color: q.props.roofC, stilts: q.props.stilt ? 1 : 0 })), qml(single('fill', fill('#7a2a8a', '#3a0a4a', 0.2))));
    cnt.myTrees = layer('my_trees', 'My trees', 1, [['kind', 'TEXT']], f('tree').map(q => ({ g: q.coords[0], kind: q.props.kind })), qml(single('marker', marker('circle', '#2f6b2a', 2))));
    cnt.myPonds = layer('my_ponds', 'My ponds', 3, [['kind', 'TEXT']], f('pond').map(q => ({ g: [[...q.coords, q.coords[0]]], kind: 'pond' })), qml(single('fill', fill('#a9cdea', '#3f7fbf', 0.3))));
  }
  // tactical overlay: TacMap symbols (SVG with param() colours) coloured by side
  const tc = world.tactical;
  if (tc && tc.features.length) {
    const { CAT } = await (await import('./tactical.js?v=31')).loadCatalog(), feats = tc.features.filter(q => tc.inAOI(q)), base = q => ({ code: q.code, side: q.side, label: q.label || '', name_en: CAT.catalog[q.code].en, name_km: CAT.catalog[q.code].km, color: tc.color(q.side, q.code) });
    const svgs = {}; for (const q of feats.filter(q => q.geom === 'point')) if (!svgs[q.code]) { try { svgs[q.code] = btoa(unescape(encodeURIComponent(await (await fetch('tac/svg/' + CAT.catalog[q.code].svg)).text()))); } catch (e) { } }
    const svgSym = c => `<layer class="SvgMarker" enabled="1" pass="0" locked="0">${opt({ name: 'base64:' + svgs[c], size: 7, size_unit: 'MM', color: '255,255,255,255', outline_color: '232,23,61,255', outline_width: 0.6, outline_width_unit: 'MM', vertical_anchor_point: '2' })}${ddColor('outlineColor', 'color')}</layer>`;
    cnt.tacP = layer('tactical_points', 'Tactical symbols', 1, [['code', 'TEXT'], ['side', 'TEXT'], ['label', 'TEXT'], ['name_en', 'TEXT'], ['name_km', 'TEXT'], ['color', 'TEXT'], ['rings_m', 'TEXT']],
      feats.filter(q => q.geom === 'point' || q.geom === 'circle').map(q => ({ g: q.coords[0], ...base(q), rings_m: q.props && q.props.rings ? q.props.rings.join(',') : null })),
      qml(categorized('code', 'marker', Object.keys(svgs).map(c => ({ v: c, l: CAT.catalog[c].en, layers: svgSym(c) }))), labels('label', 8, '#111111', 0)));
    cnt.tacL = layer('tactical_lines', 'Tactical lines', 2, [['code', 'TEXT'], ['side', 'TEXT'], ['label', 'TEXT'], ['name_en', 'TEXT'], ['name_km', 'TEXT'], ['color', 'TEXT']],
      feats.filter(q => q.geom === 'line' || q.geom === 'dimension').map(q => ({ g: q.coords, ...base(q) })), qml(single('line', line('#e8173d', 0.8, {}, ddColor('outlineColor', 'color'))), labels('label', 8, '#111111', 2)));
    cnt.tacA = layer('tactical_areas', 'Tactical areas', 3, [['code', 'TEXT'], ['side', 'TEXT'], ['label', 'TEXT'], ['name_en', 'TEXT'], ['name_km', 'TEXT'], ['color', 'TEXT']],
      feats.filter(q => q.geom === 'polygon' || q.geom === 'sector').map(q => ({ g: [[...q.coords, q.coords[0]]], ...base(q) })),
      qml(single('fill', `<layer class="SimpleFill" enabled="1" pass="0" locked="0">${opt({ color: '232,23,61,40', outline_color: '232,23,61,255', outline_width: 0.6, outline_width_unit: 'MM', style: 'solid' })}<data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option type="Map" name="properties"><Option type="Map" name="outlineColor"><Option type="bool" name="active" value="true"/><Option type="QString" name="field" value="color"/><Option type="int" name="type" value="2"/></Option><Option type="Map" name="fillColor"><Option type="bool" name="active" value="true"/><Option type="QString" name="expression" value="set_color_part(&quot;color&quot;,'alpha',40)"/><Option type="int" name="type" value="3"/></Option></Option><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer>`), labels('label', 8, '#111111', 1)));
  }
  // your land-cover training samples in this area
  if (world.trainer) {
    const hs = world.trainer.hereSamples();
    cnt.train = layer('land_cover_training', 'Land cover training samples', 1, [['class_id', 'INTEGER'], ['class_en', 'TEXT'], ['class_km', 'TEXT'], ['color', 'TEXT']],
      hs.map(q => ({ g: [q.lon, q.lat], class_id: q.c, class_en: LC[q.c].en, class_km: LC[q.c].km, color: LC[q.c].c })),
      qml(single('marker', marker('circle', '#ffffff', 1.2, '#111111', ddColor('fillColor', 'color')))));
  }
  // land-cover classes as a lookup table
  db.run(`CREATE TABLE land_cover_classes (id INTEGER PRIMARY KEY, class_en TEXT, class_km TEXT, color TEXT, percent REAL)`);
  for (const k of Object.keys(LC)) db.run('INSERT INTO land_cover_classes VALUES (?,?,?,?,?)', [+k, LC[k].en, LC[k].km, LC[k].c, D.lcPct && D.lcPct[k] ? +(D.lcPct[k] * 100).toFixed(2) : 0]);
  db.run(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change) VALUES ('land_cover_classes','attributes','Land cover classes','13 classes and their share of the area','${now}')`);
  // rasters as tiles in EPSG:3857 (the image is already in Web Mercator tiles)
  say('Raster tiles…');
  const ir = D.ir, z = D.zi, R = 6378137, tileM = 2 * Math.PI * R / 2 ** z, mx0 = -Math.PI * R + ir.x0 * tileM, my1 = Math.PI * R - ir.y0 * tileM, ntx = ir.x1 - ir.x0 + 1, nty = ir.y1 - ir.y0 + 1;
  const tiles = async (name, title, canvas, type) => {
    db.run(`CREATE TABLE "${name}" (id INTEGER PRIMARY KEY AUTOINCREMENT, zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, UNIQUE (zoom_level, tile_column, tile_row))`);
    db.run('INSERT INTO gpkg_contents VALUES (?,?,?,?,?,?,?,?,?,?)', [name, 'tiles', title, title, now, mx0, my1 - nty * tileM, mx0 + ntx * tileM, my1, 3857]);
    db.run('INSERT INTO gpkg_tile_matrix_set VALUES (?,?,?,?,?,?)', [name, 3857, mx0, my1 - nty * tileM, mx0 + ntx * tileM, my1]);
    db.run('INSERT INTO gpkg_tile_matrix VALUES (?,?,?,?,?,?,?,?)', [name, 0, ntx, nty, 256, 256, tileM / 256, tileM / 256]);
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), st = db.prepare(`INSERT INTO "${name}" (zoom_level,tile_column,tile_row,tile_data) VALUES (0,?,?,?)`);
    for (let ty = 0; ty < nty; ty++) for (let tx = 0; tx < ntx; tx++) {
      g.clearRect(0, 0, 256, 256); g.drawImage(canvas, tx * 256, ty * 256, 256, 256, 0, 0, 256, 256);
      const u = c.toDataURL(type, 0.88), bin = atob(u.slice(u.indexOf(',') + 1)), arr = new Uint8Array(bin.length); for (let q = 0; q < bin.length; q++) arr[q] = bin.charCodeAt(q);
      st.run([tx, ty, arr]); if (((ty * ntx + tx) & 15) === 15) { say(`${title}: ${ty * ntx + tx + 1}/${ntx * nty}`); await new Promise(r => setTimeout(r, 0)); }
    }
    st.free();
  };
  await tiles('satellite_image', 'Satellite image', D.img, 'image/jpeg');
  { const c = document.createElement('canvas'); c.width = D.img.width; c.height = D.img.height; const g = c.getContext('2d'), lc = document.createElement('canvas'); lc.width = D.gw; lc.height = D.gh;
    const lg = lc.getContext('2d'), im = lg.createImageData(D.gw, D.gh); for (let q = 0; q < D.lc.length; q++) { const h = LC[D.lc[q]].c; im.data.set([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), D.lc[q] ? 255 : 0], q * 4); } lg.putImageData(im, 0, 0);
    const sx0 = D.pxX(F.lon(D.X0)), sy0 = D.pxY(F.lat(D.Z0)), sy1 = D.pxY(F.lat(D.Z0 + D.H)); g.imageSmoothingEnabled = false; g.drawImage(lc, sx0, sy0, D.pxX(F.lon(D.X0 + D.W)) - sx0, sy1 - sy0);
    await tiles('land_cover', 'Land cover (13 classes)', c, 'image/png'); }
  say('Writing file…');
  const data = db.export(); db.close();
  return { blob: new Blob([data], { type: 'application/geopackage+sqlite3' }), counts: cnt };
}
