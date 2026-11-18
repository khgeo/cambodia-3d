// Foliage kit: leaf textures (procedural, alpha-cut), sugar palm (Borassus) with fan leaves and a
// skirt of dead fronds, leafy trees made of alpha-tested leaf cards, and forest understory plants.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js?v=66';
import { mulberry32 } from './geo.js?v=66';

/* ---------------- textures ---------------- */
function tex(c, bleed = [70, 105, 45]) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) if (a[i + 3] < 8) { a[i] = bleed[0]; a[i + 1] = bleed[1]; a[i + 2] = bleed[2]; }
  const t = new THREE.DataTexture(new Uint8Array(a.buffer.slice(0)), c.width, c.height, THREE.RGBAFormat);
  t.flipY = true; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
function leafShape(ctx, x, y, len, wid, ang, col, rib) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(wid, len * 0.45, 0, len); ctx.quadraticCurveTo(-wid, len * 0.45, 0, 0); ctx.fillStyle = col; ctx.fill();
  if (rib) { ctx.strokeStyle = rib; ctx.lineWidth = Math.max(0.6, wid * 0.08); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len * 0.92); ctx.stroke(); }
  ctx.restore();
}
export function foliageTextures() {
  const r = mulberry32(77), S = 256;
  // broadleaf cluster: dense centre, ragged edge
  const a = document.createElement('canvas'); a.width = a.height = S; const ac = a.getContext('2d');
  const greens = ['#2f5523', '#3e6b2a', '#4f7d32', '#5f8c38', '#6f9a42', '#355f26'];
  for (let i = 0; i < 260; i++) {
    const rad = Math.pow(r(), 0.6) * S * 0.44, t = r() * Math.PI * 2, x = S / 2 + Math.cos(t) * rad, y = S / 2 + Math.sin(t) * rad;
    leafShape(ac, x, y, 24 + r() * 18, 9 + r() * 7, r() * Math.PI * 2, greens[(r() * greens.length) | 0], 'rgba(200,220,150,0.35)');
  }
  // pinnate frond (fern / rattan): rib bottom→top with paired leaflets
  const f = document.createElement('canvas'); f.width = 128; f.height = 256; const fc = f.getContext('2d');
  fc.strokeStyle = '#6b8a3a'; fc.lineWidth = 3; fc.beginPath(); fc.moveTo(64, 252); fc.lineTo(64, 6); fc.stroke();
  for (let y = 240; y > 10; y -= 9) {
    const k = 1 - Math.abs((y - 120) / 130), len = 14 + 40 * k;
    for (const s of [-1, 1]) leafShape(fc, 64, y, len, 5 + 3 * k, s * (1.25 - 0.2 * r()), greens[1 + ((r() * 4) | 0)], null);
  }
  // lanceolate spray (bamboo)
  const l = document.createElement('canvas'); l.width = l.height = S; const lc = l.getContext('2d');
  for (let i = 0; i < 45; i++) { const x = S * 0.5 + (r() - .5) * S * 0.6, y = S * 0.15 + r() * S * 0.7; leafShape(lc, x, y, 50 + r() * 30, 6 + r() * 3, Math.PI * (0.55 + r() * 0.9), ['#6f9a42', '#86a84a', '#5f8c38', '#9cb35a'][(r() * 4) | 0], null); }
  return { leaf: tex(a), frond: tex(f), lance: tex(l) };
}

