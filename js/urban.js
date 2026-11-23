// Urban Analytics (port of the Urban Analytics 0.2 QGIS plugin, after "Urban Analytics with Python: Advanced
// Methods", The New Science of Maps): building-level population, walking and motorbike access over the street
// network, amenity agglomerations, greenery, heat, flood exposure and persona livability – for the 3D area.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { evaluate } from './gee.js?v=104';

export const CATEGORIES = ['food', 'retail', 'education', 'health', 'finance', 'leisure', 'tourism', 'services', 'worship'];
export const CAT_ICON = { food: '🍜', retail: '🛒', education: '🏫', health: '🏥', finance: '🏦', leisure: '🎭', tourism: '🏨', services: '🏛️', worship: '🛕', transit: '🚌' };
const AMENITY = { food: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'biergarten'], retail: ['marketplace'],
  education: ['school', 'university', 'college', 'kindergarten', 'library', 'language_school', 'training', 'music_school', 'driving_school'],
  health: ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'veterinary'], finance: ['bank', 'atm', 'bureau_de_change', 'money_transfer', 'payment_centre'],
  leisure: ['cinema', 'theatre', 'nightclub', 'arts_centre', 'community_centre', 'events_venue', 'casino'],
  services: ['post_office', 'police', 'fire_station', 'townhall', 'fuel', 'courthouse', 'embassy', 'car_wash', 'car_repair', 'bicycle_repair_station'], worship: ['place_of_worship', 'monastery'] };
const LOOK = Object.fromEntries(Object.entries(AMENITY).flatMap(([k, v]) => v.map(a => [a, k])));
const SKIP_A = new Set(['parking', 'parking_space', 'parking_entrance', 'bench', 'waste_basket', 'toilets', 'drinking_water', 'bicycle_parking', 'motorcycle_parking', 'shelter', 'telephone', 'vending_machine', 'recycling', 'waste_disposal', 'fountain', 'clock', 'post_box', 'bus_station', 'ferry_terminal', 'taxi']);
const SKIP_L = new Set(['park', 'garden', 'nature_reserve', 'common', 'picnic_table', 'swimming_pool']);
export function classifyPoi(g) {
  const a = g.amenity; if (a) return SKIP_A.has(a) ? null : [LOOK[a] || 'services', a];
  if (g.healthcare) return ['health', g.healthcare]; if (g.shop) return ['retail', g.shop];
  if (g.tourism) return ['information', 'artwork', 'picnic_site'].includes(g.tourism) ? null : ['tourism', g.tourism];
  if (g.leisure) return SKIP_L.has(g.leisure) ? null : ['leisure', g.leisure]; if (g.office) return ['services', g.office]; return null;
}
export const PERSONAS = {
  'Student': { education: 5, food: 4, retail: 2, health: 1, finance: 1, leisure: 3, tourism: 0, services: 1, worship: 0, transit: 5, greenery: 2, ride: 3, cool: 2, dry: 2 },
  'Young professional': { education: 0, food: 5, retail: 3, health: 2, finance: 3, leisure: 4, tourism: 0, services: 2, worship: 0, transit: 5, greenery: 2, ride: 4, cool: 2, dry: 3 },
  'Family with children': { education: 5, food: 2, retail: 4, health: 5, finance: 2, leisure: 3, tourism: 0, services: 2, worship: 1, transit: 3, greenery: 5, ride: 4, cool: 4, dry: 5 },
  'Retiree': { education: 0, food: 2, retail: 4, health: 5, finance: 3, leisure: 2, tourism: 0, services: 2, worship: 4, transit: 3, greenery: 5, ride: 4, cool: 5, dry: 5 },
  'Tourist': { education: 0, food: 5, retail: 3, health: 1, finance: 3, leisure: 4, tourism: 5, services: 0, worship: 2, transit: 4, greenery: 2, ride: 3, cool: 3, dry: 1 } };
const MOTO = { motorway: 50, trunk: 40, primary: 32, secondary: 28, tertiary: 25, unclassified: 20, residential: 18, living_street: 12, service: 12, road: 18, track: 10, path: 8 };
const WALK_MPM = 80; // 4.8 km/h
const decay = (m, max) => m == null || !isFinite(m) ? 0 : Math.max(0, Math.min(1, 1 - m / max));

