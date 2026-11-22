// EIA Screening (port of the EIA Screening 0.7.1 QGIS plugin): what sensitive features lie in and around a
// proposed project, zone by zone (footprint + three rings), scored 0–100 with red flags and a report.
// Data are fetched live for the screening window: Open Development Cambodia (WFS), OpenStreetMap (Overpass),
// Esri | Impact Observatory land cover, Hansen forest loss (cloud GeoTIFF), Terrarium elevation tiles.
import * as THREE from 'three';
import { t, lang, KM } from './i18n.js?v=103';
import { loadIO } from './landcover.js?v=103';

let TURF = null, GT = null, KMOK = false;
export const turf = async () => TURF || (TURF = await import('https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/+esm'));
const geotiff = async () => GT || (GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm'));
export async function loadKm() { if (KMOK) return; try { const j = await (await fetch('data/eia_km.json')).json(); for (const k in j) if (!KM[k]) KM[k] = j[k]; KMOK = true; } catch (e) { } }
export const tr = s => t(s);
// Python-style templates (%s %d %.1f %%) so the plugin's Khmer table can be reused as is
export const fmt = (s, ...a) => { let i = 0; return s.replace(/%(\.\d)?[sdfg%]/g, (m, p) => { if (m === '%%') return '%'; const v = a[i++]; if (m.endsWith('d')) return String(Math.round(v)); if (m.endsWith('f')) return Number(v).toFixed(p ? +p.slice(1) : 6); return String(v); }); };
export const num = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export const PROJECT_TYPES = [
  { key: 'dam', label: 'Dam / reservoir', rings: [1, 5, 20] }, { key: 'mine', label: 'Mine / quarry', rings: [0.5, 2, 5] },
  { key: 'dredging', label: 'Sand dredging', rings: [0.5, 2, 5] }, { key: 'road', label: 'Road / railway / power line', rings: [0.25, 0.5, 1] },
  { key: 'canal', label: 'Canal', rings: [0.5, 1, 3] }, { key: 'plantation', label: 'Plantation / land concession', rings: [1, 3, 5] },
  { key: 'factory', label: 'Factory / industrial zone', rings: [0.5, 1, 3] }, { key: 'urban', label: 'Urban development', rings: [0.5, 1, 2] },
  { key: 'custom', label: 'Custom', rings: [1, 3, 5] }];
export const THEMES = [
  { key: 'protected', label: 'Protected areas & corridors', geom: 'polygon', color: '#2e7d32', icon: '🌳' },
  { key: 'concessions', label: 'Land concessions & mining licences', geom: 'polygon', color: '#8d6e63', icon: '⛏️' },
  { key: 'water', label: 'Lakes, wetlands & reservoirs', geom: 'polygon', color: '#1e88e5', icon: '💧' },
  { key: 'rivers', label: 'Rivers & streams', geom: 'line', color: '#1565c0', icon: '〰️' },
  { key: 'villages', label: 'Villages & settlements', geom: 'point', color: '#d81b60', icon: '🏘️' },
  { key: 'facilities', label: 'Pagodas, schools, health centres & heritage', geom: 'point', color: '#6a1b9a', icon: '🛕' },
  { key: 'landcover', label: 'Land cover (ESA WorldCover)', raster: true, icon: '🗺️' },
  { key: 'forestloss', label: 'Forest loss (Hansen loss year)', raster: true, icon: '🪓' },
  { key: 'population', label: 'Population (WorldPop)', raster: true, icon: '👥' },
  { key: 'dem', label: 'Elevation & slope (DEM)', raster: true, icon: '⛰️' }];
export const ZONES = ['F', 'R1', 'R2', 'R3'], ZONE_COLORS = { F: '#c62828', R1: '#ef6c00', R2: '#f9a825', R3: '#7cb342' };
const GROUPS = ['Tree cover', 'Mangroves', 'Shrubland & grassland', 'Cropland', 'Built-up', 'Bare / sparse vegetation', 'Open water', 'Herbaceous wetland'];
const IO_GROUP = { 1: 'Open water', 2: 'Tree cover', 4: 'Herbaceous wetland', 5: 'Cropland', 7: 'Built-up', 8: 'Bare / sparse vegetation', 11: 'Shrubland & grassland' };
export const DISCLAIMER = 'Preliminary desk-based screening using public data. Not an EIA. Results must be verified in the field and by qualified assessors.';
export const zoneLabel = z => z === 'F' ? tr('Footprint') : fmt(tr('Ring %d'), +z.slice(1));

/* ---------------- scoring (same rules as the plugin) ---------------- */
const PRESENCE = [['F', 1], ['R1', 0.75], ['R2', 0.5], ['R3', 0.25]];
export const CLASSES = [[25, 'Low', '#2e7d32'], [50, 'Moderate', '#f9a825'], [75, 'High', '#ef6c00'], [100.01, 'Very high', '#c62828']];
const ORDER = ['Low', 'Moderate', 'High', 'Very high'];
export const CRITERIA = [
  { key: 'protected', label: 'Protected areas and corridors', weight: 5, higher: [] },
  { key: 'forest', label: 'Forest and forest loss', weight: 4, higher: ['plantation', 'mine', 'dam'] },
  { key: 'water', label: 'Rivers, lakes and wetlands', weight: 4, higher: ['dam', 'canal', 'dredging', 'mine'] },
  { key: 'people', label: 'Villages and population', weight: 4, higher: ['factory', 'urban', 'dam'] },
  { key: 'facilities', label: 'Pagodas, schools, health centres and heritage', weight: 3, higher: ['road', 'urban'] },
  { key: 'slope', label: 'Slope and erosion risk', weight: 2, higher: ['road', 'mine', 'plantation'] },
  { key: 'concessions', label: 'Overlap with existing concessions', weight: 2, higher: ['plantation', 'mine'] },
  { key: 'farmland', label: 'Cropland and herbaceous wetland', weight: 2, higher: ['dam', 'canal'] }];
export const defaultWeights = type => Object.fromEntries(CRITERIA.map(c => [c.key, c.weight + (c.higher.includes(type) ? 1 : 0)]));
export const classify = v => { for (const [u, n, c] of CLASSES) if (v < u) return [n, c]; return ['Very high', '#c62828']; };
const classColor = n => (CLASSES.find(c => c[1] === n) || [0, 0, '#555'])[2];
const tier = (v, steps) => { if (v == null) return 0; for (const [th, s] of steps) if (v >= th) return s; return 0; };
const presence = cnt => { for (const [z, s] of PRESENCE) if ((cnt[z] || 0) > 0) return [s, z]; return [0, null]; };
const sumZ = (d, zs) => { const v = zs.map(z => d[z]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const ZT = { F: '%s inside the footprint', R1: '%s in ring 1', R2: '%s in ring 2', R3: '%s in ring 3' };
const ptext = (what, z) => cap(z ? fmt(tr(ZT[z]), tr(what)) : fmt(tr('No %s within the outer ring'), tr(what)));
const SCORERS = {
  protected: m => { const [s, z] = presence(m.protected.count); return [s, ptext('protected area', z)]; },
  forest: (m, za) => { const parts = []; let best = 0; const lc = m.landcover && m.landcover.class_ha;
    if (lc) { const tree = {}; for (const g of ['Tree cover', 'Mangroves']) for (const [z, v] of Object.entries(lc[g] || {})) tree[z] = (tree[z] || 0) + (v || 0);
      const area = (za.F || 0) + (za.R1 || 0), share = area ? 100 * (sumZ(tree, ['F', 'R1']) || 0) / area : 0; best = Math.max(best, tier(share, [[50, 1], [25, 0.75], [10, 0.5], [1, 0.25]])); parts.push(fmt(tr('tree cover %.0f%% of footprint + ring 1'), share)); }
    const loss = m.forestloss && m.forestloss.loss_ha; if (loss) { const l = loss.ALL || 0; best = Math.max(best, tier(l, [[500, 1], [100, 0.75], [10, 0.5], [0.01, 0.25]])); parts.push(fmt(tr('%s ha forest lost since 2001 within the outer ring'), num(l))); }
    return [best, cap(parts.join('; '))]; },
  water: m => { let best = 0; const what = []; for (const [k, w] of [['rivers', 'river/stream'], ['water', 'lake/wetland']]) if (m[k]) { const [s, z] = presence(m[k].count); if (z) what.push(fmt(tr(ZT[z]), tr(w))); best = Math.max(best, s); }
    return [best, what.length ? cap(what.join('; ')) : tr('No river, lake or wetland within the outer ring')]; },
  people: m => { let best = 0; const parts = []; if (m.villages) { const [s, z] = presence(m.villages.count); best = Math.max(best, s); parts.push(ptext('village', z)); }
    const pop = m.population && m.population.pop; if (pop) { const near = sumZ(pop, ['F', 'R1']) || 0; best = Math.max(best, tier(near, [[10000, 1], [2000, 0.75], [500, 0.5], [1, 0.25]])); parts.push(fmt(tr('about %s people in footprint + ring 1'), num(near))); }
    return [best, cap(parts.join('; '))]; },
  facilities: m => { const [s, z] = presence(m.facilities.count); return [s, ptext('pagoda, school, health centre or heritage site', z)]; },
  slope: m => { const st = (m.dem.steep_pct || {}).F, mean = (m.dem.mean_slope || {}).F; if (st == null) return [0, tr('No slope data for the footprint')]; return [tier(st, [[50, 1], [25, 0.75], [10, 0.5], [2, 0.25]]), fmt(tr('%.0f%% of footprint steeper than 15%% (mean slope %.1f%%)'), st, mean || 0)]; },
  concessions: m => { const [s, z] = presence(m.concessions.count); return [s, ptext('existing concession or licence', z)]; },
  farmland: (m, za) => { const lc = m.landcover.class_ha || {}, farm = ['Cropland', 'Herbaceous wetland'].reduce((a, g) => a + ((lc[g] || {}).F || 0), 0), share = za.F ? 100 * farm / za.F : 0; return [tier(share, [[50, 1], [25, 0.75], [10, 0.5], [1, 0.25]]), fmt(tr('Cropland and herbaceous wetland %.0f%% of footprint'), share)]; } };
const assessed = (k, m) => ({ farmland: !!(m.landcover && m.landcover.class_ha), forest: !!(m.landcover && m.landcover.class_ha || m.forestloss && m.forestloss.loss_ha), slope: !!(m.dem && m.dem.steep_pct), people: !!(m.villages || m.population && m.population.pop), water: !!(m.rivers || m.water) })[k] ?? !!m[k];
export function score(res, weights) {
  const m = res.metrics, rows = []; let n = 0, d = 0, tw = 0;
  for (const c of CRITERIA) { const w = +(weights[c.key] ?? c.weight); tw += w;
    if (!assessed(c.key, m)) { rows.push({ key: c.key, label: tr(c.label), weight: w, assessed: false, score: null, points: null, why: tr('Not assessed: no data layer') }); continue; }
    const [s, why] = SCORERS[c.key](m, res.zoneHa); n += w * s; d += w; rows.push({ key: c.key, label: tr(c.label), weight: w, assessed: true, score: s, points: w * s, why }); }
  const value = d ? 100 * n / d : 0, [base] = classify(value), major = res.flags.filter(f => f.major).map(f => f.text); let cls = base, raised = false;
  if (major.length && ORDER.indexOf(cls) < ORDER.indexOf('High')) { cls = 'High'; raised = true; }
  for (const r of rows) r.share = r.points && n ? 100 * r.points / n : 0;
  return res.score = { value, cls, base, color: classColor(cls), raised, major, completeness: tw ? 100 * d / tw : 0, rows };
}

/* ---------------- data sources ---------------- */
const ODC = 'https://data.opendevelopmentcambodia.net/geoserver/ODCambodia/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application%2Fjson&srsName=EPSG:4326&typeName=ODCambodia%3A';
const ODM = 'https://data.opendevelopmentmekong.net/geoserver/ODCambodia/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application%2Fjson&srsName=EPSG:4326&typeName=ODCambodia%3A';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const timed = (u, o = {}, ms = 30000) => { const c = new AbortController(), k = setTimeout(() => c.abort(), ms); return fetch(u, { ...o, signal: c.signal }).finally(() => clearTimeout(k)); };
async function wfs(base, layer, bb) { const r = await timed(`${base}${encodeURIComponent(layer)}&bbox=${bb.join(',')}`, {}, 40000); if (!r.ok) throw new Error('ODC ' + r.status); return (await r.json()).features || []; }
// ask two mirrors; if neither has answered after 15 s (or one fails) bring in the next, take the first good answer
function overpass(q, ms = 90000) {
  return new Promise((ok, bad) => { let next = 0, fails = 0, done = false; const ctl = [];
    const go = () => { if (done || next >= OVERPASS.length) return; const ep = OVERPASS[next++], c = new AbortController(), k = setTimeout(() => c.abort(), ms); ctl.push(c);
      fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: c.signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(j => { if (!done) { done = true; ctl.forEach(x => x !== c && x.abort()); ok(j); } }) // stop the slower mirrors so they do not hold our Overpass slots
        .catch(() => { if (++fails === OVERPASS.length && !done) bad(new Error('Overpass not reachable')); else go(); }).finally(() => clearTimeout(k)); };
    go(); go(); setTimeout(() => { go(); go(); }, 15000); });
}
const NAME_HINTS = ['name_en', 'name_eng', 'nameen', 'name', 'vill_name', 'villname', 'village', 'pa_name', 'orig_name', 'label', 'title'];
const nameOf = p => { const km = lang === 'km' && (p['name:km'] || p.name_kh || p.name_km); if (km) return km; const L = Object.fromEntries(Object.keys(p).map(k => [k.toLowerCase(), k])); for (const h of NAME_HINTS) if (L[h] && p[L[h]]) return String(p[L[h]]); const k = Object.keys(p).find(k => /name/i.test(k) && p[k]); return k ? String(p[k]) : ''; };
const osmName = g => g && (lang === 'km' ? g['name:km'] || g.name || g['name:en'] : g['name:en'] || g.name || g['name:km']) || '';
// join OSM relation member ways into closed rings
function assemble(members) {
  const segs = members.filter(m => m.type === 'way' && m.geometry && m.role !== 'inner').map(m => m.geometry.map(p => [p.lon, p.lat])), rings = [];
  while (segs.length) { let r = segs.shift(); let grew = true;
    while (grew && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) { grew = false; const e = r[r.length - 1];
      for (let i = 0; i < segs.length; i++) { const s = segs[i], a = s[0], b = s[s.length - 1];
        if (a[0] === e[0] && a[1] === e[1]) { r = r.concat(s.slice(1)); segs.splice(i, 1); grew = true; break; }
        if (b[0] === e[0] && b[1] === e[1]) { r = r.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); grew = true; break; } } }
    if (r.length > 3) { if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]); rings.push([r]); } }
  return rings.length ? { type: 'MultiPolygon', coordinates: rings } : null;
}
function osmToFeatures(els) {
  const out = { protected: [], water: [], rivers: [], villages: [], facilities: [] };
  for (const e of els) { const g = e.tags || {}; let geom = null;
    const kind = g.boundary === 'protected_area' || g.boundary === 'national_park' || g.leisure === 'nature_reserve' ? 'protected' : g.waterway ? 'rivers' : g.natural === 'water' || g.natural === 'wetland' || g.landuse === 'reservoir' ? 'water' : g.place ? 'villages' : g.amenity || g.historic ? 'facilities' : null;
    if (!kind) continue;
    if (kind === 'villages' || kind === 'facilities') { const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (lat == null) continue; geom = { type: 'Point', coordinates: [lon, lat] }; }
    else if (e.type === 'way' && e.geometry) { const c = e.geometry.map(p => [p.lon, p.lat]); if (kind === 'rivers') geom = { type: 'LineString', coordinates: c }; else if (c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) geom = { type: 'Polygon', coordinates: [c] }; }
    else if (e.type === 'relation' && e.members && kind !== 'rivers') geom = assemble(e.members);
    if (!geom) continue;
    const sub = g.amenity === 'place_of_worship' || g.amenity === 'monastery' ? 'pagoda' : /school|kindergarten|college|university/.test(g.amenity || '') ? 'school' : /hospital|clinic|doctors|health_post/.test(g.amenity || '') ? 'health' : g.historic ? 'heritage' : g.place || g.waterway || g.natural || g.landuse || g.boundary || g.leisure;
    out[kind].push({ type: 'Feature', geometry: geom, properties: { name: osmName(g), sub, src: 'OSM' } }); }
  return out;
}

