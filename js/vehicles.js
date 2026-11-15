// Low-poly vehicle kit, +z forward, y up, ground at 0.
// Each type has a "paint" part (tinted per instance) and a "fixed" part (vertex colours).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colorize(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, l, x, y, z, col = 0xffffff) => colorize(new THREE.BoxGeometry(w, h, l).translate(x, y, z), col);
const wheel = (r, w, x, y, z) => colorize(new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z), 0x111111);
function tapered(w, h, l, x, y, z, k = 0.82, kl = 0.7, col = 0xffffff) {
  const g = new THREE.BoxGeometry(w, h, l), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * kl); }
  return colorize(g.translate(x, y, z), col);
}
const M = parts => mergeGeometries(parts);
const GLASS = 0x1a232c, TYRE = 0x111111, LIGHT = 0xfff6d8, TAIL = 0xb01818, SKIN = 0xb07a55;

function rider(z0 = -0.15) {
  return [box(0.42, 0.55, 0.3, 0, 1.2, z0, 0xffffff), colorize(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.62, z0 + 0.05), 0x222222),
    box(0.36, 0.45, 0.5, 0, 0.82, z0 + 0.1, 0x2b2f38)];
}

export function vehicleKit() {
  return {
    car: {
      paint: M([box(1.76, 0.62, 4.3, 0, 0.66, 0), box(1.36, 0.06, 1.55, 0, 1.52, -0.2)]),
      fixed: M([tapered(1.6, 0.52, 2.3, 0, 1.22, -0.2, 0.86, 0.72, GLASS),
        wheel(0.34, 0.24, -0.82, 0.34, 1.35), wheel(0.34, 0.24, 0.82, 0.34, 1.35), wheel(0.34, 0.24, -0.82, 0.34, -1.35), wheel(0.34, 0.24, 0.82, 0.34, -1.35),
        box(1.5, 0.12, 0.05, 0, 0.78, 2.16, LIGHT), box(1.5, 0.12, 0.05, 0, 0.82, -2.16, TAIL)]),
      len: 4.3, palette: [0xf2f2f0, 0xf2f2f0, 0xf2f2f0, 0x1c1e22, 0x1c1e22, 0x9aa1a8, 0x8b1e1e, 0x23518f, 0xc8c3b6, 0x5c6066, 0x6b4a2b],
    },
    moto: {
      paint: M([box(0.3, 0.36, 1.1, 0, 0.62, 0.15), box(0.42, 0.5, 0.3, 0, 1.2, -0.15)]),
      fixed: M([wheel(0.3, 0.1, 0, 0.3, 0.7), wheel(0.3, 0.1, 0, 0.3, -0.62), box(0.32, 0.1, 0.6, 0, 0.86, -0.25, 0x111111),
        colorize(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 1.62, -0.1), 0x202020), box(0.36, 0.45, 0.5, 0, 0.82, -0.05, 0x2b2f38),
        box(0.5, 0.06, 0.06, 0, 1.08, 0.55, 0x222222), box(0.08, 0.08, 0.04, 0, 0.95, 0.73, LIGHT)]),
      len: 1.9, palette: [0xb3261e, 0x1c1e22, 0x23518f, 0xe8e6df, 0x3a6b3a, 0x9a8f80, 0xd2a03a, 0x6a3d8f, 0x3b8ec9, 0xc94f7c],
    },
    tuktuk: {
      paint: M([box(1.55, 0.07, 2.25, 0, 2.02, -1.55)]),
      fixed: M([box(0.3, 0.36, 1.1, 0, 0.62, 0.9, 0x1c1e22), wheel(0.3, 0.1, 0, 0.3, 1.4), ...rider(0.55),
        box(1.45, 0.14, 2.1, 0, 0.58, -1.55, 0x2b2b2b), box(1.4, 0.4, 0.5, 0, 0.85, -0.85, 0x6b3a2a), box(1.4, 0.4, 0.5, 0, 0.85, -2.25, 0x6b3a2a),
        box(0.05, 1.4, 0.05, 0.7, 1.32, -0.5, 0x333333), box(0.05, 1.4, 0.05, -0.7, 1.32, -0.5, 0x333333),
        box(0.05, 1.4, 0.05, 0.7, 1.32, -2.6, 0x333333), box(0.05, 1.4, 0.05, -0.7, 1.32, -2.6, 0x333333),
        wheel(0.3, 0.15, -0.78, 0.3, -1.6), wheel(0.3, 0.15, 0.78, 0.3, -1.6)]),
      len: 4.1, palette: [0x2a6fb0, 0x2f7d4a, 0xd9b22a, 0x1c1e22, 0xb3261e, 0x6a3d8f],
    },
    truck: {
      paint: M([box(2.3, 2.1, 1.8, 0, 1.55, 2.75)]),
      fixed: M([box(2.0, 0.7, 0.05, 0, 2.05, 3.66, GLASS), box(2.4, 2.6, 6.2, 0, 1.85, -1.35, 0xd8d6cf), box(2.2, 0.35, 8.4, 0, 0.62, -0.2, 0x222222),
        wheel(0.5, 0.35, -1.05, 0.5, 2.7), wheel(0.5, 0.35, 1.05, 0.5, 2.7), wheel(0.5, 0.35, -1.05, 0.5, -2.6), wheel(0.5, 0.35, 1.05, 0.5, -2.6),
        wheel(0.5, 0.35, -1.05, 0.5, -3.7), wheel(0.5, 0.35, 1.05, 0.5, -3.7)]),
      len: 8.6, palette: [0x1f5fa8, 0xb3261e, 0xeeeeee, 0x2f7d4a, 0xd28a1e],
    },
    bus: {
      paint: M([box(2.5, 2.7, 11, 0, 1.75, 0)]),
      fixed: M([box(2.54, 0.95, 10.2, 0, 2.3, -0.2, GLASS), box(2.2, 1.0, 0.05, 0, 2.2, 5.52, GLASS),
        wheel(0.52, 0.3, -1.12, 0.52, 3.6), wheel(0.52, 0.3, 1.12, 0.52, 3.6), wheel(0.52, 0.3, -1.12, 0.52, -3.4), wheel(0.52, 0.3, 1.12, 0.52, -3.4)]),
      len: 11, palette: [0xf2f2f0, 0x1f5fa8, 0xe2b93b, 0xb3261e],
    },
  };
}