/* ---------------- data: OpenStreetMap around the area (Overpass, several mirrors) ---------------- */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function overpass(q, ms = 90000) {
  return new Promise((ok, bad) => { let next = 0, fails = 0, done = false; const ctl = [];
    const go = () => { if (done || next >= OVERPASS.length) return; const ep = OVERPASS[next++], c = new AbortController(), k = setTimeout(() => c.abort(), ms); ctl.push(c);
      fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: c.signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(j => { if (!done) { done = true; ctl.forEach(x => x !== c && x.abort()); ok(j); } }).catch(() => { if (++fails === OVERPASS.length && !done) bad(new Error('Overpass not reachable')); else go(); }).finally(() => clearTimeout(k)); };
    go(); go(); setTimeout(() => { go(); go(); }, 15000); });
}
export async function fetchOSM(F, bb) {
  const q = `${bb[1]},${bb[0]},${bb[3]},${bb[2]}`;
  const j = await overpass(`[out:json][timeout:90];way["highway"](${q});out geom tags;(nwr["amenity"](${q});nwr["shop"](${q});nwr["healthcare"](${q});nwr["tourism"](${q});nwr["office"](${q});nwr["leisure"](${q}););out center tags;(nwr["highway"="bus_stop"](${q});nwr["public_transport"~"platform|stop_position"](${q}););out center;(way["leisure"~"^(park|garden)$"](${q});way["landuse"~"^(recreation_ground|village_green)$"](${q}););out geom;`);
  const P = (lon, lat) => [F.x(lon), F.z(lat)], roads = [], pois = [], transit = [], parks = [];
  for (const e of j.elements || []) { const g = e.tags || {};
    if (e.type === 'way' && g.highway && e.geometry && !['bus_stop', 'platform', 'proposed', 'construction'].includes(g.highway)) roads.push({ pts: e.geometry.map(p => P(p.lon, p.lat)), hw: g.highway, oneway: g.oneway === 'yes' });
    else if (g.highway === 'bus_stop' || g.public_transport) { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la != null) transit.push(P(lo, la)); }
    else if ((g.leisure === 'park' || g.leisure === 'garden' || g.landuse) && e.geometry) { for (let i = 0; i < e.geometry.length; i += 3) parks.push(P(e.geometry[i].lon, e.geometry[i].lat)); }
    else { const c = classifyPoi(g), la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (c && la != null) { const [x, z] = P(lo, la); pois.push({ x, z, cat: c[0], sub: c[1], name: g['name:km'] || g.name || g['name:en'] || '' }); } } }
  return { roads, pois, transit, parks };
}

// fallback when Overpass is busy: amenities from the OSM place extract bundled with the site (0.25° cells)
export async function bundledPois(F, bb) {
  const out = [], jobs = [];
  for (let i = Math.floor((bb[0] - 102) / 0.25); i <= Math.floor((bb[2] - 102) / 0.25); i++) for (let j = Math.floor((bb[1] - 10) / 0.25); j <= Math.floor((bb[3] - 10) / 0.25); j++) jobs.push(fetch(`data/places/${i}_${j}.json`).then(r => r.ok ? r.json() : []).catch(() => []));
  for (const a of await Promise.all(jobs)) for (const [lon, lat, kind, nk, ne] of a) { if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue; const c = classifyPoi({ amenity: kind }); if (!c || ['village', 'hamlet', 'town', 'city', 'river', 'peak', 'locality', 'suburb', 'neighbourhood', 'isolated_dwelling'].includes(kind)) continue; out.push({ x: F.x(lon), z: F.z(lat), cat: c[0], sub: c[1], name: nk || ne || '' }); }
  return out;
}

/* ---------------- street network (metres) and multi-source Dijkstra ---------------- */
class Heap { constructor() { this.k = []; this.v = []; } push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
  pop() { const k = this.k, v = this.v, top = v[0], tk = k[0], lk = k.pop(), lv = v.pop(); if (k.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= k.length) break; if (c + 1 < k.length && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; } this.top = tk; return top; } get size() { return this.k.length; } }
