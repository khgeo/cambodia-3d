// Constellation figures in the style of a planetarium: translucent drawings of the old figures (the hunter,
// the great bear …) laid on the sky through three anchor stars each, dotted stick figures with brighter dots on
// the stars, and the names of the brightest stars.
// Illustrations: Stellarium "modern" sky culture, Free Art License 1.3 (textures/constellations/LICENSE.txt).
// Positions: Hipparcos via d3-celestial (BSD-3).
import * as THREE from 'three';

let dataP = null; const TEX = new Map(), TL = new THREE.TextureLoader();
export function loadConArt() { return dataP || (dataP = fetch('data/constellation_art.json').then(r => r.json()).catch(() => null)); }
let DOT = null; function dotTex() { if (DOT) return DOT; const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return DOT = new THREE.CanvasTexture(c); }
function tex(f) { let t = TEX.get(f); if (!t) { t = TL.load('textures/constellations/' + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; TEX.set(f, t); } return t; }

// toVec(raDeg, decDeg) → unit THREE.Vector3 in the scene's frame (or null to leave a thing out, e.g. below the horizon)
export function buildConstellations(art, S, toVec, { tint = 0x9fbdff, artOpacity = 0.28, dotSize = 2.1 } = {}) {
  const group = new THREE.Group(), mats = [];
  // 1. figures: each picture mapped onto the sky by the affine map that puts its three anchors on their stars
  for (const c of art.art) {
    const D = c.a.map(([, , ra, dec]) => toVec(ra, dec)); if (D.some(d => !d)) continue;
    const ctr = D[0].clone().add(D[1]).add(D[2]).normalize(), up = Math.abs(ctr.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const e = new THREE.Vector3().crossVectors(up, ctr).normalize(), n = new THREE.Vector3().crossVectors(ctr, e);
    const P = D.map(d => { const k = d.dot(ctr); return [d.dot(e) / k, d.dot(n) / k]; });
    // solve [u v 1] · M = [x y] for the 3 anchors
    const U = new THREE.Matrix3().set(c.a[0][0], c.a[0][1], 1, c.a[1][0], c.a[1][1], 1, c.a[2][0], c.a[2][1], 1); if (Math.abs(U.determinant()) < 1e-6) continue; U.invert();
    const mx = new THREE.Vector3(P[0][0], P[1][0], P[2][0]).applyMatrix3(U), my = new THREE.Vector3(P[0][1], P[1][1], P[2][1]).applyMatrix3(U);
    const N = 10, pos = [], uv = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const u = c.w * i / N, v = c.h * j / N, x = mx.x * u + mx.y * v + mx.z, y = my.x * u + my.y * v + my.z;
      const d = ctr.clone().addScaledVector(e, x).addScaledVector(n, y).normalize(); pos.push(d.x, d.y, d.z); uv.push(i / N, 1 - j / N); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ map: tex(c.f), color: tint, transparent: true, opacity: artOpacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    m.userData.base = artOpacity; mats.push(m); const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -2; group.add(mesh);
  }
  // 2. dotted stick figures: small dots every ~0.45°, a brighter dot on every star
  const dots = [], stars = [], seen = new Set();
  for (const segs of Object.values(S.lines)) for (const seg of segs) for (let i = 1; i < seg.length; i++) {
    const a = toVec(seg[i - 1][0], seg[i - 1][1]), b = toVec(seg[i][0], seg[i][1]); if (!a || !b) continue;
    const ang = a.angleTo(b), n = Math.max(2, Math.round(ang / (0.45 * Math.PI / 180)));
    for (let k = 1; k < n; k++) { const t = k / n; if (t < 0.12 || t > 0.88) continue; const d = a.clone().lerp(b, t).normalize(); dots.push(d.x, d.y, d.z); }
    for (const [p, q] of [[a, seg[i - 1]], [b, seg[i]]]) { const key = q[0].toFixed(2) + ',' + q[1].toFixed(2); if (!seen.has(key)) { seen.add(key); stars.push(p.x, p.y, p.z); } }
  }
  const pts = (arr, size, op) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const m = new THREE.PointsMaterial({ color: 0xdfe8ff, size, sizeAttenuation: false, map: dotTex(), alphaTest: 0.05, transparent: true, opacity: op, depthWrite: false, fog: false, toneMapped: false }); m.userData.base = op; mats.push(m);
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -1; group.add(p); };
  pts(dots, dotSize, 0.7); pts(stars, dotSize * 2.2, 0.95);
  // 3. names of the brightest stars
  const names = (art.stars || []).map(([t, ra, dec, mag]) => ({ t, d: toVec(ra, dec), mag })).filter(s => s.d);
  return { group, names, setOpacity(k) { for (const m of mats) m.opacity = m.userData.base * k; group.visible = k > 0.01; },
    dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } };
}
