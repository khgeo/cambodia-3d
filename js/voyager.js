// Voyager 1 and 2: a 3D model built from the spacecraft's published layout, and their path through the
// Solar System — launch, the planet flybys, then the long straight cruise out to interstellar space.
// Present-day positions are anchored to NASA's figures (Voyager 1 one light-day from Earth on
// 2026-11-18 10:16 UTC; Voyager 2 at its yearly farthest point, 143.09 AU from Earth, on 2026-02-09) and
// move outward at the escape speeds (16.9 and 15.3 km/s). Accurate to roughly 0.1 AU.
import * as THREE from 'three';

const D2R = Math.PI / 180, AU = 1.495978707e8, OBL = 23.43928 * D2R, YR = 365.25 * 864e5;
const ms = s => Date.parse(s + 'T12:00:00Z');
// our frame ↔ ecliptic (x, y in the ecliptic plane, z to the north ecliptic pole)
const toEcl = ([a, b, c]) => { const Y = -c, Z = b; return [a, Y * Math.cos(OBL) + Z * Math.sin(OBL), -Y * Math.sin(OBL) + Z * Math.cos(OBL)]; };
const fromEcl = ([x, y, z]) => { const Y = y * Math.cos(OBL) - z * Math.sin(OBL), Z = y * Math.sin(OBL) + z * Math.cos(OBL); return [x, Z, -Y]; };
const dirRD = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.sin(dec * D2R), -Math.cos(dec * D2R) * Math.sin(ra * D2R)];

export const VOYAGERS = {
  'Voyager 1': { km: 'វ៉ូយ៉ាជឺ ១', col: '#ffd479', launch: ms('1977-09-05'), ra: 258.5, dec: 12.2, r0: 172.37, t0: Date.parse('2026-11-18T10:16:07Z'), v: 16.9,
    fly: [['Jupiter', '1979-03-05'], ['Saturn', '1980-11-12']],
    info: 'Launched 5 Sep 1977. Flew past Jupiter (1979) and Saturn (1980, close to the moon Titan), then turned north out of the planets\' plane. Crossed the heliopause into interstellar space on 25 Aug 2012 at 121 AU, and on 18 Nov 2026 became the first human-made object one light-day from Earth. Carries the Golden Record of sounds and pictures of Earth.' },
  'Voyager 2': { km: 'វ៉ូយ៉ាជឺ ២', col: '#8fd8ff', launch: ms('1977-08-20'), ra: 301, dec: -59.6, r0: 142.38, t0: ms('2026-02-09'), v: 15.3,
    fly: [['Jupiter', '1979-07-09'], ['Saturn', '1981-08-25'], ['Uranus', '1986-01-24'], ['Neptune', '1989-08-25']],
    info: 'Launched 20 Aug 1977, two weeks before its twin. The only spacecraft to visit Uranus (1986) and Neptune (1989), after Jupiter and Saturn — the "Grand Tour". Neptune\'s gravity bent it south, below the planets\' plane. Crossed into interstellar space on 5 Nov 2018 at 119 AU. Also carries a Golden Record.' },
};

