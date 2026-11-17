// Topographic map sheet of the built area: land cover with map symbols, hillshade, contours with index labels,
// spot heights, water, roads by class, railways, buildings, place names and landmarks (OpenStreetMap), your own
// features, survey points, parcels and the tactical overlay; UTM grid with edge labels, bilingual legend,
// scale bar, north arrows with grid convergence, location map and credits. PNG or PDF.
import { LC } from './landcover.js?v=45';
import { utm } from './hud.js?v=45';
import { utmInv } from './survey.js?v=45';

const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };
const SCALES = [1000, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 100000];
const KD = s => String(s).replace(/[0-9]/g, d => '០១២៣៤៥៦៧៨៩'[d]);
const FONT = '"Noto Sans Khmer", system-ui, "Segoe UI", Arial, sans-serif';
// road styles (mm on paper): casing colour, fill colour, width, dash
const RS = c => c <= 4 ? { k: 'Motorway / trunk', km: 'ផ្លូវជាតិធំ', o: '#7a1a12', f: '#d8442e', w: 1.2 }
  : c <= 6 ? { k: 'Primary road', km: 'ផ្លូវជាតិ', o: '#8a3a12', f: '#ef8a3a', w: 1.0 }
  : c <= 8 ? { k: 'Secondary road', km: 'ផ្លូវខេត្ត', o: '#7a5a12', f: '#f7c64a', w: 0.85 }
  : c <= 10 ? { k: 'Tertiary road', km: 'ផ្លូវស្រុក', o: '#7a6a3a', f: '#fbe58a', w: 0.7 }
  : c <= 14 ? { k: 'Local road / street', km: 'ផ្លូវភូមិ / ផ្លូវតូច', o: '#6b6b6b', f: '#ffffff', w: 0.55 }
  : c === 16 ? { k: 'Track (laterite / dirt)', km: 'ផ្លូវលំ (ដីក្រហម)', o: null, f: '#8a5a2a', w: 0.35, d: [1.6, 0.7] }
  : { k: 'Path / footpath', km: 'ផ្លូវដើរ', o: null, f: '#5a4a3a', w: 0.25, d: [0.6, 0.6] };
const LC_SYM = { 3: 'tree', 4: 'tree2', 5: 'shrub', 6: 'orchard', 7: 'rice', 8: 'crop', 9: 'grass', 2: 'marsh', 11: 'sand' };

function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
// place names and landmarks: OpenStreetMap extract bundled with the site (data/places/<ix>_<iy>.json, 0.25° cells)
async function localNames(aoi) {
  const PL = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality', 'isolated_dwelling']), out = [];
  for (let i = Math.floor((aoi.w - 102) / 0.25); i <= Math.floor((aoi.e - 102) / 0.25); i++) for (let j = Math.floor((aoi.s - 10) / 0.25); j <= Math.floor((aoi.n - 10) / 0.25); j++) {
    try { const a = await (await fetch(`data/places/${i}_${j}.json`)).json();
      for (const [lon, lat, kind, nk, ne, rel, ele] of a) { if (lon < aoi.w || lon > aoi.e || lat < aoi.s || lat > aoi.n) continue; const tags = { 'name:km': nk, 'name:en': ne, religion: rel, ele };
        if (PL.has(kind)) tags.place = kind === 'isolated_dwelling' ? 'hamlet' : kind; else if (kind === 'peak') tags.natural = 'peak'; else if (kind === 'river') tags.waterway = 'river'; else tags.amenity = kind === 'college' ? 'school' : kind === 'doctors' ? 'clinic' : kind;
        out.push({ lat, lon, tags }); } } catch (e) { }
  }
  return out;
}
async function overpassNames(aoi) {
  const q = `[out:json][timeout:20];(node["place"~"city|town|village|hamlet|suburb|neighbourhood|locality"](${aoi.s},${aoi.w},${aoi.n},${aoi.e});` +
    `nwr["amenity"~"place_of_worship|school|hospital|clinic|marketplace|police|townhall|university|fuel"](${aoi.s},${aoi.w},${aoi.n},${aoi.e});nwr["natural"="peak"](${aoi.s},${aoi.w},${aoi.n},${aoi.e});` +
    `way["waterway"="river"]["name"](${aoi.s},${aoi.w},${aoi.n},${aoi.e}););out center tags 300;`;
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000); const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal }); clearTimeout(to); if (r.ok) return (await r.json()).elements || []; } catch (e) { }
  }
  return [];
}
function chain(segs, eps) { // join marching-squares segments into polylines
  const key = p => Math.round(p[0] / eps) + ',' + Math.round(p[1] / eps), ends = new Map(), used = new Uint8Array(segs.length), out = [];
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = key(s[e]); (ends.get(k) || ends.set(k, []).get(k)).push([i, e]); } });
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1; const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      for (;;) { const tip = dir ? line[line.length - 1] : line[0], cand = (ends.get(key(tip)) || []).find(([j]) => !used[j]); if (!cand) break; used[cand[0]] = 1; const s = segs[cand[0]], nxt = s[1 - cand[1]]; if (dir) line.push(nxt); else line.unshift(nxt); }
    }
    out.push(line);
  }
  return out;
}

// elevation grid, contours (x,z polylines) and spot heights – shared by the map sheet and the GeoPackage export
export function terrainData(world, ciOpt, S) {
  const D = world.D;
  const gs = Math.max(2, Math.min(D.W, D.H) / 500), nx = Math.ceil(D.W / gs) + 1, nz = Math.ceil(D.H / gs) + 1, E = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) E[j * nx + i] = world.rawElevation(D.X0 + i * gs, D.Z0 + j * gs);
  for (let pass = 0; pass < 6; pass++) { const t = E.slice(); for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const q = j * nx + i; E[q] = (t[q] * 4 + t[q - 1] + t[q + 1] + t[q - nx] + t[q + nx] + (t[q - nx - 1] + t[q - nx + 1] + t[q + nx - 1] + t[q + nx + 1]) * 0.5) / 10; } }
  let lo = Infinity, hi = -Infinity; for (const v of E) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const rng = Math.max(0.5, hi - lo), CI = ciOpt === 'auto' ? [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find(v => rng / v <= 22) || 100 : +ciOpt, IDX = CI === 2.5 || CI === 25 ? 4 : 5;
  const contours = [];
  for (let L = Math.ceil(lo / CI) * CI; L <= hi; L += CI) {
    const segs = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = E[j * nx + i], b = E[j * nx + i + 1], c = E[(j + 1) * nx + i + 1], d = E[(j + 1) * nx + i], cs = (a > L) | (b > L) << 1 | (c > L) << 2 | (d > L) << 3; if (cs === 0 || cs === 15) continue;
      const x0 = D.X0 + i * gs, z0 = D.Z0 + j * gs, it = (p, q) => (L - p) / ((q - p) || 1e-9);
      const eT = [x0 + gs * it(a, b), z0], eR = [x0 + gs, z0 + gs * it(b, c)], eB = [x0 + gs * it(d, c), z0 + gs], eL = [x0, z0 + gs * it(a, d)];
      const tbl = { 1: [[eL, eT]], 2: [[eT, eR]], 3: [[eL, eR]], 4: [[eR, eB]], 5: [[eL, eT], [eR, eB]], 6: [[eT, eB]], 7: [[eL, eB]], 8: [[eB, eL]], 9: [[eB, eT]], 10: [[eT, eR], [eB, eL]], 11: [[eB, eR]], 12: [[eR, eL]], 13: [[eR, eT]], 14: [[eT, eL]] };
      for (const sgm of tbl[cs]) segs.push(sgm);
    }
    for (const line of chain(segs, gs * 0.01)) { let len = 0; for (let q = 1; q < line.length; q++) len += Math.hypot(line[q][0] - line[q - 1][0], line[q][1] - line[q - 1][1]); const closed = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < gs * 1.5; if (len * 1000 / S > (closed ? 12 : 4)) contours.push({ L, line, len, idx: Math.abs(Math.round(L / CI)) % IDX === 0 }); }
  }
  const sp = []; const r = Math.max(3, Math.round(120 / gs));
    for (let j = r; j < nz - r; j += Math.max(1, r >> 1)) for (let i = r; i < nx - r; i += Math.max(1, r >> 1)) { const v = E[j * nx + i]; let top = true; for (let b = -r; b <= r && top; b += 2) for (let a = -r; a <= r; a += 2) if (E[(j + b) * nx + i + a] > v) { top = false; break; } if (top && v - lo > rng * 0.15) sp.push([D.X0 + i * gs, D.Z0 + j * gs, v]); }
    sp.sort((a, b) => b[2] - a[2]); const keep = []; for (const p of sp) if (!keep.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 300)) keep.push(p);
  return { gs, nx, nz, E, lo, hi, rng, CI, IDX, contours, spots: keep.slice(0, 12) };
}

