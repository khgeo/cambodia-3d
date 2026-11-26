// Srae Monitor in 3D: Sentinel-2 crop monitoring for every field of the 3D area (from Field Boundaries), joined
// with the land owners. Uses the same engine as khgeo.github.io/srae-monitor: Earth Search STAC (AWS, no key),
// Cloud-Optimized GeoTIFF windows read in the browser, SCL cloud mask, NDVI / EVI / NDMI / NDWI / NDRE.
import * as THREE from 'three';
import { t, lang } from './i18n.js?v=109';
import { searchScenes } from './srae/stac.js';
import { toUtm, utmZone } from './srae/geo.js';
import { INDICES, valueColor, gradientCss } from './srae/indices.js';

const CLOUD = new Set([3, 8, 9, 10]), BAD = new Set([0, 1]);
let GT = null; const geotiff = async () => GT || (GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm'));
const imgs = new Map(); const image = url => { if (!imgs.has(url)) { const p = geotiff().then(G => G.fromUrl(url, { cacheSize: 16 })).then(t2 => t2.getImage()); p.catch(() => imgs.delete(url)); imgs.set(url, p); while (imgs.size > 40) imgs.delete(imgs.keys().next().value); } return imgs.get(url); };
const km = () => lang === 'km';
export const STATUS = { bare: ['Bare / flooded (land preparation)', 'ដីទទេ / ទឹកលិច (រៀបចំដី)', '#b98a5a'], young: ['Young crop (growing)', 'ដំណាំខ្ចី (កំពុងលូតលាស់)', '#a6d96a'], full: ['Full canopy', 'ពេញស្លឹក', '#1a9850'], ripening: ['Ripening / drying', 'កំពុងទុំ / ស្ងួត', '#e6c34a'], harvested: ['Harvested', 'ច្រូតរួច', '#d4874a'], unknown: ['No clear image', 'គ្មានរូបភាពច្បាស់', '#888888'] };

export class Srae3D {
  constructor(world, opts = {}) { this.w = world; this.say = opts.say || (() => { }); this.getFields = opts.fields || (() => null); this.g = new THREE.Group(); this.index = 'NDVI'; this.res = {}; }
  get D() { return this.w.D; } get F() { return this.w.F; }
  aoiGeom() { const a = this.D.aoi; return { type: 'Polygon', coordinates: [[[a.w, a.s], [a.e, a.s], [a.e, a.n], [a.w, a.n], [a.w, a.s]]] }; }
  async scenes(months = 12) { const end = new Date(), start = new Date(Date.now() - months * 30.5 * 864e5); this.list = await searchScenes(this.aoiGeom(), { start, end, maxCloud: 70 }); return this.list; }
  // the 3D area as a 10 m lon/lat grid, with the field each cell belongs to
  grid() { const D = this.D, a = D.aoi, key = a.w + ',' + a.s + ',' + (this.fieldsKey || ''); if (this.G && this.G.key === key) return this.G;
    const W = Math.max(20, Math.round(D.W / 10)), H = Math.max(20, Math.round(D.H / 10)), lon = new Float64Array(W * H), lat = new Float64Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { lon[j * W + i] = a.w + (i + 0.5) / W * (a.e - a.w); lat[j * W + i] = a.n - (j + 0.5) / H * (a.n - a.s); }
    const fid = new Int32Array(W * H).fill(-1), FL = this.fieldList();
    FL.forEach((f, k) => { const r = f.ring; let w = 180, e = -180, s = 90, n = -90; for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      const i0 = Math.max(0, Math.floor((w - a.w) / (a.e - a.w) * W)), i1 = Math.min(W - 1, Math.ceil((e - a.w) / (a.e - a.w) * W)), j0 = Math.max(0, Math.floor((a.n - n) / (a.n - a.s) * H)), j1 = Math.min(H - 1, Math.ceil((a.n - s) / (a.n - a.s) * H));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * W + i, x = lon[q], y = lat[q]; let o = false; for (let p = 0, m = r.length - 1; p < r.length; m = p++) { const A = r[p], B = r[m]; if ((A[1] > y) !== (B[1] > y) && x < (B[0] - A[0]) * (y - A[1]) / (B[1] - A[1]) + A[0]) o = !o; } if (o) fid[q] = k; } });
    return (this.G = { key, W, H, lon, lat, fid }); }
  fieldList() { const S = this.getFields(); if (S && S.fields && S.fields.length) { this.src = S; this.fieldsKey = S.fields.length + ':' + S.fields[0].ring[0].join(); return S.fields; } this.src = null; this.fieldsKey = '0'; return []; }
  owners() { return (this.src && this.src.owners) || []; }
  ownerName(f) { const o = this.owners().find(q => q.id === f.owner_id); return o ? (this.src.LO && this.src.LO.displayName ? this.src.LO.displayName(o) : o.name) : ''; }
  async readWin(asset, box) { const img = await image(asset.href), [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), Wi = img.getWidth(), Hi = img.getHeight(), cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const c0 = cl(Math.floor((box[0] - ox) / rx) - 1, 0, Wi), c1 = cl(Math.ceil((box[2] - ox) / rx) + 1, 0, Wi), r0 = cl(Math.floor((box[3] - oy) / ry) - 1, 0, Hi), r1 = cl(Math.ceil((box[1] - oy) / ry) + 1, 0, Hi);
    if (c1 <= c0 || r1 <= r0) return null; const bands = await img.readRasters({ window: [c0, r0, c1, r1], interleave: false }); return { bands, c0, r0, w: c1 - c0, h: r1 - r0, ox, oy, rx, ry }; }
  // one scene, one index, over the whole 3D area; also the mean of every field
  async compute(scene, key = this.index) {
    const ck = scene.id + ':' + key; this.cache = this.cache || new Map(); if (this.cache.has(ck)) return this.cache.get(ck);
    const G = this.grid(), def = INDICES[key], zone = scene.zone || utmZone(this.F.lon0, this.F.lat0), south = !!scene.south, n = G.W * G.H, xy = new Float64Array(n * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let q = 0; q < n; q++) { const [x, y] = toUtm(G.lon[q], G.lat[q], zone, south); xy[2 * q] = x; xy[2 * q + 1] = y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const box = [x0 - 30, y0 - 30, x1 + 30, y1 + 30], names = [...new Set([...def.bands, 'scl'])], W = {};
    await Promise.all(names.map(async b => { W[b] = scene.assets[b] ? await this.readWin(scene.assets[b], box) : null; }));
    const smp = (w, x, y) => { if (!w) return NaN; const c = Math.floor((x - w.ox) / w.rx) - w.c0, r = Math.floor((y - w.oy) / w.ry) - w.r0; return c < 0 || r < 0 || c >= w.w || r >= w.h ? NaN : w.bands[0][r * w.w + c]; };
    // the +1000 offset of processing baseline 04.00 (as in Srae Monitor): skip it when the archive already removed it
    let low = 0, cnt = 0; for (let q = 0; q < n; q += 37) for (const b of def.bands) { const v = smp(W[b], xy[2 * q], xy[2 * q + 1]); if (v > 0) { cnt++; if (v < 1000) low++; } } const noOff = cnt > 20 && low / cnt > 0.05;
    const val = new Float32Array(n).fill(NaN), bv = {}; let clouds = 0, ok = 0;
    for (let q = 0; q < n; q++) { const x = xy[2 * q], y = xy[2 * q + 1], s = smp(W.scl, x, y); if (!(s >= 0) || BAD.has(s)) continue; if (CLOUD.has(s)) { clouds++; continue; }
      let good = true; for (const b of def.bands) { const a = scene.assets[b], raw = smp(W[b], x, y); if (!(raw > 0)) { good = false; break; } bv[b] = raw * a.scale + (noOff ? 0 : a.offset); } if (!good) continue;
      const v = def.fn(bv); if (Number.isFinite(v) && v >= def.valid[0] && v <= def.valid[1]) { val[q] = v; ok++; } }
    const FL = this.fieldList(), sum = new Float64Array(FL.length), num = new Int32Array(FL.length), tot = new Int32Array(FL.length);
    for (let q = 0; q < n; q++) { const k = G.fid[q]; if (k < 0) continue; tot[k]++; if (Number.isFinite(val[q])) { sum[k] += val[q]; num[k]++; } }
    let am = 0, an = 0; for (let q = 0; q < n; q++) if (Number.isFinite(val[q])) { am += val[q]; an++; }
    const r = { scene, key, val, mean: an ? am / an : null, clear: ok / Math.max(1, ok + clouds), field: FL.map((f, k) => num[k] && num[k] >= Math.max(1, tot[k] * 0.4) ? sum[k] / num[k] : null) };
    this.cache.set(ck, r); while (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value); return r;
  }
  /* ---------- 3D ---------- */
  clear() { this.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.g.clear(); if (this.g.parent) this.g.parent.remove(this.g); if (this.w._srOverlay) { this.w.setCompare(null); this.w._srOverlay = false; } }
  show(r, opt = {}) {
    this.clear(); const D = this.D, F = this.F, G = this.grid(), a = D.aoi, key = r.key;
    // the index raster over the ground (transparent where cloudy)
    if (opt.raster !== false) { const c = document.createElement('canvas'); c.width = G.W; c.height = G.H; const g = c.getContext('2d'), im = g.createImageData(G.W, G.H);
      for (let q = 0; q < G.W * G.H; q++) { const v = r.val[q]; if (!Number.isFinite(v)) continue; const col = valueColor(key, v); im.data.set([col[0], col[1], col[2], G.fid[q] >= 0 ? 235 : 150], q * 4); }
      g.putImageData(im, 0, 0); const full = document.createElement('canvas'); full.width = D.img.width; full.height = D.img.height; const fg = full.getContext('2d'); fg.imageSmoothingEnabled = false;
      fg.drawImage(c, D.pxX(a.w), D.pxY(a.n), D.pxX(a.e) - D.pxX(a.w), D.pxY(a.s) - D.pxY(a.n)); this.w.setCompare({ mode: 'changes', diff: full }); this.w._srOverlay = true; }
    // every field: its outline coloured by its mean, and fields with a problem blink red
    const FL = this.fieldList(), flags = new Set(opt.flags || []), T = { value: 0 }, t0 = performance.now();
    const lin = [], col = [], blink = [];
    FL.forEach((f, k) => { const v = r.field[k], c = opt.colorOf ? new THREE.Color(opt.colorOf(k)) : new THREE.Color(...(v == null ? [0.55, 0.55, 0.55] : valueColor(key, v).map(x => x / 255))); const pts = f.ring.map(([lo, la]) => { const x = F.x(lo), z = F.z(la); return [x, this.w.hAt(x, z) + 0.7, z]; });
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q2 = pts[(i + 1) % pts.length]; lin.push(...p, ...q2); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      if (flags.has(k)) blink.push(pts); });
    if (lin.length) { const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(lin, 3)); g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); const m = new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })); m.renderOrder = 60; this.g.add(m); }
    if (opt.colorOf) { const pos = [], cl = []; FL.forEach((f, k) => { const c = new THREE.Color(opt.colorOf(k)), P = f.ring.map(([lo, la]) => { const x = F.x(lo), z = F.z(la); return [x, this.w.hAt(x, z) + 0.5, z]; });
        try { const tri = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[2])), []), y = Math.max(...P.map(p => p[1])); for (const t3 of tri) for (const i of t3) { pos.push(P[i][0], y, P[i][2]); cl.push(c.r, c.g, c.b); } } catch (e) { } });
      const g4 = new THREE.BufferGeometry(); g4.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g4.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      const m = new THREE.Mesh(g4, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide })); m.renderOrder = 59; this.g.add(m); } // crop stage: each field filled with its colour
    if (blink.length) { const pos = []; for (const P of blink) { try { const tri = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[2])), []), y = Math.max(...P.map(p => p[1])) + 0.2; for (const t3 of tri) for (const i of t3) pos.push(P[i][0], y, P[i][2]); } catch (e) { } }
      const g3 = new THREE.BufferGeometry(); g3.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const mat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g3, mat); m.renderOrder = 61; m.onBeforeRender = () => { T.value = (performance.now() - t0) / 1000; mat.opacity = 0.15 + 0.5 * (0.5 + 0.5 * Math.sin(T.value * 5)); }; this.g.add(m); }
    if (!this.g.parent) this.w.root.add(this.g);
  }
  /* ---------- the season of every field ---------- */
  async season(say = this.say, maxN = 26) {
    const L = (this.list || await this.scenes()).filter(s => s.cloud == null || s.cloud <= 55).slice().reverse(); // oldest first
    const pick = L.length <= maxN ? L : Array.from({ length: maxN }, (_, i) => L[Math.round(i * (L.length - 1) / (maxN - 1))]);
    const out = []; let done = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (pick.length) { const s = pick.shift(); try { const r = await this.compute(s, 'NDVI'); if (r.clear > 0.3) out.push(r); } catch (e) { console.warn('scene', s.id, e); } say(`${t('Reading Sentinel-2 images')} ${++done}/${done + pick.length}`); } }));
    out.sort((a, b) => a.scene.date.localeCompare(b.scene.date)); const FL = this.fieldList();
    const fields = FL.map((f, k) => { const s = out.map(r => [r.scene.date, r.field[k]]).filter(([, v]) => v != null); return { k, s, ...this.judge(s) }; });
    this.S = { runs: out, fields, dates: out.map(r => r.scene.date), area: out.map(r => [r.scene.date, r.mean]) }; return this.S;
  }
  judge(s) { // where the crop is in its season, from the NDVI curve of the field
    if (!s.length) return { status: 'unknown' }; const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null, v = last[1], age = (Date.now() - Date.parse(last[0])) / 864e5;
    const recent = s.filter(([d]) => (Date.parse(last[0]) - Date.parse(d)) / 864e5 <= 100), peak = recent.reduce((m, p) => p[1] > m[1] ? p : m, recent[0]);
    let status = v < 0.25 ? (peak[1] > 0.55 && peak[0] !== last[0] ? 'harvested' : 'bare') : v < 0.5 ? (prev && prev[1] > v + 0.08 ? 'ripening' : 'young') : v >= 0.65 ? 'full' : (prev && prev[1] > v + 0.08 ? 'ripening' : 'young');
    let sow = null; for (let i = s.length - 1; i > 0; i--) if (s[i - 1][1] < 0.3 && s[i][1] >= 0.3) { sow = s[i - 1][0]; break; } // start of the last green-up
    const drop = prev ? v - prev[1] : 0; return { status, latest: v, date: last[0], drop, flag: prev && drop <= -0.15 && status !== 'harvested', peak: peak[1], peakDate: peak[0], greenUp: sow, age }; }
  chart(s, W = 320, H = 130) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); if (!s.length) return c;
    const t0 = Date.parse(s[0][0]), t1 = Math.max(t0 + 864e5, Date.parse(s[s.length - 1][0])), X = d => 28 + (Date.parse(d) - t0) / (t1 - t0) * (W - 38), Y = v => H - 18 - Math.max(0, Math.min(1, v)) * (H - 30);
    g.strokeStyle = '#ddd'; g.fillStyle = '#666'; g.font = '10px system-ui'; for (const v of [0, 0.25, 0.5, 0.75, 1]) { g.beginPath(); g.moveTo(26, Y(v)); g.lineTo(W - 6, Y(v)); g.stroke(); g.fillText(v.toFixed(2), 2, Y(v) + 3); }
    g.strokeStyle = '#1a9850'; g.lineWidth = 2.5; g.beginPath(); s.forEach(([d, v], i) => i ? g.lineTo(X(d), Y(v)) : g.moveTo(X(d), Y(v))); g.stroke();
    for (const [d, v] of s) { const cc = valueColor('NDVI', v); g.fillStyle = `rgb(${cc.map(Math.round)})`; g.beginPath(); g.arc(X(d), Y(v), 3.5, 0, 7); g.fill(); }
    g.fillStyle = '#555'; g.fillText(s[0][0].slice(0, 7), 28, H - 4); g.textAlign = 'right'; g.fillText(s[s.length - 1][0].slice(0, 7), W - 6, H - 4); return c; }
  fieldAt(x, z) { const F = this.F, lon = F.lon(x), lat = F.lat(z), FL = this.fieldList(); for (let k = 0; k < FL.length; k++) { const r = FL[k].ring; let o = false; for (let p = 0, m = r.length - 1; p < r.length; m = p++) { const A = r[p], B = r[m]; if ((A[1] > lat) !== (B[1] > lat) && lon < (B[0] - A[0]) * (lat - A[1]) / (B[1] - A[1]) + A[0]) o = !o; } if (o) return k; } return -1; }
  csv() { const FL = this.fieldList(), S = this.S, rows = [['field', 'parcel_no', 'owner', 'area_ha', 'latest_ndvi', 'date', 'change', 'status', 'peak_ndvi', 'peak_date', 'green_up', 'lat', 'lon']];
    FL.forEach((f, k) => { const J = S ? S.fields[k] : {}, c = f.ring.reduce((a, p) => [a[0] + p[0] / f.ring.length, a[1] + p[1] / f.ring.length], [0, 0]);
      rows.push([k + 1, f.parcel_no || '', this.ownerName(f), (f.area_m2 / 1e4).toFixed(3), J.latest != null ? J.latest.toFixed(3) : '', J.date || '', J.drop != null ? J.drop.toFixed(3) : '', J.status || '', J.peak != null ? J.peak.toFixed(3) : '', J.peakDate || '', J.greenUp || '', c[1].toFixed(6), c[0].toFixed(6)]); });
    return '﻿' + rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n'); }
  geojson() { const FL = this.fieldList(); return { type: 'FeatureCollection', features: FL.map((f, k) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...f.ring, f.ring[0]]] }, properties: { name: (f.parcel_no ? f.parcel_no + ' · ' : '') + (this.ownerName(f) || `Field ${k + 1}`), crop: 'rice_wet', owner: this.ownerName(f), area_ha: +(f.area_m2 / 1e4).toFixed(3) } })) }; }
}
export { INDICES, gradientCss };
export const statusName = k => STATUS[k] ? (km() ? STATUS[k][1] : STATUS[k][0]) : k;

