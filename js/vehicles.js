// Vehicle kit, +z forward, y up, ground at 0. Each type: "paint" (tinted per instance) + "fixed" (vertex colours).
// Bodies are side profiles extruded across the width with a small bevel, so they read as real cars, not boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js?v=89';

function finish(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
const M = parts => mergeGeometries(parts);
// side profile [[x(forward), y], …] extruded to width w, centred, length along +z
function profile(pts, w, col, bevel = 0.05) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(w - 2 * bevel) / 2); g.rotateY(-Math.PI / 2);
  return finish(g, col);
}
const box = (w, h, l, x, y, z, col) => finish(new THREE.BoxGeometry(w, h, l).translate(x, y, z), col);
const cyl = (r1, r2, h, x, y, z, col, seg = 8) => finish(new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z), col);
function wheel(r, w, x, y, z, rim = 0x9a9ea3) { // tyre + rim + hub
  return [finish(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(x, y, z), 0x141414),
    finish(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10).rotateZ(Math.PI / 2).translate(x, y, z), rim),
    finish(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.04, 6).rotateZ(Math.PI / 2).translate(x, y, z), 0x3a3a3a)];
}
const GLASS = 0x18222b, LIGHT = 0xfff4cf, TAIL = 0xb5171a, BLACK = 0x1b1b1b, CHROME = 0xb8bcc0, SKIN = 0x9c6b4a, HAIR = 0x161210;

// a seated rider; legs forward, hands on bars at (hz, hy)
function rider(z0, seatY, hz, hy, shirt, helmet, pants = 0x2b2f38) {
  const p = [];
  p.push(box(0.36, 0.5, 0.24, 0, seatY + 0.3, z0, shirt));                                // torso
  p.push(finish(new THREE.SphereGeometry(0.11, 10, 8).translate(0, seatY + 0.7, z0 + 0.03), SKIN));
  p.push(finish(new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6).translate(0, seatY + 0.72, z0 + 0.02), helmet));
  for (const s of [-1, 1]) {
    p.push(box(0.12, 0.12, 0.42, s * 0.12, seatY + 0.06, z0 + 0.2, pants));                // thigh
    p.push(box(0.11, 0.42, 0.12, s * 0.15, seatY - 0.18, z0 + 0.4, pants));               // shin
    p.push(box(0.1, 0.06, 0.2, s * 0.15, seatY - 0.4, z0 + 0.46, BLACK));                  // sandal
    const ax = s * 0.22, ay = seatY + 0.45, len = Math.hypot(hz - z0, hy - ay); const arm = new THREE.BoxGeometry(0.09, 0.09, len);
    arm.rotateX(Math.atan2(ay - hy, hz - z0)); arm.translate(ax, (ay + hy) / 2, (z0 + hz) / 2); p.push(finish(arm, shirt));
  }
  return p;
}

function motoParts(seatZ = -0.15) {
  return [
    ...wheel(0.29, 0.09, 0, 0.29, 0.66, 0x7d8185), ...wheel(0.29, 0.1, 0, 0.29, -0.62, 0x7d8185),
    box(0.06, 0.62, 0.06, 0, 0.6, 0.6, CHROME),                     // fork
    box(0.62, 0.035, 0.035, 0, 0.98, 0.5, BLACK),                    // handlebar
    box(0.14, 0.12, 0.08, 0, 0.92, 0.66, LIGHT),                     // headlamp
    box(0.28, 0.1, 0.6, 0, 0.78, seatZ, BLACK),                      // seat
    box(0.1, 0.08, 0.4, 0.12, 0.38, -0.45, CHROME),                  // exhaust
    box(0.12, 0.06, 0.06, 0, 0.72, -0.86, TAIL),
  ];
}
// Honda-Dream-like underbone body as an extruded side profile
const motoBody = col => profile([[-0.85, 0.42], [-0.9, 0.66], [-0.55, 0.74], [0.1, 0.7], [0.32, 0.55], [0.48, 0.92], [0.62, 0.95], [0.6, 0.6], [0.3, 0.35], [-0.2, 0.32]], 0.26, col, 0.03);

