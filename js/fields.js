// AgriMapper in the browser: field boundaries from the satellite image with the Agri ONNX model
// (cambodia_field_boundary.onnx, U-Net, 3 sigmoid channels extent / boundary / distance), the same
// post-processing as the QGIS plugin (marker watershed on the boundary map, merge of weak edges, small-hole
// filling, rectangularity / width / area filters, 2 m bund gap) plus a road / water / building cut from the
// scene's OpenStreetMap masks, which removes the road confusion of the model.
import * as THREE from 'three';
import * as G from './geo.js?v=86';
import { bundGeometry } from './ricefield.js?v=86';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
let ort = null, provider_ = ''; const sessions = {};
export const provider = () => provider_;
export const DEFAULTS = { extent_thr: 0.5, boundary_thr: 0.15, min_core_px: 250, merge_thr: 0.25, fill_holes_px: 1500, min_area_m2: 300, max_area_m2: 1e6, min_width_m: 2.5, min_rect: 0.45, regularise_m: 3, gap_m: 2, osm_cut: true, tta: false, trees: false };

async function getSession(say, model = 'cambodia_field_boundary') {
  if (sessions[model]) return sessions[model]; let session = null;
  ort = ort || await import(ORT + 'ort.all.min.mjs'); ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const buf = await (await fetch(`models/${model}.onnx`)).arrayBuffer();
  for (const ep of (navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'])) { try { session = await ort.InferenceSession.create(buf, { executionProviders: [ep], graphOptimizationLevel: 'all' }); provider_ = ep; break; } catch (e) { console.warn('ort', ep, e); } }
  if (!session) throw new Error('ONNX Runtime could not start'); say && say(`ONNX Runtime · ${provider_}`); return sessions[model] = session;
}

/* ---------------- imagery at zoom 18 (~0.6 m, the model's training resolution) ---------------- */
const loadImg = u => new Promise((ok, bad) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => bad(new Error(u)); im.src = u; });
export async function imagery(world, aoi, url, say) {
  const D = world.D, z = 18;
  const tx0 = G.lon2tx(aoi.w, z), tx1 = G.lon2tx(aoi.e, z), ty0 = G.lat2ty(aoi.n, z), ty1 = G.lat2ty(aoi.s, z), W = Math.round((tx1 - tx0) * 256), H = Math.round((ty1 - ty0) * 256);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
  if (D.zi === z) g.drawImage(D.img, (tx0 - D.ir.x0) * 256, (ty0 - D.ir.y0) * 256, W, H, 0, 0, W, H); // the scene image is already zoom 18
  else { const jobs = []; for (let x = Math.floor(tx0); x <= Math.floor(tx1); x++) for (let y = Math.floor(ty0); y <= Math.floor(ty1); y++) jobs.push([x, y]); let n = 0;
    await Promise.all(jobs.map(async ([x, y]) => { try { g.drawImage(await loadImg(url(z, x, y)), Math.round((x - tx0) * 256), Math.round((y - ty0) * 256)); } catch (e) { } say && say(`Imagery ${++n}/${jobs.length}`); })); }
  // pixel <-> lon/lat (Web Mercator)
  const lon = px => G.tx2lon(tx0 + px / 256, z), lat = py => G.ty2lat(ty0 + py / 256, z), mpp = 156543.03392 * Math.cos((aoi.s + aoi.n) / 2 * Math.PI / 180) / 2 ** z;
  return { canvas: c, W, H, lon, lat, mpp, px: l => (G.lon2tx(l, z) - tx0) * 256, py: l => (G.lat2ty(l, z) - ty0) * 256 };
}

/* ---------------- inference: 256 px tiles, 64 px overlap, Hann blending (as predict_probs) ---------------- */
export async function predict(im, o, say, model) {
  const s = await getSession(say, model), { W, H } = im, T = 256, OV = 64, ST = T - OV, data = im.canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const Wp = W <= T ? T : T + Math.ceil((W - T) / ST) * ST, Hp = H <= T ? T : T + Math.ceil((H - T) / ST) * ST;
  const rgb = (x, y, c) => { x = x < W ? x : Math.max(0, 2 * W - 2 - x); y = y < H ? y : Math.max(0, 2 * H - 2 - y); return data[(y * W + x) * 4 + c] / 255; }; // reflect padding
  const w1 = Array.from({ length: T }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (T + 1))), win = new Float32Array(T * T); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) win[y * T + x] = Math.max(1e-3, w1[y] * w1[x]);
  const acc = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)], ws = new Float32Array(W * H), coords = [];
  for (let y = 0; y + T <= Hp; y += ST) for (let x = 0; x + T <= Wp; x += ST) coords.push([x, y]);
  const B = provider_ === 'webgpu' ? 8 : 4, name = s.inputNames[0], augs = o.tta ? 4 : 1; let done = 0; const t0 = performance.now();
  for (let b = 0; b < coords.length; b += B) {
    const ch = coords.slice(b, b + B);
    for (let a = 0; a < augs; a++) { // test-time augmentation: identity, flip x, flip y, flip both
      const inp = new Float32Array(ch.length * 3 * T * T);
      ch.forEach(([x0, y0], k) => { for (let c = 0; c < 3; c++) for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const sx = a & 1 ? T - 1 - x : x, sy = a & 2 ? T - 1 - y : y; inp[((k * 3 + c) * T + y) * T + x] = rgb(x0 + sx, y0 + sy, c); } });
      const out = (await s.run({ [name]: new ort.Tensor('float32', inp, [ch.length, 3, T, T]) }))[s.outputNames[0]].data;
      ch.forEach(([x0, y0], k) => { for (let y = 0; y < T; y++) { const gy = y0 + (a & 2 ? T - 1 - y : y); if (gy >= H) continue; for (let x = 0; x < T; x++) { const gx = x0 + (a & 1 ? T - 1 - x : x); if (gx >= W) continue; const wv = win[y * T + x] / augs, q = gy * W + gx;
        for (let c = 0; c < 3; c++) acc[c][q] += out[((k * 3 + c) * T + y) * T + x] * wv; ws[q] += wv; } } });
    }
    done += ch.length; say && say(`Agri model ${done}/${coords.length} tiles · ${Math.round((performance.now() - t0) / done * (coords.length - done) / 1000)} s left`); await new Promise(r => setTimeout(r, 0));
  }
  for (let c = 0; c < 3; c++) for (let q = 0; q < W * H; q++) acc[c][q] /= Math.max(ws[q], 1e-6);
  return { extent: acc[0], boundary: acc[1], dist: acc[2] };
}

