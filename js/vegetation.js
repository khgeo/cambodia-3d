// Trees (leafy species, sugar & coconut palms, bushes) placed from imagery canopy, and a near-camera
// field of grass, rice and forest understory that follows the viewer.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js?v=92';
import { mulberry32 } from './geo.js?v=92';
import { makeGrassMaterial } from './shaders.js?v=92';
import { foliageTextures, sugarPalmGeo, leafyTree, understoryKit } from './foliage.js?v=92';
import { FARM, riceHill, sennaGeo, bananaGeo, lilyGeo } from './ricefield.js?v=92';

let TEX = null;
const texs = () => TEX || (TEX = foliageTextures());
function leafMat(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
  m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  return m;
}
const solidMat = (side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side });
function inst(geo, mat, n, cast = true) {
  const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = cast; m.receiveShadow = true;
  if (mat.userData.depth) m.customDepthMaterial = mat.userData.depth; return m;
}

function coconut() {
  const parts = [], col = (g, hex) => { g = g.toNonIndexed(); const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) { const h = 1.6, lean = 0.12 + i * 0.05; parts.push(col(new THREE.CylinderGeometry(0.15, 0.18, h, 6).translate(0, h / 2, 0).rotateZ(-lean).translate(x, y, 0), 0x7d6a55)); x += Math.sin(lean) * h; y += Math.cos(lean) * h; }
  for (let k = 0; k < 13; k++) {
    const f = new THREE.BoxGeometry(0.5, 0.03, 3.6, 1, 1, 6).translate(0, 0, 1.8), p = f.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) + 0.35 * z - 0.16 * z * z); p.setX(i, p.getX(i) * (1 - z / 4.2)); }
    f.rotateY(k / 13 * Math.PI * 2 + (k % 2) * 0.2); f.translate(x, y, 0); parts.push(col(f, k % 2 ? 0x5f8f3c : 0x4f7d32));
  }
  return mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }));
}