export class Graph {
  // roads: [{pts:[[x,z]], hw, oneway}]; cost(road, metres) → cost or null (unusable)
  constructor(roads, cost) {
    const id = new Map(), X = [], Z = [], adj = []; const node = (x, z) => { const key = Math.round(x * 2) + ',' + Math.round(z * 2); let n = id.get(key); if (n == null) { n = X.length; id.set(key, n); X.push(x); Z.push(z); adj.push([]); } return n; };
    for (const r of roads) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), c = cost(r, L); if (c == null || L < 0.01) continue; const u = node(a[0], a[1]), v = node(b[0], b[1]); adj[u].push(v, c); adj[v].push(u, c); }
    this.X = X; this.Z = Z; this.adj = adj; this.cell = 50; this.grid = new Map();
    X.forEach((x, n) => { const k = Math.floor(x / 50) + ',' + Math.floor(Z[n] / 50); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(n); });
  }
  nearest(x, z, rmax = 400) { let best = -1, bd = Infinity; for (let r = 0; r <= rmax / 50 && best < 0; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { for (const n of this.grid.get((Math.floor(x / 50) + i) + ',' + (Math.floor(z / 50) + j)) || []) { const d = Math.hypot(this.X[n] - x, this.Z[n] - z); if (d < bd) { bd = d; best = n; } } } return [best, bd]; }
  // cost from the nearest of the sources to every node (snap distance × snapCost added at both ends)
  dijkstra(srcPts, snapCost, cutoff = Infinity) {
    const N = this.X.length, d = new Float64Array(N).fill(Infinity), h = new Heap();
    for (const [x, z] of srcPts) { const [n, s] = this.nearest(x, z); if (n >= 0) { const c = s * snapCost; if (c < d[n]) { d[n] = c; h.push(c, n); } } }
    while (h.size) { const u = h.pop(), du = h.top; if (du > d[u] || du > cutoff) continue; const a = this.adj[u]; for (let i = 0; i < a.length; i += 2) { const v = a[i], nd = du + a[i + 1]; if (nd < d[v]) { d[v] = nd; h.push(nd, v); } } }
    return d;
  }
}

/* ---------------- buildings of the 3D scene ---------------- */
export function buildingsOf(world) {
  const out = [], add = (ring, h, src) => { let a = 0, cx = 0, cz = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [x1, z1] = ring[j], [x2, z2] = ring[i], f = x1 * z2 - x2 * z1; a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f; }
    a /= 2; if (Math.abs(a) < 4) return; out.push({ ring, x: cx / (6 * a), z: cz / (6 * a), area: Math.abs(a), h, src }); };
  for (const b of world.D.buildings || []) add(b.ring.map(p => Array.isArray(p) ? p : [p.x, p.z]), b.hdm ? b.hdm / 10 : (b.lv ? b.lv * 3.2 : 6), 'OSM');
  for (const b of world.housesList || []) add(b.ring.map(p => Array.isArray(p) ? p : [p.x, p.z]), b.h || 5, 'image');
  return out;
}