/* ---------------- geometry helpers ---------------- */
class Builder {
  constructor() { this.p = []; this.c = []; this.u = []; }
  tri(a, b, c, ca, cb, cc, ua = [0, 0], ub = [1, 0], uc = [0, 1]) { this.p.push(...a, ...b, ...c); this.c.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); this.u.push(...ua, ...ub, ...uc); }
  quad(a, b, c, d, ca, cb, cc, cd, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) { this.tri(a, b, c, ca, cb, cc, uv[0], uv[1], uv[2]); this.tri(a, c, d, ca, cc, cd, uv[0], uv[2], uv[3]); }
  geo(normalsUp = 0) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeVertexNormals();
    if (normalsUp) { const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(n.getX(i), Math.abs(n.getY(i)) + normalsUp, n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); } }
    return g;
  }
}
const C = h => new THREE.Color(h);
function colored(g, hex, dark = 1) {
  g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, a = new Float32Array(n * 3), c = C(hex);
  const p = g.attributes.position; let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < n; i++) { const k = dark === 1 ? 1 : dark + (1 - dark) * (p.getY(i) - y0) / ((y1 - y0) || 1); a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return g;
}
const M = parts => mergeGeometries(parts);
// a leaf card centred at p, facing roughly along n, size s
function card(B, p, n, s, rnd, colTop, colBot, w = 1, h = 1) {
  const nn = new THREE.Vector3(...n).normalize(), up = Math.abs(nn.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(up, nn).normalize(), b = new THREE.Vector3().crossVectors(nn, t).normalize();
  const ang = rnd() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const u = t.clone().multiplyScalar(ca).addScaledVector(b, sa).multiplyScalar(s * w / 2), v = t.clone().multiplyScalar(-sa).addScaledVector(b, ca).multiplyScalar(s * h / 2);
  const P = new THREE.Vector3(...p), q = (x, y) => P.clone().addScaledVector(u, x).addScaledVector(v, y).toArray();
  B.quad(q(-1, -1), q(1, -1), q(1, 1), q(-1, 1), colBot, colBot, colTop, colTop);
}

/* ---------------- sugar palm (Borassus flabellifer) ---------------- */
function fan(B, base, dir, R, petiole, segs, spread, green, rnd, dead) {
  const d = new THREE.Vector3(...dir).normalize(), side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  const hub = new THREE.Vector3(...base).addScaledVector(d, petiole);
  // petiole
  const pc = dead ? C(0x7a5c3a) : C(0x8a9a4a), w = 0.05;
  const s0 = new THREE.Vector3(...base), q = (v, o) => v.clone().addScaledVector(side, o).toArray();
  B.quad(q(s0, -w), q(s0, w), q(hub, w), q(hub, -w), pc, pc, pc, pc);
  // fan: pleated wedges radiating from the hub, drooping toward the tips
  const cIn = dead ? C(0x8a6a42) : C(green).multiplyScalar(1.25), cOut = dead ? C(0x6e5434) : C(green);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const th = -spread / 2 + spread * i / segs, pleat = (i % 2 ? 0.07 : -0.07) * R, rr = R * (0.92 + rnd() * 0.12);
    const dirv = d.clone().multiplyScalar(Math.cos(th)).addScaledVector(side, Math.sin(th));
    const mid = hub.clone().addScaledVector(dirv, rr * 0.5).addScaledVector(up, pleat * 0.5 - (dead ? rr * 0.25 : 0.02 * rr));
    const tip = hub.clone().addScaledVector(dirv, rr).addScaledVector(up, pleat - (dead ? rr * 0.7 : rr * (0.18 + rnd() * 0.12)));
    pts.push([mid, tip]);
  }
  const h = hub.toArray();
  for (let i = 0; i < segs; i++) {
    const [m0, t0] = pts[i], [m1, t1] = pts[i + 1];
    B.tri(h, m0.toArray(), m1.toArray(), cIn, cIn, cIn);
    // split leaflet tips: each wedge ends in a narrow spike, leaving gaps between leaflets
    const tm = t0.clone().lerp(t1, 0.5), a0 = m0.clone().lerp(t0, 0.35), a1 = m1.clone().lerp(t1, 0.35);
    B.quad(m0.toArray(), a0.toArray(), a1.toArray(), m1.toArray(), cIn, cOut, cOut, cIn);
    B.tri(a0.toArray(), tm.toArray(), a1.toArray(), cOut, cOut, cOut);
  }
}
export function sugarPalmGeo(seed = 1, lod = 0) {
  const rnd = mulberry32(seed), B = new THREE.Vector3();
  const H = 16, bend = (rnd() - 0.5) * 0.8;
  // trunk with gentle curve, grey bark, darker base
  const trunk = new THREE.CylinderGeometry(0.21, 0.32, H, 7, 8, true).translate(0, H / 2, 0), tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + bend * (y / H) ** 2); }
  const trunkG = colored(trunk, 0x8d877c, 0.55);
  const fb = new Builder(), top = [bend, H, 0];
  const nG = lod ? 16 : 30, nD = lod ? 8 : 18, segs = lod ? 7 : 11;
  for (let k = 0; k < nG; k++) {
    const az = k * 2.39996 + rnd() * 0.2, el = THREE.MathUtils.degToRad(-25 + 110 * Math.pow(rnd(), 0.9));
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    fan(fb, top, dir, 1.5 + rnd() * 0.5, 1.5 + rnd() * 0.8, segs, THREE.MathUtils.degToRad(260 + rnd() * 50), [0x5d8a37, 0x6a9640, 0x557f33, 0x78a048, 0x4d7a2e][k % 5], rnd, false);
  }
  for (let k = 0; k < nD; k++) { // skirt of dry fronds hanging straight down from the crown base
    const az = k / nD * Math.PI * 2 + rnd() * 0.3, el = THREE.MathUtils.degToRad(-72 - rnd() * 14), base = [top[0] + Math.cos(az) * 0.25, H - 0.1, Math.sin(az) * 0.25];
    fan(fb, base, [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], 1.7 + rnd() * 0.6, 0.35, lod ? 4 : 6, THREE.MathUtils.degToRad(70), 0, rnd, true);
  }
  const crown = fb.geo(0.5);
  return M([trunkG, crown]);
}