export function buildTrees(ctx) {
  const { X0, Z0, C, gw, gh, cls, mask, mw, mh, MR, nearBuilt, pxAt, hAt, rnd, mobile } = ctx, palmOK = ctx.palmOK || (() => true);
  const at = (raster, x, z) => raster[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
  const nTree = cls.reduce((a, v) => a + (v === 2), 0);
  const cap = mobile ? 20000 : 42000, palmCap = mobile ? 1200 : 2600;
  const pBase = Math.min(0.3, cap / Math.max(1, nTree));
  const L = { round: [], tall: [], wide: [], bush: [], sugarA: [], sugarB: [], coco: [] };
  const block = (x, z) => { const h = Math.sin(Math.floor(x / 35) * 12.9898 + Math.floor(z / 35) * 78.233) * 43758.5453; return h - Math.floor(h); };
  let palms = 0;
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const k = cls[j * gw + i]; if (k !== 2 && k !== 3) continue;
    const x = X0 + (i + rnd()) * C, z = Z0 + (j + rnd()) * C;
    if (at(mask, x, z)) continue;
    let nb = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (cls[(j + a) * gw + i + b] === 2) nb++;
    const village = nearBuilt(x, z);
    if (k === 3) { if (nb >= 2 && nb <= 5 && rnd() < 0.05) L.bush.push([x, z, 0.9 + rnd() * 1.2]); continue; }
    if (nb <= 3) { // isolated canopy in open land: palms (sugar palms in fields, coconuts by houses)
      if (!palmOK(x, z)) { if (rnd() < 0.5) L.round.push([x, z, 2.0 + rnd() * 1.5]); continue; } // forest/hills: no palms
      if (palms < palmCap && rnd() < 0.55) { palms++; (village ? L.coco : (rnd() < 0.5 ? L.sugarA : L.sugarB)).push([x, z, village ? 0.85 + rnd() * 0.35 : 0.8 + rnd() * 0.5]); }
      continue;
    }
    if (rnd() > pBase * (nb >= 8 ? 1 : 0.7)) continue;
    if (village && palms < palmCap && rnd() < 0.2 && palmOK(x, z)) { palms++; L.coco.push([x, z, 0.85 + rnd() * 0.35]); continue; }
    const b = block(x, z), s = 2.4 + rnd() * 1.8 + (nb >= 8 ? 1.1 : 0);
    L[b < 0.5 ? 'round' : b < 0.75 ? 'wide' : 'tall'].push([x, z, s]);
    if (nb < 7 && rnd() < 0.3) L.bush.push([x + (rnd() - .5) * 3, z + (rnd() - .5) * 3, 0.9 + rnd() * 1.2]);
  }
  return { meshes: instTrees(L, ctx), counts: { round: L.round.length, tall: L.tall.length, wide: L.wide.length, bush: L.bush.length, sugar: L.sugarA.length + L.sugarB.length, coco: L.coco.length } };
}
// instanced tree meshes for lists of [x, z, scale] per kind (used for the image-derived forest and for trees the user plants)
export function instTrees(L, ctx) {
  const { hAt, pxAt } = ctx, rnd = ctx.rnd || Math.random;
  const T = texs(), U = understoryKit();
  const kinds = {
    round: leafyTree('round', 3), tall: leafyTree('tall', 11), wide: leafyTree('wide', 17),
    bush: { leaves: U.shrub.leaves },
    sugarA: { solidDS: sugarPalmGeo(1) }, sugarB: { solidDS: sugarPalmGeo(2) }, coco: { solidDS: coconut() },
  };
  const meshes = [], d = new THREE.Object3D(), col = new THREE.Color(), ref = new THREE.Color(0x4f7d32);
  const lm = leafMat(T.leaf), sm = solidMat(), sds = solidMat(THREE.DoubleSide), cm = solidMat();
  for (const [kind, list] of Object.entries(L)) {
    if (!list || !list.length) continue;
    const g = kinds[kind], parts = [], tint = [];
    if (g.solid) parts.push(inst(g.solid, sm, list.length));
    if (g.core) { const m = inst(g.core, cm, list.length); parts.push(m); tint.push(m); }
    if (g.leaves) { const m = inst(g.leaves, lm, list.length, kind !== 'bush'); parts.push(m); tint.push(m); }
    if (g.solidDS) parts.push(inst(g.solidDS, sds, list.length));
    list.forEach(([x, z, s], k) => {
      const palm = kind.startsWith('sugar') || kind === 'coco';
      d.position.set(x, hAt(x, z) - 0.15, z); d.rotation.set(0, rnd() * 6.28, palm ? 0 : (rnd() - .5) * 0.06);
      if (!palm) d.scale.set(s * (0.9 + rnd() * 0.2), s * (0.85 + rnd() * 0.4), s * (0.9 + rnd() * 0.2)); else d.scale.setScalar(s);
      d.updateMatrix(); for (const m of parts) m.setMatrixAt(k, d.matrix);
      if (tint.length) {
        const [r, gg, b] = pxAt(x, z); col.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);
        const hsl = {}; col.getHSL(hsl); col.setHSL(THREE.MathUtils.clamp(hsl.h, 0.17, 0.36), THREE.MathUtils.clamp(hsl.s * 1.2, 0.25, 0.65), THREE.MathUtils.clamp(hsl.l * 1.35, 0.14, 0.42));
        const cl = v => THREE.MathUtils.clamp(v, 0.6, 1.5), f = 0.9 + rnd() * 0.25;
        const t = new THREE.Color(cl(0.55 + 0.45 * col.r / ref.r) * f, cl(0.55 + 0.45 * col.g / ref.g) * f, cl(0.55 + 0.45 * col.b / ref.b) * f);
        for (const m of tint) m.setColorAt(k, t);
      }
    });
    meshes.push(...parts);
  }
  return meshes;
}

