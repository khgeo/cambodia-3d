// 2D overview map (whole Cambodia, lazy road tiles) + AOI selection + 3D scene control
import * as G from './geo.js?v=62';
import { t, lang, setLang, initLang, onLang } from './i18n.js?v=62';
const tr = t; // translator, for places where a local variable is called t

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
  const P = { layersBtn: 'layerPanel', surveyBtn: 'surveyPanel', editBtn: 'editPanel', sectionBtn: 'sectionPanel', tacBtn: 'tacPanel', topoBtn: 'topoPanel', lcBtn: 'lcPanel', radarBtn: 'radarPanel', globeBtn: 'globePanel', changeBtn: 'changePanel', intelBtn: 'intelPanel', placeBtn: 'placePanel', skyBtn: 'skyPanel' };
  for (const [b, p] of Object.entries(P)) if ($(b) && $(p)) $(b).classList.toggle('act', !$(p).hidden);
  document.querySelectorAll('#rail .catBtn').forEach(c => c.classList.toggle('act', [...document.querySelectorAll(`#toolDock [data-cat="${c.dataset.cat}"]`)].some(b => b.classList.contains('act'))));
}
// category menus: each rail category opens a list of its tools (icon, name, short description)
const CAT_T = { explore: 'Explore', edit: 'Survey & edit', intel: 'Intelligence', apps: 'Analysis apps', export: 'Export' };
let catOpen = null;
const closeCat = () => { $('catMenu').hidden = true; document.querySelectorAll('#rail .catBtn').forEach(c => c.classList.remove('open')); catOpen = null; };
document.querySelectorAll('#rail .catBtn').forEach(cb => cb.onclick = e => {
  e.stopPropagation(); const cat = cb.dataset.cat; if (catOpen === cat) { closeCat(); return; }
  const tools = [...document.querySelectorAll(`#toolDock [data-cat="${cat}"]`)];
  if (tools.length === 1 && !tools[0].dataset.soon) { closeCat(); tools[0].onclick(); return; } // a single tool opens at once
  const m = $('catMenu'); m.innerHTML = `<h3>${t(CAT_T[cat])}</h3>` + tools.map(b => { const tip = t(b.dataset.tip || ''), i = tip.indexOf(':'), name = i > 0 ? tip.slice(0, i) : tip, desc = i > 0 ? tip.slice(i + 1).trim() : '';
    return `<button class="tool${b.dataset.soon ? ' soon' : ''}${b.classList.contains('act') ? ' act' : ''}" data-id="${b.id}"><span class="ic">${b.textContent}</span><span><b>${name}</b><small>${desc}</small></span>${b.dataset.soon ? `<span class="tag">${t('Coming next')}</span>` : ''}</button>`; }).join('');
  const r = cb.getBoundingClientRect(); m.hidden = false; m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, r.top - 8)) + 'px';
  document.querySelectorAll('#rail .catBtn').forEach(c => c.classList.toggle('open', c === cb)); catOpen = cat;
  m.querySelectorAll('.tool').forEach(x => x.onclick = () => { const b = $(x.dataset.id); if (b.dataset.soon) return; closeCat(); b.onclick && b.onclick(); });
});
addEventListener('click', e => { if (catOpen && !$('catMenu').contains(e.target)) closeCat(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && catOpen) closeCat(); });
document.querySelectorAll('#toolDock [data-soon]').forEach(b => b.onclick = () => { });
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
    progress('Starting 3D engine…'); const { World } = await import('./world.js?v=62'); world = new World($('scene')); window.__world = world; world.onGlobe = v => globeUI(v);
    world.onRightClick = () => { // finish the current drawing
      if (ED && ED.active && !$('editPanel').hidden && ED.verts.length) { $('edFinish').onclick(); return; }
      if (TC && TC.active && !$('tacPanel').hidden && TC.verts.length) { if (TC.finish()) $('tacHint').textContent = t('Added'); return; }
      if (SV && SV.active && !$('surveyPanel').hidden && SV.verts.length) { SV.finished = true; $('svHint') && ($('svHint').textContent = t('Done – click to start a new one')); }
    };
    world.onModeChange = m => {
      $('driveBar').hidden = m !== 'drive'; $('walkBar').hidden = m !== 'walk'; $('joy').hidden = m !== 'walk'; if (SV && !$('surveyPanel').hidden) svRender();
      if (m === 'drive' || m === 'walk') { setOn('views', m); showPanel('scenePanel', false); }
      if (m !== 'walk' && skGazing) { skGazing = false; world.walker.maxPitch = null; $('skGaze').classList.remove('on'); $('skGaze').textContent = '🔭 ' + tr('Stand here and look up'); }
    };
    world.onHint = t => { $('driveHint').textContent = t; };
    world.onVehicle = k => { $('vehicle').value = k; };
    world.onSectionHint = t => { $('secHint').textContent = t; };
    world.onSection = async S => {
      const { drawProfile, legendHTML } = await import('./section.js?v=62');
      $('sectionPanel').classList.remove('picking', 'min'); $('secMin').textContent = '▾';
      const cv = $('secCanvas'); cv.width = Math.min(1600, Math.round(cv.clientWidth * Math.min(2, devicePixelRatio))); cv.height = Math.round(cv.width * 0.36);
      drawProfile(cv, S); $('secLegend').innerHTML = legendHTML(S); $('secHint').textContent = 'Done – ↺ for a new line, ▾ to minimise';
    };
    const { joystick } = await import('./modes.js?v=62'); joystick($('joy'), (x, y) => world.walker.move.set(x, y));
    const { Hud } = await import('./hud.js?v=62'); new Hud($('hud'), world);
  }
  world.paused = false;
  const [wk, hk] = kmSize(aoi);
  $('aoiTitle').textContent = `${wk.toFixed(1)} × ${hk.toFixed(1)} km · ${((aoi.s + aoi.n) / 2).toFixed(4)}°N ${((aoi.w + aoi.e) / 2).toFixed(4)}°E`;
  setOn('views', 'overview'); setOn('ground', 'sat');
  try { t0 = performance.now(); await world.load(aoi, { imagery: basemap, cloudFill: $('cloudFill').checked }, progress); }
  catch (e) { console.error(e); progress('Failed: ' + e.message); setTimeout(() => progress(''), 6000); return; }
  await rebuild();
  $('hud').hidden = false;
  if (world.globe && world.globe.on) world.globe.finishLeave(); if (world.radar) { world.radar.remove(); world.radarPick = false; } if (world.notes) world.notes.rebuild(); applyShared(); if ($('liveWx').checked) liveWeather();
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
$('hour').oninput = e => { if (!world) return; world.getAtmos().skyTime = null; $('hourLbl').textContent = fmtHour(+e.target.value); world.getAtmos().setHour(+e.target.value, false); };
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
  const lp = ['surveyPanel', 'editPanel', 'tacPanel', 'topoPanel', 'lcPanel', 'radarPanel', 'globePanel', 'changePanel', 'intelPanel', 'placePanel', 'skyPanel', 'layerPanel'].map($).find(e => !e.hidden) || $('layerPanel'), hud = $('hud'); if (lp.hidden) { document.body.classList.remove('lp-open'); return; }
  document.body.classList.add('lp-open');
  if (innerWidth < 640) { lp.style.top = ''; lp.style.maxHeight = ''; return; }
  const top = hud.hidden ? 12 : hud.getBoundingClientRect().bottom + 8;
  lp.style.top = top + 'px'; lp.style.maxHeight = (innerHeight - top - 12) + 'px';
};
addEventListener('resize', placeRight);
const RP = { layerPanel: 'lpClose', surveyPanel: 'svClose', editPanel: 'edClose', tacPanel: 'tacClose', topoPanel: 'topoClose', lcPanel: 'lcClose', radarPanel: 'radarClose', changePanel: 'chClose', intelPanel: 'inClose', placePanel: 'plClose', skyPanel: 'skClose' };
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
  if (world.groundStyle && world.groundStyle !== 'sat') { world.setGround('sat'); setOn('ground', 'sat'); } // the satellite surface stays the original image
  $('lpHint').textContent = 'Preparing layers…';
  const mod = await import('./layers.js?v=62'); LAYERS_DEF = mod.LAYERS;
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
  SVM = await import('./survey.js?v=62'); SV = world.openSurvey(); SV.onChange = svRender;
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
  const cl = ED.cleared; if (cl && (cl.trees || cl.houses || cl.buildings)) $('edCount').textContent += ` · ${tr('cleared for new roads')}: ${cl.trees} ${tr('trees')}, ${cl.houses + cl.buildings} ${tr('houses')}`;
};
const fillSel = (id, obj, val) => { $(id).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${typeof v === 'string' ? v : v.name}</option>`).join(''); };
$('editBtn').onclick = async () => {
  if (!world || !world.D) return;
  closeOthers('editPanel');
  if (world.mode !== 'orbit') world.setMode('orbit');
  EDM = await import('./editor.js?v=62'); ED = world.openEditor(); ED.onChange = edRender;
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
  TCM = await import('./tactical.js?v=62'); TCAT = (await TCM.loadCatalog()).CAT;
  TC = await world.openTactical(); TC.onChange = () => {}; TC.onMsg = m => $('tacHint').textContent = t(m); TC.onResult = tacResult; TC.lang = lang; TC.labels = $('tacLabels').value;
  TC.onSelect = f => { if (!f) { $('tacHint').textContent = t('Tap a symbol first'); return; } $('tacHint').textContent = t('Editing') + ': ' + nm(TCAT.catalog[f.code]); $('tacLabel').value = f.label || ''; TC.label = f.label || ''; tacDirSet(f.dir ?? null, false); };
  $('tacPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false); tacRender();
};
$('tacClose').onclick = () => { $('tacPanel').hidden = true; if (TC) { TC.active = false; TC.cancel(); } placeRight(); };
$('tacMin').onclick = () => { const c = $('tacPanel').classList.toggle('collapsed'); $('tacMin').textContent = c ? '▾' : '▴'; };
seg('tacSide', v => { if (TC) { TC.side = v; tacRender(); } });
$('tacConv').onchange = e => { TC.conv = e.target.value; TC.rebuild(); tacRender(); };
$('tacLabel').oninput = e => { if (!TC) return; TC.label = e.target.value.trim(); if (TC.mode === 'edit' && TC.sel) TC.update(TC.sel, { label: TC.label }); };
const tacDirSet = (v, apply = true) => { const on = v !== null && v !== '' && !isNaN(v); v = on ? ((Math.round(+v) % 360) + 360) % 360 : null; $('tacDir').value = on ? v : ''; $('tacDirR').value = on ? v : 0; $('tacDirR').disabled = !on;
  if (!TC) return; TC.dir = v; if (apply && TC.mode === 'edit' && TC.sel) TC.update(TC.sel, { dir: v }); };
$('tacDir').oninput = e => tacDirSet(e.target.value === '' ? null : +e.target.value);
$('tacDirR').oninput = e => tacDirSet(+e.target.value);
$('tacDirX').onclick = () => tacDirSet(null);
$('tacLabels').onchange = e => { if (TC) { TC.labels = e.target.value; TC.lang = lang; TC.rebuild(); } };
document.querySelectorAll('#tacPanel [data-am]').forEach(b => b.onclick = () => {
  if (!TC) return; TC.mode = TC.mode === b.dataset.am ? 'place' : b.dataset.am; TC.cancel(); tacRender();
  const H = { los: 'Tap the observer, then the target', viewshed: 'Tap the observation point', ring: 'Tap the centre of the range rings', move: 'Tap a symbol, then its new place', edit: 'Tap a symbol, then change its label or direction', delete: 'Tap a symbol, line or area to delete it' };
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
  if (!world || !world.D) return; const M = await import('./topomap.js?v=62'); $('topoMake').disabled = true;
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
$('topoPDF').onclick = async () => { if (!TOPO) return; $('topoPDF').disabled = true; $('topoHint').textContent = t('Making PDF…');
  try { const M = await import('./topomap.js?v=62'), extra = $('topoBrief').checked ? await briefPages(m => $('topoHint').textContent = t(m)) : null; await M.toPDF(TOPO, topoName('pdf'), extra); }
  catch (e) { console.error(e); alert(t('Could not make the PDF') + ': ' + e.message); }
  $('topoHint').textContent = ''; $('topoPDF').disabled = false; };

$('gpkgBtn').onclick = async () => {
  if (!world || !world.D) return; $('gpkgBtn').disabled = true;
  try { const M = await import('./gpkg.js?v=62'), r = await M.exportGeoPackage(world, m => $('topoHint').textContent = t(m));
    const nm = `cambodia3d-${($('topoTitle').value || 'area').replace(/[^A-Za-z0-9]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.gpkg`; download(nm, r.blob);
    $('topoHint').textContent = `${nm} · ${(r.blob.size / 1e6).toFixed(1)} MB · ${Object.values(r.counts).filter(Boolean).length} ${t('vector layers')} + 2 ${t('rasters')}`;
  } catch (e) { console.error(e); $('topoHint').textContent = 'Error: ' + e.message; }
  $('gpkgBtn').disabled = false;
};

/* land-cover training */
let LT = null, LT_prevGround = null;
const lcInfo = (msg) => { if (!LT) return; const here = LT.hereSamples().length; $('lcInfo').innerHTML = `${msg ? msg + '<br>' : ''}${t('Samples here')}: <b>${here}</b> · ${t('in all areas')}: <b>${LT.samples.length}</b>`; };
const lcRenderClasses = () => { const LCm = world.LC; $('lcClasses').innerHTML = Object.keys(LCm).map(Number).filter(k => k > 0).map(k => `<button data-c="${k}" class="${LT.cls === k ? 'on' : ''}"><i style="background:${LCm[k].c}"></i>${lang === 'km' ? LCm[k].km : LCm[k].en}</button>`).join('');
  $('lcClasses').querySelectorAll('button').forEach(b => b.onclick = () => { LT.cls = +b.dataset.c; lcRenderClasses(); }); };
const lcLearn = () => { if (!LT) return; $('lcHint').textContent = t('Learning…'); setTimeout(() => { const r = LT.train(), ch = LT.classify(); LT.save(); world.refreshLC(); if (world.D) renderStats(); $('lcHint').textContent = ''; lcInfo(`${t('Model')}: ${r.classes} ${t('classes')} · ${ch.toLocaleString()} ${t('cells changed')}`); }, 20); };
$('lcBtn').onclick = () => {
  if (!world || !world.D) return; closeOthers('lcPanel'); if (world.mode !== 'orbit') world.setMode('orbit');
  LT = world.getTrainer(); $('lcPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  if (world.groundStyle !== 'lulc') LT_prevGround = world.groundStyle || 'sat'; setOn('ground', 'lulc'); world.setGround('lulc');
  import('three').then(T => { if (!world.brushReal) { const m = new T.Mesh(new T.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffe14a, depthTest: false, transparent: true, opacity: 0.9 })); m.renderOrder = 30; world.scene.add(m); world.brush = m; world.brushReal = true; } world.brush.scale.setScalar(LT.radius); world.brush.visible = true; });
  lcSetMode(true); world.setImageOverlay($('lcImg').checked ? $('lcImgA').value / 100 : 0); lcRenderClasses(); lcInfo();
  world.onPaint = (x, z) => { const n = LT.paint(x, z); if (n) world.paintPreview(x, z, LT.radius, world.LC[LT.cls].c); };
  world.onPaintEnd = () => { LT.save(); if ($('lcAuto').checked) lcLearn(); else { world.refreshLC(); renderStats(); lcInfo(); } };
};
$('lcClose').onclick = () => { $('lcPanel').hidden = true; if (world) { world.setPaintMode(false); world.setImageOverlay(0); if (LT_prevGround) { world.setGround(LT_prevGround); setOn('ground', LT_prevGround); LT_prevGround = null; } } placeRight(); };
$('lcMin').onclick = () => { const c = $('lcPanel').classList.toggle('collapsed'); $('lcMin').textContent = c ? '▾' : '▴'; };
$('lcRad').oninput = e => { if (!LT) return; LT.radius = +e.target.value; $('lcRadV').textContent = e.target.value + ' m'; if (world.brush) world.brush.scale.setScalar(LT.radius); };
$('lcTau').oninput = e => { if (LT) LT.tau = e.target.value / 100; $('lcTauV').textContent = e.target.value + '%'; };
function lcSetMode(paint) { if (world) world.setPaintMode(paint); $('lcModePaint').classList.toggle('on', paint); $('lcModeMove').classList.toggle('on', !paint); $('lcNav').hidden = !paint; }
$('lcModePaint').onclick = () => lcSetMode(true); $('lcModeMove').onclick = () => lcSetMode(false);
const lcImgSet = () => { $('lcImgAV').textContent = $('lcImgA').value + '%'; if (world) world.setImageOverlay($('lcImg').checked ? $('lcImgA').value / 100 : 0); };
$('lcImg').onchange = lcImgSet; $('lcImgA').oninput = () => { $('lcImg').checked = true; lcImgSet(); };
addEventListener('keydown', e => { if ($('lcPanel').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (e.key === 'i' || e.key === 'I') { $('lcImg').checked = !$('lcImg').checked; lcImgSet(); } if (e.key === 'm' || e.key === 'M') lcSetMode(!world.lcPaint); });
$('lcAll').onchange = e => { if (LT) LT.useAll = e.target.checked; };
$('lcLearn').onclick = lcLearn;
$('lcReset').onclick = () => { if (!LT) return; LT.reset(); world.refreshLC(); renderStats(); lcInfo(t('Back to the automatic map (your samples are kept).')); };
$('lcForget').onclick = () => { if (!LT || !confirm(t('Delete your training samples in this area?'))) return; LT.forgetHere(); LT.reset(); world.refreshLC(); renderStats(); lcInfo(); };

/* radar */
let RD = null, radarTimer = 0;
const kmFmt = m => m >= 10000 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1), cardinal = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
const radarUI = () => {
  if (!RD) return; $('radarDel').disabled = !RD.placed; if (RD.placed && !world.radarPick && /radar/i.test($('radarHint').textContent)) $('radarHint').textContent = '';
  const L = RD.list(); $('radarStat').textContent = RD.placed ? `${t('Detected')}: ${L.length} · ${t('tracked')}: ${RD.targets.size}${RD.status ? ' · ' + t(RD.status) : ''}` : t('Place the radar on the ground first.');
  $('radarList').innerHTML = L.length ? `<table><tr><th>${t('Flight')}</th><th>${t('Type')}</th><th>FL</th><th>kt</th><th>${t('Track')}</th><th>km</th><th>${t('Bearing')}</th></tr>` + L.slice(0, 40).map(a => `<tr style="color:${a.src === 'live' ? '#ffd23f' : a.kind === 'drone' ? '#ff8b8b' : a.kind === 'heli' ? '#9fdcff' : '#8dffae'}"><td>${a.flight || '—'}</td><td>${a.type || ''}</td><td>${Math.round(a.alt / 0.3048 / 100)}</td><td>${Math.round(a.gs / 0.514444)}</td><td>${Math.round(a.trk)}°</td><td>${kmFmt(a.dist)}</td><td>${Math.round(a.brg * 180 / Math.PI)}° ${cardinal(a.brg * 180 / Math.PI)}</td></tr>`).join('') + '</table>' : '';
};
$('radarBtn').onclick = () => {
  if (!world || !world.D) return; closeOthers('radarPanel'); if (world.mode !== 'orbit') world.setMode('orbit');
  RD = world.openRadar(); RD.scope = $('radarScope'); RD.onChange = radarUI; $('radarProxy').value = RD.proxy;
  $('radarPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  if (!RD.placed) { world.radarPick = true; $('radarHint').textContent = t('Tap the ground to place the radar'); }
  clearInterval(radarTimer); radarTimer = setInterval(radarUI, 1000); radarUI();
};
$('radarClose').onclick = () => { $('radarPanel').hidden = true; if (world) world.radarPick = false; clearInterval(radarTimer); placeRight(); };
$('radarMin').onclick = () => { const c = $('radarPanel').classList.toggle('collapsed'); $('radarMin').textContent = c ? '▾' : '▴'; };
$('radarPlace').onclick = () => { if (!world) return; world.radarPick = true; $('radarHint').textContent = t('Tap the ground to place the radar'); };
$('radarDel').onclick = () => { if (RD) { RD.remove(); radarUI(); } };
seg('radarSrc', v => { if (!RD) return; RD.src = v; RD.lastFetch = 0; if (v === 'sim') { for (const [k, a] of RD.targets) if (a.src === 'live') { RD.dropObj(a); RD.targets.delete(k); } RD.status = ''; } if (RD.placed) RD.seedSim(); radarUI(); });
$('radarRange').onchange = e => { if (RD) { RD.range = +e.target.value; RD.lastFetch = 0; if (RD.placed) RD.place(RD.x, RD.z); } };
$('radarRpm').onchange = e => { if (RD) RD.rpm = +e.target.value; };
$('radarFit').onchange = e => { if (RD) RD.setFit(e.target.checked); };
$('radarAll').onchange = e => { if (RD) RD.showAll = e.target.checked; };
$('radarProxySave').onclick = () => { if (!RD) return; RD.setProxy($('radarProxy').value); RD.lastFetch = 0; $('radarHint').textContent = t('Saved'); };

/* data credits: hide / show */
try { if (localStorage.getItem('cambodia3d.nocredit') === '1') document.body.classList.add('nocredit'); } catch (e) { }
$('creditBtn').onclick = () => { const h = document.body.classList.toggle('nocredit'); try { localStorage.setItem('cambodia3d.nocredit', h ? '1' : '0'); } catch (e) { } };
let creditHTML = '';
/* change detection (Esri Wayback) */
let CH = null, CHV = null, CHS = { mode: 'swipe', swipe: 0.5 };
const chSay = m => $('chHint').textContent = t(m);
$('changeBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('changePanel'); if (world.mode !== 'orbit') world.setMode('orbit'); $('changePanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  CH = CH || await import('./change.js?v=62');
  if (!CHV || CHV.aoi !== world.D.aoi) { chSay('Checking image versions…'); try { const v = await CH.versions(world.D, chSay); CHV = { aoi: world.D.aoi, v };
      $('chBefore').innerHTML = v.map((r, i) => `<option value="${r.num}" ${i === Math.min(v.length - 1, 3) ? 'selected' : ''}>${r.date}</option>`).join('') || `<option>${t('No older images here')}</option>`;
      $('chAfter').innerHTML = `<option value="">${t('Current scene image')}</option>` + v.map(r => `<option value="${r.num}">${r.date}</option>`).join('');
      chSay(`${v.length} ${t('image versions')}`); } catch (e) { chSay('Image archive not reachable'); } }
};
$('chClose').onclick = () => { if (chPlay) $('chPlay').onclick(); $('changePanel').hidden = true; if (world && world._cmp) world.setCompare(null); placeRight(); };
$('chMin').onclick = () => { const c = $('changePanel').classList.toggle('collapsed'); $('chMin').textContent = c ? '▾' : '▴'; };
$('chLoad').onclick = async () => {
  if (!CH || !world.D || !$('chBefore').value) return; $('chLoad').disabled = true;
  try {
    const before = await CH.mosaic(world.D, +$('chBefore').value, chSay), after = $('chAfter').value ? await CH.mosaic(world.D, +$('chAfter').value, chSay) : world.D.img;
    chSay('Finding changes…'); await new Promise(r => setTimeout(r, 20)); CHS.pair = [before, after]; CHS.aoi = world.D.aoi; CHS.beforeDate = $('chBefore').selectedOptions[0].text; const cm = CH.changeMap(before, after, chThr());
    if (after !== world.D.img) { // show the chosen "after" date instead of the scene image
      CHS.afterImg = after; } else CHS.afterImg = null;
    world.setCompare({ before, diff: cm.canvas, mode: CHS.mode, swipe: CHS.swipe, after: CHS.afterImg }); CHS.res = cm;
    const p = cm.pct, f = v => v.toFixed(v < 1 ? 2 : 1) + '%', area = world.D.W * world.D.H / 1e4;
    $('chStats').innerHTML = `${t('Changed')}: <b>${f(p.all)}</b> ${t('of the area')} (≈ ${(p.all / 100 * area).toFixed(1)} ha) · <span style="color:#ff7a5c">${t('built / cleared')} ${f(p.built)}</span> · <span style="color:#5fe07f">${t('vegetation gain')} ${f(p.veg)}</span> · <span style="color:#6fb3ff">${t('water')} ${f(p.water)}</span> · ${t('other')} ${f(p.other)}<br>${$('chBefore').selectedOptions[0].text} → ${$('chAfter').value ? $('chAfter').selectedOptions[0].text : t('scene image')}`;
    chSay('');
  } catch (e) { console.error(e); chSay('Could not load the old image'); }
  $('chLoad').disabled = false;
};
// time-lapse: every image version of the area in turn (activity over the years)
let chPlay = null; const chMosaics = new Map();
$('chPlay').onclick = async () => {
  if (chPlay) { clearInterval(chPlay); chPlay = null; $('chPlay').textContent = '▶ ' + t('Time-lapse of all dates'); $('chDate').hidden = true; return; }
  if (!CH || !CHV || !CHV.v.length) return; const vs = CHV.v.slice().reverse(); $('chPlay').disabled = true;
  for (let i = 0; i < vs.length; i++) { const r = vs[i], k = world.D.aoi.w + ',' + r.num; if (!chMosaics.has(k)) chMosaics.set(k, await CH.mosaic(world.D, r.num, () => chSay(`${t('Loading')} ${r.date} (${i + 1}/${vs.length})`))); }
  chSay(''); $('chPlay').disabled = false; $('chPlay').textContent = '⏸ ' + t('Stop'); $('chDate').hidden = false; let i = 0;
  const show = () => { const r = vs[i % vs.length]; world.setCompare({ mode: 'before', before: chMosaics.get(world.D.aoi.w + ',' + r.num) }); $('chDate').textContent = r.date; i++; }; show(); chPlay = setInterval(show, 1300);
};
const chThr = () => 3.4 - $('chSens').value / 100 * 2.4; // sensitivity 0 → only strong change … 100 → subtle change
$('chSens').onchange = () => { if (!CHS.pair) return; const cm = CH.changeMap(CHS.pair[0], CHS.pair[1], chThr()); CHS.res = cm; world.setCompare({ diff: cm.canvas, mode: 'changes' }); setOn('chMode', 'changes'); CHS.mode = 'changes';
  const p = cm.pct, f = v => v.toFixed(v < 1 ? 2 : 1) + '%', area = world.D.W * world.D.H / 1e4; $('chStats').innerHTML = $('chStats').innerHTML.replace(/^.*?<br>/, `${t('Changed')}: <b>${f(p.all)}</b> ${t('of the area')} (≈ ${(p.all / 100 * area).toFixed(1)} ha) · <span style="color:#ff7a5c">${t('built / cleared')} ${f(p.built)}</span> · <span style="color:#5fe07f">${t('vegetation gain')} ${f(p.veg)}</span> · <span style="color:#6fb3ff">${t('water')} ${f(p.water)}</span> · ${t('other')} ${f(p.other)}<br>`); };
seg('chMode', v => { CHS.mode = v; if (world && world._cmp) world.setCompare({ mode: v }); });
$('chSwipe').oninput = e => { CHS.swipe = e.target.value / 100; if (world && world._cmp) world.setCompare({ swipe: CHS.swipe, mode: 'swipe' }); setOn('chMode', 'swipe'); CHS.mode = 'swipe'; };

/* Place info (like a map app): name, photos, address, details, nearby */
let PI = null, PLACES = null, plLabels = null, plMark = null, plReq = 0;
const esc2 = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function plLoadNames() { if (!world || !world.D) return []; if (PLACES && PLACES.aoi === world.D.aoi) return PLACES.list; const TM = await import('./topomap.js?v=62'), a = world.D.aoi, list = await TM.localNames({ w: a.w - 0.03, e: a.e + 0.03, s: a.s - 0.03, n: a.n + 0.03 }); PLACES = { aoi: world.D.aoi, list }; return list; }
async function plShowNames(on) { if (plLabels) { world.root.remove(plLabels); plLabels.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); plLabels = null; } if (!on) return; const list = await plLoadNames(); plLabels = PI.placeLabels(world, list, lang); world.root.add(plLabels); }
$('placeBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('placePanel'); if (world.mode !== 'orbit') world.setMode('orbit'); $('placePanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  PI = PI || await import('./placeinfo.js?v=62'); world.pickHandler = (x, z) => plShow(x, z); $('plHint').textContent = t('Tap any place'); if ($('plNames').checked) plShowNames(true);
};
// ---- Night sky (StarChart KH): stand on the ground and look at the real sky; a round sky chart as inset ----
let SKM = null, SKD = null, skPlay = null, skGazing = false, skViewT = 0;
const pad2 = n => String(n).padStart(2, '0');
const skLocal = d => { const k = new Date(d.getTime() + 7 * 36e5); return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}T${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`; };
const skParse = v => { const [dt, tm] = v.split('T'), [y, m, d] = dt.split('-').map(Number), [h, mi] = tm.split(':').map(Number); return new Date(Date.UTC(y, m - 1, d, h - 7, mi)); };
const skHourOf = d => { const k = new Date(d.getTime() + 7 * 36e5); return k.getUTCHours() + k.getUTCMinutes() / 60; };
const skDirName = az => (lang === 'km' ? ['ជើង', 'ឦសាន', 'កើត', 'អាគ្នេយ៍', 'ត្បូង', 'នីរតី', 'លិច', 'ពាយ័ព្យ'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[Math.round(az / 45) % 8];
// chart geometry, as drawn by sky.drawChart (stereographic, zenith in the middle, east on the left)
const skGeo = cv => { const W = cv.width, H = cv.height; return { R: Math.min(W, H) / 2 - 34, cx: W / 2, cy: H / 2 + 6 }; };
const skToXY = (cv, alt, az) => { const { R, cx, cy } = skGeo(cv), r = R * Math.tan((90 - alt) * Math.PI / 360); return [cx - Math.sin(az * Math.PI / 180) * r, cy - Math.cos(az * Math.PI / 180) * r]; };
function skApply() { // push the panel time into the 3D sky and the inset
  if (!SKD || !world || !world.F) return;
  const F = world.F, date = skParse($('skTime').value), A = world.getAtmos(); A.lang = lang; A.skyTime = date;
  A.setHour(skHourOf(date), true);
  const sky = SKM.drawChart($('skCanvas'), SKD, F.lat0, F.lon0, date, { lang: $('skLang').value, maglim: 4.6 });
  let h = '';
  for (const [n, b] of Object.entries(sky.body)) { if (b.alt < 0) continue; const nm = lang === 'km' ? (SKM.BODY_KM[n] || n) : n;
    h += `<span class="it" data-alt="${b.alt.toFixed(1)}" data-az="${b.az.toFixed(1)}">${n === 'Moon' ? '🌙' : n === 'Sun' ? '☀️' : '🪐'} ${nm}${n === 'Moon' ? ` · ${Math.round((b.phase || 0) * 100)}%` : ''}</span><span>${Math.round(b.alt)}°</span><span>${skDirName(b.az)} ${Math.round(b.az)}°</span>`; }
  $('skBodies').innerHTML = h ? `<span class="h">${tr('Up now')}</span><span class="h">${tr('Altitude')}</span><span class="h">${tr('Direction')}</span>` + h : `<span class="dn">${tr('No planets above the horizon now')}</span>`;
  $('skBodies').querySelectorAll('.it').forEach(e => e.onclick = () => skLook(+e.dataset.alt, +e.dataset.az));
  $('skHour').value = skHourOf(date); $('skHourLbl').textContent = $('skTime').value.slice(11);
  const sun = sky.body.Sun.alt; $('skHint').textContent = sun > -6 ? tr('Daytime – stars hidden') : sun > -12 ? tr('Twilight') : `${F.lat0.toFixed(2)}°N ${F.lon0.toFixed(2)}°E`;
}
function skLook(alt, az) { // turn to face a direction in the sky (standing on the ground)
  if (!world) return; if (!skGazing) skGaze(true);
  const W = world.walker; W.yaw = -az * Math.PI / 180; W.pitch = Math.max(-0.3, Math.min(W.maxPitch || 1.5, alt * Math.PI / 180));
}
function skDrawView() { // the part of the sky on screen, outlined on the inset chart
  const cv = $('skView'), g = cv.getContext('2d'), cam = world.camera, v = world.camera.position.clone(); g.clearRect(0, 0, cv.width, cv.height);
  const pts = [], edge = []; for (let k = 0; k <= 16; k++) edge.push([-1 + k / 8, -1]); for (let k = 0; k <= 16; k++) edge.push([1, -1 + k / 8]); for (let k = 0; k <= 16; k++) edge.push([1 - k / 8, 1]); for (let k = 0; k <= 16; k++) edge.push([-1, 1 - k / 8]);
  for (const [x, y] of edge) { v.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize(); const alt = Math.max(-25, Math.asin(v.y) * 180 / Math.PI), az = Math.atan2(v.x, -v.z) * 180 / Math.PI; pts.push(skToXY(cv, alt, az)); }
  const { R, cx, cy } = skGeo(cv); g.save(); g.beginPath(); g.arc(cx, cy, R + 2, 0, 7); g.clip();
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = 'rgba(255,214,110,.13)'; g.fill(); g.strokeStyle = '#ffd36e'; g.lineWidth = 3; g.stroke(); g.restore();
  cam.getWorldDirection(v); const [x, y] = skToXY(cv, Math.max(-25, Math.asin(v.y) * 180 / Math.PI), Math.atan2(v.x, -v.z) * 180 / Math.PI); g.fillStyle = '#ffd36e'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
}
function skTick() { if ($('skyPanel').hidden && !skGazing) return; if (!$('skyInset').hidden && world && performance.now() - skViewT > 90) { skViewT = performance.now(); skDrawView(); } requestAnimationFrame(skTick); }
function skGaze(on) {
  if (!world || !world.F) return; skGazing = on; const A = world.getAtmos(), W = world.walker;
  $('skGaze').classList.toggle('on', on); $('skGaze').textContent = on ? '⬅ ' + tr('Back to the overview') : '🔭 ' + tr('Stand here and look up');
  if (on) {
    if (A.weather !== 'clear') { A.setWeather('clear'); document.querySelectorAll('[data-wx]').forEach(x => x.classList.toggle('on', x.dataset.wx === 'clear')); }
    let d = skParse($('skTime').value), s = SKM.skyNow(SKD, world.F.lat0, world.F.lon0, d).body.Sun.alt;
    if (s > -10) { const k = new Date(d.getTime() + 7 * 36e5); d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 20 - 7, 0)); if (skHourOf(new Date()) < 6) d = new Date(d.getTime() - 864e5); $('skTime').value = skLocal(d); } // daytime: jump to tonight 20:00
    A.useRealSky(true); skApply(); if (world.mode !== 'walk') world.setMode('walk');
    W.maxPitch = 1.52; W.pitch = 0.6; world.camera.fov = 70; world.camera.updateProjectionMatrix(); $('scenePanel') && showPanel('scenePanel', false);
  } else { W.maxPitch = null; if (world.mode === 'walk') world.setMode('orbit'); }
}
$('skyBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('skyPanel'); $('skyPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  SKM = SKM || await import('./sky.js?v=62'); SKD = SKD || await SKM.loadSky();
  if (!$('skTime').value) $('skTime').value = skLocal(new Date());
  await world.getAtmos().useRealSky(true); $('skyInset').hidden = !$('skInsetOn').checked; skApply(); requestAnimationFrame(skTick);
};
$('skClose').onclick = () => {
  $('skyPanel').hidden = true; $('skyInset').hidden = true; if (skPlay) { clearInterval(skPlay); skPlay = null; $('skPlay').textContent = '▶'; }
  if (skGazing) skGaze(false); if (world) world.getAtmos().skyTime = null; placeRight();
};
onLang.push(() => { if (!$('skyPanel').hidden) skApply(); });
$('skMin').onclick = () => { const c = $('skyPanel').classList.toggle('collapsed'); $('skMin').textContent = c ? '▾' : '▴'; };
$('skGaze').onclick = () => skGaze(!skGazing);
$('skNow').onclick = () => { $('skTime').value = skLocal(new Date()); skApply(); };
$('skTime').onchange = skApply; $('skLang').onchange = skApply;
$('skHour').oninput = e => { const v = Math.min(23.99, +e.target.value), d = $('skTime').value.split('T')[0]; $('skTime').value = `${d}T${pad2(Math.floor(v))}:${pad2(Math.floor((v % 1) * 60))}`; skApply(); };
$('skLines').onchange = e => { const A = world && world.getAtmos(); if (A && A.sv) A.sv.showLines = e.target.checked; };
$('skNames').onchange = e => { const A = world && world.getAtmos(); if (A && A.sv) A.sv.showNames = e.target.checked; };
$('skInsetOn').onchange = e => { $('skyInset').hidden = !e.target.checked; };
$('skBig').onclick = () => $('skyInset').classList.toggle('big');
$('skCanvas').onclick = e => { // tap the chart: look at that part of the sky
  const cv = $('skCanvas'), r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * cv.width, y = (e.clientY - r.top) / r.height * cv.height, { R, cx, cy } = skGeo(cv);
  const dx = cx - x, dy = cy - y, rr = Math.hypot(dx, dy); if (rr > R + 4) return;
  skLook(90 - 2 * Math.atan(rr / R) * 180 / Math.PI, (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360);
};
$('skPng').onclick = () => { // a big printable chart
  if (!SKD || !world) return; const cv = document.createElement('canvas'); cv.width = cv.height = 1600;
  SKM.drawChart(cv, SKD, world.F.lat0, world.F.lon0, skParse($('skTime').value), { lang: $('skLang').value, maglim: 5.5 });
  const g = cv.getContext('2d'); g.font = '600 22px "Noto Sans Khmer", system-ui'; g.fillStyle = '#cfd8e2'; g.textAlign = 'left';
  g.fillText(`${$('skTime').value.replace('T', ' ')} (UTC+7) · ${world.F.lat0.toFixed(3)}°N ${world.F.lon0.toFixed(3)}°E`, 24, 40);
  g.textAlign = 'right'; g.font = '18px "Noto Sans Khmer", system-ui'; g.fillText('Cambodia 3D · ក្រុមស្រាវជ្រាវ និងអភិវឌ្ឍន៍ព័ត៌មានភូមិសាស្ត្រ · Geoinformatics and Research Lab, RUPP', 1576, 1580);
  const a = document.createElement('a'); a.download = `star-chart_${$('skTime').value.replace(/[:T]/g, '-')}.png`; a.href = cv.toDataURL('image/png'); a.click();
};
$('skPlay').onclick = () => {
  if (skPlay) { clearInterval(skPlay); skPlay = null; $('skPlay').textContent = '▶'; return; }
  $('skPlay').textContent = '⏸'; skPlay = setInterval(() => { const d = skParse($('skTime').value); d.setUTCMinutes(d.getUTCMinutes() + 6); $('skTime').value = skLocal(d); skApply(); }, 150);
};
$('plClose').onclick = () => { $('placePanel').hidden = true; if (world) { world.pickHandler = null; if (plMark) plMark.visible = false; } placeRight(); };
$('plMin').onclick = () => { const c = $('placePanel').classList.toggle('collapsed'); $('plMin').textContent = c ? '▾' : '▴'; };
$('plNames').onchange = e => { if (PI && world) plShowNames(e.target.checked); };
async function plShow(x, z, preset) {
  const w = world, D = w.D, F = w.F, lat = F.lat(z), lon = F.lon(x), req = ++plReq, T3 = await import('three'), HM = await import('./hud.js?v=62');
  // marker
  if (!plMark) { const c = document.createElement('canvas'); c.width = 64; c.height = 96; const g = c.getContext('2d'); g.fillStyle = '#ea4335'; g.strokeStyle = '#8a1a12'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 92); g.bezierCurveTo(10, 56, 4, 44, 4, 32); g.arc(32, 32, 28, Math.PI, 0); g.bezierCurveTo(60, 44, 54, 56, 32, 92); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#7a0f08'; g.beginPath(); g.arc(32, 32, 10, 0, 7); g.fill();
    const tx = new T3.CanvasTexture(c); tx.colorSpace = T3.SRGBColorSpace; plMark = new T3.Sprite(new T3.SpriteMaterial({ map: tx, sizeAttenuation: false, depthTest: false, transparent: true })); plMark.center.set(0.5, 0); plMark.scale.set(0.03, 0.045, 1); plMark.renderOrder = 45; w.root.add(plMark); }
  plMark.visible = true; plMark.position.set(x, w.hAt(x, z) + 0.5, z);
  // what the scene knows at once
  const elev = w.rawElevation(x, z), i = Math.floor((x - D.X0) / D.C), j = Math.floor((z - D.Z0) / D.C), lcC = D.lc && i >= 0 && j >= 0 && i < D.gw && j < D.gh ? D.lc[j * D.gw + i] : 0, LCx = w.LC[lcC];
  const near = (await plLoadNames()).map(p => ({ id: 'local' + p.lat + p.lon, lat: p.lat, lon: p.lon, tags: p.tags }));
  const chips = `<div class="plChips"><span>⛰ ${elev.toFixed(0)} m</span>${LCx ? `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${LCx.c};margin-right:4px"></i>${lang === 'km' ? LCx.km : LCx.en}</span>` : ''}<span>📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}</span><span>MGRS ${HM.mgrs(lat, lon)}</span></div>`;
  $('plCard').innerHTML = `<div class="plSkel" style="height:150px"></div><div class="plSkel" style="width:60%;height:18px"></div><div class="plSkel" style="width:80%"></div>${chips}<div class="svhelp">${t('Looking up names, photos and details…')}</div>`;
  const info = await PI.placeInfo(lat, lon, near); if (req !== plReq) return; // a newer tap won
  const m = info.main || {}, rv = info.reverse || {}, ad = rv.address || {}, k = PI.kindOf(m), adm = info.admin || {};
  const nameKm = m['name:km'] || (/[ក-៿]/.test(m.name || '') ? m.name : '') || '', nameEn = m['name:en'] || (/[A-Za-z]/.test(m.name || '') ? m.name : '') || '';
  let title = lang === 'km' ? (nameKm || nameEn) : lang === 'en' ? (nameEn || nameKm) : [nameKm, nameEn].filter(Boolean).join(' · ');
  const village = ad.hamlet || ad.village || ad.neighbourhood || '', addr = [ad.road ? (ad.house_number ? ad.house_number + ' ' : '') + ad.road : '', village, ad.town || ad.suburb || ad.county || '', ad.city || ad.state || ''].filter(Boolean);
  const admLine = adm.com_en ? `${t('Commune')} ${adm.com_en} · ${t('District')} ${adm.dis_en} · ${t('Province')} ${adm.pro_km ? adm.pro_km + ' ' : ''}${adm.pro_en}` : '';
  if (!title) title = village || (lang === 'km' ? LCx && LCx.km : LCx && LCx.en) || t('This place');
  const photos = info.photos.slice(0, 12);
  const det = []; const add = (ic, v) => v && det.push(`<span>${ic}</span><span>${v}</span>`);
  add('🕘', esc2(m.opening_hours)); add('📞', m.phone || m['contact:phone'] ? `<a href="tel:${esc2(m.phone || m['contact:phone'])}">${esc2(m.phone || m['contact:phone'])}</a>` : ''); add('🌐', m.website || m['contact:website'] ? `<a href="${esc2(m.website || m['contact:website'])}" target="_blank" rel="noopener">${esc2((m.website || m['contact:website']).replace(/^https?:\/\//, '').slice(0, 40))}</a>` : '');
  add('🏢', esc2(m.operator)); add('☸', m.religion ? esc2(m.religion + (m.denomination ? ' · ' + m.denomination : '')) : ''); add('ℹ️', esc2(info.wdDesc || m.description)); add('🏗', m['building:levels'] ? `${esc2(m['building:levels'])} ${t('floors')}` : ''); add('📅', esc2(m.start_date));
  const nearList = info.nearby.filter(f => f.d > 20 || f !== info.nearby[0]).slice(0, 10).map(f => { const kk = PI.kindOf(f.tags), nm = lang === 'km' ? (f.tags['name:km'] || f.tags.name) : (f.tags['name:en'] || f.tags.name); return nm ? `<div class="it" data-ll="${f.lon},${f.lat}"><span>${kk.icon}</span><span>${esc2(nm)}<br><small style="margin:0">${lang === 'km' && kk.km ? kk.km : kk.en}</small></span><small>${f.d < 1000 ? Math.round(f.d) + ' m' : (f.d / 1000).toFixed(1) + ' km'}</small></div>` : ''; }).join('');
  const gm = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`, osm = `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=18/${lat.toFixed(6)}/${lon.toFixed(6)}`, dir = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`;
  $('plCard').innerHTML = (photos.length ? `<div class="plPhotos">${photos.map((p, n) => `<a href="${esc2(p.url)}" target="_blank" rel="noopener" class="${p.main ? 'main' : ''}"><img src="${esc2(p.thumb)}" loading="lazy" alt=""><span>${p.main ? '★ ' : ''}${esc2(p.author || p.title)}${p.license ? ' · ' + esc2(p.license) : ''}</span></a>`).join('')}</div>` : `<div class="plNoPhoto">📷 ${t('No photos of this spot yet')}</div>`) +
    `<div class="plTitle">${esc2(title)}</div><div class="plKind">${k.icon} ${lang === 'km' && k.km ? k.km : lang === 'both' && k.km ? k.km + ' · ' + k.en : k.en}</div>` +
    `<div class="plSub">${esc2(addr.join(', '))}${admLine ? `<br>${esc2(admLine)}` : ''}</div>${chips}` +
    `<div class="plBtns"><a class="pri" href="${dir}" target="_blank" rel="noopener">🧭 ${t('Directions')}</a><a href="${gm}" target="_blank" rel="noopener">Google Maps</a><a href="${osm}" target="_blank" rel="noopener">OpenStreetMap</a><button id="plNote">📌 ${t('Save as note')}</button></div>` +
    (det.length ? `<div class="plSec"><h4>${t('Details')}</h4><div class="plDet">${det.join('')}</div></div>` : '') +
    (nearList ? `<div class="plSec plNear"><h4>${t('Nearby')}${info.overpass ? '' : ' · ' + t('offline list')}</h4>${nearList}</div>` : '') +
    (info.wiki.length ? `<div class="plSec plWiki"><h4>${t('Wikipedia nearby')}</h4>${info.wiki.map(a => `<div class="it">${a.thumb ? `<img src="${esc2(a.thumb)}" alt="">` : ''}<div><a href="${esc2(a.url)}" target="_blank" rel="noopener">${esc2(a.title)}</a>${a.km != null ? ` <small style="color:#9fb0c0">${a.km.toFixed(1)} km</small>` : ''}<br>${esc2(a.text.slice(0, 160))}${a.text.length > 160 ? '…' : ''}</div></div>`).join('')}</div>` : '') +
    `<div class="svhelp" style="opacity:.6;margin-top:8px">© OpenStreetMap contributors · Wikimedia Commons · Wikipedia · geoBoundaries</div>`;
  $('plCard').querySelectorAll('.plNear .it').forEach(el => el.onclick = () => { const [lo, la] = el.dataset.ll.split(',').map(Number), X = F.x(lo), Z = F.z(la); if (X >= D.X0 && X <= D.X0 + D.W && Z >= D.Z0 && Z <= D.Z0 + D.H) { w.teleport(X, Z); plShow(X, Z); } });
  $('plNote').onclick = async () => { IN = IN || await import('./intel.js?v=62'); if (!w.notes) w.notes = new IN.Notes(w); w.notes.add(x, z, { title, text: [k.en, addr.join(', ')].filter(Boolean).join(' – '), source: 'OpenStreetMap / Place info', conf: 'medium', photo: null }); $('plHint').textContent = t('Saved as a note (🛰️ Intel → Notes)'); };
}

/* Intel: notes, routes & access, alerts, counting, share */
let IN = null, NT = null, RT = null, INT = { tab: 'notes', mode: 'route', sel: null, photo: null, A: null, alerts: null, count: null, choke: null, route: null };
const inSay = m => $('inHint').textContent = t(m);
const ago = iso => { const d = (Date.now() - Date.parse(iso)) / 36e5; return d < 1 ? t('just now') : d < 48 ? `${Math.round(d)} h ${t('ago')}` : `${Math.round(d / 24)} d ${t('ago')}`; };
const ntRender = () => { if (!NT) return; const L = NT.here().slice().reverse(); $('ntList').innerHTML = L.map((n, i) => `<div class="it" data-i="${i}">${n.photo ? `<img src="${n.photo}">` : `<span style="font-size:22px">📌</span>`}<div><b style="color:${{ high: '#5fe07f', medium: '#ffc56b', low: '#ff7a5c' }[n.conf]}">${n.title.replace(/</g, '&lt;')}</b>${(n.text || '').replace(/</g, '&lt;').slice(0, 120)}<br><small>${n.source ? n.source.replace(/</g, '&lt;') + ' · ' : ''}${t(n.conf)} · ${ago(n.t)}</small></div></div>`).join('') || `<div class="svhelp">${t('No notes in this area yet.')}</div>`;
  $('ntList').querySelectorAll('.it').forEach(el => el.onclick = () => { const n = L[+el.dataset.i]; ntSelect(n); world.teleport(world.F.x(n.lon), world.F.z(n.lat)); }); };
const ntSelect = n => { INT.sel = n; $('ntTitle').value = n ? n.title : ''; $('ntText').value = n ? n.text : ''; $('ntSource').value = n ? n.source : ''; $('ntConf').value = n ? n.conf : 'medium'; INT.photo = n ? n.photo : null; $('ntPhotoName').textContent = INT.photo ? '📷 ✓' : ''; $('ntDel').disabled = !n; inSay(n ? 'Editing the note – change it and Save' : ''); };
const inTab = k => { INT.tab = k; document.querySelectorAll('.intabs button').forEach(b => b.classList.toggle('on', b.dataset.it === k)); document.querySelectorAll('#intelPanel [data-ip]').forEach(d => d.hidden = d.dataset.ip !== k);
  inSay(k === 'notes' ? 'Tap the ground to add a note, or a pin to edit it' : k === 'route' ? (INT.mode === 'route' ? 'Tap the start (A), then the end (B)' : INT.mode === 'reach' ? 'Tap the start point' : '') : k === 'count' ? 'Tap one example object in the image' : ''); };
document.querySelectorAll('.intabs button').forEach(b => b.onclick = () => inTab(b.dataset.it));
$('intelBtn').onclick = async () => {
  if (!world || !world.D) return; closeOthers('intelPanel'); if (world.mode !== 'orbit') world.setMode('orbit'); $('intelPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  IN = IN || await import('./intel.js?v=62'); if (!world.notes) world.notes = new IN.Notes(world); NT = world.notes; NT.rebuild(); RT = new IN.Router(world); RT.profile = $('rtProf').value;
  world.pickHandler = intelPick; ntRender(); inTab(INT.tab); ntSelect(null);
};
$('inClose').onclick = () => { $('intelPanel').hidden = true; if (world) world.pickHandler = null; placeRight(); };
$('inMin').onclick = () => { const c = $('intelPanel').classList.toggle('collapsed'); $('inMin').textContent = c ? '▾' : '▴'; };
// image pixel <-> scene metres (for counting)
const pxOf = (x, z) => [Math.round(world.D.pxX(world.F.lon(x))), Math.round(world.D.pxY(world.F.lat(z)))];
const llOfPx = (px, py) => { const D = world.D, n = 2 ** D.zi, tx = px / 256 + D.ir.x0, ty = py / 256 + D.ir.y0; return [tx / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI]; };
const asCanvas = im => { if (im.getContext) return im; const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c; };
let ctGroup = null;
async function intelPick(x, z) {
  if (INT.tab === 'notes') { const near = NT.nearest(x, z, world.pxToMetres(new (world.camera.position.constructor)(x, world.hAt(x, z), z), 18)); if (near) { ntSelect(near); return; }
    const n = NT.add(x, z, { title: $('ntTitle').value.trim() || t('Note') + ' ' + (NT.here().length + 1), text: $('ntText').value.trim(), source: $('ntSource').value.trim(), conf: $('ntConf').value, photo: INT.photo }); ntSelect(n); ntRender(); inSay('Note added – write it and Save'); return; }
  if (INT.tab === 'route') { RT.profile = $('rtProf').value;
    if (INT.mode === 'route') { if (!INT.A) { INT.A = [x, z]; RT.clear(); inSay('Now tap the end (B)'); return; } const [x0, z0] = INT.A; INT.A = null; const r = RT.route(x0, z0, x, z);
      if (!r || r.none) { $('rtRes').textContent = t('No road connection between these points for this way of travel.'); return; }
      const T = r.T / 60; INT.route = { ...r, prof: $('rtProf').selectedOptions[0].text }; $('rtRes').innerHTML = `${t('Route')}: <b>${(r.L / 1000).toFixed(2)} km</b> · <b>${T < 60 ? T.toFixed(0) + ' min' : (T / 60).toFixed(1) + ' h'}</b> (${$('rtProf').selectedOptions[0].text}) · ${t('straight line')} ${(r.crow / 1000).toFixed(2)} km · ${t('detour')} ×${(r.L / Math.max(1, r.crow)).toFixed(2)}${r.bridges ? ` · ${t('crosses')} ${r.bridges} ${t('bridge pieces')}` : ''}`; inSay('Tap a new start (A)'); return; }
    if (INT.mode === 'reach') { const m = +$('rtMin').value, r = RT.reach(x, z, m); if (!r) return; $('rtRes').innerHTML = `${t('Reachable in')} ${m} min: <b>${r.km.toFixed(1)} km</b> ${t('of road')} · <span style="color:#2fdc6a">■</span> ¼ <span style="color:#c6e83a">■</span> ½ <span style="color:#ffb02e">■</span> ¾ <span style="color:#ff4a3a">■</span> ${t('of the time')}`; return; } }
  if (INT.tab === 'count') {
    const D = world.D, img = asCanvas(D.img), [px, py] = pxOf(x, z), [a, b] = $('ctSize').value.split(',').map(Number), tol = +$('ctTol').value; inSay('Counting…'); await new Promise(r => setTimeout(r, 20));
    const res = IN.findSimilar(img, px, py, tol, a, b); if (!res.example) { inSay(res.tooBig ? 'That is a large surface – tap a single object' : 'Nothing found there – tap the middle of an object'); return; }
    let old = null; const oldImg = (world._cmp && world._cmp.before) || (CHS.pair && CHS.aoi === D.aoi ? CHS.pair[0] : null); if (oldImg) old = IN.findSimilar(asCanvas(oldImg), px, py, tol, a, b, { ref: res.ref, ex: res.exK, stats: res.stats });
    const mpp = D.W / (D.pxX(world.F.lon(D.X0 + D.W)) - D.pxX(world.F.lon(D.X0))), size = Math.sqrt(res.example.n) * mpp;
    if (ctGroup) { world.root.remove(ctGroup); ctGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const T3 = await import('three'); ctGroup = new T3.Group(); const ringG = new T3.RingGeometry(0.75, 1, 24).rotateX(-Math.PI / 2), mat = new T3.MeshBasicMaterial({ color: 0xffe14a, depthTest: false, transparent: true, opacity: 0.95 }), inst = new T3.InstancedMesh(ringG, mat, res.items.length), M4 = new T3.Matrix4();
    INT.count = { n: res.count, old: old ? old.count : null, size, items: res.items.map(it => llOfPx(it.cx, it.cy)) };
    INT.count.items.forEach(([lo, la], i) => { const X = world.F.x(lo), Z = world.F.z(la), r = Math.max(1.5, size * 0.8); M4.makeScale(r, 1, r).setPosition(X, world.hAt(X, Z) + 0.6, Z); inst.setMatrixAt(i, M4); }); inst.renderOrder = 35; ctGroup.add(inst); world.root.add(ctGroup);
    $('ctRes').innerHTML = `${t('Found')} <b>${res.count}</b> ${t('similar objects')} (≈ ${size.toFixed(1)} m ${t('across')})${old ? ` · ${t('in the older image')}${CHS.beforeDate ? ' (' + CHS.beforeDate + ')' : ''}: <b>${old.count}</b> (${res.count - old.count >= 0 ? '+' : ''}${res.count - old.count})` : ''}`; inSay(''); }
}
$('ntPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = URL.createObjectURL(f); }), k = Math.min(1, 640 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  INT.photo = c.toDataURL('image/jpeg', 0.72); $('ntPhotoName').textContent = '📷 ✓'; if (INT.sel) { NT.update(INT.sel, { photo: INT.photo }); ntRender(); } e.target.value = ''; };
$('ntSave').onclick = () => { if (!NT || !INT.sel) { inSay('Tap the ground to place the note first'); return; } NT.update(INT.sel, { title: $('ntTitle').value.trim() || INT.sel.title, text: $('ntText').value.trim(), source: $('ntSource').value.trim(), conf: $('ntConf').value, photo: INT.photo }); ntRender(); inSay('Saved'); };
$('ntDel').onclick = () => { if (!INT.sel || !confirm(t('Delete this note?'))) return; NT.remove(INT.sel); ntSelect(null); ntRender(); };
$('ntExport').onclick = () => { if (!NT) return; const b = new Blob([JSON.stringify(NT.geojson(), null, 1)], { type: 'application/geo+json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'intel_notes.geojson'; a.click(); };
seg('rtMode', v => { INT.mode = v; INT.A = null; $('rtMinRow').hidden = v !== 'reach'; $('rtRun').hidden = v !== 'choke'; inTab('route'); });
$('rtRun').hidden = true; $('rtProf').onchange = () => { if (RT) RT.profile = $('rtProf').value; };
$('rtRun').onclick = async () => { if (!RT) return; RT.profile = $('rtProf').value; $('rtRun').disabled = true; const top = await RT.choke(40, inSay); INT.choke = top; inSay(''); $('rtRun').disabled = false;
  $('rtRes').innerHTML = top.length ? `${t('Road pieces most trips depend on')} (<span style="color:#d36bff">■</span> ${t('bridges')}):<br>` + top.map(p => `${p.rank}. ${t(p.road)}${p.bridge ? ' 🌉' : ''} – ${Math.round(p.share * 100)}% · <a href="#" data-ll="${p.lon},${p.lat}">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</a>`).join('<br>') : t('No road network here.');
  $('rtRes').querySelectorAll('a[data-ll]').forEach(a => a.onclick = e => { e.preventDefault(); const [lo, la] = a.dataset.ll.split(',').map(Number); world.teleport(world.F.x(lo), world.F.z(la)); }); };
$('rtClear').onclick = () => { if (RT) RT.clear(); INT.A = null; $('rtRes').textContent = ''; };
// alerts
const alRender = L => { $('alList').innerHTML = L.length ? L.slice(0, 60).map(a => `<div class="it" data-ll="${a.lon},${a.lat}"><span style="font-size:20px">${a.icon}</span><div><b>${a.title.replace(/</g, '&lt;')}</b><small>${t(a.type)}${a.level ? ' · ' + a.level : ''} · ${Math.round(a.km)} km · ${(a.to || a.from || '').slice(0, 10)} · ${a.src}${a.url ? ` · <a href="${a.url}" target="_blank">${t('details')}</a>` : ''}</small></div></div>`).join('') : `<div class="svhelp">${t('Nothing reported near this area.')}</div>`;
  $('alList').querySelectorAll('.it').forEach(el => el.onclick = e => { if (e.target.tagName === 'A') return; const [lo, la] = el.dataset.ll.split(',').map(Number); const D = world.D, x = world.F.x(lo), z = world.F.z(la); if (x >= D.X0 && x <= D.X0 + D.W && z >= D.Z0 && z <= D.Z0 + D.H) world.teleport(x, z); else inSay('Outside this 3D area – see it on 🌍 the globe'); }); };
const alCheck = async (notify) => { if (!IN || !world.D) return; const a = world.D.aoi, L = await IN.alertsNear((a.s + a.n) / 2, (a.w + a.e) / 2, +$('alKm').value, inSay); INT.alerts = L; alRender(L);
  const key = 'cambodia3d.alertsSeen', seen = new Set(JSON.parse(localStorage.getItem(key) || '[]')), fresh = L.filter(x => !seen.has(x.id)); L.forEach(x => seen.add(x.id)); try { localStorage.setItem(key, JSON.stringify([...seen].slice(-3000))); } catch (e) { }
  if (notify && fresh.length && window.Notification && Notification.permission === 'granted') new Notification(`⚠️ ${fresh.length} ${t('new alerts near your area')}`, { body: fresh.slice(0, 4).map(x => `${x.icon} ${x.title} (${Math.round(x.km)} km)`).join('\n') }); };
$('alRun').onclick = () => alCheck(false);
let alTimer = 0; $('alWatch').onchange = async e => { clearInterval(alTimer); if (e.target.checked) { if (window.Notification && Notification.permission === 'default') await Notification.requestPermission(); alCheck(false); alTimer = setInterval(() => alCheck(true), 15 * 60e3); } };
$('ctTol').oninput = e => $('ctTolV').textContent = e.target.value;
$('ctClear').onclick = () => { if (ctGroup) { world.root.remove(ctGroup); ctGroup = null; } INT.count = null; $('ctRes').textContent = ''; };
$('ctExport').onclick = () => { if (!INT.count) return; const g = { type: 'FeatureCollection', features: INT.count.items.map(([lo, la], i) => ({ type: 'Feature', properties: { id: i + 1 }, geometry: { type: 'Point', coordinates: [+lo.toFixed(7), +la.toFixed(7)] } })) }, b = new Blob([JSON.stringify(g)], { type: 'application/geo+json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'counted_objects.geojson'; a.click(); };
// share link
$('shMake').onclick = async () => {
  if (!world || !world.D) return; IN = IN || await import('./intel.js?v=62'); const D = world.D, a = D.aoi, inA = c => c[0] >= a.w && c[0] <= a.e && c[1] >= a.s && c[1] <= a.n;
  const notes = world.notes ? world.notes.here().map(n => ({ ...n, photo: null })) : JSON.parse(localStorage.getItem('cambodia3d.notes.v1') || '[]').filter(n => inA([n.lon, n.lat])).map(n => ({ ...n, photo: null }));
  const tac = world.tactical ? world.tactical.features.filter(f => world.tactical.inAOI(f)) : JSON.parse(localStorage.getItem('cambodia3d.tac.v1') || '[]').filter(f => f.coords.some(inA));
  const edits = (world.editor ? world.editor.features : JSON.parse(localStorage.getItem('cambodia3d.edits.v1') || '[]')).filter(f => f.coords && f.coords.some(inA));
  const c = world.camera.position, tg = world.controls.target, st = { v: 1, cam: [c.x, c.y, c.z, tg.x, tg.y, tg.z].map(v => +v.toFixed(1)), notes, tac, edits };
  const url = `${location.origin}${location.pathname}#aoi=${a.w.toFixed(5)},${a.s.toFixed(5)},${a.e.toFixed(5)},${a.n.toFixed(5)}&s=${await IN.packState(st)}`;
  $('shOut').value = url; try { await navigator.clipboard.writeText(url); inSay('Link copied'); } catch (e) { $('shOut').select(); inSay('Copy the link below'); }
  if (url.length > 60000) inSay('The link is very long – some apps may cut it');
};
// open a shared link: after the area is built, add the shared notes, symbols and drawings, and set the view
async function applyShared() {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/); if (!m || applyShared.done === m[1]) return; applyShared.done = m[1]; IN = IN || await import('./intel.js?v=62');
  let st; try { st = await IN.unpackState(m[1]); } catch (e) { return; } if (!st) return;
  if (st.notes && st.notes.length) { if (!world.notes) world.notes = new IN.Notes(world); const have = new Set(world.notes.list.map(n => n.id)); for (const n of st.notes) if (!have.has(n.id)) world.notes.list.push(n); world.notes.save(); world.notes.rebuild(); }
  if (st.tac && st.tac.length) { const T = await world.openTactical(); T.active = false; const have = new Set(T.features.map(f => f.id)); for (const f of st.tac) if (!have.has(f.id)) T.features.push(f); T.save(); await T.rebuild(); }
  if (st.edits && st.edits.length) { const E = world.openEditor(); E.active = false; const have = new Set(E.features.map(f => f.id)); for (const f of st.edits) if (!have.has(f.id)) E.features.push(f); E.save(); E.rebuild(); }
  if (st.cam) { world.camera.position.set(st.cam[0], st.cam[1], st.cam[2]); world.controls.target.set(st.cam[3], st.cam[4], st.cam[5]); world.controls.update(); }
  $('driveHint').textContent = t('Shared work loaded: notes, symbols and drawings.');
}

/* GEOINT area brief: one printable page with everything known about the area */
async function buildBrief() {
  const D = world.D, a = D.aoi, lat = (a.s + a.n) / 2, lon = (a.w + a.e) / 2, HM = await import('./hud.js?v=62'), TM = await import('./topomap.js?v=62'), u = HM.utm(lat, lon);
  world.renderer.render(world.scene, world.camera); const shot = world.renderer.domElement.toDataURL('image/jpeg', 0.85);
  const img = (() => { const c = document.createElement('canvas'), k = Math.min(1, 900 / D.img.width); c.width = D.img.width * k; c.height = D.img.height * k; c.getContext('2d').drawImage(D.img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85); })();
  const lcC = (() => { const LCm = world.LC, c = document.createElement('canvas'); c.width = D.gw; c.height = D.gh; const g = c.getContext('2d'), im = g.createImageData(D.gw, D.gh); for (let i = 0; i < D.lc.length; i++) { const h = (LCm[D.lc[i]] || { c: '#cccccc' }).c; im.data.set([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255], i * 4); } g.putImageData(im, 0, 0); return c.toDataURL('image/png'); })();
  let wx = null; try { wx = await (await import('./weather.js?v=62')).currentWeather(lat, lon); } catch (e) { }
  let names = []; try { names = await TM.localNames({ w: a.w - 0.05, e: a.e + 0.05, s: a.s - 0.05, n: a.n + 0.05 }); } catch (e) { }
  const near = names.filter(p => p.tags.place).map(p => ({ n: p.tags['name:en'] || p.tags['name:km'], km: p.tags['name:km'] || '', d: Math.hypot((p.lon - lon) * 108.7, (p.lat - lat) * 110.6) })).filter(p => p.n).sort((x, y) => x.d - y.d).slice(0, 8);
  const poi = names.filter(p => !p.tags.place).map(p => p.tags.amenity || p.tags.natural || p.tags.waterway).reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  // terrain
  let lo = 1e9, hi = -1e9, sl = 0, ns = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { const x = D.X0 + (i + .5) / 40 * D.W, z = D.Z0 + (j + .5) / 40 * D.H, e = world.rawElevation(x, z); lo = Math.min(lo, e); hi = Math.max(hi, e); const s1 = Math.hypot(world.rawElevation(x + 15, z) - world.rawElevation(x - 15, z), world.rawElevation(x, z + 15) - world.rawElevation(x, z - 15)) / 30; sl += Math.atan(s1) * 180 / Math.PI; ns++; }
  const HWn = (await import('./intel.js?v=62')).HW, roadLen = {}; for (const r of D.roads || []) { const k = HWn[r.cls] || 'road'; let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); roadLen[k] = (roadLen[k] || 0) + L; }
  const lcRows = Object.entries(D.lcPct || {}).filter(([k, v]) => +k > 0 && v > 0.002).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<tr><td><i style="background:${world.LC[k].c}"></i>${world.LC[k].en} <span class=km>${world.LC[k].km}</span></td><td>${(v * 100).toFixed(1)}%</td><td>${(v * D.W * D.H / 1e4).toFixed(1)} ha</td></tr>`).join('');
  const tac = world.tactical ? world.tactical.features.filter(f => world.tactical.inAOI(f)) : [], rd = world.radar && world.radar.placed ? world.radar.list() : [], sv = world.survey ? world.survey.points || [] : [];
  const notesH = world.notes ? world.notes.here() : [];
  const G = world.globe, passes = G && G.passes ? G.passes.slice(0, 8) : null, ch = CHS.res;
  const esc = x => String(x ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const S = D.stats || {}, dirs = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>GEOINT brief ${lat.toFixed(4)}, ${lon.toFixed(4)}</title><style>
  body{font:12px/1.45 system-ui,"Noto Sans Khmer",sans-serif;color:#1b2430;max-width:900px;margin:18px auto;padding:0 16px}h1{font-size:20px;margin:0}h2{font-size:13.5px;margin:16px 0 6px;padding-bottom:3px;border-bottom:2px solid #1f3f8f;color:#1f3f8f;text-transform:uppercase;letter-spacing:.04em}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1b2430;padding-bottom:6px}.cls{font-weight:700;color:#b00020;font-size:11px;letter-spacing:.08em}table{border-collapse:collapse;width:100%}td,th{padding:3px 6px;border-bottom:1px solid #e3e7ec;text-align:left;vertical-align:top}th{background:#f2f5f9;font-weight:600}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.k{background:#f4f7fb;border-radius:6px;padding:6px 8px}.k b{display:block;font-size:15px}img{width:100%;border-radius:4px;border:1px solid #ccd}i{display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:2px;vertical-align:-1px}.km{color:#667;font-size:11px}.foot{margin-top:18px;font-size:10px;color:#667;border-top:1px solid #ccd;padding-top:6px}@media print{.noprint{display:none}body{margin:0}}</style></head><body>
  <div class="hdr"><div><div class="cls">UNCLASSIFIED · FOR REFERENCE · OPEN SOURCES ONLY</div><h1>GEOINT area brief</h1><div>${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })} (Cambodia time)</div></div><div style="text-align:right"><b>Geoinformatics and Research Lab, RUPP</b><br>Cambodia 3D Landscape<br><button class="noprint" onclick="print()">🖨 Print / save as PDF</button></div></div>
  <h2>1. Location</h2><div class="g3"><div class="k">Centre<b>${lat.toFixed(5)}°N ${lon.toFixed(5)}°E</b></div><div class="k">MGRS<b>${HM.mgrs(lat, lon)}</b></div><div class="k">UTM ${u.zone}${u.hemi} (WGS 84)<b>${u.E.toFixed(0)} E ${u.N.toFixed(0)} N</b></div></div>
  <p>Area ${(D.W / 1000).toFixed(2)} × ${(D.H / 1000).toFixed(2)} km (${(D.W * D.H / 1e6).toFixed(2)} km²) · extent ${a.w.toFixed(4)}–${a.e.toFixed(4)}°E, ${a.s.toFixed(4)}–${a.n.toFixed(4)}°N · imagery: ${esc((world.credit || '').replace(/<[^>]+>/g, ''))}</p>
  ${near.length ? `<p><b>Nearest settlements:</b> ${near.map(p => `${esc(p.n)} <span class=km>${esc(p.km)}</span> (${p.d.toFixed(1)} km)`).join(' · ')}</p>` : ''}
  <div class="g2"><div><img src="${shot}"><div class="km">3D view at the time of the brief</div></div><div><img src="${img}"><div class="km">Satellite image of the area (north up)</div></div></div>
  <h2>2. Terrain</h2><div class="g3"><div class="k">Elevation<b>${lo.toFixed(0)}–${hi.toFixed(0)} m</b></div><div class="k">Relief<b>${(hi - lo).toFixed(0)} m</b></div><div class="k">Mean slope<b>${(sl / ns).toFixed(1)}°</b></div></div>
  <h2>3. Land cover</h2><div class="g2"><table><tr><th>Class</th><th>Share</th><th>Area</th></tr>${lcRows}</table><div><img src="${lcC}" style="image-rendering:pixelated"><div class="km">Land cover (13 classes${world.trainer && world.trainer.samples.length ? ', corrected with your training samples' : ''})</div></div></div>
  <h2>4. Infrastructure</h2><div class="g3"><div class="k">Buildings (OSM)<b>${S.buildings || 0}</b></div><div class="k">Houses seen in the image<b>${(world.housesList || []).length}</b></div><div class="k">Road segments<b>${S.roads || 0}</b></div></div>
  <table><tr><th>Road class</th><th>Length</th></tr>${Object.entries(roadLen).sort((x, y) => y[1] - x[1]).map(([k, L]) => `<tr><td>${esc(k)}</td><td>${(L / 1000).toFixed(2)} km</td></tr>`).join('')}</table>
  ${Object.keys(poi).length ? `<p><b>Landmarks within 5 km:</b> ${Object.entries(poi).map(([k, n]) => `${esc(k.replace('place_of_worship', 'pagoda / temple'))} ${n}`).join(' · ')}</p>` : ''}
  ${wx ? `<h2>5. Weather now</h2><p>${wx.icon} ${wx.label} · ${wx.temp}°C (feels ${wx.feels}°) · humidity ${wx.hum}% · cloud ${wx.cloud}% · wind ${wx.wind} km/h from ${dirs(wx.windDir)} · rain ${wx.precip} mm<br>Next days: ${wx.days.map(d => `${d.date.slice(5)} ${d.min.toFixed(0)}–${d.max.toFixed(0)}°C, ${d.rain} mm`).join(' · ')} <span style='color:#667'>(${wx.src})</span></p>` : ''}
  ${ch ? `<h2>6. Change detection</h2><p>${$('chBefore').selectedOptions[0] ? $('chBefore').selectedOptions[0].text : ''} → ${$('chAfter').value ? $('chAfter').selectedOptions[0].text : 'scene image'}: changed ${ch.pct.all.toFixed(1)}% of the area — built / cleared ${ch.pct.built.toFixed(1)}%, vegetation gain ${ch.pct.veg.toFixed(1)}%, water ${ch.pct.water.toFixed(1)}%.</p>` : ''}
  ${passes ? `<h2>7. Satellite collection</h2><table><tr><th>Satellite</th><th>Next imaging pass over the area</th></tr>${passes.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.when)}</td></tr>`).join('')}</table>` : ''}
  ${notesH.length ? `<h2>Field notes</h2><table><tr><th>Note</th><th>Source · confidence · time</th><th>MGRS</th></tr>${notesH.map(n => `<tr><td><b>${esc(n.title)}</b><br>${esc(n.text)}${n.photo ? `<br><img src="${n.photo}" style="max-width:220px;margin-top:4px">` : ''}</td><td>${esc(n.source)} · ${esc(n.conf)} · ${esc(n.t.slice(0, 16).replace('T', ' '))} UTC</td><td>${HM.mgrs(n.lat, n.lon)}</td></tr>`).join('')}</table>` : ''}
  ${INT.alerts && INT.alerts.length ? `<h2>Alerts near the area</h2><table><tr><th></th><th>Event</th><th>Distance</th><th>Date</th><th>Source</th></tr>${INT.alerts.slice(0, 25).map(x => `<tr><td>${x.icon}</td><td>${esc(x.title)}${x.level ? ' (' + x.level + ')' : ''}</td><td>${Math.round(x.km)} km</td><td>${esc((x.to || x.from || '').slice(0, 10))}</td><td>${esc(x.src)}</td></tr>`).join('')}</table>` : ''}
  ${INT.route || INT.choke ? `<h2>Routes and access</h2>${INT.route ? `<p>Route A → B (${esc(INT.route.prof)}): ${(INT.route.L / 1000).toFixed(2)} km, ${(INT.route.T / 60).toFixed(0)} min, detour ×${(INT.route.L / Math.max(1, INT.route.crow)).toFixed(2)}${INT.route.bridges ? ', crosses bridges' : ''}.</p>` : ''}${INT.choke ? `<table><tr><th>#</th><th>Choke point</th><th>Share of trips</th><th>MGRS</th></tr>${INT.choke.map(p => `<tr><td>${p.rank}</td><td>${esc(p.road)}${p.bridge ? ' – bridge' : ''}</td><td>${Math.round(p.share * 100)}%</td><td>${HM.mgrs(p.lat, p.lon)}</td></tr>`).join('')}</table>` : ''}` : ''}
  ${INT.count ? `<h2>Object count</h2><p>${INT.count.n} similar objects (≈ ${INT.count.size.toFixed(1)} m across)${INT.count.old != null ? `; ${INT.count.old} in the older image (${INT.count.n - INT.count.old >= 0 ? '+' : ''}${INT.count.n - INT.count.old})` : ''}.</p>` : ''}
  ${tac.length ? `<h2>8. Tactical overlay</h2><table><tr><th>Symbol</th><th>Side</th><th>Label</th><th>Position (MGRS)</th></tr>${tac.map(f => `<tr><td>${esc(f.code)}</td><td>${esc(f.side)}</td><td>${esc(f.label)}</td><td>${HM.mgrs(f.coords[0][1], f.coords[0][0])}</td></tr>`).join('')}</table>` : ''}
  ${rd.length ? `<h2>9. Radar picture</h2><table><tr><th>Track</th><th>Type</th><th>FL</th><th>Speed</th><th>Range</th><th>Bearing</th></tr>${rd.slice(0, 20).map(r => `<tr><td>${esc(r.flight)}${r.src === 'sim' ? ' (sim)' : ''}</td><td>${esc(r.type)}</td><td>${Math.round(r.alt / 0.3048 / 100)}</td><td>${Math.round(r.gs / 0.514444)} kt</td><td>${(r.dist / 1000).toFixed(1)} km</td><td>${Math.round(r.brg * 180 / Math.PI)}°</td></tr>`).join('')}</table>` : ''}
  ${sv.length ? `<h2>10. Survey points</h2><table><tr><th>ID</th><th>MGRS</th><th>Elevation</th></tr>${sv.slice(0, 30).map(p => `<tr><td>${esc(p.id)}</td><td>${p.lat != null ? HM.mgrs(p.lat, p.lon) : ''}</td><td>${p.h != null ? (+p.h).toFixed(2) + ' m' : ''}</td></tr>`).join('')}</table>` : ''}
  <div class="foot">Sources: ${esc((world.credit || '').replace(/<[^>]+>/g, ''))} · Elevation: Mapzen / AWS Terrain Tiles · Land cover: classification of the image + Esri | Impact Observatory 10 m + OpenStreetMap · Roads, buildings, names: © OpenStreetMap contributors · Weather: Open-Meteo · Satellites: CelesTrak. Derived from open data for reference; not an official survey or assessment.</div>
  </body></html>`;
  return html;
}
$('briefBtn').onclick = async () => {
  if (!world || !world.D) return; const win = window.open('', '_blank'); if (!win) { alert(t('Please allow pop-ups to open the brief.')); return; } win.document.write('<p style="font:14px system-ui">Preparing the brief…</p>');
  const html = await buildBrief(); win.document.open(); win.document.write(html); win.document.close();
};
// the brief as A4 page images (for adding to the map PDF)
async function briefPages(say) {
  say('Preparing the brief…'); const html = await buildBrief();
  if (!window.html2canvas) await new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0'; document.body.appendChild(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html.replace('<button class="noprint"', '<button class="noprint" style="display:none"')); fr.contentDocument.close();
  await new Promise(r => setTimeout(r, 400)); await Promise.all([...fr.contentDocument.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  const body = fr.contentDocument.body; fr.style.height = body.scrollHeight + 40 + 'px'; say('Drawing the brief pages…');
  const cv = await window.html2canvas(body, { scale: 2, backgroundColor: '#ffffff', windowWidth: 820 }); fr.remove();
  // cut into A4 pages (210 × 297 mm, 10 mm margins), preferring cuts on white rows so lines of text are not split
  const pxPerMm = cv.width / 190, pageH = Math.floor(277 * pxPerMm), g = cv.getContext('2d'), pages = []; let y = 0;
  const whiteRow = yy => { const d = g.getImageData(0, yy, cv.width, 1).data; for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false; return true; };
  while (y < cv.height - 4) { let cut = Math.min(cv.height, y + pageH); if (cut < cv.height) { for (let k = 0; k < 300 && cut - k > y + pageH * 0.6; k += 2) if (whiteRow(cut - k)) { cut -= k; break; } }
    const pc = document.createElement('canvas'); pc.width = cv.width; pc.height = cut - y; pc.getContext('2d').drawImage(cv, 0, y, cv.width, cut - y, 0, 0, cv.width, cut - y); pages.push({ url: pc.toDataURL('image/jpeg', 0.9), hmm: (cut - y) / pxPerMm }); y = cut; }
  return pages;
}

/* whole Earth */
let GL = null, globeTimer = 0;
const globeInfo = () => { GL = GL || (world && world.globe); if (!GL) return; const i = GL.info(); $('globeInfo').innerHTML = [`UTC ${i.utc}`, GL.opt.storms && i.storms && '🌀 ' + i.storms, GL.opt.clouds && i.clouds, (GL.opt.wind || GL.opt.temp) && i.wind, GL.opt.rain && i.rain, i.sats && '🛰️ ' + i.sats, GL.opt.sats.resource && i.passes && '🛰️ ' + i.passes, GL.opt.sats['gps-ops'] && i.gps && '📍 ' + i.gps, i.hires && '🔍 ' + i.hires, GL.opt.flights && i.flights && '✈️ ' + i.flights + (GL.flightsLive ? '' : ' · 60× faster'), GL.opt.radar && i.radar && '📡 ' + i.radar, i.base].filter(Boolean).map(x => t(x)).join('<br>') + ''; };
const globeUI = on => {
  $('globePanel').hidden = !on; $('hud').hidden = on || !(world && world.D); document.body.classList.toggle('globe-on', on);
  if (on) { creditHTML = $('credit').innerHTML; $('credit').innerHTML = 'Earth: NASA Blue Marble &amp; Black Marble, close up Esri World Imagery (Esri, Maxar, Earthstar Geographics) · Clouds: Himawari-9, GOES-East, GOES-West via NASA GIBS · Rain: NASA IMERG · Wind &amp; temperature: Open-Meteo · Storms: GDACS · Satellites: CelesTrak · Flights: OpenSky (with proxy) · Geoinformatics and Research Lab, RUPP'; }
  else if (creditHTML) $('credit').innerHTML = creditHTML;
  if (on) { closeOthers('globePanel'); showPanel('scenePanel', false); $('globePanel').hidden = false; placeRight(); clearInterval(globeTimer); globeTimer = setInterval(globeInfo, 2000); globeInfo(); }
  else { clearInterval(globeTimer); placeRight(); }
  const G = world.globe; document.querySelectorAll('#globePanel [data-g]').forEach(c => c.checked = !!G.opt[c.dataset.g]);
  document.querySelectorAll('#globePanel [data-s]').forEach(c => c.checked = !!G.opt.sats[c.dataset.s]);
};
const globeOpen = () => { if (!world || !world.D) return; if (world.mode !== 'orbit') world.setMode('orbit'); world.onGlobe = globeUI; GL = world.openGlobe(); GL.onInfo = globeInfo; };
$('globeBtn').onclick = () => { if (world && world.globe && world.globe.on) world.globe.leave(); else globeOpen(); };
$('globeBack').onclick = () => { if (GL) GL.leave(); };
$('globeMin').onclick = () => { const c = $('globePanel').classList.toggle('collapsed'); $('globeMin').textContent = c ? '▾' : '▴'; };
document.querySelectorAll('#globePanel [data-g]').forEach(c => c.onchange = () => { if (!GL) return; GL.opt[c.dataset.g] = c.checked; if (c.checked) GL.refresh(); });
document.querySelectorAll('#globePanel [data-s]').forEach(c => c.onchange = () => { if (!GL) return; GL.opt.sats[c.dataset.s] = c.checked; GL.loadSats(); });

/* live weather (Open-Meteo) */
let wxTimer = 0;
const WMO = c => c >= 95 ? ['storm', '⛈️', 'Thunderstorm'] : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? ['rain', '🌧️', 'Rain'] : c === 45 || c === 48 ? ['haze', '🌫️', 'Fog'] : c === 3 ? ['haze', '☁️', 'Overcast'] : c === 2 ? ['clear', '⛅', 'Partly cloudy'] : ['clear', '☀️', 'Clear'];
async function liveWeather() {
  if (!world || !world.D) return; const a = world.D.aoi, lat = (a.s + a.n) / 2, lon = (a.w + a.e) / 2;
  try {
    const W = await (await import('./weather.js?v=62')).currentWeather(lat, lon), d0 = W.days[0] || { min: W.temp, max: W.temp, rain: 0 };
    const now = new Date(Date.now() + 7 * 3600e3), hn = now.getUTCHours() + now.getUTCMinutes() / 60, h = hn < 5 ? 23.5 : Math.min(23.5, hn); // Cambodia local time
    const A = world.getAtmos(); A.setWeather(W.wx); A.setHour(h, true); $('hour').value = h; $('hourLbl').textContent = fmtHour(h);
    document.querySelectorAll('[data-wx]').forEach(x => x.classList.toggle('on', x.dataset.wx === W.wx));
    $('liveWxInfo').hidden = false;
    $('liveWxInfo').innerHTML = `${W.icon} <b>${t(W.label)}</b> · 🌡 <b>${W.temp.toFixed(0)}°C</b> (${t('feels')} ${W.feels.toFixed(0)}°) · 💧 ${W.hum}% · ☁ ${W.cloud}%<br>` +
      `🌬 ${W.wind.toFixed(0)} km/h ${t('from')} ${cardinal(W.windDir)} · 🌧 ${W.precip} mm · ${t('today')} ${d0.min.toFixed(0)}–${d0.max.toFixed(0)}°C, ${d0.rain} mm<br>` +
      `<span style="opacity:.7">${t('Local time')} ${fmtHour(hn)} · ${W.src} · ${t('updated every 15 min')}</span>`;
    if (world.atmos) world.atmos.wind = { speed: W.wind, dir: W.windDir };
  } catch (e) { $('liveWxInfo').hidden = false; $('liveWxInfo').textContent = t('Live weather is not reachable right now.'); }
}
$('liveWx').onchange = e => { clearInterval(wxTimer); if (e.target.checked) { liveWeather(); wxTimer = setInterval(liveWeather, 15 * 60e3); } else $('liveWxInfo').hidden = true; };

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
$('secCsv').onclick = async () => { if (!world || !world.section) return; const { sectionCSV } = await import('./section.js?v=62'); download('cross-section.csv', new Blob([sectionCSV(world.section.S)], { type: 'text/csv' })); };

/* language */
document.querySelectorAll('.langBtn').forEach(b => b.onclick = () => setLang(lang === 'km' ? 'en' : 'km'));
onLang.push(() => { if (TC && !$('tacPanel').hidden) tacRender(); if (world && world.D && world.D.lcPct) renderStats(); $('flyTitle').textContent = t(FLY_T[flySec]); });
initLang();
