// Geography in hand: one tap answers a geography question about a place, with all the GIS steps done in the background.
// 1 Place profile · 2 Time machine · 3 What if (flood, heavy rain) · 4 Where does the rain go · 5 Access to services
// 6 Worksheet maker · 7 Field trip (GPS, stops, observations)
import * as THREE from 'three';
import { t, lang } from './i18n.js?v=98';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const km = () => lang === 'km';
const NUMKM = '០១២៣៤៥៦៧៨៩';
const n0 = (v, d = 0) => { if (v == null || !isFinite(v)) return '–'; const s = Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); return km() ? s.replace(/\d/g, c => NUMKM[c]) : s; };
const LC = { 1: ['Water', 'ទឹក', '#3b8fd9'], 2: ['Trees', 'ដើមឈើ', '#2f7d3a'], 3: ['Rice fields & grass', 'ស្រែ និងវាលស្មៅ', '#d8c24a'], 4: ['Bare soil', 'ដីទទេ', '#b98a5a'], 5: ['Houses & roads', 'ផ្ទះ និងផ្លូវ', '#c4413a'] };
const lcName = k => LC[k] ? (km() ? LC[k][1] : LC[k][0]) : '';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MONTHS_KM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const month = i => km() ? MONTHS_KM[i] : MONTHS[i];
const DIRS = [['north', 'ខាងជើង'], ['north-east', 'ឦសាន'], ['east', 'ខាងកើត'], ['south-east', 'អាគ្នេយ៍'], ['south', 'ខាងត្បូង'], ['south-west', 'នីរតី'], ['west', 'ខាងលិច'], ['north-west', 'ពាយ័ព្យ']];
const dirName = (dx, dz) => { const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360 + 22.5) % 360; const d = DIRS[Math.floor(a / 45) % 8]; return km() ? d[1] : d[0]; };

