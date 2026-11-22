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

/* ---------------- Buddhist wats ---------------- */
const GOLD = () => lin(0xe3b544), TILE = [0xe0692f, 0xd65d2b, 0xe8803a], TILE2 = [0x4aa868, 0xefa040, 0xc44a30];
// a curled finial (chofa at the ridge ends, naga tails at the eaves): a thin gold plate that rises and hooks outward
function hook(tri, base, out, up, side, len, w, col) { // base point, outward / up / sideways unit vectors
  const n = 7; let x = 0, y = 0; const pts = [[0, 0]];
  for (let i = 0; i < n; i++) { const th = Math.PI / 2 - (i / (n - 1)) * Math.PI * 0.85, st = len / n; x += Math.cos(th) * st; y += Math.sin(th) * st; pts.push([x, y]); }
  const P = (p, s) => [base[0] + out[0] * p[0] + up[0] * p[1] + side[0] * s, base[1] + out[1] * p[0] + up[1] * p[1] + side[1] * s, base[2] + out[2] * p[0] + up[2] * p[1] + side[2] * s];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[i + 1], ww = w * (1 - i / (n + 2)); tri(P(a, -ww), P(b, -ww), P(b, ww), col); tri(P(a, -ww), P(b, ww), P(a, ww), col); }
}
// the vihara (main hall) and other wat buildings: plinth, colonnade, lower skirt roof, stacked gable tiers with gold
// bargeboards, chofa at the ridge ends, naga tails at the eaves, gilded pediments and a spire on the main hall
export function watBuilding(ring, ob0, g0, h, area, tri, rnd, main) {
  let ob = { ...ob0 }; if (ob.b > ob.a) ob = { ...ob, a: ob0.b, b: ob0.a, ux: ob0.vx, uz: ob0.vz, vx: -ob0.ux, vz: -ob0.uz };
  const A = ob.a, B = ob.b, P = (u, v, y) => [ob.cx + ob.ux * u + ob.vx * v, y, ob.cz + ob.uz * u + ob.vz * v];
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const box = (u0, u1, v0, v1, y0, y1, col) => { const s = col.clone().multiplyScalar(0.82);
    quad(P(u0, v0, y1), P(u1, v0, y1), P(u1, v1, y1), P(u0, v1, y1), col);
    quad(P(u0, v0, y0), P(u1, v0, y0), P(u1, v0, y1), P(u0, v0, y1), s); quad(P(u1, v1, y0), P(u0, v1, y0), P(u0, v1, y1), P(u1, v1, y1), s);
    quad(P(u0, v1, y0), P(u0, v0, y0), P(u0, v0, y1), P(u0, v1, y1), col.clone().multiplyScalar(0.9)); quad(P(u1, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u1, v0, y1), col.clone().multiplyScalar(0.9)); };
  const gold = GOLD(), white = lin(0xf4efe2), wallC = lin(main ? 0xf1dd9a : [0xf1dd9a, 0xf2e6c8, 0xe8c98a][(rnd() * 3) | 0]), dark = lin(0x3a2a1c);
  const tile = lin(TILE[(rnd() * TILE.length) | 0]), band = lin(TILE2[(rnd() * TILE2.length) | 0]), ped = lin(0xd4a040);
  const c = main ? 1.6 : 1.1, plin = main ? 1.2 : 0.6, gnd = g0 + 0.3 + plin, hw = Math.max(3.6, Math.min(main ? 6.5 : 4.5, h * 0.75)), top = gnd + hw;
  // plinth with steps at both ends
  box(-A - c - 0.8, A + c + 0.8, -B - c - 0.8, B + c + 0.8, g0 - 0.5, gnd, white);
  for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) { const y = g0 + (plin + 0.3) * (k + 1) / 4, u = (A + c + 0.8) + (4 - k) * 0.45; box(sg > 0 ? A + c + 0.8 : -u, sg > 0 ? u : -A - c - 0.8, -1.6, 1.6, g0 - 0.5, y, white); }
  // walls with tall dark windows and doors
  box(-A, A, -B, B, gnd, top, wallC);
  for (let u = -A + 1.8; u < A - 1.2; u += 3) for (const v of [-B - 0.03, B + 0.03]) quad(P(u - 0.5, v, gnd + 1.0), P(u + 0.5, v, gnd + 1.0), P(u + 0.5, v, top - 1.0), P(u - 0.5, v, top - 1.0), dark);
  for (const u of [-A - 0.03, A + 0.03]) quad(P(u, -0.9, gnd), P(u, 0.9, gnd), P(u, 0.9, top - 0.8), P(u, -0.9, top - 0.8), dark);
  // colonnade
  const colH = top - 1.0;
  for (let u = -A - c; u <= A + c + 0.01; u += (2 * (A + c)) / Math.max(2, Math.round((A + c) / 1.5))) for (const v of [-B - c, B + c]) { box(u - 0.2, u + 0.2, v - 0.2, v + 0.2, gnd, colH, white); box(u - 0.28, u + 0.28, v - 0.28, v + 0.28, colH - 0.35, colH, gold); }
  for (let v = -B - c; v <= B + c + 0.01; v += (2 * (B + c)) / Math.max(2, Math.round((B + c) / 1.5))) for (const u of [-A - c, A + c]) box(u - 0.2, u + 0.2, v - 0.2, v + 0.2, gnd, colH, white);
  // lower skirt roof from the wall top out over the colonnade
  const sk = c + 0.9, ys = colH - 0.1;
  quad(P(-A, -B, top), P(A, -B, top), P(A + sk, -B - sk, ys), P(-A - sk, -B - sk, ys), tile); quad(P(A, B, top), P(-A, B, top), P(-A - sk, B + sk, ys), P(A + sk, B + sk, ys), tile.clone().multiplyScalar(0.86));
  quad(P(-A, B, top), P(-A, -B, top), P(-A - sk, -B - sk, ys), P(-A - sk, B + sk, ys), tile.clone().multiplyScalar(0.93)); quad(P(A, -B, top), P(A, B, top), P(A + sk, B + sk, ys), P(A + sk, -B - sk, ys), tile.clone().multiplyScalar(0.93));
  for (const [u0, v0, u1, v1] of [[-A - sk, -B - sk, A + sk, -B - sk], [-A - sk, B + sk, A + sk, B + sk]]) quad(P(u0, v0, ys), P(u1, v1, ys), P(u1, v1, ys - 0.25), P(u0, v0, ys - 0.25), gold);
  // stacked gable tiers: the lower ones longer, each higher one shorter and raised
  const T = main ? 3 : area > 120 ? 2 : 1; let Bk = B + 0.6, yk = top;
  for (let k = 0; k < T; k++) {
    const Ak = A + 0.6 - k * Math.min(2.6, (A + 0.6) * 0.2), rise = Bk * 1.05, y1 = yk + rise, col = k % 2 ? band : tile;
    quad(P(-Ak, -Bk, yk), P(Ak, -Bk, yk), P(Ak, 0, y1), P(-Ak, 0, y1), col); quad(P(Ak, Bk, yk), P(-Ak, Bk, yk), P(-Ak, 0, y1), P(Ak, 0, y1), col.clone().multiplyScalar(0.86));
    for (const sg of [-1, 1]) {
      const u = sg * Ak; tri(P(u, -Bk + 0.3, yk + 0.15), P(u, Bk - 0.3, yk + 0.15), P(u, 0, y1 - 0.3), ped); // gilded pediment
      tri(P(u + sg * 0.02, -Bk * 0.5, yk + rise * 0.3), P(u + sg * 0.02, Bk * 0.5, yk + rise * 0.3), P(u + sg * 0.02, 0, yk + rise * 0.7), lin(0xc0582f));
      for (const sv of [-1, 1]) { // gold bargeboards along both sloped edges, with a naga tail at the eave
        quad(P(u + sg * 0.06, sv * Bk, yk), P(u + sg * 0.06, 0, y1), P(u + sg * 0.06, 0, y1 - 0.45), P(u + sg * 0.06, sv * Bk, yk - 0.45), gold);
        hook(tri, P(u + sg * 0.06, sv * Bk, yk - 0.2), [ob.vx * sv, 0, ob.vz * sv], [0, 1, 0], [ob.ux, 0, ob.uz], 0.9, 0.1, gold);
      }
      hook(tri, P(u + sg * 0.06, 0, y1 - 0.1), [ob.ux * sg, 0, ob.uz * sg], [0, 1, 0], [ob.vx, 0, ob.vz], 1.6, 0.14, gold); // chofa
    }
    quad(P(-Ak, -0.12, y1 + 0.02), P(Ak, -0.12, y1 + 0.02), P(Ak, 0.12, y1 + 0.02), P(-Ak, 0.12, y1 + 0.02), gold); // ridge
    Bk *= 0.9; yk = yk + rise * 0.3;
    if (k === T - 1 && main) { // spire at the middle of the ridge
      const n = 8, H = 3.2; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, r = 0.45;
        tri(P(Math.cos(a0) * r, Math.sin(a0) * r, y1), P(Math.cos(a1) * r, Math.sin(a1) * r, y1), P(0, 0, y1 + H), gold); }
    }
  }
}

