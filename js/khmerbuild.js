// Cambodian street scene details, modelled on what the roads look like on Street View:
// shophouses (balconies on every floor, shop awning and sign, roll-up shutters, parapet, water tank or tin shed on the roof),
// wooden houses on stilts with a stair, villas with a front balcony, compound walls with a gate along the road,
// and concrete power poles with sagging wires along the roads.
import * as THREE from 'three';

const AWN = [0x2f6fb0, 0xc23b2e, 0x2f8a4a, 0xd9a21c, 0x3a9bb5, 0xe2e2dc, 0x7d3f99];
const SIGN = [0xc8202a, 0x1f5fb0, 0xf2c40f, 0x1e8a43, 0xf4f1ea, 0xe0581e, 0x0b6e8f];
const FENCE = [0xe9e2d2, 0xd7c9a8, 0x9fc7a8, 0xe8d6a0, 0xc9d3d8, 0xf0e6d8, 0xb9a48a];
const GATE = [0x2c3a3f, 0x4c6b4d, 0x7a2f2a, 0x1f3f6b, 0x5b5b5b];
const lin = h => new THREE.Color(h).convertSRGBToLinear();
const pick = (a, rnd) => a[(rnd() * a.length) | 0];

// what kind of Cambodian building this footprint is, and which edge faces the road
export function classify(b, ring, area, ob, h, net) {
  let front = -1, rd = Infinity, road = null;
  if (net && ob) {
    const nr = net.near(ob.cx, ob.cz, 40)[0];
    if (nr) {
      road = net.roads[nr[0]]; const P = road.pts[nr[1]];
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], d = Math.hypot((p[0] + q[0]) / 2 - P.x, (p[1] + q[1]) / 2 - P.z); if (d < rd) { rd = d; front = i; } }
    }
  }
  const t = b.t, narrow = ob ? Math.min(ob.a, ob.b) * 2 : 99, special = [6, 9, 10, 11].includes(t);
  let kind = 'plain';
  if (b.stilt) kind = 'stilt';
  else if (!special && ob && h >= 5.5 && h <= 24 && rd < 14 && front >= 0) { // a shophouse, or a row of them along the street
    const p = ring[front], q = ring[(front + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L >= 3 && area / L <= 32 && (narrow <= 8.5 || L >= 8)) kind = 'shop'; else if (h <= 9 && area <= 320) kind = 'villa'; }
  else if (!special && ob && h >= 5.5 && h <= 9 && area <= 320) kind = 'villa';
  else if (!special && ob && area <= 260) kind = 'house';
  return { kind, front, rd, road };
}

