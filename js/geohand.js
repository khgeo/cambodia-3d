// Geography in hand: one tap answers a geography question about a place, with all the GIS steps done in the background.
// 1 Place profile · 2 Time machine · 3 What if (flood, heavy rain) · 4 Where does the rain go · 5 Access to services
// 6 Worksheet maker · 7 Field trip (GPS, stops, observations)
import * as THREE from 'three';
import { t, lang } from './i18n.js?v=110';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const km = () => lang === 'km';
const U = u => km() ? ({ m: 'ម', km: 'គ.ម', ha: 'ហ.ត', mm: 'ម.ម' })[u] || u : u;
const NUMKM = '០១២៣៤៥៦៧៨៩';
const n0 = (v, d = 0) => { if (v == null || !isFinite(v)) return '–'; const s = Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); return km() ? s.replace(/\d/g, c => NUMKM[c]) : s; };
const LC = { 1: ['Water', 'ទឹក', '#3b8fd9'], 2: ['Trees', 'ដើមឈើ', '#2f7d3a'], 3: ['Rice fields & grass', 'ស្រែ និងវាលស្មៅ', '#d8c24a'], 4: ['Bare soil', 'ដីទទេ', '#b98a5a'], 5: ['Houses & roads', 'ផ្ទះ និងផ្លូវ', '#c4413a'] };
const LANDFORMS = { 1: ['Water body', 'ផ្ទៃទឹក', '#3b8fd9'], 2: ['Channel / depression', 'ប្រឡាយ / ទីទាប', '#5fb3c9'], 3: ['Floodplain', 'វាលទំនាបលិចទឹក', '#9fd39a'], 4: ['Low terrace / plain', 'រាបទាប / វាលទំនាប', '#e4dc8c'], 5: ['High terrace / plateau', 'រាបខ្ពស់ / ខ្ពង់រាប', '#e0b46a'], 6: ['Slope / foothill', 'ជម្រាល / ជើងភ្នំ', '#c98552'], 7: ['Hill / ridge', 'ភ្នំ / ខ្នងភ្នំ', '#8f5a43'], 8: ['Isolated rise / mound', 'ទួល', '#d06fa0'] };
const SETTLE = { linear: ['Linear (along a road)', 'តាមបណ្ដោយផ្លូវ', '#e8742c'], riverbank: ['Linear (along water)', 'តាមបណ្ដោយទឹក', '#2b8fd8'], clustered: ['Clustered (nucleated)', 'ប្រមូលផ្ដុំ', '#c43b3b'], dispersed: ['Dispersed (scattered)', 'រាយប៉ាយ', '#8a5fc0'] };
const convexHull = P => { const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
const ringA = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
export { LANDFORMS, SETTLE };
function dbscanLabels(P, eps, minPts) { // P: [{x, z}] → cluster label per point (-1 noise)
  const n = P.length, lab = new Int32Array(n).fill(-2), g = new Map(), key = (i, j) => i + ',' + j;
  P.forEach((p, i) => { const k = key(Math.floor(p.x / eps), Math.floor(p.z / eps)); (g.get(k) || g.set(k, []).get(k)).push(i); });
  const nb = i => { const p = P[i], ci = Math.floor(p.x / eps), cj = Math.floor(p.z / eps), o = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of g.get(key(ci + a, cj + b)) || []) if (Math.hypot(P[j].x - p.x, P[j].z - p.z) <= eps) o.push(j); return o; };
  let c = 0; for (let i = 0; i < n; i++) { if (lab[i] !== -2) continue; const N = nb(i); if (N.length < minPts) { lab[i] = -1; continue; } lab[i] = c; const q = [...N];
    while (q.length) { const j = q.pop(); if (lab[j] === -1) lab[j] = c; if (lab[j] !== -2) continue; lab[j] = c; const M = nb(j); if (M.length >= minPts) q.push(...M); } c++; }
  return lab; }
const lcName = k => LC[k] ? (km() ? LC[k][1] : LC[k][0]) : '';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MONTHS_KM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const month = i => km() ? MONTHS_KM[i] : MONTHS[i];
const DIRS = [['north', 'ខាងជើង'], ['north-east', 'ឦសាន'], ['east', 'ខាងកើត'], ['south-east', 'អាគ្នេយ៍'], ['south', 'ខាងត្បូង'], ['south-west', 'នីរតី'], ['west', 'ខាងលិច'], ['north-west', 'ពាយ័ព្យ']];
const dirName = (dx, dz) => { const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360 + 22.5) % 360; const d = DIRS[Math.floor(a / 45) % 8]; return km() ? d[1] : d[0]; };

function label(text, color = '#fff', bg = 'rgba(10,20,30,.82)') {
  const plain = !/[A-Za-z0-9\u1780-\u17ff]/.test(text); if (plain) bg = null; // an emoji alone (📍 💧) needs no box
  const c = document.createElement('canvas'), g = c.getContext('2d'), f = `bold ${plain ? 44 : 30}px system-ui, "Noto Sans Khmer", sans-serif`; g.font = f;
  const w = Math.ceil(g.measureText(text).width) + (plain ? 8 : 28), h = plain ? 56 : 46; c.width = w; c.height = h; g.font = f;
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, 12); g.fill(); } g.fillStyle = color; g.textBaseline = 'middle'; if (plain) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6; } g.fillText(text, plain ? 4 : 14, h / 2 + 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, sizeAttenuation: false })); s.center.set(0.5, 0); const k = plain ? 0.0008 : 0.0005; s.scale.set(k * w, k * h, 1); s.renderOrder = 40; return s;
}
const short = (s, n = 26) => { const a = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(s)].map(x => x.segment) : Array.from(s); return a.length > n ? a.slice(0, n).join('') + '…' : s; };

/* ================= terrain hydrology: depression filling, flow directions, flow accumulation ================= */
function hydrology(D) {
  const NX = D.nx + 1, NZ = D.nz + 1, N = NX * NZ, z = D.raw, fz = new Float32Array(N), closed = new Uint8Array(N);
  const hk = [], hv = []; const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  const pop = () => { const top = hv[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hk.length) break; if (c + 1 < hk.length && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; } return top; };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) if (i === 0 || j === 0 || i === NX - 1 || j === NZ - 1) { const k = j * NX + i; fz[k] = z[k]; closed[k] = 1; push(z[k], k); }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (hk.length) { const c = pop(), ci = c % NX, cj = (c / NX) | 0;
    for (const [a, b] of NB) { const i = ci + a, j = cj + b; if (i < 0 || j < 0 || i >= NX || j >= NZ) continue; const k = j * NX + i; if (closed[k]) continue; closed[k] = 1; fz[k] = Math.max(z[k], fz[c] + 1e-4); push(fz[k], k); } }
  const dir = new Int32Array(N).fill(-1), dx = D.dx, dzz = D.dz;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (i === 0 || j === 0 || i === NX - 1 || j === NZ - 1) continue; let best = 0, bk = -1;
    for (const [a, b] of NB) { const kk = (j + b) * NX + i + a, s = (fz[k] - fz[kk]) / Math.hypot(a * dx, b * dzz); if (s > best) { best = s; bk = kk; } } dir[k] = bk; }
  const indeg = new Int32Array(N); for (let k = 0; k < N; k++) if (dir[k] >= 0) indeg[dir[k]]++;
  const acc = new Float32Array(N).fill(1), q = []; for (let k = 0; k < N; k++) if (!indeg[k]) q.push(k);
  for (let h = 0; h < q.length; h++) { const k = q[h], d = dir[k]; if (d < 0) continue; acc[d] += acc[k]; if (--indeg[d] === 0) q.push(d); }
  return { NX, NZ, N, fz, dir, acc, cellA: dx * dzz };
}