/* ---------------- Earth Engine: population, greenery, heat, water and flood at every building ---------------- */
export async function sampleEE(B, F, region, log) {
  const now = new Date(), y = now.getUTCFullYear();
  const pop = ee.ImageCollection('WorldPop/GP/100m/pop').filter(ee.Filter.eq('country', 'KHM')).filter(ee.Filter.eq('year', 2020)).mosaic().rename('pop');
  const ll = ee.Image.pixelLonLat(), pix = ll.select('longitude').multiply(1200).floor().rename('pi').addBands(ll.select('latitude').multiply(1200).floor().rename('pj'));
  const cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  const ndvi = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region).filterDate(`${y - 1}-01-01`, now.toISOString().slice(0, 10)).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60)).linkCollection(cs, ['cs_cdf'])
    .map(i => i.normalizedDifference(['B8', 'B4']).rename('ndvi').updateMask(i.select('cs_cdf').gte(0.6))).median();
  const lstCol = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(region).filterDate(`${y - 3}-01-01`, now.toISOString().slice(0, 10)).filter(ee.Filter.calendarRange(3, 5, 'month'))
    .map(i => i.select('ST_B10').multiply(0.00341802).add(149 - 273.15).rename('lst').updateMask(i.select('QA_PIXEL').bitwiseAnd(1 << 3 | 1 << 4 | 1 << 1).eq(0)));
  const lst = lstCol.median();
  const jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0).focalMax(60, 'circle', 'meters').rename('jrc');
  const s1 = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(region).filter(ee.Filter.eq('instrumentMode', 'IW')).filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filterDate(`${y - 3}-01-01`, now.toISOString().slice(0, 10)).filter(ee.Filter.calendarRange(8, 10, 'month')).select('VV').map(i => i.focalMedian(30, 'circle', 'meters').lt(-16).rename('s1w')).mean().unmask(0);
  const dem = ee.ImageCollection('COPERNICUS/DEM/GLO30').filterBounds(region).select('DEM').mosaic().setDefaultProjection('EPSG:4326', null, 30);
  const hand = dem.subtract(dem.focalMin(1500, 'circle', 'meters')).rename('hand');
  const img = pop.addBands(pix).addBands(ndvi.focalMean(100, 'circle', 'meters').rename('ndvi')).addBands(lst.focalMean(60, 'circle', 'meters').rename('lst')).addBands(jrc).addBands(s1.rename('s1w')).addBands(hand);
  const out = new Array(B.length), CH = 2500;
  for (let s = 0; s < B.length; s += CH) {
    const fc = ee.FeatureCollection(B.slice(s, s + CH).map((b, k) => ee.Feature(ee.Geometry.Point([F.lon(b.x), F.lat(b.z)]), { i: s + k })));
    const r = await evaluate(img.reduceRegions({ collection: fc, reducer: ee.Reducer.first(), scale: 30, tileScale: 4 }));
    for (const f of r.features) out[f.properties.i] = f.properties; log && log(Math.min(B.length, s + CH));
  }
  // vegetated reference temperature (NDVI > 0.55) for the heat island, and the people in the whole window
  const ref = await evaluate(ee.Dictionary({ veg: lst.updateMask(ndvi.gt(0.55)).reduceRegion({ reducer: ee.Reducer.median(), geometry: region, scale: 30, maxPixels: 1e9, bestEffort: true }).get('lst'),
    popAll: pop.reduceRegion({ reducer: ee.Reducer.sum(), geometry: region, scale: 100, maxPixels: 1e9 }).get('pop'), nLst: lstCol.size() }));
  return { s: out, ref };
}