/* ---------- near-camera grass, rice and forest understory ---------- */
function bladeTuft(nBlades, h, w, bend, seed, base, tip) {
  const r = mulberry32(seed), pos = [], colr = [], cb = new THREE.Color(base), ct = new THREE.Color(tip);
  for (let i = 0; i < nBlades; i++) {
    const a = r() * Math.PI * 2, rad = r() * 0.07, x0 = Math.cos(a) * rad, z0 = Math.sin(a) * rad, hh = h * (0.7 + r() * 0.5);
    const lean = (r() - 0.3) * bend, la = r() * Math.PI * 2, tx = x0 + Math.cos(la) * lean * hh, tz = z0 + Math.sin(la) * lean * hh;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w, mx = (x0 + tx) / 2 + Math.cos(la) * lean * 0.15, mz = (z0 + tz) / 2 + Math.sin(la) * lean * 0.15;
    pos.push(x0 - px, 0, z0 - pz, x0 + px, 0, z0 + pz, mx + px * 0.6, hh * 0.55, mz + pz * 0.6, x0 - px, 0, z0 - pz, mx + px * 0.6, hh * 0.55, mz + pz * 0.6, mx - px * 0.6, hh * 0.55, mz - pz * 0.6,
      mx - px * 0.6, hh * 0.55, mz - pz * 0.6, mx + px * 0.6, hh * 0.55, mz + pz * 0.6, tx, hh, tz);
    const cm = cb.clone().lerp(ct, 0.55); for (const c of [cb, cb, cm, cb, cm, cm, cm, cm, ct]) colr.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeVertexNormals(); const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(n.getX(i), Math.abs(n.getY(i)) + 0.8, n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
const RICE = new THREE.Color(0x9cc25a), GRASS = new THREE.Color(0xa8b870), WHITE = new THREE.Color(1, 1, 1);
export const SEASON = { col: null, h: 1, kind: 'image' }; // rice stage set from the scene panel

export class GrassField {
  constructor(ctx, uTime, mobile) {
    this.ctx = ctx; this.group = new THREE.Group();
    const mat = makeGrassMaterial({ uTime });
    this.N = mobile ? 14000 : 42000;
    this.grass = new THREE.InstancedMesh(bladeTuft(9, 0.34, 0.022, 0.45, 1, 0x5f7f36, 0xd0e092), mat, this.N);
    this.riceMat = mat; this.riceKind = 'vegetative'; this.rice = new THREE.InstancedMesh(riceHill('vegetative', 3), mat, this.N); // real rice hills (from Terrain to Blender)
    for (const m of [this.grass, this.rice]) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); }
    // forest understory pools
    const T = texs(), U = understoryKit(), sc = mobile ? 0.5 : 1;
    const mk = (geo, mat, N) => { const m = new THREE.InstancedMesh(geo, mat, N); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); return m; };
    const lm = { leaf: leafMat(T.leaf), frond: leafMat(T.frond), lance: leafMat(T.lance) }, sm = solidMat(), sds = solidMat(THREE.DoubleSide);
    this.under = {};
    const pools = { fern: 1600, shrub: 900, sapling: 350, bamboo: 140, fanpalm: 500, rock: 120, log: 50 };
    for (const [k, N0] of Object.entries(pools)) {
      const u = U[k], parts = [], N = Math.ceil(N0 * sc);
      if (u.leaves) parts.push(mk(u.leaves, lm[u.tex], N));
      if (u.solid) parts.push(mk(u.solid, k === 'fanpalm' ? sds : sm, N));
      this.under[k] = { parts, cap: N };
    }
    for (const m of [...this.under.sapling.parts, ...this.under.bamboo.parts]) { m.castShadow = true; if (m.material.userData.depth) m.customDepthMaterial = m.material.userData.depth; }
    // wayside plants: candle bush on the verges, bananas by the houses, water lilies on ponds and ditches
    const vm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const ex = (geo, N) => ({ parts: [mk(geo, vm, N)], cap: N }); this.extra = { senna: ex(sennaGeo(), Math.ceil(260 * sc)), banana: ex(bananaGeo(), Math.ceil(160 * sc)), lily: ex(lilyGeo(), Math.ceil(220 * sc)) };
    for (const k in this.extra) this.extra[k].parts[0].castShadow = k !== 'lily';
    this.center = new THREE.Vector3(1e9, 0, 1e9);
  }
  update(target, camDist) {
    const show = camDist < 260; this.group.visible = show; if (!show) return;
    if (target.distanceTo(this.center) < 5) return;
    this.center.copy(target);
    const { X0, Z0, W, H, C, gw, gh, cls, splatRice, mask, mw, mh, MR, pxAt, hAt } = this.ctx;
    const R = Math.min(48, Math.sqrt(this.N * 0.16 / Math.PI)), d = new THREE.Object3D(), col = new THREE.Color();
    const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
    const cellK = (x, z) => cls[Math.min(gh - 1, Math.max(0, ((z - Z0) / C) | 0)) * gw + Math.min(gw - 1, Math.max(0, ((x - X0) / C) | 0))];
    const masked = (x, z) => mask[Math.min(mh - 1, ((z - Z0) / MR) | 0) * mw + Math.min(mw - 1, ((x - X0) / MR) | 0)];
    const inside = (x, z) => x > X0 && z > Z0 && x < X0 + W && z < Z0 + H;
    let ng = 0, nr = 0; const FM = FARM.mask, kind = SEASON.kind === 'image' ? 'vegetative' : SEASON.kind;
    if (kind !== this.riceKind) { this.riceKind = kind; const g = this.rice.geometry; this.rice.geometry = riceHill(kind, 3); g.dispose(); }
    // rice hills in rows, 25 cm apart, inside the mapped fields (or the rice cells of the land cover)
    { const sr = 0.25, Rr = Math.min(R, Math.sqrt(this.N * sr * sr / Math.PI)), tint = SEASON.kind !== 'image';
      for (let j = Math.floor((target.z - Rr) / sr); j <= Math.ceil((target.z + Rr) / sr) && nr < this.N; j++) for (let i = Math.floor((target.x - Rr) / sr); i <= Math.ceil((target.x + Rr) / sr) && nr < this.N; i++) {
        const rx = i * sr, rz = j * sr, dd = (rx - target.x) ** 2 + (rz - target.z) ** 2; if (dd > Rr * Rr || !inside(rx, rz) || masked(rx, rz)) continue;
        if (FM) { if (!FM.at(rx, rz)) continue; } else { const ci = Math.min(gw - 1, ((rx - X0) / C) | 0), cj = ((rz - Z0) / C) | 0; if (!(cls[cj * gw + ci] === 3 && splatRice[cj * gw + ci] > 0)) continue; }
        const hs = hash(i, j), fade = 1 - Math.sqrt(dd) / Rr, x = rx + (hs - .5) * 0.05, z = rz + (hash(j, i) - .5) * 0.05, sc = (0.85 + hs * 0.3) * (0.7 + 0.3 * fade);
        d.position.set(x, hAt(x, z) - (SEASON.kind === 'seedling' ? 0 : 0.02), z); d.rotation.set(0, hs * 6.28, 0); d.scale.set(sc, sc * (0.9 + hash(i + 1, j) * 0.2), sc); d.updateMatrix(); this.rice.setMatrixAt(nr, d.matrix);
        if (tint) { col.setScalar(0.85 + hash(i, j + 3) * 0.3); const fid = FM ? FM.at(rx, rz) : 0; if (fid) { const q = hash(fid * 0.37, fid * 1.91); col.r *= 0.82 + q * 0.3; col.b *= 0.75 + q * 0.4; } } else { const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(2.6).lerp(WHITE, 0.35); }
        this.rice.setColorAt(nr, col); nr++; } }
    const sp = 0.42, i0 = Math.floor((target.x - R) / sp), i1 = Math.ceil((target.x + R) / sp), j0 = Math.floor((target.z - R) / sp), j1 = Math.ceil((target.z + R) / sp);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (ng >= this.N && nr >= this.N) break;
      const rx = i * sp, rz = j * sp, dd = (rx - target.x) ** 2 + (rz - target.z) ** 2; if (dd > R * R || !inside(rx, rz) || masked(rx, rz)) continue;
      const ci = Math.min(gw - 1, ((rx - X0) / C) | 0), cj = ((rz - Z0) / C) | 0, k = cls[cj * gw + ci], hs = hash(i, j), fade = 1 - Math.sqrt(dd) / R;
      if (FM ? FM.at(rx, rz) : (k === 3 && splatRice[cj * gw + ci] > 0)) continue; // rice is placed above
      {
        const verge = masked(rx + 1.6, rz) || masked(rx - 1.6, rz) || masked(rx, rz + 1.6) || masked(rx, rz - 1.6), dens = verge ? 1 : k === 3 ? 0.95 : k === 2 ? 0.45 : k === 4 ? 0.15 : k === 5 ? 0.12 : 0.3;
        if (hs > dens || ng >= this.N) continue;
        const x = rx + (hash(i + 7, j) - .5) * sp, z = rz + (hash(i, j + 7) - .5) * sp;
        d.position.set(x, hAt(x, z) - 0.02, z); d.rotation.set(0, hs * 40, 0); d.scale.setScalar((0.7 + hash(i + 3, j) * 0.7) * (0.55 + 0.45 * fade) * (verge ? 1.9 : 1)); d.updateMatrix(); this.grass.setMatrixAt(ng, d.matrix);
        const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(2.2).lerp(GRASS, 0.3); this.grass.setColorAt(ng, col); ng++;
      }
    }
    this.grass.count = ng; this.rice.count = nr;
    // understory inside tree canopy cells (forest floor), bamboo in patches
    const cnt = {}; for (const k in this.under) cnt[k] = 0;
    const put = (k, x, z, s, rot) => {
      const u = this.under[k]; if (cnt[k] >= u.cap) return;
      d.position.set(x, hAt(x, z) - 0.05, z); d.rotation.set(0, rot, 0); d.scale.setScalar(s); d.updateMatrix();
      const [r, g, b] = pxAt(x, z); col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(1.6).lerp(WHITE, 0.55);
      for (const m of u.parts) { m.setMatrixAt(cnt[k], d.matrix); if (m.material.map) m.setColorAt(cnt[k], col); }
      cnt[k]++;
    };
    const R2 = Math.min(40, R * 0.85), sp2 = 1.5;
    for (let j = Math.floor((target.z - R2) / sp2); j <= Math.ceil((target.z + R2) / sp2); j++) for (let i = Math.floor((target.x - R2) / sp2); i <= Math.ceil((target.x + R2) / sp2); i++) {
      const hs = hash(i * 3.1, j * 1.7), x = i * sp2 + (hash(i, j * 5) - .5) * sp2, z = j * sp2 + (hash(i * 5, j) - .5) * sp2;
      if ((x - target.x) ** 2 + (z - target.z) ** 2 > R2 * R2 || !inside(x, z) || masked(x, z)) continue;
      const k = cellK(x, z), rot = hs * 40;
      if (k === 2) {
        const bb = hash(Math.floor(x / 25), Math.floor(z / 25));
        if (bb > 0.8 && hs < 0.12) put('bamboo', x, z, 0.8 + hs * 3, rot);
        else if (hs < 0.32) put('fern', x, z, 0.7 + hs * 1.4, rot);
        else if (hs < 0.5) put('shrub', x, z, 0.8 + hs * 1.2, rot);
        else if (hs < 0.58) put('fanpalm', x, z, 0.8 + hs * 0.8, rot);
        else if (hs < 0.66) put('sapling', x, z, 0.8 + hs * 0.6, rot);
        else if (hs < 0.675) put('rock', x, z, 0.5 + hs * 1.5, rot);
        else if (hs < 0.68) put('log', x, z, 0.7 + hs * 0.6, rot);
      } else if ((k === 3 || k === 4) && hs < 0.012) put('shrub', x, z, 0.8 + hs * 20, rot);
    }
    // wayside plants
    { const ec = { senna: 0, banana: 0, lily: 0 }, sp3 = 2.2, R3 = Math.min(45, R), wAt = this.ctx.waterAt;
      const putE = (k, x, y, z, s, rot) => { const e = this.extra[k]; if (ec[k] >= e.cap) return; d.position.set(x, y, z); d.rotation.set(0, rot, 0); d.scale.setScalar(s); d.updateMatrix(); e.parts[0].setMatrixAt(ec[k]++, d.matrix); };
      for (let j = Math.floor((target.z - R3) / sp3); j <= Math.ceil((target.z + R3) / sp3); j++) for (let i = Math.floor((target.x - R3) / sp3); i <= Math.ceil((target.x + R3) / sp3); i++) {
        const hs = hash(i * 1.3 + 0.7, j * 2.9 + 0.3), x = i * sp3 + (hash(i, j * 3) - .5) * sp3, z = j * sp3 + (hash(i * 3, j) - .5) * sp3; if ((x - target.x) ** 2 + (z - target.z) ** 2 > R3 * R3 || !inside(x, z)) continue;
        const k = cellK(x, z), rot = hs * 40;
        if (k === 1 && wAt && hs < 0.3) { const lv = wAt(x, z); if (lv != null) putE('lily', x, lv + 0.02, z, 0.7 + hs * 2, rot); continue; }
        if (masked(x, z) || (FM && FM.at(x, z))) continue;
        const verge = masked(x + 1.8, z) || masked(x - 1.8, z) || masked(x, z + 1.8) || masked(x, z - 1.8);
        if (verge && hs < 0.05) putE('senna', x, hAt(x, z) - 0.05, z, 0.8 + hs * 6, rot);
        else if (k === 5 && hs < 0.09) putE('banana', x, hAt(x, z) - 0.1, z, 0.8 + hs * 3, rot); }
      for (const k in this.extra) { const m = this.extra[k].parts[0]; m.count = ec[k]; m.instanceMatrix.needsUpdate = true; } }
    for (const k in this.under) for (const m of this.under[k].parts) { m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const m of [this.grass, this.rice]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