// fallback when Overpass is busy: the OpenStreetMap place extract bundled with the site (0.25° cells)
async function bundledPlaces(bb) {
  const out = { villages: [], facilities: [] }, PL = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality', 'isolated_dwelling']), FA = { place_of_worship: 'pagoda', school: 'school', college: 'school', university: 'school', hospital: 'health', clinic: 'health', doctors: 'health' };
  const jobs = []; for (let i = Math.floor((bb[0] - 102) / 0.25); i <= Math.floor((bb[2] - 102) / 0.25); i++) for (let j = Math.floor((bb[1] - 10) / 0.25); j <= Math.floor((bb[3] - 10) / 0.25); j++)
    jobs.push(fetch(`data/places/${i}_${j}.json`).then(r => r.ok ? r.json() : []).catch(() => []));
  for (const a of await Promise.all(jobs)) for (const [lon, lat, kind, nk, ne] of a) { if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    const name = lang === 'km' ? nk || ne : ne || nk, f = sub => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, sub, src: 'OSM (bundled)' } });
    if (PL.has(kind)) out.villages.push(f(kind)); else if (FA[kind]) out.facilities.push(f(FA[kind])); }
  return out;
}

/* ---------------- geometry helpers ---------------- */
const R_E = 6371008.8, D2R = Math.PI / 180;
const hav = (a, b) => { const dl = (b[1] - a[1]) * D2R, dn = (b[0] - a[0]) * D2R, s = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dn / 2) ** 2; return 2 * R_E * Math.asin(Math.sqrt(s)); };
function polyRings(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
// rasterise zones (F=1, R1=2, R2=3, R3=4) on a lon/lat grid for fast pixel lookups
function zoneGrid(B, bb, maxPx) {
  const [w, s, e, n] = bb, mx = (e - w) * Math.cos((s + n) / 2 * D2R), my = n - s, k = maxPx / Math.max(mx, my), W = Math.max(8, Math.round(mx * k)), H = Math.max(8, Math.round(my * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
  for (let z = B.length - 1; z >= 0; z--) { g.fillStyle = `rgb(${z + 1},0,0)`; g.beginPath(); for (const poly of polyRings(B[z].geometry)) for (const r of poly) r.forEach((p, i) => { const x = (p[0] - w) / (e - w) * W, y = (n - p[1]) / (n - s) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.fill('evenodd'); }
  const d = g.getImageData(0, 0, W, H).data, z = new Uint8Array(W * H); for (let i = 0; i < z.length; i++) { const v = d[i * 4]; z[i] = v >= 1 && v <= 4 && d[i * 4 + 3] > 200 ? v : 0; }
  return { bb, W, H, z, at(lon, lat) { const i = Math.floor((lon - w) / (e - w) * W), j = Math.floor((n - lat) / (n - s) * H); return i < 0 || j < 0 || i >= W || j >= H ? 0 : z[j * W + i]; } };
}

/* ---------------- the screening ---------------- */
// fp: GeoJSON Feature (Polygon/MultiPolygon) of the project footprint; opt: { type, rings[3], name, ppb (people per building) }
export async function run(fp, opt, say = () => { }) {
  await loadKm(); const T = await turf();
  const B = [fp]; for (const r of opt.rings) B.push(T.buffer(fp, r, { units: 'kilometers', steps: 24 }));
  const A = B.map(b => T.area(b) / 1e4), zoneHa = { F: A[0], R1: A[1] - A[0], R2: A[2] - A[1], R3: A[3] - A[2], ALL: A[3] };
  const bb3 = T.bbox(B[3]), bb1 = T.bbox(B[1]);
  const res = { name: opt.name, type: opt.type, rings: opt.rings, footprint: fp, B, zoneHa, bb: bb3, metrics: {}, items: {}, flags: [], headline: [], sources: [], log: {}, date: new Date() };
  const G3 = zoneGrid(B, bb3, 900), G1 = zoneGrid(B, bb1, 900), zoneAt = (lon, lat) => { const v = lon >= bb1[0] && lon <= bb1[2] && lat >= bb1[1] && lat <= bb1[3] ? G1.at(lon, lat) : G3.at(lon, lat); return v ? ZONES[v - 1] : null; };
  const zc = () => ({ F: 0, R1: 0, R2: 0, R3: 0, ALL: 0 }), cen = T.centroid(fp).geometry.coordinates;
  const t0 = performance.now(); const note = (k, ok, text, src) => { console.debug('EIA', k, ok, text, Math.round(performance.now() - t0) + ' ms'); res.log[k] = { ok, text }; if (src && !res.sources.includes(src)) res.sources.push(src); say(k, ok, text); };
  // vector themes
  const vec = {}, near = {};
  const addVec = (key, feats) => {
    const th = THEMES.find(x => x.key === key), cnt = zc(), area = th.geom === 'polygon' ? zc() : null, len = th.geom === 'line' ? zc() : null, items = [];
    for (const f of feats) { let zone = null, dist = null;
      try {
        if (th.geom === 'point') { const [lon, lat] = f.geometry.coordinates; zone = zoneAt(lon, lat); if (zone) dist = zone === 'F' ? 0 : T.pointToPolygonDistance ? Math.abs(T.pointToPolygonDistance(f.geometry.coordinates, fp, { units: 'kilometers' })) : hav(cen, [lon, lat]) / 1000; }
        else if (th.geom === 'line') { const seen = new Set(); for (const ln of (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)) for (let i = 1; i < ln.length; i++) { const a = ln[i - 1], b = ln[i], L = hav(a, b), n = Math.max(1, Math.ceil(L / 40));
            for (let k = 0; k < n; k++) { const p = [a[0] + (b[0] - a[0]) * (k + .5) / n, a[1] + (b[1] - a[1]) * (k + .5) / n], z = zoneAt(p[0], p[1]); if (z) { len[z] += L / n / 1000; seen.add(z); } } }
          zone = ZONES.find(z => seen.has(z)) || null; }
        else { const fb = T.bbox(f); if (fb[2] < bb3[0] || fb[0] > bb3[2] || fb[3] < bb3[1] || fb[1] > bb3[3]) { if (key === 'protected') { try { const d = Math.abs(T.pointToPolygonDistance(cen, f, { units: 'kilometers' })); if (!near.protected || d < near.protected[1]) near.protected = [nameOf(f.properties) || tr('protected area'), d]; } catch (e) { } } continue; }
          // fast path: a polygon lying in one zone (corners and middle agree) needs no clipping
          const zs = [[fb[0], fb[1]], [fb[2], fb[1]], [fb[0], fb[3]], [fb[2], fb[3]], [(fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2]].map(([x, y]) => zoneAt(x, y));
          if (zs.every(z => z === zs[0]) && (fb[2] - fb[0]) < (bb3[2] - bb3[0]) / 6) { if (!zs[0]) continue; zone = zs[0]; area[zone] += T.area(f) / 1e4; } else {
          const cl = T.bboxClip(f, bb3); if (!cl || !cl.geometry.coordinates.length) continue; let prev = 0;
          for (let k = 0; k < 4; k++) { let a = 0; try { const x = T.intersect(T.featureCollection([cl, B[k]])); a = x ? T.area(x) / 1e4 : 0; } catch (e) { a = 0; } if (a > 0.0001 && !zone) zone = ZONES[k]; area[ZONES[k]] += Math.max(0, a - prev); prev = Math.max(prev, a); }
          if (!zone && key === 'protected') { try { const d = Math.abs(T.pointToPolygonDistance(cen, f, { units: 'kilometers' })); if (!near.protected || d < near.protected[1]) near.protected = [nameOf(f.properties) || tr('protected area'), d]; } catch (e) { } } } }
      } catch (e) { continue; }
      if (!zone) continue; cnt[zone]++; cnt.ALL++;
      if (th.geom !== 'point') { try { dist = zone === 'F' ? 0 : Math.abs(T.pointToPolygonDistance(T.pointOnFeature(f), fp, { units: 'kilometers' })); } catch (e) { dist = null; } }
      if (key === 'protected' && (!near.protected || (dist ?? 0) < near.protected[1])) near.protected = [nameOf(f.properties) || tr('protected area'), dist ?? 0];
      items.push({ theme: key, name: nameOf(f.properties) || f.properties.name || '', sub: f.properties.sub || '', zone, dist, geometry: f.geometry, src: f.properties.src || '' }); }
    if (area) for (const z of ZONES) area.ALL += area[z]; if (len) for (const z of ZONES) len.ALL += len[z];
    vec[key] = res.metrics[key] = { count: cnt, area, length: len }; res.items[key] = items.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  };
  const polyStr = b => { let g = T.simplify(b, { tolerance: 0.0003 }); for (let tol = 0.0006; JSON.stringify(g.geometry.coordinates).length > 9000 && tol < 0.05; tol *= 2) g = T.simplify(b, { tolerance: tol });
    const rs = polyRings(g.geometry).map(p => p[0]).sort((a, b) => b.length - a.length)[0]; return rs.map(p => `${p[1].toFixed(5)} ${p[0].toFixed(5)}`).join(' '); };
  let counts = null; const countQ = B.map(b => `way["building"](poly:"${polyStr(b)}");out count;`).join('');
  const pad = 0.25, bbP = [bb3[0] - pad, bb3[1] - pad, bb3[2] + pad, bb3[3] + pad];
  const qb = `${bb3[1]},${bb3[0]},${bb3[3]},${bb3[2]}`;
  say('osm', null, tr('OpenStreetMap…'));
  const osmP = overpass(`[out:json][timeout:120][maxsize:268435456];(way["boundary"~"^(protected_area|national_park)$"](${qb});relation["boundary"~"^(protected_area|national_park)$"](${qb});way["leisure"="nature_reserve"](${qb});relation["leisure"="nature_reserve"](${qb}););out geom tags;(way["natural"~"^(water|wetland)$"](${qb});relation["natural"~"^(water|wetland)$"](${qb});way["landuse"="reservoir"](${qb});relation["landuse"="reservoir"](${qb}););out geom tags;way["waterway"~"^(river|stream|canal)$"](${qb});out geom tags;node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|isolated_dwelling|locality)$"](${qb});out;(nwr["amenity"~"^(place_of_worship|monastery|school|kindergarten|college|university|hospital|clinic|doctors|health_post)$"](${qb});nwr["historic"~"^(archaeological_site|monument|memorial|ruins|temple|wayside_shrine)$"](${qb}););out center tags;${countQ}`, 150000)
    .then(j => { const c = (j.elements || []).filter(e => e.type === 'count').map(e => +(e.tags.ways || e.tags.total || 0)); if (c.length === 4) counts = c; return osmToFeatures(j.elements || []); }).catch(e => { console.warn('overpass', e); return null; });
  const odc = (base, layers, bb) => Promise.all(layers.map(l => wfs(base, l, bb).catch(e => { console.warn('ODC', l, e); return null; })));
  const [odcPA, odcCon, odcHealth, odcSchool, osm] = await Promise.all([
    odc(ODC, ['all_npa_after_reclass'], bbP), odc(ODC, ['all_elc_en', '0fdb0d9c-eb6b-4a1a-9bdd-f1e7402af1a3'], bb3),
    odc(ODC, ['healthcenter', 'healthpost', 'hltfacp_referral', 'national_hospital_en'], bb3), odc(ODC, ['school-of-cambodia-2012'], bb3), osmP]);
  console.debug('EIA fetched', Math.round(performance.now() - t0), 'ms', osm && Object.fromEntries(Object.entries(osm).map(([k, v]) => [k, v.length])));
  const ok = a => a.some(x => x), flat = (a, src, sub) => a.flat().filter(Boolean).map(f => (f.properties = { ...f.properties, src, sub: sub || f.properties.sub }, f));
  const ODC_ATT = 'Open Development Cambodia (CC BY-SA 4.0)', OSM_ATT = 'OpenStreetMap contributors (ODbL)';
  if (ok(odcPA)) { addVec('protected', flat(odcPA, 'ODC')); note('protected', true, fmt(tr('%d features'), res.items.protected.length) + ' · ODC', ODC_ATT); }
  else if (osm) { addVec('protected', osm.protected); note('protected', true, fmt(tr('%d features'), res.items.protected.length) + ' · OSM', OSM_ATT); } else note('protected', false, tr('not available'));
  if (ok(odcCon)) { addVec('concessions', flat(odcCon, 'ODC')); note('concessions', true, fmt(tr('%d features'), res.items.concessions.length) + ' · ODC', ODC_ATT); } else note('concessions', false, tr('not available'));
  let osmB = null; if (!osm) { say('osm', false, tr('Overpass busy – using the bundled OSM extract')); osmB = await bundledPlaces(bb3); }
  if (osm) { for (const k of ['water', 'rivers', 'villages']) { addVec(k, osm[k]); note(k, true, fmt(tr('%d features'), res.items[k].length) + ' · OSM', OSM_ATT); } }
  else { for (const k of ['water', 'rivers']) note(k, false, tr('not available')); addVec('villages', osmB.villages); note('villages', true, fmt(tr('%d features'), res.items.villages.length) + ' · OSM*', OSM_ATT); }
  { const f = []; if (ok(odcHealth)) f.push(...flat(odcHealth, 'ODC', 'health')); if (ok(odcSchool)) f.push(...flat(odcSchool, 'ODC', 'school'));
    const of = osm ? osm.facilities : osmB.facilities; f.push(...of.filter(x => !(x.properties.sub === 'health' && ok(odcHealth) || x.properties.sub === 'school' && ok(odcSchool))));
    if (f.length || osm) { addVec('facilities', f); note('facilities', true, fmt(tr('%d features'), res.items.facilities.length) + (ok(odcHealth) ? ' · ODC + OSM' : ' · OSM'), ok(odcHealth) ? ODC_ATT : OSM_ATT); } else note('facilities', false, tr('not available')); }
  // land cover (Esri | Impact Observatory 10 m, latest year)
  say('landcover', null, '…');
  try { const mx = (bb3[2] - bb3[0]) * 111320 * Math.cos(cen[1] * D2R), my = (bb3[3] - bb3[1]) * 110574;
    const io = await loadIO({ w: bb3[0], s: bb3[1], e: bb3[2], n: bb3[3] }, mx * 4, my * 4); // ×4: as large an image as the service gives
    if (!io) throw new Error('no image');
    const pxHa = mx / io.w * my / io.h / 1e4, ch = {}; for (const g of GROUPS) ch[g] = zc();
    // finer counting in the footprint + ring 1 window
    const io1 = await loadIO({ w: bb1[0], s: bb1[1], e: bb1[2], n: bb1[3] }, (bb1[2] - bb1[0]) * 111320 * 4, (bb1[3] - bb1[1]) * 110574 * 4);
    const count = (im, bb, only) => { const ha = (bb[2] - bb[0]) * 111320 * Math.cos(cen[1] * D2R) / im.w * (bb[3] - bb[1]) * 110574 / im.h / 1e4;
      for (let j = 0; j < im.h; j++) for (let i = 0; i < im.w; i++) { const lon = bb[0] + (i + .5) / im.w * (bb[2] - bb[0]), lat = bb[3] - (j + .5) / im.h * (bb[3] - bb[1]), z = zoneAt(lon, lat); if (!z || !only.includes(z)) continue; const g = IO_GROUP[im.d[j * im.w + i]]; if (g) { ch[g][z] += ha; ch[g].ALL += ha; } } };
    if (io1) { count(io1, bb1, ['F', 'R1']); count(io, bb3, ['R2', 'R3']); } else count(io, bb3, ZONES);
    res.metrics.landcover = { class_ha: ch }; note('landcover', true, `Esri | Impact Observatory 10 m, ${io.year}`, 'Esri | Impact Observatory, Sentinel-2 10 m land cover (CC BY 4.0)'); void pxHa;
  } catch (e) { console.warn(e); note('landcover', false, tr('not available')); }
  // forest loss (Hansen GFC, cloud GeoTIFF read by window)
  say('forestloss', null, '…');
  try { const G = await geotiff(), lat0 = Math.ceil(bb3[3] / 10) * 10, lon0 = Math.floor(bb3[0] / 10) * 10;
    const tile = `${lat0}${lat0 >= 0 ? 'N' : 'S'}_${String(Math.abs(lon0)).padStart(3, '0')}${lon0 >= 0 ? 'E' : 'W'}`;
    const tif = await G.fromUrl(`https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_lossyear_${tile}.tif`, { allowFullFile: false }), im = await tif.getImage();
    const px = 0.00025, x0 = Math.max(0, Math.floor((bb3[0] - lon0) / px)), x1 = Math.min(40000, Math.ceil((bb3[2] - lon0) / px)), y0 = Math.max(0, Math.floor((lat0 - bb3[3]) / px)), y1 = Math.min(40000, Math.ceil((lat0 - bb3[1]) / px));
    const step = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 2400)), w = Math.ceil((x1 - x0) / step), h = Math.ceil((y1 - y0) / step);
    const [d] = await im.readRasters({ window: [x0, y0, x1, y1], width: w, height: h, resampleMethod: 'nearest' });
    const ha = (px * step * 111320 * Math.cos(cen[1] * D2R)) * (px * step * 110574) / 1e4, loss = zc(), byYear = {};
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = d[j * w + i]; if (!v) continue; const z = zoneAt(lon0 + (x0 + (i + .5) * step) * px, lat0 - (y0 + (j + .5) * step) * px); if (!z) continue; loss[z] += ha; loss.ALL += ha; byYear[2000 + v] = (byYear[2000 + v] || 0) + ha; }
    res.metrics.forestloss = { loss_ha: loss, byYear }; note('forestloss', true, 'Hansen GFC 2024 v1.12', 'Hansen et al. (2013) Global Forest Change 2000–2024 v1.12 (CC BY 4.0)');
  } catch (e) { console.warn(e); note('forestloss', false, tr('not available')); }
  // slope (Terrarium elevation tiles over the footprint + ring 1)
  say('dem', null, '…');
  try { const span = Math.max(bb1[2] - bb1[0], bb1[3] - bb1[1]); let z = 14; while (z > 9 && span * Math.pow(2, z) / 360 * 256 > 1024) z--;
    const tx = lon => (lon + 180) / 360 * 2 ** z, ty = lat => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
    const X0 = Math.floor(tx(bb1[0])), X1 = Math.floor(tx(bb1[2])), Y0 = Math.floor(ty(bb1[3])), Y1 = Math.floor(ty(bb1[1])), W = (X1 - X0 + 1) * 256, H = (Y1 - Y0 + 1) * 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
    await Promise.all([]. concat(...Array.from({ length: X1 - X0 + 1 }, (_, i) => Array.from({ length: Y1 - Y0 + 1 }, (_, j) => new Promise(ok => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { g.drawImage(im, i * 256, j * 256); ok(); }; im.onerror = ok; im.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${X0 + i}/${Y0 + j}.png`; })))));
    const px = g.getImageData(0, 0, W, H).data, el = (i, j) => { const q = (j * W + i) * 4; return px[q] * 256 + px[q + 1] + px[q + 2] / 256 - 32768; };
    const res_m = 156543.03 * Math.cos(cen[1] * D2R) / 2 ** z, st = zc(), tot = zc(), ms = zc(); let emin = 1e9, emax = -1e9;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const lon = (X0 + i / 256) / 2 ** z * 360 - 180, n = Math.PI - 2 * Math.PI * (Y0 + j / 256) / 2 ** z, lat = Math.atan(Math.sinh(n)) / D2R, zz = zoneAt(lon, lat); if (zz !== 'F' && zz !== 'R1') continue;
      const s = 100 * Math.hypot(el(i + 1, j) - el(i - 1, j), el(i, j + 1) - el(i, j - 1)) / (2 * res_m); tot[zz]++; ms[zz] += s; if (s > 15) st[zz]++; const e = el(i, j); if (zz === 'F') { emin = Math.min(emin, e); emax = Math.max(emax, e); } }
    const steep = {}, mean = {}; for (const k of ['F', 'R1']) if (tot[k]) { steep[k] = 100 * st[k] / tot[k]; mean[k] = ms[k] / tot[k]; }
    if (steep.F == null) throw new Error('footprint too small for the DEM');
    res.metrics.dem = { steep_pct: steep, mean_slope: mean, elev: [emin, emax] }; note('dem', true, `Terrarium z${z} (~${Math.round(res_m)} m)`, 'Mapzen Terrarium elevation tiles (SRTM, ALOS and others) on AWS');
  } catch (e) { console.warn(e); note('dem', false, tr('not available')); }
  // people: OpenStreetMap buildings counted per zone × people per building (WorldPop has no web access here)
  say('population', null, '…');
  try { const c = counts; if (!c) throw new Error('no building counts');
    const ppb = opt.ppb || 4.3, b = { F: c[0], R1: Math.max(0, c[1] - c[0]), R2: Math.max(0, c[2] - c[1]), R3: Math.max(0, c[3] - c[2]) }, pop = {}; for (const z of ZONES) pop[z] = b[z] * ppb; pop.ALL = c[3] * ppb;
    res.metrics.population = { pop, buildings: { ...b, ALL: c[3] }, ppb }; note('population', true, fmt(tr('%s buildings × %s people'), num(c[3]), ppb), 'OpenStreetMap buildings (ODbL); people per building is an assumption');
  } catch (e) { console.warn(e); note('population', false, tr('not available')); }
  res.nearest = near;
  summarise(res); return res;
}

export function summarise(res) {
  res.flags = []; res.headline = [];
  const vec = res.metrics, d1 = res.rings[0], d3 = res.rings[2], flag = (text, major) => res.flags.push({ text, major });
  res.headline.push(fmt(tr('Footprint: %s ha (%s).'), num(res.zoneHa.F, 1), tr(PROJECT_TYPES.find(p => p.key === res.type).label)));
  const pa = vec.protected; if (pa) { if (pa.count.F) flag(fmt(tr('Footprint overlaps %d protected area(s) (%s ha).'), pa.count.F, num(pa.area.F)), true); if (res.nearest.protected) res.headline.push(fmt(tr('Nearest protected area: %s, %.1f km.'), res.nearest.protected[0], res.nearest.protected[1])); }
  if (vec.rivers && vec.rivers.count.F) flag(fmt(tr('Footprint crosses or touches %d river/stream feature(s).'), vec.rivers.count.F), true);
  if (vec.water && vec.water.count.F) flag(fmt(tr('Footprint overlaps lakes or wetlands (%s ha).'), num(vec.water.area.F)), false);
  if (vec.concessions && vec.concessions.count.F) flag(fmt(tr('Footprint overlaps %d existing concession(s)/licence(s): possible land conflict.'), vec.concessions.count.F), false);
  if (vec.facilities && vec.facilities.count.F) flag(fmt(tr('%d pagoda/school/health/heritage site(s) inside the footprint.'), vec.facilities.count.F), true);
  const vl = vec.villages; if (vl) { res.headline.push(fmt(tr('Villages: %d inside footprint, %d within %s km, %d within %s km.'), vl.count.F, vl.count.F + vl.count.R1, d1, vl.count.ALL, d3)); if (vl.count.F) flag(fmt(tr('%d village(s) inside the footprint: possible resettlement.'), vl.count.F), false); }
  const pop = vec.population && vec.population.pop; if (pop) { res.headline.push(fmt(tr('Population: about %s inside footprint, %s within %s km.'), num(pop.F), num(pop.ALL), d3)); if (pop.F > 1000) flag(tr('More than 1,000 people estimated inside the footprint.'), true); }
  const tree = vec.landcover && vec.landcover.class_ha['Tree cover']; if (tree && tree.F) res.headline.push(fmt(tr('Tree cover inside footprint: %s ha.'), num(tree.F)));
  const loss = vec.forestloss && vec.forestloss.loss_ha.ALL; if (loss) res.headline.push(fmt(tr('Forest lost since 2001 within %s km: %s ha.'), d3, num(loss)));
  const st = vec.dem && vec.dem.steep_pct.F; if (st != null && st > 25) flag(fmt(tr('%.0f%% of the footprint is steeper than 15%%: erosion risk.'), st), false);
}

// per-zone table rows: [label, unit, {F,R1,R2,R3,ALL}]
export function zoneTable(res) {
  const m = res.metrics, rows = [[tr('Zone area'), 'ha', res.zoneHa]];
  for (const th of THEMES) { const v = m[th.key]; if (!v) continue;
    if (th.geom === 'polygon') rows.push([tr(th.label), 'ha', v.area]); else if (th.geom === 'line') rows.push([tr(th.label), 'km', v.length]); else if (th.geom === 'point') rows.push([tr(th.label), 'n', v.count]); }
  if (m.landcover) for (const g of GROUPS) { const v = m.landcover.class_ha[g]; if (v && v.ALL > 0.01) rows.push(['  ' + tr(g), 'ha', v]); }
  if (m.forestloss) rows.push([tr('Forest loss 2001–2024'), 'ha', m.forestloss.loss_ha]);
  if (m.population) rows.push([tr('People (estimate)'), 'n', m.population.pop]);
  if (m.dem) rows.push([tr('Area steeper than 15% (% of zone)'), '%', m.dem.steep_pct], [tr('Mean slope (%)'), '%', m.dem.mean_slope]);
  return rows;
}

/* ---------------- map image (imagery, zones, features, scale, north, inset) ---------------- */
const tileImg = (z, x, y) => new Promise(ok => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; });
export async function mapImage(res, W = 1400, H = 1000, o = {}) {
  const pad = 0.06, [w0, s0, e0, n0] = res.bb, dx = (e0 - w0) * pad, dy = (n0 - s0) * pad, bb = [w0 - dx, s0 - dy, e0 + dx, n0 + dy];
  const mx = lon => (lon + 180) / 360, my = lat => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2;
  let X0 = mx(bb[0]), X1 = mx(bb[2]), Y0 = my(bb[3]), Y1 = my(bb[1]); const sc = Math.min(W / (X1 - X0), H / (Y1 - Y0)), cxm = (X0 + X1) / 2, cym = (Y0 + Y1) / 2;
  X0 = cxm - W / 2 / sc; Y0 = cym - H / 2 / sc; X1 = cxm + W / 2 / sc; Y1 = cym + H / 2 / sc;
  const P = (lon, lat) => [(mx(lon) - X0) * sc, (my(lat) - Y0) * sc], cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  let z = Math.min(17, Math.max(3, Math.round(Math.log2(sc / 256)))); const n = 2 ** z, ts = sc / n, jobs = [];
  for (let x = Math.floor(X0 * n); x <= Math.floor(X1 * n); x++) for (let y = Math.floor(Y0 * n); y <= Math.floor(Y1 * n); y++) jobs.push(tileImg(z, x, y).then(im => im && g.drawImage(im, (x / n - X0) * sc, (y / n - Y0) * sc, ts + 0.5, ts + 0.5)));
  g.fillStyle = '#d9dee2'; g.fillRect(0, 0, W, H); await Promise.all(jobs); g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(0, 0, W, H);
  const path = geom => { g.beginPath(); for (const poly of polyRings(geom)) for (const r of poly) r.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
  const sw = Math.max(1, W / 700);
  // features
  for (const th of THEMES) { if (th.raster) continue; for (const it of (res.items[th.key] || [])) { const gm = it.geometry;
    if (th.geom === 'polygon') { path(gm); g.fillStyle = th.color + '55'; g.fill('evenodd'); g.strokeStyle = th.color; g.lineWidth = 1.5 * sw; g.stroke(); }
    else if (th.geom === 'line') { g.strokeStyle = th.color; g.lineWidth = (it.sub === 'river' ? 2.6 : 1.4) * sw; for (const ln of (gm.type === 'LineString' ? [gm.coordinates] : gm.coordinates)) { g.beginPath(); ln.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); } } } }
  // zones
  for (let k = 3; k >= 0; k--) { path(res.B[k].geometry); g.strokeStyle = ZONE_COLORS[ZONES[k]]; g.lineWidth = (k ? 2.4 : 3) * sw; g.setLineDash(k ? [10 * sw, 6 * sw] : []); if (!k) { g.fillStyle = 'rgba(198,40,40,.22)'; g.fill('evenodd'); } g.stroke(); } g.setLineDash([]);
  for (const th of THEMES) if (th.geom === 'point') for (const it of (res.items[th.key] || [])) { const [x, y] = P(...it.geometry.coordinates); g.fillStyle = th.color; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * sw; g.beginPath(); th.key === 'villages' ? g.arc(x, y, 4.5 * sw, 0, 7) : g.rect(x - 4 * sw, y - 4 * sw, 8 * sw, 8 * sw); g.fill(); g.stroke(); }
  // north arrow, scale bar
  const fs = Math.round(13 * sw); g.font = `600 ${fs}px "Noto Sans Khmer", system-ui`;
  g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(W - 46 * sw, 10 * sw, 36 * sw, 50 * sw); g.fillStyle = '#222'; g.beginPath(); g.moveTo(W - 28 * sw, 16 * sw); g.lineTo(W - 37 * sw, 44 * sw); g.lineTo(W - 28 * sw, 38 * sw); g.lineTo(W - 19 * sw, 44 * sw); g.closePath(); g.fill(); g.textAlign = 'center'; g.fillText('N', W - 28 * sw, 56 * sw);
  const mPerPx = 40075016.7 * Math.cos((s0 + n0) / 2 * D2R) / sc, nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].map(k => k * 1000).filter(v => v / mPerPx < W * 0.28).pop() || 100, bw = nice / mPerPx;
  g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(10 * sw, H - 40 * sw, bw + 60 * sw, 30 * sw); g.fillStyle = '#222'; g.fillRect(18 * sw, H - 22 * sw, bw, 5 * sw); g.fillStyle = '#fff'; g.fillRect(18 * sw + bw / 2, H - 21 * sw, bw / 2 - 1, 3 * sw);
  g.fillStyle = '#222'; g.textAlign = 'left'; g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 24 * sw + bw, H - 15 * sw);
  // inset: where in Cambodia
  if (o.inset !== false) { const iw = Math.round(W * 0.2), ih = Math.round(iw * 0.82), ix = W - iw - 10 * sw, iy = H - ih - 10 * sw, kb = [102.2, 10.2, 107.8, 14.8], c2 = document.createElement('canvas'); c2.width = iw; c2.height = ih; const h = c2.getContext('2d');
    const z2 = 6, n2 = 64, ix0 = mx(kb[0]), iy0 = my(kb[3]), s2 = Math.min(iw / (mx(kb[2]) - ix0), ih / (my(kb[1]) - iy0)), j2 = [];
    for (let x = Math.floor(ix0 * n2); x <= Math.floor(mx(kb[2]) * n2); x++) for (let y = Math.floor(iy0 * n2); y <= Math.floor(my(kb[1]) * n2); y++) j2.push(tileImg(z2, x, y).then(im => im && h.drawImage(im, (x / n2 - ix0) * s2, (y / n2 - iy0) * s2, s2 / n2 + .5, s2 / n2 + .5)));
    await Promise.all(j2); const c = T_center(res); h.strokeStyle = '#ff2b2b'; h.lineWidth = 2.5; h.beginPath(); h.arc((mx(c[0]) - ix0) * s2, (my(c[1]) - iy0) * s2, 6, 0, 7); h.stroke();
    g.fillStyle = '#fff'; g.fillRect(ix - 3, iy - 3, iw + 6, ih + 6); g.drawImage(c2, ix, iy); }
  return cv;
}
const T_center = res => { const b = res.bb; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };

/* ---------------- report (HTML, printed to A4 by the app) ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function reportHTML(res, mapUrl, admin) {
  const S = res.score, zt = zoneTable(res), dd = res.date.toISOString().slice(0, 10), fmtv = (u, v) => v == null ? '–' : u === 'n' ? num(v) : u === '%' ? num(v, 1) : num(v, v < 10 ? 1 : 0);
  const items = []; for (const th of THEMES) for (const it of (res.items[th.key] || []).slice(0, 12)) items.push(`<tr><td>${th.icon} ${esc(tr(th.label))}</td><td>${esc(it.name || '—')}</td><td>${esc(tr(it.sub || ''))}</td><td>${zoneLabel(it.zone)}</td><td class=r>${it.dist == null ? '–' : num(it.dist, 2)}</td></tr>`);
  return `<!doctype html><html><head><meta charset=utf-8><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;700&display=swap" rel=stylesheet><style>
body{font:13px/1.5 "Noto Sans Khmer",system-ui,sans-serif;color:#1d2733;margin:0;padding:22px 26px;width:768px}h1{font-size:22px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #2e5c8a;padding-bottom:3px;color:#22476b}
.sub{color:#5a6b7c}.badge{display:inline-block;color:#fff;border-radius:8px;padding:6px 14px;font-size:18px;font-weight:700}.kf{display:flex;gap:16px;align-items:center;background:#f3f6f9;border-radius:10px;padding:12px 14px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:11.5px}td,th{border-bottom:1px solid #dde3e9;padding:4px 5px;text-align:left;vertical-align:top}th{background:#eef2f6}.r{text-align:right;font-variant-numeric:tabular-nums}
.flag{background:#fdecea;border-left:4px solid #c62828;padding:5px 9px;margin:4px 0;border-radius:4px}.flag.minor{background:#fff6e0;border-color:#ef8f00}.bar{height:8px;background:#e3e8ee;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%}
img{width:100%;border-radius:6px;border:1px solid #ccd}.foot{color:#6b7a89;font-size:10.5px;margin-top:16px;border-top:1px solid #dde3e9;padding-top:6px}.warn{background:#fff6e0;border-radius:6px;padding:8px 10px;font-size:11.5px}</style></head><body>
<div class=sub>${esc(tr('Environmental screening'))} · Cambodia 3D · ${dd}</div><h1>${esc(res.name || tr('EIA Screening'))}</h1>
<div class=sub>${esc(tr(PROJECT_TYPES.find(p => p.key === res.type).label))} · ${admin ? esc(admin) + ' · ' : ''}${T_center(res).map(v => v.toFixed(4)).reverse().join(', ')} · ${esc(tr('Rings'))}: ${res.rings.join(' / ')} km</div>
<div class=kf><span class=badge style="background:${S.color}">${esc(tr(S.cls))}</span><div><b style="font-size:18px">${num(S.value)} / 100</b> ${S.raised ? `<span class=sub>${esc(fmt(tr('Raised from %s by a major red flag.'), tr(S.base)))}</span>` : ''}<br><span class=sub>${esc(fmt(tr('Data completeness %.0f%% of the total weight.'), S.completeness))}</span></div></div>
<h2>${esc(tr('Key findings'))}</h2><ul>${res.headline.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
<h2>${esc(tr('Red flags'))}</h2>${res.flags.length ? res.flags.map(f => `<div class="flag ${f.major ? '' : 'minor'}"><b>${esc(tr(f.major ? 'Red flag (major)' : 'Red flag'))}:</b> ${esc(f.text)}</div>`).join('') : `<p>${esc(tr('No red flags found in the layers screened.'))}</p>`}
${mapUrl ? `<h2>${esc(tr('Map'))}</h2><img src="${mapUrl}"><div class=sub style="font-size:11px">${['F', 'R1', 'R2', 'R3'].map(z => `<b style="color:${ZONE_COLORS[z]}">■</b> ${zoneLabel(z)}`).join(' · ')} · ${THEMES.filter(t => !t.raster).map(t => `<b style="color:${t.color}">■</b> ${esc(tr(t.label))}`).join(' · ')}</div>` : ''}
<h2>${esc(tr('Sensitivity score'))}</h2><table><tr><th>${esc(tr('Criterion'))}</th><th class=r>${esc(tr('Weight'))}</th><th style="width:90px">${esc(tr('Score'))}</th><th>${esc(tr('Why'))}</th></tr>
${S.rows.map(r => `<tr><td>${esc(r.label)}</td><td class=r>${r.weight}</td><td>${r.assessed ? `<div class=bar><i style="width:${r.score * 100}%;background:${classify(r.score * 100)[1]}"></i></div>` : '–'}</td><td>${esc(r.why)}</td></tr>`).join('')}</table>
<p class=sub style="font-size:11px">${esc(tr('Classes: 0–25 Low · 25–50 Moderate · 50–75 High · 75–100 Very high. A major red flag (protected area or heritage site inside the footprint, river crossing, >1,000 people inside) raises the class to at least High.'))}</p>
<h2>${esc(tr('Results by zone'))}</h2><table><tr><th></th><th></th>${ZONES.map(z => `<th class=r>${zoneLabel(z)}</th>`).join('')}<th class=r>${esc(fmt(tr('Total (≤%s km)'), res.rings[2]))}</th></tr>
${zt.map(([l, u, v]) => `<tr><td>${esc(l)}</td><td class=sub>${u}</td>${[...ZONES, 'ALL'].map(z => `<td class=r>${fmtv(u, v && v[z])}</td>`).join('')}</tr>`).join('')}</table>
<h2>${esc(tr('Features found'))}</h2><table><tr><th>${esc(tr('Theme'))}</th><th>${esc(tr('Name'))}</th><th>${esc(tr('Type'))}</th><th>${esc(tr('Zone'))}</th><th class=r>km</th></tr>${items.join('')}</table>
<h2>${esc(tr('Data sources'))}</h2><ul style="font-size:11.5px">${res.sources.map(s => `<li>${esc(s)}</li>`).join('')}<li>Esri World Imagery (Esri, Maxar, Earthstar Geographics) – map background</li></ul>
${res.metrics.population ? `<p class=sub style="font-size:11px">${esc(fmt(tr('People are estimated from OpenStreetMap buildings × %s people per building; OSM coverage varies.'), res.metrics.population.ppb))}</p>` : ''}
<div class=warn><b>${esc(tr('Disclaimer'))}:</b> ${esc(tr(DISCLAIMER))}</div>
<div class=foot>${esc(tr('Prepared with Cambodia 3D – EIA Screening'))} · ក្រុមស្រាវជ្រាវ និងអភិវឌ្ឍន៍ព័ត៌មានភូមិសាស្ត្រ · Geoinformatics and Research Lab, RUPP</div></body></html>`;
}

export function toGeoJSON(res) {
  const F = []; res.B.forEach((b, k) => F.push({ type: 'Feature', geometry: b.geometry, properties: { layer: 'zone', zone: ZONES[k], buffer_km: k ? res.rings[k - 1] : 0 } }));
  for (const th of THEMES) for (const it of (res.items[th.key] || [])) F.push({ type: 'Feature', geometry: it.geometry, properties: { layer: th.key, name: it.name, type: it.sub, zone: it.zone, dist_km: it.dist == null ? null : +it.dist.toFixed(3), source: it.src } });
  return { type: 'FeatureCollection', name: res.name, features: F };
}

/* ---------------- 3D: zone lines draped on the ground and pins for the features inside the area ---------------- */
export function show3D(world, res) {
  hide3D(world); const grp = new THREE.Group(), F = world.F, D = world.D, inside = (x, z) => x > D.X0 && x < D.X0 + D.W && z > D.Z0 && z < D.Z0 + D.H;
  const drape = (coords, color, width) => { let pts = []; const flush = () => { if (pts.length > 1) { const g = new THREE.BufferGeometry().setFromPoints(pts), l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })); l.renderOrder = 40; grp.add(l); } pts = []; };
    for (let i = 1; i < coords.length; i++) { const a = coords[i - 1], b = coords[i], ax = F.x(a[0]), az = F.z(a[1]), bx = F.x(b[0]), bz = F.z(b[1]), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
      for (let k = 0; k <= n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; if (!inside(x, z)) { flush(); continue; } pts.push(new THREE.Vector3(x, world.groundAt(x, z) + 1.2, z)); } } flush(); void width; };
  res.B.forEach((b, k) => { for (const poly of polyRings(b.geometry)) for (const r of poly) drape(r, ZONE_COLORS[ZONES[k]]); });
  for (const th of THEMES) { if (th.geom !== 'point') continue; const col = new THREE.Color(th.color);
    for (const it of res.items[th.key] || []) { const [lon, lat] = it.geometry.coordinates, x = F.x(lon), z = F.z(lat); if (!inside(x, z)) continue; const y = world.groundAt(x, z);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 14, 8), new THREE.MeshBasicMaterial({ color: col })); pin.position.set(x, y + 7, z); grp.add(pin);
      const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), new THREE.MeshBasicMaterial({ color: col })); head.position.set(x, y + 15, z); grp.add(head); } }
  world.scene.add(grp); world.eiaGroup = grp;
}
export function hide3D(world) { if (world.eiaGroup) { world.scene.remove(world.eiaGroup); world.eiaGroup.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); world.eiaGroup = null; } }