/* ---------------- the analysis ---------------- */
// DBSCAN agglomerations of amenities (grid neighbour search)
export function dbscan(pts, eps, minPts) {
  const n = pts.length, lab = new Int32Array(n).fill(-2), g = new Map(), key = (x, z) => Math.floor(x / eps) + ',' + Math.floor(z / eps);
  pts.forEach((p, i) => { const k = key(p.x, p.z); if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
  const nb = i => { const p = pts[i], cx = Math.floor(p.x / eps), cz = Math.floor(p.z / eps), o = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of g.get((cx + a) + ',' + (cz + b)) || []) if (Math.hypot(pts[j].x - p.x, pts[j].z - p.z) <= eps) o.push(j); return o; };
  let c = 0; for (let i = 0; i < n; i++) { if (lab[i] !== -2) continue; const N = nb(i); if (N.length < minPts) { lab[i] = -1; continue; } lab[i] = c; const q = [...N];
    while (q.length) { const j = q.pop(); if (lab[j] === -1) lab[j] = c; if (lab[j] !== -2) continue; lab[j] = c; const M = nb(j); if (M.length >= minPts) q.push(...M); } c++; }
  const out = []; for (let k = 0; k < c; k++) { const m = pts.filter((_, i) => lab[i] === k), cnt = {}; m.forEach(p => cnt[p.cat] = (cnt[p.cat] || 0) + 1); const dom = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    out.push({ id: k, n: m.length, x: m.reduce((s, p) => s + p.x, 0) / m.length, z: m.reduce((s, p) => s + p.z, 0) / m.length, dominant: dom[0], share: dom[1] / m.length, mix: cnt }); }
  return out.sort((a, b) => b.n - a.n);
}
export function analyse(B, osm, ee_, o) {
  const walkG = new Graph(osm.roads, (r, L) => ['motorway', 'trunk', 'motorway_link', 'trunk_link'].includes(r.hw) ? null : L / WALK_MPM);
  const motoG = new Graph(osm.roads, (r, L) => { const hw = String(r.hw || 'residential'), base = hw.replace(/_link$/, ''), v = MOTO[base]; return v ? L / (v * 1000 / 60 * (hw.endsWith('_link') ? 0.8 : 1)) * (o.congestion || 1.3) : null; });
  const minutes = (G, pts, snap, cut) => { if (!pts.length) return B.map(() => null); const d = G.dijkstra(pts, snap, cut); return B.map(b => { const [n, s] = G.nearest(b.x, b.z); const v = n >= 0 ? d[n] + s * snap : Infinity; return isFinite(v) ? v : null; }); };
  const byCat = {}; for (const c of CATEGORIES) byCat[c] = osm.pois.filter(p => p.cat === c).map(p => [p.x, p.z]);
  const W = {}, max = o.walkMax || 15; for (const c of CATEGORIES) W[c] = minutes(walkG, byCat[c], 1 / WALK_MPM, max * 4);
  W.transit = minutes(walkG, osm.transit, 1 / WALK_MPM, max * 4);
  const hosp = osm.pois.filter(p => p.cat === 'health' && ['hospital', 'clinic'].includes(p.sub)).map(p => [p.x, p.z]), clusters = dbscan(osm.pois, o.eps || 150, o.minPts || 5);
  const centre = clusters[0] ? [[clusters[0].x, clusters[0].z]] : osm.pois.filter(p => p.sub === 'marketplace').map(p => [p.x, p.z]);
  const rideHosp = minutes(motoG, hosp, 1 / WALK_MPM, 120), rideCentre = minutes(motoG, centre, 1 / WALK_MPM, 120);
  const parkD = B.map(b => { let d = Infinity; for (const [x, z] of osm.parks) { const e = Math.hypot(x - b.x, z - b.z); if (e < d) d = e; } return isFinite(d) ? d : null; });
  // population: share each WorldPop pixel among its buildings by floor area
  const pop = new Float64Array(B.length); let lost = null;
  if (ee_) { const grp = new Map(); B.forEach((b, i) => { const s = ee_.s[i]; if (!s || s.pop == null) return; const k = s.pi + ',' + s.pj; if (!grp.has(k)) grp.set(k, { p: s.pop, idx: [], w: 0 }); const g = grp.get(k), wt = b.area * Math.max(1, b.h / 3.2); g.idx.push([i, wt]); g.w += wt; });
    let got = 0; for (const g of grp.values()) for (const [i, wt] of g.idx) { pop[i] = g.p * wt / g.w; got += pop[i]; } lost = ee_.ref.popAll != null ? Math.max(0, ee_.ref.popAll - got) : null; }
  else B.forEach((b, i) => pop[i] = (o.ppb || 4.3) * (b.src === 'OSM' || b.area > 25 ? 1 : 0.7)); // no Earth Engine: people per building
  const S = i => ee_ && ee_.s[i] || {}, lsts = B.map((_, i) => S(i).lst).filter(v => v != null).sort((a, b) => a - b), q = p => lsts.length ? lsts[Math.min(lsts.length - 1, Math.floor(p * lsts.length))] : null;
  const lo = q(0.02), hi = q(0.98), refT = ee_ && ee_.ref.veg != null ? ee_.ref.veg : q(0.1);
  const res = B.map((b, i) => {
    const s = S(i), r = { i, pop: pop[i], walk: {}, ride_hosp: rideHosp[i], ride_centre: rideCentre[i], park_m: parkD[i] };
    for (const k of [...CATEGORIES, 'transit']) r.walk[k] = W[k][i];
    r.n_reach = CATEGORIES.filter(c => r.walk[c] != null && r.walk[c] <= max).length;
    r.walkScore = 100 * CATEGORIES.reduce((a, c) => a + decay(r.walk[c], max), 0) / CATEGORIES.length;
    const ps = r.park_m == null ? null : Math.max(0, 1 - r.park_m / 500), ns = s.ndvi == null ? null : Math.max(0, Math.min(1, (s.ndvi - 0.1) / 0.5));
    r.ndvi = s.ndvi; r.green = ps == null && ns == null ? null : 100 * (ps == null ? ns : ns == null ? ps : 0.5 * ps + 0.5 * ns);
    r.lst = s.lst; r.heat = s.lst == null || hi == null || hi <= lo ? null : 100 * Math.max(0, Math.min(1, (s.lst - lo) / (hi - lo))); r.uhi = s.lst != null && refT != null ? s.lst - refT : null;
    r.hand = s.hand; r.jrc = s.jrc; r.s1w = s.s1w;
    r.flood = s.hand == null && s.s1w == null ? null : 100 * (0.4 * Math.min(1, (s.s1w || 0) * 2.5) + 0.3 * Math.min(1, (s.jrc || 0) / 50) + 0.3 * Math.max(0, 1 - (s.hand ?? 20) / 8));
    r.floodCls = r.flood == null ? null : r.flood >= 60 ? 'high' : r.flood >= 35 ? 'medium' : 'low';
    r.rideScore = (decay(r.ride_hosp, 20) + decay(r.ride_centre, 30)) / 2;
    return r;
  });
  return { res, clusters, centre, hosp, lost, refT, walkMax: max, nRoads: osm.roads.length };
}
export function livability(R, weights) {
  return R.res.map(r => { const comp = { greenery: r.green == null ? null : r.green / 100, transit: decay(r.walk.transit, R.walkMax), ride: r.rideScore, cool: r.heat == null ? null : 1 - r.heat / 100, dry: r.flood == null ? null : 1 - r.flood / 100 };
    for (const c of CATEGORIES) comp[c] = decay(r.walk[c], R.walkMax); let n = 0, d = 0; for (const [k, w] of Object.entries(weights)) { if (!w || comp[k] == null) continue; n += w * comp[k]; d += w; } return d ? 100 * n / d : null; });
}

/* ---------------- 3D: buildings coloured by the chosen measure ---------------- */
const RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
export const rampColor = t => { t = Math.max(0, Math.min(1, t)); const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i, a = RAMP[i], b = RAMP[i + 1]; return a.map((v, k) => Math.round(v + (b[k] - v) * f)); };
export function paint(world, B, vals, lo, hi, invert) {
  unpaint(world, true); const geos = [], col = new THREE.Color();
  B.forEach((b, i) => { const v = vals[i]; const sh = new THREE.Shape(b.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    let g; try { g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(3, b.h), bevelEnabled: false }); } catch (e) { return; } g.rotateX(-Math.PI / 2); g.translate(0, world.groundAt(b.x, b.z) - 0.2, 0);
    if (v == null) col.setRGB(0.55, 0.57, 0.6); else { let t = hi > lo ? (v - lo) / (hi - lo) : 0.5; if (invert) t = 1 - t; const [r, gg, bb] = rampColor(t); col.setRGB(r / 255, gg / 255, bb / 255).convertSRGBToLinear(); }
    const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.set([col.r, col.g, col.b], k * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); geos.push(g); });
  if (!geos.length) return; const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true })); geos.forEach(g => g.dispose());
  m.castShadow = m.receiveShadow = true; world.scene.add(m); world.uaMesh = m;
  if (!world._uaHidden) world._uaHidden = [world.buildingsMesh, world.housesMesh].filter(x => x && x.visible); world._uaHidden.forEach(x => x.visible = false);
}
export function unpaint(world, keepHidden) { if (world.uaMesh) { world.scene.remove(world.uaMesh); world.uaMesh.geometry.dispose(); world.uaMesh.material.dispose(); world.uaMesh = null; } if (!keepHidden && world._uaHidden) { world._uaHidden.forEach(x => x.visible = true); world._uaHidden = null; } }