/* ---------------- post-processing (as segment_fields) ---------------- */
function label4(mask, W, H) { // connected components, 4-neighbour
  const lab = new Int32Array(W * H), st = new Int32Array(W * H); let n = 0;
  for (let p = 0; p < W * H; p++) { if (!mask[p] || lab[p]) continue; n++; let sp = 0; st[sp++] = p; lab[p] = n;
    while (sp) { const q = st[--sp], x = q % W, y = (q / W) | 0; if (x > 0 && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = n; st[sp++] = q - 1; } if (x < W - 1 && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = n; st[sp++] = q + 1; }
      if (y > 0 && mask[q - W] && !lab[q - W]) { lab[q - W] = n; st[sp++] = q - W; } if (y < H - 1 && mask[q + W] && !lab[q + W]) { lab[q + W] = n; st[sp++] = q + W; } } }
  return [lab, n];
}
function fillSmallHoles(mask, W, H, maxPx) { const inv = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) inv[p] = mask[p] ? 0 : 1; const [lab, n] = label4(inv, W, H), sz = new Int32Array(n + 1), edge = new Uint8Array(n + 1);
  for (let p = 0; p < W * H; p++) { const l = lab[p]; if (!l) continue; sz[l]++; const x = p % W, y = (p / W) | 0; if (!x || !y || x === W - 1 || y === H - 1) edge[l] = 1; }
  for (let p = 0; p < W * H; p++) { const l = lab[p]; if (l && !edge[l] && sz[l] < maxPx) mask[p] = 1; } return mask; }