/* ---------- rice growth stages (BBCH) from the age of the crop ---------- */
// days after sowing for a medium (≈125-day) wet-season variety; other lengths are scaled
export const RSTAGES = [
  ['germ', 0, 8, '00–09', 'Germination', 'ដំណុះ', '#c9b38a', 'Keep the soil moist; level, puddled field.', 'រក្សាដីឱ្យសើម ស្រែរាបស្មើ។'],
  ['leaf', 8, 21, '11–19', 'Leaf development', 'ការលូតលាស់ស្លឹក', '#b9d98a', 'Shallow water (2–3 cm); basal fertiliser if not yet applied.', 'ទឹករាក់ (២–៣ សម) ដាក់ជីទ្រនាប់ ប្រសិនបើមិនទាន់ដាក់។'],
  ['tiller', 21, 46, '21–29', 'Tillering', 'ការបែកគុម្ព', '#7cc26a', 'First top-dressing (urea) at early tillering; control weeds.', 'ដាក់ជីបន្ថែមលើកទី១ (អ៊ុយរ៉េ) ដើមរដូវបែកគុម្ព កម្ចាត់ស្មៅ។'],
  ['elong', 46, 61, '30–39', 'Stem elongation / panicle initiation', 'ការលូតដើម / ការបង្កើតកួរ', '#3fa45b', 'Second top-dressing at panicle initiation; keep 5 cm water.', 'ដាក់ជីបន្ថែមលើកទី២ ពេលបង្កើតកួរ រក្សាទឹក ៥ សម។'],
  ['boot', 61, 76, '41–59', 'Booting / heading', 'ពពោះ / ចេញកួរ', '#2f8a4a', 'Most sensitive to drought: never let the field dry out.', 'ងាយរងគ្រោះរាំងស្ងួតបំផុត៖ កុំឱ្យស្រែស្ងួត។'],
  ['flower', 76, 86, '61–69', 'Flowering', 'ចេញផ្កា', '#e7c94c', 'Keep water; avoid spraying during flowering hours.', 'រក្សាទឹក ជៀសវាងការបាញ់ថ្នាំពេលចេញផ្កា។'],
  ['milk', 86, 101, '71–79', 'Milk / dough ripening', 'គ្រាប់ទឹកដោះ / គ្រាប់ទន់', '#d9b04a', 'Watch for birds, rats and brown planthopper.', 'ប្រយ័ត្នសត្វស្លាប កណ្ដុរ និងមមាចត្នោត។'],
  ['mature', 101, 126, '83–89', 'Ripening / mature', 'ទុំ', '#c08a30', 'Drain the field ~10 days before harvest; harvest at 80–85 % golden grains.', 'បង្ហូរទឹកចេញ ~១០ ថ្ងៃមុនច្រូត ច្រូតពេលគ្រាប់លឿង ៨០–៨៥%។'],
  ['stubble', 126, 9999, '–', 'Harvested (stubble)', 'ច្រូតរួច (គល់ចំបើង)', '#a48a5a', 'Incorporate straw instead of burning; plan the next crop.', 'ច្រឹបចំបើងចូលដីជំនួសការដុត រៀបចំដំណាំបន្ទាប់។'],
];
export const VARIETY = { short: 100, medium: 125, long: 145 };
const DAY = 864e5;
// the age of the rice in a field: a sowing date entered by hand, or estimated from the NDVI curve
// (NDVI passes 0.3 about four weeks after sowing, at early tillering)
export function riceAge(f, J, today = Date.now()) {
  if (f.sow_date) return { sow: f.sow_date, age: Math.round((today - Date.parse(f.sow_date)) / DAY), src: 'entered' };
  if (!J || !J.s || J.s.length < 2) return null; const s = J.s;
  for (let i = s.length - 1; i > 0; i--) { const [d0, v0] = s[i - 1], [d1, v1] = s[i]; if ((today - Date.parse(d1)) / DAY > 170) break; // only the current crop
    if (v0 < 0.3 && v1 >= 0.3) { const t0 = Date.parse(d0), t1 = Date.parse(d1), tc = t0 + (t1 - t0) * (0.3 - v0) / Math.max(0.01, v1 - v0), sow = tc - 28 * DAY;
    return { sow: new Date(sow).toISOString().slice(0, 10), age: Math.round((today - sow) / DAY), src: 'ndvi' }; } }
  return null;
}
export function riceStage(f, J, variety = 'medium', today = Date.now()) {
  const A = riceAge(f, J, today), k = 125 / (VARIETY[f.variety || variety] || 125);
  if (J && J.status === 'harvested' && !(A && A.src === 'entered' && A.age < 100)) return { key: 'stubble', A, st: RSTAGES[8] };
  if (A && A.age >= 0) { const d = A.age * k; const st = RSTAGES.find(r => d >= r[1] && d < r[2]) || RSTAGES[8];
    if (!(A.src === 'ndvi' && st[0] === 'stubble' && J && J.latest >= 0.35)) return { key: st[0], A, st }; } // a green field cannot be harvested: fall back on the NDVI level
  if (!J || J.status === 'unknown') return null;
  if (J.status === 'bare') return { key: 'none', A: null, st: null };
  const v = J.latest ?? 0.5, guess = J.status === 'young' ? (v < 0.45 ? 'tiller' : 'elong') : J.status === 'full' ? 'boot' : J.status === 'ripening' ? (v > 0.45 ? 'milk' : 'mature') : 'tiller'; return { key: guess, A: null, st: RSTAGES.find(r => r[0] === guess), guessed: true };
}
// a BBCH-style bar: the stages of the season with the field's day marked
export function stageBar(stage, variety = 'medium', W = 330, H = 92) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), tot = VARIETY[variety] || 125, k = tot / 125, X = d => 6 + Math.min(1, d / (tot + 12)) * (W - 12);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.font = '9px system-ui, "Noto Sans Khmer"';
  RSTAGES.slice(0, 8).forEach(r => { const x0 = X(r[1] * k), x1 = X(r[2] * k); g.fillStyle = r[6]; g.fillRect(x0, 34, x1 - x0 - 1, 22); g.fillStyle = '#222'; g.save(); g.translate(x0 + 2, 52); g.fillText(r[3], 0, 0); g.restore(); });
  g.fillStyle = RSTAGES[8][6]; g.fillRect(X(tot), 34, W - 6 - X(tot), 22);
  g.fillStyle = '#4a90d9'; g.fillRect(X(0), 58, X(tot - 10) - X(0), 4); g.fillStyle = '#555'; g.fillText(km() ? 'ទឹកក្នុងស្រែ' : 'water in the field', X(0), 72);
  if (stage && stage.A) { const x = X(stage.A.age); g.fillStyle = '#d0302a'; g.beginPath(); g.moveTo(x, 32); g.lineTo(x - 6, 20); g.lineTo(x + 6, 20); g.fill(); g.fillRect(x - 1, 32, 2, 26); g.font = 'bold 11px system-ui, "Noto Sans Khmer"'; g.textAlign = x > W / 2 ? 'right' : 'left'; g.fillText((km() ? 'ថ្ងៃទី ' : 'Day ') + stage.A.age, x + (x > W / 2 ? -8 : 8), 16); }
  g.textAlign = 'left'; g.fillStyle = '#555'; g.font = '9px system-ui'; g.fillText('BBCH', 6, 86); g.textAlign = 'right'; g.fillText((km() ? 'ថ្ងៃ' : 'days') + ' 0 → ' + tot, W - 6, 86); return c;
}
export const stageName = st => st ? (km() ? st[5] : st[4]) : '';
export const stageTip = st => st ? (km() ? st[8] : st[7]) : '';

