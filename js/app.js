// 2D overview map (whole Cambodia, lazy road tiles) + AOI selection + 3D scene control
import * as G from './geo.js?v=27';
import { t, lang, setLang, initLang, onLang } from './i18n.js?v=27';

const $ = id => document.getElementById(id);
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const GOOGLE = [0, 1, 2, 3].map(i => `https://mt${i}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`);
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ROAD_COLOR = ['case', ['==', ['get', 'u'], 1], '#d9733f',
  ['match', ['get', 'c'], [1, 2, 3, 4], '#ff8a3d', [5, 6], '#ffd166', [7, 8, 9, 10], '#f6f0b5', '#ffffff']];
const ROAD_W = ['interpolate', ['exponential', 1.6], ['zoom'], 7, ['match', ['get', 'c'], [1, 3], 1.6, [5], 1.2, 0.6],
  13, ['match', ['get', 'c'], [1, 3], 4, [5, 7], 3, [9, 11], 2, 1.2], 17, ['match', ['get', 'c'], [1, 3], 14, [5, 7], 11, [9, 11, 12], 7, 4]];

let basemap = 'esri', aoiMode = 'tap', aoi = null, world = null, tileIndex = new Set();

/* ---------------- map ---------------- */
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      google: { type: 'raster', tiles: GOOGLE, tileSize: 256, maxzoom: 20, attribution: 'Imagery © Google' },
      labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 19 },
      roadsOv: { type: 'geojson', data: 'data/overview_roads.geojson', attribution: OSM_CREDIT },
      roadsDet: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      aoi: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'google', type: 'raster', source: 'google', layout: { visibility: 'none' } },
      { id: 'roadsOv', type: 'line', source: 'roadsOv', maxzoom: 12.5, paint: { 'line-color': ROAD_COLOR, 'line-width': ROAD_W, 'line-opacity': 0.85 } },
      { id: 'roadsDet', type: 'line', source: 'roadsDet', minzoom: 12.5, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROAD_COLOR, 'line-width': ROAD_W, 'line-opacity': 0.8 } },
      { id: 'labels', type: 'raster', source: 'labels' },
      { id: 'aoiFill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#2f7fd0', 'fill-opacity': 0.14 } },
      { id: 'aoiLine', type: 'line', source: 'aoi', paint: { 'line-color': '#4aa3ff', 'line-width': 2.5 } },
    ],
  },
  center: [104.9, 12.6], zoom: 6.6, maxBounds: [[100.5, 8.8], [109.5, 16.2]], attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.touchZoomRotate.disableRotation();

fetch('data/index.json').then(r => r.json()).then(j => { for (const [x, y] of j.tiles) tileIndex.add(x + '/' + y); validateAoi(); });

/* lazy detail roads: only the z13 tiles in view, only when zoomed in */
const detailCache = new Map();
async function refreshDetail() {
  if (!$('roadsOn').checked || map.getZoom() < 12.5) return;
  const b = map.getBounds(), r = G.tileRange({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }, G.TZ);
  const want = [];
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) if (tileIndex.has(x + '/' + y)) want.push([x, y]);
  if (want.length > 40) return;
  await Promise.all(want.map(async ([x, y]) => {
    const k = x + '/' + y; if (detailCache.has(k)) return;
    const d = await G.loadOsmTile(x, y); const feats = [];
    for (const [c, s, , , f, , , enc] of (d && d.r) || []) {
      if (c >= 17) continue;
      const unpaved = s >= 4 || (!s && (c === 16 || (c >= 11 && !(f & 8) && c !== 13)));
      feats.push({ type: 'Feature', properties: { c, u: unpaved ? 1 : 0 }, geometry: { type: 'LineString', coordinates: G.decode(enc, x, y) } });
    }
    detailCache.set(k, feats);
  }));
  const feats = []; for (const [x, y] of want) feats.push(...(detailCache.get(x + '/' + y) || []));
  map.getSource('roadsDet').setData({ type: 'FeatureCollection', features: feats });
}
map.on('moveend', refreshDetail);

/* ---------------- panel controls ---------------- */
function seg(id, cb) {
  const el = $(id);
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
seg('basemap', v => { basemap = v; map.setLayoutProperty('esri', 'visibility', v === 'esri' ? 'visible' : 'none'); map.setLayoutProperty('google', 'visibility', v === 'google' ? 'visible' : 'none'); });
seg('aoiMode', v => { aoiMode = v; map.getCanvas().style.cursor = v === 'box' ? 'crosshair' : ''; $('aoiInfo').textContent = v === 'box' ? 'Drag on the map to draw a box.' : 'Tap the map to place a square.'; });
$('labels').onchange = e => map.setLayoutProperty('labels', 'visibility', e.target.checked ? 'visible' : 'none');
$('roadsOn').onchange = e => { const v = e.target.checked ? 'visible' : 'none'; map.setLayoutProperty('roadsOv', 'visibility', v); map.setLayoutProperty('roadsDet', 'visibility', v); refreshDetail(); };
// panels can be hidden (⟨) and shown again (☰)
const FAB = { mapPanel: 'mapToggle', scenePanel: 'sceneToggle' };
function showPanel(id, on) { $(id).classList.toggle('hidden', !on); $(FAB[id]).classList.toggle('show', !on); if (id === 'scenePanel' && typeof syncRail === 'function') syncRail(); }
$('mapToggle').onclick = () => showPanel('mapPanel', true);
$('sceneToggle').onclick = () => showPanel('scenePanel', true);
document.querySelectorAll('.hideP').forEach(b => b.onclick = () => showPanel(b.dataset.panel, false));
/* icon rail: flyout sections + tool panels */
const FLY_T = { view: 'Views', display: 'Display', env: 'Environment', info: 'Land cover & statistics' };
let flySec = 'view';
function openFly(sec) {
  flySec = sec; document.querySelectorAll('#scenePanel section[data-sec]').forEach(x => x.hidden = x.dataset.sec !== sec);
  $('flyTitle').textContent = t(FLY_T[sec]); showPanel('scenePanel', true); syncRail();
}
document.querySelectorAll('#rail [data-fly]').forEach(b => b.onclick = () => {
  const open = !$('scenePanel').classList.contains('hidden');
  if (open && flySec === b.dataset.fly) { showPanel('scenePanel', false); syncRail(); } else openFly(b.dataset.fly);
});
function syncRail() {
  const open = !$('scenePanel').classList.contains('hidden');
  document.querySelectorAll('#rail [data-fly]').forEach(b => b.classList.toggle('on', open && b.dataset.fly === flySec));
  const P = { layersBtn: 'layerPanel', surveyBtn: 'surveyPanel', editBtn: 'editPanel', sectionBtn: 'sectionPanel', tacBtn: 'tacPanel', topoBtn: 'topoPanel' };
  for (const [b, p] of Object.entries(P)) if ($(b) && $(p)) $(b).classList.toggle('act', !$(p).hidden);
}
setInterval(syncRail, 500);

/* search (Nominatim, Cambodia only) */
let searchTimer;
$('q').addEventListener('input', e => {
  clearTimeout(searchTimer); const q = e.target.value.trim(); if (q.length < 3) { $('results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=kh&limit=6&q=${encodeURIComponent(q)}`);
      const list = await r.json();
      $('results').innerHTML = '';
      for (const it of list) {
        const d = document.createElement('div'); d.textContent = it.display_name;
        d.onclick = () => { $('results').innerHTML = ''; $('q').value = it.display_name.split(',')[0]; const lon = +it.lon, lat = +it.lat; map.flyTo({ center: [lon, lat], zoom: 14.5 }); placeSquare(lon, lat); };
        $('results').appendChild(d);
      }
    } catch { $('results').innerHTML = '<div>Search unavailable</div>'; }
  }, 350);
});