export class GeoHand {
  constructor(world, opts = {}) {
    this.w = world; this.say = opts.say || (() => { }); this.g = new THREE.Group(); this.tab = 'profile'; this.data = {}; this.trip = this.loadTrip();
  }
  get D() { return this.w.D; } get F() { return this.w.F; } get LFN() { return LANDFORMS; } get SETN() { return SETTLE; }
  /* ---------- helpers ---------- */
  rawAt(x, z) { const D = this.D, fi = THREE.MathUtils.clamp((x - D.X0) / D.dx, 0, D.nx), fj = THREE.MathUtils.clamp((z - D.Z0) / D.dz, 0, D.nz), i = Math.min(D.nx - 1, Math.floor(fi)), j = Math.min(D.nz - 1, Math.floor(fj)), u = fi - i, v = fj - j, R = D.nx + 1, r = D.raw;
    return (r[j * R + i] * (1 - u) + r[j * R + i + 1] * u) * (1 - v) + (r[(j + 1) * R + i] * (1 - u) + r[(j + 1) * R + i + 1] * u) * v; }
  clsAt(x, z) { const D = this.D, i = Math.min(D.gw - 1, Math.max(0, ((x - D.X0) / D.C) | 0)), j = Math.min(D.gh - 1, Math.max(0, ((z - D.Z0) / D.C) | 0)); return D.cls[j * D.gw + i]; }
  inside(x, z) { const D = this.D; return x > D.X0 && z > D.Z0 && x < D.X0 + D.W && z < D.Z0 + D.H; }
  clear() { this.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); this.g.clear(); if (this.g.parent) this.g.parent.remove(this.g);
    if (this.w._ghOverlay) { this.w.setCompare(null); this.w._ghOverlay = false; } this.w.floodAt = null; if (this.UM) this.UM.unpaint(this.w); if (this.anim) { cancelAnimationFrame(this.anim); this.anim = 0; } }
  add(o) { if (!this.g.parent) this.w.root.add(this.g); this.g.add(o); return o; }
  // a raster over the ground: grid canvas covering the 3D area (or a lon/lat box) drawn over the satellite image
  overlay(cv, box) { const D = this.D, F = this.F, W = D.img.width, H = D.img.height, full = document.createElement('canvas'); full.width = W; full.height = H; const g = full.getContext('2d');
    const b = box || { w: F.lon(D.X0), e: F.lon(D.X0 + D.W), n: F.lat(D.Z0), s: F.lat(D.Z0 + D.H) }, x0 = D.pxX(b.w), x1 = D.pxX(b.e), y0 = D.pxY(b.n), y1 = D.pxY(b.s);
    g.imageSmoothingEnabled = !!(box && box.smooth); g.drawImage(cv, x0, y0, x1 - x0, y1 - y0); this.w.setCompare({ mode: 'changes', diff: full }); this.w._ghOverlay = true; }
  gridCanvas(fill) { const D = this.D, NX = D.nx + 1, NZ = D.nz + 1, c = document.createElement('canvas'); c.width = NX; c.height = NZ; const g = c.getContext('2d'), im = g.createImageData(NX, NZ);
    for (let k = 0; k < NX * NZ; k++) { const col = fill(k); if (col) im.data.set(col, k * 4); } g.putImageData(im, 0, 0); return c; }
  ribbon(pts, color, width, lift = 0.8, op = 0.95) { const pos = [], idx = []; const P = pts.map(([x, z]) => [x, this.w.hAt(x, z) + lift, z]);
    P.forEach((p, k) => { const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], tx = b[0] - a[0], tz = b[2] - a[2], l = Math.hypot(tx, tz) || 1, nx = -tz / l * width / 2, nz = tx / l * width / 2;
      pos.push(p[0] + nx, p[1], p[2] + nz, p[0] - nx, p[1], p[2] - nz); if (k) { const v = k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, side: THREE.DoubleSide, depthTest: false })); m.renderOrder = 31; return this.add(m); }
  pin(x, z, text, color = '#ffd23f', hgt = 12) { const y = this.w.hAt(x, z); const s = this.add(label(text, color)); s.position.set(x, y + hgt, z);
    const st = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, hgt, 6).translate(0, hgt / 2, 0), new THREE.MeshBasicMaterial({ color, depthTest: false }))); st.position.set(x, y, z); st.renderOrder = 39;
    const rg = this.add(new THREE.Mesh(new THREE.RingGeometry(1.4, 2.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide }))); rg.position.set(x, y + 0.4, z); rg.renderOrder = 39; return s; }
  hydro() { const D = this.D; if (!this.H || this.H.D !== D) { this.H = hydrology(D); this.H.D = D; } return this.H; }

  /* ================= 1. Place profile ================= */
  async profile(x, z) {
    const D = this.D, F = this.F, lon = F.lon(x), lat = F.lat(z), P = { x, z, lon, lat };
    P.elev = this.rawAt(x, z); const e = 15, gx = (this.rawAt(x + e, z) - this.rawAt(x - e, z)) / (2 * e), gz = (this.rawAt(x, z + e) - this.rawAt(x, z - e)) / (2 * e);
    P.slope = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
    let lo = Infinity, hi = -Infinity, cnt = {}, tot = 0; for (let a = -500; a <= 500; a += 12) for (let b = -500; b <= 500; b += 12) { if (a * a + b * b > 250000 || !this.inside(x + a, z + b)) continue; const h = this.rawAt(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); const k = this.clsAt(x + a, z + b); if (k) { cnt[k] = (cnt[k] || 0) + 1; tot++; } }
    P.relief = hi - lo; P.lc = Object.entries(cnt).map(([k, n]) => [+k, n / tot * 100]).sort((a, b) => b[1] - a[1]);
    P.here = this.clsAt(x, z);
    const B = (this.w.D.buildings || []).length + (this.w.housesList || []).length; void B;
    let houses = 0; for (const L of [this.D.buildings || [], this.w.housesList || []]) for (const b of L) { const c = b.ring[0]; if (Math.hypot(c[0] - x, c[1] - z) < 1000) houses++; }
    P.houses = houses; P.people = Math.round(houses * 4.3 / 10) * 10;
    // rain: where does a drop falling here go?
    const H = this.hydro(), path = this.flowPath(x, z); P.flow = path.info;
    // in parallel: admin names, soil & geology, climate, villages and services nearby
    const [adm, U, clim, near] = await Promise.all([
      import('./placeinfo.js?v=110').then(m => m.adminAt(lat, lon)).catch(() => null),
      this.underground().catch(() => null), // rock from the bundled map at once; soil (SoilGrids, can be slow) when it comes
      this.climate(lat, lon), this.nearby(lon, lat)]);
    P.adm = adm; P.clim = clim; P.near = near;
    if (U && this.SM) { const gk = this.SM.geologyAt(U, lon, lat), gu = this.SM.UNITS[gk]; P.geo = gu ? gu.n : null; const s = this.SM.soilAt(U, lon, lat, 0); P.soil = s.cls !== 'No data' ? s : null; }
    void H; this.data.profile = P; return P;
  }
  async underground() {
    if (this.U && this.U.soilOk) return this.U; const m = this.SM || (this.SM = await import('./section.js?v=110'));
    if (!this.Ug) this.Ug = await m.loadUnderground(this.w, null, { noSoil: true });
    if (!this.soilJob) this.soilJob = m.loadUnderground(this.w, s => this.say(t(s))).then(U => { this.U = U; return U; }).catch(() => null);
    const U = await Promise.race([this.soilJob, new Promise(r => setTimeout(() => r(null), 20000))]); return U || this.Ug;
  }
  async climate(lat, lon) {
    const key = lat.toFixed(2) + ',' + lon.toFixed(2); this._clim = this._clim || {}; if (this._clim[key]) return this._clim[key];
    try { const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=Asia%2FBangkok`;
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000), j = await (await fetch(url, { signal: ctl.signal })).json(); clearTimeout(to);
      const T = Array(12).fill(0), Tn = Array(12).fill(0), R = Array(12).fill(0); const yrs = new Set();
      j.daily.time.forEach((d, i) => { const m = +d.slice(5, 7) - 1, tt = j.daily.temperature_2m_mean[i], r = j.daily.precipitation_sum[i]; yrs.add(d.slice(0, 4)); if (tt != null) { T[m] += tt; Tn[m]++; } if (r != null) R[m] += r; });
      const ny = yrs.size, c = { T: T.map((v, m) => v / (Tn[m] || 1)), R: R.map(v => v / ny), src: 'Open-Meteo ERA5 2015–2024' }; c.year = c.R.reduce((a, b) => a + b, 0);
      c.wet = c.R.map((r, m) => [r, m]).filter(([r]) => r >= 100).map(([, m]) => m); return (this._clim[key] = c);
    } catch (e) { console.warn('climate', e); return null; }
  }
  async nearby(lon, lat) {
    const pad = 0.04, out = [], jobs = [];
    for (let i = Math.floor((lon - pad - 102) / 0.25); i <= Math.floor((lon + pad - 102) / 0.25); i++) for (let j = Math.floor((lat - pad - 10) / 0.25); j <= Math.floor((lat + pad - 10) / 0.25); j++) jobs.push(fetch(`data/places/${i}_${j}.json`).then(r => r.ok ? r.json() : []).catch(() => []));
    for (const a of await Promise.all(jobs)) for (const p of a) { const d = Math.hypot((p[0] - lon) * 109000, (p[1] - lat) * 110600); if (d < 4500) out.push({ kind: p[2], nk: p[3], ne: p[4], d }); }
    const by = k => out.filter(o => k.includes(o.kind)).sort((a, b) => a.d - b.d);
    return { villages: by(['village', 'hamlet', 'town', 'city', 'neighbourhood']).filter(o => !/district|province|commune|ស្រុក|ខេត្ត|ឃុំ/i.test((o.ne || '') + (o.nk || ''))), schools: by(['school', 'kindergarten', 'college', 'university']), health: by(['hospital', 'clinic', 'doctors', 'health_post']), wats: by(['place_of_worship']), markets: by(['marketplace']) };
  }
  profileText(P) {
    const nm = o => o ? (km() ? (o.nk || o.ne) : (o.ne || o.nk)) : '', A = P.adm, L = [];
    const flat = P.slope < 2 ? ['flat land', 'ដីរាបស្មើ'] : P.slope < 8 ? ['gently sloping land', 'ដីជម្រាលតិច'] : P.slope < 20 ? ['a hillside', 'ជម្រាលភ្នំ'] : ['a steep slope', 'ជម្រាលចោត'];
    const where = A ? (km() ? `${A.com_km || A.com_en} ស្រុក ${A.dis_km || A.dis_en} ខេត្ត ${A.pro_km || A.pro_en}` : `${A.com_en} commune, ${A.dis_en} district, ${A.pro_en} province`) : '';
    const v = P.near && P.near.villages[0];
    if (km()) {
      L.push(`ទីតាំងនេះស្ថិតនៅកម្ពស់ ${n0(P.elev)} ម៉ែត្រពីនីវ៉ូទឹកសមុទ្រ លើ${flat[1]} (ជម្រាល ${n0(P.slope, 1)}°)${where ? ' ក្នុងឃុំ ' + where : ''}។`);
      if (v) L.push(`ភូមិជិតបំផុតគឺ ${nm(v)} (${n0(v.d / 1000, 1)} គ.ម)។`);
      if (P.lc.length) L.push(`ក្នុងរង្វង់ ៥០០ ម៉ែត្រ ដីភាគច្រើនជា${lcName(P.lc[0][0])} (${n0(P.lc[0][1])}%)${P.lc[1] ? ' បន្ទាប់មក' + lcName(P.lc[1][0]) + ' (' + n0(P.lc[1][1]) + '%)' : ''}។ មានផ្ទះប្រហែល ${n0(P.houses)} ក្នុងរង្វង់ ១ គ.ម (ប្រជាជនប្រហែល ${n0(P.people)} នាក់)។`);
      if (P.soil || P.geo) L.push(`${P.soil ? 'ដីខាងលើជាប្រភេទ ' + t(P.soil.cls) + '។ ' : ''}${P.geo ? 'ថ្មខាងក្រោម៖ ' + t(P.geo) + '។' : ''}`);
      if (P.clim) L.push(`អាកាសធាតុក្ដៅពេញមួយឆ្នាំ (${n0(Math.min(...P.clim.T))}–${n0(Math.max(...P.clim.T))} °C)។ ទឹកភ្លៀងប្រហែល ${n0(P.clim.year)} ម.ម ក្នុងមួយឆ្នាំ${P.clim.wet.length ? ' ភាគច្រើនពីខែ' + month(P.clim.wet[0]) + ' ដល់ខែ' + month(P.clim.wet[P.clim.wet.length - 1]) : ''}។`);
      if (P.flow) L.push(`ទឹកភ្លៀងដែលធ្លាក់នៅទីនេះហូរ ${n0(P.flow.len)} ម៉ែត្រ ទៅទិស${this.dirOf(P.flow)} ${P.flow.end === 'edge' ? 'ចេញពីតំបន់' : 'ទៅកាន់ទីទាប ឬត្រពាំង'} (ចុះ ${n0(P.flow.drop, 1)} ម៉ែត្រ)។`);
    } else {
      L.push(`This place is ${n0(P.elev)} m above sea level on ${flat[0]} (slope ${n0(P.slope, 1)}°)${where ? ', in ' + where : ''}.`);
      if (v) L.push(`The nearest village is ${nm(v)} (${n0(v.d / 1000, 1)} km).`);
      if (P.lc.length) L.push(`Within 500 m the land is mostly ${lcName(P.lc[0][0]).toLowerCase()} (${n0(P.lc[0][1])}%)${P.lc[1] ? ', then ' + lcName(P.lc[1][0]).toLowerCase() + ' (' + n0(P.lc[1][1]) + '%)' : ''}. About ${n0(P.houses)} houses stand within 1 km (roughly ${n0(P.people)} people).`);
      if (P.soil || P.geo) L.push(`${P.soil ? 'The topsoil is ' + P.soil.cls.toLowerCase() + '. ' : ''}${P.geo ? 'The rock below is ' + P.geo.toLowerCase() + '.' : ''}`);
      if (P.clim) L.push(`It is hot all year (${n0(Math.min(...P.clim.T))}–${n0(Math.max(...P.clim.T))} °C monthly mean) with about ${n0(P.clim.year)} mm of rain a year${P.clim.wet.length ? ', mostly from ' + month(P.clim.wet[0]) + ' to ' + month(P.clim.wet[P.clim.wet.length - 1]) : ''}.`);
      if (P.flow) L.push(`Rain falling here runs ${n0(P.flow.len)} m to the ${this.dirOf(P.flow)} ${P.flow.end === 'edge' ? 'and leaves the area' : 'into a low spot or pond'} (${n0(P.flow.drop, 1)} m lower).`);
    }
    return L;
  }
  climateChart(c, W = 520, Hh = 200) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const g = cv.getContext('2d'), mx = Math.max(300, ...c.R), pad = 30, bw = (W - 2 * pad) / 12;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); g.font = '12px system-ui, "Noto Sans Khmer"'; g.fillStyle = '#333';
    c.R.forEach((r, m) => { const h = r / mx * (Hh - 50); g.fillStyle = '#4a90d9'; g.fillRect(pad + m * bw + 3, Hh - 22 - h, bw - 6, h); g.fillStyle = '#333'; g.fillText(month(m).slice(0, km() ? 6 : 3), pad + m * bw + 2, Hh - 6); });
    const tmin = 20, tmax = 34, ty = v => Hh - 22 - (v - tmin) / (tmax - tmin) * (Hh - 50); g.strokeStyle = '#d9472b'; g.lineWidth = 3; g.beginPath(); c.T.forEach((v, m) => { const x = pad + m * bw + bw / 2; m ? g.lineTo(x, ty(v)) : g.moveTo(x, ty(v)); }); g.stroke();
    g.fillStyle = '#4a90d9'; g.fillText((km() ? 'ទឹកភ្លៀង ម.ម' : 'Rain mm') + ` (max ${Math.round(mx)})`, pad, 14); g.fillStyle = '#d9472b'; g.fillText(km() ? 'សីតុណ្ហភាព °C (២០–៣៤)' : 'Temperature °C (20–34)', W / 2, 14);
    return cv;
  }
  profileHTML(P) {
    const row = (k, v) => v ? `<tr><td>${t(k)}</td><td>${v}</td></tr>` : '', nm = o => o ? (esc(km() ? (o.nk || o.ne) : (o.ne || o.nk)) || (km() ? 'មិនមានឈ្មោះ' : 'name not mapped')) + ` <small>${n0(o.d / 1000, 1)} ${U('km')}</small>` : '';
    const A = P.adm, N = P.near || {};
    return `<div class="ghText">${this.profileText(P).map(esc).join(' ')}</div>
      <table class="ghTab">${row('Province / district / commune', A ? esc(km() ? `${A.pro_km || A.pro_en} / ${A.dis_km || A.dis_en} / ${A.com_km || A.com_en}` : `${A.pro_en} / ${A.dis_en} / ${A.com_en}`) : '')}
      ${row('Position', `${P.lat.toFixed(5)}°N ${P.lon.toFixed(5)}°E`)}${row('Elevation', n0(P.elev) + ' ' + U('m'))}${row('Slope', n0(P.slope, 1) + '°')}${row('Height difference within 500 m', n0(P.relief) + ' ' + U('m'))}
      ${row('Land cover within 500 m', P.lc.slice(0, 4).map(([k, p]) => `<i class="ghSw" style="background:${LC[k][2]}"></i>${esc(lcName(k))} ${n0(p)}%`).join('<br>'))}
      ${row('Topsoil', P.soil ? `${esc(t(P.soil.cls))} (${t('sand')} ${n0(P.soil.sand)}% · ${t('clay')} ${n0(P.soil.clay)}%)` : '')}${row('Rock below', P.geo ? esc(t(P.geo)) : '')}
      ${row('Houses within 1 km', `${n0(P.houses)} (≈ ${n0(P.people)} ${t('people')})`)}
      ${row('Nearest village', nm(N.villages && N.villages[0]))}${row('Nearest school', nm(N.schools && N.schools[0]))}${row('Nearest health centre', nm(N.health && N.health[0]))}${row('Nearest wat', nm(N.wats && N.wats[0]))}${row('Nearest market', nm(N.markets && N.markets[0]))}
      ${row('Rain falling here', P.flow ? `${n0(P.flow.len)} ${U('m')} → ${esc(this.dirOf(P.flow))}, ${n0(P.flow.drop, 1)} ${km() ? 'ម' : 'm'} ${t('lower')}` : '')}</table>
      ${P.clim ? `<div class="ghSub">${t('Climate (monthly average)')}</div><img class="ghChart" src="${this.climateChart(P.clim).toDataURL()}"><div class="ghSrc">${t('Rain')} ${n0(P.clim.year)} ${U('mm')}/${t('year')} · ${P.clim.src}</div>` : ''}
      <div class="ghSrc">${t('Sources')}: ${t('terrain and land cover of the 3D area')}, SoilGrids, ODC ${t('geology')}, OpenStreetMap, Open-Meteo. ${t('People are estimated from the houses (4.3 per house).')}</div>`;
  }

  /* ================= 4. Where does the rain go ================= */
  flowPath(x, z) {
    const D = this.D, H = this.hydro(), NX = H.NX, i0 = Math.round((x - D.X0) / D.dx), j0 = Math.round((z - D.Z0) / D.dz); let k = Math.max(0, Math.min(H.N - 1, j0 * NX + i0)); const pts = [], start = k;
    for (let s = 0; s < 20000; s++) { pts.push([D.X0 + (k % NX) * D.dx, D.Z0 + ((k / NX) | 0) * D.dz]); const d = H.dir[k]; if (d < 0) break; k = d; }
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const i = k % NX, j = (k / NX) | 0, edge = i === 0 || j === 0 || i === NX - 1 || j === H.NZ - 1, e = pts[pts.length - 1];
    const dv = [e[0] - pts[0][0], e[1] - pts[0][1]]; return { pts, start, end: k, info: { len, drop: D.raw[start] - D.raw[k], dir: dirName(...dv), dv, end: edge ? 'edge' : 'pond' } };
  }
  dirOf(r) { return r.dv ? dirName(...r.dv) : r.dir;
  }
  catchment(k0) { const H = this.hydro(), up = new Uint8Array(H.N), kids = new Int32Array(H.N + 1), list = new Int32Array(H.N);
    for (let k = 0; k < H.N; k++) if (H.dir[k] >= 0) kids[H.dir[k] + 1]++; for (let k = 0; k < H.N; k++) kids[k + 1] += kids[k]; const fill = kids.slice();
    for (let k = 0; k < H.N; k++) { const d = H.dir[k]; if (d >= 0) list[fill[d]++] = k; }
    const st = [k0]; up[k0] = 1; let n = 0; while (st.length) { const k = st.pop(); n++; for (let q = kids[k]; q < kids[k + 1]; q++) { const c = list[q]; if (!up[c]) { up[c] = 1; st.push(c); } } }
    return { up, n, ha: n * H.cellA / 1e4 }; }
  streams(minHa = 3) { const D = this.D, H = this.hydro(), thr = minHa * 1e4 / H.cellA, NX = H.NX, segs = [];
    if (!H.dOut) { const o = Array.from({ length: H.N }, (_, k) => k).sort((a, b) => H.fz[a] - H.fz[b]), dO = new Float32Array(H.N); // distance along the flow to where the water leaves
      for (const k of o) { const d = H.dir[k]; if (d >= 0) dO[k] = dO[d] + Math.hypot(((k % NX) - (d % NX)) * D.dx, (((k / NX) | 0) - ((d / NX) | 0)) * D.dz); } H.dOut = dO; }
    for (let k = 0; k < H.N; k++) { if (H.acc[k] < thr || H.dir[k] < 0) continue; const d = H.dir[k]; segs.push([[D.X0 + (k % NX) * D.dx, D.Z0 + ((k / NX) | 0) * D.dz], [D.X0 + (d % NX) * D.dx, D.Z0 + ((d / NX) | 0) * D.dz], H.acc[k] * H.cellA / 1e4, H.dOut[k], H.dOut[d]]); }
    return segs; }
  showStreams() { const segs = this.streams(); if (!segs.length) return 0; const pos = [], idx = [], dd = []; let v = 0;
    for (const [a, b, ha, da, db] of segs) { dd.push(da, da, db, db); const w = Math.min(6, 1 + Math.log10(ha) * 1.6), ya = this.w.hAt(a[0], a[1]) + 0.6, yb = this.w.hAt(b[0], b[1]) + 0.6, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l * w / 2, nz = (b[0] - a[0]) / l * w / 2;
      pos.push(a[0] + nx, ya, a[1] + nz, a[0] - nx, ya, a[1] - nz, b[0] + nx, yb, b[1] + nz, b[0] - nx, yb, b[1] - nz); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); v += 4; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aD', new THREE.Float32BufferAttribute(dd, 1)); g.setIndex(idx);
    const T = { value: 0 }, t0 = performance.now(), m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uT: T }, transparent: true, depthTest: false, side: THREE.DoubleSide,
      vertexShader: 'attribute float aD; varying float vD; void main(){ vD = aD; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // the pattern moves towards smaller "distance to the outlet", i.e. downstream
      fragmentShader: 'uniform float uT; varying float vD; void main(){ float p = fract((vD + uT * 9.0) / 22.0); float g = smoothstep(0.0, 0.2, p) * smoothstep(0.55, 0.25, p); gl_FragColor = vec4(mix(vec3(0.12, 0.55, 1.0), vec3(0.75, 0.95, 1.0), g), 0.6 + 0.4 * g); }' }));
    m.onBeforeRender = () => { T.value = (performance.now() - t0) / 1000; }; m.renderOrder = 30; this.add(m); return segs.length; }
  raindrop(x, z) {
    this.clear(); this.showStreams(); const D = this.D, H = this.hydro(), fp = this.flowPath(x, z), C = this.catchment(fp.start);
    const NX = H.NX; this.overlay(this.gridCanvas(k => C.up[k] ? [40, 220, 255, 120] : null));
    this.ribbon(fp.pts, 0xffe14a, 3.2, 1.0); this.pin(x, z, '💧', '#9fe8ff'); const e = fp.pts[fp.pts.length - 1]; this.pin(e[0], e[1], fp.info.end === 'edge' ? '→ ' + fp.info.dir : '◎', '#ffe14a');
    // a drop running down the path
    const drop = this.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66ddff, depthTest: false }))); drop.renderOrder = 41; let s = 0;
    const L = fp.pts.length, step = () => { s = (s + Math.max(0.25, L / 400)) % L; const p = fp.pts[Math.floor(s)]; drop.position.set(p[0], this.w.hAt(p[0], p[1]) + 2, p[1]); this.anim = requestAnimationFrame(step); }; step();
    void NX; this.data.rain = { ...fp.info, catchHa: C.ha }; return this.data.rain;
  }

  /* ================= 3. What if: flood and heavy rain ================= */
  waterSheet(mask, level) { // a translucent water surface over the wet cells, at the water level (so roads and fields under it look drowned)
    const D = this.D, H = this.hydro(), NX = H.NX, NZ = H.NZ, e = D.stats.exag || 1, base = Math.max(D.hmin, 0), pos = [], hw = D.dx / 2, hz = D.dz / 2;
    for (let j = 0; j < NZ; j++) { let i = 0; while (i < NX) { const k = j * NX + i; if (!mask[k]) { i++; continue; } let i1 = i; const y = (level(k) - base) * e + 0.25; while (i1 + 1 < NX && mask[j * NX + i1 + 1] && Math.abs((level(j * NX + i1 + 1) - base) * e + 0.25 - y) < 0.3) i1++;
      const x0 = D.X0 + i * D.dx - hw, x1 = D.X0 + i1 * D.dx + hw, z0 = D.Z0 + j * D.dz - hz, z1 = D.Z0 + j * D.dz + hz; pos.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1); i = i1 + 1; } }
    if (!pos.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2f6a9a, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false })); m.renderOrder = 5; this.add(m); }
  waterBase() { const D = this.D, H = this.hydro(); let lo = Infinity; for (let k = 0; k < H.N; k++) lo = Math.min(lo, D.raw[k]); const water = []; const NX = H.NX;
    for (let k = 0; k < H.N; k += 3) { const x = D.X0 + (k % NX) * D.dx, z = D.Z0 + ((k / NX) | 0) * D.dz; if (this.clsAt(x, z) === 1) water.push(D.raw[k]); }
    water.sort((a, b) => a - b); return water.length > 30 ? water[Math.floor(water.length * 0.5)] : lo; }
  floodMask(lvl) { // cells below the level that the water can reach: grown from the water (or the low edge of the area)
    const D = this.D, H = this.hydro(), NX = H.NX, NZ = H.NZ, fl = new Uint8Array(H.N), q = [];
    for (let k = 0; k < H.N; k++) { if (D.raw[k] >= lvl) continue; const i = k % NX, j = (k / NX) | 0, x = D.X0 + i * D.dx, z = D.Z0 + j * D.dz; if (this.clsAt(x, z) === 1) { fl[k] = 1; q.push(k); } }
    if (!q.length) for (let k = 0; k < H.N; k++) { const i = k % NX, j = (k / NX) | 0; if ((i === 0 || j === 0 || i === NX - 1 || j === NZ - 1) && D.raw[k] < lvl) { fl[k] = 1; q.push(k); } }
    for (let h = 0; h < q.length; h++) { const k = q[h], i = k % NX, j = (k / NX) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const n = jj * NX + ii; if (!fl[n] && D.raw[n] < lvl) { fl[n] = 1; q.push(n); } } }
    return fl;
  }
  flood(rise) {
    const D = this.D, H = this.hydro(), base = this.waterBase(), lvl = base + rise, NX = H.NX;
    const fl = this.floodMask(lvl);
    this.clear(); const flAt = (x, z) => { const i = Math.round((x - D.X0) / D.dx), j = Math.round((z - D.Z0) / D.dz); return i >= 0 && j >= 0 && i < NX && j < H.NZ && fl[j * NX + i]; };
    this.waterSheet(fl, () => lvl); this.w.floodAt = flAt;
    return this.impacts(flAt, lvl, base);
  }
  async impacts(flAt, lvl, base, paint = true) {
    const D = this.D, UM = this.UM || (this.UM = await import('./urban.js?v=110')), B = UM.buildingsOf(this.w), vals = B.map(b => flAt(b.x, b.z) ? 1 : 0), nb = vals.reduce((a, b) => a + b, 0);
    if (nb && paint) UM.paint(this.w, B, vals.map(v => v ? 1 : 0.15), 0, 1); // flooded houses in yellow, the others dark
    let roadKm = 0; for (const r of this.w.net ? this.w.net.roads : []) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i]; if (flAt((a.x + b.x) / 2, (a.z + b.z) / 2)) roadKm += Math.hypot(b.x - a.x, b.z - a.z) / 1000; }
    let crop = 0, cells = 0; for (let j = 0; j < D.gh; j++) for (let i = 0; i < D.gw; i++) { const x = D.X0 + (i + 0.5) * D.C, z = D.Z0 + (j + 0.5) * D.C; if (D.cls[j * D.gw + i] === 3 && flAt(x, z)) crop++; if (flAt(x, z)) cells++; }
    const r = { lvl, base, houses: nb, people: Math.round(nb * 4.3), roadKm, cropHa: crop * D.C * D.C / 1e4, areaHa: cells * D.C * D.C / 1e4, total: B.length }; if (paint) this.data.flood = r; return r;
  }
  heavyRain(mm) { // where the water stays: low spots that fill up (depressions), deeper with more rain
    const D = this.D, H = this.hydro(), depth = new Float32Array(H.N), NX = H.NX, scale = mm / 100;
    for (let k = 0; k < H.N; k++) { const d = H.fz[k] - D.raw[k]; if (d > 0.05) depth[k] = Math.min(d, d * scale); }
    const pond = (x, z) => { const i = Math.round((x - D.X0) / D.dx), j = Math.round((z - D.Z0) / D.dz); return i >= 0 && j >= 0 && i < NX && j < H.NZ && depth[j * NX + i] > 0.3 && this.clsAt(x, z) !== 1; };
    this.clear(); const wet = new Uint8Array(H.N); for (let k = 0; k < H.N; k++) { const x = D.X0 + (k % NX) * D.dx, z = D.Z0 + ((k / NX) | 0) * D.dz; if (depth[k] > 0.1 && this.clsAt(x, z) !== 1) wet[k] = 1; }
    this.waterSheet(wet, k => D.raw[k] + depth[k]); this.w.floodAt = pond;
    return this.impacts(pond, null, null);
  }

  /* ================= 5. Access to services ================= */
  async access(kind, mode) {
    const D = this.D, F = this.F, UM = this.UM || (this.UM = await import('./urban.js?v=110')), a = D.aoi, pad = 0.03, bb = [a.w - pad, a.s - pad, a.e + pad, a.n + pad];
    const KINDS = { school: ['school', 'kindergarten', 'college', 'university'], health: ['hospital', 'clinic', 'doctors', 'health_post'], market: ['marketplace'], wat: ['place_of_worship'] };
    const key = bb.join(','); if (!this._poi || this._poi.key !== key) { this.say(t('Finding schools, health centres and markets…'));
      const pts = []; const jobs = [];
      for (let i = Math.floor((bb[0] - 102) / 0.25); i <= Math.floor((bb[2] - 102) / 0.25); i++) for (let j = Math.floor((bb[1] - 10) / 0.25); j <= Math.floor((bb[3] - 10) / 0.25); j++) jobs.push(fetch(`data/places/${i}_${j}.json`).then(r => r.ok ? r.json() : []).catch(() => []));
      for (const arr of await Promise.all(jobs)) for (const p of arr) if (p[0] > bb[0] && p[0] < bb[2] && p[1] > bb[1] && p[1] < bb[3]) pts.push({ x: F.x(p[0]), z: F.z(p[1]), kind: p[2], name: p[3] || p[4] || '' });
      try { const o = await Promise.race([UM.fetchOSM(F, bb), new Promise((_, r) => setTimeout(() => r(new Error('slow')), 25000))]); for (const p of o.pois) { const k = p.cat === 'education' ? 'school' : p.cat === 'health' ? 'hospital' : p.sub === 'marketplace' ? 'marketplace' : p.cat === 'worship' ? 'place_of_worship' : null; if (k && !pts.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 60)) pts.push({ x: p.x, z: p.z, kind: k, name: p.name }); } } catch (e) { console.warn('overpass', e); }
      this._poi = { key, pts }; }
    const src = this._poi.pts.filter(p => KINDS[kind].includes(p.kind)); this.clear();
    const SPEED = { walk: { def: 4.5 }, moto: { def: 30, 11: 25, 12: 20, 13: 15, 14: 15, 16: 12 }, car: { def: 40, 1: 80, 3: 70, 5: 60, 7: 50, 9: 40, 11: 30, 12: 25, 13: 15, 14: 15, 16: 10 } }[mode];
    const roads = (this.w.net ? this.w.net.roads : []).map(r => ({ pts: r.pts.map(p => [p.x, p.z]), cls: r.cls }));
    const G = new UM.Graph(roads, (r, L) => L / ((SPEED[r.cls] || SPEED.def) / 3.6) / 60); // minutes
    const walkMin = 1 / (4.5 / 3.6) / 60, d = src.length ? G.dijkstra(src.map(p => [p.x, p.z]), walkMin) : null;
    const B = UM.buildingsOf(this.w), T = B.map(b => { if (!d) return null; const [n, s] = G.nearest(b.x, b.z, 800); if (n < 0) return null; const v = d[n] + s * walkMin; return isFinite(v) ? v : null; });
    // straight-line fallback for places beyond the road network
    const lim = { walk: 30, moto: 15, car: 15 }[mode]; UM.paint(this.w, B, T.map(v => v == null ? null : Math.min(v, lim * 2)), 0, lim * 2, true);
    for (const p of src) if (this.inside(p.x, p.z)) this.pin(p.x, p.z, { school: '🏫', health: '🏥', market: '🛒', wat: '🛕' }[kind] + (p.name ? ' ' + short(p.name) : ''), '#ffffff', 16);
    const v = T.filter(x => x != null).sort((a, b) => a - b), within = v.filter(x => x <= lim).length;
    const r = { kind, mode, n: src.length, inArea: src.filter(p => this.inside(p.x, p.z)).length, houses: B.length, reached: v.length, within, lim, median: v.length ? v[Math.floor(v.length / 2)] : null, worst: v.length ? v[v.length - 1] : null };
    this.data.access = r; return r;
  }

  /* ================= 2. Time machine ================= */
  async timeMachine(say) {
    if (this.TM && this.TM.aoi === this.D.aoi) return this.TM; const D = this.D, a = D.aoi, LCm = await import('./landcover.js?v=110'), LY = await import('./layers.js?v=110');
    const years = LY.IO_YEARS, io = {};
    let n = 0; await Promise.all(years.map(async y => { const r = await LCm.loadIO(a, D.W, D.H, y); if (r) io[y] = r; say(`${t('Loading land cover maps')} ${++n}/${years.length}`); }));
    const stats = {}; for (const [y, r] of Object.entries(io)) { const c = {}; for (const v of r.d) c[v] = (c[v] || 0) + 1; const ha = D.W * D.H / 1e4 / r.d.length; stats[y] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v * ha])); }
    // forest loss year by year (Hansen Global Forest Change, cloud GeoTIFF read for this window only)
    let loss = null; say(t('Loading forest loss 2001–2024…'));
    try { await Promise.race([new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 40000)), (async () => { const GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm'), lat0 = Math.ceil(a.n / 10) * 10, lon0 = Math.floor(a.w / 10) * 10, tile = `${lat0}N_${String(lon0).padStart(3, '0')}E`;
      const tif = await GT.fromUrl(`https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_lossyear_${tile}.tif`, { allowFullFile: false }), im = await tif.getImage(), px = 0.00025;
      const x0 = Math.floor((a.w - lon0) / px), x1 = Math.ceil((a.e - lon0) / px), y0 = Math.floor((lat0 - a.n) / px), y1 = Math.ceil((lat0 - a.s) / px), [d] = await im.readRasters({ window: [x0, y0, x1, y1] });
      const w = x1 - x0, h = y1 - y0, byYear = {}, ha = D.W * D.H / 1e4 / (w * h); for (const v of d) if (v) byYear[2000 + v] = (byYear[2000 + v] || 0) + ha; loss = { w, h, d, byYear }; })()]); } catch (e) { console.warn('hansen', e); }
    this.TM = { aoi: D.aoi, io, stats, loss, IO: LY.IO_CLASSES }; return this.TM;
  }
  tmFrame(y, mode) { // the land cover map of year y (2017+) and the forest lost up to year y, over the image
    const TM = this.TM, D = this.D, a = D.aoi; if (!TM) return;
    const io = mode !== 'loss' ? (TM.io[y] || null) : null, L = TM.loss;
    const w = io ? io.w : L ? L.w : 100, h = io ? io.h : L ? L.h : 100, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h);
    if (io) for (let k = 0; k < io.d.length; k++) { const cl = TM.IO[io.d[k]]; if (!cl) continue; const hx = cl[1]; im.data.set([parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16), 150], k * 4); }
    if (L) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const li = Math.floor(i / w * L.w), lj = Math.floor(j / h * L.h), v = L.d[lj * L.w + li]; if (v && 2000 + v <= y) im.data.set([255, 40, 60, 235], (j * w + i) * 4); }
    g.putImageData(im, 0, 0); this.overlay(c, { w: a.w, e: a.e, n: a.n, s: a.s });
  }
  tmStory() { const TM = this.TM; if (!TM) return []; const ys = Object.keys(TM.stats).map(Number).sort(), L = [];
    if (ys.length >= 2) { const y0 = ys[0], y1 = ys[ys.length - 1], s0 = TM.stats[y0], s1 = TM.stats[y1];
      for (const [k, en, kmn] of [[7, 'Built area', 'តំបន់សំណង់'], [5, 'Crops', 'ដំណាំ'], [2, 'Trees', 'ដើមឈើ'], [1, 'Water', 'ទឹក']]) { const a = s0[k] || 0, b = s1[k] || 0; if (a < 0.5 && b < 0.5) continue; const ch = b - a;
        L.push(km() ? `${kmn}៖ ${n0(a, 1)} ហ.ត (${n0(y0)}) → ${n0(b, 1)} ហ.ត (${n0(y1)})${Math.abs(ch) >= 0.5 ? ' · ' + (ch > 0 ? 'កើន' : 'ថយ') + ' ' + n0(Math.abs(ch), 1) + ' ហ.ត' : ''}` : `${en}: ${n0(a, 1)} ha (${y0}) → ${n0(b, 1)} ha (${y1})${Math.abs(ch) >= 0.5 ? ` · ${ch > 0 ? '+' : '−'}${n0(Math.abs(ch), 1)} ha` : ''}`); } }
    if (TM.loss) { const by = TM.loss.byYear, tot = Object.values(by).reduce((a, b) => a + b, 0); if (tot > 0.2) { const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
      L.push(km() ? `ព្រៃបាត់បង់ ២០០១–២០២៤៖ ${n0(tot, 1)} ហ.ត · ច្រើនជាងគេនៅឆ្នាំ ${n0(+top[0])} (${n0(top[1], 1)} ហ.ត)` : `Forest lost 2001–2024: ${n0(tot, 1)} ha · most in ${top[0]} (${n0(top[1], 1)} ha)`); }
      else L.push(km() ? 'គ្មានការបាត់បង់ព្រៃគួរកត់សម្គាល់ ២០០១–២០២៤' : 'No notable forest loss 2001–2024'); }
    return L; }
  tmChart(W = 520, Hh = 180) { const TM = this.TM, ys = Object.keys(TM.stats).map(Number).sort(), c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh);
    if (ys.length < 2) return c; const K = [[7, '#c4281b'], [5, '#e49635'], [2, '#397d49'], [1, '#419bdf']], mx = Math.max(1, ...ys.flatMap(y => K.map(([k]) => TM.stats[y][k] || 0))), X = i => 30 + i / (ys.length - 1) * (W - 50), Y = v => Hh - 22 - v / mx * (Hh - 40);
    g.font = '12px system-ui'; g.fillStyle = '#333'; ys.forEach((y, i) => g.fillText(String(y).slice(2), X(i) - 6, Hh - 6));
    for (const [k, col] of K) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); ys.forEach((y, i) => { const v = TM.stats[y][k] || 0; i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); }); g.stroke(); }
    g.fillStyle = '#333'; g.fillText(`ha (max ${Math.round(mx)})`, 4, 12); return c; }

  /* ================= 6. Worksheet maker ================= */
  snapshot(kind) { const w = this.w, D = this.D, cam = w.camera, ct = w.controls, p0 = cam.position.clone(), q0 = ct.target.clone(); w.flight = null;
    if (kind === 'top') { cam.position.set(0, D.S * 1.3, 0.01); ct.target.set(0, 0, 0); } else { cam.position.set(-D.S * 0.55, D.S * 0.45, D.S * 0.62); ct.target.set(0, 0, 0); }
    ct.update(); w.frame(); const cv = w.renderer.domElement; let url;
    if (kind === 'top') { const s = Math.min(cv.width, cv.height), c = document.createElement('canvas'); c.width = c.height = Math.min(1000, s); c.getContext('2d').drawImage(cv, (cv.width - s) / 2, (cv.height - s) / 2, s, s, 0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', 0.88); }
    else url = cv.toDataURL('image/jpeg', 0.85);
    cam.position.copy(p0); ct.target.copy(q0); ct.update(); return url; }
  /* ================= Landforms (geomorphology) ================= */
  // classes from slope, height above the nearest stream (HAND) and position against the surroundings (TPI)
  landforms() {
    if (this.LF && this.LF.D === this.D) return this.LF;
    const D = this.D, H = this.hydro(), NX = H.NX, NZ = H.NZ, R = D.raw, N = H.N;
    // height above the nearest drainage: follow the flow down to the first stream cell
    const thr = 2 * 1e4 / H.cellA, base = new Float32Array(N).fill(NaN);
    for (let k0 = 0; k0 < N; k0++) { if (!isNaN(base[k0])) continue; const path = []; let k = k0;
      while (k >= 0 && isNaN(base[k]) && H.acc[k] < thr && H.dir[k] >= 0) { path.push(k); k = H.dir[k]; }
      const b = k < 0 ? R[path[path.length - 1]] : !isNaN(base[k]) ? base[k] : R[k]; if (k >= 0 && isNaN(base[k])) base[k] = R[k]; for (const q of path) base[q] = b; }
    // mean height around each cell (integral image) at two scales
    const I = new Float64Array((NX + 1) * (NZ + 1)); for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) I[(j + 1) * (NX + 1) + i + 1] = R[j * NX + i] + I[j * (NX + 1) + i + 1] + I[(j + 1) * (NX + 1) + i] - I[j * (NX + 1) + i];
    const mean = (i, j, r) => { const i0 = Math.max(0, i - r), i1 = Math.min(NX, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(NZ, j + r + 1); return (I[j1 * (NX + 1) + i1] - I[j0 * (NX + 1) + i1] - I[j1 * (NX + 1) + i0] + I[j0 * (NX + 1) + i0]) / ((i1 - i0) * (j1 - j0)); };
    const sb = Math.max(1, Math.round(15 / D.dx)), rS = Math.max(2, Math.round(60 / D.dx)), rL = Math.max(4, Math.round(300 / D.dx)), cls = new Uint8Array(N), cnt = new Array(9).fill(0);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, x = D.X0 + i * D.dx, z = D.Z0 + j * D.dz;
      const i0 = Math.max(0, i - sb), i1 = Math.min(NX - 1, i + sb), j0 = Math.max(0, j - sb), j1 = Math.min(NZ - 1, j + sb), gx = (R[j * NX + i1] - R[j * NX + i0]) / ((i1 - i0) * D.dx), gz = (R[j1 * NX + i] - R[j0 * NX + i]) / ((j1 - j0) * D.dz), sl = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
      const hand = R[k] - base[k], tS = R[k] - mean(i, j, rS), tL = R[k] - mean(i, j, rL); let c;
      if (this.clsAt(x, z) === 1) c = 1;                         // water: river, lake, pond
      else if (sl > 15 || (tL > 15 && sl > 6)) c = 7;            // hill, ridge
      else if (sl > 5) c = 6;                                    // slope, foothill
      else if (tS < -1.2 && hand < 3) c = 2;                     // channel, depression, valley floor
      else if (hand < 2) c = 3;                                  // floodplain
      else if (hand < 6) c = 4;                                  // low terrace, plain
      else c = 5;                                                // high terrace, plateau
      if (tL > 8 && c >= 4 && c <= 5 && sl <= 5) c = 8;          // isolated rise, mound (e.g. levee, old dune, temple mound)
      cls[k] = c; cnt[c]++; }
    return (this.LF = { D, cls, pct: cnt.map(n => n / N * 100) });
  }
  showLandforms() { const L = this.landforms(); this.clear(); this.overlay(this.gridCanvas(k => { const c = LANDFORMS[L.cls[k]]; if (!c) return null; const h = c[2]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 165]; })); return L; }
  landformMap(px = 760) { const L = this.landforms(), H = this.hydro(), NX = H.NX, NZ = H.NZ, c = document.createElement('canvas'); c.width = NX; c.height = NZ; const g = c.getContext('2d'), im = g.createImageData(NX, NZ), R = this.D.raw;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, h = (LANDFORMS[L.cls[k]] || [, , '#999999'])[2], gx = (R[j * NX + Math.min(NX - 1, i + 1)] - R[j * NX + Math.max(0, i - 1)]) * 1.5, gz = (R[Math.min(NZ - 1, j + 1) * NX + i] - R[Math.max(0, j - 1) * NX + i]) * 1.5, sh = Math.min(1.25, Math.max(0.55, 0.95 + (gx * 0.4 + gz * 0.5) / 10));
      im.data.set([parseInt(h.slice(1, 3), 16) * sh, parseInt(h.slice(3, 5), 16) * sh, parseInt(h.slice(5, 7), 16) * sh, 255].map(v => Math.min(255, v)), k * 4); }
    g.putImageData(im, 0, 0); const o = document.createElement('canvas'), s = px / Math.max(NX, NZ); o.width = Math.round(NX * s); o.height = Math.round(NZ * s); const og = o.getContext('2d'); og.drawImage(c, 0, 0, o.width, o.height); this.mapFrame(og, o.width, o.height); return o.toDataURL('image/jpeg', 0.9); }

  /* ================= People: population, age and sex, settlements ================= */
  async population() {
    const D = this.D, F = this.F, a = D.aoi; if (this.POP && this.POP.D === D) return this.POP;
    const idx = this._popIdx || (this._popIdx = await (await fetch('data/pop/index.json')).json()), cells = [];
    for (let i = Math.floor((a.w - 102) / 0.25); i <= Math.floor((a.e - 102) / 0.25); i++) for (let j = Math.floor((a.s - 10) / 0.25); j <= Math.floor((a.n - 10) / 0.25); j++) {
      const T = idx.tiles[i + '_' + j]; if (!T) continue; const [c0, r0, w, h] = T;
      const buf = await new Response((await fetch(`data/pop/${i}_${j}.bin.gz`)).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), v = new Uint16Array(buf);
      for (let r = 0; r < h; r++) { const lat = idx.oy - (r0 + r + 0.5) * idx.res; if (lat < a.s || lat > a.n) continue; for (let c = 0; c < w; c++) { const q = v[r * w + c]; if (!q) continue; const lon = idx.ox + (c0 + c + 0.5) * idx.res; if (lon < a.w || lon > a.e) continue; cells.push([F.x(lon), F.z(lat), q / idx.scale]); } } }
    const total = cells.reduce((s, c) => s + c[2], 0), areaKm2 = D.W * D.H / 1e6;
    const P = this.data.profile, adm = P && P.adm || await import('./placeinfo.js?v=110').then(m => m.adminAt(F.lat0, F.lon0)).catch(() => null);
    const norm = s => ({ siemreap: 'siemreap', tboungkhmum: 'tbongkhmum', oddarmeanchey: 'otdarmeanchey', ratanakiri: 'ratanakkiri' })[(s || '').toLowerCase().replace(/[^a-z]/g, '')] || (s || '').toLowerCase().replace(/[^a-z]/g, '');
    const prov = adm ? idx.provinces[norm(adm.pro_en)] : null;
    return (this.POP = { D, cells, total, density: total / areaKm2, areaKm2, prov, source: idx.source, cellM: idx.res * 110000 });
  }
  showPopulation(P) { const D = this.D, NX = Math.ceil(D.W / 92), NZ = Math.ceil(D.H / 92), g = new Float32Array(NX * NZ); for (const [x, z, v] of P.cells) { const i = Math.floor((x - D.X0) / 92), j = Math.floor((z - D.Z0) / 92); if (i >= 0 && j >= 0 && i < NX && j < NZ) g[j * NX + i] += v; }
    const c = document.createElement('canvas'); c.width = NX; c.height = NZ; const cx = c.getContext('2d'), im = cx.createImageData(NX, NZ), mx = Math.max(10, ...g);
    for (let k = 0; k < g.length; k++) { if (g[k] < 0.5) continue; const t = Math.sqrt(g[k] / mx); im.data.set([255, Math.round(230 - 200 * t), Math.round(120 - 110 * t), Math.round(90 + 140 * t)], k * 4); }
    cx.putImageData(im, 0, 0); this.clear(); this.overlay(c); return mx; }
  pyramid(prov, W = 520, Hh = 260) { const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); if (!prov || !prov.proj2024) return c;
    const { F: Fm, M } = prov.proj2024, tot = prov.proj2024.T, n = Fm.length, mx = Math.max(...Fm, ...M) / tot * 100, cx = W / 2, bh = (Hh - 34) / n, sx = (W / 2 - 40) / mx, L = ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80+'];
    g.font = '11px system-ui'; for (let i = 0; i < n; i++) { const y = Hh - 22 - (i + 1) * bh, m = M[i] / tot * 100, f = Fm[i] / tot * 100; g.fillStyle = '#3f7fc4'; g.fillRect(cx - 14 - m * sx, y + 1, m * sx, bh - 2); g.fillStyle = '#d0587e'; g.fillRect(cx + 14, y + 1, f * sx, bh - 2); g.fillStyle = '#333'; g.textAlign = 'center'; if (i % 2 === 0) g.fillText(L[i], cx, y + bh - 2); }
    g.textAlign = 'left'; g.fillStyle = '#3f7fc4'; g.fillText(km() ? 'ប្រុស' : 'Male', 8, 14); g.textAlign = 'right'; g.fillStyle = '#d0587e'; g.fillText(km() ? 'ស្រី' : 'Female', W - 8, 14); g.fillStyle = '#555'; g.textAlign = 'center'; g.fillText(km() ? '% នៃប្រជាជនសរុប' : '% of the population', cx, Hh - 6); return c; }
  ageStats(prov) { if (!prov || !prov.proj2024) return null; const { F: Fm, M, T } = prov.proj2024, s = (a, b) => { let v = 0; for (let i = a; i <= b; i++) v += Fm[i] + M[i]; return v; };
    const young = s(0, 2), work = s(3, 12), old = s(13, 16), males = M.reduce((x, y) => x + y, 0); return { young: young / T * 100, work: work / T * 100, old: old / T * 100, dep: (young + old) / work * 100, sexRatio: males / (T - males) * 100 }; }
  // settlements: groups of buildings, their size and shape (linear along a road or river, clustered, dispersed)
  async settlements() {
    const UM = this.UM || (this.UM = await import('./urban.js?v=110')), B = UM.buildingsOf(this.w), D = this.D; if (B.length < 10) return [];
    const lab = dbscanLabels(B, 45, 6), groups = new Map(); lab.forEach((l, i) => { if (l >= 0) (groups.get(l) || groups.set(l, []).get(l)).push(B[i]); });
    const roadD = (x, z) => { const n = this.w.net && this.w.net.near(x, z, 80)[0]; return n ? n[2] : 999; }, waterD = (x, z) => { for (let r = 0; r <= 80; r += 10) for (let a = 0; a < 6.28; a += 0.8) if (this.clsAt(x + Math.cos(a) * r, z + Math.sin(a) * r) === 1) return r; return 999; };
    const out = [];
    for (const g of groups.values()) { if (g.length < 12) continue; const n = g.length, cx = g.reduce((s, b) => s + b.x, 0) / n, cz = g.reduce((s, b) => s + b.z, 0) / n;
      let xx = 0, xz = 0, zz = 0; for (const b of g) { const dx = b.x - cx, dz = b.z - cz; xx += dx * dx; xz += dx * dz; zz += dz * dz; } const tr = (xx + zz) / n, det = (xx * zz - xz * xz) / n / n, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = Math.max(1, tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det))), elong = Math.sqrt(l1 / l2);
      const hull = convexHull(g.map(b => [b.x, b.z])), area = Math.max(100, Math.abs(ringA(hull))), dens = n / (area / 1e4);
      const nearRoad = g.filter(b => roadD(b.x, b.z) < 35).length / n, nearWater = g.filter(b => waterD(b.x, b.z) < 60).length / n;
      const shape = elong > 2.6 && nearWater > 0.5 ? 'riverbank' : elong > 2.6 && nearRoad > 0.5 ? 'linear' : dens < 6 ? 'dispersed' : 'clustered';
      out.push({ n, cx, cz, hull, area, dens, elong, nearRoad, nearWater, shape }); }
    out.sort((a, b) => b.n - a.n); this.SET = out; return out;
  }
  showSettlements(list) { for (const s of list) { const col = SETTLE[s.shape][2]; const pts = s.hull.concat([s.hull[0]]); this.ribbon(pts, new THREE.Color(col).getHex(), 3, 1.5, 0.9); } list.slice(0, 15).forEach((s, i) => this.pin(s.cx, s.cz, `${n0(i + 1)} · ${n0(s.n)} 🏠`, SETTLE[s.shape][2], 8)); }
  settlementMap(list, px = 760) { const D = this.D, c = document.createElement('canvas'), s = px / Math.max(D.W, D.H); c.width = Math.round(D.W * s); c.height = Math.round(D.H * s); const g = c.getContext('2d');     g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#b9b2a2'; g.lineWidth = 1; for (const r of this.w.net ? this.w.net.roads : []) { g.beginPath(); r.pts.forEach((p, i) => { const x = (p.x - D.X0) * s, y = (p.z - D.Z0) * s; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    g.fillStyle = '#3b8fd9'; for (let j = 0; j < D.gh; j++) for (let i = 0; i < D.gw; i++) if (D.cls[j * D.gw + i] === 1) g.fillRect(i * D.C * s, j * D.C * s, D.C * s + 0.5, D.C * s + 0.5);
    for (const t of list) { const col = SETTLE[t.shape][2]; g.fillStyle = col + '55'; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); t.hull.forEach(([x, z], i) => { const X = (x - D.X0) * s, Y = (z - D.Z0) * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.fill(); g.stroke(); }
    this.mapFrame(g, c.width, c.height); return c.toDataURL('image/png'); }

  /* whole-area figures for the report: relief, slope, land cover, water, settlement, roads, services, flood exposure */
  async areaStats() {
    const D = this.D, F = this.F, H = this.hydro(), NX = H.NX, R = D.raw;
    let lo = Infinity, hi = -Infinity, sum = 0; for (let k = 0; k < H.N; k++) { lo = Math.min(lo, R[k]); hi = Math.max(hi, R[k]); sum += R[k]; }
    const sl = [0, 0, 0, 0], sb = Math.max(1, Math.round(15 / D.dx)); for (let j = sb; j < H.NZ - sb; j++) for (let i = sb; i < NX - sb; i++) { const k = j * NX + i, gx = (R[k + sb] - R[k - sb]) / (2 * sb * D.dx), gz = (R[k + sb * NX] - R[k - sb * NX]) / (2 * sb * D.dz), a = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; sl[a < 2 ? 0 : a < 8 ? 1 : a < 15 ? 2 : 3]++; }
    const slT = sl.reduce((a, b) => a + b, 0) || 1, lc = {}; for (const v of D.cls) if (v) lc[v] = (lc[v] || 0) + 1; const lcT = Object.values(lc).reduce((a, b) => a + b, 0) || 1;
    const areaKm2 = D.W * D.H / 1e6, UM = this.UM || (this.UM = await import('./urban.js?v=110')), B = UM.buildingsOf(this.w);
    const roads = { main: 0, local: 0, track: 0 }; for (const r of this.w.net ? this.w.net.roads : []) { let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z); roads[r.cls <= 10 ? 'main' : r.cls <= 14 ? 'local' : 'track'] += L / 1000; }
    const st = this.streams(); let stKm = 0; for (const [a, b] of st) stKm += Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
    // settlement pattern: Clark–Evans nearest-neighbour index of the houses (R < 1 clustered, ≈ 1 random, > 1 dispersed)
    let nni = null; if (B.length >= 20) { const cell = 30, g = new Map(); B.forEach((b, i) => { const k = Math.floor(b.x / cell) + ',' + Math.floor(b.z / cell); (g.get(k) || g.set(k, []).get(k)).push(i); });
      let s = 0; for (const b of B) { let best = Infinity; for (let r = 1; r <= 4 && best === Infinity; r++) for (let u = -r; u <= r; u++) for (let v = -r; v <= r; v++) for (const j of g.get((Math.floor(b.x / cell) + u) + ',' + (Math.floor(b.z / cell) + v)) || []) { const o = B[j]; if (o === b) continue; const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < best) best = d; } s += best === Infinity ? 0 : best; }
      nni = (s / B.length) / (0.5 / Math.sqrt(B.length / (D.W * D.H))); }
    const a = D.aoi, places = await this.nearby((a.w + a.e) / 2, (a.s + a.n) / 2), inA = o => true; void inA;
    const flood = []; const base = this.waterBase(); for (const rise of [1, 2, 3]) { const lvl = base + rise, fm = this.floodMask(lvl), flAt = (x, z) => { const i = Math.round((x - D.X0) / D.dx), j = Math.round((z - D.Z0) / D.dz); return i >= 0 && j >= 0 && i < NX && j < H.NZ && fm[j * NX + i] === 1; }; flood.push([rise, await this.impacts(flAt, lvl, base, false)]); }
    return { lo, hi, mean: sum / H.N, slope: sl.map(v => v / slT * 100), lc: Object.entries(lc).map(([k, n]) => [+k, n / lcT * 100]).sort((x, y) => y[1] - x[1]), areaKm2, houses: B.length, density: B.length / areaKm2, people: Math.round(B.length * 4.3), roads, stKm, nni, places, flood, base };
  }
  reliefMap(px = 760) { // hypsometric tints with hillshade, streams in blue
    const D = this.D, H = this.hydro(), NX = H.NX, NZ = H.NZ, R = D.raw; let lo = Infinity, hi = -Infinity; for (const v of R) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const RAMP = [[0, [86, 150, 90]], [0.25, [160, 190, 110]], [0.5, [225, 215, 150]], [0.75, [200, 150, 95]], [1, [150, 100, 75]]];
    const col = t => { for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [t0, a] = RAMP[i - 1], [t1, b] = RAMP[i], f = (t - t0) / (t1 - t0); return a.map((v, k) => v + (b[k] - v) * f); } return RAMP[RAMP.length - 1][1]; };
    const c = document.createElement('canvas'); c.width = NX; c.height = NZ; const g = c.getContext('2d'), im = g.createImageData(NX, NZ), ex = 3;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, gx = (R[j * NX + Math.min(NX - 1, i + 1)] - R[j * NX + Math.max(0, i - 1)]) / (2 * D.dx) * ex, gz = (R[Math.min(NZ - 1, j + 1) * NX + i] - R[Math.max(0, j - 1) * NX + i]) / (2 * D.dz) * ex;
      const sh = Math.max(0, (-gx * -0.5 + -gz * -0.6 + 0.62) / Math.sqrt(gx * gx + gz * gz + 1)) * 1.35, cc = col((R[k] - lo) / Math.max(1, hi - lo)); im.data.set([cc[0] * sh, cc[1] * sh, cc[2] * sh, 255].map(v => Math.min(255, v)), k * 4); }
    g.putImageData(im, 0, 0); const o = document.createElement('canvas'), s = px / Math.max(NX, NZ); o.width = Math.round(NX * s); o.height = Math.round(NZ * s); const og = o.getContext('2d'); og.drawImage(c, 0, 0, o.width, o.height);
    og.strokeStyle = '#1f6fd1'; og.lineCap = 'round'; for (const [a, b, ha] of this.streams()) { og.lineWidth = Math.min(4, 0.8 + Math.log10(ha)); og.beginPath(); og.moveTo((a[0] - D.X0) / D.dx * s, (a[1] - D.Z0) / D.dz * s); og.lineTo((b[0] - D.X0) / D.dx * s, (b[1] - D.Z0) / D.dz * s); og.stroke(); }
    this.mapFrame(og, o.width, o.height); return { url: o.toDataURL('image/jpeg', 0.9), lo, hi };
  }
  lcMap(px = 760) { const D = this.D, c = document.createElement('canvas'); c.width = D.gw; c.height = D.gh; const g = c.getContext('2d'), im = g.createImageData(D.gw, D.gh);
    for (let k = 0; k < D.cls.length; k++) { const L = LC[D.cls[k]]; const hx = L ? L[2] : '#9a9a9a'; im.data.set([parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16), 255], k * 4); }
    g.putImageData(im, 0, 0); const o = document.createElement('canvas'), s = px / Math.max(D.gw, D.gh); o.width = Math.round(D.gw * s); o.height = Math.round(D.gh * s); const og = o.getContext('2d'); og.imageSmoothingEnabled = false; og.drawImage(c, 0, 0, o.width, o.height);
    // roads and houses on top
    const sx = o.width / D.W, sz = o.height / D.H; og.strokeStyle = 'rgba(40,40,40,.8)'; og.lineWidth = 1.2; for (const r of this.w.net ? this.w.net.roads : []) { og.beginPath(); r.pts.forEach((p, i) => { const x = (p.x - D.X0) * sx, y = (p.z - D.Z0) * sz; i ? og.lineTo(x, y) : og.moveTo(x, y); }); og.stroke(); }
    this.mapFrame(og, o.width, o.height); return o.toDataURL('image/png'); }
  mapFrame(g, W, H) { const D = this.D, len = [50, 100, 200, 250, 500, 1000, 2000].reduce((b, v) => v <= D.W / 4 ? v : b, 50), px = len / D.W * W;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - px - 30, H - 34, px + 22, 26); g.fillStyle = '#111'; g.fillRect(W - px - 20, H - 16, px, 4); g.font = 'bold 12px system-ui'; g.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', W - px - 20, H - 20);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(24, 28, 17, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.moveTo(24, 13); g.lineTo(31, 34); g.lineTo(24, 29); g.lineTo(17, 34); g.closePath(); g.fill(); g.font = 'bold 10px system-ui'; g.fillText('N', 21, 44 > H ? H : 44); }
  async report(opt, win) {
    const D = this.D, F = this.F, K = km(), say = this.say, A0 = this.data.profile && opt.here ? this.data.profile : null;
    say(t('Reading the area…')); const P = A0 || await this.profile(0, 0); say(t('Measuring the area…')); const S = await this.areaStats(); say(t('Drawing the maps…'));
    const top = this.snapshot('top'), ob = this.snapshot('oblique'), rel = this.reliefMap(), lcm = this.lcMap(), A = P.adm;
    const tt = (en, kh) => K ? kh : en, sec = opt.sections, U2 = v => n0(v, 1);
    const place = A ? (K ? `ឃុំ ${A.com_km || A.com_en} ស្រុក ${A.dis_km || A.dis_en} ខេត្ត ${A.pro_km || A.pro_en}` : `${A.com_en} commune, ${A.dis_en} district, ${A.pro_en} province`) : '';
    const tbl = rows => `<table>${rows.filter(r => r && r[1] != null && r[1] !== '').map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
    const bar = (list) => `<div class="bars">${list.map(([lab, p, c]) => `<div><span>${lab}</span><i style="width:${Math.max(1, p)}%;background:${c}"></i><b>${n0(p)}%</b></div>`).join('')}</div>`;
    const nni = S.nni, pat = nni == null ? '' : nni < 0.8 ? tt('clustered', 'ប្រមូលផ្ដុំ') : nni < 1.2 ? tt('random', 'ចៃដន្យ') : tt('dispersed', 'រាយប៉ាយ');
    const vill = (S.places.villages || []).filter(v => v.d < Math.max(D.W, D.H) * 0.6).slice(0, 12).map(v => esc(K ? (v.nk || v.ne) : (v.ne || v.nk))).filter(Boolean);
    let h = '', n = 0; const H2 = (en, kh) => `<h2>${++n}. ${tt(en, kh)}</h2>`;
    h += H2('Location', 'ទីតាំង') + `<p>${esc(this.profileText(P)[0])}</p>` + tbl([[tt('Administrative unit', 'រដ្ឋបាល'), esc(place)], [tt('Centre', 'ចំណុចកណ្ដាល'), `${F.lat0.toFixed(5)}°N ${F.lon0.toFixed(5)}°E`], [tt('Study area', 'តំបន់សិក្សា'), `${U2(D.W / 1000)} × ${U2(D.H / 1000)} ${U('km')} (${U2(S.areaKm2)} ${U('km')}²)`], [tt('Villages in and around', 'ភូមិក្នុង និងជុំវិញ'), vill.join(', ')]])
      + `<div class="imgs"><figure><img src="${top}"><figcaption>${tt('Satellite view from above, north at the top', 'រូបភាពផ្កាយរណបពីលើ ទិសខាងជើងនៅខាងលើ')}</figcaption></figure><figure><img src="${ob}"><figcaption>${tt('3D view of the study area', 'ទិដ្ឋភាព 3D នៃតំបន់សិក្សា')}</figcaption></figure></div>`;
    if (sec.includes('physical')) {
      h += H2('Physical geography', 'ភូមិសាស្ត្ររូបវិទ្យា');
      h += `<h3>${tt('Relief and landforms', 'ទម្រង់ដី')}</h3>` + tbl([[tt('Lowest / highest / mean elevation', 'កម្ពស់ទាបបំផុត / ខ្ពស់បំផុត / មធ្យម'), `${n0(S.lo)} / ${n0(S.hi)} / ${n0(S.mean)} ${U('m')}`], [tt('Local relief', 'ភាពខុសគ្នានៃកម្ពស់'), `${n0(S.hi - S.lo)} ${U('m')}`]])
        + bar([[tt('Flat (< 2°)', 'រាបស្មើ (< ២°)'), S.slope[0], '#7fb069'], [tt('Gentle (2–8°)', 'ជម្រាលតិច (២–៨°)'), S.slope[1], '#e6c86e'], [tt('Moderate (8–15°)', 'ជម្រាលមធ្យម (៨–១៥°)'), S.slope[2], '#d9894a'], [tt('Steep (> 15°)', 'ជម្រាលចោត (> ១៥°)'), S.slope[3], '#a8493a']])
        + `<figure class="one"><img src="${rel.url}"><figcaption>${tt('Relief map: green low, brown high', 'ផែនទីទម្រង់ដី៖ បៃតង = ទាប ត្នោត = ខ្ពស់')} (${n0(rel.lo)}–${n0(rel.hi)} ${U('m')}) · ${tt('blue: streams from the terrain', 'ខៀវ៖ អូរពីទម្រង់ដី')}</figcaption></figure>`;
      const LF = this.landforms(); h += `<h3>${tt('Landforms', 'ទម្រង់ភូមិសាស្ត្រ')}</h3><p>${tt('Classified from slope, height above the nearest stream and position against the surroundings.', 'ចាត់ថ្នាក់ពីជម្រាល កម្ពស់ពីអូរជិតបំផុត និងទីតាំងធៀបនឹងជុំវិញ។')}</p>`
        + bar(Object.keys(LANDFORMS).map(Number).filter(k => LF.pct[k] >= 0.5).sort((a, b) => LF.pct[b] - LF.pct[a]).map(k => [esc(K ? LANDFORMS[k][1] : LANDFORMS[k][0]), LF.pct[k], LANDFORMS[k][2]]))
        + `<figure class="one"><img src="${this.landformMap()}"><figcaption>${tt('Landform map (automatic classification from the terrain model)', 'ផែនទីទម្រង់ភូមិសាស្ត្រ (ចាត់ថ្នាក់ស្វ័យប្រវត្តិពីគំរូដី)')}</figcaption></figure>`;
      h += `<h3>${tt('Water', 'ធនធានទឹក')}</h3><p>${tt(`Streams traced from the terrain run for about ${U2(S.stKm)} km in the area (drainage density ${U2(S.stKm / S.areaKm2)} km/km²).`, `អូរដែលតាមដានពីទម្រង់ដីមានប្រវែងប្រហែល ${U2(S.stKm)} គ.ម ក្នុងតំបន់ (ដង់ស៊ីតេបណ្ដាញទឹក ${U2(S.stKm / S.areaKm2)} គ.ម/គ.ម²)។`)} ${P.flow ? esc(this.profileText(P).slice(-1)[0]) : ''}</p>`;
      h += `<h3>${tt('Soil and rock', 'ដី និងថ្ម')}</h3>` + tbl([[tt('Topsoil at the centre', 'ដីស្រទាប់លើនៅកណ្ដាល'), P.soil ? `${esc(t(P.soil.cls))} (${t('sand')} ${n0(P.soil.sand)}% · ${t('clay')} ${n0(P.soil.clay)}%)` : tt('no data', 'គ្មានទិន្នន័យ')], [tt('Geology', 'ភូគព្ភសាស្ត្រ'), P.geo ? esc(t(P.geo)) : tt('no data', 'គ្មានទិន្នន័យ')]]);
      if (P.clim) h += `<h3>${tt('Climate', 'អាកាសធាតុ')}</h3><p>${esc(this.profileText(P).find(l => /°C/.test(l)) || '')}</p><figure class="one"><img src="${this.climateChart(P.clim, 700, 230).toDataURL()}"><figcaption>${tt('Monthly rain (bars) and mean temperature (line), 2015–2024', 'ទឹកភ្លៀងប្រចាំខែ (ជួរឈរ) និងសីតុណ្ហភាពមធ្យម (ខ្សែ) ២០១៥–២០២៤')}</figcaption></figure>`;
      h += `<h3>${tt('Land cover', 'គម្របដី')}</h3>` + bar(S.lc.map(([k, p]) => [esc(lcName(k)), p, LC[k][2]])) + `<figure class="one"><img src="${lcm}"><figcaption>${tt('Land cover classified from the satellite image, with roads', 'គម្របដីចាត់ថ្នាក់ពីរូបភាពផ្កាយរណប និងផ្លូវ')}</figcaption></figure>`;
    }
    if (sec.includes('human')) {
      h += H2('Human geography', 'ភូមិសាស្ត្រមនុស្ស');
      let POP = null; try { POP = await this.population(); } catch (e) { console.warn('population', e); }
      const pv = POP && POP.prov, ag = this.ageStats(pv);
      h += `<h3>${tt('Population', 'ប្រជាជន')}</h3>` + tbl([[tt('Population of the study area', 'ប្រជាជនក្នុងតំបន់សិក្សា'), POP ? `≈ ${n0(Math.round(POP.total / 10) * 10)} (WorldPop 2020, ${tt('fitted to the 2019 census', 'កែតម្រូវតាមជំរឿន ២០១៩')})` : ''], [tt('Population density', 'ដង់ស៊ីតេប្រជាជន'), POP ? `${n0(POP.density)} ${tt('people', 'នាក់')}/${U('km')}²` : ''],
        [tt('Estimate from buildings (4.3 per building)', 'ប៉ាន់ស្មានពីអគារ (៤,៣ នាក់ក្នុងមួយអគារ)'), `≈ ${n0(S.people)}`],
        [tt('Province (2019 census)', 'ខេត្ត (ជំរឿន ២០១៩)'), pv ? `${esc(K ? pv.km : pv.en)}: ${n0(pv.pop2019)} ${tt('people', 'នាក់')}, ${n0(pv.hh2019)} ${tt('households', 'គ្រួសារ')}, ${n0(pv.hhsize, 1)} ${tt('per household', 'នាក់ក្នុងមួយគ្រួសារ')}, ${n0(pv.pop2019 / pv.area)} / ${U('km')}²` : ''],
        [tt('Age groups (province, 2024 projection)', 'ក្រុមអាយុ (ខេត្ត ការព្យាករ ២០២៤)'), ag ? `0–14: ${n0(ag.young, 1)}% · 15–64: ${n0(ag.work, 1)}% · 65+: ${n0(ag.old, 1)}%` : ''], [tt('Dependency ratio', 'អនុបាតអ្នកនៅក្នុងបន្ទុក'), ag ? n0(ag.dep, 1) : ''], [tt('Sex ratio (men per 100 women)', 'អនុបាតភេទ (ប្រុសក្នុងស្រី ១០០)'), ag ? n0(ag.sexRatio, 1) : '']])
        + (pv && pv.proj2024 ? `<figure class="one"><img src="${this.pyramid(pv, 700, 330).toDataURL()}"><figcaption>${tt('Population pyramid of the province, 2024 projection (NIS)', 'ពីរ៉ាមីតប្រជាជនរបស់ខេត្ត ការព្យាករ ២០២៤ (វិទ្យាស្ថានជាតិស្ថិតិ)')}</figcaption></figure>` : '');
      const SL = await this.settlements(); h += `<h3>${tt('Settlements', 'ការតាំងទីលំនៅ')}</h3>` + tbl([[tt('Buildings', 'អគារ'), n0(S.houses)], [tt('Building density', 'ដង់ស៊ីតេអគារ'), `${n0(S.density)} / ${U('km')}²`],
        [tt('Settlement pattern (nearest-neighbour index R)', 'លំនាំការតាំងទីលំនៅ (សន្ទស្សន៍ R)'), nni == null ? '' : `R = ${n0(nni, 2)} → ${pat}`]])
        + (SL.length ? `<table class="grid"><tr><th>#</th><th>${tt('Form', 'រូបរាង')}</th><th>${tt('Buildings', 'អគារ')}</th><th>${tt('Area', 'ផ្ទៃ')}</th><th>${tt('Buildings per ha', 'អគារក្នុង ១ ហ.ត')}</th><th>${tt('Near a road', 'ជិតផ្លូវ')}</th></tr>` + SL.slice(0, 12).map((t2, i) => `<tr><td>${n0(i + 1)}</td><td><i style="display:inline-block;width:10px;height:10px;background:${SETTLE[t2.shape][2]}"></i> ${esc(K ? SETTLE[t2.shape][1] : SETTLE[t2.shape][0])}</td><td>${n0(t2.n)}</td><td>${U2(t2.area / 1e4)} ${U('ha')}</td><td>${n0(t2.dens, 1)}</td><td>${n0(t2.nearRoad * 100)}%</td></tr>`).join('') + '</table>'
          + `<figure class="one"><img src="${this.settlementMap(SL)}"><figcaption>${tt('Settlements found from the buildings (groups within 45 m), coloured by form', 'ការតាំងទីលំនៅរកឃើញពីអគារ (ក្រុមក្នុង ៤៥ ម) ពណ៌តាមរូបរាង')}</figcaption></figure>` : '');
      h += `<h3>${tt('Transport', 'ការដឹកជញ្ជូន')}</h3>` + tbl([[tt('Main roads', 'ផ្លូវធំ'), `${U2(S.roads.main)} ${U('km')}`], [tt('Local roads', 'ផ្លូវតូច'), `${U2(S.roads.local)} ${U('km')}`], [tt('Tracks and paths', 'ផ្លូវលំ'), `${U2(S.roads.track)} ${U('km')}`], [tt('Road density', 'ដង់ស៊ីតេផ្លូវ'), `${U2((S.roads.main + S.roads.local + S.roads.track) / S.areaKm2)} ${U('km')}/${U('km')}²`]]);
      const N = P.near || {}, nm = o => o ? `${esc(K ? (o.nk || o.ne) : (o.ne || o.nk)) || tt('name not mapped', 'មិនមានឈ្មោះ')} (${U2(o.d / 1000)} ${U('km')})` : tt('none found within 4.5 km', 'រកមិនឃើញក្នុង ៤,៥ គ.ម');
      h += `<h3>${tt('Services', 'សេវាសាធារណៈ')}</h3>` + tbl([[tt('Schools within 4.5 km', 'សាលារៀនក្នុង ៤,៥ គ.ម'), n0((N.schools || []).length)], [tt('Nearest school', 'សាលារៀនជិតបំផុត'), nm((N.schools || [])[0])], [tt('Health centres within 4.5 km', 'មណ្ឌលសុខភាពក្នុង ៤,៥ គ.ម'), n0((N.health || []).length)], [tt('Nearest health centre', 'មណ្ឌលសុខភាពជិតបំផុត'), nm((N.health || [])[0])], [tt('Wats within 4.5 km', 'វត្តក្នុង ៤,៥ គ.ម'), n0((N.wats || []).length)], [tt('Nearest market', 'ផ្សារជិតបំផុត'), nm((N.markets || [])[0])]]);
      if (this.data.access) { const r = this.data.access; h += `<p>${tt(`Access (${r.kind}, ${r.mode}): ${n0(r.within / Math.max(1, r.houses) * 100)}% of buildings are within ${r.lim} min; median ${U2(r.median)} min.`, `ការធ្វើដំណើរ៖ អគារ ${n0(r.within / Math.max(1, r.houses) * 100)}% ស្ថិតក្នុង ${n0(r.lim)} នាទី មធ្យមភាគ ${U2(r.median)} នាទី។`)}</p>`; }
    }
    if (sec.includes('hazard')) {
      h += H2('Flood exposure', 'ការប្រឈមនឹងទឹកជំនន់') + `<p>${tt(`If the water rises above its normal level (≈ ${n0(S.base)} m above sea level):`, `ប្រសិនបើទឹកឡើងលើសនីវ៉ូធម្មតា (≈ ${n0(S.base)} ម ពីនីវ៉ូទឹកសមុទ្រ)៖`)}</p>`
        + `<table class="grid"><tr><th>${tt('Rise', 'ទឹកឡើង')}</th><th>${tt('Buildings', 'អគារ')}</th><th>${tt('People (est.)', 'ប្រជាជន (ប៉ាន់ស្មាន)')}</th><th>${tt('Roads', 'ផ្លូវ')}</th><th>${tt('Rice & grass', 'ស្រែ និងវាលស្មៅ')}</th><th>${tt('Land', 'ដី')}</th></tr>`
        + S.flood.map(([rise, r]) => `<tr><td>+${n0(rise)} ${U('m')}</td><td>${n0(r.houses)}</td><td>${n0(r.people)}</td><td>${U2(r.roadKm)} ${U('km')}</td><td>${U2(r.cropHa)} ${U('ha')}</td><td>${U2(r.areaHa)} ${U('ha')}</td></tr>`).join('') + '</table>'
        + `<p class="note">${tt('Terrain model: places lower than the new level that the water can reach from the river or lake are flooded. A first estimate, not a forecast; dykes and drains are not in the terrain.', 'គំរូលើកម្ពស់ដី៖ កន្លែងដែលទាបជាងនីវ៉ូថ្មី ហើយទឹកពីទន្លេ ឬបឹងអាចហូរទៅដល់ ត្រូវរាប់ថាលិចទឹក។ ជាការប៉ាន់ស្មានដំបូង មិនមែនការព្យាករណ៍ទេ ទំនប់ និងប្រឡាយមិនមាននៅក្នុងទម្រង់ដីទេ។')}</p>`;
    }
    if (sec.includes('change') && this.TM) { h += H2('Change over time', 'ការផ្លាស់ប្ដូរតាមពេលវេលា') + '<ul>' + this.tmStory().map(l => `<li>${esc(l)}</li>`).join('') + `</ul><figure class="one"><img src="${this.tmChart(700, 220).toDataURL()}"><figcaption>${tt('Land cover area by year (red built, orange crops, green trees, blue water)', 'ផ្ទៃគម្របដីតាមឆ្នាំ (ក្រហម សំណង់ ទឹកក្រូច ដំណាំ បៃតង ដើមឈើ ខៀវ ទឹក)')}</figcaption></figure>`; }
    if (opt.notes) h += H2('Field notes and discussion', 'កំណត់ត្រាវាល និងការពិភាក្សា') + '<div class="notes">' + '<i></i>'.repeat(10) + '</div>';
    h += H2('Data and methods', 'ទិន្នន័យ និងវិធីសាស្ត្រ') + `<p class="note">${tt('Terrain: AWS Terrain Tiles; imagery: Esri World Imagery; roads, buildings and places: OpenStreetMap; land cover: classified from the image in the app (and Esri | Impact Observatory for change); soil: ISRIC SoilGrids; geology: Open Development Cambodia; climate: Open-Meteo ERA5 2015–2024; forest loss: Hansen Global Forest Change. Streams and catchments from depression-filled terrain (D8). Population: WorldPop 2020 (100 m) fitted to the 2019 General Population Census province totals; age and sex: NIS 2024 province projections (HDX). Landforms from slope, height above the nearest stream (HAND) and topographic position (TPI). Settlements: buildings grouped within 45 m (DBSCAN), form from elongation and closeness to roads and water. All figures are automatic estimates for study and should be checked in the field.', 'ទម្រង់ដី៖ AWS Terrain Tiles · រូបភាព៖ Esri World Imagery · ផ្លូវ អគារ និងទីកន្លែង៖ OpenStreetMap · គម្របដី៖ ចាត់ថ្នាក់ពីរូបភាពក្នុងកម្មវិធី (និង Esri | Impact Observatory សម្រាប់ការផ្លាស់ប្ដូរ) · ដី៖ ISRIC SoilGrids · ភូគព្ភសាស្ត្រ៖ Open Development Cambodia · អាកាសធាតុ៖ Open-Meteo ERA5 ២០១៥–២០២៤ · ព្រៃបាត់បង់៖ Hansen Global Forest Change។ អូរ និងអាងទឹកពីទម្រង់ដីដែលបំពេញទីទាប (D8)។ ប្រជាជន៖ WorldPop ២០២០ (១០០ ម) កែតម្រូវតាមចំនួនប្រជាជនខេត្តនៃជំរឿនទូទៅ ២០១៩ · អាយុ និងភេទ៖ ការព្យាករខេត្ត ២០២៤ របស់វិទ្យាស្ថានជាតិស្ថិតិ (HDX)។ ទម្រង់ភូមិសាស្ត្រពីជម្រាល កម្ពស់ពីអូរជិតបំផុត (HAND) និងទីតាំងសណ្ឋានដី (TPI)។ ការតាំងទីលំនៅ៖ អគារដាក់ជាក្រុមក្នុង ៤៥ ម (DBSCAN) រូបរាងពីភាពវែង និងភាពជិតផ្លូវ និងទឹក។ តួលេខទាំងអស់ជាការប៉ាន់ស្មានដោយស្វ័យប្រវត្តិសម្រាប់ការសិក្សា ហើយគួរពិនិត្យនៅទីវាល។')}</p>`;
    const ttl = opt.title || tt('Geographical study of the area', 'ការសិក្សាភូមិសាស្ត្រនៃតំបន់');
    const html = `<!DOCTYPE html><html lang="${K ? 'km' : 'en'}"><head><meta charset="utf-8"><title>${esc(ttl)}</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;700&family=Noto+Serif+Khmer:wght@600&display=swap" rel="stylesheet"><style>
      @page{size:A4;margin:16mm 15mm} body{font-family:"Noto Sans Khmer",system-ui,sans-serif;color:#1a1a1a;font-size:11pt;line-height:1.6;max-width:180mm;margin:auto}
      .cover{border-bottom:3px solid #1f4e79;margin-bottom:10px;padding-bottom:6px} .cover h1{font-family:"Noto Serif Khmer",Georgia,serif;font-size:20pt;color:#1f4e79;margin:0} .cover .sub{color:#444} .cover .by{font-size:9.5pt;color:#555;margin-top:4px}
      h2{font-size:14pt;color:#1f4e79;border-bottom:1px solid #c9d6e3;margin:18px 0 6px;break-after:avoid} h3{font-size:11.5pt;margin:12px 0 4px;color:#2b4a63;break-after:avoid}
      table{border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:10pt} td,th{border-bottom:1px solid #ddd;padding:3px 6px;text-align:left;vertical-align:top} td:first-child{color:#444;width:45%} table.grid td:first-child{width:auto} th{background:#eef3f8}
      .imgs{display:grid;grid-template-columns:1fr 1fr;gap:8px} figure{margin:6px 0;break-inside:avoid} figure img{width:100%;border:1px solid #999} figure.one img{max-height:120mm;object-fit:contain} figcaption{font-size:8.5pt;color:#555}
      .bars div{display:grid;grid-template-columns:42% 1fr 40px;align-items:center;gap:6px;font-size:10pt;margin:2px 0} .bars i{display:block;height:11px;border-radius:3px} .bars b{font-weight:600;text-align:right}
      .note{font-size:9pt;color:#555} .notes i{display:block;border-bottom:1px dotted #888;height:26px} @media screen{body{padding:14px}.bar{position:sticky;top:0;background:#fffbe6;padding:6px;border:1px solid #e0c060;margin-bottom:10px}} @media print{.bar{display:none}}
    </style></head><body><div class="bar"><button onclick="print()">🖨 ${tt('Print / save as PDF', 'បោះពុម្ព / រក្សាទុក PDF')}</button></div>
    <div class="cover"><h1>${esc(ttl)}</h1><div class="sub">📍 ${esc(place || `${F.lat0.toFixed(4)}°N ${F.lon0.toFixed(4)}°E`)}</div>
    <div class="by">${opt.author ? esc(opt.author) + ' · ' : ''}${tt('Department of Geography and Land Management, Royal University of Phnom Penh', 'ដេប៉ាតឺម៉ង់ភូមិសាស្ត្រ និងគ្រប់គ្រងដីធ្លី សាកលវិទ្យាល័យភូមិន្ទភ្នំពេញ')} · ${new Date().toLocaleDateString(K ? 'km-KH' : 'en-GB')}</div></div>
    ${h}<p class="note">${tt('Made with Cambodia 3D · Geoinformatics and Research Lab, RUPP', 'បង្កើតដោយ Cambodia 3D · ក្រុមស្រាវជ្រាវ និងអភិវឌ្ឍន៍ព័ត៌មានភូមិសាស្ត្រ RUPP')}</p></body></html>`;
    say(''); if (win) { win.document.open(); win.document.write(html); win.document.close(); }
    return { html, sections: n };
  }

  /* ================= 7. Field trip ================= */
  loadTrip() { try { return JSON.parse(localStorage.getItem('cambodia3d.trip') || 'null') || { stops: [], obs: [] }; } catch (e) { return { stops: [], obs: [] }; } }
  saveTrip() { try { localStorage.setItem('cambodia3d.trip', JSON.stringify(this.trip)); } catch (e) { console.warn('trip too large to keep', e); } }
  drawTrip() { this.clear(); const F = this.F;
    this.trip.stops.forEach((s, i) => { const x = F.x(s.lon), z = F.z(s.lat); if (this.inside(x, z)) this.pin(x, z, `${i + 1}. ${s.title || t('Stop')}`, '#ffd23f'); });
    const COL = { rice: '#d8c24a', trees: '#2f9d48', houses: '#e0574a', water: '#3b8fd9', bare: '#b98a5a', road: '#888888', other: '#c06bff' };
    for (const o of this.trip.obs) { const x = F.x(o.lon), z = F.z(o.lat); if (!this.inside(x, z)) continue; const s = this.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshBasicMaterial({ color: COL[o.lu] || '#fff', depthTest: false }))); s.position.set(x, this.w.hAt(x, z) + 2, z); s.renderOrder = 40; }
    if (this.me) this.showMe(this.me); }
  showMe(p) { const F = this.F, x = F.x(p.lon), z = F.z(p.lat); this.me = p; if (!this.meMesh) { this.meMesh = new THREE.Group(); const dot = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x1e88ff, depthTest: false })); dot.renderOrder = 42;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1e88ff, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide })); ring.renderOrder = 41; this.meMesh.add(dot, ring); this.meMesh.userData.ring = ring; }
    if (!this.meMesh.parent) this.w.root.add(this.meMesh); const y = this.w.hAt(x, z); this.meMesh.position.set(x, y + 2, z); this.meMesh.userData.ring.scale.setScalar(Math.max(3, p.acc || 10)); this.meMesh.userData.ring.position.y = -1.8;
    return this.inside(x, z); }
  nearStop(p, r = 30) { const F = this.F; let best = null, bd = r; this.trip.stops.forEach((s, i) => { const d = Math.hypot(F.x(s.lon) - F.x(p.lon), F.z(s.lat) - F.z(p.lat)); if (d < bd) { bd = d; best = i; } }); return best; }
  toGeoJSON() { return { type: 'FeatureCollection', name: 'cambodia3d_fieldtrip', features: [
    ...this.trip.stops.map((s, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { kind: 'stop', n: i + 1, title: s.title, task: s.task } })),
    ...this.trip.obs.map(o => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [o.lon, o.lat] }, properties: { kind: 'observation', who: o.who, time: o.time, stop: o.stop, landuse: o.lu, note: o.note, photo: o.photo || null } }))] }; }
  importGeoJSON(j) { let s = 0, o = 0; for (const f of j.features || []) { const [lon, lat] = f.geometry.coordinates, p = f.properties || {};
      if (p.kind === 'stop') { if (!this.trip.stops.some(q => Math.abs(q.lon - lon) < 1e-6 && Math.abs(q.lat - lat) < 1e-6)) { this.trip.stops.push({ lon, lat, title: p.title, task: p.task }); s++; } }
      else if (!this.trip.obs.some(q => q.time === p.time && q.who === p.who)) { this.trip.obs.push({ lon, lat, who: p.who, time: p.time, stop: p.stop, lu: p.landuse, note: p.note, photo: p.photo }); o++; } }
    this.saveTrip(); return { s, o }; }
}
