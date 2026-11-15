// Procedural textures (all generated in the browser, no downloads) and imagery enhancement
import * as THREE from 'three';
import { mulberry32 } from './geo.js?v=8';

function canvas(S) { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
function gray(c, colorSpace = THREE.NoColorSpace) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = colorSpace;
  t.anisotropy = 8; return t;
}
// normalise a grayscale canvas so its mean is 0.5 (for "detail map" multiply-by-2 blending)
function normalise(ctx, S, contrast = 1) {
  const im = ctx.getImageData(0, 0, S, S), d = im.data; let m = 0;
  for (let i = 0; i < d.length; i += 4) m += d[i]; m /= d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, 128 + (d[i] - m) * contrast)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  ctx.putImageData(im, 0, 0);
}
const wrapDraw = (S, x, y, r, fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) fn(x + ox, y + oy); };

export function noiseTexture() {
  const S = 256, c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S), rnd = mulberry32(5);
  const oct = [[8, .5], [16, .25], [32, .15], [64, .1]], grids = oct.map(([f]) => Array.from({ length: f * f }, rnd));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    oct.forEach(([f, amp], k) => {
      const gx = x / S * f, gy = y / S * f, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, g = grids[k];
      const at = (i, j) => g[((j % f + f) % f) * f + ((i % f + f) % f)], sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      v += amp * ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy);
    });
    const o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, v * 255)); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return gray(c);
}

export function waterNormals() {
  const S = 256, c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const h = (x, y) => { let v = 0; const T = 2 * Math.PI / S; for (const [a, b, ph, amp] of [[3, 1, .3, 1], [1, 4, 1.7, .8], [5, 3, 2.1, .5], [7, -2, .4, .4], [-4, 6, 1.1, .35], [11, 5, .9, .2], [-9, 13, 2.4, .12]]) v += amp * Math.sin((a * x + b * y) * T + ph); return v; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), nx = -dx * .35, ny = -dy * .35, l = Math.hypot(nx, ny, 1), o = (y * S + x) * 4;
    img.data[o] = (nx / l * .5 + .5) * 255; img.data[o + 1] = (ny / l * .5 + .5) * 255; img.data[o + 2] = (1 / l * .5 + .5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return gray(c);
}

/* ---- ground detail textures (tileable, grayscale, mean 0.5) ---- */
export function detailTextures() {
  const S = 512, rnd = mulberry32(42);
  // grass: thousands of short blade strokes
  const g = canvas(S), gc = g.getContext('2d');
  gc.fillStyle = '#6a6a6a'; gc.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S, len = 5 + rnd() * 12, a = -Math.PI / 2 + (rnd() - 0.5) * 1.2, v = 60 + rnd() * 150;
    gc.strokeStyle = `rgb(${v},${v},${v})`; gc.lineWidth = 1 + rnd() * 1.4;
    wrapDraw(S, x, y, len, (X, Y) => { gc.beginPath(); gc.moveTo(X, Y); gc.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); gc.stroke(); });
  }
  normalise(gc, S, 1.1);
  // rice: planted rows of clumps with darker wet soil between rows
  const r = canvas(S), rc = r.getContext('2d');
  rc.fillStyle = '#3c3c3c'; rc.fillRect(0, 0, S, S);
  const rows = 9, cols = 10;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = (i + 0.5) * S / cols + (rnd() - .5) * 6, cy = (j + 0.5) * S / rows + (rnd() - .5) * 4;
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, len = 8 + rnd() * 16, v = 120 + rnd() * 120;
      rc.strokeStyle = `rgb(${v},${v},${v})`; rc.lineWidth = 1.2 + rnd();
      wrapDraw(S, cx, cy, 30, (X, Y) => { rc.beginPath(); rc.moveTo(X, Y); rc.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len * 0.6); rc.stroke(); });
    }
  }
  normalise(rc, S, 1.0);
  // soil: dry cracked mud (voronoi edges) + speckles
  const s = canvas(S), sc = s.getContext('2d'), pts = Array.from({ length: 70 }, () => [rnd() * S, rnd() * S]);
  const si = sc.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of pts) { let dx = Math.abs(x - px), dy = Math.abs(y - py); dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy); const d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    const e = Math.sqrt(d2) - Math.sqrt(d1), v = 150 - (e < 2.2 ? 90 : 0) + (rnd() - .5) * 50, o = (y * S + x) * 4;
    si.data[o] = si.data[o + 1] = si.data[o + 2] = v; si.data[o + 3] = 255;
  }
  sc.putImageData(si, 0, 0); normalise(sc, S, 0.9);
  // gravel / built ground
  const b = canvas(S), bc = b.getContext('2d'); bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) { const v = 40 + rnd() * 200, x = rnd() * S, y = rnd() * S, rr = 0.6 + rnd() * 2.4; bc.fillStyle = `rgb(${v},${v},${v})`; wrapDraw(S, x, y, rr, (X, Y) => { bc.beginPath(); bc.arc(X, Y, rr, 0, 7); bc.fill(); }); }
  normalise(bc, S, 0.8);
  return { grass: gray(g), rice: gray(r), soil: gray(s), gravel: gray(b) };
}