export async function makeTopoMap(world, o, say = () => {}) {
  const D = world.D, F = world.F, aoi = D.aoi, lang = o.lang || 'both', km = lang !== 'en', en = lang !== 'km';
  const T = (e, k) => lang === 'both' ? `${k} · ${e}` : lang === 'km' ? k : e, N = v => lang === 'km' ? KD(v) : String(v);
  await document.fonts.load(`16px "Noto Sans Khmer"`).catch(() => { });
  // --- sheet geometry (mm) ---
  const [pw, ph] = PAPER[o.paper.slice(0, 2)], land = o.paper.endsWith('L'), W = land ? ph : pw, H = land ? pw : ph, k = o.dpi / 25.4;
  const M = 10, head = 16, side = land ? Math.max(78, W * 0.24) : 0, foot = land ? 0 : Math.max(82, H * 0.25);
  const fw = W - 2 * M - side - (land ? 12 : 0), fh = H - 2 * M - head - foot - (land ? 0 : 6);
  let S = o.scale === 'auto' ? SCALES.find(s => D.W * 1000 / s <= fw && D.H * 1000 / s <= fh) || 100000 : +o.scale;
  const mw = D.W * 1000 / S, mhh = D.H * 1000 / S, FW = Math.min(fw, mw), FH = Math.min(fh, mhh);
  // centre map + margin as one block
  const fx = land ? M + 3 + (W - 2 * M - 3 - (FW + 9 + side)) / 2 : M + (W - 2 * M - FW) / 2, fy = land ? M + head + (fh - FH) / 2 : M + head + (fh - FH) / 2;
  const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k); const g = cv.getContext('2d');
  const s = 1000 / S * k, cxm = D.X0 + D.W / 2 - FW / 2 * S / 1000, czm = D.Z0 + D.H / 2 - FH / 2 * S / 1000; // map shows the AOI centre
  const X = x => (fx + (x - cxm) * 1000 / S) * k, Y = z => (fy + (z - czm) * 1000 / S) * k, mm = v => v * k;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.lineCap = g.lineJoin = 'round';
  const font = (sz, wgt = 400) => g.font = `${wgt} ${mm(sz)}px ${FONT}`;
  // ===== map body =====
  g.save(); g.beginPath(); g.rect(mm(fx), mm(fy), mm(FW), mm(FH)); g.clip();
  say('Land cover…');
  if (o.image) { g.globalAlpha = 0.45; const sx0 = D.pxX(F.lon(D.X0)), sx1 = D.pxX(F.lon(D.X0 + D.W)), sy0 = D.pxY(F.lat(D.Z0)), sy1 = D.pxY(F.lat(D.Z0 + D.H)); g.drawImage(D.img, sx0, sy0, sx1 - sx0, sy1 - sy0, X(D.X0), Y(D.Z0), D.W * s, D.H * s); g.globalAlpha = 1; }
  // class fills (topographic tints) + map symbols per class
  const { gw, gh, C } = D, lc = D.lc, lcv = document.createElement('canvas'); lcv.width = gw; lcv.height = gh;
  { const lg = lcv.getContext('2d'), im = lg.createImageData(gw, gh); for (let q = 0; q < lc.length; q++) { const h = LC[lc[q]].topo, a = o.image ? 150 : 255; im.data.set([parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), lc[q] === 13 || lc[q] === 0 ? 0 : a], q * 4); } lg.putImageData(im, 0, 0); }
  g.imageSmoothingEnabled = true; g.drawImage(lcv, X(D.X0), Y(D.Z0), gw * C * s, gh * C * s);
  const pat = kind => { const P = Math.max(6, Math.round(mm(kind === 'rice' ? 3.2 : kind === 'grass' ? 3 : 2.6))), c = document.createElement('canvas'); c.width = c.height = P; const p = c.getContext('2d'); p.lineWidth = Math.max(1, mm(0.13)); p.lineCap = 'round';
    const col = { tree: '#2f6b2a', tree2: '#3f7f36', shrub: '#4a8a3a', orchard: '#2f6b2a', rice: '#4f7f2a', crop: '#8a7a2a', grass: '#5f8f3a', marsh: '#3a7fa8', sand: '#b89a5a' }[kind]; p.strokeStyle = p.fillStyle = col;
    if (kind === 'tree' || kind === 'tree2') { const r = P * (kind === 'tree' ? 0.2 : 0.15); p.beginPath(); p.arc(P * 0.3, P * 0.35, r, 0, 7); p.stroke(); if (kind === 'tree') { p.beginPath(); p.arc(P * 0.78, P * 0.82, r, 0, 7); p.stroke(); } }
    if (kind === 'shrub') { p.beginPath(); p.arc(P * 0.5, P * 0.5, P * 0.1, 0, 7); p.fill(); }
    if (kind === 'orchard') { p.beginPath(); p.arc(P * 0.5, P * 0.5, P * 0.12, 0, 7); p.fill(); p.fillRect(P * 0.48, P * 0.6, P * 0.04, P * 0.2); }
    if (kind === 'rice') { const b = P * 0.75; p.beginPath(); p.moveTo(P * 0.5, b); p.lineTo(P * 0.5, b - P * 0.3); p.moveTo(P * 0.5, b); p.lineTo(P * 0.36, b - P * 0.24); p.moveTo(P * 0.5, b); p.lineTo(P * 0.64, b - P * 0.24); p.stroke(); }
    if (kind === 'crop') { p.beginPath(); p.moveTo(0, P * 0.5); p.lineTo(P, P * 0.5); p.stroke(); }
    if (kind === 'grass') { p.beginPath(); p.moveTo(P * 0.4, P * 0.7); p.lineTo(P * 0.45, P * 0.5); p.moveTo(P * 0.55, P * 0.7); p.lineTo(P * 0.6, P * 0.5); p.stroke(); }
    if (kind === 'marsh') { p.beginPath(); p.moveTo(P * 0.2, P * 0.6); p.lineTo(P * 0.8, P * 0.6); p.moveTo(P * 0.35, P * 0.45); p.lineTo(P * 0.65, P * 0.45); p.stroke(); }
    if (kind === 'sand') { for (const [a, b] of [[0.2, 0.3], [0.7, 0.2], [0.5, 0.7]]) { p.beginPath(); p.arc(P * a, P * b, P * 0.05, 0, 7); p.fill(); } }
    return c; };
  const patCache = {};
  for (const [cls, kind] of Object.entries(LC_SYM)) {
    if (!(D.lcPct && D.lcPct[cls] > 0.002)) continue;
    const m = document.createElement('canvas'); m.width = gw; m.height = gh; const mg = m.getContext('2d'), im = mg.createImageData(gw, gh);
    for (let q = 0; q < lc.length; q++) if (lc[q] == cls) im.data[q * 4 + 3] = 255; mg.putImageData(im, 0, 0);
    const big = document.createElement('canvas'); big.width = cv.width; big.height = cv.height; const bg = big.getContext('2d');
    bg.imageSmoothingEnabled = true; bg.drawImage(m, X(D.X0), Y(D.Z0), gw * C * s, gh * C * s); bg.globalCompositeOperation = 'source-in';
    bg.fillStyle = bg.createPattern(patCache[kind] || (patCache[kind] = pat(kind)), 'repeat'); bg.fillRect(0, 0, big.width, big.height); g.drawImage(big, 0, 0);
  }
  // elevation grid for hillshade and contours
  say('Contours…');
  const TD = terrainData(world, o.ci, S), { gs, nx, nz, E, lo, hi, rng, CI, IDX, contours } = TD;
  if (o.hill) {
    const hc = document.createElement('canvas'); hc.width = nx; hc.height = nz; const hg = hc.getContext('2d'), im = hg.createImageData(nx, nz), zf = 2.2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i, dzdx = (E[j * nx + Math.min(nx - 1, i + 1)] - E[j * nx + Math.max(0, i - 1)]) / (2 * gs) * zf, dzdy = (E[Math.min(nz - 1, j + 1) * nx + i] - E[Math.max(0, j - 1) * nx + i]) / (2 * gs) * zf;
      const nl = Math.hypot(dzdx, dzdy, 1), sh = (-dzdx * -0.5 + -dzdy * -0.5 + 0.7) / nl / 0.97, v = Math.max(0, Math.min(1, sh)); const dark = 1 - v; im.data.set([40, 40, 60, Math.round(Math.max(0, dark - 0.25) * 170)], q * 4); }
    hg.putImageData(im, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(hc, X(D.X0), Y(D.Z0), (nx - 1) * gs * s, (nz - 1) * gs * s);
  }
  for (const c of contours) { g.strokeStyle = '#a8662e'; g.lineWidth = mm(c.idx ? 0.32 : 0.14); g.beginPath(); c.line.forEach((p, q) => q ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
  // water
  say('Water, roads and buildings…');
  const path = (pts, close) => { g.beginPath(); pts.forEach((p, q) => { const x = p.x ?? p[0], z = p.z ?? p[1]; q ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)); }); if (close) g.closePath(); };
  g.fillStyle = '#a9cdea'; g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.15);
  for (const rings of D.waterPolys || []) { g.beginPath(); for (const r of rings) r.forEach((p, q) => q ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.fill('evenodd'); g.stroke(); }
  for (const wv of D.waterways || []) { g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(wv.t === 1 ? 0.6 : wv.t === 2 ? 0.45 : 0.25); path(wv.pts); g.stroke(); }
  // roads: casings then fills, minor first
  const roads = (D.roads || []).slice().sort((a, b) => b.cls - a.cls);
  for (const pass of [0, 1]) for (const r of roads) { const st = RS(r.cls); if (pass === 0 && !st.o) continue; g.setLineDash(pass && st.d ? st.d.map(mm) : []); g.strokeStyle = pass ? st.f : st.o; g.lineWidth = mm(st.w + (pass ? 0 : 0.3)); path(r.pts); g.stroke(); }
  g.setLineDash([]);
  // editor roads
  const ed = o.mine && world.editor ? world.editor.features.filter(f => world.editor.inAOI(f)) : [];
  for (const pass of [0, 1]) for (const f of ed.filter(f => f.type === 'road')) { const c = { primary: 5, secondary: 7, tertiary: 9, residential: 12, track: 16, path: 17 }[f.props.road] || 12, st = RS(c); if (pass === 0 && !st.o) continue; g.setLineDash(pass && st.d ? st.d.map(mm) : []); g.strokeStyle = pass ? st.f : st.o; g.lineWidth = mm(st.w + (pass ? 0 : 0.3)); path(f.coords.map(cc => [F.x(cc[0]), F.z(cc[1])])); g.stroke(); }
  g.setLineDash([]);
  // railways
  for (const r of D.rails || []) { g.strokeStyle = '#222'; g.lineWidth = mm(0.5); path(r); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = mm(0.3); g.setLineDash([mm(1.2), mm(1.2)]); path(r); g.stroke(); g.setLineDash([]); }
  // buildings
  for (const b of D.buildings || []) { let A = 0; const r = b.ring; for (let q = 0; q < r.length; q++) { const p = r[q], n2 = r[(q + 1) % r.length]; A += p[0] * n2[1] - n2[0] * p[1]; } A = Math.abs(A) / 2;
    path(r, true); if (A > 600) { g.fillStyle = '#9a9a9a'; g.fill(); g.strokeStyle = '#333'; g.lineWidth = mm(0.15); g.stroke(); } else { g.fillStyle = '#3a3a3a'; g.fill(); } }
  g.fillStyle = '#5a5a5a'; for (const b of world.housesList || []) { path(b.ring, true); g.fill(); }
  g.fillStyle = '#7a2a8a'; for (const f of ed.filter(f => f.type === 'building')) { path(f.coords.map(cc => [F.x(cc[0]), F.z(cc[1])]), true); g.fill(); }
  g.fillStyle = '#a9cdea'; for (const f of ed.filter(f => f.type === 'pond')) { path(f.coords.map(cc => [F.x(cc[0]), F.z(cc[1])]), true); g.fill(); g.strokeStyle = '#3f7fbf'; g.stroke(); }
  for (const f of ed.filter(f => f.type === 'tree')) { const x = X(F.x(f.coords[0][0])), y = Y(F.z(f.coords[0][1])); g.fillStyle = '#2f6b2a'; g.beginPath(); g.arc(x, y, mm(0.6), 0, 7); g.fill(); }
  // contour labels (index contours), knocking out the line under the number
  font(1.9, 500);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const c of contours.filter(c => c.idx && c.len * 1000 / S > 25)) {
    const every = 90 * S / 1000; let acc = every * 0.4;
    for (let q = 1; q < c.line.length; q++) {
      const a = c.line[q - 1], b = c.line[q], d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += d; if (acc < every) continue; acc = 0;
      let ang = Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0])); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const txt = N(Math.round(c.L * 10) / 10), tw = g.measureText(txt).width + mm(0.8);
      g.save(); g.translate(X(b[0]), Y(b[1])); g.rotate(ang); g.fillStyle = '#fff'; g.fillRect(-tw / 2, -mm(1.1), tw, mm(2.2)); g.fillStyle = '#8a4a1e'; g.fillText(txt, 0, mm(0.1)); g.restore();
    }
  }
  // spot heights: highest point + local summits
  {
    font(1.9, 600); g.textAlign = 'left';
    for (const [x, z, v] of TD.spots) { g.fillStyle = '#222'; g.beginPath(); g.arc(X(x), Y(z), mm(0.45), 0, 7); g.fill(); g.lineWidth = mm(0.5); g.strokeStyle = '#fff'; const t = '·' + N(Math.round(world.rawElevation(x, z))); g.strokeText(t.slice(1), X(x) + mm(0.8), Y(z)); g.fillText(t.slice(1), X(x) + mm(0.8), Y(z)); }
  }
  // place names and landmarks from OpenStreetMap
  if (o.names) {
    say('Place names (OpenStreetMap)…');
    const el = await localNames(aoi), RANKP = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4, neighbourhood: 5, locality: 6 }, boxes = [];
    el.sort((a, b) => (RANKP[a.tags.place] ?? 9) - (RANKP[b.tags.place] ?? 9));
    for (const e of el) {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (lat == null) continue; const x = F.x(lon), z = F.z(lat);
      if (x < cxm || z < czm || x > cxm + FW * S / 1000 || z > czm + FH * S / 1000) continue;
      const t = e.tags || {}, nk = t['name:km'] || (/[ក-៿]/.test(t.name || '') ? t.name : ''), ne = t['name:en'] || (/[A-Za-z]/.test(t.name || '') ? t.name : '');
      const name = lang === 'km' ? (nk || ne) : lang === 'en' ? (ne || nk) : [nk, ne].filter(Boolean).join(' · '); const px = X(x), py = Y(z);
      const am = t.amenity, rel = t.religion;
      g.save(); g.fillStyle = '#111';
      if (am === 'place_of_worship') { g.fillStyle = rel === 'muslim' ? '#2a7a3a' : '#b0302a'; g.beginPath(); g.moveTo(px, py - mm(1.6)); g.lineTo(px + mm(1.1), py + mm(0.6)); g.lineTo(px - mm(1.1), py + mm(0.6)); g.closePath(); g.fill(); }
      else if (am === 'school' || am === 'university') { g.fillRect(px - mm(0.12), py - mm(1.6), mm(0.24), mm(1.9)); g.fillStyle = '#2f5fbf'; g.fillRect(px, py - mm(1.6), mm(1.1), mm(0.7)); }
      else if (am === 'hospital' || am === 'clinic') { g.fillStyle = '#d02020'; g.fillRect(px - mm(0.9), py - mm(0.3), mm(1.8), mm(0.6)); g.fillRect(px - mm(0.3), py - mm(0.9), mm(0.6), mm(1.8)); }
      else if (am === 'marketplace') { g.strokeStyle = '#111'; g.lineWidth = mm(0.2); g.strokeRect(px - mm(0.8), py - mm(0.8), mm(1.6), mm(1.6)); }
      else if (am === 'police' || am === 'townhall') { g.beginPath(); g.arc(px, py, mm(0.8), 0, 7); g.strokeStyle = '#111'; g.lineWidth = mm(0.25); g.stroke(); g.beginPath(); g.arc(px, py, mm(0.3), 0, 7); g.fill(); }
      else if (am === 'fuel') { g.fillStyle = '#333'; g.fillRect(px - mm(0.6), py - mm(0.8), mm(1.2), mm(1.6)); }
      else if (t.natural === 'peak') { g.beginPath(); g.moveTo(px, py - mm(1.1)); g.lineTo(px + mm(1), py + mm(0.6)); g.lineTo(px - mm(1), py + mm(0.6)); g.closePath(); g.fill(); }
      if (name) {
        const placeSz = { city: 4.2, town: 3.4, village: 2.6, suburb: 2.4, hamlet: 2.1, neighbourhood: 2, locality: 2 }[t.place];
        const isRiver = t.waterway === 'river'; font(placeSz || 1.8, placeSz ? 600 : 400); g.textAlign = placeSz ? 'center' : 'left'; g.textBaseline = 'middle';
        g.lineWidth = mm(0.6); g.strokeStyle = 'rgba(255,255,255,.9)'; const tx = placeSz ? px : px + mm(1.4), ty = placeSz ? py : py - mm(0.3);
        g.fillStyle = isRiver ? '#1f5fa8' : placeSz ? '#222' : '#333'; if (isRiver) g.font = `italic 500 ${mm(2.6)}px ${FONT}`;
        const tw = g.measureText(name).width, th = mm(placeSz || 1.8), bx0 = placeSz ? tx - tw / 2 : tx, box = [bx0 - mm(0.5), ty - th / 2 - mm(0.5), bx0 + tw + mm(0.5), ty + th / 2 + mm(0.5)];
        if (!boxes.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) { boxes.push(box); g.strokeText(name, tx, ty); g.fillText(name, tx, ty); }
      }
      g.restore();
    }
  }
  // survey points, parcels, tactical overlay
  if (o.survey && world.survey) {
    const sv = world.survey; g.strokeStyle = '#e07b00'; g.lineWidth = mm(0.4);
    for (const p of sv.parcelsHere()) { path(p.coords.map(c => [F.x(c[0]), F.z(c[1])]), true); g.stroke(); const cx = p.coords.reduce((a, c) => a + F.x(c[0]), 0) / p.coords.length, cz = p.coords.reduce((a, c) => a + F.z(c[1]), 0) / p.coords.length; font(1.8, 600); g.fillStyle = '#b05a00'; g.textAlign = 'center'; g.fillText(p.name, X(cx), Y(cz)); }
    font(1.6, 600); g.textAlign = 'left';
    for (const p of sv.points) { g.fillStyle = '#e04020'; g.beginPath(); g.moveTo(X(p.x), Y(p.z) - mm(0.9)); g.lineTo(X(p.x) + mm(0.8), Y(p.z) + mm(0.5)); g.lineTo(X(p.x) - mm(0.8), Y(p.z) + mm(0.5)); g.closePath(); g.fill(); g.fillStyle = '#111'; g.fillText(p.id, X(p.x) + mm(1), Y(p.z)); }
  }
  if (o.tac && world.tactical) {
    const tc = world.tactical, { symbolURL } = await import('./tactical.js?v=45');
    for (const f of tc.features.filter(f => tc.inAOI(f))) {
      const col = tc.color(f.side, f.code), P = f.coords.map(c => [F.x(c[0]), F.z(c[1])]); g.strokeStyle = g.fillStyle = col; g.lineWidth = mm(0.5);
      if (f.geom === 'point') { try { const im = await loadImg(await symbolURL(f.code, col)); const sz = mm(6); g.drawImage(im, X(P[0][0]) - sz / 2, Y(P[0][1]) - sz, sz, sz); if (f.label) { font(1.8, 700); g.textAlign = 'center'; g.fillText(f.label, X(P[0][0]), Y(P[0][1]) + mm(1.5)); } } catch (e) { } }
      else if (f.geom === 'polygon') { path(P, true); g.globalAlpha = 0.15; g.fill(); g.globalAlpha = 1; g.stroke(); }
      else if (f.geom === 'circle') for (const r of (f.props && f.props.rings) || []) { g.setLineDash([mm(2), mm(1.2)]); g.beginPath(); g.arc(X(P[0][0]), Y(P[0][1]), r * s, 0, 7); g.stroke(); g.setLineDash([]); }
      else { path(P); g.stroke(); if (/axis|route|fire_direction/.test(f.code)) { const a = P[P.length - 2], b = P[P.length - 1], an = Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0])); g.beginPath(); g.moveTo(X(b[0]), Y(b[1])); g.lineTo(X(b[0]) - Math.cos(an - 0.45) * mm(3), Y(b[1]) - Math.sin(an - 0.45) * mm(3)); g.lineTo(X(b[0]) - Math.cos(an + 0.45) * mm(3), Y(b[1]) - Math.sin(an + 0.45) * mm(3)); g.closePath(); g.fill(); } }
    }
  }
  // UTM grid
  const C0 = utm(aoi.s, aoi.w), C1 = utm(aoi.n, aoi.e), zone = utm((aoi.s + aoi.n) / 2, (aoi.w + aoi.e) / 2).zone;
  const span = Math.max(C1.E - C0.E, C1.N - C0.N), GI = [100, 200, 250, 500, 1000, 2000, 5000].find(v => span / v <= 9) || 10000;
  const toXZ = (E_, N_) => { const ll = utmInv(E_, N_, zone, true); return [F.x(ll.lon), F.z(ll.lat)]; };
  const mx0 = cxm, mz0 = czm, mx1 = cxm + FW * S / 1000, mz1 = czm + FH * S / 1000;
  g.strokeStyle = 'rgba(30,60,140,.55)'; g.lineWidth = mm(0.12);
  const eLines = [], nLines = [];
  for (let E_ = Math.ceil((C0.E - 2000) / GI) * GI; E_ <= C1.E + 2000; E_ += GI) { const a = toXZ(E_, C0.N - 3000), b = toXZ(E_, C1.N + 3000); g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); eLines.push([E_, a, b]); }
  for (let N_ = Math.ceil((C0.N - 2000) / GI) * GI; N_ <= C1.N + 2000; N_ += GI) { const a = toXZ(C0.E - 3000, N_), b = toXZ(C1.E + 3000, N_); g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); nLines.push([N_, a, b]); }
  g.restore();
  // frame and grid labels
  g.strokeStyle = '#111'; g.lineWidth = mm(0.5); g.strokeRect(mm(fx), mm(fy), mm(FW), mm(FH)); g.lineWidth = mm(0.15); g.strokeRect(mm(fx - 1.5), mm(fy - 1.5), mm(FW + 3), mm(FH + 3));
  const gl = v => { const kmv = Math.floor(v / 1000), rest = Math.round(v % 1000); return [String(Math.floor(kmv / 100)), String(kmv % 100).padStart(2, '0'), GI < 1000 ? String(rest).padStart(3, '0') : '']; };
  const drawGL = (v, x, y, align) => { const [a, b, c] = gl(v); g.textBaseline = 'middle'; g.textAlign = 'left'; font(1.6); const wa = g.measureText(a).width; font(2.6, 700); const wb = g.measureText(b).width; font(1.6); const wc = c ? g.measureText(c).width : 0;
    let x0 = align === 'center' ? x - (wa + wb + wc) / 2 : align === 'right' ? x - (wa + wb + wc) : x; g.fillStyle = '#111'; font(1.6); g.fillText(a, x0, y + mm(0.3)); font(2.6, 700); g.fillText(b, x0 + wa, y); if (c) { font(1.6); g.fillText(c, x0 + wa + wb, y + mm(0.3)); } };
  for (const [E_, a, b] of eLines) { const t = (mz0 - a[1]) / (b[1] - a[1]), xa = a[0] + (b[0] - a[0]) * t, t2 = (mz1 - a[1]) / (b[1] - a[1]), xb = a[0] + (b[0] - a[0]) * t2; if (xa > mx0 && xa < mx1) drawGL(E_, X(xa), mm(fy - 3.2), 'center'); if (xb > mx0 && xb < mx1) drawGL(E_, X(xb), mm(fy + FH + 3.2), 'center'); }
  for (const [N_, a, b] of nLines) { const t = (mx0 - a[0]) / (b[0] - a[0]), za = a[1] + (b[1] - a[1]) * t, t2 = (mx1 - a[0]) / (b[0] - a[0]), zb = a[1] + (b[1] - a[1]) * t2; for (const [zz, xx] of [[za, fx - 3.1], [zb, fx + FW + 3.1]]) if (zz > mz0 && zz < mz1) { g.save(); g.translate(mm(xx), Y(zz)); g.rotate(-Math.PI / 2); drawGL(N_, 0, 0, 'center'); g.restore(); } } // northings read upwards on both sides
  // geographic corners
  const dms = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s2 = ((a - d) * 60 - m) * 60; return `${d}°${String(m).padStart(2, '0')}'${s2.toFixed(0).padStart(2, '0')}"${v >= 0 ? p : n}`; };
  font(1.5); g.fillStyle = '#333';
  const cLL = (x, z) => [F.lon(x), F.lat(z)];
  for (const [x, z, ax, ay, al] of [[mx0, mz0, fx, fy - 6.2, 'left'], [mx1, mz0, fx + FW, fy - 6.2, 'right'], [mx0, mz1, fx, fy + FH + 6.2, 'left'], [mx1, mz1, fx + FW, fy + FH + 6.2, 'right']]) { const [lon, lat] = cLL(x, z); g.textAlign = al; g.fillText(`${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'W')}`, mm(ax), mm(ay)); }
  // ===== title =====
  const place = o.title || '', titleKm = o.titleKm || place, titleEn = place;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1f3f8f'; font(5.2, 700);
  g.fillText(lang === 'en' ? `${titleEn.toUpperCase()}` : lang === 'km' ? titleKm : `${titleKm}${titleEn && titleKm !== titleEn ? ' - ' + titleEn.toUpperCase() : ''}`, mm(fx + FW / 2), mm(M + 5));
  font(2.3); g.fillStyle = '#333'; g.textAlign = 'left'; g.fillText(T(`Scale 1:${S.toLocaleString('en')}`, `មាត្រដ្ឋាន ១:${KD(S)}`), mm(fx), mm(M + 5));
  g.textAlign = 'right'; g.fillText(T(`Topographic map · UTM ${zone}N`, `ផែនទីសណ្ឋានដី · UTM ${KD(zone)}N`), mm(fx + FW), mm(M + 5));
  // ===== margin: legend, scale, north, location, credits =====
  const lx = land ? fx + FW + 9 : M, ly = land ? M + head : fy + FH + 9, lw = land ? side : W - 2 * M;
  const cols = land ? 2 : 4, colW = lw / cols, legBottom = land ? H - M - 96 : H - M - 2; let col = 0, cy = ly, colTop = () => ly + 5;
  const LS = o.legend || 'illus', caps = v => lang === 'km' ? v : v.toUpperCase();
  // three legend styles (after TopoStyler): illustrated, sheet with dot leaders, simple list
  const heading = (txt) => { if (cy + 9 > legBottom) { col++; cy = colTop(); } const x0 = lx + col * colW; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (LS === 'simple') { font(2.4, 700); g.fillStyle = '#1f3f8f'; g.fillText(txt, mm(x0), mm(cy + 1.5)); cy += 5; return; }
    font(2.1, 700); g.fillStyle = '#222'; g.fillText(caps(txt), mm(x0), mm(cy + 1.4)); g.strokeStyle = '#222'; g.lineWidth = mm(LS === 'sheet' ? 0.25 : 0.12); g.beginPath(); g.moveTo(mm(x0), mm(cy + 3.3)); g.lineTo(mm(x0 + colW - 3), mm(cy + 3.3)); g.stroke(); cy += 5.6; };
  const item = (draw, txt) => { const two = lang === 'both' && txt.includes(' · '), hgt = two ? 5.4 : 4.1; if (cy + hgt > legBottom) { col++; cy = colTop(); } const x0 = lx + col * colW; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (LS === 'sheet') { // "Description ........ [symbol]"
      const sx = x0 + colW - 12, a = two ? txt.slice(0, txt.indexOf(' · ')) : txt, b = two ? txt.slice(txt.indexOf(' · ') + 3) : '';
      draw(mm(sx), mm(cy), mm(8), mm(3)); font(1.8); g.fillStyle = '#222'; g.fillText(a, mm(x0), mm(cy + (two ? 0.6 : 1.5))); const tw = g.measureText(a).width;
      g.fillStyle = '#777'; const dot = mm(0.9); for (let x = mm(x0) + tw + mm(1); x < mm(sx - 1); x += dot) g.fillRect(x, mm(cy + (two ? 0.6 : 1.5)) + mm(0.4), mm(0.18), mm(0.18));
      if (b) { font(1.5); g.fillStyle = '#555'; g.fillText(b, mm(x0), mm(cy + 2.9)); } cy += hgt; return; }
    draw(mm(x0), mm(cy), mm(8), mm(3)); g.fillStyle = '#222';
    if (two) { const i = txt.indexOf(' · '); font(1.8); g.fillText(txt.slice(0, i), mm(x0 + 9.5), mm(cy + 0.6)); font(1.5); g.fillStyle = '#555'; g.fillText(txt.slice(i + 3), mm(x0 + 9.5), mm(cy + 2.9)); } else { font(1.8); g.fillText(txt, mm(x0 + 9.5), mm(cy + 1.5)); } cy += hgt; };
  // hand-drawn parcel for land cover (wobbly rounded shape)
  const wobbly = (x, y, w, h, seed) => { const P = []; const n = 10; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, j = 1 + 0.12 * Math.sin(seed * 7.3 + k * 2.1); P.push([x + w / 2 + Math.cos(a) * w / 2 * j * 0.98, y + h / 2 + Math.sin(a) * h / 2 * j * 0.95]); }
    g.beginPath(); for (let k = 0; k <= n; k++) { const p0 = P[k % n], p1 = P[(k + 1) % n], m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]; if (!k) g.moveTo(m[0], m[1]); else g.quadraticCurveTo(p0[0], p0[1], m[0], m[1]); } g.closePath(); };
  if (LS !== 'simple') { font(3.4, 700); g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lang === 'km' ? 'សញ្ញាផែនទី' : lang === 'both' ? 'LEGEND · សញ្ញាផែនទី' : 'LEGEND', mm(lx), mm(cy + 2)); cy += 7; }
  heading(T(LS === 'simple' ? 'Legend' : 'Roads and settlements', LS === 'simple' ? 'សញ្ញាផែនទី' : 'ផ្លូវ និងទីលំនៅ'));
  const usedR = new Map(); for (const r of D.roads || []) { const st = RS(r.cls); usedR.set(st.k, st); }
  const roadLine = (st, path) => { g.setLineDash([]); g.lineCap = 'round'; if (st.o) { g.strokeStyle = st.o; g.lineWidth = mm(st.w + 0.3); path(); g.stroke(); } g.setLineDash(st.d ? st.d.map(mm) : []); g.strokeStyle = st.f; g.lineWidth = mm(st.w); path(); g.stroke(); g.setLineDash([]); g.lineCap = 'butt'; };
  if (LS === 'illus' && usedR.size) { // roads converging on a village, labelled with hairline callouts
    const R = [...usedR.values()].slice(0, 7), sw = land ? lw - 3 : colW * 2 - 4, sh = 4 + R.length * 4.6, x0 = lx, y0 = cy, vx = x0 + sw * 0.86, vy = y0 + sh / 2;
    g.fillStyle = '#f4f1e8'; wobbly(mm(x0 + sw * 0.5), mm(y0 + 0.5), mm(sw * 0.5), mm(sh - 1), 3); g.fill();
    R.forEach((st, k) => { const yy = y0 + 3 + k * 4.6, sx = x0 + sw * 0.5, mxp = x0 + sw * 0.7;
      roadLine(st, () => { g.beginPath(); g.moveTo(mm(sx), mm(yy)); g.bezierCurveTo(mm(mxp), mm(yy), mm(vx - 6), mm(vy + (yy - vy) * 0.3), mm(vx), mm(vy)); });
      const two = lang === 'both', en = st.k, kmn = st.km; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#222'; font(1.7); const lab = lang === 'km' ? kmn : en; g.fillText(lab, mm(x0), mm(yy - (two ? 0.8 : 0))); let tw = g.measureText(lab).width;
      if (two) { font(1.4); g.fillStyle = '#555'; g.fillText(kmn, mm(x0), mm(yy + 1.3)); tw = Math.max(tw, g.measureText(kmn).width); }
      g.strokeStyle = '#555'; g.lineWidth = mm(0.08); g.beginPath(); g.moveTo(mm(x0) + tw + mm(0.8), mm(yy)); g.lineTo(mm(sx - 0.6), mm(yy)); g.stroke(); g.fillStyle = '#555'; g.beginPath(); g.arc(mm(sx - 0.6), mm(yy), mm(0.25), 0, 7); g.fill(); });
    g.fillStyle = '#3a3a3a'; for (const [dx, dy, bw_, bh] of [[-2.4, -2, 1.4, 1.1], [-0.6, -2.6, 1.2, 1.2], [1, -1.4, 1.5, 1.1], [-1.8, 0.4, 1.2, 1.3], [0.2, 0.6, 1.4, 1], [1.8, 0.9, 1.1, 1.2], [-0.5, 2.2, 1.3, 1]]) g.fillRect(mm(vx + dx), mm(vy + dy), mm(bw_), mm(bh));
    font(1.6, 700); g.fillStyle = '#111'; g.textAlign = 'center'; g.fillText(T('Village', 'ភូមិ'), mm(vx), mm(vy + 4.6));
    cy = y0 + sh + 2; if (!land) { const sb = cy; colTop = () => (col < 2 ? sb : ly + 5); }
  } else for (const st of usedR.values()) item((x, y, w, h) => { g.setLineDash([]); if (st.o) { g.strokeStyle = st.o; g.lineWidth = mm(st.w + 0.3); g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); } g.setLineDash(st.d ? st.d.map(mm) : []); g.strokeStyle = st.f; g.lineWidth = mm(st.w); g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); g.setLineDash([]); }, T(st.k, st.km));
  if (LS !== 'simple') { cy += 1.5; heading(T('Water, buildings and relief', 'ទឹក អគារ និងទម្រង់ដី')); }
  if ((D.rails || []).length) item((x, y, w, h) => { g.strokeStyle = '#222'; g.lineWidth = mm(0.5); g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = mm(0.3); g.setLineDash([mm(1.2), mm(1.2)]); g.stroke(); g.setLineDash([]); }, T('Railway', 'ផ្លូវដែក'));
  item((x, y, w, h) => { g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.4); g.beginPath(); g.moveTo(x, y + h * 0.7); g.bezierCurveTo(x + w * 0.3, y, x + w * 0.6, y + h, x + w, y + h * 0.3); g.stroke(); }, T('River / stream / canal', 'ទន្លេ / អូរ / ប្រឡាយ'));
  item((x, y, w, h) => { g.fillStyle = '#a9cdea'; g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.15); g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h); }, T('Lake / pond / reservoir', 'បឹង / ស្រះ / អាងទឹក'));
  if ((D.buildings || []).length) item((x, y, w, h) => { g.fillStyle = '#3a3a3a'; g.fillRect(x + w * 0.1, y + h * 0.2, w * 0.25, h * 0.6); g.fillRect(x + w * 0.5, y + h * 0.1, w * 0.3, h * 0.7); }, T('Building (OpenStreetMap)', 'អគារ (OpenStreetMap)'));
  if ((world.housesList || []).length) item((x, y, w, h) => { g.fillStyle = '#5a5a5a'; for (const a of [0.1, 0.45, 0.75]) g.fillRect(x + w * a, y + h * 0.3, w * 0.18, h * 0.45); }, T('House (from the image)', 'ផ្ទះ (ពីរូបភាព)'));
  item((x, y, w, h) => { g.strokeStyle = '#a8662e'; g.lineWidth = mm(0.14); g.beginPath(); g.moveTo(x, y + h * 0.3); g.lineTo(x + w, y + h * 0.3); g.stroke(); g.lineWidth = mm(0.32); g.beginPath(); g.moveTo(x, y + h * 0.75); g.lineTo(x + w, y + h * 0.75); g.stroke(); }, T(`Contour ${CI} m, index ${CI * IDX} m`, `ខ្សែកម្ពស់ ${KD(CI)} ម, ខ្សែមេ ${KD(CI * IDX)} ម`));
  item((x, y, w, h) => { g.fillStyle = '#222'; g.beginPath(); g.arc(x + w * 0.3, y + h / 2, mm(0.45), 0, 7); g.fill(); font(1.8, 600); g.fillText(N(124), x + w * 0.42, y + h / 2); }, T('Spot height (m)', 'ចំណុចកម្ពស់ (ម)'));
  if (o.names) { if (LS !== 'simple') { cy += 1.5; heading(T('Places and landmarks', 'ទីកន្លែង និងទីសម្គាល់')); } item((x, y, w, h) => { g.fillStyle = '#b0302a'; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + mm(1.1), y + h * 0.8); g.lineTo(x + w / 2 - mm(1.1), y + h * 0.8); g.closePath(); g.fill(); }, T('Pagoda / temple', 'វត្ត / ទីសក្ការៈ'));
    item((x, y, w, h) => { g.fillStyle = '#111'; g.fillRect(x + w / 2 - mm(0.12), y, mm(0.24), h); g.fillStyle = '#2f5fbf'; g.fillRect(x + w / 2, y, mm(1.1), mm(0.7)); }, T('School', 'សាលារៀន'));
    item((x, y, w, h) => { g.fillStyle = '#d02020'; g.fillRect(x + w / 2 - mm(0.9), y + h / 2 - mm(0.3), mm(1.8), mm(0.6)); g.fillRect(x + w / 2 - mm(0.3), y + h / 2 - mm(0.9), mm(0.6), mm(1.8)); }, T('Hospital / health centre', 'មន្ទីរពេទ្យ / មណ្ឌលសុខភាព')); }
  cy += 2; heading(T('Land cover', 'គម្របដី'));
  const present = Object.keys(D.lcPct || {}).map(Number).filter(v => v > 0 && v !== 13 && D.lcPct[v] > 0.002).sort((a, b) => a - b);
  for (const c of present) item(LS === 'illus' ? (x, y, w, h) => { g.save(); wobbly(x, y - mm(0.3), w, h + mm(0.6), c); g.clip(); g.fillStyle = LC[c].topo; g.fillRect(x - 2, y - 4, w + 4, h + 8); if (LC_SYM[c]) { g.fillStyle = g.createPattern(patCache[LC_SYM[c]] || (patCache[LC_SYM[c]] = pat(LC_SYM[c])), 'repeat'); g.fillRect(x - 2, y - 4, w + 4, h + 8); } g.restore(); g.strokeStyle = '#777'; g.lineWidth = mm(0.1); wobbly(x, y - mm(0.3), w, h + mm(0.6), c); g.stroke(); } : (x, y, w, h) => { g.fillStyle = LC[c].topo; g.fillRect(x, y, w, h); if (LC_SYM[c]) { g.fillStyle = g.createPattern(patCache[LC_SYM[c]] || (patCache[LC_SYM[c]] = pat(LC_SYM[c])), 'repeat'); g.fillRect(x, y, w, h); } g.strokeStyle = '#999'; g.lineWidth = mm(0.1); g.strokeRect(x, y, w, h); }, T(LC[c].en, LC[c].km));
  // scale bar, north arrows, location map, credits in the lower part of the margin
  const bx = land ? lx : lx + 3 * colW + 2, byTop = land ? H - M - 92 : ly - 2; let by = byTop; const bw = land ? lw : colW - 2;
  font(2.6, 700); g.fillStyle = '#111'; g.textAlign = 'center'; g.fillText(T(`Scale 1:${S.toLocaleString('en')}`, `មាត្រដ្ឋាន ១:${KD(S)}`), mm(bx + bw / 2), mm(by + 2)); by += 5;
  { const unit = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reverse().find(u => u * 1000 / S * 4 <= bw - 8) || 10, seg = unit * 1000 / S, x0 = bx + (bw - seg * 4) / 2;
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff' : '#111'; g.fillRect(mm(x0 + i * seg), mm(by), mm(seg), mm(1.2)); } g.strokeStyle = '#111'; g.lineWidth = mm(0.15); g.strokeRect(mm(x0), mm(by), mm(seg * 4), mm(1.2));
    font(1.6); g.fillStyle = '#111'; for (let i = 0; i <= 4; i++) { const v = unit * i; g.fillText(N(v >= 1000 ? v / 1000 : v) + (i === 4 ? (unit * 4 >= 1000 ? (lang === 'km' ? ' គ.ម' : ' km') : (lang === 'km' ? ' ម' : ' m')) : ''), mm(x0 + i * seg), mm(by + 3)); }
    by += 6.5; font(1.7); g.fillText(T(`Contour interval ${CI} m`, `ចន្លោះខ្សែកម្ពស់ ${KD(CI)} ម`), mm(bx + bw / 2), mm(by)); by += 5; }
  // north arrows with grid convergence
  { const lat0 = (aoi.s + aoi.n) / 2, lon0 = (aoi.w + aoi.e) / 2, cm = (zone - 1) * 6 - 180 + 3, gam = Math.atan(Math.tan((lon0 - cm) * Math.PI / 180) * Math.sin(lat0 * Math.PI / 180)) * 180 / Math.PI;
    const nx0 = bx + 10, ny0 = by + 16, Lr = 13; g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = mm(0.25);
    g.beginPath(); g.moveTo(mm(nx0), mm(ny0)); g.lineTo(mm(nx0), mm(ny0 - Lr)); g.stroke(); g.beginPath(); g.moveTo(mm(nx0), mm(ny0 - Lr - 1.6)); g.lineTo(mm(nx0 + 0.9), mm(ny0 - Lr)); g.lineTo(mm(nx0 - 0.9), mm(ny0 - Lr)); g.fill();
    const gr = -gam * Math.PI / 180, gx = nx0 + Math.sin(gr) * Lr * 0.85, gy = ny0 - Math.cos(gr) * Lr * 0.85; g.strokeStyle = '#1f3f8f'; g.beginPath(); g.moveTo(mm(nx0), mm(ny0)); g.lineTo(mm(gx), mm(gy)); g.stroke();
    font(1.6, 600); g.textAlign = 'left'; g.fillStyle = '#111'; g.fillText(T('True north', 'ទិសខាងជើងពិត'), mm(nx0 + 1.5), mm(ny0 - Lr - 0.5)); g.fillStyle = '#1f3f8f'; g.fillText(T('Grid north', 'ទិសខាងជើងក្រឡា'), mm(gx + 1.5), mm(gy + 2));
    font(1.6); g.fillStyle = '#333'; g.fillText(T(`Grid convergence ${gam >= 0 ? '' : '−'}${Math.abs(gam).toFixed(2)}°`, `មុំបង្រួមក្រឡា ${KD(Math.abs(gam).toFixed(2))}°`), mm(nx0 + 1.5), mm(ny0 + 2.5)); }
  // location map
  { const zx = 6, tiles = [[50, 29], [51, 29], [50, 30], [51, 30]], lmW = land ? 34 : 34, lmH = 30, lmx = bx + bw - lmW, lmy = by + (land ? 1 : 24);
    try { const T0 = await Promise.all(tiles.map(([x, y]) => loadImg(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${zx}/${y}/${x}`)));
      const lon2x = lon => (lon + 180) / 360 * 64 * 256, lat2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 64 * 256;
      const vx0 = lon2x(102.2), vx1 = lon2x(107.7), vy0 = lat2y(14.75), vy1 = lat2y(10.3), sc = Math.min(mm(lmW) / (vx1 - vx0), mm(lmH) / (vy1 - vy0));
      g.save(); g.beginPath(); g.rect(mm(lmx), mm(lmy), mm(lmW), mm(lmH)); g.clip();
      tiles.forEach(([x, y], i) => g.drawImage(T0[i], mm(lmx) + (x * 256 - vx0) * sc, mm(lmy) + (y * 256 - vy0) * sc, 256 * sc, 256 * sc));
      g.strokeStyle = '#e01010'; g.lineWidth = mm(0.5); const ax = mm(lmx) + (lon2x((aoi.w + aoi.e) / 2) - vx0) * sc, ay = mm(lmy) + (lat2y((aoi.s + aoi.n) / 2) - vy0) * sc; g.strokeRect(ax - mm(1.2), ay - mm(1.2), mm(2.4), mm(2.4)); g.restore();
      g.strokeStyle = '#111'; g.lineWidth = mm(0.15); g.strokeRect(mm(lmx), mm(lmy), mm(lmW), mm(lmH)); font(1.5); g.fillStyle = '#333'; g.textAlign = 'center'; g.fillText(T('Location', 'ទីតាំង'), mm(lmx + lmW / 2), mm(lmy + lmH + 2)); } catch (e) { }
    by += land ? 36 : 58; }
  // credits
  { const lines = [
      T('Projection: Universal Transverse Mercator, zone ' + zone + 'N · Datum: WGS 84 (EPSG:326' + zone + ')', 'ប្រព័ន្ធចំណោល៖ UTM តំបន់ ' + KD(zone) + 'N · មូលដ្ឋាន៖ WGS 84'),
      T('Grid: ' + (GI >= 1000 ? GI / 1000 + ' km' : GI + ' m') + ' UTM grid', 'ក្រឡាចត្រង្គ UTM ' + (GI >= 1000 ? KD(GI / 1000) + ' គ.ម' : KD(GI) + ' ម')),
      T('Elevation: Mapzen / AWS Terrain Tiles (SRTM and others)', 'រយៈកម្ពស់៖ Mapzen / AWS Terrain Tiles'),
      T('Land cover: satellite image classification' + (D.lcIO ? ' + Esri | Impact Observatory 10 m' : '') + ' + OpenStreetMap', 'គម្របដី៖ ចំណាត់ថ្នាក់រូបភាពផ្កាយរណប' + (D.lcIO ? ' + Esri | Impact Observatory 10 ម' : '') + ' + OpenStreetMap'),
      T('Roads, water, buildings, names: © OpenStreetMap contributors (ODbL)', 'ផ្លូវ ទឹក អគារ ឈ្មោះ៖ © OpenStreetMap contributors'),
      T('Imagery: ' + (world.credit || 'Esri').replace(/<[^>]+>/g, ''), 'រូបភាព៖ ' + (world.credit || 'Esri').replace(/<[^>]+>/g, '')),
      T('Produced by Geoinformatics and Research Lab, RUPP · Cambodia 3D Landscape · ' + new Date().toISOString().slice(0, 10), 'ផលិតដោយ ក្រុមស្រាវជ្រាវ និងអភិវឌ្ឍន៍ព័ត៌មានភូមិសាស្ត្រ សាកលវិទ្យាល័យភូមិន្ទភ្នំពេញ · ' + KD(new Date().toISOString().slice(0, 10))),
      T('For reference only – derived from open data, not an official survey.', 'សម្រាប់ជាឯកសារយោងប៉ុណ្ណោះ – ពីទិន្នន័យបើកចំហ មិនមែនការវាស់វែងផ្លូវការទេ។'),
    ];
    font(1.45); g.fillStyle = '#333'; g.textAlign = 'left'; g.textBaseline = 'top';
    const tx = bx, maxW = mm(bw); let ty = land ? Math.max(by, H - M - 4 - lines.length * 2.6 * 1.6) : Math.max(by, H - M - lines.length * 2.6 * 1.6);
    for (const ln of lines) { const words = ln.split(' '); let cur = ''; for (const w_ of words) { const tst = cur ? cur + ' ' + w_ : w_; if (g.measureText(tst).width > maxW && cur) { g.fillText(cur, mm(tx), mm(ty)); ty += 2.2; cur = w_; } else cur = tst; } if (cur) { g.fillText(cur, mm(tx), mm(ty)); ty += 2.6; } } }
  say('');
  return { canvas: cv, scale: S, ci: CI, wmm: W, hmm: H };
}

export async function toPDF(res, name) {
  if (!window.jspdf) await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: res.wmm > res.hmm ? 'l' : 'p', unit: 'mm', format: [Math.min(res.wmm, res.hmm), Math.max(res.wmm, res.hmm)] });
  doc.addImage(res.canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, res.wmm, res.hmm); doc.save(name);
}