/* ---------- trajectory: smooth in (distance, ecliptic longitude, latitude) through the encounters ---------- */
export function makeTrack(id, helioAt) { // helioAt(planet, ms) → km in our frame
  const V = VOYAGERS[id], dir = dirRD(V.ra, V.dec), rAt = t => (V.r0 + V.v * (t - V.t0) / 1000 / AU) * AU;
  const last = ms(V.fly[V.fly.length - 1][1]), tLine = last + 9 * YR; // from here on the path is a straight line outward
  const K = [[V.launch, helioAt('Earth', V.launch)], ...V.fly.map(([p, d]) => [ms(d), helioAt(p, ms(d))])];
  for (const k of [tLine, tLine + 4 * YR]) K.push([k, dir.map(c => c * rAt(k))]);
  const P = K.map(([t, p]) => { const e = toEcl(p), r = Math.hypot(...e); return [t, r, Math.atan2(e[1], e[0]), Math.asin(e[2] / r)]; });
  for (let i = 1; i < P.length; i++) { while (P[i][2] < P[i - 1][2]) P[i][2] += 2 * Math.PI; } // prograde: longitude only grows
  const herm = (i, t, c) => { const a = P[i], b = P[i + 1], h = b[0] - a[0], s = (t - a[0]) / h, sl = j => { const p = P[Math.max(0, j - 1)], n = P[Math.min(P.length - 1, j + 1)]; return (n[c] - p[c]) / (n[0] - p[0]); };
    const s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * a[c] + (s3 - 2 * s2 + s) * h * sl(i) + (-2 * s3 + 3 * s2) * b[c] + (s3 - s2) * h * sl(i + 1); };
  const at = t => { if (t >= tLine) return dir.map(c => c * rAt(t)); if (t <= V.launch) return helioAt('Earth', t);
    let i = 0; while (P[i + 1][0] < t) i++; const r = herm(i, t, 1), L = herm(i, t, 2), B = herm(i, t, 3); return fromEcl([r * Math.cos(B) * Math.cos(L), r * Math.cos(B) * Math.sin(L), r * Math.sin(B)]); };
  // a line of the whole path in AU, drawn up to "now" in the scene's time
  const N = 1400, tEnd = ms('2060-01-01'), T = [], pts = [];
  for (let k = 0; k <= N; k++) { const f = k / N, t = V.launch + (tEnd - V.launch) * f * f; T.push(t); pts.push(...at(t).map(v => v / AU)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: V.col, transparent: true, opacity: 0.7, depthWrite: false })); line.frustumCulled = false;
  const upTo = t => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; } g.setDrawRange(0, t < V.launch ? 0 : lo + 1); };
  const speed = t => { const a = at(t - 864e5), b = at(t + 864e5); return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 172800; };
  return { at, line, upTo, speed, V };
}