// rice plants in every field at its growth stage (the near-camera rice hills), water in the flooded paddies, stage tags
Srae3D.prototype.stages = function (variety = 'medium') { const FL = this.fieldList(), S = this.S; return FL.map((f, k) => riceStage(f, S ? S.fields[k] : null, variety)); };
Srae3D.prototype.plants = async function (on, variety = 'medium', tags = true) {
  const w = this.w, RF = w._rf || (w._rf = await import('./ricefield.js?v=109')), FL = this.fieldList();
  if (this.water) { w.root.remove(this.water); this.water.geometry.dispose(); this.water.material.dispose(); this.water = null; }
  if (this.tags) { this.tags.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); }); w.root.remove(this.tags); this.tags = null; }
  if (!on || !FL.length) { RF.FARM.stage = null; if (w._farmFields) RF.buildFieldMask(w, w._farmFields); else RF.FARM.mask = null; if (w.grass) w.grass.center.set(1e9, 0, 1e9); return null; }
  const ST = this.stages(variety); RF.buildFieldMask(w, FL); RF.FARM.stage = {}; ST.forEach((s, k) => { RF.FARM.stage[k + 1] = s ? s.key : 'none'; });
  const wet = FL.filter((f, k) => ST[k] && ['germ', 'leaf', 'tiller', 'elong', 'boot', 'flower', 'milk'].includes(ST[k].key)); if (wet.length) { this.water = RF.paddyWater(w, wet); if (this.water) w.root.add(this.water); }
  if (tags) { this.tags = new THREE.Group(); const F = this.F;
    FL.forEach((f, k) => { const s = ST[k]; if (!s || !s.st) return; const c = f.ring.reduce((a, p) => [a[0] + p[0] / f.ring.length, a[1] + p[1] / f.ring.length], [0, 0]), x = F.x(c[0]), z = F.z(c[1]);
      const txt = `🌾 ${stageName(s.st)}${s.A ? ' · ' + (km() ? 'ថ្ងៃ ' : 'd ') + s.A.age : ''}`, cv = document.createElement('canvas'), g = cv.getContext('2d'), font = 'bold 26px system-ui, "Noto Sans Khmer"'; g.font = font;
      const W = Math.ceil(g.measureText(txt).width) + 22; cv.width = W; cv.height = 40; g.font = font; g.fillStyle = 'rgba(15,22,30,.8)'; g.beginPath(); g.roundRect(0, 0, W, 40, 10); g.fill(); g.fillStyle = s.st[6]; g.fillRect(0, 34, W, 6); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(txt, 11, 19);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true, sizeAttenuation: false })); sp.center.set(0.5, 0); sp.scale.set(0.00042 * W, 0.00042 * 40, 1); sp.position.set(x, w.hAt(x, z) + 5, z); sp.renderOrder = 45; this.tags.add(sp); });
    w.root.add(this.tags); }
  if (w.grass) w.grass.center.set(1e9, 0, 1e9); return ST;
};