function label(text, color = '#fff', bg = 'rgba(10,20,30,.82)') {
  const c = document.createElement('canvas'), g = c.getContext('2d'), f = 'bold 30px system-ui, "Noto Sans Khmer", sans-serif'; g.font = f;
  const w = Math.ceil(g.measureText(text).width) + 28; c.width = w; c.height = 46; g.font = f; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, 46, 12); g.fill(); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 14, 24);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, sizeAttenuation: false })); s.center.set(0.5, 0); s.scale.set(0.0012 * w, 0.0012 * 46, 1); s.renderOrder = 40; return s;
}

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
  get D() { return this.w.D; } get F() { return this.w.F; }
  /* ---------- helpers ---------- */
  rawAt(x, z) { const D = this.D, fi = THREE.MathUtils.clamp((x - D.X0) / D.dx, 0, D.nx), fj = THREE.MathUtils.clamp((z - D.Z0) / D.dz, 0, D.nz), i = Math.min(D.nx - 1, Math.floor(fi)), j = Math.min(D.nz - 1, Math.floor(fj)), u = fi - i, v = fj - j, R = D.nx + 1, r = D.raw;
    return (r[j * R + i] * (1 - u) + r[j * R + i + 1] * u) * (1 - v) + (r[(j + 1) * R + i] * (1 - u) + r[(j + 1) * R + i + 1] * u) * v; }
  clsAt(x, z) { const D = this.D, i = Math.min(D.gw - 1, Math.max(0, ((x - D.X0) / D.C) | 0)), j = Math.min(D.gh - 1, Math.max(0, ((z - D.Z0) / D.C) | 0)); return D.cls[j * D.gw + i]; }
  inside(x, z) { const D = this.D; return x > D.X0 && z > D.Z0 && x < D.X0 + D.W && z < D.Z0 + D.H; }
  clear() { this.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); this.g.clear(); if (this.g.parent) this.g.parent.remove(this.g);
    if (this.w._ghOverlay) { this.w.setCompare(null); this.w._ghOverlay = false; } if (this.UM) this.UM.unpaint(this.w); if (this.anim) { cancelAnimationFrame(this.anim); this.anim = 0; } }
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
  pin(x, z, text, color = '#ffd23f') { const y = this.w.hAt(x, z); const s = this.add(label(text, color)); s.position.set(x, y + 4, z);
    const st = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4, 6).translate(0, 2, 0), new THREE.MeshBasicMaterial({ color }))); st.position.set(x, y, z); return s; }
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
      import('./placeinfo.js?v=98').then(m => m.adminAt(lat, lon)).catch(() => null),
      this.U ? Promise.resolve(this.U) : Promise.race([import('./section.js?v=98').then(async m => { this.SM = m; this.U = await m.loadUnderground(this.w, s => this.say(t(s))); return this.U; }), new Promise(r => setTimeout(() => r(null), 25000))]).catch(() => null), // soil and rock (SoilGrids can be slow)
      this.climate(lat, lon), this.nearby(lon, lat)]);
    P.adm = adm; P.clim = clim; P.near = near;
    if (U && this.SM) { const gk = this.SM.geologyAt(U, lon, lat), gu = this.SM.UNITS[gk]; P.geo = gu ? gu.n : null; const s = this.SM.soilAt(U, lon, lat, 0); P.soil = s.cls !== 'No data' ? s : null; }
    void H; this.data.profile = P; return P;
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
    return { villages: by(['village', 'hamlet', 'town', 'city', 'neighbourhood']), schools: by(['school', 'kindergarten', 'college', 'university']), health: by(['hospital', 'clinic', 'doctors', 'health_post']), wats: by(['place_of_worship']), markets: by(['marketplace']) };
  }
  profileText(P) {
    const nm = o => o ? (km() ? (o.nk || o.ne) : (o.ne || o.nk)) : '', A = P.adm, L = [];
    const flat = P.slope < 2 ? ['flat land', 'ដីរាបស្មើ'] : P.slope < 8 ? ['gently sloping land', 'ដីជម្រាលតិច'] : P.slope < 20 ? ['a hillside', 'ជម្រាលភ្នំ'] : ['a steep slope', 'ជម្រាលចោត'];
    const where = A ? (km() ? `${A.com_km || A.com_en} ស្រុក${A.dis_km || A.dis_en} ខេត្ត${A.pro_km || A.pro_en}` : `${A.com_en} commune, ${A.dis_en} district, ${A.pro_en} province`) : '';
    const v = P.near && P.near.villages[0];
    if (km()) {
      L.push(`ទីតាំងនេះស្ថិតនៅកម្ពស់ ${n0(P.elev)} ម៉ែត្រពីនីវ៉ូទឹកសមុទ្រ លើ${flat[1]} (ជម្រាល ${n0(P.slope, 1)}°)${where ? ' ក្នុងឃុំ' + where : ''}។`);
      if (v) L.push(`ភូមិជិតបំផុតគឺ ${nm(v)} (${n0(v.d / 1000, 1)} គ.ម)។`);
      if (P.lc.length) L.push(`ក្នុងរង្វង់ ៥០០ ម៉ែត្រ ដីភាគច្រើនជា${lcName(P.lc[0][0])} (${n0(P.lc[0][1])}%)${P.lc[1] ? ' បន្ទាប់មក' + lcName(P.lc[1][0]) + ' (' + n0(P.lc[1][1]) + '%)' : ''}។ មានផ្ទះប្រហែល ${n0(P.houses)} ក្នុងរង្វង់ ១ គ.ម (ប្រជាជនប្រហែល ${n0(P.people)} នាក់)។`);
      if (P.soil || P.geo) L.push(`${P.soil ? 'ដីខាងលើជាប្រភេទ ' + t(P.soil.cls) + '។ ' : ''}${P.geo ? 'ថ្មខាងក្រោម៖ ' + t(P.geo) + '។' : ''}`);
      if (P.clim) L.push(`អាកាសធាតុក្ដៅពេញមួយឆ្នាំ (${n0(Math.min(...P.clim.T))}–${n0(Math.max(...P.clim.T))} °C)។ ទឹកភ្លៀងប្រហែល ${n0(P.clim.year)} ម.ម ក្នុងមួយឆ្នាំ${P.clim.wet.length ? ' ភាគច្រើនពីខែ' + month(P.clim.wet[0]) + ' ដល់ខែ' + month(P.clim.wet[P.clim.wet.length - 1]) : ''}។`);
      if (P.flow) L.push(`ទឹកភ្លៀងដែលធ្លាក់នៅទីនេះហូរ ${n0(P.flow.len)} ម៉ែត្រ ទៅទិស${P.flow.dir} ${P.flow.end === 'edge' ? 'ចេញពីតំបន់' : 'ទៅកាន់ទីទាប ឬត្រពាំង'} (ចុះ ${n0(P.flow.drop, 1)} ម៉ែត្រ)។`);
    } else {
      L.push(`This place is ${n0(P.elev)} m above sea level on ${flat[0]} (slope ${n0(P.slope, 1)}°)${where ? ', in ' + where : ''}.`);
      if (v) L.push(`The nearest village is ${nm(v)} (${n0(v.d / 1000, 1)} km).`);
      if (P.lc.length) L.push(`Within 500 m the land is mostly ${lcName(P.lc[0][0]).toLowerCase()} (${n0(P.lc[0][1])}%)${P.lc[1] ? ', then ' + lcName(P.lc[1][0]).toLowerCase() + ' (' + n0(P.lc[1][1]) + '%)' : ''}. About ${n0(P.houses)} houses stand within 1 km (roughly ${n0(P.people)} people).`);
      if (P.soil || P.geo) L.push(`${P.soil ? 'The topsoil is ' + P.soil.cls.toLowerCase() + '. ' : ''}${P.geo ? 'The rock below is ' + P.geo.toLowerCase() + '.' : ''}`);
      if (P.clim) L.push(`It is hot all year (${n0(Math.min(...P.clim.T))}–${n0(Math.max(...P.clim.T))} °C monthly mean) with about ${n0(P.clim.year)} mm of rain a year${P.clim.wet.length ? ', mostly from ' + month(P.clim.wet[0]) + ' to ' + month(P.clim.wet[P.clim.wet.length - 1]) : ''}.`);
      if (P.flow) L.push(`Rain falling here runs ${n0(P.flow.len)} m to the ${P.flow.dir} ${P.flow.end === 'edge' ? 'and leaves the area' : 'into a low spot or pond'} (${n0(P.flow.drop, 1)} m lower).`);
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
    const row = (k, v) => v ? `<tr><td>${t(k)}</td><td>${v}</td></tr>` : '', nm = o => o ? esc(km() ? (o.nk || o.ne) : (o.ne || o.nk)) + ` <small>${n0(o.d / 1000, 1)} km</small>` : '';
    const A = P.adm, N = P.near || {};
    return `<div class="ghText">${this.profileText(P).map(esc).join(' ')}</div>
      <table class="ghTab">${row('Province / district / commune', A ? esc(km() ? `${A.pro_km || A.pro_en} / ${A.dis_km || A.dis_en} / ${A.com_km || A.com_en}` : `${A.pro_en} / ${A.dis_en} / ${A.com_en}`) : '')}
      ${row('Position', `${P.lat.toFixed(5)}°N ${P.lon.toFixed(5)}°E`)}${row('Elevation', n0(P.elev) + ' m')}${row('Slope', n0(P.slope, 1) + '°')}${row('Height difference within 500 m', n0(P.relief) + ' m')}
      ${row('Land cover within 500 m', P.lc.slice(0, 4).map(([k, p]) => `<i class="ghSw" style="background:${LC[k][2]}"></i>${esc(lcName(k))} ${n0(p)}%`).join('<br>'))}
      ${row('Topsoil', P.soil ? `${esc(t(P.soil.cls))} (${t('sand')} ${n0(P.soil.sand)}% · ${t('clay')} ${n0(P.soil.clay)}%)` : '')}${row('Rock below', P.geo ? esc(t(P.geo)) : '')}
      ${row('Houses within 1 km', `${n0(P.houses)} (≈ ${n0(P.people)} ${t('people')})`)}
      ${row('Nearest village', nm(N.villages && N.villages[0]))}${row('Nearest school', nm(N.schools && N.schools[0]))}${row('Nearest health centre', nm(N.health && N.health[0]))}${row('Nearest wat', nm(N.wats && N.wats[0]))}${row('Nearest market', nm(N.markets && N.markets[0]))}
      ${row('Rain falling here', P.flow ? `${n0(P.flow.len)} m → ${esc(P.flow.dir)}, ${n0(P.flow.drop, 1)} m ${t('lower')}` : '')}</table>
      ${P.clim ? `<div class="ghSub">${t('Climate (monthly average)')}</div><img class="ghChart" src="${this.climateChart(P.clim).toDataURL()}"><div class="ghSrc">${t('Rain')} ${n0(P.clim.year)} mm/${t('year')} · ${P.clim.src}</div>` : ''}
      <div class="ghSrc">${t('Sources')}: ${t('terrain and land cover of the 3D area')}, SoilGrids, ODC ${t('geology')}, OpenStreetMap, Open-Meteo. ${t('People are estimated from the houses (4.3 per house).')}</div>`;
  }

  /* ================= 4. Where does the rain go ================= */
  flowPath(x, z) {
    const D = this.D, H = this.hydro(), NX = H.NX, i0 = Math.round((x - D.X0) / D.dx), j0 = Math.round((z - D.Z0) / D.dz); let k = Math.max(0, Math.min(H.N - 1, j0 * NX + i0)); const pts = [], start = k;
    for (let s = 0; s < 20000; s++) { pts.push([D.X0 + (k % NX) * D.dx, D.Z0 + ((k / NX) | 0) * D.dz]); const d = H.dir[k]; if (d < 0) break; k = d; }
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const i = k % NX, j = (k / NX) | 0, edge = i === 0 || j === 0 || i === NX - 1 || j === H.NZ - 1, e = pts[pts.length - 1];
    return { pts, start, end: k, info: { len, drop: D.raw[start] - D.raw[k], dir: dirName(e[0] - pts[0][0], e[1] - pts[0][1]), end: edge ? 'edge' : 'pond' } };
  }
  catchment(k0) { const H = this.hydro(), up = new Uint8Array(H.N), kids = new Int32Array(H.N + 1), list = new Int32Array(H.N);
    for (let k = 0; k < H.N; k++) if (H.dir[k] >= 0) kids[H.dir[k] + 1]++; for (let k = 0; k < H.N; k++) kids[k + 1] += kids[k]; const fill = kids.slice();
    for (let k = 0; k < H.N; k++) { const d = H.dir[k]; if (d >= 0) list[fill[d]++] = k; }
    const st = [k0]; up[k0] = 1; let n = 0; while (st.length) { const k = st.pop(); n++; for (let q = kids[k]; q < kids[k + 1]; q++) { const c = list[q]; if (!up[c]) { up[c] = 1; st.push(c); } } }
    return { up, n, ha: n * H.cellA / 1e4 }; }
  streams(minHa = 3) { const D = this.D, H = this.hydro(), thr = minHa * 1e4 / H.cellA, NX = H.NX, segs = [];
    for (let k = 0; k < H.N; k++) { if (H.acc[k] < thr || H.dir[k] < 0) continue; const d = H.dir[k]; segs.push([[D.X0 + (k % NX) * D.dx, D.Z0 + ((k / NX) | 0) * D.dz], [D.X0 + (d % NX) * D.dx, D.Z0 + ((d / NX) | 0) * D.dz], H.acc[k] * H.cellA / 1e4]); }
    return segs; }
  showStreams() { const segs = this.streams(); if (!segs.length) return 0; const pos = [], idx = []; let v = 0;
    for (const [a, b, ha] of segs) { const w = Math.min(6, 1 + Math.log10(ha) * 1.6), ya = this.w.hAt(a[0], a[1]) + 0.6, yb = this.w.hAt(b[0], b[1]) + 0.6, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l * w / 2, nz = (b[0] - a[0]) / l * w / 2;
      pos.push(a[0] + nx, ya, a[1] + nz, a[0] - nx, ya, a[1] - nz, b[0] + nx, yb, b[1] + nz, b[0] - nx, yb, b[1] - nz); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); v += 4; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2aa8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false })); m.renderOrder = 30; this.add(m); return segs.length; }
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
  waterBase() { const D = this.D, H = this.hydro(); let lo = Infinity; for (let k = 0; k < H.N; k++) lo = Math.min(lo, D.raw[k]); const water = []; const NX = H.NX;
    for (let k = 0; k < H.N; k += 3) { const x = D.X0 + (k % NX) * D.dx, z = D.Z0 + ((k / NX) | 0) * D.dz; if (this.clsAt(x, z) === 1) water.push(D.raw[k]); }
    water.sort((a, b) => a - b); return water.length > 30 ? water[Math.floor(water.length * 0.5)] : lo; }
  flood(rise) {
    const D = this.D, H = this.hydro(), base = this.waterBase(), lvl = base + rise, NX = H.NX;
    const fl = new Uint8Array(H.N); for (let k = 0; k < H.N; k++) if (D.raw[k] < lvl) fl[k] = 1;
    this.clear(); this.overlay(this.gridCanvas(k => fl[k] ? [30, 110, 230, Math.min(230, 90 + (lvl - D.raw[k]) * 40)] : null));
    const flAt = (x, z) => { const i = Math.round((x - D.X0) / D.dx), j = Math.round((z - D.Z0) / D.dz); return i >= 0 && j >= 0 && i < NX && j < H.NZ && fl[j * NX + i]; };
    return this.impacts(flAt, lvl, base);
  }
  async impacts(flAt, lvl, base) {
    const D = this.D, UM = this.UM || (this.UM = await import('./urban.js?v=98')), B = UM.buildingsOf(this.w), vals = B.map(b => flAt(b.x, b.z) ? 1 : 0), nb = vals.reduce((a, b) => a + b, 0);
    if (nb) UM.paint(this.w, B, vals.map(v => v ? 1 : 0.15), 0, 1); // flooded houses in yellow, the others dark
    let roadKm = 0; for (const r of this.w.net ? this.w.net.roads : []) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i]; if (flAt((a.x + b.x) / 2, (a.z + b.z) / 2)) roadKm += Math.hypot(b.x - a.x, b.z - a.z) / 1000; }
    let crop = 0, cells = 0; for (let j = 0; j < D.gh; j++) for (let i = 0; i < D.gw; i++) { const x = D.X0 + (i + 0.5) * D.C, z = D.Z0 + (j + 0.5) * D.C; if (D.cls[j * D.gw + i] === 3 && flAt(x, z)) crop++; if (flAt(x, z)) cells++; }
    const r = { lvl, base, houses: nb, people: Math.round(nb * 4.3), roadKm, cropHa: crop * D.C * D.C / 1e4, areaHa: cells * D.C * D.C / 1e4, total: B.length }; this.data.flood = r; return r;
  }
  heavyRain(mm) { // where the water stays: low spots that fill up (depressions), deeper with more rain
    const D = this.D, H = this.hydro(), depth = new Float32Array(H.N), NX = H.NX, scale = mm / 100;
    for (let k = 0; k < H.N; k++) { const d = H.fz[k] - D.raw[k]; if (d > 0.05) depth[k] = Math.min(d, d * scale); }
    const pond = (x, z) => { const i = Math.round((x - D.X0) / D.dx), j = Math.round((z - D.Z0) / D.dz); return i >= 0 && j >= 0 && i < NX && j < H.NZ && depth[j * NX + i] > 0.3 && this.clsAt(x, z) !== 1; };
    this.clear(); this.overlay(this.gridCanvas(k => { const x = D.X0 + (k % NX) * D.dx, z = D.Z0 + ((k / NX) | 0) * D.dz; return depth[k] > 0.1 && this.clsAt(x, z) !== 1 ? [20, 150, 255, Math.min(230, 70 + depth[k] * 120)] : null; }));
    return this.impacts(pond, null, null);
  }

  /* ================= 5. Access to services ================= */
  async access(kind, mode) {
    const D = this.D, F = this.F, UM = this.UM || (this.UM = await import('./urban.js?v=98')), a = D.aoi, pad = 0.03, bb = [a.w - pad, a.s - pad, a.e + pad, a.n + pad];
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
    for (const p of src) if (this.inside(p.x, p.z)) this.pin(p.x, p.z, { school: '🏫', health: '🏥', market: '🛒', wat: '🛕' }[kind] + (p.name ? ' ' + p.name.slice(0, 18) : ''), '#ffffff');
    const v = T.filter(x => x != null).sort((a, b) => a - b), within = v.filter(x => x <= lim).length;
    const r = { kind, mode, n: src.length, inArea: src.filter(p => this.inside(p.x, p.z)).length, houses: B.length, reached: v.length, within, lim, median: v.length ? v[Math.floor(v.length / 2)] : null, worst: v.length ? v[v.length - 1] : null };
    this.data.access = r; return r;
  }

  /* ================= 2. Time machine ================= */
  async timeMachine(say) {
    if (this.TM && this.TM.aoi === this.D.aoi) return this.TM; const D = this.D, a = D.aoi, LCm = await import('./landcover.js?v=98'), LY = await import('./layers.js?v=98');
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
    if (kind === 'top') { cam.position.set(0, D.S * 1.15, 0.01); ct.target.set(0, 0, 0); } else { cam.position.set(-D.S * 0.55, D.S * 0.45, D.S * 0.62); ct.target.set(0, 0, 0); }
    ct.update(); w.frame(); const url = w.renderer.domElement.toDataURL('image/jpeg', 0.85); cam.position.copy(p0); ct.target.copy(q0); ct.update(); return url; }
  async worksheet(opt, win) {
    const D = this.D, F = this.F, P = this.data.profile && opt.here ? this.data.profile : await this.profile(0, 0), topImg = this.snapshot('top'), obImg = this.snapshot('oblique'), K = km();
    const Q = [], mc = (q, right, wrong) => { const opts = [right, ...wrong].map(String); for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; } Q.push({ q, opts, a: opts.indexOf(String(right)) }); };
    const open = (q, a, lines = 3) => Q.push({ q, a, lines });
    const elev = Math.round(P.elev), top = P.lc[0] ? lcName(P.lc[0][0]) : '';
    const topics = opt.topics;
    if (topics.includes('physical')) {
      mc(K ? 'តើទីតាំងនេះមានកម្ពស់ប្រហែលប៉ុន្មានពីនីវ៉ូទឹកសមុទ្រ?' : 'About how high is this place above sea level?', `${elev} m`, [`${elev + 20 + Math.round(Math.random() * 20)} m`, `${Math.max(1, Math.round(elev / 3))} m`, `${elev * 4 + 50} m`]);
      mc(K ? 'តើដីនៅទីនេះមានរាងបែបណា?' : 'What is the land like here?', P.slope < 2 ? (K ? 'រាបស្មើ' : 'Flat') : P.slope < 8 ? (K ? 'ជម្រាលតិច' : 'Gently sloping') : (K ? 'ជម្រាលចោត' : 'Steep'), P.slope < 2 ? (K ? ['ជម្រាលចោត', 'ភ្នំខ្ពស់'] : ['Steep', 'High mountains']) : (K ? ['រាបស្មើ', 'ជាទន្លេ'] : ['Flat', 'A river']));
      if (P.soil) open(K ? `ដីខាងលើនៅទីនេះជាដី ${t(P.soil.cls)}។ តើដីប្រភេទនេះសមស្របសម្រាប់ដំណាំអ្វី? ហេតុអ្វី?` : `The topsoil here is ${P.soil.cls.toLowerCase()}. Which crops suit this soil, and why?`, K ? 'ចម្លើយផ្សេងៗ៖ ដីឥដ្ឋរក្សាទឹកបានល្អ សមស្របនឹងស្រូវ…' : 'Open answer: clay holds water, which suits rice; sandy soil drains fast…');
      open(K ? 'គូររូបព្រួញលើផែនទីខាងលើ ដើម្បីបង្ហាញទិសដែលទឹកភ្លៀងហូរ។' : 'Draw arrows on the map to show which way rain water flows.', P.flow ? (K ? `ទឹកហូរទៅទិស${P.flow.dir}` : `Water flows to the ${P.flow.dir}`) : '', 2);
    }
    if (topics.includes('landuse')) {
      mc(K ? 'តើការប្រើប្រាស់ដីណាដែលមានច្រើនជាងគេក្នុងរង្វង់ ៥០០ ម៉ែត្រ?' : 'Which land cover is most common within 500 m?', top, Object.keys(LC).map(Number).filter(k => !P.lc[0] || k !== P.lc[0][0]).slice(0, 3).map(lcName));
      open(K ? 'ចូរពិពណ៌នាពីរបៀបដែលប្រជាជននៅទីនេះប្រើប្រាស់ដី។ ផ្ដល់ឧទាហរណ៍ពីរ។' : 'Describe how people here use the land. Give two examples.', K ? `ឧទាហរណ៍៖ ${top} …` : `For example: ${top.toLowerCase()} …`);
      mc(K ? 'តើមានផ្ទះប្រហែលប៉ុន្មានក្នុងរង្វង់ ១ គ.ម?' : 'About how many houses are within 1 km?', n0(P.houses), [n0(Math.round(P.houses * 3 + 40)), n0(Math.max(2, Math.round(P.houses / 4))), n0(Math.round(P.houses * 10 + 500))]);
    }
    if (topics.includes('water')) {
      if (P.clim) { const wet = P.clim.R.indexOf(Math.max(...P.clim.R)), dry = P.clim.R.indexOf(Math.min(...P.clim.R));
        mc(K ? 'តើខែណាដែលមានភ្លៀងច្រើនជាងគេ?' : 'Which month has the most rain?', month(wet), [month(dry), month((wet + 4) % 12), month((wet + 7) % 12)]);
        open(K ? `ទឹកភ្លៀងប្រចាំឆ្នាំ ${n0(P.clim.year)} ម.ម។ តើរដូវវស្សា និងរដូវប្រាំងមានឥទ្ធិពលលើការធ្វើស្រែយ៉ាងដូចម្ដេច?` : `The yearly rain is about ${n0(P.clim.year)} mm. How do the wet and dry seasons affect farming here?`, K ? 'ចម្លើយផ្សេងៗ៖ ដាំស្រូវរដូវវស្សា…' : 'Open answer: rice is planted with the rains…'); }
      const FL = this.data.flood; if (FL && FL.lvl != null && FL.houses > 0) open(K ? `ប្រសិនបើទឹកឡើង ${n0(FL.lvl - FL.base, 1)} ម៉ែត្រ ផ្ទះប្រហែល ${n0(FL.houses)} នឹងលិចទឹក។ តើប្រជាជនអាចត្រៀមខ្លួនយ៉ាងដូចម្ដេច?` : `If the water rises ${n0(FL.lvl - FL.base, 1)} m, about ${n0(FL.houses)} houses flood. How can people prepare?`, K ? 'ចម្លើយផ្សេងៗ៖ ផ្ទះខ្ពស់ (ផ្ទះឈើលើសសរ)…' : 'Open answer: houses on stilts, raised roads, early warning…');
      else open(K ? 'ហេតុអ្វីបានជាផ្ទះជាច្រើននៅកម្ពុជាសង់លើសសរ? តើវាជួយយ៉ាងដូចម្ដេចពេលមានទឹកជំនន់?' : 'Why are many Cambodian houses built on stilts? How does this help in a flood?', K ? 'ចម្លើយផ្សេងៗ៖ ការពារទឹកជំនន់ ខ្យល់ចេញចូល ទុកសម្ភារៈ…' : 'Open answer: safe from floods, cooler air, space for tools and animals…');
    }
    if (topics.includes('settlement')) {
      const N = P.near || {}, sch = N.schools && N.schools[0], hc = N.health && N.health[0];
      if (sch) mc(K ? 'តើសាលារៀនជិតបំផុតនៅឆ្ងាយប្រហែលប៉ុន្មាន?' : 'About how far is the nearest school?', `${n0(sch.d / 1000, 1)} km`, [`${n0(sch.d / 1000 * 3 + 2, 1)} km`, `${n0(sch.d / 1000 * 8 + 6, 1)} km`, `${n0(sch.d / 1000 + 12, 1)} km`]);
      if (hc) open(K ? `មណ្ឌលសុខភាពជិតបំផុតនៅឆ្ងាយ ${n0(hc.d / 1000, 1)} គ.ម។ តើចម្ងាយនេះជាបញ្ហាសម្រាប់នរណាខ្លះ?` : `The nearest health centre is ${n0(hc.d / 1000, 1)} km away. For whom is this distance a problem?`, K ? 'ចម្លើយផ្សេងៗ៖ មនុស្សចាស់ ស្ត្រីមានផ្ទៃពោះ…' : 'Open answer: old people, pregnant women, families without a moto…');
      open(K ? 'ហេតុអ្វីបានជាភូមិនៅទីនេះតាំងនៅតាមផ្លូវ ឬមាត់ទឹក?' : 'Why are the villages here along the road or the water?', K ? 'ចម្លើយផ្សេងៗ៖ ងាយធ្វើដំណើរ ទឹកប្រើប្រាស់…' : 'Open answer: easy travel, water for drinking and farming…');
    }
    if (topics.includes('change') && this.TM) { const L = this.tmStory(); if (L.length) open((K ? 'ពិនិត្យតួលេខខាងក្រោម។ តើទីនេះបានផ្លាស់ប្ដូរយ៉ាងដូចម្ដេច? ហេតុអ្វី?\n' : 'Look at these figures. How has this place changed, and why?\n') + L.join('\n'), K ? 'ចម្លើយផ្សេងៗ' : 'Open answer', 4); }
    const ttl = opt.title || (K ? 'សន្លឹកកិច្ចការភូមិសាស្ត្រ' : 'Geography worksheet'), A = P.adm, place = A ? (K ? `${A.com_km || A.com_en} · ${A.dis_km || A.dis_en} · ${A.pro_km || A.pro_en}` : `${A.com_en} · ${A.dis_en} · ${A.pro_en}`) : `${F.lat0.toFixed(4)}°N ${F.lon0.toFixed(4)}°E`;
    const qh = Q.map((q, i) => `<div class="q"><b>${i + 1}.</b> ${esc(q.q).replace(/\n/g, '<br>')}${q.opts ? `<div class="opts">${q.opts.map((o, k) => `<span>${'ABCD'[k]}. ${esc(o)}</span>`).join('')}</div>` : '<div class="lines">' + '<i></i>'.repeat(q.lines || 3) + '</div>'}</div>`).join('');
    const ans = Q.map((q, i) => `<div><b>${i + 1}.</b> ${q.opts ? 'ABCD'[q.a] + '. ' + esc(q.opts[q.a]) : esc(q.a)}</div>`).join('');
    const html = `<!DOCTYPE html><html lang="${K ? 'km' : 'en'}"><head><meta charset="utf-8"><title>${esc(ttl)}</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;700&display=swap" rel="stylesheet"><style>
      @page{size:A4;margin:14mm} body{font-family:"Noto Sans Khmer",system-ui,sans-serif;color:#111;font-size:12.5pt;line-height:1.55;max-width:182mm;margin:auto}
      h1{font-size:18pt;margin:0} .meta{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:4px;margin-bottom:8px;font-size:10.5pt}
      .imgs{display:grid;grid-template-columns:1fr 1fr;gap:6px} .imgs img{width:100%;border:1px solid #888} .cap{font-size:9pt;color:#444}
      .facts{background:#f3f1ea;border:1px solid #ccc;padding:6px 10px;margin:8px 0;font-size:11pt} .q{margin:10px 0;break-inside:avoid} .opts{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin:4px 0 0 18px}
      .lines i{display:block;border-bottom:1px dotted #777;height:24px} .ans{break-before:page} .src{font-size:8.5pt;color:#555;margin-top:10px} .name{margin:6px 0 10px}
      @media screen{body{padding:16px}.bar{position:sticky;top:0;background:#fffbe6;padding:6px;border:1px solid #e0c060;margin-bottom:10px}} @media print{.bar{display:none}}
    </style></head><body><div class="bar"><button onclick="print()">🖨 ${K ? 'បោះពុម្ព / រក្សាទុក PDF' : 'Print / save as PDF'}</button></div>
    <h1>${esc(ttl)}</h1><div class="meta"><span>📍 ${esc(place)}</span><span>${new Date().toLocaleDateString(K ? 'km-KH' : 'en-GB')}</span></div>
    <div class="name">${K ? 'ឈ្មោះ' : 'Name'}: ............................................ ${K ? 'ថ្នាក់' : 'Class'}: ............</div>
    <div class="imgs"><div><img src="${topImg}"><div class="cap">${K ? 'ផែនទីពីលើ (ទិសខាងជើងនៅខាងលើ)' : 'Map from above (north at the top)'} · ${n0(D.W / 1000, 1)} × ${n0(D.H / 1000, 1)} km</div></div><div><img src="${obImg}"><div class="cap">${K ? 'ទិដ្ឋភាព 3D' : '3D view'}</div></div></div>
    ${opt.facts ? `<div class="facts">${this.profileText(P).map(esc).join(' ')}</div>` : ''}${qh}
    ${opt.key ? `<div class="ans"><h2>${K ? 'ចម្លើយ (សម្រាប់គ្រូ)' : 'Answer key (for the teacher)'}</h2>${ans}</div>` : ''}
    <div class="src">${K ? 'បង្កើតដោយ Cambodia 3D · ក្រុមស្រាវជ្រាវ និងអភិវឌ្ឍន៍ព័ត៌មានភូមិសាស្ត្រ RUPP' : 'Made with Cambodia 3D · Geoinformatics and Research Lab, RUPP'} · OpenStreetMap, Esri, SoilGrids, Open-Meteo</div></body></html>`;
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
    return { html, n: Q.length };
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
