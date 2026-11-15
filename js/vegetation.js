// Trees (several species + palms + bushes) placed from imagery canopy, and a near-camera
// field of 3D grass / rice clumps that follows the viewer.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './geo.js';
import { makeGrassMaterial } from './shaders.js';

function blob(sx, sy, sz, y, seed, detail = 1) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail)), p = g.attributes.position, r = mulberry32(seed);
  for (let i = 0; i < p.count; i++) { const f = 0.8 + r() * 0.4; p.setXYZ(i, p.getX(i) * f * sx, p.getY(i) * f * sy + y, p.getZ(i) * f * sz); }
  g.computeVertexNormals(); return g;
}
function withColor(g, hex) {
  g = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
}
// canopy + trunk as one geometry: canopy vertex colour white (tinted per instance), trunk brown
function treeGeo(kind) {
  const trunkC = 0x9a8470, parts = [];
  if (kind === 'round') { parts.push(withColor(new THREE.CylinderGeometry(0.06, 0.1, 1.1, 5).translate(0, 0.55, 0), trunkC), withColor(blob(1, 0.8, 1, 1.45, 3), 0xffffff), withColor(blob(0.6, 0.5, 0.6, 1.95, 7, 0).translate(0.35, 0, 0.2), 0xf0f0f0)); }
  if (kind === 'tall') { parts.push(withColor(new THREE.CylinderGeometry(0.05, 0.09, 1.9, 5).translate(0, 0.95, 0), trunkC), withColor(blob(0.62, 1.15, 0.62, 2.35, 11), 0xffffff)); }
  if (kind === 'wide') { parts.push(withColor(new THREE.CylinderGeometry(0.07, 0.11, 1.2, 5).translate(0, 0.6, 0), trunkC), withColor(blob(1.45, 0.5, 1.45, 1.45, 17), 0xffffff), withColor(blob(0.8, 0.4, 0.8, 1.75, 19, 0).translate(-0.4, 0, 0.3), 0xe8e8e8)); }
  if (kind === 'bush') { parts.push(withColor(blob(1, 0.7, 1, 0.45, 23, 0), 0xffffff), withColor(blob(0.6, 0.5, 0.6, 0.35, 29, 0).translate(0.6, 0, 0.2), 0xe0e0e0)); }
  return mergeGeometries(parts);
}
function sugarPalm() {
  const parts = [withColor(new THREE.CylinderGeometry(0.2, 0.28, 11, 6).translate(0, 5.5, 0), 0x6f5d4c)];
  for (let k = 0; k < 16; k++) {
    const f = new THREE.ConeGeometry(1.25, 0.22, 7).rotateX(Math.PI / 2).translate(0, 0, 1.35);
    f.rotateX(-0.4 + (k % 3) * 0.38); f.rotateY(k / 16 * Math.PI * 2 + (k % 2) * 0.2); f.translate(0, 11.2, 0);
    parts.push(withColor(f, k % 2 ? 0x5d8a3a : 0x4b7a30));
  }
  return mergeGeometries(parts);
}
function coconut() {
  const parts = [], segs = 6; let x = 0, y = 0;
  for (let i = 0; i < segs; i++) { const h = 1.6, lean = 0.12 + i * 0.05; const c = new THREE.CylinderGeometry(0.15, 0.18, h, 6).translate(0, h / 2, 0).rotateZ(-lean).translate(x, y, 0); parts.push(withColor(c, 0x7d6a55)); x += Math.sin(lean) * h; y += Math.cos(lean) * h; }
  for (let k = 0; k < 11; k++) {
    const a = k / 11 * Math.PI * 2, f = new THREE.BoxGeometry(0.35, 0.04, 3.4).translate(0, 0, 1.7), p = f.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) - 0.12 * z * z); }
    f.rotateY(a); f.translate(x, y, 0); parts.push(withColor(f, k % 2 ? 0x5f8f3c : 0x4f7d32));
  }
  return mergeGeometries(parts);
}