function open3(m, W, H) { const e = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; let v = 1; for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[p + dy * W + dx]) { v = 0; break; } e[p] = v; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) if (e[p + dy * W + dx]) { v = 1; break; } o[p] = v; } return o; }
// priority-flood watershed of the boundary surface from the markers, inside the field mask (256-level bucket queue)
function watershed(surf, markers, mask, W, H) {
  const lab = Int32Array.from(markers), Q = Array.from({ length: 256 }, () => []), lev = v => Math.min(255, Math.max(0, (v * 255) | 0));
  for (let p = 0; p < W * H; p++) if (lab[p]) { const x = p % W, y = (p / W) | 0; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !lab[q] && mask[q]) { Q[lev(surf[q])].push(p); break; } }
  for (let l = 0; l < 256; l++) { const q0 = Q[l]; while (q0.length) { const p = q0.pop(), L = lab[p], x = p % W, y = (p / W) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) { if (q < 0 || lab[q] || !mask[q]) continue; lab[q] = L; const k = Math.max(l, lev(surf[q])); Q[k].push(q); } } }
  return lab;
}
function mergeWeak(lab, bnd, W, H, thr) {
  let n = 0; for (let p = 0; p < W * H; p++) if (lab[p] > n) n = lab[p]; const S = new Map(), par = new Int32Array(n + 1).map((_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, a = lab[p]; if (!a) continue; for (const q of [x < W - 1 ? p + 1 : -1, y < H - 1 ? p + W : -1]) { if (q < 0) continue; const b = lab[q]; if (!b || b === a) continue; const k = Math.min(a, b) * (n + 1) + Math.max(a, b), v = S.get(k) || [0, 0]; v[0] += 0.5 * (bnd[p] + bnd[q]); v[1]++; S.set(k, v); } }
  for (const [k, [s, c]] of S) if (s / c < thr) { const a = find(Math.floor(k / (n + 1))), b = find(k % (n + 1)); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
  const map = new Int32Array(n + 1); let m = 0; for (let i = 1; i <= n; i++) { const r = find(i); if (!map[r]) map[r] = ++m; map[i] = map[r]; }
  for (let p = 0; p < W * H; p++) if (lab[p]) lab[p] = map[lab[p]]; return [lab, m];
}
// outer boundary of one label as a pixel-corner polygon (Moore tracing on a bbox crop), simplified
function trace(lab, W, L, bb) {
  const [x0, y0, x1, y1] = bb, w = x1 - x0 + 3, h = y1 - y0 + 3, m = new Uint8Array(w * h); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lab[y * W + x] === L) m[(y - y0 + 1) * w + (x - x0 + 1)] = 1;
  // largest 4-component only
  const [cl, cn] = label4(m, w, h); if (cn > 1) { const sz = new Int32Array(cn + 1); for (const v of cl) if (v) sz[v]++; let best = 1; for (let i = 2; i <= cn; i++) if (sz[i] > sz[best]) best = i; for (let i = 0; i < m.length; i++) m[i] = cl[i] === best ? 1 : 0; }
  // directed crack edges, clockwise around the region (y down), chained into the outer ring
  const out = new Map(), K = (x, y) => y * (w + 1) + x; let start = -1;
  const add = (ax, ay, bx, by) => { const k = K(ax, ay); if (start < 0) start = k; const l = out.get(k); if (l) l.push(K(bx, by)); else out.set(k, [K(bx, by)]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!m[y * w + x]) continue; const f = (a, b) => a >= 0 && b >= 0 && a < w && b < h && m[b * w + a];
    if (!f(x, y - 1)) add(x, y, x + 1, y); if (!f(x + 1, y)) add(x + 1, y, x + 1, y + 1); if (!f(x, y + 1)) add(x + 1, y + 1, x, y + 1); if (!f(x - 1, y)) add(x, y + 1, x, y); }
  if (start < 0) return null; const pts = []; let k = start, guard = 0;
  do { pts.push([k % (w + 1), Math.floor(k / (w + 1))]); const l = out.get(k); if (!l || !l.length) break; k = l.length > 1 ? l.pop() : l[0]; } while (k !== start && ++guard < 8 * m.length);
  return pts.map(([a, b]) => [a + x0 - 1, b + y0 - 1]);
}
function dp(pts, tol) { // Douglas–Peucker on a closed ring
  if (pts.length < 5) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } } keep[far] = 1;
  const rec = (a, b) => { let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1; for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } } if (md > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); } };
  rec(0, far); rec(far, pts.length - 1); return pts.filter((_, i) => keep[i]);
}

