// Farm detail after Terrain to Blender: rice hills that look like rice at each stage of the Cambodian rice year,
// rice only inside the mapped fields (Field Boundaries), flooded paddies at planting, straw stacks by the houses
// after the harvest, and earth bunds between the fields.
import * as THREE from 'three';

export const FARM = { mask: null }; // field raster: 1 = inside a field, 0 = outside (set from the Field Boundaries)
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// stages: seedling (June–July, flooded), vegetative (August–October), ripe (November–December), stubble (dry season)
export const RICE_SPEC = {
  seedling: { h: 0.32, tillers: 4, leaf: 0x6fae35, straw: 0x7f9c3a, grain: null },
  vegetative: { h: 0.85, tillers: 7, leaf: 0x3f7f22, straw: 0x4f7a26, grain: null },
  ripe: { h: 1.0, tillers: 7, leaf: 0xa49a46, straw: 0xc0a253, grain: 0xd8a634 },
  stubble: { h: 0.22, tillers: 9, leaf: 0xa48a5a, straw: 0xc3a46a, grain: null },
};
// one rice hill: a clump of tillers, each a stem with long arching leaves and, when ripe, a nodding golden panicle
export function riceHill(kind = 'vegetative', seed = 3) {
  const S = RICE_SPEC[kind] || RICE_SPEC.vegetative, r = mulberry(seed), pos = [], col = [], up = new THREE.Vector3(0, 1, 0);
  const cL = new THREE.Color(S.leaf), cS = new THREE.Color(S.straw), cG = S.grain ? new THREE.Color(S.grain) : null;
  const strip = (pts, ws, sides, c, c2) => { for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], sa = sides[k].clone().multiplyScalar(ws[k]), sb = sides[k + 1].clone().multiplyScalar(ws[k + 1]);
    const A0 = a.clone().sub(sa), A1 = a.clone().add(sa), B0 = b.clone().sub(sb), B1 = b.clone().add(sb), ca = c.clone().lerp(c2 || c, k / (pts.length - 1)), cb = c.clone().lerp(c2 || c, (k + 1) / (pts.length - 1));
    for (const [p, cc] of [[A0, ca], [A1, ca], [B1, cb], [A0, ca], [B1, cb], [B0, cb]]) { pos.push(p.x, p.y, p.z); col.push(cc.r, cc.g, cc.b); } } };
  const bent = (start, d, phi0, bend, len, n) => { const pts = [start.clone()], c = start.clone(); for (let k = 0; k < n; k++) { const phi = phi0 + bend * (k + 0.5) / n; c.addScaledVector(d, Math.sin(phi) * len / n).addScaledVector(up, Math.cos(phi) * len / n); pts.push(c.clone()); } return pts; };
  const H = S.h, n = S.tillers, dark = cL.clone().multiplyScalar(0.55);
  for (let t = 0; t < n; t++) {
    const az = 2 * Math.PI * (t + (r() - 0.5) * 0.6) / n, rb = 0.015 + r() * 0.04, d = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), side = new THREE.Vector3(-d.z, 0, d.x), base = d.clone().multiplyScalar(rb);
    if (kind === 'stubble') { const h = H * (0.6 + r() * 0.4), p = bent(base, d, r() * 0.25, 0, h, 1); strip(p, [0.004, 0.003], [side, side], cS.clone().multiplyScalar(0.8), cS); continue; }
    const tilt = 0.1 + r() * 0.22 + 0.2 * rb / 0.055, hc = H * (0.8 + r() * 0.2), culm = bent(base, d, tilt, 0.15, hc, 1); strip(culm, [0.004, 0.003], [side, side], dark, cS);
    for (let k = 0; k < 2; k++) { const flag = kind === 'ripe' && k === 1, laz = az + (r() - 0.5) * 2.2, ld = new THREE.Vector3(Math.cos(laz), 0, Math.sin(laz)), ls = new THREE.Vector3(-ld.z, 0, ld.x);
      const z0 = hc * (flag ? 0.72 : 0.08 + r() * 0.35), L = H * (flag ? 0.32 : 0.55 + r() * 0.2), st = base.clone().addScaledVector(d, z0 * Math.sin(tilt)).addScaledVector(up, z0 * Math.cos(tilt));
      const p = bent(st, ld, flag ? 0.2 : 0.35 + r() * 0.3, flag ? 0.5 : 1.0 + r() * 0.9, L, 2); strip(p, [0.009, 0.008, 0.0015], [ls, ls, ls], dark.clone().lerp(cL, 0.6), cL.clone().multiplyScalar(1.1)); }
    if (cG) { const neck = culm[culm.length - 1], rach = bent(neck, d, tilt + 0.25, 2.3 + r() * 0.5, 0.24, 3), nrm = new THREE.Vector3().crossVectors(d, up).normalize();
      strip(rach, [0.006, 0.016, 0.014, 0.004], [side, side, side, side], cG.clone().multiplyScalar(0.85), cG); strip(rach, [0.006, 0.014, 0.012, 0.004], [up, up, up, up].map(() => nrm.clone().cross(d).normalize()), cG.clone().multiplyScalar(0.8), cG); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const N = g.attributes.normal; for (let i = 0; i < N.count; i++) { const v = new THREE.Vector3(N.getX(i), Math.abs(N.getY(i)) + 0.7, N.getZ(i)).normalize(); N.setXYZ(i, v.x, v.y, v.z); } // soft, sky-lit leaves
  return g;
}
// a raster of the fields (1 m), a little inside each outline so the bunds stay free
export function buildFieldMask(world, fields) {
  if (!fields || !fields.length) { FARM.mask = null; return; } const D = world.D, F = world.F, res = 1, w = Math.ceil(D.W / res), h = Math.ceil(D.H / res);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 0.9 / res; g.lineJoin = 'round';
  for (const f of fields) { g.beginPath(); f.ring.forEach(([lo, la], k) => { const x = (F.x(lo) - D.X0) / res, y = (F.z(la) - D.Z0) / res; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke(); }
  const im = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = im[i * 4] > 128 ? 1 : 0;
  FARM.mask = { m, w, h, x0: D.X0, z0: D.Z0, res, at: (x, z) => { const i = ((x - D.X0) / res) | 0, j = ((z - D.Z0) / res) | 0; return i >= 0 && j >= 0 && i < w && j < h ? m[j * w + i] : 0; } };
}
// flooded paddies at planting time: a water sheet in every field
export function paddyWater(world, fields) {
  const F = world.F, pos = [], idx = []; let v = 0;
  for (const f of fields || []) { const pts = f.ring.map(([lo, la]) => new THREE.Vector2(F.x(lo), F.z(la))); if (pts.length < 3) continue; const hs = pts.map(p => world.groundAt(p.x, p.y)).sort((a, b) => a - b), cx = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length, cz = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length; let y = Math.max(hs[Math.floor(hs.length * 0.8)], world.groundAt(cx, cz)) + 0.05; // flat water a little above the ground
    let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { continue; } for (const p of pts) pos.push(p.x, y, p.y); for (const t of tri) idx.push(v + t[0], v + t[2], v + t[1]); v += pts.length; }
  if (!v) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6d8f96, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78, polygonOffset: true, polygonOffsetFactor: -2 })); m.receiveShadow = true; m.renderOrder = 2; return m;
}
// straw stacks beside the farmhouses after the harvest
export function hayStacks(world) {
  const D = world.D, houses = [...(world.housesList || []), ...(D.buildings || []).filter(b => (b.t || 0) < 3)], r = mulberry(11), pts = [];
  for (const b of houses) { if (r() > 0.35) continue; const R = b.ring, cx = R.reduce((s, p) => s + (p[0] ?? p.x), 0) / R.length, cz = R.reduce((s, p) => s + (p[1] ?? p.z), 0) / R.length, a = r() * 6.28, d = 7 + r() * 5, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (x < D.X0 || z < D.Z0 || x > D.X0 + D.W || z > D.Z0 + D.H) continue; if (D.exclude && D.exclude[Math.min(D.mh - 1, ((z - D.Z0) / D.MR) | 0) * D.mw + Math.min(D.mw - 1, ((x - D.X0) / D.MR) | 0)]) continue; pts.push([x, z, 0.8 + r() * 0.5, r() * 6.28]); if (pts.length > 1500) break; }
  if (!pts.length) return null;
  const geo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), P = geo.attributes.position, cols = []; const c0 = new THREE.Color(0xc9a45a), c1 = new THREE.Color(0x8d6a33);
  for (let i = 0; i < P.count; i++) { const y = P.getY(i), k = 1 + (Math.sin(P.getX(i) * 9) * Math.cos(P.getZ(i) * 7)) * 0.05; P.setXYZ(i, P.getX(i) * 2 * k, y * 2.8 * (1 + 0.15 * (1 - y)), P.getZ(i) * 2 * k); const c = c1.clone().lerp(c0, 0.4 + y * 0.6); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), pts.length), d = new THREE.Object3D();
  pts.forEach(([x, z, s, rot], i) => { d.position.set(x, world.groundAt(x, z) - 0.1, z); d.rotation.set(0, rot, 0); d.scale.set(s, s * (0.9 + r() * 0.3), s); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.castShadow = m.receiveShadow = true; return m;
}
// earth bunds: a low ridge along each field outline, rising outwards to meet the neighbour's half
export function bundGeometry(world, fields) {
  const F = world.F, pos = [], col = [], idx = []; let v = 0; const prof = [[0, -0.02], [0.32, 0.27], [0.72, 0.3], [1.05, 0.3], [1.2, -0.05]], earth = new THREE.Color(0x7a5a38), top = new THREE.Color(0x6f8536);
  for (const f of fields || []) { const R = f.ring.map(([lo, la]) => [F.x(lo), F.z(la)]); if (R.length < 3) continue; let a2 = 0; for (let k = 0, j = R.length - 1; k < R.length; j = k++) a2 += R[j][0] * R[k][1] - R[k][0] * R[j][1]; const sgn = a2 > 0 ? 1 : -1; // outward side
    const pts = []; for (let k = 0; k <= R.length; k++) { const a = R[k % R.length], b = R[(k + 1) % R.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2)); if (k === R.length) { pts.push(a); break; } for (let q = 0; q < n; q++) pts.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]); }
    const base = v; pts.forEach((p, k) => { const A = pts[Math.max(0, k - 1)], B = pts[Math.min(pts.length - 1, k + 1)], tx = B[0] - A[0], tz = B[1] - A[1], L = Math.hypot(tx, tz) || 1, nx = -tz / L * -sgn, nz = tx / L * -sgn;
      for (const [o, hgt] of prof) { const x = p[0] + nx * o, z = p[1] + nz * o; pos.push(x, world.groundAt(x, z) + hgt, z); const c = earth.clone().lerp(top, Math.max(0, hgt) / 0.3 * (0.6 + 0.4 * Math.sin(x * 1.7 + z * 2.3) ** 2)); col.push(c.r, c.g, c.b); } });
    const np = prof.length; for (let k = 0; k < pts.length - 1; k++) for (let q = 0; q < np - 1; q++) { const a = base + k * np + q, b = a + np; idx.push(a, b, a + 1, a + 1, b, b + 1); } v += pts.length * np; }
  if (!v) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })); m.receiveShadow = m.castShadow = true; return m;
}