/* ---------------- AOI ---------------- */
const label = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'aoi-label' }), anchor: 'bottom' });
function kmSize(a) { const lat = (a.s + a.n) / 2; return [(a.e - a.w) * 111.32 * Math.cos(lat * Math.PI / 180), (a.n - a.s) * 110.574]; }
function setAoi(a, fromHash) {
  aoi = a;
  map.getSource('aoi').setData(a ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[a.w, a.s], [a.e, a.s], [a.e, a.n], [a.w, a.n], [a.w, a.s]]] } } : { type: 'FeatureCollection', features: [] });
  if (a) { const [wk, hk] = kmSize(a); label.getElement().textContent = `${wk.toFixed(2)} × ${hk.toFixed(2)} km`; label.setLngLat([(a.w + a.e) / 2, a.n]).addTo(map); }
  else label.remove();
  validateAoi();
  if (a && !fromHash) history.replaceState(null, '', '#aoi=' + [a.w, a.s, a.e, a.n].map(v => v.toFixed(5)).join(','));
}
function placeSquare(lon, lat) {
  const km = +$('aoiSize').value, dlat = km / 2 / 110.574, dlon = km / 2 / (111.32 * Math.cos(lat * Math.PI / 180));
  setAoi({ w: lon - dlon, e: lon + dlon, s: lat - dlat, n: lat + dlat });
}
function validateAoi() {
  const info = $('aoiInfo'), btn = $('build');
  if (!aoi) { btn.disabled = true; return; }
  const [wk, hk] = kmSize(aoi), area = wk * hk;
  const r = G.tileRange(aoi, G.TZ); let has = false;
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) if (tileIndex.has(x + '/' + y)) has = true;
  info.classList.remove('warn');
  if (area > 20) { info.textContent = `Area is ${area.toFixed(1)} km² – please keep it under 20 km² so it stays fast.`; info.classList.add('warn'); btn.disabled = true; return; }
  if (area < 0.04) { info.textContent = 'Area is too small.'; info.classList.add('warn'); btn.disabled = true; return; }
  info.textContent = `${area.toFixed(2)} km²` + (has || !tileIndex.size ? ' · ready to build' : ' · outside the Cambodia OSM data (imagery + terrain only)') + (area > 9 ? ' · large area: may be slow on phones' : '');
  btn.disabled = false;
}
map.on('click', e => {
  const A = world && world.D && world.D.aoi, ll = e.lngLat;
  if (A && ll.lng > A.w && ll.lng < A.e && ll.lat > A.s && ll.lat < A.n) { // inside the area already in 3D: jump there
    const el = document.createElement('div'); el.className = 'pop';
    el.innerHTML = '<b>Go here in 3D</b><button data-g="walk">🚶 Walk here</button><button data-g="drive">🚗 Drive nearest road</button><button data-g="look">👁 Look here</button><button data-g="new">⬚ New area here</button>';
    const pop = new maplibregl.Popup({ closeButton: true }).setLngLat(ll).setDOMContent(el).addTo(map);
    el.onclick = ev => {
      const g = ev.target.dataset.g; if (!g) return; pop.remove();
      if (g === 'new') { placeSquare(ll.lng, ll.lat); return; }
      openScene(); const x = world.F.x(ll.lng), z = world.F.z(ll.lat);
      if (g === 'walk') { world.setMode('walk'); world.teleport(x, z); } else if (g === 'drive') { world.setMode('drive'); world.teleport(x, z); } else world.teleport(x, z, 'orbit');
    };
    return;
  }
  if (aoiMode === 'tap') placeSquare(ll.lng, ll.lat);
});
// live position of the 3D viewer on the 2D map
const posEl = document.createElement('div'); posEl.className = 'posmark';
posEl.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M11 1 L18 20 L11 15 L4 20 Z" fill="#ff4d3d" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
const posMarker = new maplibregl.Marker({ element: posEl, rotationAlignment: 'map' });
setInterval(() => {
  if (!world || !world.hud || world.hud.lat === undefined) return;
  posMarker.setLngLat([world.hud.lon, world.hud.lat]).setRotation(world.hud.heading); if (!posMarker._map) posMarker.addTo(map);
}, 500);
let drag = null;
const startBox = e => { if (aoiMode !== 'box') return; e.preventDefault(); map.dragPan.disable(); drag = e.lngLat; };
const moveBox = e => { if (!drag || !e.lngLat) return; const a = drag, b = e.lngLat; setAoi({ w: Math.min(a.lng, b.lng), e: Math.max(a.lng, b.lng), s: Math.min(a.lat, b.lat), n: Math.max(a.lat, b.lat) }); };
const endBox = () => { if (!drag) return; drag = null; map.dragPan.enable(); };
map.on('mousedown', startBox); map.on('touchstart', startBox);
map.on('mousemove', moveBox); map.on('touchmove', moveBox);
map.on('mouseup', endBox); map.on('touchend', endBox);
$('aoiSize').onchange = () => { if (aoi && aoiMode === 'tap') placeSquare((aoi.w + aoi.e) / 2, (aoi.s + aoi.n) / 2); };

let hashDone = false;
const applyHash = () => {
  if (hashDone || !map.getSource('aoi')) return; hashDone = true;
  const m = location.hash.match(/aoi=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/);
  if (m) { const [w, s, e, n] = m.slice(1).map(Number); setAoi({ w, s, e, n }, true); map.fitBounds([[w, s], [e, n]], { padding: 80, duration: 0 }); }
};
map.on('style.load', applyHash); map.on('load', applyHash); map.on('idle', applyHash);