/* ---------------- leafy trees: trunk + branches (solid) and leaf cards (alpha) ---------------- */
export function leafyTree(kind, seed) {
  const rnd = mulberry32(seed), solid = [], B = new Builder();
  const spec = { round: { h: 1.2, cy: 1.75, sx: 1, sy: 0.85, n: 22 }, tall: { h: 2.0, cy: 2.6, sx: 0.65, sy: 1.25, n: 20 }, wide: { h: 1.3, cy: 1.7, sx: 1.5, sy: 0.55, n: 26 } }[kind];
  solid.push(colored(new THREE.CylinderGeometry(0.055, 0.1, spec.h + 0.4, 5, 1, true).translate(0, (spec.h + 0.4) / 2, 0), 0x7d6a58, 0.6));
  for (let i = 0; i < 3; i++) { // branches into the crown
    const a = i * 2.1 + rnd(), l = 0.7 * spec.sx + 0.3, br = new THREE.CylinderGeometry(0.025, 0.045, l, 4, 1, true).translate(0, l / 2, 0);
    br.rotateZ(0.7 + rnd() * 0.3); br.rotateY(a); br.translate(0, spec.h * 0.85, 0); solid.push(colored(br, 0x6f5d4c));
  }
  // dark inner volume so gaps between cards read as deep foliage, not sky
  const core = mergeVertices(new THREE.IcosahedronGeometry(1, 0)), cp = core.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setXYZ(i, cp.getX(i) * spec.sx * 0.6, cp.getY(i) * spec.sy * 0.58 + spec.cy, cp.getZ(i) * spec.sx * 0.6);
  core.computeVertexNormals();
  const coreG = colored(core, 0x34502a, 0.6);
  const top = C(0xffffff), bot = C(0xa8b0a0);
  for (let i = 0; i < spec.n; i++) {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), n = [s * Math.cos(t), u * 0.9 + 0.15, s * Math.sin(t)];
    const p = [n[0] * spec.sx * 0.78, spec.cy + n[1] * spec.sy * 0.75, n[2] * spec.sx * 0.78];
    card(B, p, n, 1.15 + rnd() * 0.5, rnd, top, bot);
  }
  return { solid: M(solid), core: coreG, leaves: B.geo(0.6) };
}