/* ---- imagery colour balance: dark-object subtraction (haze) + bright-reference balance ----
   Unlike grey-world it does not turn green rural scenes magenta. Returns {o, g, add}. */
export function balanceGains(px) {
  const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let n = 0;
  for (let i = 0; i < px.length; i += 4 * 5) { H[0][px[i]]++; H[1][px[i + 1]]++; H[2][px[i + 2]]++; n++; }
  const pct = (h, q) => { let a = 0; for (let i = 0; i < 256; i++) { a += h[i]; if (a >= n * q) return i; } return 255; };
  const dark = H.map(h => pct(h, 0.004)), bright = H.map(h => pct(h, 0.996));
  const o = dark.map(d => d * 0.85), span = bright.map((b, k) => Math.max(40, b - o[k])), m = (span[0] + span[1] + span[2]) / 3;
  const g = span.map(s => Math.max(0.82, Math.min(1.22, m / s)));
  return { o, g, add: (o[0] + o[1] + o[2]) / 3 * 0.35 };
}
export const wb = (v, k, B) => { const r = (v - B.o[k]) * B.g[k] + B.add; return r < 0 ? 0 : r > 255 ? 255 : r; };

/* ---- "Enhanced" imagery: white balance + percentile stretch + saturation + sharpen (pixel maths, works in Safari) ---- */
export function enhanceCanvas(src, px, gains) {
  const w = src.width, h = src.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), out = ctx.createImageData(w, h), o = out.data;
  // one luminance histogram after white balance (same stretch for all channels keeps colours natural)
  const hist = new Uint32Array(256); let tot = 0;
  for (let i = 0; i < px.length; i += 4 * 3) { hist[(0.3 * wb(px[i], 0, gains) + 0.59 * wb(px[i + 1], 1, gains) + 0.11 * wb(px[i + 2], 2, gains)) | 0]++; tot++; }
  let a = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { a += hist[i]; if (a < tot * 0.005) lo = i; if (a < tot * 0.99) hi = i; }
  hi = Math.max(hi, lo + 60); const sc = 1 / (hi - lo);
  const tmp = new Float32Array(w * h * 3);
  for (let p = 0, q = 0; p < px.length; p += 4, q += 3) {
    let r = (wb(px[p], 0, gains) - lo) * sc, g = (wb(px[p + 1], 1, gains) - lo) * sc, b = (wb(px[p + 2], 2, gains) - lo) * sc;
    const y = 0.3 * r + 0.59 * g + 0.11 * b, s = 1.22;
    const k = 0.62, r0 = wb(px[p], 0, gains) / 255, g0 = wb(px[p + 1], 1, gains) / 255, b0 = wb(px[p + 2], 2, gains) / 255;
    tmp[q] = (y + (r - y) * s) * k + r0 * (1 - k); tmp[q + 1] = (y + (g - y) * s) * k + g0 * (1 - k); tmp[q + 2] = (y + (b - y) * s) * k + b0 * (1 - k);
  }
  // unsharp mask (3x3) on the stretched image
  const amt = 0.55;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 3, p = (y * w + x) * 4;
    const xl = x > 0 ? q - 3 : q, xr = x < w - 1 ? q + 3 : q, yu = y > 0 ? q - w * 3 : q, yd = y < h - 1 ? q + w * 3 : q;
    for (let k = 0; k < 3; k++) {
      const v = tmp[q + k], blur = (tmp[xl + k] + tmp[xr + k] + tmp[yu + k] + tmp[yd + k] + v * 4) / 8;
      let s = v + (v - blur) * amt; s = s < 0 ? 0 : s > 1 ? 1 : s;
      o[p + k] = (s * s * (3 - 2 * s) * 0.25 + s * 0.75) * 255;
    }
    o[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/* ---- land-cover class of one (white-balanced) pixel ----
   1 water 2 tree canopy 3 crop/grass 4 bare soil 5 built/other */
export function classify(r, g, b) {
  const v = (r + g + b) / 3, exg = 2 * g - r - b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
  if (b > r + 10 && b > g + 2 && v < 110 && sat > 0.12) return 1;
  if (v < 42 && exg < 8 && b >= r) return 1;
  if (exg > 12 && v < 100 && g > r) return 2;
  if (exg > 6) return 3;
  if (r > g + 4 && r > b + 14 && v < 235) return 4;
  return 5;
}