/* ---------------- 3D ---------------- */
const progress = t => { $('progress').hidden = !t; $('progressText').textContent = t; };
let t0 = 0, busy = false;
function renderStats() {
  const s = world.D.stats, tr = s.trees || {}, nT = (tr.round || 0) + (tr.tall || 0) + (tr.wide || 0), nP = (tr.sugar || 0) + (tr.coco || 0);
  $('stats').innerHTML = `${s.roads} road segments · ${s.buildings} OSM buildings${s.houses ? ` + ${s.houses} houses from image` : ""} · ${nT} trees, ${nP} palms, ${tr.bush || 0} bushes · ${s.vehicles || 0} vehicles · ${s.people || 0} people · ${s.cows || 0} cows<br>` +
    `Elevation ${s.elev[0].toFixed(0)}–${s.elev[1].toFixed(0)} m (×${s.exag}) · imagery zoom ${s.imageryZoom}` + (s.waterDropped ? ` · ${s.waterDropped} seasonal/dry water polygons hidden` : '') +
    ` · ${((performance.now() - t0) / 1000).toFixed(1)} s` +
    (s.cloud && s.cloud.cloudPct > 0.5 ? `<br>☁ Clouds ${s.cloud.cloudPct.toFixed(0)}% of the image → filled ${s.cloud.filledPct.toFixed(0)}% from ` + Object.entries(s.cloud.sources).map(([k, n]) => `${k} (${n} tile${n > 1 ? 's' : ''})`).join(', ') +
      (world.lulc.cloud > 0.005 ? ` · ${(world.lulc.cloud * 100).toFixed(0)}% still unknown` : '') : '');
  const LCm = world.LC, P = world.D.lcPct || {};
  const keys = Object.keys(P).map(Number).filter(k => k > 0).sort((a, b) => P[b] - P[a]);
  $('lulc').innerHTML = `<label class="lbl">Land cover · ${keys.length} classes${world.D.lcIO ? ' (image + Esri 10 m + OSM)' : ' (image + OSM)'}</label><div class="bar2">` +
    keys.map(k => `<span style="width:${(P[k] * 100).toFixed(2)}%;background:${LCm[k].c}" title="${LCm[k].en}"></span>`).join('') + '</div><div class="lcl">' +
    keys.map(k => `<i style="background:${LCm[k].c}"></i><span data-lc="${k}">${lang === 'km' ? LCm[k].km : LCm[k].en}</span><b>${(P[k] * 100).toFixed(1)}%</b>`).join('') + '</div>';
  $('credit').innerHTML = `${world.credit} · Soil: ISRIC SoilGrids · Geology: ODC 2006 · Land cover 2017–2025: Esri | Impact Observatory · Terrain: Mapzen/AWS Terrain Tiles · ${OSM_CREDIT} · Geoinformatics and Research Lab, RUPP`;
}
async function rebuild() {
  if (busy) return; busy = true; if (world.D && world.D.built) t0 = performance.now(); if (world.D) world.D.built = true;
  try { await world.construct({ exaggeration: +$('terrainH').value, smooth: $('smooth').checked }, progress); renderStats(); }
  catch (e) { console.error(e); progress('Failed: ' + e.message); setTimeout(() => progress(''), 6000); }
  busy = false; progress('');
  document.querySelectorAll('#scenePanel [data-k]').forEach(c => world.setVisible(c.dataset.k, c.checked));
}
function setOn(id, v) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
$('build').onclick = async () => {
  $('mapView').hidden = true; $('sceneView').hidden = false;
  if (!world) {
    progress('Starting 3D engine…'); const { World } = await import('./world.js?v=27'); world = new World($('scene')); window.__world = world;
    world.onModeChange = m => {
      $('driveBar').hidden = m !== 'drive'; $('walkBar').hidden = m !== 'walk'; $('joy').hidden = m !== 'walk'; if (SV && !$('surveyPanel').hidden) svRender();
      if (m === 'drive' || m === 'walk') { setOn('views', m); showPanel('scenePanel', false); }
    };
    world.onHint = t => { $('driveHint').textContent = t; };
    world.onVehicle = k => { $('vehicle').value = k; };
    world.onSectionHint = t => { $('secHint').textContent = t; };
    world.onSection = async S => {
      const { drawProfile, legendHTML } = await import('./section.js?v=27');
      $('sectionPanel').classList.remove('picking', 'min'); $('secMin').textContent = '▾';
      const cv = $('secCanvas'); cv.width = Math.min(1600, Math.round(cv.clientWidth * Math.min(2, devicePixelRatio))); cv.height = Math.round(cv.width * 0.36);
      drawProfile(cv, S); $('secLegend').innerHTML = legendHTML(S); $('secHint').textContent = 'Done – ↺ for a new line, ▾ to minimise';
    };
    const { joystick } = await import('./modes.js?v=27'); joystick($('joy'), (x, y) => world.walker.move.set(x, y));
    const { Hud } = await import('./hud.js?v=27'); new Hud($('hud'), world);
  }
  world.paused = false;
  const [wk, hk] = kmSize(aoi);
  $('aoiTitle').textContent = `${wk.toFixed(1)} × ${hk.toFixed(1)} km · ${((aoi.s + aoi.n) / 2).toFixed(4)}°N ${((aoi.w + aoi.e) / 2).toFixed(4)}°E`;
  setOn('views', 'overview'); setOn('ground', 'sat');
  try { t0 = performance.now(); await world.load(aoi, { imagery: basemap, cloudFill: $('cloudFill').checked }, progress); }
  catch (e) { console.error(e); progress('Failed: ' + e.message); setTimeout(() => progress(''), 6000); return; }
  await rebuild();
  $('hud').hidden = false;
};
function openScene() { $('mapView').hidden = true; $('sceneView').hidden = false; if (world) world.paused = false; }
$('return3d').onclick = () => openScene();
$('back').onclick = () => { if (world) { world.setMode('orbit'); world.paused = true; } $('sceneView').hidden = true; $('mapView').hidden = false; $('return3d').hidden = !(world && world.D); map.resize(); };
seg('views', v => {
  if (!world) return;
  if (v === 'drive') world.enterDrive(); else if (v === 'walk') world.setMode('walk'); else world.goView(v);
});
seg('ground', v => world && world.setGround(v));
document.querySelectorAll('#scenePanel [data-k]').forEach(c => c.onchange = () => world && world.setVisible(c.dataset.k, c.checked));
/* time of day, weather, cinematic flight */
const fmtHour = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
$('hour').oninput = e => { if (!world) return; $('hourLbl').textContent = fmtHour(+e.target.value); world.getAtmos().setHour(+e.target.value, false); };
$('hour').onchange = e => world && world.getAtmos().setHour(+e.target.value, true);
document.querySelectorAll('[data-wx]').forEach(b => b.onclick = () => { if (!world) return; document.querySelectorAll('[data-wx]').forEach(x => x.classList.toggle('on', x === b)); world.getAtmos().setWeather(b.dataset.wx); });
$('tourBtn').onclick = () => {
  if (!world || !world.D) return; const A = world.getAtmos();
  if (A.tour) { A.stopTour(); return; }
  if (innerWidth < 900) showPanel('scenePanel', false);
  A.onTourEnd = () => { $('tourBtn').textContent = '🎥 Fly'; $('tourBtn').classList.remove('on'); };
  A.startTour(); $('tourBtn').textContent = '■ Stop'; $('tourBtn').classList.add('on');
};
$('terrainH').oninput = e => { $('terrainVal').textContent = '×' + e.target.value; };
$('terrainH').onchange = () => world && world.D && rebuild();
$('smooth').onchange = () => world && world.D && rebuild();
// drive controls
$('vehicle').onchange = e => world && world.changeVehicle(e.target.value);
$('speed').oninput = e => { $('speedVal').textContent = e.target.value + ' km/h'; if (world && world.driver) world.driver.speed = e.target.value / 3.6; };
$('reverse').onclick = () => world && world.driver && world.driver.reverse();
$('cockpit').onclick = e => { if (!world) return; world.cockpit = !world.cockpit; e.target.classList.toggle('on2', world.cockpit); };
$('pickRoad').onclick = () => world && world.chooseRoad();
$('drive2walk').onclick = () => { if (world && world.driver) { world.setMode('walk'); } };
$('walk2drive').onclick = () => { if (world && world.driver) world.enterDrive(); };
setInterval(() => { if (!world) return; const d = world.driver; $('walk2drive').hidden = !(world.mode === 'walk' && d && d.parked && Math.hypot(world.walker.pos.x - d.pos.x, world.walker.pos.z - d.pos.z) < 8); }, 400);
$('run').onclick = e => { if (!world) return; world.walker.run = !world.walker.run; e.target.classList.toggle('on2', world.walker.run); };
document.querySelectorAll('[data-exit]').forEach(b => b.onclick = () => { world.setMode('orbit'); setOn('views', ''); showPanel('scenePanel', true); });
if (innerWidth < 640) showPanel('mapPanel', false);
/* right-hand column: keep the layer panel under the inset map, never on top of it */
const placeRight = () => {
  const lp = ['surveyPanel', 'editPanel', 'tacPanel', 'topoPanel', 'layerPanel'].map($).find(e => !e.hidden) || $('layerPanel'), hud = $('hud'); if (lp.hidden) { document.body.classList.remove('lp-open'); return; }
  document.body.classList.add('lp-open');
  if (innerWidth < 640) { lp.style.top = ''; lp.style.maxHeight = ''; return; }
  const top = hud.hidden ? 12 : hud.getBoundingClientRect().bottom + 8;
  lp.style.top = top + 'px'; lp.style.maxHeight = (innerHeight - top - 12) + 'px';
};
addEventListener('resize', placeRight);
const RP = { layerPanel: 'lpClose', surveyPanel: 'svClose', editPanel: 'edClose', tacPanel: 'tacClose', topoPanel: 'topoClose' };
function closeOthers(keep) { for (const [p, c] of Object.entries(RP)) if (p !== keep && $(p) && !$(p).hidden && $(c)) $(c).onclick(); }
/* layer explorer */
let LS = null, LAYERS_DEF = null;
const lpRender = () => {
  if (!LS) return; const list = $('lpList'); list.innerHTML = '';
  for (const L of LAYERS_DEF) {
    const st = LS.state[L.id], av = LS.available(L.id), row = document.createElement('div');
    row.className = 'lprow' + (av ? '' : ' na') + (LS.focus === L.id ? ' focus' : '') + (L.id === 'surface' ? ' ground' : '');
    const why = av ? '' : L.under && !(world.U && (L.id === 'geology' || world.U.soilOk)) ? (L.id === 'lctime' ? 'loading…' : world.U ? 'no data' : 'loading…') : L.id === 'lctime' ? 'loading…' : 'none in this area';
    row.innerHTML = `<input type="checkbox" ${st.on ? 'checked' : ''} ${av ? '' : 'disabled'}><i style="background:${L.c}"></i><span title="${L.name}${av ? '' : ' – ' + why}">${L.short || L.name}${av ? '' : ` <em>· ${why === 'none in this area' ? 'none' : why}</em>`}</span><input type="range" min="0" max="100" value="${Math.round(st.op * 100)}" ${av ? '' : 'disabled'}>`;
    const [cb, , , op] = row.children;
    cb.onclick = e => { e.stopPropagation(); LS.setOn(L.id, cb.checked); const sc = document.querySelector(`#scenePanel input[data-k="${L.id}"]`); if (sc) sc.checked = cb.checked; };
    op.oninput = e => { e.stopPropagation(); LS.setOp(L.id, op.value / 100); }; op.onclick = e => e.stopPropagation();
    row.onclick = () => { if (!av) return; if (LS.tour) lpStop(); const f = LS.setFocus(L.id); if (LS.target === 0 && L.side !== 0) LS.setExplode(1); if (f) LS.flyToLayer(f); else LS.frameCamera(); lpRender(); };
    list.appendChild(row);
  }
  lpLegend();
};
const lpLegend = () => {
  const id = LS.focus, el = $('lpLegend'); if (!id) { el.innerHTML = '<span style="color:#8fa2b4">Tap a layer to isolate it. Tap it again to show all.</span>'; return; }
  const L = LAYERS_DEF.find(l => l.id === id), leg = LS.legend && LS.legend[id];
  let h = `<b>${L.name}</b><br>`;
  if (leg) h += leg.map(([n, c]) => `<span class="lg"><i style="background:${c}"></i>${n}</span>`).join('');
  if (id === 'elev' && LS.elevInfo) h += `${Math.round(LS.elevInfo.lo)}–${Math.round(LS.elevInfo.hi)} m · contour every ${LS.elevInfo.step} m (bold every ${LS.elevInfo.step * 5} m)`;
  if (id === 'geology') h += '<br><span style="color:#8fa2b4">Geology of Cambodia 2006 (ODC)</span>';
  if (id === 'topsoil' || id === 'subsoil') h += '<br><span style="color:#8fa2b4">USDA texture, ISRIC SoilGrids 250 m</span>';
  if (id === 'lctime') h += `<br><span style="color:#8fa2b4">${LS.change ? 'Change map' : 'Year ' + LS.year} · Esri | Impact Observatory 10 m annual land cover (Sentinel-2), CC BY 4.0</span>`;
  if (id === 'deep') h += '<br><span style="color:#8fa2b4">Depth drawn on a log scale. Global average depths; Moho for Cambodia from global crust models (approximate).</span>';
  if (id === 'lulc') h += '<br><span style="color:#8fa2b4">Classified from the imagery – the same map that places the trees, grass and rice</span>';
  el.innerHTML = h;
};
const lpStop = () => { LS.stop(); $('lpPlay').textContent = '▶ Play tour'; $('lpPlay').classList.remove('on'); };
$('layersBtn').onclick = async () => {
  if (!world || !world.D) return;
  closeOthers('layerPanel');
  $('layerPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  if (world.mode !== 'orbit') world.setMode('orbit');
  $('lpHint').textContent = 'Preparing layers…';
  const mod = await import('./layers.js?v=27'); LAYERS_DEF = mod.LAYERS;
  LS = await world.openLayers(t => { $('lpHint').textContent = t; });
  LS.onT = t => { $('lpExplode').value = Math.round(t * 100); };
  LS.onFocus = () => lpRender();
  world.onLayersReady = () => { $('lpHint').textContent = ''; lpRender(); };
  world.onLayersCollapse = () => { $('lpExplode').value = 0; lpStop(); lpRender(); };
  world.onLayerToggle = () => lpRender();
  $('lpHint').textContent = world.U ? '' : 'Loading soil & geology…';
  lpRender(); lpTimeUI(); $('lpFloodOn').checked = LS.flood != null; $('lpFlood').disabled = LS.flood == null;
  if (LS.t === 0) { LS.setExplode(1); LS.frameCamera(); }
  LS.loadTime(t => { $('lpHint').textContent = t; }).then(() => { $('lpHint').textContent = ''; lpTimeUI(); lpRender(); });
};
const lpTimeUI = () => { const has = !!(LS && LS.ioYears); $('lpTime').hidden = !has; if (has) { const ys = Object.keys(LS.ioYears).map(Number); $('lpYear').min = Math.min(...ys); $('lpYear').max = Math.max(...ys); $('lpChange').parentElement.lastChild.textContent = ' Show change since ' + Math.min(...ys); } };
$('lpYear').oninput = e => { if (!LS) return; $('lpYearLbl').textContent = e.target.value; LS.setYear(+e.target.value, $('lpChange').checked); lpLegend(); };
$('lpChange').onchange = e => { if (!LS) return; LS.setYear(+$('lpYear').value, e.target.checked); if (LS.focus !== 'lctime') { LS.setFocus('lctime'); if (LS.target === 0) LS.setExplode(1); LS.flyToLayer('lctime'); } lpRender(); };
let yearTimer = null;
$('lpYearPlay').onclick = () => {
  if (yearTimer) { clearInterval(yearTimer); yearTimer = null; $('lpYearPlay').textContent = '▶'; return; }
  if (LS.focus !== 'lctime') { LS.setFocus('lctime'); if (LS.target === 0) LS.setExplode(1); LS.flyToLayer('lctime'); lpRender(); }
  $('lpYearPlay').textContent = '■';
  yearTimer = setInterval(() => { const el = $('lpYear'); let y = +el.value + 1; if (y > +el.max) y = +el.min; el.value = y; el.oninput({ target: el }); }, 1100);
};
const floodRange = () => { const D = world.D; return [Math.floor(D.hmin), Math.ceil(D.hmin + Math.min(40, Math.max(6, (D.hmax - D.hmin) * 0.6)))]; };
const floodUpdate = () => {
  if (!LS) return; const on = $('lpFloodOn').checked; $('lpFlood').disabled = !on;
  const [lo, hi] = floodRange(), lvl = lo + (hi - lo) * $('lpFlood').value / 100, r = LS.setFlood(on ? lvl : null);
  $('lpFloodLbl').textContent = on && r ? `${lvl.toFixed(1)} m · ${r.pct.toFixed(0)}% under water · mean depth ${r.depth.toFixed(1)} m` : '';
};
$('lpFloodOn').onchange = floodUpdate; $('lpFlood').oninput = floodUpdate;
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
  if (!LS) return; const k = b.dataset.nav; if (LS.tour) { lpStop(); lpRender(); }
  if (k === 'l') LS.nudge(-1, 0); if (k === 'r') LS.nudge(1, 0); if (k === 'u') LS.nudge(0, 1); if (k === 'd') LS.nudge(0, -1);
  if (k === 'in') LS.zoom(0.75); if (k === 'out') LS.zoom(1.33); if (k === 'all') LS.frameCamera();
});
const lpSel = on => { if (!LS) return; for (const L of LAYERS_DEF) { if (L.id === 'surface' && !on) continue; if (!LS.available(L.id)) continue; LS.setOn(L.id, on); const sc = document.querySelector(`#scenePanel input[data-k="${L.id}"]`); if (sc) { sc.checked = on; world.setVisible(L.id, on); } } lpRender(); };
$('lpAll').onclick = () => lpSel(true); $('lpNone').onclick = () => lpSel(false);
$('lpSpace').oninput = e => LS && LS.setSpacing(e.target.value / 100);
addEventListener('keydown', e => {
  if (!LS || $('layerPanel').hidden || !world || world.mode !== 'orbit' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], PageUp: [0, 1], PageDown: [0, -1] }[e.key];
  if (m) { LS.nudge(...m); e.preventDefault(); }
  if (e.key === '+' || e.key === '=') LS.zoom(0.8); if (e.key === '-') LS.zoom(1.25);
});
$('lpExplode').oninput = e => { if (LS) { LS.setExplode(e.target.value / 100, true); } };
$('lpApart').onclick = () => { if (LS) { LS.setExplode(1); LS.frameCamera(); } };
$('lpTogether').onclick = () => { if (LS) { lpStop(); LS.setExplode(0); world.goView('oblique'); lpRender(); } };
$('lpPlay').onclick = () => { if (!LS) return; if (LS.tour) { lpStop(); lpRender(); return; } LS.play(); $('lpPlay').textContent = '■ Stop tour'; $('lpPlay').classList.add('on'); };
$('lpMin').onclick = () => { const c = $('layerPanel').classList.toggle('collapsed'); $('lpMin').textContent = c ? '▾' : '▴'; };
$('lpClose').onclick = () => { $('layerPanel').hidden = true; placeRight(); if (LS) { lpStop(); LS.focus = null; LS.setExplode(0, true); world.goView('oblique'); } };

