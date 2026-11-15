// Tile maths, OSM tile loading and small geometry helpers
export const TZ = 13;
export const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
export const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
export const tx2lon = (x, z) => x / 2 ** z * 360 - 180;
export const ty2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

export function tileRange(b, z) {
  return {
    x0: Math.floor(lon2tx(b.w, z)), x1: Math.floor(lon2tx(b.e, z)),
    y0: Math.floor(lat2ty(b.n, z)), y1: Math.floor(lat2ty(b.s, z)),
  };
}

const cache = new Map();
export function loadOsmTile(x, y) {
  const k = x + '/' + y;
  if (!cache.has(k)) {
    cache.set(k, fetch(`data/13/${x}/${y}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  }
  return cache.get(k);
}

// decode a delta-encoded micro-degree ring/line relative to tile SW corner
export function decode(arr, x, y) {
  const w = tx2lon(x, TZ), s = ty2lat(y + 1, TZ), out = [];
  let px = 0, py = 0;
  for (let i = 0; i < arr.length; i += 2) { px += arr[i]; py += arr[i + 1]; out.push([w + px / 1e6, s + py / 1e6]); }
  return out;
}

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Clip a polyline [[x,z],...] to rectangle; returns list of polylines
export function clipLine(pts, x0, z0, x1, z1) {
  const out = []; let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
    const p = [-dx, dx, -dz, dz], q = [ax - x0, x1 - ax, az - z0, z1 - az];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { ok = false; break; } }
      else { const r = q[k] / p[k]; if (p[k] < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; } }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
    const A = [ax + dx * t0, az + dz * t0], B = [ax + dx * t1, az + dz * t1];
    if (!cur) cur = [A];
    cur.push(B);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(l => l.length > 1);
}

// Sutherland–Hodgman clip of a ring to rectangle
export function clipRing(ring, x0, z0, x1, z1) {
  const edges = [
    [p => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z0]; }],
    [p => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z1]; }],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

export function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}

// minimum-area oriented bounding box via rotating edges of the hull
export function obb(pts) {
  const h = convexHull(pts); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of h) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, c, s, u0, u1, v0, v1 };
  }
  if (!best) return null;
  let { c, s, u0, u1, v0, v1 } = best;
  let a = (u1 - u0) / 2, bb = (v1 - v0) / 2, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  let ux = c, uz = s; // long axis
  if (bb > a) { [a, bb] = [bb, a]; ux = -s; uz = c; }
  const cx = uc * c - vc * s, cz = uc * s + vc * c;
  return { cx, cz, a, b: bb, ux, uz, vx: -uz, vz: ux, area: best.area };
}
