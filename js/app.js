// 2D overview map (whole Cambodia, lazy road tiles) + AOI selection + 3D scene control
import * as G from './geo.js?v=19';

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
function showPanel(id, on) { $(id).classList.toggle('hidden', !on); $(FAB[id]).classList.toggle('show', !on); }
$('mapToggle').onclick = () => showPanel('mapPanel', true);
$('sceneToggle').onclick = () => showPanel('scenePanel', true);
document.querySelectorAll('.hideP').forEach(b => b.onclick = () => showPanel(b.dataset.panel, false));

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
  $('stats').innerHTML = `${s.roads} road segments · ${s.buildings} buildings · ${nT} trees, ${nP} palms, ${tr.bush || 0} bushes · ${s.vehicles || 0} vehicles · ${s.people || 0} people · ${s.cows || 0} cows<br>` +
    `Elevation ${s.elev[0].toFixed(0)}–${s.elev[1].toFixed(0)} m (×${s.exag}) · imagery zoom ${s.imageryZoom}` + (s.waterDropped ? ` · ${s.waterDropped} seasonal/dry water polygons hidden` : '') +
    ` · ${((performance.now() - t0) / 1000).toFixed(1)} s` +
    (s.cloud && s.cloud.cloudPct > 0.5 ? `<br>☁ Clouds ${s.cloud.cloudPct.toFixed(0)}% of the image → filled ${s.cloud.filledPct.toFixed(0)}% from ` + Object.entries(s.cloud.sources).map(([k, n]) => `${k} (${n} tile${n > 1 ? 's' : ''})`).join(', ') +
      (world.lulc.cloud > 0.005 ? ` · ${(world.lulc.cloud * 100).toFixed(0)}% still unknown` : '') : '');
  const tr2 = s.trees || {}; const L = world.lulc, cols = { tree: '#2c5a28', crop: '#86a84a', bare: '#b0703f', built: '#b8b2a6', water: '#3b6e8f' }, names = { tree: 'Tree canopy', crop: 'Crop / grass', bare: 'Bare soil', built: 'Built / roads', water: 'Water' };
  $('lulc').innerHTML = '<label class="lbl">Land cover seen on the image</label><div class="bar2">' +
    Object.keys(cols).map(k => `<span style="width:${(L[k] * 100).toFixed(1)}%;background:${cols[k]}"></span>`).join('') + '</div><div class="keys">' +
    Object.keys(cols).map(k => `<div><i style="background:${cols[k]}"></i>${names[k]} ${(L[k] * 100).toFixed(0)}%</div>`).join('') + '</div>';
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
    progress('Starting 3D engine…'); const { World } = await import('./world.js?v=19'); world = new World($('scene')); window.__world = world;
    world.onModeChange = m => {
      $('driveBar').hidden = m !== 'drive'; $('walkBar').hidden = m !== 'walk'; $('joy').hidden = m !== 'walk';
      if (m === 'drive' || m === 'walk') { setOn('views', m); showPanel('scenePanel', false); }
    };
    world.onHint = t => { $('driveHint').textContent = t; };
    world.onVehicle = k => { $('vehicle').value = k; };
    world.onSectionHint = t => { $('secHint').textContent = t; };
    world.onSection = async S => {
      const { drawProfile, legendHTML } = await import('./section.js?v=19');
      $('sectionPanel').classList.remove('picking', 'min'); $('secMin').textContent = '▾';
      const cv = $('secCanvas'); cv.width = Math.min(1600, Math.round(cv.clientWidth * Math.min(2, devicePixelRatio))); cv.height = Math.round(cv.width * 0.36);
      drawProfile(cv, S); $('secLegend').innerHTML = legendHTML(S); $('secHint').textContent = 'Done – ↺ for a new line, ▾ to minimise';
    };
    const { joystick } = await import('./modes.js?v=19'); joystick($('joy'), (x, y) => world.walker.move.set(x, y));
    const { Hud } = await import('./hud.js?v=19'); new Hud($('hud'), world);
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
$('sun').oninput = e => world && world.setSun(+e.target.value, false);
$('sun').onchange = e => world && world.setSun(+e.target.value, true);
$('terrainH').oninput = e => { $('terrainVal').textContent = '×' + e.target.value; };
$('terrainH').onchange = () => world && world.D && rebuild();
$('smooth').onchange = () => world && world.D && rebuild();
// drive controls
$('vehicle').onchange = e => world && world.changeVehicle(e.target.value);
$('speed').oninput = e => { $('speedVal').textContent = e.target.value + ' km/h'; if (world && world.driver) world.driver.speed = e.target.value / 3.6; };
$('reverse').onclick = () => world && world.driver && world.driver.reverse();
$('cockpit').onclick = e => { if (!world) return; world.cockpit = !world.cockpit; e.target.classList.toggle('on2', world.cockpit); };
$('pickRoad').onclick = () => world && world.chooseRoad();
$('run').onclick = e => { if (!world) return; world.walker.run = !world.walker.run; e.target.classList.toggle('on2', world.walker.run); };
document.querySelectorAll('[data-exit]').forEach(b => b.onclick = () => { world.setMode('orbit'); setOn('views', ''); showPanel('scenePanel', true); });
if (innerWidth < 640) showPanel('mapPanel', false);
/* right-hand column: keep the layer panel under the inset map, never on top of it */
const placeRight = () => {
  const lp = $('layerPanel'), hud = $('hud'); if (lp.hidden) { document.body.classList.remove('lp-open'); hud.classList.remove('mini'); return; }
  document.body.classList.add('lp-open');
  if (innerWidth < 640) { hud.classList.add('mini'); lp.style.top = ''; lp.style.maxHeight = ''; return; }
  hud.classList.remove('mini');
  let top = hud.hidden ? 12 : hud.getBoundingClientRect().bottom + 8;
  if (!hud.hidden && innerHeight - top < 420) { hud.classList.add('mini'); top = hud.getBoundingClientRect().bottom + 8; }
  lp.style.top = top + 'px'; lp.style.maxHeight = (innerHeight - top - 12) + 'px';
};
addEventListener('resize', placeRight);
/* layer explorer */
let LS = null, LAYERS_DEF = null;
const lpRender = () => {
  if (!LS) return; const list = $('lpList'); list.innerHTML = '';
  for (const L of LAYERS_DEF) {
    const st = LS.state[L.id], av = LS.available(L.id), row = document.createElement('div');
    row.className = 'lprow' + (av ? '' : ' na') + (LS.focus === L.id ? ' focus' : '') + (L.id === 'surface' ? ' ground' : '');
    const why = av ? '' : L.under && !(world.U && (L.id === 'geology' || world.U.soilOk)) ? (L.id === 'lctime' ? 'loading…' : world.U ? 'no data' : 'loading…') : L.id === 'lctime' ? 'loading…' : 'none here';
    row.innerHTML = `<input type="checkbox" ${st.on ? 'checked' : ''} ${av ? '' : 'disabled'}><i style="background:${L.c}"></i><span title="${L.name}${av ? '' : ' – ' + why}">${L.short || L.name}${av ? '' : ` <em>${why}</em>`}</span><input type="range" min="0" max="100" value="${Math.round(st.op * 100)}" ${av ? '' : 'disabled'}>`;
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
  $('layerPanel').hidden = false; placeRight(); if (innerWidth < 900) showPanel('scenePanel', false);
  if (world.mode !== 'orbit') world.setMode('orbit');
  $('lpHint').textContent = 'Preparing layers…';
  const mod = await import('./layers.js?v=19'); LAYERS_DEF = mod.LAYERS;
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
$('lpClose').onclick = () => { $('layerPanel').hidden = true; placeRight(); if (LS) { lpStop(); LS.focus = null; LS.setExplode(0, true); world.goView('oblique'); } };

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
$('secCsv').onclick = async () => { if (!world || !world.section) return; const { sectionCSV } = await import('./section.js?v=19'); download('cross-section.csv', new Blob([sectionCSV(world.section.S)], { type: 'text/csv' })); };