// topology-preserving smoothing of the label partition (as smooth_labels): each label's indicator blurred in its box
function smoothLabels(lab, W, H, m, sigma = 2) {
  if (sigma <= 0) return lab; const r = Math.ceil(3 * sigma), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma))), ks = k.reduce((a, b) => a + b, 0); k.forEach((v, i) => k[i] = v / ks);
  const bb = Array.from({ length: m + 1 }, () => [1e9, 1e9, -1, -1]); for (let p = 0; p < W * H; p++) { const L = lab[p]; if (!L) continue; const x = p % W, y = (p / W) | 0, b = bb[L]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  const best = new Float32Array(W * H).fill(-1), out = new Int32Array(W * H);
  for (let L = 1; L <= m; L++) { const b = bb[L]; if (b[2] < 0) continue; const x0 = Math.max(0, b[0] - r), y0 = Math.max(0, b[1] - r), x1 = Math.min(W - 1, b[2] + r), y1 = Math.min(H - 1, b[3] + r), w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Float32Array(w * h), t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = lab[(y + y0) * W + x + x0] === L ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < w) v += a[y * w + xx] * k[i + r]; } t[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < h) v += t[yy * w + x] * k[i + r]; } const q = (y + y0) * W + x + x0; if (v > best[q]) { best[q] = v; out[q] = L; } } }
  for (let p = 0; p < W * H; p++) if (!lab[p]) out[p] = 0; return out;
}
// polygons with SHARED, straightened edges (as regularise_partition): the crack-edge network between labels is cut
// into arcs at junctions, each arc is simplified once, and every field is rebuilt from its arcs, so neighbours get
// the identical straight edge – with the bund gap applied afterwards, neighbouring edges stay parallel
function partitionPolygons(lab, W, H, tol) {
  const L = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? 0 : lab[y * W + x], CW = W + 1, cid = (x, y) => y * CW + x;
  const hDiff = (x, y) => L(x, y - 1) !== L(x, y), vDiff = (x, y) => L(x - 1, y) !== L(x, y); // edge (x,y)->(x+1,y) / (x,y)->(x,y+1)
  const deg = (x, y) => (y > 0 && vDiff(x, y - 1) ? 1 : 0) + (y < H && vDiff(x, y) ? 1 : 0) + (x > 0 && hDiff(x - 1, y) ? 1 : 0) + (x < W && hDiff(x, y) ? 1 : 0);
  const isNode = (x, y) => { const d = deg(x, y); if (d >= 3) return true; if (d === 2) { const a = L(x - 1, y - 1), b = L(x, y - 1), c = L(x - 1, y), e = L(x, y); return a === e && b === c && a !== b; } return false; }; // pinch
  const hv = new Uint8Array(CW * (H + 1)), vv = new Uint8Array(CW * (H + 1)), arcs = [];
  // neighbours of a corner along crack edges: [nx, ny, kind, ex, ey]
  const nbr = (x, y) => { const o = []; if (x < W && hDiff(x, y)) o.push([x + 1, y, 'h', x, y]); if (x > 0 && hDiff(x - 1, y)) o.push([x - 1, y, 'h', x - 1, y]); if (y < H && vDiff(x, y)) o.push([x, y + 1, 'v', x, y]); if (y > 0 && vDiff(x, y - 1)) o.push([x, y - 1, 'v', x, y - 1]); return o; };
  const seen = (k, ex, ey) => (k === 'h' ? hv : vv)[cid(ex, ey)], mark = (k, ex, ey) => (k === 'h' ? hv : vv)[cid(ex, ey)] = 1;
  const labelsOf = (k, ex, ey) => k === 'h' ? [L(ex, ey - 1), L(ex, ey)] : [L(ex - 1, ey), L(ex, ey)];
  const walk = (x, y, first) => { const pts = [[x, y]], lbl = labelsOf(first[2], first[3], first[4]); let cur = first, guard = 0;
    for (;;) { mark(cur[2], cur[3], cur[4]); const [nx, ny] = cur; pts.push([nx, ny]); if (isNode(nx, ny) || (nx === x && ny === y) || ++guard > 4 * W * H) break;
      const nxt = nbr(nx, ny).find(e => !seen(e[2], e[3], e[4])); if (!nxt) break; cur = nxt; }
    arcs.push({ pts, a: lbl[0], b: lbl[1] }); };
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) if (isNode(x, y)) for (const e of nbr(x, y)) if (!seen(e[2], e[3], e[4])) walk(x, y, e);
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) for (const e of nbr(x, y)) if (!seen(e[2], e[3], e[4])) walk(x, y, e); // closed loops without junctions
  // simplify each arc once (end points fixed; closed loops split at the farthest point)
  const simp = pts => { if (pts.length <= 2) return pts; const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (closed) { let far = 1, fd = -1; for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } } const A = dpOpen(pts.slice(0, far + 1), tol), B = dpOpen(pts.slice(far), tol); return A.concat(B.slice(1)); }
    return dpOpen(pts, tol); };
  for (const a of arcs) a.s = simp(a.pts);
  // rings per label, chaining its arcs end to end
  const byLabel = new Map(); arcs.forEach((a, i) => { for (const l of [a.a, a.b]) if (l > 0 && a.a !== a.b) { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(i); } });
  const rings = new Map(), key = p => p[0] + ',' + p[1];
  for (const [l, ids] of byLabel) { const left = new Set(ids), out = [];
    while (left.size) { const i0 = left.values().next().value; left.delete(i0); let ring = arcs[i0].s.slice(); let guard = 0;
      while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < ids.length + 2) { const end = key(ring[ring.length - 1]); let nxt = null, rev = false;
        for (const j of left) { const s = arcs[j].s; if (key(s[0]) === end) { nxt = j; break; } if (key(s[s.length - 1]) === end) { nxt = j; rev = true; break; } }
        if (nxt == null) break; left.delete(nxt); const s = rev ? arcs[nxt].s.slice().reverse() : arcs[nxt].s; ring = ring.concat(s.slice(1)); }
      if (ring.length >= 4) out.push(ring.slice(0, -1)); }
    rings.set(l, out.sort((p, q) => ringArea(q) - ringArea(p))[0]); }
  return rings;
}
function dpOpen(pts, tol) { if (pts.length <= 2) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const rec = (a, b) => { let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], Ln = Math.hypot(bx - ax, by - ay); for (let i = a + 1; i < b; i++) { const d = Ln ? Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / Ln : Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > md) { md = d; mi = i; } } if (md > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); } };
  rec(0, pts.length - 1); return pts.filter((_, i) => keep[i]); }
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
const perim = r => r.reduce((s, p, i) => s + Math.hypot(p[0] - r[(i + 1) % r.length][0], p[1] - r[(i + 1) % r.length][1]), 0);
function hull(pts) { const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); }
function minRectArea(r) { const h = hull(r); let best = Infinity; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const q of h) { const s = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy, t = -(q[0] - a[0]) * uy + (q[1] - a[1]) * ux; a0 = Math.min(a0, s); a1 = Math.max(a1, s); b0 = Math.min(b0, t); b1 = Math.max(b1, t); } best = Math.min(best, (a1 - a0) * (b1 - b0)); } return best; }