export function buildTrees(ctx) {
  const { X0, Z0, W, H, C, gw, gh, cls, mask, mw, mh, MR, nearBuilt, pxAt, hAt, rnd, mobile } = ctx;
  const at = (raster, x, z) => raster[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
  const nTree = cls.reduce((a, v) => a + (v === 2), 0);
  const cap = mobile ? 26000 : 75000, pBase = Math.min(0.34, cap / Math.max(1, nTree));
  const lists = { round: [], tall: [], wide: [], bush: [], sugar: [], coco: [] };
  const block = (x, z) => { const h = Math.sin(Math.floor(x / 35) * 12.9898 + Math.floor(z / 35) * 78.233) * 43758.5453; return h - Math.floor(h); };
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const k = cls[j * gw + i]; if (k !== 2 && k !== 3) continue;
    const x = X0 + (i + rnd()) * C, z = Z0 + (j + rnd()) * C;
    if (at(mask, x, z)) continue;
    let nb = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (cls[(j + a) * gw + i + b] === 2) nb++;
    const nb2 = nearBuilt(x, z);
    if (k === 3) { if (nb >= 2 && nb <= 5 && rnd() < 0.05) lists.bush.push([x, z, 0.8 + rnd() * 0.8]); continue; }
    if (nb <= 3) { if (rnd() < 0.5) (nb2 ? lists.coco : lists.sugar).push([x, z, 0.8 + rnd() * 0.4]); continue; }
    if (rnd() > pBase * (nb >= 8 ? 1 : 0.7)) continue;
    if (nb2 && rnd() < 0.25) { lists.coco.push([x, z, 0.8 + rnd() * 0.4]); continue; }
    const b = block(x, z), s = 2.3 + rnd() * 1.8 + (nb >= 8 ? 1.0 : 0);
    const kind = b < 0.5 ? 'round' : b < 0.75 ? 'wide' : 'tall';
    lists[kind].push([x, z, s]);
    if (nb < 7 && rnd() < 0.3) lists.bush.push([x + (rnd() - .5) * 3, z + (rnd() - .5) * 3, 0.8 + rnd()]);
  }
  const geos = { round: treeGeo('round'), tall: treeGeo('tall'), wide: treeGeo('wide'), bush: treeGeo('bush'), sugar: sugarPalm(), coco: coconut() };
  const meshes = [], d = new THREE.Object3D(), col = new THREE.Color();
  for (const [kind, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const tinted = kind !== 'sugar' && kind !== 'coco';
    const im = new THREE.InstancedMesh(geos[kind], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: tinted, side: tinted ? THREE.FrontSide : THREE.DoubleSide }), list.length);
    list.forEach(([x, z, s], k) => {
      d.position.set(x, hAt(x, z) - 0.15, z); d.rotation.set(0, rnd() * 6.28, (kind === 'coco') ? 0 : (rnd() - .5) * 0.06);
      if (tinted) d.scale.set(s * (0.9 + rnd() * 0.2), s * (0.85 + rnd() * 0.4), s * (0.9 + rnd() * 0.2)); else d.scale.setScalar(s);
      d.updateMatrix(); im.setMatrixAt(k, d.matrix);
      if (tinted) {
        const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        const hsl = {}; col.getHSL(hsl);
        // keep the image's hue but push it into a believable foliage range
        const h = THREE.MathUtils.clamp(hsl.h, 0.17, 0.36), sat = THREE.MathUtils.clamp(hsl.s * 1.2, 0.25, 0.65), l = THREE.MathUtils.clamp(hsl.l * 1.35, 0.14, 0.42);
        col.setHSL(h + (rnd() - .5) * 0.03, sat, l * (kind === 'bush' ? 1.1 : 1));
        im.setColorAt(k, col);
      }
    });
    im.castShadow = true; im.receiveShadow = true; meshes.push(im);
  }
  return { meshes, counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])) };
}

