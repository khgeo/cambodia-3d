// Topographic map sheet of the built area: land cover with map symbols, hillshade, contours with index labels,
// spot heights, water, roads by class, railways, buildings, place names and landmarks (OpenStreetMap), your own
// features, survey points, parcels and the tactical overlay; UTM grid with edge labels, bilingual legend,
// scale bar, north arrows with grid convergence, location map and credits. PNG or PDF.
import { LC } from './landcover.js?v=91';
import { utm } from './hud.js?v=91';
import { utmInv } from './survey.js?v=91';

const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };
const SCALES = [1000, 2000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 50000, 100000];
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
export async function localNames(aoi) {
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
  const M = 10, head = 16, side = 0, foot = land ? Math.max(60, H * 0.24) : Math.max(86, H * 0.31); // legend in columns under the map
  const fw = W - 2 * M - 12, fh = H - 2 * M - head - foot - 8;
  let S = o.scale === 'auto' ? SCALES.find(s => D.W * 1000 / s <= fw && D.H * 1000 / s <= fh) || 100000 : +o.scale;
  const mw = D.W * 1000 / S, mhh = D.H * 1000 / S, FW = Math.min(fw, mw), FH = Math.min(fh, mhh);
  // centre map + margin as one block
  const fx = M + (W - 2 * M - FW) / 2, fy = M + head + (fh - FH) / 2;
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
  // contour numbers: place them first, then cut (mask) the contour lines under each number – no white box
  font(1.9, 500); const cLabels = [];
  for (const c of contours.filter(c => c.idx && c.len * 1000 / S > 25)) {
    const every = 90 * S / 1000; let acc = every * 0.4;
    for (let q = 1; q < c.line.length; q++) {
      const a = c.line[q - 1], b = c.line[q], d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += d; if (acc < every) continue; acc = 0;
      let ang = Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0])); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const txt = N(Math.round(c.L * 10) / 10), tw = g.measureText(txt).width + mm(0.9), x = X(b[0]), y = Y(b[1]);
      if (cLabels.some(l => Math.hypot(l.x - x, l.y - y) < tw * 1.2)) continue; cLabels.push({ x, y, ang, txt, tw, th: mm(2.3) });
    }
  }
  g.save(); g.beginPath(); g.rect(0, 0, cv.width, cv.height);
  for (const l of cLabels) { const c = Math.cos(l.ang), sn = Math.sin(l.ang), hw = l.tw / 2, hh = l.th / 2; const P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [l.x + u * c - v * sn, l.y + u * sn + v * c]); g.moveTo(...P[0]); for (const q of [3, 2, 1]) g.lineTo(...P[q]); g.closePath(); }
  g.clip('evenodd');
  for (const c of contours) { g.strokeStyle = '#a8662e'; g.lineWidth = mm(c.idx ? 0.32 : 0.14); g.beginPath(); c.line.forEach((p, q) => q ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
  g.restore();
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
  // contour numbers (in the gaps cut into the lines above)
  font(1.9, 500); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#8a4a1e';
  for (const l of cLabels) { g.save(); g.translate(l.x, l.y); g.rotate(l.ang); g.fillText(l.txt, 0, mm(0.1)); g.restore(); }
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
    const tc = world.tactical, { symbolURL } = await import('./tactical.js?v=91');
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
  // the title shrinks if it would run into the scale / series text on either side
  const ttl = lang === 'en' ? `${titleEn.toUpperCase()}` : lang === 'km' ? titleKm : `${titleKm}${titleEn && titleKm !== titleEn ? ' - ' + titleEn.toUpperCase() : ''}`;
  font(2.3); const sideW = Math.max(g.measureText(T(`Scale 1:${S.toLocaleString('en')}`, `មាត្រដ្ឋាន ១:${KD(S)}`)).width, g.measureText(T(`Topographic map · UTM ${zone}N`, `ផែនទីសណ្ឋានដី · UTM ${KD(zone)}N`)).width), room = mm(W - 2 * M - 8) - 2 * sideW;
  let tsz = 5.2; font(tsz, 700); while (tsz > 2.8 && g.measureText(ttl).width > room) { tsz -= 0.2; font(tsz, 700); }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1f3f8f'; g.fillText(ttl, mm(W / 2), mm(M + 5));
  font(2.3); g.fillStyle = '#333'; g.textAlign = 'left'; g.fillText(T(`Scale 1:${S.toLocaleString('en')}`, `មាត្រដ្ឋាន ១:${KD(S)}`), mm(M), mm(M + 5));
  g.textAlign = 'right'; g.fillText(T(`Topographic map · UTM ${zone}N`, `ផែនទីសណ្ឋានដី · UTM ${KD(zone)}N`), mm(W - M), mm(M + 5));
  // ===== legend in columns under the map (sheet style: description ..... symbol, ក)/ខ) pairs), then scale, declination, location, credits =====
  const LG = o.legend || 'sheet', LX = M, LY = fy + FH + 9, LW = W - 2 * M, LB = H - M, RW = Math.max(62, LW * (land ? 0.27 : 0.33)), CA = LW - RW - 6;
  const NC = land ? 3 : 2, CW = CA / NC; let col = 0, cy = LY + 6;
  font(2.6, 700); g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lang === 'km' ? 'សញ្ញាផែនទី' : lang === 'both' ? 'សញ្ញាផែនទី · LEGEND' : 'LEGEND', mm(LX), mm(LY + 1.5));
  g.strokeStyle = '#111'; g.lineWidth = mm(0.3); g.beginPath(); g.moveTo(mm(LX), mm(LY + 3.6)); g.lineTo(mm(LX + LW), mm(LY + 3.6)); g.stroke();
  const AB = lang === 'en' ? ['a)', 'b)'] : ['ក)', 'ខ)'];
  const L1 = (en, kmT) => lang === 'en' ? en : kmT, L2 = (en) => lang === 'both' ? en : '';
  const next = h => { if (cy + h > LB - 1) { col++; cy = LY + 6; } return LX + col * CW; };
  const sec = (en, kmT) => { const x0 = next(9); font(2, 700); g.fillStyle = '#1f3f8f'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lang === 'both' ? `${kmT} · ${en}` : L1(en, kmT), mm(x0), mm(cy + 1.6)); cy += 4.6; };
  const SYW = 11, SYH = 3;
  // one line: label ..... symbol (symbol box at the right of the column)
  const row = (draw, en, kmT, h0) => { const sub = L2(en), hgt = h0 || (sub ? 5.4 : 4); const x0 = next(hgt), sx = x0 + CW - SYW - 3;
    font(1.85); g.fillStyle = '#222'; g.textAlign = 'left'; g.textBaseline = 'middle'; const t1 = L1(en, kmT), ty = cy + (sub ? 1 : 1.6); g.fillText(t1, mm(x0 + 1.5), mm(ty)); const tw = g.measureText(t1).width;
    g.fillStyle = '#888'; for (let x = mm(x0 + 1.5) + tw + mm(1); x < mm(sx - 1); x += mm(0.85)) g.fillRect(x, mm(ty) + mm(0.45), mm(0.17), mm(0.17));
    if (sub) { font(1.45); g.fillStyle = '#666'; g.fillText(sub, mm(x0 + 1.5), mm(cy + 3.4)); }
    g.save(); draw(mm(sx), mm(ty - SYH / 2), mm(SYW), mm(SYH)); g.restore(); cy += hgt; };
  // pair: ក) A  ខ) B ..... ក.[A] ខ.[B]
  const pair = (dA, dB, enA, kmA, enB, kmB) => { const sub = lang === 'both' ? `${AB[0] === 'ក)' ? 'a)' : 'a)'} ${enA}  b) ${enB}` : '', hgt = sub ? 5.4 : 4, x0 = next(hgt), sw = SYW * 0.62, sx2 = x0 + CW - sw - 3, sx1 = sx2 - sw - 4.5;
    font(1.85); g.fillStyle = '#222'; g.textAlign = 'left'; g.textBaseline = 'middle'; const t1 = `${AB[0]} ${L1(enA, kmA)}   ${AB[1]} ${L1(enB, kmB)}`, ty = cy + (sub ? 1 : 1.6); g.fillText(t1, mm(x0 + 1.5), mm(ty)); const tw = g.measureText(t1).width;
    g.fillStyle = '#888'; for (let x = mm(x0 + 1.5) + tw + mm(1); x < mm(sx1 - 3.2); x += mm(0.85)) g.fillRect(x, mm(ty) + mm(0.45), mm(0.17), mm(0.17));
    font(1.5); g.fillStyle = '#333'; g.fillText(AB[0].replace(')', '.'), mm(sx1 - 2.6), mm(ty)); g.fillText(AB[1].replace(')', '.'), mm(sx2 - 2.6), mm(ty));
    if (sub) { font(1.45); g.fillStyle = '#666'; g.fillText(sub, mm(x0 + 1.5), mm(cy + 3.4)); }
    g.save(); dA(mm(sx1), mm(ty - SYH / 2), mm(sw), mm(SYH)); g.restore(); g.save(); dB(mm(sx2), mm(ty - SYH / 2), mm(sw), mm(SYH)); g.restore(); cy += hgt; };
  const gap = () => { cy += 1.4; };
  // symbol painters
  const roadSym = (st, shield) => (x, y, w, h) => { const ym = y + h / 2; g.setLineDash([]); g.lineCap = 'butt'; if (st.o) { g.strokeStyle = st.o; g.lineWidth = mm(st.w + 0.3); g.beginPath(); g.moveTo(x, ym); g.lineTo(x + w, ym); g.stroke(); }
    g.setLineDash(st.d ? st.d.map(mm) : []); g.strokeStyle = st.f; g.lineWidth = mm(st.w); g.beginPath(); g.moveTo(x, ym); g.lineTo(x + w, ym); g.stroke(); g.setLineDash([]);
    if (shield) { const r = mm(1.45); g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = mm(0.15); g.beginPath(); g.arc(x + w / 2, ym, r, 0, 7); g.fill(); g.stroke(); font(shield.length > 1 ? 1.35 : 1.6, 700); g.fillStyle = '#111'; g.textAlign = 'center'; g.fillText(N(shield), x + w / 2, ym + mm(0.05)); } };
  const swatch = (c, kind) => (x, y, w, h) => { g.fillStyle = LC[c].topo; g.fillRect(x, y, w, h); if (kind) { g.fillStyle = g.createPattern(patCache[kind] || (patCache[kind] = pat(kind)), 'repeat'); g.fillRect(x, y, w, h); } g.strokeStyle = '#555'; g.lineWidth = mm(0.1); g.strokeRect(x, y, w, h); };
  const has = c => D.lcPct && D.lcPct[c] > 0.002;
  // --- roads and transport
  sec('Roads and transport', 'បណ្ដាញផ្លូវ');
  const usedR = new Map(); for (const r of D.roads || []) { const st = RS(r.cls); usedR.set(st.k, st); }
  const RLAB = { 'Motorway / trunk': ['National road (1 digit)', 'ផ្លូវជាតិ (១ខ្ទង់)', '5'], 'Primary road': ['National road (2 digits)', 'ផ្លូវជាតិ (២ខ្ទង់)', '53'], 'Secondary road': ['Provincial road', 'ផ្លូវខេត្ត'], 'Tertiary road': ['District road', 'ផ្លូវស្រុក'], 'Local road / street': ['Local road / street', 'ផ្លូវភូមិ / ផ្លូវតូច'], 'Track (laterite / dirt)': ['Track (laterite / dirt)', 'ផ្លូវលំ ផ្លូវក្រាលក្រួសក្រហម'], 'Path / footpath': ['Footpath', 'ផ្លូវដើរ'] };
  for (const st of [...usedR.values()].sort((a, b) => b.w - a.w)) { const l = RLAB[st.k] || [st.k, st.km]; row(roadSym(st, l[2]), l[0], l[1]); } // major roads first
  if ((D.rails || []).length) row((x, y, w, h) => { const ym = y + h / 2; g.strokeStyle = '#222'; g.lineWidth = mm(0.3); g.beginPath(); g.moveTo(x, ym); g.lineTo(x + w, ym); g.stroke(); for (let t = x; t <= x + w; t += mm(1.2)) { g.beginPath(); g.moveTo(t, ym - mm(0.6)); g.lineTo(t, ym + mm(0.6)); g.stroke(); } }, 'Railway', 'ផ្លូវដែក');
  if ((D.roads || []).some(r => r.flags & 2)) row((x, y, w, h) => { const ym = y + h / 2; g.strokeStyle = '#111'; g.lineWidth = mm(0.18); for (const d of [-0.9, 0.9]) { g.beginPath(); g.moveTo(x + w * 0.15, ym + mm(d) + (d < 0 ? -mm(0.5) : mm(0.5))); g.lineTo(x + w * 0.25, ym + mm(d)); g.lineTo(x + w * 0.75, ym + mm(d)); g.lineTo(x + w * 0.85, ym + mm(d) + (d < 0 ? -mm(0.5) : mm(0.5))); g.stroke(); } }, 'Bridge', 'ស្ពាន');
  gap();
  // --- settlements and landmarks
  sec('Settlements and landmarks', 'ទីលំនៅ និងទីសម្គាល់');
  pair((x, y, w, h) => { g.fillStyle = '#3a3a3a'; for (const [a, b] of [[0.1, 0.2], [0.35, 0.5], [0.6, 0.15], [0.8, 0.55], [0.2, 0.65]]) g.fillRect(x + w * a, y + h * b, mm(0.7), mm(0.6)); },
    (x, y, w, h) => { g.fillStyle = '#5a5a5a'; g.fillRect(x + w * 0.2, y + h * 0.2, w * 0.25, h * 0.55); g.fillRect(x + w * 0.55, y + h * 0.3, w * 0.25, h * 0.45); }, 'Village', 'ភូមិ', 'Houses (from the image)', 'ផ្ទះ (ពីរូបភាព)');
  if ((D.buildings || []).length) row((x, y, w, h) => { g.fillStyle = '#9a9a9a'; g.strokeStyle = '#333'; g.lineWidth = mm(0.15); g.fillRect(x + w * 0.3, y + h * 0.1, w * 0.4, h * 0.8); g.strokeRect(x + w * 0.3, y + h * 0.1, w * 0.4, h * 0.8); }, 'Large building (OpenStreetMap)', 'អគារធំ (OpenStreetMap)');
  if (o.names) {
    pair((x, y, w, h) => { const px = x + w / 2, py = y + h / 2; g.fillStyle = '#111'; g.fillRect(px - mm(0.12), py - mm(1.4), mm(0.24), mm(1.9)); g.fillStyle = '#2f5fbf'; g.fillRect(px, py - mm(1.4), mm(1.1), mm(0.7)); },
      (x, y, w, h) => { const px = x + w / 2, py = y + h / 2; g.fillStyle = '#b0302a'; g.beginPath(); g.moveTo(px, py - mm(1.4)); g.lineTo(px + mm(1.1), py + mm(0.8)); g.lineTo(px - mm(1.1), py + mm(0.8)); g.closePath(); g.fill(); }, 'School', 'សាលារៀន', 'Pagoda / temple', 'វត្ត');
    pair((x, y, w, h) => { const px = x + w / 2, py = y + h / 2; g.fillStyle = '#d02020'; g.fillRect(px - mm(0.9), py - mm(0.3), mm(1.8), mm(0.6)); g.fillRect(px - mm(0.3), py - mm(0.9), mm(0.6), mm(1.8)); },
      (x, y, w, h) => { const px = x + w / 2, py = y + h / 2; g.strokeStyle = '#111'; g.lineWidth = mm(0.25); g.beginPath(); g.arc(px, py, mm(0.8), 0, 7); g.stroke(); g.fillStyle = '#111'; g.beginPath(); g.arc(px, py, mm(0.3), 0, 7); g.fill(); }, 'Health centre', 'មណ្ឌលសុខភាព', 'Office / police', 'ការិយាល័យ / ប៉ុស្ដិ៍');
  }
  row((x, y, w, h) => { g.fillStyle = '#222'; g.beginPath(); g.arc(x + w * 0.25, y + h / 2, mm(0.4), 0, 7); g.fill(); font(1.7, 600); g.textAlign = 'left'; g.fillText(N(124), x + w * 0.35, y + h / 2); }, 'Spot height (m)', 'កម្ពស់គិតជាម៉ែត្រ');
  row((x, y, w, h) => { g.strokeStyle = '#a8662e'; for (const [f, lw] of [[0.15, 0.14], [0.5, 0.32], [0.85, 0.14]]) { g.lineWidth = mm(lw); g.beginPath(); g.moveTo(x, y + h * f + mm(0.4)); g.bezierCurveTo(x + w * 0.4, y + h * f - mm(0.8), x + w * 0.6, y + h * f + mm(0.8), x + w, y + h * f - mm(0.2)); g.stroke(); } font(1.2); g.fillStyle = '#8a4a1e'; g.textAlign = 'right'; g.fillText(N(CI * IDX), x + w, y + h * 0.5 - mm(0.6)); }, `Contours, interval ${CI} m (index ${CI * IDX} m)`, `ខ្សែកម្ពស់ ចន្លោះ ${KD(CI)} ម (ខ្សែមេ ${KD(CI * IDX)} ម)`, lang === 'both' ? 5.4 : 4.4);
  gap();
  // --- water
  sec('Water', 'ធនធានទឹក');
  pair((x, y, w, h) => { g.fillStyle = '#a9cdea'; g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.15); g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 7); g.fill(); g.stroke(); },
    (x, y, w, h) => { g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.4); g.beginPath(); g.moveTo(x, y + h * 0.7); g.bezierCurveTo(x + w * 0.3, y, x + w * 0.6, y + h, x + w, y + h * 0.3); g.stroke(); }, 'Lake / pond', 'បឹង / ស្រះ', 'River / stream', 'ទន្លេ / អូរ');
  if ((D.waterways || []).some(w => w.t >= 3)) row((x, y, w, h) => { g.strokeStyle = '#3f7fbf'; g.lineWidth = mm(0.25); g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); }, 'Canal / ditch', 'ប្រឡាយ');
  gap();
  // --- vegetation and land cover (ក/ខ pairs as on the national sheets)
  sec('Vegetation and land cover', 'រុក្ខជាតិ និងគម្របដី');
  const PAIRS = [[3, 4], [7, 8], [5, 9], [6, 2], [11, 10]], shown = new Set();
  for (const [a, b] of PAIRS) { const ha = has(a), hb = has(b); if (ha && hb) { pair(swatch(a, LC_SYM[a]), swatch(b, LC_SYM[b]), LC[a].en, LC[a].km, LC[b].en, LC[b].km); shown.add(a); shown.add(b); } }
  for (let c = 1; c <= 12; c++) if (has(c) && !shown.has(c) && c !== 1) row(swatch(c, LC_SYM[c]), LC[c].en, LC[c].km);

  // ----- right block: scale, contour interval, declination diagram, location map, credits
  const bx = LX + LW - RW, bw = RW; let by = LY + 6;
  g.strokeStyle = '#999'; g.lineWidth = mm(0.15); g.beginPath(); g.moveTo(mm(bx - 3), mm(LY + 5)); g.lineTo(mm(bx - 3), mm(LB)); g.stroke();
  font(2.5, 700); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(T(`Scale 1:${S.toLocaleString('en')}`, `មាត្រដ្ឋាន ១:${KD(S)}`), mm(bx + bw / 2), mm(by + 1.5)); by += 4.5;
  { const unit = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reverse().find(u => u * 1000 / S * 4 <= bw - 10) || 10, seg = unit * 1000 / S, x0 = bx + (bw - seg * 4) / 2;
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff' : '#111'; g.fillRect(mm(x0 + i * seg), mm(by), mm(seg), mm(1.1)); } g.strokeStyle = '#111'; g.lineWidth = mm(0.15); g.strokeRect(mm(x0), mm(by), mm(seg * 4), mm(1.1));
    font(1.5); g.fillStyle = '#111'; for (let i = 0; i <= 4; i++) { const v = unit * i; g.fillText(N(v >= 1000 ? v / 1000 : v) + (i === 4 ? (unit * 4 >= 1000 ? (lang === 'km' ? ' គ.ម' : ' km') : (lang === 'km' ? ' ម' : ' m')) : ''), mm(x0 + i * seg), mm(by + 2.8)); }
    by += 5.6; font(1.6); g.fillText(T(`Contour interval ${CI} m`, `ចន្លោះខ្សែកម្ពស់ ${KD(CI)} ម`), mm(bx + bw / 2), mm(by)); by += 3.5; }
  // declination diagram: grid north (vertical), true north (★) and magnetic north (half arrow), angles at the sheet centre (WMM-2025)
  const by0 = by, DH = Math.min(36, (LB - by) * 0.55), dW = bw * 0.5;
  { const lat0 = (aoi.s + aoi.n) / 2, lon0 = (aoi.w + aoi.e) / 2, cm = (zone - 1) * 6 - 180 + 3, gam = Math.atan(Math.tan((lon0 - cm) * Math.PI / 180) * Math.sin(lat0 * Math.PI / 180)) * 180 / Math.PI;
    let dec = null, ann = 0; try { const MD = await import('./magdec.js?v=91'), r = MD.declination(lat0, lon0, new Date()); dec = r.decl; ann = r.annual; } catch (e) { }
    const tA = -gam, mA = dec == null ? null : -gam + dec; // angles clockwise from grid north (deg)
    // drawn angles are exaggerated (min 6°) so the lines can be told apart; the numbers are the true values
    const ex = v => Math.sign(v || 1) * Math.max(10, Math.abs(v)), dT = ex(tA); let dM = mA == null ? null : ex(mA); if (dM != null && Math.sign(dM) === Math.sign(dT) && Math.abs(dM - dT) < 8) dM = dT + Math.sign((mA - tA) || 1) * 8; // keep both on their true side of grid north, clearly apart
    const ox = bx + dW / 2, oy = by + DH - 6, Lr = DH - 12, P = (a, f = 1) => [ox + Math.sin(a * Math.PI / 180) * Lr * f, oy - Math.cos(a * Math.PI / 180) * Lr * f];
    const dm = v => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${N(d)}°${N(m.toFixed(m < 10 ? 1 : 0))}'`; };
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = mm(0.2);
    g.beginPath(); g.moveTo(mm(ox), mm(oy)); g.lineTo(mm(ox), mm(oy - Lr - 3)); g.stroke(); font(1.5, 600); g.textAlign = 'center'; g.fillText(T('Grid north', 'ខ្សែក្រឡាចត្រង្គ'), mm(ox), mm(oy - Lr - 4.6));
    const [tx, ty] = P(dT, 0.86); g.beginPath(); g.moveTo(mm(ox), mm(oy)); g.lineTo(mm(tx), mm(ty)); g.stroke();
    { const sx = mm(tx), sy = mm(ty) - mm(0.8), R1 = mm(1.1), R2 = mm(0.45); g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? R2 : R1; k ? g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r) : g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); } g.closePath(); g.fill(); }
    font(1.45, 600); g.textAlign = dT < 0 ? 'right' : 'left'; g.fillText(T('True north', 'ខាងជើងពិត'), mm(tx + (dT < 0 ? -1.8 : 1.8)), mm(ty - 0.6));
    const arc = (a0, a1, r, txt) => { const s0 = (-90 + Math.min(a0, a1)) * Math.PI / 180, s1 = (-90 + Math.max(a0, a1)) * Math.PI / 180; g.beginPath(); g.arc(mm(ox), mm(oy), mm(r), s0, s1); g.stroke(); const am = (a0 + a1) / 2, [qx, qy] = [ox + Math.sin(am * Math.PI / 180) * r, oy - Math.cos(am * Math.PI / 180) * r];
      const side = am < 0 ? -1 : 1; g.beginPath(); g.moveTo(mm(qx), mm(qy)); g.lineTo(mm(qx + side * 4), mm(qy)); g.stroke(); font(1.45); g.textAlign = side < 0 ? 'right' : 'left'; g.fillText(txt, mm(qx + side * 4.4), mm(qy)); };
    g.lineWidth = mm(0.12); arc(0, dT, Lr * 0.36, dm(tA));
    if (mA != null) { const [mx, my] = P(dM, 0.7); g.lineWidth = mm(0.2); g.beginPath(); g.moveTo(mm(ox), mm(oy)); g.lineTo(mm(mx), mm(my)); g.stroke(); const ang = dM * Math.PI / 180, ux = Math.sin(ang), uy = -Math.cos(ang);
      g.beginPath(); g.moveTo(mm(mx), mm(my)); g.lineTo(mm(mx - ux * 3 - uy * 0.9), mm(my - uy * 3 + ux * 0.9)); g.lineTo(mm(mx - ux * 2.2), mm(my - uy * 2.2)); g.closePath(); g.fill();
      font(1.45, 600); g.textAlign = dM < 0 ? 'right' : 'left'; g.fillText(T('Magnetic north', 'ទិសម៉ាញេទិច'), mm(mx + (dM < 0 ? -1.4 : 1.4)), mm(my + 0.6)); g.lineWidth = mm(0.12); arc(0, dM, Lr * 0.55, dm(mA)); }
    const KM_MON = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'], dt = new Date(), mon = dt.toLocaleString('en', { month: 'long' });
    font(1.35); g.fillStyle = '#222'; g.textAlign = 'center'; let ly2 = oy + 2.4;
    const cap = mA == null ? [T('At the centre of the sheet', 'នៅចំកណ្ដាលសន្លឹក')] : [T('At the centre of the sheet', 'នៅចំកណ្ដាលសន្លឹក'), T(`Magnetic declination ${dm(dec)} ${dec < 0 ? 'W' : 'E'}, ${mon} ${dt.getFullYear()}`, `កម្រិតផ្លៀងម៉ាញេទិច ${dm(dec)} ${dec < 0 ? 'ខាងលិច' : 'ខាងកើត'} ខែ${KM_MON[dt.getMonth()]} ឆ្នាំ${KD(dt.getFullYear())}`),
      T(`Annual change ${N((Math.abs(ann) * 60).toFixed(1))}' ${ann < 0 ? 'west' : 'east'} · model WMM 2025`, `ការប្រែប្រួលប្រចាំឆ្នាំ ${KD((Math.abs(ann) * 60).toFixed(1))}' ${ann < 0 ? 'ទៅខាងលិច' : 'ទៅខាងកើត'} · ម៉ូដែល WMM ២០២៥`), T('Angles not to scale', 'មុំមិនតាមមាត្រដ្ឋាន')];
    for (const c of cap) { const words = c.split(' '); let cur = ''; for (const w_ of words) { const tst = cur ? cur + ' ' + w_ : w_; if (g.measureText(tst).width > mm(dW + 4) && cur) { g.fillText(cur, mm(ox), mm(ly2)); ly2 += 1.9; cur = w_; } else cur = tst; } if (cur) { g.fillText(cur, mm(ox), mm(ly2)); ly2 += 1.9; } }
    by = Math.max(ly2, by + DH) + 1; }
  // location map
  { const zx = 6, tiles = [[50, 29], [51, 29], [50, 30], [51, 30]], lmW = Math.min(34, bw * 0.44), lmH = lmW * 0.88, lmx = bx + bw - lmW, lmy = by0 + 3;
    try { const T0 = await Promise.all(tiles.map(([x, y]) => loadImg(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${zx}/${y}/${x}`)));
      const lon2x = lon => (lon + 180) / 360 * 64 * 256, lat2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 64 * 256;
      const vx0 = lon2x(102.2), vx1 = lon2x(107.7), vy0 = lat2y(14.75), vy1 = lat2y(10.3), sc = Math.min(mm(lmW) / (vx1 - vx0), mm(lmH) / (vy1 - vy0));
      g.save(); g.beginPath(); g.rect(mm(lmx), mm(lmy), mm(lmW), mm(lmH)); g.clip();
      tiles.forEach(([x, y], i) => g.drawImage(T0[i], mm(lmx) + (x * 256 - vx0) * sc, mm(lmy) + (y * 256 - vy0) * sc, 256 * sc, 256 * sc));
      g.strokeStyle = '#e01010'; g.lineWidth = mm(0.5); const ax = mm(lmx) + (lon2x((aoi.w + aoi.e) / 2) - vx0) * sc, ay = mm(lmy) + (lat2y((aoi.s + aoi.n) / 2) - vy0) * sc; g.strokeRect(ax - mm(1.2), ay - mm(1.2), mm(2.4), mm(2.4)); g.restore();
      g.strokeStyle = '#111'; g.lineWidth = mm(0.15); g.strokeRect(mm(lmx), mm(lmy), mm(lmW), mm(lmH)); font(1.5); g.fillStyle = '#333'; g.textAlign = 'center'; g.fillText(T('Location', 'ទីតាំង'), mm(lmx + lmW / 2), mm(lmy + lmH + 2)); } catch (e) { }
  }
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
    font(1.32); g.fillStyle = '#333'; g.textAlign = 'left'; g.textBaseline = 'top';
    const tx = bx, maxW = mm(bw); let ty = Math.max(by, LB - lines.length * 2.3 * 1.5);
    for (const ln of lines) { const words = ln.split(' '); let cur = ''; for (const w_ of words) { const tst = cur ? cur + ' ' + w_ : w_; if (g.measureText(tst).width > maxW && cur) { g.fillText(cur, mm(tx), mm(ty)); ty += 2; cur = w_; } else cur = tst; } if (cur) { g.fillText(cur, mm(tx), mm(ty)); ty += 2.3; } } }
  say('');
  return { canvas: cv, scale: S, ci: CI, wmm: W, hmm: H };
}

export async function toPDF(res, name, extra) {
  if (!window.jspdf) await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: res.wmm > res.hmm ? 'l' : 'p', unit: 'mm', format: [Math.min(res.wmm, res.hmm), Math.max(res.wmm, res.hmm)] });
  doc.addImage(res.canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, res.wmm, res.hmm);
  // optional: the GEOINT area brief as A4 portrait pages after the map
  for (const p of extra || []) { doc.addPage([210, 297], 'p'); doc.addImage(p.url, 'JPEG', 10, 10, 190, p.hmm); }
  doc.save(name);
}