/* survey: points, distance, area, go-to, rover */
let SV = null, SVM = null;
const svSay = t => { $('svHint').textContent = t || ''; };
const SV_HELP = {
  points: 'Tap the ground to drop a point, or walk with the rover and press <b>Mark</b> (or M) to record where the pole tip touches.',
  line: 'Tap points along a route. Distance is measured along the ground, uphill and downhill. Undo removes the last point.',
  area: 'Tap the corners of a plot or field. The area closes on its own. Both flat (map) area and 3D surface area are shown.',
};
const svRender = () => {
  if (!SV) return; const tool = SV.tool, w = world;
  document.querySelectorAll('.svtabs button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  $('svHelp').innerHTML = t(SV_HELP[tool]); $('svCodeRow').hidden = tool !== 'points';
  $('svMark').parentElement.hidden = w.mode !== 'walk';
  const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`, L = SVM.fmtLen, pct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  let h = '';
  if (tool === 'line') {
    const m = SV.measureLine();
    if (m) h = '<table>' + row('Along the ground (3D)', L(m.d3)) + row('Horizontal (map)', L(m.d2)) + row('Straight A→B', L(m.straight)) + row('Climb / descent', `+${m.up.toFixed(1)} / −${m.down.toFixed(1)} m`) +
      row('Height change A→B', `${m.dh >= 0 ? '+' : ''}${m.dh.toFixed(1)} m (${pct(m.grade)})`) + row('Steepest (10 m)', m.maxS.toFixed(1) + '%') + row('Bearing A→B', `${m.brg.toFixed(1)}° ${SVM.dirName(m.brg)}`) + row('Points', SV.verts.length) + '</table>';
    else h = '<span class="svhelp">Tap at least two points.</span>';
    svProfile(m);
  } else svProfile(null);
  if (tool === 'area') {
    const m = SV.measureArea();
    if (m) h = '<table>' + row('Area (map)', SVM.fmtArea(m.A)) + row('Surface area (3D)', SVM.fmtArea(m.A3)) + row('Perimeter', `${L(m.per2)} (3D ${L(m.per3)})`) +
      row('Elevation', `${m.hmin.toFixed(1)} – ${m.hmax.toFixed(1)} m`) + row('Mean elevation', m.hmean.toFixed(1) + ' m') + row('Corners', SV.verts.length) + '</table>';
    else h = '<span class="svhelp">Tap at least three corners.</span>';
  }
  if (tool === 'points') { const p = SV.points[SV.points.length - 1]; h = p ? '<table>' + row('Last point', `${p.id} · ${p.code}`) + row('Lat, Lon', `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`) + row(`UTM ${p.zone}N`, `${p.E.toFixed(1)} E ${p.N.toFixed(1)} N`) + row('Elevation', p.h.toFixed(2) + ' m') + '</table>' : ''; }
  $('svResult').innerHTML = h;
  $('svAreaX').hidden = tool !== 'area' || SV.verts.length < 3;
  if (tool === 'area' && SV.verts.length > 2 && !$('svLevel').value) { const m = SV.measureArea(); $('svLevel').placeholder = m.hmean.toFixed(1); }
  const here = SV.parcelsHere(); $('svParcelCount').textContent = here.length ? `(${here.length})` : '';
  $('svParcels').innerHTML = here.map(p => `<div><span>${p.name}</span><b>${SVM.fmtArea(p.area).split(' (')[0]}</b><button data-pdel="${p.id}" title="Delete">✕</button></div>`).join('') || '<span class="svhelp">Measure an area, then 💾 Save it as a parcel.</span>';
  $('svParcels').querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { SV.parcels = SV.parcels.filter(p => p.id !== b.dataset.pdel); SV.persist(); SV.redraw(); svRender(); });
  const sl = SV.stakeList; $('svStakeInfo').textContent = sl.length ? `${sl.filter(x => x.done).length}/${sl.length} staked${SV.stakeIdx >= 0 ? ' · now ' + sl[SV.stakeIdx].id : ''}` : '';
  $('svPrev').disabled = $('svNext').disabled = !sl.length;
  $('svCount').textContent = SV.points.length ? `(${SV.points.length})` : '';
  $('svList').innerHTML = SV.points.slice().reverse().map(p => `<div><b>${p.id}</b><span title="${p.code}">${p.code} · ${p.E.toFixed(1)} ${p.N.toFixed(1)}</span><span>${p.h.toFixed(1)} m</span><button data-del="${p.id}" title="Delete">✕</button></div>`).join('') || '<span class="svhelp">No points yet.</span>';
  $('svList').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { SV.points = SV.points.filter(p => p.id !== b.dataset.del); SV.redraw(); svRender(); });
};
const svProfile = m => {
  const cv = $('svProfile'); cv.hidden = !m; if (!m) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height, s = m.s, L = 34, R = 8, T = 10, B = 22;
  const hs = s.map(p => p.h), lo = Math.min(...hs), hi = Math.max(...hs), pad = Math.max(1, (hi - lo) * 0.15), e0 = lo - pad, e1 = hi + pad, X = d => L + d / m.d2 * (W - L - R), Y = e => T + (e1 - e) / (e1 - e0) * (H - T - B);
  g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, W, H);
  g.beginPath(); g.moveTo(X(0), H - B); s.forEach(p => g.lineTo(X(p.d), Y(p.h))); g.lineTo(X(m.d2), H - B); g.closePath();
  const gr = g.createLinearGradient(0, T, 0, H - B); gr.addColorStop(0, '#c9a46c'); gr.addColorStop(1, '#8a6a46'); g.fillStyle = gr; g.fill();
  g.strokeStyle = '#2b2620'; g.lineWidth = 2; g.beginPath(); s.forEach((p, i) => i ? g.lineTo(X(p.d), Y(p.h)) : g.moveTo(X(p.d), Y(p.h))); g.stroke();
  g.strokeStyle = 'rgba(255,210,63,.9)'; g.setLineDash([3, 3]); let acc = 0; SV.verts.forEach((v, i) => { if (i) { const q = SV.verts[i - 1]; acc += Math.hypot(v.x - q.x, v.z - q.z); } g.beginPath(); g.moveTo(X(acc), T); g.lineTo(X(acc), H - B); g.stroke(); }); g.setLineDash([]);
  g.fillStyle = '#333'; g.font = '11px system-ui'; g.textAlign = 'right'; g.fillText(hi.toFixed(0) + ' m', L - 3, Y(hi) + 4); g.fillText(lo.toFixed(0) + ' m', L - 3, Y(lo) + 4);
  g.textAlign = 'left'; g.fillText('0', L, H - 7); g.textAlign = 'right'; g.fillText(SVM.fmtLen(m.d2), W - R, H - 7); g.textAlign = 'center'; g.fillText('Elevation profile', W / 2, H - 7);
};
const svOpen = async () => {
  if (!world || !world.D) return;
  closeOthers('surveyPanel');
  SVM = await import('./survey.js?v=27'); SV = world.openSurvey(); SV.onChange = svRender;
  SV.onArrive = () => { svSay('Arrived at the target'); if (SV.tool === 'points') $('svMark').classList.add('pulse'); setTimeout(() => $('svMark').classList.remove('pulse'), 2500); svRender(); };
  if (!$('svCode').options.length) $('svCode').innerHTML = SVM.CODES.map(c => `<option>${c}</option>`).join('');
  $('surveyPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false); svRender();
};
$('surveyBtn').onclick = svOpen;
$('svClose').onclick = () => { $('surveyPanel').hidden = true; if (SV) { SV.active = false; SV.pole.visible = false; } placeRight(); };
$('svMin').onclick = () => { const c = $('surveyPanel').classList.toggle('collapsed'); $('svMin').textContent = c ? '▾' : '▴'; };
document.querySelectorAll('.svtabs button').forEach(b => b.onclick = () => { SV.setTool(b.dataset.tool); svRender(); });
$('svCode').onchange = e => { if (SV) SV.code = e.target.value; };
$('svUndo').onclick = () => SV && SV.undo();
$('svClear').onclick = () => { if (!SV) return; if (SV.tool === 'points') { if (SV.points.length && !confirm(`Delete all ${SV.points.length} points?`)) return; SV.points = []; SV.n = 0; } SV.clear(); svRender(); };
$('svMark').onclick = () => { if (SV && world.mode === 'walk') { SV.markAtPole(); svSay(SV.tool === 'points' ? 'Point recorded' : 'Vertex added at the pole'); } };
$('svRover').onclick = () => { if (!SV) return; const c = world.mode === 'orbit' ? world.controls.target : null; if (world.mode !== 'walk') world.teleport(c ? c.x : world.D.X0 + world.D.W / 2, c ? c.z : world.D.Z0 + world.D.H / 2, 'walk'); svSay('Walk with W A S D or the joystick · M marks'); svRender(); };
const svTarget = () => {
  const ll = SVM && SVM.parseCoord($('svGoto').value); if (!ll) { $('svGotoMsg').textContent = 'Could not read that. Try "11.5631, 104.9282" or "UTM 491500 1278000".'; return false; }
  if (!SV.setTarget(ll, 'Target')) { $('svGotoMsg').textContent = `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)} is outside this 3D area. Go back to the map and build an area there.`; return false; }
  const T = SV.target; $('svGotoMsg').innerHTML = `${T.lat.toFixed(6)}, ${T.lon.toFixed(6)} · UTM ${T.E.toFixed(1)} E ${T.N.toFixed(1)} N · ground ${T.h.toFixed(1)} m`; return true;
};
$('svStake').onclick = () => { if (SV && svTarget()) { world.teleport(SV.target.x, SV.target.z, 'orbit'); svSay('Target set – the green line on the inset map points to it'); } };
$('svWalk').onclick = () => { if (!SV || !svTarget()) return; SV.walkTo(); world.walker.auto.onBlocked = () => svSay('Blocked by a building or water – steer around it, then press Walk there again'); svSay('Walking to the target…'); svRender(); };
$('svJump').onclick = () => { if (!SV || !svTarget()) return; const T = SV.target, fx = -Math.sin(world.walker.yaw), fz = -Math.cos(world.walker.yaw); world.teleport(T.x - fx * 0.8 + fz * 0.3, T.z - fz * 0.8 - fx * 0.3, 'walk', true); svSay('You are at the target'); svRender(); };
$('svGoto').onkeydown = e => { if (e.key === 'Enter') $('svStake').onclick(); };
$('svLevelGo').onclick = () => {
  if (!SV || SV.verts.length < 3) return; const lv = $('svLevel').value === '' ? +$('svLevel').placeholder : +$('svLevel').value; SV.level = lv; SV.redraw();
  const r = SV.cutFill(lv), f = v => v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1);
  $('svCF').innerHTML = `Level ${lv.toFixed(1)} m (pink plane) · <b>Cut ${f(r.cut)} m³</b> · <b>Fill ${f(r.fill)} m³</b> · net ${r.net >= 0 ? 'surplus' : 'shortfall'} ${f(Math.abs(r.net))} m³ · ≈ ${Math.ceil(Math.max(r.cut, r.fill) / 10)} truckloads (10 m³)`;
};
$('svLevel').onkeydown = e => { if (e.key === 'Enter') $('svLevelGo').onclick(); };
$('svParcel').onclick = () => { if (!SV) return; const p = SV.saveParcel($('svParcelName').value.trim()); if (p) { $('svParcelName').value = ''; SV.level = null; $('svCF').textContent = ''; svSay(`Saved ${p.name}`); svRender(); } };
$('svCsvIn').onclick = () => $('svCsvFile').click();
$('svCsvFile').onchange = async e => { const f = e.target.files[0]; if (!f || !SV) return; const n = SV.importCSV(await f.text()); e.target.value = ''; if (!n) { svSay('No coordinates found in that CSV'); return; } svSay(`${n} points to stake out`); const r = SV.stakeGo(0); if (r === false) $('svGotoMsg').textContent = 'The first point is outside this area.'; svRender(); };
const stakeMove = d => { if (!SV || !SV.stakeList.length) return; const r = SV.stakeGo(SV.stakeIdx + d); if (r) { $('svGoto').value = `${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}`; $('svGotoMsg').textContent = `${r.id}: ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`; } else $('svGotoMsg').textContent = 'That point is outside this area.'; svRender(); };
$('svPrev').onclick = () => stakeMove(-1); $('svNext').onclick = () => stakeMove(1);
$('svCsv').onclick = () => SV && download('survey-points.csv', new Blob([SV.csv()], { type: 'text/csv' }));
$('svGeo').onclick = () => SV && download('survey.geojson', new Blob([SV.geojson()], { type: 'application/geo+json' }));
$('svKml').onclick = () => SV && download('survey.kml', new Blob([SV.kml()], { type: 'application/vnd.google-earth.kml+xml' }));
addEventListener('keydown', e => { if (SV && SV.active && world.mode === 'walk' && (e.key === 'm' || e.key === 'M') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) $('svMark').onclick(); });

/* rice season, video recording, Esc */
$('season').onchange = e => world && world.setSeason(e.target.value);
let rec = null;
$('recBtn').onclick = () => {
  if (rec) { rec.stop(); return; }
  if (!world) return; const cv = world.renderer.domElement; if (!cv.captureStream || !window.MediaRecorder) { alert('Video recording is not supported in this browser.'); return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 10e6 }), chunks = [], t0 = Date.now();
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
  r.onstop = () => { clearInterval(tick); rec = null; $('recDot').hidden = true; $('recBtn').textContent = '⏺ Rec'; $('recBtn').classList.remove('on');
    const blob = new Blob(chunks, { type: type || 'video/webm' }); download(`cambodia-3d-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${/mp4/.test(type) ? 'mp4' : 'webm'}`, blob); };
  r.start(1000); rec = r; $('recDot').hidden = false; $('recBtn').textContent = '■ Stop'; $('recBtn').classList.add('on');
};
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !world || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (world.atmos && world.atmos.tour) { world.atmos.stopTour(); return; }
  if (world.mode === 'walk' || world.mode === 'drive') { world.walker.auto = null; world.setMode('orbit'); setOn('views', ''); showPanel('scenePanel', true); e.preventDefault(); }
});

/* digitizing */
let ED = null, EDM = null;
const ED_HELP = {
  road: 'Tap along the new road, then ✓ Finish. It is draped on the ground with shoulders and joins the Drive network.',
  building: 'Rectangle: tap two corners along one side, then a third tap for the depth. Untick Rectangle to tap any shape, then ✓ Finish.',
  tree: 'Tap to plant a tree. Each tap adds one.',
  pond: 'Tap around the pond edge, then ✓ Finish. Water sits at the lowest bank height.',
  delete: 'Tap one of your own features to delete it (roads, buildings, trees, ponds you added).',
};
const edRender = () => {
  if (!ED) return; const t = ED.tool;
  document.querySelectorAll('.edtabs button').forEach(b => b.classList.toggle('on', b.dataset.et === t));
  $('edHelp').textContent = ED_HELP[t]; document.querySelectorAll('.edopt').forEach(d => d.hidden = d.dataset.for !== t);
  $('edFinish').parentElement.hidden = t === 'tree' || t === 'delete';
  $('edFinish').disabled = ED.verts.length < (t === 'road' ? 2 : 3);
  const here = ED.features.filter(f => ED.inAOI(f)), c = k => here.filter(f => f.type === k).length;
  $('edCount').textContent = here.length ? `${c('road')} roads · ${c('building')} buildings · ${c('tree')} trees · ${c('pond')} ponds` : '(nothing yet)';
};
const fillSel = (id, obj, val) => { $(id).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${typeof v === 'string' ? v : v.name}</option>`).join(''); };
$('editBtn').onclick = async () => {
  if (!world || !world.D) return;
  closeOthers('editPanel');
  if (world.mode !== 'orbit') world.setMode('orbit');
  EDM = await import('./editor.js?v=27'); ED = world.openEditor(); ED.onChange = edRender;
  ED.onHover = p => { $('edSnapKind').textContent = p && p.kind ? '→ ' + p.kind : ''; };
  if (!$('edRoad').options.length) { fillSel('#edRoad'.slice(1), EDM.ROAD_TYPES, ED.opts.road); fillSel('edRoof', EDM.ROOFS, ED.opts.roof); fillSel('edWall', EDM.WALLS, ED.opts.wall); fillSel('edRoofC', EDM.ROOF_COLS, ED.opts.roofC); fillSel('edTree', EDM.TREES, ED.opts.tree); }
  $('editPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false); edRender();
};
$('edClose').onclick = () => { $('editPanel').hidden = true; if (ED) { ED.active = false; ED.cancel(); } placeRight(); };
$('edMin').onclick = () => { const c = $('editPanel').classList.toggle('collapsed'); $('edMin').textContent = c ? '▾' : '▴'; };
document.querySelectorAll('.edtabs button').forEach(b => b.onclick = () => { ED.setTool(b.dataset.et); edRender(); });
$('edRoad').onchange = e => ED.opts.road = e.target.value; $('edRoof').onchange = e => ED.opts.roof = e.target.value; $('edWall').onchange = e => ED.opts.wall = e.target.value;
$('edRoofC').onchange = e => ED.opts.roofC = e.target.value; $('edTree').onchange = e => ED.opts.tree = e.target.value; $('edFloors').oninput = e => ED.opts.floors = Math.max(1, Math.min(40, +e.target.value || 1));
$('edSnap').onchange = e => { if (ED) { ED.snapOn = e.target.checked; ED.hoverPt = null; ED.drawHover(); } };
$('edRect').onchange = e => { ED.opts.rect = e.target.checked; ED.cancel(); }; $('edStilt').onchange = e => ED.opts.stilt = e.target.checked;
$('edFinish').onclick = () => { if (ED && ED.finish()) $('edHint').textContent = 'Added'; };
$('edUndo').onclick = () => ED && ED.undo(); $('edCancel').onclick = () => ED && ED.cancel();
$('edExport').onclick = () => ED && download('my-edits.geojson', new Blob([ED.geojson()], { type: 'application/geo+json' }));
$('edImport').onclick = () => $('edFile').click();
$('edFile').onchange = async e => { const f = e.target.files[0]; if (!f || !ED) return; try { const n = ED.importGeoJSON(await f.text()); $('edHint').textContent = `Imported ${n} features`; } catch (err) { $('edHint').textContent = 'Could not read that file'; } e.target.value = ''; };
$('edClear').onclick = () => { if (ED && confirm('Delete everything you added in this area?')) ED.clearAll(); };
addEventListener('keydown', e => { if (!ED || !ED.active || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (e.key === 'Enter') $('edFinish').onclick(); if (e.key === 'Escape') ED.cancel(); if ((e.ctrlKey || e.metaKey) && e.key === 'z') ED.undo(); });

/* tactical */
let TC = null, TCM = null, TCAT = null;
const tacLines = () => Object.entries(TCAT.catalog).filter(([, d]) => d.geom !== 'point');
const nm = d => lang === 'km' ? d.km : d.en;
async function tacRender() {
  if (!TC) return; const CAT = TCAT;
  $('tacConv').innerHTML = Object.entries(CAT.conventions).map(([k, v]) => `<option value="${k}" ${k === TC.conv ? 'selected' : ''}>${lang === 'km' ? v[0] : v[1]}</option>`).join('');
  const pts = Object.entries(CAT.catalog).filter(([, d]) => d.geom === 'point');
  const urls = await Promise.all(pts.map(([c]) => TCM.symbolURL(c, TC.color(TC.side, c))));
  $('tacSyms').innerHTML = pts.map(([c, d], i) => `<button data-code="${c}" title="${nm(d)}" class="${TC.code === c && TC.mode === 'place' ? 'on' : ''}"><img src="${urls[i]}" alt=""></button>`).join('');
  $('tacSyms').querySelectorAll('button').forEach(b => b.onclick = () => { TC.code = b.dataset.code; TC.mode = 'place'; TC.cancel(); tacRender(); $('tacHint').textContent = nm(CAT.catalog[TC.code]); });
  $('tacLines').innerHTML = tacLines().map(([c, d]) => `<button data-code="${c}" class="${TC.code === c && TC.mode === 'place' ? 'on' : ''}"><img src="${TCM.linePreview(c, TC.color(TC.side, c))}" alt="">${nm(d)}</button>`).join('');
  $('tacLines').querySelectorAll('button').forEach(b => b.onclick = () => { TC.code = b.dataset.code; TC.mode = 'place'; TC.cancel(); tacRender(); const g = CAT.catalog[TC.code].geom;
    $('tacHint').textContent = g === 'sector' ? t('Tap the centre, then the two edges') : g === 'circle' ? t('Tap the centre') : g === 'dimension' ? t('Tap two points') : t('Tap points, then ✓ Finish'); });
  document.querySelectorAll('#tacPanel [data-am]').forEach(b => b.classList.toggle('on', TC.mode === b.dataset.am));
  setOn('tacSide', TC.side);
}
const tacTab = k => { document.querySelectorAll('.tactabs button').forEach(b => b.classList.toggle('on', b.dataset.tt === k)); document.querySelectorAll('#tacPanel [data-tp]').forEach(d => d.hidden = d.dataset.tp !== k); };
document.querySelectorAll('.tactabs button').forEach(b => b.onclick = () => { tacTab(b.dataset.tt); if (TC && b.dataset.tt !== 'ana' && /los|viewshed|ring|measure/.test(TC.mode)) { TC.mode = 'place'; tacRender(); } });
$('tacBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('tacPanel'); if (world.mode !== 'orbit') world.setMode('orbit');
  TCM = await import('./tactical.js?v=27'); TCAT = (await TCM.loadCatalog()).CAT;
  TC = await world.openTactical(); TC.onChange = () => {}; TC.onMsg = m => $('tacHint').textContent = t(m); TC.onResult = tacResult;
  $('tacPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false); tacRender();
};
$('tacClose').onclick = () => { $('tacPanel').hidden = true; if (TC) { TC.active = false; TC.cancel(); } placeRight(); };
$('tacMin').onclick = () => { const c = $('tacPanel').classList.toggle('collapsed'); $('tacMin').textContent = c ? '▾' : '▴'; };
seg('tacSide', v => { if (TC) { TC.side = v; tacRender(); } });
$('tacConv').onchange = e => { TC.conv = e.target.value; TC.rebuild(); tacRender(); };
$('tacLabel').oninput = e => { if (TC) TC.label = e.target.value.trim(); };
document.querySelectorAll('#tacPanel [data-am]').forEach(b => b.onclick = () => {
  if (!TC) return; TC.mode = TC.mode === b.dataset.am ? 'place' : b.dataset.am; TC.cancel(); tacRender();
  const H = { los: 'Tap the observer, then the target', viewshed: 'Tap the observation point', ring: 'Tap the centre of the range rings', move: 'Tap a symbol, then its new place', delete: 'Tap a symbol, line or area to delete it' };
  $('tacHint').textContent = TC.mode === 'place' ? '' : t(H[TC.mode]);
});
$('tacObs').oninput = e => TC && (TC.obsH = +e.target.value || 0); $('tacTgt').oninput = e => TC && (TC.tgtH = +e.target.value || 0);
$('tacR').oninput = e => TC && (TC.vsR = Math.max(100, +e.target.value || 1500));
$('tacRings').oninput = e => TC && (TC.rings = e.target.value.split(/[ ,;]+/).map(Number).filter(v => v > 0));
$('tacVeh').onchange = e => TC && (TC.vehicle = e.target.value); $('tacSeason').onchange = e => TC && (TC.season = e.target.value);
$('tacMob').onclick = () => { if (TC) { $('tacHint').textContent = t('Working…'); setTimeout(() => TC.mobilityMap(), 30); } };
$('tacOE').onclick = () => { if (TC && !TC.ownEnemy()) $('tacHint').textContent = t('Place at least one own and one enemy symbol first'); };
$('tacClearA').onclick = () => { if (TC) { TC.clearAnalysis(); $('tacRes').innerHTML = ''; $('tacProf').hidden = true; } };
$('tacFinish').onclick = () => TC && TC.finish(); $('tacUndo').onclick = () => TC && TC.undo(); $('tacCancel').onclick = () => TC && TC.cancel();
$('tacExport').onclick = () => TC && download('tactical-overlay.geojson', new Blob([TC.geojson()], { type: 'application/geo+json' }));
$('tacClearAll').onclick = () => { if (TC && confirm(t('Delete every tactical symbol in this area?'))) TC.clearAll(); };
addEventListener('keydown', e => { if (!TC || !TC.active || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (e.key === 'Enter') TC.finish(); if ((e.ctrlKey || e.metaKey) && e.key === 'z') TC.undo(); });
function tacResult(r) {
  $('tacHint').textContent = ''; const L = v => v >= 1000 ? (v / 1000).toFixed(2) + ' km' : v.toFixed(0) + ' m', row = (k, v) => `<tr><td>${t(k)}</td><td><b>${v}</b></td></tr>`;
  if (r.kind === 'los') {
    $('tacRes').innerHTML = `<table style="width:100%">${row('Line of sight', r.visible ? '✅ ' + t('Visible') : '⛔ ' + t('Hidden') + ' (' + L(r.blockAt) + ')')}${row('Horizontal (map)', L(r.L))}${row('Along the ground (3D)', L(r.d3))}${row('Height change A→B', (r.dh >= 0 ? '+' : '') + r.dh.toFixed(1) + ' m')}${row('Bearing A→B', r.brg.toFixed(1) + '° · ' + r.mils.toFixed(0) + ' mil')}${row('Ground seen from A', r.seenPct.toFixed(0) + '%')}</table>`;
    const cv = $('tacProf'); cv.hidden = false; const g = cv.getContext('2d'), W = cv.width, H = cv.height, P = r.prof, lo = Math.min(...P.map(p => p.g)), hi = Math.max(...P.map(p => Math.max(p.s, p.ray))), pad = (hi - lo) * 0.1 + 1;
    const X = d => 30 + d / r.L * (W - 38), Y = e => 8 + (hi + pad - e) / (hi - lo + 2 * pad) * (H - 30);
    g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(46,125,50,.35)'; g.beginPath(); g.moveTo(X(0), Y(P[0].g)); P.forEach(p => g.lineTo(X(p.d), Y(p.s))); P.slice().reverse().forEach(p => g.lineTo(X(p.d), Y(p.g))); g.fill();
    g.fillStyle = '#c9a46c'; g.beginPath(); g.moveTo(X(0), H - 22); P.forEach(p => g.lineTo(X(p.d), Y(p.g))); g.lineTo(X(r.L), H - 22); g.fill();
    g.strokeStyle = r.visible ? '#178a45' : '#c0392b'; g.setLineDash([6, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(P[0].ray)); g.lineTo(X(r.L), Y(P[P.length - 1].ray)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#333'; g.font = '11px system-ui'; g.fillText('A', X(0) - 2, Y(P[0].ray) - 4); g.fillText('B', X(r.L) - 8, Y(P[P.length - 1].ray) - 4); g.fillText(hi.toFixed(0) + ' m', 2, Y(hi) + 4); g.fillText(lo.toFixed(0) + ' m', 2, Y(lo) + 4); g.fillText(L(r.L), W - 50, H - 6);
    g.fillStyle = 'rgba(46,125,50,.8)'; g.fillText(t('green = trees / buildings'), 40, H - 6);
  } else { $('tacProf').hidden = true; }
  if (r.kind === 'viewshed') $('tacRes').innerHTML = `${t('Viewshed')}: <b>${r.seenPct.toFixed(0)}%</b> ${t('of the ground within')} ${L(r.R)} ${t('is visible from an observer')} ${r.obsH} m ${t('above ground')} (${t('green')} ${t('visible')}, ${t('red')} ${t('hidden')}).`;
  if (r.kind === 'mobility') $('tacRes').innerHTML = `${t(r.vehicle)} · ${t(r.season === 'wet' ? 'Wet season' : 'Dry season')}: <b style="color:#2ecc40">GO ${r.go.toFixed(0)}%</b> · <b style="color:#ffc400">SLOW-GO ${r.slow.toFixed(0)}%</b> · <b style="color:#e62828">NO-GO ${r.no.toFixed(0)}%</b>`;
}

/* topographic map */
let TOPO = null;
$('topoBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('topoPanel');
  $('topoPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  if ($('topoTitle').dataset.aoi !== JSON.stringify(world.D.aoi)) {
    const a = world.D.aoi, lat = (a.s + a.n) / 2, lon = (a.w + a.e) / 2, rev = l => fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&accept-language=${l}`).then(r => r.json()).catch(() => null);
    const [e, k] = await Promise.all([rev('en'), rev('km')]); const pick = r => r && r.address ? (r.address.village || r.address.suburb || r.address.town || r.address.city_district || r.address.county || r.address.state || '') : '';
    $('topoTitle').value = pick(e); $('topoTitleKm').value = pick(k) || pick(e); $('topoTitle').dataset.aoi = JSON.stringify(a);
  }
};
$('topoClose').onclick = () => { $('topoPanel').hidden = true; placeRight(); };
$('topoMin').onclick = () => { const c = $('topoPanel').classList.toggle('collapsed'); $('topoMin').textContent = c ? '▾' : '▴'; };
$('topoMake').onclick = async () => {
  if (!world || !world.D) return; const M = await import('./topomap.js?v=27'); $('topoMake').disabled = true;
  try {
    TOPO = await M.makeTopoMap(world, { paper: $('topoPaper').value, scale: $('topoScale').value, ci: $('topoCI').value, lang: $('topoLang').value, dpi: +$('topoDPI').value, title: $('topoTitle').value.trim(), titleKm: $('topoTitleKm').value.trim(),
      names: $('topoNames').checked, hill: $('topoHill').checked, image: $('topoImg').checked, mine: $('topoMine').checked, survey: $('topoSurvey').checked, tac: $('topoTac').checked }, m => $('topoHint').textContent = t(m));
    const pv = $('topoPrev'); pv.hidden = false; pv.width = 520; pv.height = Math.round(520 * TOPO.canvas.height / TOPO.canvas.width); pv.getContext('2d').drawImage(TOPO.canvas, 0, 0, pv.width, pv.height);
    pv.onclick = () => TOPO.canvas.toBlob(b => window.open(URL.createObjectURL(b), '_blank'));
    $('topoPNG').disabled = $('topoPDF').disabled = false; $('topoHint').textContent = `1:${TOPO.scale.toLocaleString('en')} · ${t('tap the preview to open it full size')}`;
  } catch (e) { console.error(e); $('topoHint').textContent = 'Error: ' + e.message; }
  $('topoMake').disabled = false;
};
const topoName = ext => `topo-${($('topoTitle').value || 'map').replace(/[^A-Za-z0-9]+/g, '_')}-1_${TOPO.scale}.${ext}`;
$('topoPNG').onclick = () => TOPO && TOPO.canvas.toBlob(b => download(topoName('png'), b));
$('topoPDF').onclick = async () => { if (!TOPO) return; $('topoHint').textContent = t('Making PDF…'); const M = await import('./topomap.js?v=27'); await M.toPDF(TOPO, topoName('pdf')); $('topoHint').textContent = ''; };

$('gpkgBtn').onclick = async () => {
  if (!world || !world.D) return; $('gpkgBtn').disabled = true;
  try { const M = await import('./gpkg.js?v=27'), r = await M.exportGeoPackage(world, m => $('topoHint').textContent = t(m));
    const nm = `cambodia3d-${($('topoTitle').value || 'area').replace(/[^A-Za-z0-9]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.gpkg`; download(nm, r.blob);
    $('topoHint').textContent = `${nm} · ${(r.blob.size / 1e6).toFixed(1)} MB · ${Object.values(r.counts).filter(Boolean).length} ${t('vector layers')} + 2 ${t('rasters')}`;
  } catch (e) { console.error(e); $('topoHint').textContent = 'Error: ' + e.message; }
  $('gpkgBtn').disabled = false;
};

/* cross-section tool */
$('sectionBtn').onclick = async () => {
  if (!world || !world.D) return;
  $('sectionPanel').hidden = false; $('sectionPanel').classList.add('picking'); $('secHint').textContent = 'Loading soil and geology data…';
  if (innerWidth < 900) showPanel('scenePanel', false);
  if (world.mode !== 'orbit') world.setMode('orbit');
  try { await world.ensureUnderground(t => { $('secHint').textContent = t; }); } catch (e) { $('secHint').textContent = 'Could not load soil data: ' + e.message; }
  if (world.U && !world.U.soilOk) $('secHint').textContent = 'SoilGrids did not respond – showing geology only. ';
  world.startSection();
};
$('secNew').onclick = () => { if (!world) return; $('sectionPanel').classList.add('picking'); world.startSection(); };
$('secMin').onclick = () => { const m = $('sectionPanel').classList.toggle('min'); $('secMin').textContent = m ? '▴' : '▾'; };
$('secClose').onclick = () => { $('sectionPanel').hidden = true; if (world) { world.sectionPick = null; world.clearSection(); world.section = null; } };
$('secWall').onchange = e => { if (!world) return; world.sectionWallOn = e.target.checked; if (world.sectionWall) world.sectionWall.visible = e.target.checked; };
const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
$('secPng').onclick = () => $('secCanvas').toBlob(b => download('cross-section.png', b));
$('secCsv').onclick = async () => { if (!world || !world.section) return; const { sectionCSV } = await import('./section.js?v=27'); download('cross-section.csv', new Blob([sectionCSV(world.section.S)], { type: 'text/csv' })); };

/* language */
document.querySelectorAll('.langBtn').forEach(b => b.onclick = () => setLang(lang === 'km' ? 'en' : 'km'));
onLang.push(() => { if (TC && !$('tacPanel').hidden) tacRender(); if (world && world.D && world.D.lcPct) renderStats(); $('flyTitle').textContent = t(FLY_T[flySec]); });
initLang();