// extra geometry for a building (tri(a, b, c, color) adds one triangle)
export function details(K, b, ring, ob, gnd, top, h, wallC, tri, rnd, area) {
  if (K.front < 0) return;
  const p = ring[K.front], q = ring[(K.front + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 2) return;
  const depth = area / L; // how far the building reaches back from the road
  const tx = (q[0] - p[0]) / L, tz = (q[1] - p[1]) / L; let nx = -tz, nz = tx;
  const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2; if ((mx - ob.cx) * nx + (mz - ob.cz) * nz < 0) { nx = -nx; nz = -nz; } // outward
  const P = (s, o, y) => [p[0] + tx * s + nx * o, y, p[1] + tz * s + nz * o];
  const quad = (a, b2, c, d, col) => { tri(a, b2, c, col); tri(a, c, d, col); };
  const box = (s0, s1, o0, o1, y0, y1, col) => { // a slab or post between along s0..s1, out o0..o1, height y0..y1
    const sh = col.clone().multiplyScalar(0.8);
    quad(P(s0, o0, y1), P(s1, o0, y1), P(s1, o1, y1), P(s0, o1, y1), col);
    quad(P(s0, o1, y0), P(s1, o1, y0), P(s1, o1, y1), P(s0, o1, y1), sh);
    quad(P(s0, o0, y0), P(s0, o1, y0), P(s0, o1, y1), P(s0, o0, y1), sh); quad(P(s1, o0, y0), P(s1, o1, y0), P(s1, o1, y1), P(s1, o0, y1), sh);
    quad(P(s0, o0, y0), P(s1, o0, y0), P(s1, o1, y0), P(s0, o1, y0), sh);
  };
  if (K.kind === 'shop') {
    const floors = Math.max(1, Math.floor(h / 3.2 + 0.2)), slab = wallC.clone().multiplyScalar(0.95);
    // one shopfront per 4–4.5 m bay: each with its own awning, sign and balconies (a row of shophouses along the street)
    const nb = Math.max(1, Math.round(L / 4.2)), bw = L / nb;
    for (let k0 = 0; k0 < nb; k0++) {
      const a0 = k0 * bw, a1 = a0 + bw, aw = lin(pick(AWN, rnd)), sg = lin(pick(SIGN, rnd)), ad = 1.5 + rnd() * 0.9, rail = lin(rnd() < 0.5 ? 0x3b3f42 : rnd() < 0.5 ? 0xd9d6cf : 0x8a6a3a);
      if (rnd() < 0.85) quad(P(a0, 0.05, gnd + 3.0), P(a1, 0.05, gnd + 3.0), P(a1, ad, gnd + 2.55), P(a0, ad, gnd + 2.55), aw);
      if (rnd() < 0.8) quad(P(a0 + 0.15, 0.12, gnd + 3.05), P(a1 - 0.15, 0.12, gnd + 3.05), P(a1 - 0.15, 0.12, gnd + 3.85), P(a0 + 0.15, 0.12, gnd + 3.85), sg);
      for (let k = 1; k < floors; k++) {
        const y = gnd + 3.2 * k; if (y > top - 1) break; const dep = 0.9 + (k === 1 ? 0.2 : 0), rh = 1.05;
        box(a0 + 0.05, a1 - 0.05, 0, dep, y - 0.15, y, slab);
        quad(P(a0, dep, y), P(a1, dep, y), P(a1, dep, y + rh), P(a0, dep, y + rh), rail);
        quad(P(a0 + 0.05, 0, y), P(a0 + 0.05, dep, y), P(a0 + 0.05, dep, y + rh), P(a0 + 0.05, 0, y + rh), rail);
      }
    }
    // parapet round the flat roof
    for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; quad([a[0], top, a[1]], [c[0], top, c[1]], [c[0], top + 0.9, c[1]], [a[0], top + 0.9, a[1]], wallC); }
    // on the roof: a water tank, often a tin shed behind
    const back = depth - 1, r = rnd();
    if (r < 0.55) { const tc = lin(rnd() < 0.5 ? 0x2d6fb5 : 0xd8dbdd), s = L * 0.25, o = -Math.min(2.5, back * 0.5); box(s, s + 1.2, o - 1.2, o, top, top + 1.6, tc); box(s - 0.1, s + 1.3, o - 1.3, o + 0.1, top + 1.6, top + 1.7, tc.clone().multiplyScalar(0.85)); }
    if (r > 0.35 && back > 4) { const tin = lin(pick([0x8e9499, 0x7a8086, 0x9b6a4e, 0x3d6a99], rnd)), o0 = -back * 0.35, o1 = -back + 0.3;
      quad(P(0.2, o0, top + 2.6), P(L - 0.2, o0, top + 2.6), P(L - 0.2, o1, top + 2.1), P(0.2, o1, top + 2.1), tin);
      for (const s of [0.3, L - 0.3]) for (const o of [o0, o1]) box(s - 0.06, s + 0.06, o - 0.06, o + 0.06, top, top + (o === o0 ? 2.6 : 2.1), tin.clone().multiplyScalar(0.7)); }
  } else if (K.kind === 'stilt') {
    // wooden stair up to the floor at one end of the front
    const wood = lin(0x6b4b33), yF = gnd, y0 = yF - (b.stilt || 2), s0 = L * 0.15, run = (b.stilt || 2) * 1.1;
    quad(P(s0, 0, yF), P(s0 + 0.9, 0, yF), P(s0 + 0.9, run, y0), P(s0, run, y0), wood);
    for (let i = 1; i < 6; i++) { const f = i / 6, y = yF + (y0 - yF) * f, o = run * f; quad(P(s0, o, y), P(s0 + 0.9, o, y), P(s0 + 0.9, o, y + 0.06), P(s0, o, y + 0.06), wood.clone().multiplyScalar(0.8)); }
    // a few more posts along the long sides
    for (let s = L / 3; s < L - 0.5; s += L / 3) for (const o of [0, -depth + 0.2]) box(s - 0.12, s + 0.12, o - 0.12, o + 0.12, y0, yF, wood);
  } else if (K.kind === 'villa') {
    // front balcony on the upper floor
    const y = gnd + 3.2, w0 = L * (0.25 + rnd() * 0.15), w1 = L - w0 * (0.6 + rnd() * 0.6), rail = lin(rnd() < 0.6 ? 0xf2efe8 : 0x3b3f42);
    if (y < top - 1.5 && w1 - w0 > 2) { box(w0, w1, 0, 1.4, y - 0.18, y, wallC.clone().multiplyScalar(0.95)); quad(P(w0, 1.4, y), P(w1, 1.4, y), P(w1, 1.4, y + 1.0), P(w0, 1.4, y + 1.0), rail);
      for (const s of [w0, w1]) box(s - 0.12, s + 0.12, 1.2, 1.4, gnd, y - 0.18, wallC); }
  }
  // compound wall with a gate between the house and the road
  if ((K.kind === 'villa' || K.kind === 'house') && K.road) {
    const off = K.rd - K.road.hw - 1.2;
    if (off > 2 && off < 9 && rnd() < (K.road.urban ? 0.8 : 0.35)) {
      const fc = lin(pick(FENCE, rnd)), gc = lin(pick(GATE, rnd)), s0 = -2, s1 = L + 2, g0 = L / 2 - 1.7, g1 = L / 2 + 1.7, hgt = 1.7;
      const seg = (a, c) => { if (c - a < 0.2) return; box(a, c, off - 0.12, off + 0.12, top - h - 0.3, top - h + hgt, fc); };
      seg(s0, g0); seg(g1, s1);
      quad(P(g0, off, top - h - 0.2), P(g1, off, top - h - 0.2), P(g1, off, top - h + 1.9), P(g0, off, top - h + 1.9), gc);
      for (const s of [s0, s1]) box(s - 0.12, s + 0.12, -0.5, off, top - h - 0.3, top - h + hgt, fc); // side walls back towards the house
    }
  }
}