export async function segment(im, P, o, cut, say) {
  const { W, H } = im, N = W * H, px2 = im.mpp * im.mpp;
  let field = new Uint8Array(N); for (let p = 0; p < N; p++) field[p] = P.extent[p] >= o.extent_thr ? 1 : 0;
  if (cut) for (let p = 0; p < N; p++) if (cut[p]) field[p] = 0; // roads, water and buildings from OpenStreetMap
  fillSmallHoles(field, W, H, o.fill_holes_px); if (cut) for (let p = 0; p < N; p++) if (cut[p]) field[p] = 0;
  const core = new Uint8Array(N); for (let p = 0; p < N; p++) core[p] = field[p] && P.boundary[p] < o.boundary_thr ? 1 : 0;
  let [mk, n] = label4(open3(core, W, H), W, H); const sz = new Int32Array(n + 1); for (const v of mk) if (v) sz[v]++;
  const minCore = Math.round(o.min_core_px * (0.6 * 0.6) / px2); for (let p = 0; p < N; p++) if (mk[p] && sz[mk[p]] < minCore) mk[p] = 0;
  say && say('Watershed…'); await new Promise(r => setTimeout(r, 0));
  let lab = watershed(P.boundary, mk, field, W, H); let m; [lab, m] = mergeWeak(lab, P.boundary, W, H, o.merge_thr);
  lab = smoothLabels(lab, W, H, m, 2);
  for (let p = 0; p < N; p++) if (lab[p] && !field[p]) lab[p] = 0;
  const cs = new Float64Array(m + 1), cn = new Int32Array(m + 1); for (let p = 0; p < N; p++) { const L = lab[p]; if (L) { cs[L] += P.extent[p]; cn[L]++; } }
  say && say('Polygons…'); await new Promise(r => setTimeout(r, 0));
  const rings = partitionPolygons(lab, W, H, o.regularise_m / im.mpp), out = [];
  for (const [L, r] of rings) { if (!r || r.length < 3) continue;
    const A = ringArea(r) * px2; if (A < o.min_area_m2 || A > o.max_area_m2) continue;
    const rect = A / (minRectArea(r) * px2 || 1); if (o.min_rect > 0 && rect < o.min_rect) continue;
    const width = 2 * A / (perim(r) * im.mpp); if (o.min_width_m > 0 && width < o.min_width_m) continue; // ≈ mean width (2·area / perimeter)
    out.push({ ring: r.map(([x, y]) => [im.lon(x), im.lat(y)]), area_m2: A, conf: cs[L] / Math.max(1, cn[L]), rect, label: L }); }
  return { fields: out, lab, m };
}
// a 2 m bund gap: shrink every field by half the gap (turf negative buffer)
export async function bundGap(fields, gap, turf) {
  if (!(gap > 0)) return fields; const T = await turf(), o = [];
  for (const f of fields) { try { const b = T.buffer(T.polygon([[...f.ring, f.ring[0]]]), -gap / 2000, { units: 'kilometers', steps: 2 }); if (!b) continue; let g = b.geometry; if (g.type === 'MultiPolygon') g = { type: 'Polygon', coordinates: g.coordinates.sort((a, c) => T.area(T.polygon(c)) - T.area(T.polygon(a)))[0] };
    o.push({ ...f, ring: g.coordinates[0].slice(0, -1), area_m2: T.area(T.polygon(g.coordinates)) }); } catch (e) { o.push(f); } }
  return o;
}
// OSM roads, water and buildings of the scene (its 1.5 m masks) on the image grid
export function osmCut(world, im) {
  const D = world.D, F = world.F, { mw, mh, MR, X0, Z0 } = D, masks = [D.rmask, D.wmask, D.bmaskOSM].filter(Boolean), m = new Uint8Array(im.W * im.H);
  if (!masks.length) return null;
  for (let y = 0; y < im.H; y++) { const z = F.z(im.lat(y + 0.5)), j = Math.floor((z - Z0) / MR); if (j < 0 || j >= mh) continue;
    for (let x = 0; x < im.W; x++) { const i = Math.floor((F.x(im.lon(x + 0.5)) - X0) / MR); if (i < 0 || i >= mw) continue; const q = j * mw + i; for (const k of masks) if (k[q]) { m[y * im.W + x] = 1; break; } } }
  return m;
}