/* ---------- near-camera grass and rice ---------- */
function bladeTuft(nBlades, h, w, bend, seed, base, tip) {
  const r = mulberry32(seed), pos = [], colr = [], cb = new THREE.Color(base), ct = new THREE.Color(tip);
  for (let i = 0; i < nBlades; i++) {
    const a = r() * Math.PI * 2, rad = r() * 0.07, x0 = Math.cos(a) * rad, z0 = Math.sin(a) * rad, hh = h * (0.7 + r() * 0.5);
    const lean = (r() - 0.3) * bend, la = r() * Math.PI * 2, tx = x0 + Math.cos(la) * lean * hh, tz = z0 + Math.sin(la) * lean * hh;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const mx = (x0 + tx) / 2 + Math.cos(la) * lean * 0.15, mz = (z0 + tz) / 2 + Math.sin(la) * lean * 0.15;
    // two triangles: base quad to mid, mid to tip
    pos.push(x0 - px, 0, z0 - pz, x0 + px, 0, z0 + pz, mx + px * 0.6, hh * 0.55, mz + pz * 0.6,
      x0 - px, 0, z0 - pz, mx + px * 0.6, hh * 0.55, mz + pz * 0.6, mx - px * 0.6, hh * 0.55, mz - pz * 0.6,
      mx - px * 0.6, hh * 0.55, mz - pz * 0.6, mx + px * 0.6, hh * 0.55, mz + pz * 0.6, tx, hh, tz);
    const cm = cb.clone().lerp(ct, 0.55);
    for (const c of [cb, cb, cm, cb, cm, cm, cm, cm, ct]) colr.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeVertexNormals();
  // bias normals upward so blades light like a canopy, not flat cards
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { n.setY(i, Math.abs(n.getY(i)) + 0.8); } g.normalizeNormals?.();
  const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) { const v = new THREE.Vector3(nn.getX(i), nn.getY(i), nn.getZ(i)).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
  return g;
}

export class GrassField {
  constructor(ctx, uTime, mobile) {
    this.ctx = ctx; this.group = new THREE.Group();
    const mat = makeGrassMaterial({ uTime });
    this.N = mobile ? 14000 : 42000;
    this.grass = new THREE.InstancedMesh(bladeTuft(9, 0.38, 0.022, 0.4, 1, 0x4a6a2a, 0xb9d47a), mat, this.N);
    this.rice = new THREE.InstancedMesh(bladeTuft(11, 0.7, 0.016, 0.16, 2, 0x4c7a2c, 0xc4de7c), mat, this.N);
    for (const m of [this.grass, this.rice]) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); }
    this.center = new THREE.Vector3(1e9, 0, 1e9);
  }
  update(target, camDist) {
    const show = camDist < 260; this.group.visible = show; if (!show) return;
    if (target.distanceTo(this.center) < 5) return;
    this.center.copy(target);
    const { X0, Z0, W, H, C, gw, cls, splatRice, mask, mw, mh, MR, pxAt, hAt } = this.ctx;
    const R = Math.min(48, Math.sqrt(this.N * 0.16 / Math.PI));
    const d = new THREE.Object3D(), col = new THREE.Color();
    let ng = 0, nr = 0;
    const sp = 0.42, i0 = Math.floor((target.x - R) / sp), i1 = Math.ceil((target.x + R) / sp), j0 = Math.floor((target.z - R) / sp), j1 = Math.ceil((target.z + R) / sp);
    const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (ng >= this.N && nr >= this.N) break;
      const rx = i * sp, rz = j * sp, dd = (rx - target.x) ** 2 + (rz - target.z) ** 2; if (dd > R * R) continue;
      if (rx < X0 || rz < Z0 || rx > X0 + W || rz > Z0 + H) continue;
      const ci = Math.min(gw - 1, ((rx - X0) / C) | 0), cj = ((rz - Z0) / C) | 0, k = cls[cj * gw + ci];
      if (mask[Math.min(mh - 1, ((rz - Z0) / MR) | 0) * mw + Math.min(mw - 1, ((rx - X0) / MR) | 0)]) continue;
      const hs = hash(i, j), fade = 1 - Math.sqrt(dd) / R;
      const isRice = k === 3 && splatRice[cj * gw + ci] > 0;
      if (isRice) {
        if (nr >= this.N) continue;
        const x = rx + (hs - .5) * 0.04, z = rz + (hash(j, i) - .5) * 0.04;
        d.position.set(x, hAt(x, z) - 0.02, z); d.rotation.set(0, hs * 6.28, 0); d.scale.setScalar((0.8 + hs * 0.35) * (0.6 + 0.4 * fade)); d.updateMatrix();
        this.rice.setMatrixAt(nr, d.matrix);
        const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(1.6); this.rice.setColorAt(nr, col); nr++;
      } else {
        const dens = k === 3 ? 0.95 : k === 2 ? 0.55 : k === 4 ? 0.15 : k === 5 ? 0.12 : 0;
        if (hs > dens || ng >= this.N) continue;
        const x = rx + (hash(i + 7, j) - .5) * sp, z = rz + (hash(i, j + 7) - .5) * sp;
        d.position.set(x, hAt(x, z) - 0.02, z); d.rotation.set(0, hs * 40, 0); d.scale.setScalar((0.7 + hash(i + 3, j) * 0.7) * (0.55 + 0.45 * fade)); d.updateMatrix();
        this.grass.setMatrixAt(ng, d.matrix);
        const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(1.7); this.grass.setColorAt(ng, col); ng++;
      }
    }
    this.grass.count = ng; this.rice.count = nr;
    for (const m of [this.grass, this.rice]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