/* ---------- the spacecraft (metres; the high-gain dish points along +Z) ---------- */
export function voyagerModel() {
  const G = new THREE.Group(), add = (geo, mat, f) => { const m = new THREE.Mesh(geo, mat); if (f) f(m); G.add(m); return m; };
  const M = (color, metal = 0.2, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
  const white = M(0xf2f1ea, 0, 0.55, { side: THREE.DoubleSide }), gold = M(0xc9a043, 0.75, 0.38), blanket = M(0x1b1b1d, 0.1, 0.8), alu = M(0xb8bcc2, 0.8, 0.35), dark = M(0x3c3e42, 0.4, 0.6), copper = M(0xd8a24a, 0.9, 0.25);
  const rod = (a, b, r, mat) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B); return add(new THREE.CylinderGeometry(r, r, L, 6), mat, m => { m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); }); };
  // bus: ten-sided ring of electronics bays wrapped in black and gold blankets, propellant tank in the middle
  add(new THREE.CylinderGeometry(0.89, 0.89, 0.47, 10), blanket, m => m.rotation.x = Math.PI / 2);
  for (let i = 0; i < 10; i++) { const a = (i + 0.5) / 10 * Math.PI * 2; add(new THREE.PlaneGeometry(0.5, 0.4), i % 3 ? gold : alu, m => { m.position.set(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0); m.rotation.set(0, Math.PI / 2, 0); m.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), a); }); }
  add(new THREE.SphereGeometry(0.36, 20, 12), alu, m => m.position.z = -0.32);
  // the Golden Record on the side of the bus, in its aluminium cover
  add(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 32), copper, m => { m.rotation.z = Math.PI / 2; m.position.set(0.9, 0.12, 0); });
  add(new THREE.CircleGeometry(0.05, 16), alu, m => { m.position.set(0.915, 0.12, 0); m.rotation.y = Math.PI / 2; });
  // high-gain antenna: 3.66 m dish, sub-reflector on a tripod
  const prof = []; for (let k = 0; k <= 16; k++) { const r = 1.83 * k / 16; prof.push(new THREE.Vector2(r, r * r / (4 * 1.0))); }
  add(new THREE.LatheGeometry(prof, 48), white, m => { m.rotation.x = Math.PI / 2; m.position.z = 0.28; });
  add(new THREE.CylinderGeometry(0.06, 0.15, 0.25, 12), alu, m => { m.rotation.x = Math.PI / 2; m.position.z = 0.42; });
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; rod([Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.28 + 0.36], [0, 0, 1.28], 0.012, alu); }
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20), white, m => { m.rotation.x = Math.PI / 2; m.position.z = 1.3; });
  add(new THREE.ConeGeometry(0.08, 0.22, 12), alu, m => { m.rotation.x = -Math.PI / 2; m.position.z = 1.18; });
  // RTG boom: three plutonium power units with cooling fins
  rod([-0.8, -0.2, 0], [-3.2, -0.9, 0], 0.03, alu); rod([-0.8, 0.25, 0], [-3.2, -0.9, 0], 0.025, alu);
  for (let k = 0; k < 3; k++) { const t = 0.42 + k * 0.24, x = -0.8 + (-3.2 + 0.8) * t, y = -0.2 + (-0.7) * t;
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16), dark, m => { m.position.set(x, y, -0.05); m.rotation.z = Math.atan2(-0.7, -2.4) + Math.PI / 2; });
    for (let f = 0; f < 6; f++) add(new THREE.BoxGeometry(0.5, 0.26, 0.012), dark, m => { m.position.set(x, y, -0.05); m.rotation.z = Math.atan2(-0.7, -2.4); m.rotateX(f / 6 * Math.PI); }); }
  // science boom with the scan platform: wide- and narrow-angle cameras, infrared and ultraviolet instruments
  rod([0.8, -0.3, 0], [3.0, -1.0, 0.1], 0.035, alu); rod([0.8, 0.25, 0], [3.0, -1.0, 0.1], 0.025, alu);
  add(new THREE.BoxGeometry(0.45, 0.45, 0.32), blanket, m => m.position.set(3.15, -1.05, 0.1));
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 14), alu, m => { m.position.set(3.25, -1.05, 0.55); m.rotation.z = Math.PI / 2; m.rotation.y = 0.4; }); // narrow-angle camera
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 14), alu, m => { m.position.set(3.0, -1.3, 0.48); m.rotation.z = Math.PI / 2; m.rotation.y = 0.4; }); // wide-angle camera
  add(new THREE.CylinderGeometry(0.25, 0.22, 0.4, 20), gold, m => { m.position.set(3.4, -0.75, 0.32); m.rotation.x = Math.PI / 2; }); // infrared spectrometer telescope
  add(new THREE.BoxGeometry(0.22, 0.18, 0.5), gold, m => m.position.set(2.85, -0.8, 0.45)); // ultraviolet spectrometer
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 14), gold, m => { m.position.set(1.7, -0.75, -0.25); m.rotation.x = Math.PI / 2; }); // low-energy charged particles
  add(new THREE.BoxGeometry(0.3, 0.28, 0.28), blanket, m => m.position.set(1.25, 0.95, -0.15)); // cosmic ray detector
  // magnetometer boom: 13 m triangular lattice, sensors along it
  const B0 = [0.2, 0.85, -0.1], dirM = new THREE.Vector3(0.12, 1, -0.05).normalize(), P = s => [B0[0] + dirM.x * s, B0[1] + dirM.y * s, B0[2] + dirM.z * s];
  for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2, o = [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08]; const A = P(0), Bp = P(13); rod([A[0] + o[0], A[1], A[2] + o[2]], [Bp[0] + o[0] * 0.5, Bp[1], Bp[2] + o[2] * 0.5], 0.006, alu); }
  for (let s = 0.5; s < 13; s += 0.5) { const p = P(s); add(new THREE.TorusGeometry(0.075 * (1 - s / 26), 0.004, 4, 3), alu, m => { m.position.set(...p); m.rotation.x = Math.PI / 2; }); }
  for (const s of [7, 13]) add(new THREE.BoxGeometry(0.16, 0.16, 0.16), white, m => m.position.set(...P(s)));
  // plasma-wave / planetary radio antennas: two 10 m whips in a V
  rod([-0.3, -0.8, -0.2], [-1.8, -9.5, -3.5], 0.006, alu); rod([0.3, -0.8, -0.2], [2.6, -9.3, -3.6], 0.006, alu);
  // thrusters
  for (const [x, y] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) add(new THREE.ConeGeometry(0.035, 0.1, 8), alu, m => { m.position.set(x, y, -0.3); m.rotation.x = Math.PI / 2; });
  G.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
  return G;
}