// share of tree canopy inside each field, from the scene's own image classification (2.5 m grid, class 2 = canopy)
export function dropCanopy(world, fields, maxShare = 0.5) {
  const D = world.D, F = world.F, { gw, gh, C, X0, Z0, cls } = D; if (!cls) return fields;
  return fields.filter(f => { const R = f.ring.map(([lo, la]) => [F.x(lo), F.z(la)]); let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of R) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let n = 0, t = 0; for (let j = Math.max(0, Math.floor((z0 - Z0) / C)); j <= Math.min(gh - 1, Math.floor((z1 - Z0) / C)); j++) for (let i = Math.max(0, Math.floor((x0 - X0) / C)); i <= Math.min(gw - 1, Math.floor((x1 - X0) / C)); i++) {
      const x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C; let c = false; for (let a = 0, b = R.length - 1; a < R.length; b = a++) if ((R[a][1] > z) !== (R[b][1] > z) && x < (R[b][0] - R[a][0]) * (z - R[a][1]) / (R[b][1] - R[a][1]) + R[a][0]) c = !c;
      if (!c) continue; n++; if (cls[j * gw + i] === 2) t++; }
    f.canopy = n ? t / n : 0; return f.canopy <= maxShare; });
}

// drop fields that are mostly tree canopy according to the Agri trees model (sampled every 3 px inside each field)
export function dropByTrees(fields, im, tree, maxShare = 0.5) {
  return fields.filter(f => { const R = f.ring.map(([lo, la]) => [im.px(lo), im.py(la)]); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of R) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    let n = 0, t = 0; for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(im.H - 1, y1); y += 3) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(im.W - 1, x1); x += 3) {
      let c = false; for (let a = 0, b = R.length - 1; a < R.length; b = a++) if ((R[a][1] > y) !== (R[b][1] > y) && x < (R[b][0] - R[a][0]) * (y - R[a][1]) / (R[b][1] - R[a][1]) + R[a][0]) c = !c;
      if (!c) continue; n++; if (tree[y * im.W + x] > 0.5) t++; }
    f.canopy = n ? t / n : 0; return f.canopy <= maxShare; });
}