/* ---------------- understory ---------------- */
export function understoryKit() {
  const rnd = mulberry32(5), W = C(0xffffff), D = C(0x9aa58a);
  // fern: arched pinnate fronds radiating from the ground
  const fern = new Builder();
  for (let k = 0; k < 8; k++) {
    const az = k / 8 * Math.PI * 2 + rnd() * 0.3, L = 0.9 + rnd() * 0.5, w = 0.2, ca = Math.cos(az), sa = Math.sin(az);
    const P = s => { const e = 0.9 - s * 1.5; return [ca * L * s * Math.cos(Math.max(-0.4, e) * 0.6) , 0.05 + Math.sin(Math.PI * s * 0.9) * 0.55 * L, sa * L * s * Math.cos(Math.max(-0.4, e) * 0.6)]; };
    for (let i = 0; i < 3; i++) {
      const s0 = i / 3, s1 = (i + 1) / 3, a = P(s0), b = P(s1), ox = -sa * w, oz = ca * w;
      fern.quad([a[0] - ox, a[1], a[2] - oz], [a[0] + ox, a[1], a[2] + oz], [b[0] + ox, b[1], b[2] + oz], [b[0] - ox, b[1], b[2] - oz], D, D, W, W, [[0, s0], [1, s0], [1, s1], [0, s1]]);
    }
  }
  // shrub: leaf cards around a small dome
  const shrub = new Builder();
  for (let i = 0; i < 9; i++) { const t = rnd() * 6.28, u = rnd() * 0.9, s = Math.sqrt(1 - u * u), n = [s * Math.cos(t), u + 0.1, s * Math.sin(t)]; card(shrub, [n[0] * 0.45, 0.45 + n[1] * 0.4, n[2] * 0.45], n, 0.75, rnd, W, D); }
  // sapling: thin stem with a few leaf cards on top
  const sap = new Builder();
  for (let i = 0; i < 5; i++) { const t = rnd() * 6.28, n = [Math.cos(t), 0.5 + rnd() * 0.5, Math.sin(t)]; card(sap, [n[0] * 0.35, 3.0 + rnd() * 0.8, n[2] * 0.35], n, 0.85, rnd, W, D); }
  const sapStem = colored(new THREE.CylinderGeometry(0.025, 0.045, 3.4, 4, 1, true).translate(0, 1.7, 0), 0x8a7a66, 0.7);
  // bamboo clump: arching culms + lance leaf sprays
  const bam = new Builder(), culms = [];
  for (let k = 0; k < 9; k++) {
    const az = rnd() * 6.28, lean = 0.08 + rnd() * 0.2, h = 6 + rnd() * 3, c = new THREE.CylinderGeometry(0.035, 0.05, h, 5, 4, true).translate(0, h / 2, 0), p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), off = lean * y + 0.04 * y * y / h; p.setX(i, p.getX(i) + Math.cos(az) * off); p.setZ(i, p.getZ(i) + Math.sin(az) * off); }
    culms.push(colored(c, 0x9aa25a, 0.75));
    for (let j = 0; j < 4; j++) { const y = h * (0.45 + 0.15 * j), off = lean * y + 0.04 * y * y / h; card(bam, [Math.cos(az) * (off + 0.4), y, Math.sin(az) * (off + 0.4)], [Math.cos(az), 0.3, Math.sin(az)], 1.5, rnd, W, D); }
  }
  // low fan palm (rattan / Licuala-like)
  const fp = new Builder();
  for (let k = 0; k < 7; k++) { const az = k * 0.9 + rnd(), el = 0.35 + rnd() * 0.6; fan(fp, [0, 0.1, 0], [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], 0.55, 0.6 + rnd() * 0.4, 7, 4.4, [0x4f7d32, 0x5f8c38][k % 2], rnd, false); }
  // rock and fallen log
  const rock = mergeVertices(new THREE.DodecahedronGeometry(1, 1)), rp = rock.attributes.position;
  for (let i = 0; i < rp.count; i++) { const f = 0.75 + rnd() * 0.45; rp.setXYZ(i, rp.getX(i) * f, rp.getY(i) * f * 0.65 + 0.3, rp.getZ(i) * f * 1.1); }
  rock.computeVertexNormals();
  const log = colored(new THREE.CylinderGeometry(0.22, 0.28, 5, 7).rotateZ(Math.PI / 2).translate(0, 0.2, 0), 0x6a5a45, 0.7);
  return {
    fern: { leaves: fern.geo(0.7), tex: 'frond' }, shrub: { leaves: shrub.geo(0.6), tex: 'leaf' }, sapling: { leaves: sap.geo(0.6), solid: sapStem, tex: 'leaf' },
    bamboo: { leaves: bam.geo(0.5), solid: M(culms), tex: 'lance' }, fanpalm: { solid: fp.geo(0.5) },
    rock: { solid: colored(rock, 0x8f8f86, 0.6) }, log: { solid: log },
  };
}