// concrete power poles every ~38 m on one side of the roads, with three power wires and one cable
export function powerLines(world) {
  const net = world.net, D = world.D; if (!net) return null;
  const { mw, mh, MR, X0, Z0 } = D, mAt = (m, x, z) => m && m[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
  const poles = [], wires = [], SP = 38;
  for (const r of net.roads) {
    if (r.bridge || ![3, 5, 7, 9, 11, 12].includes(r.cls) || r.pts.length < 2) continue;
    let acc = SP * 0.5, prev = null, side = (r.id || 0) % 2 ? 1 : -1;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], l = Math.hypot(b.x - a.x, b.z - a.z); if (l < 0.01) continue;
      const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l;
      for (let s = acc; s < l; s += SP) {
        const o = r.hw + 1.3, x = a.x + tx * s - tz * o * side, z = a.z + tz * s + tx * o * side;
        if (mAt(world.bmask, x, z) || mAt(D.wmask, x, z) || x < X0 || z < Z0 || x > X0 + D.W || z > Z0 + D.H) { prev = null; continue; }
        const y = world.hAt(x, z), pole = { x, y, z, yaw: Math.atan2(tx, tz) };
        poles.push(pole);
        if (prev && Math.hypot(prev.x - x, prev.z - z) < SP * 1.7) wires.push([prev, pole]);
        prev = pole;
      }
      acc = ((acc - l) % SP + SP) % SP;
    }
  }
  if (!poles.length) return null;
  const g = new THREE.Group();
  // pole: tapered concrete shaft, cross arm with insulators
  const shaft = new THREE.CylinderGeometry(0.1, 0.16, 9, 6).translate(0, 4.5, 0), arm = new THREE.BoxGeometry(1.7, 0.12, 0.12).translate(0, 8.35, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 }), armM = new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.7, metalness: 0.3 });
  const mS = new THREE.InstancedMesh(shaft, mat, poles.length), mA = new THREE.InstancedMesh(arm, armM, poles.length), d = new THREE.Object3D();
  poles.forEach((p, i) => { d.position.set(p.x, p.y - 0.3, p.z); d.rotation.set(0, p.yaw, 0); d.updateMatrix(); mS.setMatrixAt(i, d.matrix); mA.setMatrixAt(i, d.matrix); });
  mS.castShadow = mA.castShadow = true; mS.receiveShadow = true; g.add(mS, mA);
  // wires: catenary sag between the poles
  const pos = [], N = 8;
  for (const [a, b] of wires) for (const [lat, hgt, sag] of [[-0.75, 8.42, 0.7], [0, 8.42, 0.7], [0.75, 8.42, 0.7], [0.12, 6.6, 0.95]]) {
    const ca = Math.cos(a.yaw), sa = Math.sin(a.yaw), cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
    const A = [a.x + ca * lat, a.y - 0.3 + hgt, a.z - sa * lat], B = [b.x + cb * lat, b.y - 0.3 + hgt, b.z - sb * lat];
    let last = A;
    for (let k = 1; k <= N; k++) { const f = k / N, pt = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f - sag * 4 * f * (1 - f), A[2] + (B[2] - A[2]) * f]; pos.push(...last, ...pt); last = pt; }
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1d1f, transparent: true, opacity: 0.85 })));
  g.userData.count = poles.length;
  return g;
}