// drop forest / orchard patches by colour: dark and green (mean excess green > 10 and brightness < 85).
// Dry-season paddy is brown and brighter; green rice in the wet season is much brighter than tree canopy.
export function dropDarkGreen(fields, im, exg = 10, bright = 85) {
  const d = im.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, im.W, im.H).data;
  return fields.filter(f => { const R = f.ring.map(([lo, la]) => [im.px(lo), im.py(la)]); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of R) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    let n = 0, eg = 0, br = 0; for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(im.H - 1, y1); y += 2) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(im.W - 1, x1); x += 2) {
      let c = false; for (let a = 0, b = R.length - 1; a < R.length; b = a++) if ((R[a][1] > y) !== (R[b][1] > y) && x < (R[b][0] - R[a][0]) * (y - R[a][1]) / (R[b][1] - R[a][1]) + R[a][0]) c = !c;
      if (!c) continue; const q = (y * im.W + x) * 4; n++; eg += d[q + 1] - (d[q] + d[q + 2]) / 2; br += (d[q] + d[q + 1] + d[q + 2]) / 3; }
    f.exg = n ? eg / n : 0; f.bright = n ? br / n : 0; return !(f.exg > exg && f.bright < bright); });
}

/* ---------------- 3D: raised bunds along every field edge ---------------- */
export function show3D(world, fields) { // earth bunds between the fields (low ridges, grass on top)
  hide3D(world); const m = bundGeometry(world, fields); if (!m) return; world.scene.add(m); world.fieldMesh = m; if (world.farmUpdate) world.farmUpdate(fields);
}
export function hide3D(world) { if (world.fieldMesh) { world.scene.remove(world.fieldMesh); world.fieldMesh.geometry.dispose(); world.fieldMesh.material.dispose(); world.fieldMesh = null; } }
// fill every field with the most common colour of an overlay image (lon/lat-linear over the AOI): a per-field map
export function byField(fields, img, aoi, minShare = 0.3) {
  const W = img.width, H = img.height, src = document.createElement('canvas'); src.width = W; src.height = H; const sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0); const sd = sg.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d'), X = lo => (lo - aoi.w) / (aoi.e - aoi.w) * W, Y = la => (aoi.n - la) / (aoi.n - aoi.s) * H;
  const mk = document.createElement('canvas'); mk.width = W; mk.height = H; const mg = mk.getContext('2d', { willReadFrequently: true }); const stats = [];
  for (const f of fields) { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const pts = f.ring.map(([lo, la]) => { const x = X(lo), y = Y(la); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); return [x, y]; });
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1)); if (x1 < x0 || y1 < y0) { stats.push(null); continue; }
    mg.clearRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); mg.fillStyle = '#fff'; mg.beginPath(); pts.forEach(([x, y], i) => i ? mg.lineTo(x, y) : mg.moveTo(x, y)); mg.fill();
    const md = mg.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data, cnt = new Map(); let tot = 0, hit = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = ((y - y0) * (x1 - x0 + 1) + (x - x0)) * 4; if (md[k + 3] < 128) continue; tot++; const q = (y * W + x) * 4; if (sd[q + 3] < 128) continue; hit++; const key = (sd[q] << 16) | (sd[q + 1] << 8) | sd[q + 2]; cnt.set(key, (cnt.get(key) || 0) + 1); }
    let best = null, bc = 0; for (const [k, v] of cnt) if (v > bc) { bc = v; best = k; }
    if (best == null || hit / Math.max(1, tot) < minShare) { stats.push(null); continue; }
    og.fillStyle = `rgb(${best >> 16},${(best >> 8) & 255},${best & 255})`; og.beginPath(); pts.forEach(([x, y], i) => i ? og.lineTo(x, y) : og.moveTo(x, y)); og.fill(); stats.push({ rgb: best, share: bc / Math.max(1, hit), cover: hit / Math.max(1, tot) }); }
  return { canvas: out, stats };
}
