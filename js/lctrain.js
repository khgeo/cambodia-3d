// Supervised land-cover correction: paint training areas on the map with the class you see, and a Gaussian
// naive-Bayes model (image colour, greenness, texture, canopy density, slope, nearness to water and houses)
// learns from them and re-classifies the whole area. Samples are kept in this browser and can be reused in
// other areas, so the model keeps learning.
const KEY = 'cambodia3d.lcsamples.v1', NF = 11, MAXS = 8000;
export class LcTrainer {
  constructor(world) {
    this.w = world; this.cls = 7; this.radius = 6; this.useAll = true; this.auto = true; this.tau = 0.6;
    try { this.samples = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { this.samples = []; }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.samples.slice(-MAXS))); } catch (e) { } }
  /* per-cell features, computed once per area */
  prepare() {
    const w = this.w, D = w.D; if (this.D === D && this.F) return; this.D = D;
    const { gw, gh, C, X0, Z0, cls } = D, n = gw * gh, F = new Float32Array(n * NF), V = new Float32Array(n);
    if (!D.lcBase) D.lcBase = D.lc.slice();
    this.painted = new Uint8Array(n).fill(255);
    const rgb = new Float32Array(n * 3);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = j * gw + i, [r, g, b] = D.pxAt(X0 + (i + .5) * C, Z0 + (j + .5) * C); rgb[q * 3] = r; rgb[q * 3 + 1] = g; rgb[q * 3 + 2] = b; V[q] = (r + g + b) / 3; }
    const W1 = gw + 1, sat = new Uint32Array(W1 * (gh + 1)); for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) sat[(j + 1) * W1 + i + 1] = (cls[j * gw + i] === 2 ? 1 : 0) + sat[j * W1 + i + 1] + sat[(j + 1) * W1 + i] - sat[j * W1 + i];
    const dens = (i, j, r) => { const i0 = Math.max(0, i - r), i1 = Math.min(gw, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(gh, j + r + 1); return (sat[j1 * W1 + i1] - sat[j0 * W1 + i1] - sat[j1 * W1 + i0] + sat[j0 * W1 + i0]) / ((i1 - i0) * (j1 - j0)); };
    const grow = (seed, passes) => { const a = seed.slice(); for (let p = 0; p < passes; p++) { const b = a.slice(); for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) { const q = j * gw + i; if (!b[q] && (b[q - 1] || b[q + 1] || b[q - gw] || b[q + gw])) a[q] = 1; } } return a; };
    const ws = new Uint8Array(n), bs = new Uint8Array(n); for (let q = 0; q < n; q++) { ws[q] = cls[q] === 1 ? 1 : 0; bs[q] = D.nearB ? D.nearB[q] : 0; }
    const nearW = grow(ws, 8), vill = grow(bs, 8);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const q = j * gw + i, r = rgb[q * 3], g = rgb[q * 3 + 1], b = rgb[q * 3 + 2], v = V[q], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let s1 = 0, s2 = 0, k = 0; for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const ii = i + c, jj = j + a; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const t = V[jj * gw + ii]; s1 += t; s2 += t * t; k++; }
      const x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C, e = 10, sl = Math.hypot(w.rawElevation(x + e, z) - w.rawElevation(x - e, z), w.rawElevation(x, z + e) - w.rawElevation(x, z - e)) / (2 * e);
      const o = q * NF; F[o] = r / 255; F[o + 1] = g / 255; F[o + 2] = b / 255; F[o + 3] = v / 255; F[o + 4] = (2 * g - r - b) / 255; F[o + 5] = mx ? (mx - mn) / mx : 0;
      F[o + 6] = Math.sqrt(Math.max(0, s2 / k - (s1 / k) ** 2)) / 64; F[o + 7] = dens(i, j, 4); F[o + 8] = Math.min(1, sl * 5); F[o + 9] = nearW[q]; F[o + 10] = vill[q];
    }
    this.F = F;
    // OpenStreetMap water, roads and buildings stay as mapped
    const mAt = (m, x, z) => m ? m[Math.min(D.mh - 1, Math.max(0, ((z - Z0) / D.MR) | 0)) * D.mw + Math.min(D.mw - 1, Math.max(0, ((x - X0) / D.MR) | 0))] : 0;
    this.fixed = new Uint8Array(n); for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = j * gw + i, x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C; if (D.lcBase[q] === 13 || mAt(D.wmask, x, z) || mAt(D.bmaskOSM, x, z)) this.fixed[q] = 1; }
  }
  /* painting */
  paint(x, z) {
    const D = this.w.D; this.prepare(); const { gw, gh, C, X0, Z0 } = D, r = this.radius, i0 = Math.floor((x - r - X0) / C), i1 = Math.ceil((x + r - X0) / C), j0 = Math.floor((z - r - Z0) / C), j1 = Math.ceil((z + r - Z0) / C);
    let n = 0;
    for (let j = Math.max(0, j0); j <= Math.min(gh - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(gw - 1, i1); i++) {
      const cx = X0 + (i + .5) * C, cz = Z0 + (j + .5) * C; if (Math.hypot(cx - x, cz - z) > r) continue; const q = j * gw + i;
      this.painted[q] = this.cls; D.lc[q] = this.cls; n++;
      if (((i + j) & 1) === 0) { const f = Array.from(this.F.subarray(q * NF, q * NF + NF), v => +v.toFixed(3)); this.samples.push({ c: this.cls, f, lon: +this.w.F.lon(cx).toFixed(6), lat: +this.w.F.lat(cz).toFixed(6), a: D.aoi.w.toFixed(3) + ',' + D.aoi.s.toFixed(3) }); }
    }
    return n;
  }
  /* Gaussian naive Bayes trained on your samples (weighted) plus samples drawn from the current automatic map */
  train() {
    const D = this.w.D, n = D.lcBase.length, here = D.aoi.w.toFixed(3) + ',' + D.aoi.s.toFixed(3);
    const user = this.samples.filter(s => this.useAll || s.a === here), stats = {}, add = (c, f, wt) => { const s = stats[c] || (stats[c] = { w: 0, m: new Float64Array(NF), q: new Float64Array(NF) }); s.w += wt; for (let k = 0; k < NF; k++) { s.m[k] += f[k] * wt; s.q[k] += f[k] * f[k] * wt; } };
    for (const s of user) add(s.c, s.f, 6);
    // background knowledge: random cells of the automatic map (not painted, not road/water/building from OSM)
    const per = {}; for (let t = 0; t < 40000; t++) { const q = (Math.random() * n) | 0, c = D.lcBase[q]; if (!c || c === 13 || (per[c] || 0) > 250 || this.painted[q] !== 255) continue; per[c] = (per[c] || 0) + 1; add(c, this.F.subarray(q * NF, q * NF + NF), 1); }
    const model = {};
    for (const [c, s] of Object.entries(stats)) { if (s.w < 5) continue; const mu = [], va = []; for (let k = 0; k < NF; k++) { const m = s.m[k] / s.w; mu.push(m); va.push(Math.max(1e-4, s.q[k] / s.w - m * m)); } model[c] = { mu, va, lp: Math.log(s.w), ln: va.reduce((a, v) => a + Math.log(v), 0) }; }
    this.taught = new Set(user.map(s => s.c)); this.model = model; return { classes: Object.keys(model).length, userSamples: user.length };
  }
  classify() {
    const D = this.w.D, M = this.model; if (!M) return 0; const keys = Object.keys(M).map(Number), n = D.lcBase.length, F = this.F, lp = new Float64Array(keys.length);
    let changed = 0;
    for (let q = 0; q < n; q++) {
      if (this.painted[q] !== 255) { D.lc[q] = this.painted[q]; continue; }
      const base = D.lcBase[q]; if (this.fixed[q]) { D.lc[q] = base; continue; }
      const o = q * NF; let best = -1, bv = -Infinity;
      for (let a = 0; a < keys.length; a++) { const m = M[keys[a]]; let s = m.lp - 0.5 * m.ln; for (let k = 0; k < NF; k++) { const d = F[o + k] - m.mu[k]; s -= d * d / (2 * m.va[k]); } lp[a] = s; if (s > bv) { bv = s; best = a; } }
      let z = 0; for (let a = 0; a < keys.length; a++) z += Math.exp(lp[a] - bv); const post = 1 / z, c = keys[best];
      const v = !base || (post >= this.tau && this.taught.has(c)) ? c : base; // only classes you taught can take cells over if (v !== D.lc[q]) changed++; D.lc[q] = v;
    }
    this.updateStats(); return changed;
  }
  updateStats() { const D = this.w.D, cnt = new Uint32Array(14); for (const v of D.lc) cnt[v]++; const tot = D.lc.length - cnt[0] || 1, pct = {}; for (let k = 0; k < 14; k++) if (cnt[k]) pct[k] = cnt[k] / (k ? tot : D.lc.length); D.lcPct = pct; }
  reset() { const D = this.w.D; if (!D.lcBase) return; D.lc.set(D.lcBase); this.painted && this.painted.fill(255); this.model = null; this.updateStats(); }
  forgetHere() { const D = this.w.D, here = D.aoi.w.toFixed(3) + ',' + D.aoi.s.toFixed(3); this.samples = this.samples.filter(s => s.a !== here); this.save(); }
  hereSamples() { const D = this.w.D, here = D.aoi.w.toFixed(3) + ',' + D.aoi.s.toFixed(3); return this.samples.filter(s => s.a === here); }
}