// wall round the wat ground with a gate facing the nearest road (religious landuse areas, or around groups of wat buildings)
export function watWalls(world) {
  const D = world.D, net = world.net, pos = [], col = [];
  const tri = (a, b, c, k) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(k.r, k.g, k.b); };
  const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
  const inRing = (x, z, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; };
  const rings = D.landuse.filter(l => l.code === 14).map(l => l.rings[0]).filter(r => r && r.length >= 3 && Math.abs(ringArea(r)) < 60000);
  // wat buildings outside any mapped wat ground: group them and wall a rectangle around each group
  const wb = D.buildings.filter(b => b.t === 6 && Math.abs(ringArea(b.ring)) < 1500).map(b => ({ b, c: b.ring.reduce((s, p) => [s[0] + p[0] / b.ring.length, s[1] + p[1] / b.ring.length], [0, 0]) })).filter(o => !rings.some(r => inRing(o.c[0], o.c[1], r)));
  const used = new Set();
  for (let i = 0; i < wb.length; i++) {
    if (used.has(i)) continue; const grp = [i]; used.add(i);
    for (let k = 0; k < grp.length; k++) for (let j = 0; j < wb.length; j++) if (!used.has(j) && Math.hypot(wb[j].c[0] - wb[grp[k]].c[0], wb[j].c[1] - wb[grp[k]].c[1]) < 60) { used.add(j); grp.push(j); }
    const big = grp.reduce((m, j) => Math.abs(ringArea(wb[j].b.ring)) > Math.abs(ringArea(wb[m].b.ring)) ? j : m, grp[0]);
    const o = obbOf(wb[big].b.ring); if (!o) continue;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const j of grp) for (const p of wb[j].b.ring) { const dx = p[0] - o.cx, dz = p[1] - o.cz, u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const m = 12; u0 -= m; u1 += m; v0 -= m; v1 += m; if (u1 - u0 > 260 || v1 - v0 > 260) continue;
    rings.push([[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [o.cx + o.ux * u + o.vx * v, o.cz + o.uz * u + o.vz * v]));
  }
  if (!rings.length) return null;
  const { mw, mh, MR, X0, Z0 } = D, mAt = (mk, x, z) => mk && mk[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
  const onRoad = (x, z) => { if (!net) return false; const n = net.near(x, z, 14)[0]; return n && n[2] < net.roads[n[0]].hw + 1.2; };
  const wc = lin(0xf2ecdc), cap = lin(0xd8a93a), red = lin(0x9a3324), tileC = lin(0xc4532b);
  const P = (x, z, y) => [x, y, z];
  for (const r of rings) {
    // gate: the point of the wall nearest a road
    let gate = null, gd = Infinity;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 4; s < L - 4; s += 3) { const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L, n = net && net.near(x, z, 40)[0]; if (n && n[2] < gd) { gd = n[2]; gate = { x, z, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L }; } } }
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 3)), tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = -tz * 0.15, nz = tx * 0.15;
      for (let k = 0; k < n; k++) {
        const x0 = a[0] + (b[0] - a[0]) * k / n, z0 = a[1] + (b[1] - a[1]) * k / n, x1 = a[0] + (b[0] - a[0]) * (k + 1) / n, z1 = a[1] + (b[1] - a[1]) * (k + 1) / n, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
        if (gate && Math.hypot(xm - gate.x, zm - gate.z) < 3.2) continue;
        if (onRoad(xm, zm) || mAt(D.wmask, xm, zm) || mAt(D.rmask, xm, zm)) continue;
        const y0 = Math.min(world.hAt(x0, z0), world.hAt(x1, z1)) - 0.3, y1 = y0 + 1.9;
        quad(P(x0 + nx, z0 + nz, y0), P(x1 + nx, z1 + nz, y0), P(x1 + nx, z1 + nz, y1), P(x0 + nx, z0 + nz, y1), wc);
        quad(P(x1 - nx, z1 - nz, y0), P(x0 - nx, z0 - nz, y0), P(x0 - nx, z0 - nz, y1), P(x1 - nx, z1 - nz, y1), wc.clone().multiplyScalar(0.9));
        quad(P(x0 + nx, z0 + nz, y1), P(x1 + nx, z1 + nz, y1), P(x1 - nx, z1 - nz, y1), P(x0 - nx, z0 - nz, y1), cap);
        if (k % 2 === 0) { const s = 0.3, px = x0, pz = z0; for (const [dx, dz, ex, ez] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) quad(P(px + dx, pz + dz, y0), P(px + ex, pz + ez, y0), P(px + ex, pz + ez, y1 + 0.5), P(px + dx, pz + dz, y1 + 0.5), wc); quad(P(px - s, pz - s, y1 + 0.5), P(px + s, pz - s, y1 + 0.5), P(px + s, pz + s, y1 + 0.5), P(px - s, pz + s, y1 + 0.5), cap); }
      }
    }
    if (gate) { // gate: two pillars, a red lintel and a small tiered roof with a gold spire
      const { x, z, tx, tz } = gate, y0 = world.hAt(x, z) - 0.3, nx = -tz, nz = tx, Q = (s, o, y) => [x + tx * s + nx * o, y, z + tz * s + nz * o];
      const pil = (s) => { for (const [a0, b0, a1, b1] of [[-0.5, -0.5, 0.5, -0.5], [0.5, -0.5, 0.5, 0.5], [0.5, 0.5, -0.5, 0.5], [-0.5, 0.5, -0.5, -0.5]]) quad(Q(s + a0, b0, y0), Q(s + a1, b1, y0), Q(s + a1, b1, y0 + 4.2), Q(s + a0, b0, y0 + 4.2), wc); };
      pil(-3.2); pil(3.2);
      quad(Q(-3.7, -0.55, y0 + 3.6), Q(3.7, -0.55, y0 + 3.6), Q(3.7, -0.55, y0 + 4.4), Q(-3.7, -0.55, y0 + 4.4), red); quad(Q(3.7, 0.55, y0 + 3.6), Q(-3.7, 0.55, y0 + 3.6), Q(-3.7, 0.55, y0 + 4.4), Q(3.7, 0.55, y0 + 4.4), red);
      for (let k = 0; k < 2; k++) { const A2 = 4.2 - k * 1.2, B2 = 1.6 - k * 0.3, yb = y0 + 4.4 + k * 0.9, yt = yb + 1.4;
        quad(Q(-A2, -B2, yb), Q(A2, -B2, yb), Q(A2, 0, yt), Q(-A2, 0, yt), tileC); quad(Q(A2, B2, yb), Q(-A2, B2, yb), Q(-A2, 0, yt), Q(A2, 0, yt), tileC.clone().multiplyScalar(0.86));
        for (const sg of [-1, 1]) { tri(Q(sg * A2, -B2, yb), Q(sg * A2, B2, yb), Q(sg * A2, 0, yt), cap); hook(tri, Q(sg * A2, 0, yt - 0.05), [tx * sg, 0, tz * sg], [0, 1, 0], [nx, 0, nz], 0.9, 0.09, cap); } }
      for (let i = 0; i < 8; i++) { const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, yb = y0 + 4.4 + 0.9 + 1.4; tri(Q(Math.cos(a0) * 0.3, Math.sin(a0) * 0.3, yb), Q(Math.cos(a1) * 0.3, Math.sin(a1) * 0.3, yb), Q(0, 0, yb + 2.2), cap); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; return m;
}
const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
function obbOf(ring) { // principal axes of a footprint
  const n = ring.length; let cx = 0, cz = 0; for (const p of ring) { cx += p[0] / n; cz += p[1] / n; }
  let xx = 0, xz = 0, zz = 0; for (const p of ring) { const dx = p[0] - cx, dz = p[1] - cz; xx += dx * dx; xz += dx * dz; zz += dz * dz; }
  const th = 0.5 * Math.atan2(2 * xz, xx - zz), ux = Math.cos(th), uz = Math.sin(th);
  return { cx, cz, ux, uz, vx: -uz, vz: ux };
}

// wat buildings: OSM temples, plus the halls standing inside a mapped wat ground (often tagged only building=yes).
// The biggest hall of each wat ground is the vihara.
export function watRoles(D) {
  const role = new Map(), rings = D.landuse.filter(l => l.code === 14).map(l => l.rings[0]).filter(r => r && r.length >= 3);
  const inRing = (x, z, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; };
  const groups = rings.map(() => []);
  for (const b of D.buildings) {
    const ar = Math.abs(ringArea(b.ring)); if (ar < 40 || ar >= 1500) continue;
    const c = b.ring.reduce((s, p) => [s[0] + p[0] / b.ring.length, s[1] + p[1] / b.ring.length], [0, 0]);
    const k = rings.findIndex(r => inRing(c[0], c[1], r));
    if (k >= 0) groups[k].push([b, ar]); else if (b.t === 6) role.set(b, ar >= 150 ? 'main' : 'hall');
  }
  for (const g of groups) { g.sort((p, q) => q[1] - p[1]); g.forEach(([b, ar], i) => { if (i === 0 && ar >= 100) role.set(b, 'main'); else if (ar >= 100 && i < 3 && !(b.lv > 2)) role.set(b, 'hall'); }); }
  return role;
}