export function vehicleKit() {
  const sedan = [[-2.25, 0.32], [-2.3, 0.72], [-2.1, 0.92], [-1.25, 0.98], [-0.72, 1.4], [0.42, 1.43], [1.08, 0.98], [2.1, 0.84], [2.28, 0.55], [2.22, 0.32]];
  const sedanGlass = [[-1.17, 0.99], [-0.7, 1.36], [0.4, 1.39], [1.0, 0.99]];
  const pick = [[-2.6, 0.48], [-2.65, 1.05], [-0.62, 1.05], [-0.56, 1.78], [0.48, 1.8], [1.15, 1.2], [2.38, 1.08], [2.5, 0.62], [2.42, 0.48]];
  const pickGlass = [[-0.5, 1.2], [-0.48, 1.72], [0.45, 1.74], [1.05, 1.2]];
  return {
    car: {
      paint: M([profile(sedan, 1.76, 0xffffff), box(0.08, 0.06, 0.16, 0.92, 1.0, 1.0, 0xffffff), box(0.08, 0.06, 0.16, -0.92, 1.0, 1.0, 0xffffff)]),
      fixed: M([profile(sedanGlass, 1.79, GLASS, 0.0), ...[[0.8, 1.4], [-0.8, 1.4], [0.8, -1.35], [-0.8, -1.35]].flatMap(([x, z]) => wheel(0.33, 0.22, x, 0.33, z)),
        box(1.3, 0.1, 0.05, 0, 0.72, 2.25, BLACK), box(0.36, 0.1, 0.04, 0.6, 0.78, 2.26, LIGHT), box(0.36, 0.1, 0.04, -0.6, 0.78, 2.26, LIGHT),
        box(0.4, 0.1, 0.04, 0.6, 0.82, -2.29, TAIL), box(0.4, 0.1, 0.04, -0.6, 0.82, -2.29, TAIL), box(1.7, 0.16, 0.06, 0, 0.42, -2.28, BLACK), box(1.7, 0.16, 0.06, 0, 0.42, 2.25, BLACK)]),
      len: 4.6, palette: [0xf2f2f0, 0xf2f2f0, 0xf2f2f0, 0x1c1e22, 0x1c1e22, 0x9aa1a8, 0x8b1e1e, 0x23518f, 0xc8c3b6, 0x5c6066, 0x6b4a2b],
    },
    pickup: {
      paint: M([profile(pick, 1.84, 0xffffff), box(0.06, 0.4, 2.0, 0.88, 1.2, -1.6, 0xffffff), box(0.06, 0.4, 2.0, -0.88, 1.2, -1.6, 0xffffff), box(1.8, 0.4, 0.06, 0, 1.2, -2.6, 0xffffff)]),
      fixed: M([profile(pickGlass, 1.87, GLASS, 0.0), box(1.7, 0.05, 1.95, 0, 1.06, -1.6, 0x2a2a2a), ...[[0.84, 1.55], [-0.84, 1.55], [0.84, -1.75], [-0.84, -1.75]].flatMap(([x, z]) => wheel(0.4, 0.26, x, 0.4, z)),
        box(1.4, 0.32, 0.06, 0, 0.88, 2.48, 0x2b2b2b), box(0.34, 0.12, 0.04, 0.66, 0.98, 2.5, LIGHT), box(0.34, 0.12, 0.04, -0.66, 0.98, 2.5, LIGHT), box(0.12, 0.3, 0.04, 0.84, 1.1, -2.64, TAIL), box(0.12, 0.3, 0.04, -0.84, 1.1, -2.64, TAIL)]),
      len: 5.3, palette: [0xf2f2f0, 0xf2f2f0, 0x9aa1a8, 0x1c1e22, 0x7a1f1f, 0x2b4f7d, 0x6e6a5e],
    },
    moto: {
      paint: M([motoBody(0xffffff), ...rider(-0.2, 0.84, 0.5, 0.98, 0xffffff, 0x222222).slice(0, 1)]),
      fixed: M([...motoParts(), ...rider(-0.2, 0.84, 0.5, 0.98, 0x3b5f9a, 0x1f1f1f).slice(1)]),
      len: 1.9, palette: [0xb3261e, 0x1c1e22, 0x23518f, 0xe8e6df, 0x9a8f80, 0xd2a03a, 0x6a3d8f, 0x3b8ec9, 0xc94f7c, 0x2f7d4a],
    },
    moto2: { // rider + passenger
      paint: M([motoBody(0xffffff), ...rider(-0.05, 0.84, 0.5, 0.98, 0xffffff, 0x222222).slice(0, 1)]),
      fixed: M([...motoParts(-0.25), ...rider(-0.05, 0.84, 0.5, 0.98, 0x1d1d1d, 0xd9d9d9).slice(1), ...rider(-0.5, 0.86, -0.15, 1.05, 0xd96c8a, 0x8a1f2a)]),
      len: 1.9, palette: [0xb3261e, 0x1c1e22, 0x23518f, 0xe8e6df, 0x9a8f80, 0x3b8ec9],
    },
    tuktuk: { // Cambodian remork: motorbike towing a canopied carriage
      paint: M([finish(new THREE.CylinderGeometry(1.0, 1.0, 2.3, 16, 1, true, -0.9, 1.8).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 1.1, -1.75), 0xffffff),
        box(1.56, 0.3, 2.2, 0, 0.78, -1.75, 0xffffff)]),
      fixed: M([motoBody(0x2b2b2b).translate(0, 0, 0.75), ...motoParts().map(g => g.clone().translate(0, 0, 0.75)).slice(0, 7), ...rider(0.55, 0.84, 1.25, 0.98, 0xd8d2c0, 0x2a2a2a),
        box(1.5, 0.08, 2.2, 0, 0.62, -1.75, 0x3b3530), box(1.4, 0.35, 0.45, 0, 0.82, -0.9, 0x5a3424), box(1.4, 0.35, 0.45, 0, 0.82, -2.6, 0x5a3424),
        box(1.4, 0.45, 0.08, 0, 1.15, -0.72, 0x5a3424), box(1.4, 0.45, 0.08, 0, 1.15, -2.78, 0x5a3424), box(0.08, 0.06, 0.6, 0, 0.6, -0.4, BLACK),
        ...[[0.74, -0.7], [-0.74, -0.7], [0.74, -2.8], [-0.74, -2.8]].map(([x, z]) => cyl(0.025, 0.025, 1.45, x, 1.33, z, CHROME, 5)),
        ...wheel(0.3, 0.14, 0.82, 0.3, -1.75), ...wheel(0.3, 0.14, -0.82, 0.3, -1.75)]),
      len: 4.3, palette: [0x2a6fb0, 0x2f7d4a, 0xd9b22a, 0x1c1e22, 0xb3261e, 0x6a3d8f],
    },
    truck: {
      paint: M([profile([[1.5, 0.75], [1.5, 2.75], [2.35, 2.75], [2.6, 2.1], [2.62, 0.75]], 2.3, 0xffffff), box(2.3, 0.3, 0.2, 0, 0.8, 2.55, 0xffffff)]),
      fixed: M([profile([[1.62, 1.95], [1.62, 2.62], [2.3, 2.62], [2.5, 1.95]], 2.33, GLASS, 0), box(2.4, 2.7, 5.6, 0, 2.05, -1.55, 0xd8d6cf), box(2.42, 0.12, 5.62, 0, 2.0, -1.55, 0x2f6fa8),
        box(2.1, 0.3, 8.0, 0, 0.62, -0.4, 0x222222), box(1.6, 0.5, 0.06, 0, 1.15, 2.63, 0x3a3a3a), box(0.3, 0.14, 0.04, 0.9, 1.0, 2.64, LIGHT), box(0.3, 0.14, 0.04, -0.9, 1.0, 2.64, LIGHT),
        ...[[1.04, 1.95], [-1.04, 1.95], [1.04, -2.4], [-1.04, -2.4], [1.04, -3.5], [-1.04, -3.5]].flatMap(([x, z]) => wheel(0.5, 0.34, x, 0.5, z))]),
      len: 8.6, palette: [0x1f5fa8, 0xb3261e, 0xeeeeee, 0x2f7d4a, 0xd28a1e],
    },
    bus: {
      paint: M([profile([[-5.5, 0.45], [-5.5, 3.05], [5.2, 3.05], [5.55, 2.6], [5.6, 0.45]], 2.5, 0xffffff, 0.08)]),
      fixed: M([box(2.52, 0.95, 9.6, 0, 2.3, -0.4, GLASS), profile([[5.0, 1.3], [5.0, 2.85], [5.38, 2.62], [5.44, 1.3]], 2.3, GLASS, 0), box(0.04, 1.6, 0.9, 1.27, 1.45, 4.2, GLASS),
        box(2.4, 0.18, 0.06, 0, 0.6, 5.62, 0x2a2a2a), box(0.34, 0.14, 0.04, 0.85, 0.85, 5.63, LIGHT), box(0.34, 0.14, 0.04, -0.85, 0.85, 5.63, LIGHT),
        ...[[1.12, 3.6], [-1.12, 3.6], [1.12, -3.4], [-1.12, -3.4]].flatMap(([x, z]) => wheel(0.52, 0.3, x, 0.52, z))]),
      len: 11.1, palette: [0xf2f2f0, 0x1f5fa8, 0xe2b93b, 0xb3261e],
    },
  };
}
