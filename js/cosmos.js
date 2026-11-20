// Cosmic zoom: from the whole Earth out to the Moon, the planets, the Sun, the nearby stars, the Milky Way, the Local
// Group, the cosmic web and the edge of the observable universe. Click anything to fly to it.
// Positions: planets from JPL Keplerian elements (Standish, 1800–2050), Moon from a short lunar series, stars from the
// Yale Bright Star Catalogue (d3-celestial) with real distances for the named ones, galaxies at their catalogue
// directions and distances. The Milky Way, the other galaxies' shapes and the cosmic web are illustrations.
// Frame: equatorial J2000 with y = celestial north (the globe's frame turned by the sidereal time).
import * as THREE from 'three';
import { t, lang } from './i18n.js?v=80';

const D2R = Math.PI / 180, AU = 1.495978707e8, LY = 9.4607e12, ER = 6371, OBL = 23.43928 * D2R;
const rev = x => ((x % 360) + 360) % 360;
// equatorial (RA, Dec in degrees) → our frame (x, y north, z), same convention as the globe's xyz()
const dirRD = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.sin(dec * D2R), -Math.cos(dec * D2R) * Math.sin(ra * D2R)];
// ecliptic xyz → our frame
const ecl = (x, y, z) => { const Y = y * Math.cos(OBL) - z * Math.sin(OBL), Z = y * Math.sin(OBL) + z * Math.cos(OBL); return [x, Z, -Y]; };
export const gmstDeg = d => { const jd = d / 864e5 + 2440587.5, T = (jd - 2451545) / 36525; return rev(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T); };
// JPL approximate elements: a, e, I, L, ϖ, Ω and rates per century
const EL = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 3.7e-7, 1.906e-5, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 3.9e-6, -4.107e-5, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  Earth: [1.00000261, 0.01671123, -1.531e-5, 100.46457166, 102.93768193, 0, 5.62e-6, -4.392e-5, -0.01294668, 35999.37244981, 0.32327364, 0],
  Mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 1.847e-5, 7.882e-5, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, -0.00196176, -4.397e-5, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 5.105e-5, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  Pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 5.17e-5, 4.818e-5, 145.20780515, -0.04062942, -0.01183482],
};
function helio(el, T, M0) { // → km, our frame
  const a = el[0] + el[6] * T, e = el[1] + el[7] * T, I = (el[2] + el[8] * T) * D2R, L = el[3] + el[9] * T, wb = el[4] + el[10] * T, Om = (el[5] + el[11] * T) * D2R;
  const M = (M0 != null ? M0 : rev(L - wb)) * D2R, w = (wb * D2R - Om); let E = M + e * Math.sin(M); for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E), cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return ecl((cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, (sw * sI) * xp + (cw * sI) * yp).map(v => v * AU);
}
function moonGeo(dms) { // geocentric Moon, km (short series)
  const d = dms / 864e5 + 2440587.5 - 2451545, L = (218.316 + 13.176396 * d) * D2R, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.22935 * d) * D2R, D = (297.85 + 12.190749 * d) * D2R, Ms = (357.529 + 0.98560028 * d) * D2R;
  const lon = L + (6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms)) * D2R, lat = (5.128 * Math.sin(F)) * D2R, r = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D);
  return ecl(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat));
}
// galactic → our frame (J2000 rotation, transposed), as a Matrix4
const GAL = (() => { const R = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.44482963, 0.7469822445], [-0.867666149, -0.1980763734, 0.4559837762]];
  const col = j => { const v = [R[j][0], R[j][1], R[j][2]]; return [v[0], v[2], -v[1]]; }; const X = col(0), Y = col(1), Z = col(2);
  return new THREE.Matrix4().set(X[0], Y[0], Z[0], 0, X[1], Y[1], Z[1], 0, X[2], Y[2], Z[2], 0, 0, 0, 0, 1); })();
const galDir = (gx, gy, gz) => new THREE.Vector3(gx, gy, gz).applyMatrix4(GAL);

const PLANETS = [ // name, Khmer, radius km, colour, pole RA/Dec, facts
  ['Mercury', 'ពុធ', 2440, '#9c9590', 281, 61.4, 'Smallest planet; a year lasts 88 days.'],
  ['Venus', 'សុក្រ', 6052, '#e8cf9a', 272.8, 67.2, 'Hottest planet (465 °C) under thick clouds.'],
  ['Earth', 'ផែនដី', 6371, '#3d7bd9', 0, 90, 'Our home – the only place known with life.'],
  ['Mars', 'អង្គារ', 3390, '#c1440e', 317.7, 52.9, 'Red desert planet with the tallest volcano, Olympus Mons.'],
  ['Jupiter', 'ព្រហស្បតិ៍', 69911, '#d8b48a', 268.1, 64.5, 'Largest planet – 1,300 Earths would fit inside.'],
  ['Saturn', 'សៅរ៍', 58232, '#e3c98f', 40.6, 83.5, 'Rings of ice and rock, 280,000 km across.'],
  ['Uranus', 'អ៊ុយរ៉ានុស', 25362, '#9fe3e8', 257.3, -15.2, 'Ice giant that spins on its side.'],
  ['Neptune', 'ណិបទូន', 24622, '#4b70dd', 299.4, 43.5, 'Windiest planet – up to 2,100 km/h.'],
  ['Pluto', 'ភ្លុយតូ', 1188, '#cdb79e', 133, -6.2, 'Dwarf planet in the Kuiper belt.'],
];
// named stars and deep-sky objects: RA, Dec (°), distance (ly), colour, radius (km, or ly for nebulae/galaxies), kind
const STARS = [['Proxima Centauri', 217.43, -62.68, 4.24, '#ff9a6b', 1.07e5, 'Closest star to the Sun; has a planet in its habitable zone.'], ['Alpha Centauri A', 219.9, -60.83, 4.37, '#fff3d6', 8.5e5, 'Sun-like star in the nearest star system.'],
  ["Barnard's Star", 269.45, 4.69, 5.96, '#ff9a6b', 1.4e5, 'Fastest-moving star across our sky.'], ['Wolf 359', 164.12, 7.01, 7.9, '#ff8a5c', 1.1e5, ''], ['Sirius', 101.29, -16.72, 8.6, '#cfe0ff', 1.19e6, 'Brightest star in the night sky.'],
  ['Epsilon Eridani', 53.23, -9.46, 10.5, '#ffd2a1', 5.1e5, 'Young star with a dusty disc.'], ['61 Cygni', 316.73, 38.75, 11.4, '#ffc58a', 4.6e5, 'First star whose distance was measured (1838).'], ['Procyon', 114.83, 5.22, 11.5, '#fff6e6', 1.43e6, ''],
  ['Tau Ceti', 26.02, -15.94, 11.9, '#fff0cf', 5.5e5, 'Sun-like star with possible planets.'], ['Epsilon Indi', 330.84, -56.79, 11.9, '#ffc58a', 5e5, ''], ['Altair', 297.7, 8.87, 16.7, '#e9f0ff', 1.3e6, 'Spins so fast it is flattened.'],
  ['Vega', 279.23, 38.78, 25, '#d6e3ff', 1.65e6, 'Was the pole star 12,000 years ago.'], ['Fomalhaut', 344.41, -29.62, 25.1, '#e3ecff', 1.28e6, ''], ['Pollux', 116.33, 28.03, 33.8, '#ffcf8f', 6.1e6, ''],
  ['Arcturus', 213.92, 19.18, 36.7, '#ffc078', 1.78e7, 'Orange giant, 25 times the Sun\'s size.'], ['TRAPPIST-1', 346.62, -5.04, 40.7, '#ff7a4c', 8.4e4, 'Small star with seven Earth-sized planets.'], ['Capella', 79.17, 46, 42.9, '#ffe9b8', 8.3e6, ''],
  ['Aldebaran', 68.98, 16.51, 65, '#ffad66', 3.1e7, 'The eye of Taurus.'], ['Regulus', 152.09, 11.97, 79, '#d6e3ff', 2.7e6, ''], ['Achernar', 24.43, -57.24, 139, '#c9dbff', 6e6, 'Most flattened star known.'],
  ['Spica', 201.3, -11.16, 250, '#bcd2ff', 5.2e6, ''], ['Canopus', 95.99, -52.7, 310, '#fff7ea', 5e7, 'Second-brightest star in the sky.'], ['Polaris', 37.95, 89.26, 433, '#fff2d6', 2.6e7, 'The North Star.'],
  ['Betelgeuse', 88.79, 7.41, 548, '#ff7b4a', 5.3e8, 'Red supergiant that will explode as a supernova.'], ['Antares', 247.35, -26.43, 550, '#ff6a3d', 4.7e8, 'Red supergiant, the heart of Scorpius.'], ['Rigel', 78.63, -8.2, 860, '#bcd2ff', 5.5e7, 'Blue supergiant in Orion.'],
  ['Deneb', 310.36, 45.28, 2600, '#e9f0ff', 1.4e8, 'One of the most luminous stars we can see.'], ['VY Canis Majoris', 110.74, -25.77, 3900, '#ff5a3a', 9.9e8, 'One of the largest stars known.'], ['Eta Carinae', 161.27, -59.68, 7500, '#bfe0ff', 1.7e8, 'Unstable giant pair of stars.']];
const DEEP = [ // name, RA, Dec, distance (ly), kind, size (ly), colour, facts, show at camera distances (km) [min, max]
  ['Pleiades', 56.75, 24.12, 444, 'cluster', 9, '#bcd2ff', 'Seven Sisters star cluster.', [1e14, 3e17]], ['Orion Nebula', 83.82, -5.39, 1344, 'nebula', 12, '#ff7fb0', 'Nursery where stars are being born.', [1e14, 3e17]],
  ['Crab Nebula', 83.63, 22.01, 6500, 'nebula', 5.5, '#ffb070', 'Remains of a supernova seen in 1054.', [1e15, 6e17]], ['Sagittarius A*', 266.42, -29.01, 26670, 'blackhole', 0.0001, '#ffcc66', 'Black hole of 4 million Suns at the centre of the Milky Way.', [3e16, 3e19]],
  ['Large Magellanic Cloud', 80.89, -69.76, 163000, 'galaxy', 7000, '#cfe0ff', 'Satellite galaxy of the Milky Way.', [5e17, 3e21]], ['Small Magellanic Cloud', 13.19, -72.83, 200000, 'galaxy', 3500, '#cfe0ff', 'Satellite galaxy of the Milky Way.', [5e17, 3e21]],
  ['Andromeda Galaxy', 10.68, 41.27, 2.54e6, 'galaxy', 110000, '#ffe9c8', 'Nearest big galaxy; will merge with the Milky Way in about 4.5 billion years.', [3e18, 3e23]], ['Triangulum Galaxy', 23.46, 30.66, 2.73e6, 'galaxy', 30000, '#d6e3ff', '', [5e18, 1e23]],
  ['Bode\'s Galaxy (M81)', 148.89, 69.07, 1.18e7, 'galaxy', 45000, '#ffe9c8', '', [2e19, 1e23]], ['Centaurus A', 201.37, -43.02, 1.2e7, 'galaxy', 30000, '#ffd9a8', 'Giant galaxy with a jet-spewing black hole.', [2e19, 1e23]],
  ['Whirlpool Galaxy (M51)', 202.47, 47.2, 2.3e7, 'galaxy', 38000, '#d6e3ff', '', [3e19, 1e23]], ['Sombrero Galaxy', 190, -11.62, 3.1e7, 'galaxy', 25000, '#ffe9c8', '', [3e19, 1e23]], ['Virgo Cluster', 187.7, 12.39, 5.35e7, 'gcluster', 2e6, '#ffe2b8', 'About 1,500 galaxies; the heart of our supercluster.', [1e20, 3e24]],
  ['Perseus Cluster', 49.95, 41.51, 2.4e8, 'gcluster', 3e6, '#ffe2b8', '', [5e20, 3e24]], ['Great Attractor', 243.6, -60.9, 2.2e8, 'gcluster', 5e6, '#ffd2a8', 'Pull of mass that our Local Group moves towards.', [5e20, 3e24]], ['Coma Cluster', 194.95, 27.98, 3.21e8, 'gcluster', 6e6, '#ffe2b8', '', [5e20, 3e24]],
  ['Shapley Supercluster', 201.9, -31.5, 6.5e8, 'gcluster', 2e7, '#ffd2a8', 'Largest concentration of galaxies nearby.', [1e21, 3e24]], ['Quasar 3C 273', 187.28, 2.05, 2.44e9, 'quasar', 1e5, '#9fd8ff', 'First quasar identified – a feeding black hole.', [3e21, 3e24]],
  ['GN-z11', 189.11, 62.24, 3.2e10, 'galaxy', 5000, '#ff9a8a', 'One of the most distant galaxies seen – light left it 13.4 billion years ago.', [1e23, 3e24]]];
const PROBES = [['Voyager 1', 258.5, 12.2, 167, 'Launched 1977 – the farthest human-made object.'], ['Voyager 2', 301, -59.6, 140, 'Only probe to visit Uranus and Neptune.'], ['New Horizons', 290, -20.4, 62, 'Flew past Pluto in 2015.']];
const SCALES = [[2e5, 'Earth'], [3e6, 'Earth and Moon'], [6e8, 'Inner planets'], [2e10, 'Solar System'], [3e14, 'Kuiper belt and Oort cloud'], [3e15, 'Nearest stars'], [2e17, 'Our neighbourhood in the Milky Way'], [3e18, 'Milky Way'], [3e20, 'Local Group'], [3e22, 'Cosmic web'], [Infinity, 'Observable universe']];

// shared shader for point clouds: fixed pixel size, pushed onto a far shell instead of being clipped
const pointsMat = (size, opacity = 1, additive = true) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  uniforms: { uSize: { value: size }, uOp: { value: opacity }, uFar: { value: 9e4 }, uPR: { value: Math.min(2, devicePixelRatio || 1) } },
  vertexShader: `attribute vec3 color; attribute float aSize; uniform float uSize; uniform float uFar; uniform float uPR; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); float L = length(mv.xyz); if (L > uFar) mv.xyz *= uFar / L; gl_Position = projectionMatrix * mv; gl_PointSize = uSize * aSize * uPR; }`,
  fragmentShader: `uniform float uOp; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.0, r); a = a * a; gl_FragColor = vec4(vC * a * uOp, a * uOp); }` });
const cloud = (pos, col, size, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1)); const p = new THREE.Points(g, mat); p.frustumCulled = false; return p; };
const rnd = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const hexRGB = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const fmtKm = km => { if (km < 1e6) return `${Math.round(km).toLocaleString()} km`; if (km < 0.1 * LY) return `${(km / AU).toFixed(km < 10 * AU ? 2 : 0)} AU`; const ly = km / LY; if (ly < 1e6) return `${ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString()} ${t('light-years')}`; if (ly < 1e9) return `${(ly / 1e6).toFixed(1)} ${t('million light-years')}`; return `${(ly / 1e9).toFixed(1)} ${t('billion light-years')}`; };
const lightTime = km => { const s = km / 299792.458; if (s < 60) return `${s.toFixed(1)} s`; if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`; if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} h`; if (s < 86400 * 365 * 2) return `${(s / 86400).toFixed(0)} ${t('days')}`; return null; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Cosmos {
  constructor(globe) {
    this.g = globe; this.w = globe.w; this.active = false; this.rate = 0; this.tOff = 0; this.az = 0; this.el = 0.3; this.dist = 8 * ER; this.focus = 'Earth';
    const sc = this.scene = new THREE.Scene(); sc.background = new THREE.Color(0x02040a); this.cam = new THREE.PerspectiveCamera(45, 1, 0.002, 2e5);
    sc.add(new THREE.AmbientLight(0xffffff, 0.1)); this.sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0); sc.add(this.sunLight);
    this.objs = []; this.items = []; this.pos = {}; this.build(); this.ui(); this.events();
  }
  now() { return Date.now() + this.tOff; }
  /* ---------------- scene ---------------- */
  build() {
    const sc = this.scene, T = (s, w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 4; return x; };
    // body textures (procedural)
    const bands = (cols, turb = 0.15) => T('', 512, 256, (g, w, h) => { for (let y = 0; y < h; y++) { const k = (Math.sin(y * 0.11) + Math.sin(y * 0.37) * 0.5 + 1.5) / 3, c = cols[Math.floor(k * cols.length) % cols.length]; g.fillStyle = c; g.fillRect(0, y, w, 1); } for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * turb})`; g.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 40, 1 + rnd() * 2); } });
    const rock = (base, spots, n = 400) => T('', 512, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { g.fillStyle = spots[(rnd() * spots.length) | 0]; g.globalAlpha = 0.25 + rnd() * 0.4; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * (n > 300 ? 9 : 28), 0, 7); g.fill(); } g.globalAlpha = 1; });
    const TEX = { Mercury: rock('#8f8a85', ['#6d6863', '#b0aaa4', '#5c5853'], 700), Venus: bands(['#e8cf9a', '#dcbf86', '#f0dcae'], 0.08), Mars: rock('#b5532a', ['#8c3a1c', '#d07a4b', '#e9d7c9', '#5e2a14'], 300), Jupiter: bands(['#d8b48a', '#b07a52', '#efe0c6', '#c79a6c', '#8e5c3c']), Saturn: bands(['#e3c98f', '#d1b479', '#f0e0b6', '#c7a86e'], 0.06), Uranus: bands(['#9fe3e8', '#a8e8ec', '#93d9df'], 0.03), Neptune: bands(['#4b70dd', '#3e5fc6', '#5b84ee'], 0.07), Pluto: rock('#cdb79e', ['#a88c6e', '#efe2cf', '#7a6050'], 200), Moon: rock('#9b9b98', ['#6e6e6c', '#bdbdb9', '#5a5a58'], 900) };
    const sphere = new THREE.SphereGeometry(1, 64, 32), TL = new THREE.TextureLoader(), real = (mat, f) => TL.load('textures/space/' + f, x => { x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 8; mat.map = x; mat.needsUpdate = true; });
    const FILE = { Mercury: '2k_mercury.jpg', Venus: '2k_venus_atmosphere.jpg', Mars: '2k_mars.jpg', Jupiter: '2k_jupiter.jpg', Saturn: '2k_saturn.jpg', Uranus: '2k_uranus.jpg', Neptune: '2k_neptune.jpg', Moon: '2k_moon.jpg' };
    this.SPIN = { Mercury: 1407.6, Venus: -5832.5, Mars: 24.62, Jupiter: 9.925, Saturn: 10.66, Uranus: -17.24, Neptune: 16.11, Pluto: -153.3 };
    // Sun
    { const sm = new THREE.MeshBasicMaterial({ color: 0xffffff }); real(sm, '2k_sun.jpg'); const m = new THREE.Mesh(sphere, sm); const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T('', 256, 256, (g) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.2, 'rgba(255,200,90,.55)'); r.addColorStop(0.5, 'rgba(255,140,40,.12)'); r.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); }), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      m.add(glow); glow.scale.setScalar(9); sc.add(m); this.addBody({ id: 'Sun', name: 'Sun', km: 'ព្រះអាទិត្យ', R: 696000, mesh: m, col: '#ffd76a', kind: 'star', info: 'Our star: 109 times wider than Earth, 4.6 billion years old.', show: [0, 3e17] }); }
    // planets, Moon
    for (const [n, km, R, col, pra, pdec, info] of PLANETS) {
      let mesh; if (n === 'Earth') { mesh = new THREE.Mesh(sphere, this.g.earth.material); }
      else { const mat = new THREE.MeshStandardMaterial({ map: TEX[n], roughness: 1, metalness: 0 }); if (FILE[n]) real(mat, FILE[n]); mesh = new THREE.Mesh(sphere, mat); mesh.userData.pole = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dirRD(pra, pdec))); mesh.quaternion.copy(mesh.userData.pole); }
      if (n === 'Saturn') { const rg = new THREE.RingGeometry(1.24, 2.27, 128, 1), uv = rg.attributes.uv, P = rg.attributes.position; for (let i = 0; i < P.count; i++) { const r = Math.hypot(P.getX(i), P.getY(i)); uv.setXY(i, (r - 1.24) / 1.03, 0.5); }
        const rmat = new THREE.MeshBasicMaterial({ map: T('', 512, 4, (g, w) => { for (let x = 0; x < w; x++) { const f = x / w, a = (f > 0.48 && f < 0.52 ? 0.05 : 0.35 + 0.5 * Math.abs(Math.sin(f * 40)) * (1 - f * 0.6)); g.fillStyle = `rgba(226,205,160,${a})`; g.fillRect(x, 0, 1, 4); } }), transparent: true, side: THREE.DoubleSide, depthWrite: false }); TL.load('textures/space/2k_saturn_ring_alpha.png', x => { x.colorSpace = THREE.SRGBColorSpace; rmat.map = x; rmat.needsUpdate = true; }); const ring = new THREE.Mesh(rg, rmat); ring.rotation.x = -Math.PI / 2; mesh.add(ring); }
      sc.add(mesh); this.addBody({ id: n, name: n, km, R, mesh, col, kind: n === 'Pluto' ? 'dwarf' : 'planet', info, show: n === 'Earth' ? [0, 3e11] : ['Mercury', 'Venus', 'Mars'].includes(n) ? [0, 5e10] : [0, 2e11] });
    }
    { const mm = new THREE.MeshStandardMaterial({ map: TEX.Moon, roughness: 1 }); real(mm, FILE.Moon); const m = new THREE.Mesh(sphere, mm); sc.add(m); this.addBody({ id: 'Moon', name: 'Moon', km: 'ព្រះច័ន្ទ', R: 1737, mesh: m, col: '#d7d7d2', kind: 'moon', info: 'Earth\'s only natural satellite, 384,400 km away. 12 people have walked on it.', show: [0, 3e7] }); }
    // orbits (heliocentric, km) and the Moon's orbit (geocentric)
    this.orbits = []; const T0 = (this.now() / 864e5 + 2440587.5 - 2451545) / 36525;
    for (const n of ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']) { const pts = []; for (let k = 0; k <= 256; k++) pts.push(...helio(EL[n], T0, k / 256 * 360)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.map(v => v / AU), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: PLANETS.find(p => p[0] === n)[3], transparent: true, opacity: 0.45, depthWrite: false })); l.frustumCulled = false; sc.add(l); this.orbits.push(l); }
    { const pts = []; for (let k = 0; k <= 180; k++) { const a = k / 180 * 2 * Math.PI; pts.push(...ecl(Math.cos(a), Math.sin(a) * Math.cos(5.1 * D2R), Math.sin(a) * Math.sin(5.1 * D2R))); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); this.moonOrbit = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.35, depthWrite: false })); this.moonOrbit.frustumCulled = false; sc.add(this.moonOrbit); }
    // asteroid belt, Kuiper belt (ecliptic, AU), Oort cloud (AU)
    const belt = (n, r0, r1, thick, colr, size) => { const p = [], c = [], s = []; for (let i = 0; i < n; i++) { const r = r0 + rnd() * (r1 - r0), a = rnd() * 2 * Math.PI; p.push(...ecl(r * Math.cos(a), r * Math.sin(a), gauss() * thick * r)); c.push(...colr.map(v => v * (0.6 + rnd() * 0.4))); s.push(size * (0.5 + rnd())); } return cloud(p, c, s, pointsMat(1, 0.8)); };
    this.asteroids = belt(6000, 2.2, 3.3, 0.06, [0.75, 0.68, 0.6], 1.6); this.kuiper = belt(9000, 30, 50, 0.1, [0.6, 0.7, 0.85], 1.6); sc.add(this.asteroids, this.kuiper);
    { const p = [], c = [], s = []; for (let i = 0; i < 15000; i++) { const v = new THREE.Vector3().randomDirection(), r = 2000 + Math.pow(rnd(), 0.6) * 98000; p.push(v.x * r, v.y * r, v.z * r); c.push(0.55, 0.65, 0.85); s.push(1.2); } this.oort = cloud(p, c, s, pointsMat(1, 0.5)); sc.add(this.oort); }
    // heliosphere (120 AU)
    this.helio = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.BackSide })); sc.add(this.helio);
    // probes
    for (const [n, ra, dec, au, info] of PROBES) { const d = dirRD(ra, dec); this.addPoint({ id: n, name: n, kind: 'probe', col: '#9fffc6', fixed: d.map(v => v * au * AU), info, show: [3e9, 5e12], size: 5 }); }
    this.ready = this.loadStars();
    // Milky Way (illustration): bar, bulge, four arms, in galactic coordinates, ly
    { const p = [], c = [], s = [], arm = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2], b = Math.tan(12 * D2R);
      for (let i = 0; i < 90000; i++) { let x, y, z, col;
        const u = rnd(); if (u < 0.18) { const r = Math.abs(gauss()) * 3500; const v = new THREE.Vector3().randomDirection().multiplyScalar(r); x = v.x * 1.7; y = v.y; z = v.z * 0.55; col = [1, 0.82, 0.55]; }
        else if (u < 0.25) { x = (rnd() - 0.5) * 18000; y = gauss() * 1500; z = gauss() * 400; const ca = Math.cos(0.47), sa = Math.sin(0.47); [x, y] = [x * ca - y * sa, x * sa + y * ca]; col = [1, 0.85, 0.6]; }
        else if (u < 0.4) { const r = Math.abs(gauss()) * 16000 + 3000, th = rnd() * 2 * Math.PI; x = r * Math.cos(th); y = r * Math.sin(th); z = gauss() * 350; col = [1, 0.9, 0.78]; }
        else { const k = arm[(rnd() * 4) | 0], r = 4500 + Math.pow(rnd(), 0.8) * 46000, th = Math.log(r / 4500) / b + k + gauss() * 0.32 * (1 - r / 80000); x = r * Math.cos(th); y = r * Math.sin(th); z = gauss() * (250 + r * 0.004); const hot = rnd() < 0.45; col = hot ? [0.62, 0.75, 1] : [1, 0.93, 0.82]; if (rnd() < 0.06) col = [1, 0.45, 0.6]; }
        p.push(x, y, z); c.push(...col); s.push(0.8 + rnd() * 1.4); }
      // the Sun sits 26,000 ly from the centre, in a gap between arms; x points from the Sun to the centre
      this.galaxy = cloud(p, c, s, pointsMat(1.6, 0.55)); this.galaxy.quaternion.setFromRotationMatrix(GAL); sc.add(this.galaxy);
      this.addPoint({ id: 'Milky Way', name: 'Milky Way', km: 'កាឡាក់ស៊ីមីលគីវ៉េ', kind: 'galaxy', col: '#ffe2b8', gal: [26000, 0, 0], info: 'Our galaxy: 100,000 light-years across, 100–400 billion stars. The Sun takes 230 million years to go round once.', show: [5e17, 3e22], R: 50000 * LY, view: 2.2e18 }); }
    // other galaxies (shapes are illustrations)
    { const tmpl = (n, arms) => { const p = [], c = [], s = []; for (let i = 0; i < n; i++) { if (!arms || rnd() < 0.25) { const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.abs(gauss()) * 0.25); p.push(v.x, v.y * (arms ? 0.35 : 0.8), v.z); c.push(1, 0.85, 0.6); } else { const k = ((rnd() * 2) | 0) * Math.PI, r = 0.1 + Math.pow(rnd(), 0.8) * 0.9, th = Math.log(r / 0.1) / 0.3 + k + gauss() * 0.25; p.push(r * Math.cos(th), gauss() * 0.02, r * Math.sin(th)); c.push(0.7, 0.8, 1); } s.push(0.8 + rnd()); } return [p, c, s]; };
      const SP = tmpl(9000, true), EL2 = tmpl(5000, false), IR = tmpl(3000, false);
      for (const [n, ra, dec, ly, kind, size, col, info, show] of DEEP) { const d = dirRD(ra, dec), o = { id: n, name: n, kind, col, fixed: d.map(v => v * ly * LY), info, show, R: size * LY, view: Math.max(size * 6, 0.00001) * LY };
        if (kind === 'galaxy') { const [p, c, s] = /Magellanic/.test(n) ? IR : /Sombrero|Centaurus|GN-z11/.test(n) ? EL2 : SP; const tint = hexRGB(col), cc = c.map((v, i) => v * tint[i % 3]); const m = cloud(p, cc, s, pointsMat(1.4, 0.7)); m.quaternion.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); sc.add(m); o.cloud = m; o.cloudR = size * LY; }
        this.addPoint(o); } }
    // cosmic web (illustration): galaxies along filaments between clusters, out to 1.5 billion ly
    { const N = 420, nodes = []; for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(rnd()) * 1.5e9); nodes.push(v); }
      const p = [], c = [], s = []; for (const a of nodes) { const near = nodes.map(b => [b, a.distanceTo(b)]).filter(([, d]) => d > 0).sort((x, y) => x[1] - y[1]).slice(0, 3);
        for (const [b] of near) for (let k = 0; k < 40; k++) { const f = rnd(); p.push(a.x + (b.x - a.x) * f + gauss() * 5e6, a.y + (b.y - a.y) * f + gauss() * 5e6, a.z + (b.z - a.z) * f + gauss() * 5e6); const w = 0.5 + rnd() * 0.5; c.push(0.75 * w, 0.8 * w, 1 * w); s.push(1.2); }
        for (let k = 0; k < 60; k++) { p.push(a.x + gauss() * 8e6, a.y + gauss() * 8e6, a.z + gauss() * 8e6); c.push(1, 0.85, 0.7); s.push(1.5); } }
      this.web = cloud(p, c, s, pointsMat(1.3, 0.6)); sc.add(this.web); }
    // cosmic microwave background shell, 46.5 billion ly
    { const tx = T('', 512, 256, (g, w, h) => { const im = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 3) + Math.sin(y * 0.13 + Math.cos(x * 0.05) * 2) + Math.sin((x + y) * 0.21) * 0.5 + (rnd() - 0.5) * 1.2, f = (v + 3) / 6; const col = new THREE.Color().setHSL(0.66 - f * 0.66, 0.85, 0.35 + f * 0.25); im.data.set([col.r * 255, col.g * 255, col.b * 255, 255], (y * w + x) * 4); } g.putImageData(im, 0, 0); });
      this.cmb = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { map: { value: tx }, uFar: { value: 9e4 }, uOp: { value: 1 } },
        vertexShader: 'uniform float uFar; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); float L = length(mv.xyz); if (L > uFar) mv.xyz *= uFar / L; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform sampler2D map; uniform float uOp; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb, uOp); }' })); sc.add(this.cmb);
      this.addPoint({ id: 'Observable universe', name: 'Observable universe', km: 'សកលលោកដែលអាចសង្កេតបាន', kind: 'universe', col: '#ff9a6b', fixed: [0, 0, 0], info: 'Everything whose light has had time to reach us: 93 billion light-years across. The glowing shell is the cosmic microwave background – light from 380,000 years after the Big Bang.', show: [3e23, 1e30], R: 4.4e23, view: 1.6e24, noMark: true }); }
    // labels
    this.labelBox = document.createElement('div'); this.labelBox.className = 'cosLabels'; document.body.appendChild(this.labelBox);
  }
  addBody(o) { o.body = true; o.view = o.view || o.R * 4.5; const mk = cloud([0, 0, 0], hexRGB(o.col), [o.id === 'Sun' ? 9 : 5], pointsMat(1, 1, false)); mk.renderOrder = 5; this.scene.add(mk); o.mark = mk; this.items.push(o); }
  addPoint(o) { if (!o.noMark) { const mk = cloud([0, 0, 0], hexRGB(o.col), [o.size || (o.kind === 'gcluster' ? 7 : 6)], pointsMat(1, 1, false)); this.scene.add(mk); o.mark = mk; } o.R = o.R || 1e5; o.view = o.view || o.R * 8; this.items.push(o); }
  async loadStars() { // Yale Bright Star Catalogue as a bubble of stars around the Sun (named stars at their real distance)
    try { const S = await (await fetch('data/sky.json')).json(), p = [], c = [], s = [];
      const bv = v => { const t2 = Math.max(-0.4, Math.min(2, v)); return t2 < 0 ? [0.67, 0.75, 1] : t2 < 0.4 ? [0.8 + t2 * 0.2, 0.85 + t2 * 0.15, 1] : t2 < 0.8 ? [1, 0.96 - (t2 - 0.4) * 0.15, 0.92 - (t2 - 0.4) * 0.4] : [1, 0.8 - (t2 - 0.8) * 0.2, 0.6 - (t2 - 0.8) * 0.3]; };
      for (const [ra, dec, mag, b] of S.stars) { const M = b > 1.1 ? -0.5 : 0.6 + 4 * Math.max(-0.2, b), pc = Math.min(1500, Math.max(3, Math.pow(10, (mag - M + 5) / 5))), d = dirRD(ra, dec), r = pc * 3.2616; p.push(d[0] * r, d[1] * r, d[2] * r); c.push(...bv(b)); s.push(Math.max(0.7, 4.6 - mag * 0.62)); }
      this.stars = cloud(p, c, s, pointsMat(1.25, 1)); this.scene.add(this.stars);
      for (const [n, ra, dec, ly, col, R, info] of STARS) this.addPoint({ id: n, name: n, kind: 'star', col, fixed: dirRD(ra, dec).map(v => v * ly * LY), R, info, show: [3e12, 2e17], view: Math.max(R * 6, 3e8), size: 5 });
    } catch (e) { console.warn('stars', e); }
  }
  /* ---------------- positions (km, heliocentric, our frame) ---------------- */
  positions(ms) {
    const T = (ms / 864e5 + 2440587.5 - 2451545) / 36525, P = this.pos; P.Sun = [0, 0, 0];
    for (const n of Object.keys(EL)) P[n] = helio(EL[n], T); const m = moonGeo(ms); P.Moon = [P.Earth[0] + m[0], P.Earth[1] + m[1], P.Earth[2] + m[2]];
    if (!this.galC) { const g = galDir(26000, 0, 0); this.galC = [g.x * LY, g.y * LY, g.z * LY]; }
    for (const o of this.items) if (!o.body) P[o.id] = o.gal ? this.galC : o.fixed;
    return P;
  }
  sunEcef(ms = Date.now()) { const P = this.positions(ms), s = new THREE.Vector3(P.Sun[0] - P.Earth[0], P.Sun[1] - P.Earth[1], P.Sun[2] - P.Earth[2]).normalize(); return s.applyAxisAngle(new THREE.Vector3(0, 1, 0), -gmstDeg(ms) * D2R); }
  /* ---------------- camera & render ---------------- */
  item(id) { return this.items.find(o => o.id === id); }
  camAbs() { const f = this.focusPos(), ce = Math.cos(this.el); return [f[0] + this.dist * ce * Math.sin(this.az), f[1] + this.dist * Math.sin(this.el), f[2] + this.dist * ce * Math.cos(this.az)]; }
  focusPos() { if (this.fly) return this.fly.cur; return this.pos[this.focus] || [0, 0, 0]; }
  place(obj, abs, cam, S, size) { // put an object relative to the camera, scaled; far things go onto the far shell
    let x = (abs[0] - cam[0]) * S, y = (abs[1] - cam[1]) * S, z = (abs[2] - cam[2]) * S; const L = Math.hypot(x, y, z), F = 8e4; let k = 1; if (L > F) { k = F / L; x *= k; y *= k; z *= k; }
    obj.position.set(x, y, z); if (size != null) obj.scale.setScalar(Math.max(size * S * k, 1e-9)); return L;
  }
  draw(ms, bg) {
    const P = this.positions(ms), cam = bg ? this.bgCam : this.camAbs(), D = bg ? Math.hypot(cam[0] - P.Earth[0], cam[1] - P.Earth[1], cam[2] - P.Earth[2]) : this.dist, S = 10 / D; this.S = S; this.camKm = cam;
    const fade = (a, b, x, c, d) => Math.max(0, Math.min(1, Math.log(x / a) / Math.log(b / a), Math.log(d / x) / Math.log(d / c)));
    // bodies
    const G = gmstDeg(ms) * D2R;
    for (const o of this.items) { const p = P[o.id]; if (!p) continue;
      let Lp = 1; if (o.mesh) { Lp = this.place(o.mesh, p, cam, S, o.R); if (o.id === 'Earth') { o.mesh.rotation.set(0, G, 0); o.mesh.visible = !bg; }
        else if (o.id === 'Moon') { const X = new THREE.Vector3(P.Earth[0] - p[0], P.Earth[1] - p[1], P.Earth[2] - p[2]).normalize(), Y = new THREE.Vector3(0, 1, 0).addScaledVector(X, -X.y).normalize(), Z = new THREE.Vector3().crossVectors(X, Y); o.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); }
        else if (o.mesh.userData.pole && this.SPIN[o.id]) o.mesh.quaternion.copy(o.mesh.userData.pole).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (ms / 3.6e6 / this.SPIN[o.id]) % 1 * 2 * Math.PI)); }
      if (o.mark) { this.place(o.mark, p, cam, S); if (bg && o.id === 'Earth') { o.mark.visible = false; continue; } o.mark.visible = true; o.mark.material.uniforms.uOp.value = o.mesh ? Math.max(0, 1 - (o.R * S / Math.max(Lp, 1e-9)) / 0.006) : (o.show ? fade(o.show[0] / 30, o.show[0], D, o.show[1], o.show[1] * 30) : 1); }
      if (o.cloud) { this.place(o.cloud, p, cam, S, o.cloudR); o.cloud.material.uniforms.uOp.value = 0.75 * fade(o.cloudR * 2, o.cloudR * 30, D, 1e30, 1e31); } }
    this.place(this.sunLight, P.Sun, cam, S); this.g.U.sun.value.set(...(() => { const s = [P.Sun[0] - P.Earth[0], P.Sun[1] - P.Earth[1], P.Sun[2] - P.Earth[2]], L = Math.hypot(...s); const v = new THREE.Vector3(s[0] / L, s[1] / L, s[2] / L).applyAxisAngle(new THREE.Vector3(0, 1, 0), -G); return [v.x, v.y, v.z]; })());
    // orbits & belts (stored in AU, around the Sun)
    for (const l of this.orbits) { this.place(l, P.Sun, cam, S, AU); l.material.opacity = 0.5 * fade(3e6, 6e7, D, 3e11, 3e13); l.visible = l.material.opacity > 0.01; }
    this.place(this.moonOrbit, P.Earth, cam, S, 384400); this.moonOrbit.material.opacity = 0.4 * fade(2e4, 2e5, D, 1e7, 2e8); this.moonOrbit.visible = this.moonOrbit.material.opacity > 0.01;
    for (const [b, lo, hi] of [[this.asteroids, 3e7, 2e11], [this.kuiper, 5e8, 5e12], [this.oort, 5e10, 2e15]]) { this.place(b, P.Sun, cam, S, AU); b.material.uniforms.uOp.value = 0.8 * fade(lo, lo * 20, D, hi / 30, hi); b.visible = b.material.uniforms.uOp.value > 0.01; }
    this.place(this.helio, P.Sun, cam, S, AU); this.helio.material.opacity = 0.06 * fade(3e9, 3e10, D, 3e12, 3e13); this.helio.visible = this.helio.material.opacity > 0.003;
    if (this.stars) { this.place(this.stars, P.Sun, cam, S, LY); this.stars.material.uniforms.uOp.value = fade(1, 2, D, 3e16, 5e17) || (D < 1 ? 1 : 0); }
    this.place(this.galaxy, this.galC, cam, S, LY); this.galaxy.material.uniforms.uOp.value = 0.12 + 0.6 * fade(1e15, 3e17, D, 1e21, 3e22); this.galaxy.material.uniforms.uSize.value = D < 1e17 ? 2.2 : 1.6;
    this.place(this.web, P.Sun, cam, S, LY); this.web.material.uniforms.uOp.value = 0.7 * fade(3e19, 1e21, D, 1e30, 1e31); this.web.visible = this.web.material.uniforms.uOp.value > 0.01;
    this.place(this.cmb, P.Sun, cam, S, 4.4e23); this.cmb.material.uniforms.uOp.value = 0.5 * fade(2e22, 3e23, D, 1e30, 1e31); this.cmb.visible = this.cmb.material.uniforms.uOp.value > 0.01;
    return D;
  }
  frame(dt) {
    if (this.rate) this.tOff += dt * 1000 * this.rate; const w = this.w, el = w.renderer.domElement, asp = el.clientWidth / Math.max(1, el.clientHeight); if (this.cam.aspect !== asp) { this.cam.aspect = asp; this.cam.updateProjectionMatrix(); }
    const ms = this.now(); this.positions(ms);
    if (this.fly) { const F = this.fly; F.t = Math.min(1, F.t + dt / F.dur); const e = F.t * F.t * (3 - 2 * F.t), to = this.pos[F.to] || F.b; F.cur = [0, 1, 2].map(i => F.a[i] + (to[i] - F.a[i]) * e);
      this.dist = Math.exp(Math.log(F.d0) + (Math.log(F.d1) - Math.log(F.d0)) * e + F.hump * Math.sin(Math.PI * e)); this.az = F.az0 + F.dAz * e; this.el = F.el0 + F.dEl * e; if (F.t >= 1) { this.focus = F.to; this.fly = null; } }
    if (this.autoSpin && !this.drag) this.az += dt * 0.03;
    const D = this.draw(ms, false), cam = this.camKm, f = this.focusPos();
    this.cam.position.set(0, 0, 0); this.cam.up.set(0, 1, 0); this.cam.lookAt((f[0] - cam[0]) * this.S, (f[1] - cam[1]) * this.S, (f[2] - cam[2]) * this.S);
    const fo = this.item(this.focus), minD = fo ? fo.R * 1.15 : 10; this.cam.near = Math.max(0.0005, 10 * (this.dist - (fo && fo.mesh ? fo.R : 0)) / this.dist * 0.2); this.cam.far = 2e5; this.cam.updateProjectionMatrix();
    w.renderer.render(this.scene, this.cam); this.labels(D, false); this.hud(D);
    // back down to the globe
    if (this.focus === 'Earth' && !this.fly && this.dist < 7.5 * ER) this.exit();
  }
  // the globe view draws the sky behind the Earth: same camera, Earth-centred
  renderBackground(gcam) {
    const ms = Date.now(), P = this.positions(ms), G = gmstDeg(ms) * D2R, v = gcam.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), G).multiplyScalar(ER);
    this.bgCam = [P.Earth[0] + v.x, P.Earth[1] + v.y, P.Earth[2] + v.z]; const D = this.draw(ms, true);
    this.cam.position.set(0, 0, 0); this.cam.quaternion.copy(gcam.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), G)); this.cam.fov = gcam.fov; this.cam.aspect = gcam.aspect; this.cam.near = 0.01; this.cam.far = 2e5; this.cam.updateProjectionMatrix();
    const r = this.w.renderer; r.render(this.scene, this.cam); this.labels(D, true); this.cam.fov = 45; this.cam.updateProjectionMatrix();
  }
  /* ---------------- labels, picking ---------------- */
  visibleItems(D, bg) { const out = [], el = this.w.renderer.domElement, rc = el.getBoundingClientRect(), v = new THREE.Vector3(), cam = this.camKm;
    this.cam.updateMatrixWorld();
    for (const o of this.items) { const p = this.pos[o.id]; if (!p || (bg && o.id === 'Earth')) continue; const isF = o.id === this.focus && !bg;
      if (!isF && o.show && (D < o.show[0] || D > o.show[1])) continue;
      if (bg) { const E = this.pos.Earth, c = [cam[0] - E[0], cam[1] - E[1], cam[2] - E[2]], d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]], a = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, b = 2 * (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]), cc = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - ER * ER, disc = b * b - 4 * a * cc; if (disc > 0 && (-b - Math.sqrt(disc)) > 0) continue; }
      const x = (p[0] - cam[0]) * this.S, y = (p[1] - cam[1]) * this.S, z = (p[2] - cam[2]) * this.S, L = Math.hypot(x, y, z); v.set(x, y, z); if (L > 8e4) v.multiplyScalar(8e4 / L); v.project(this.cam); if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      out.push({ o, sx: (v.x + 1) / 2 * rc.width + rc.left, sy: (1 - v.y) / 2 * rc.height + rc.top, pri: isF ? 0 : o.body ? 1 : o.kind === 'galaxy' ? 2 : 3, rpx: o.R * this.S / L * rc.height / (2 * Math.tan(this.cam.fov * D2R / 2)) }); }
    return out.sort((a, b) => a.pri - b.pri); }
  labels(D, bg) { const L = this.vis = this.visibleItems(D, bg), used = [], h = [];
    for (const it of L) { if (used.some(([x, y]) => Math.abs(x - it.sx) < 70 && Math.abs(y - it.sy) < 16)) continue; used.push([it.sx, it.sy]); if (used.length > 45) break; const o = it.o, nm = lang === 'km' && o.km ? o.km : t(o.name);
      h.push(`<span class="${o.id === this.focus && !bg ? 'f' : ''}" style="left:${it.sx.toFixed(0)}px;top:${(it.sy + Math.max(6, Math.min(it.rpx, 300))).toFixed(0)}px;color:${o.col}">${esc(nm)}</span>`); }
    this.labelBox.innerHTML = h.join(''); this.labelBox.hidden = false; }
  pick(e, bg) { if (!this.vis) return null; let best = null, bd = 22; for (const it of this.vis) { const d = Math.hypot(it.sx - e.clientX, it.sy - e.clientY) - Math.min(it.rpx || 0, 200); if (d < bd) { bd = d; best = it.o; } } return best; }
  /* ---------------- moving around ---------------- */
  enterFromGlobe(gcam, focusId) {
    const G = gmstDeg(this.now()) * D2R, v = gcam.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), G); this.tOff = 0; this.rate = 0;
    this.dist = v.length() * ER; this.az = Math.atan2(v.x, v.z); this.el = Math.asin(v.y / v.length()); this.focus = 'Earth'; this.active = true; this.positions(this.now());
    this.uiBox.hidden = false; document.body.classList.add('cosmos-on'); if (focusId && focusId !== 'Earth') this.goTo(focusId); this.g.onCosmos && this.g.onCosmos(true);
  }
  exit() { const G = gmstDeg(Date.now()) * D2R, ce = Math.cos(this.el), v = new THREE.Vector3(ce * Math.sin(this.az), Math.sin(this.el), ce * Math.cos(this.az)).multiplyScalar(Math.max(this.dist, 2 * ER) / ER).applyAxisAngle(new THREE.Vector3(0, 1, 0), -G);
    this.active = false; this.fly = null; this.tOff = 0; this.rate = 0; this.uiBox.hidden = true; this.g.cam.position.copy(v.setLength(Math.min(7.4, v.length()))); this.g.cam.lookAt(0, 0, 0); this.g.ctl.enabled = true; this.g.ctl.update(); document.body.classList.remove('cosmos-on'); this.card(null); this.g.onCosmos && this.g.onCosmos(false); }
  goTo(id) { const o = this.item(id); if (!o) return; this.positions(this.now()); const a = this.focusPos().slice(), b = this.pos[id], sep = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), d0 = this.dist, d1 = Math.max(o.view, o.R * 3);
    const hump = Math.max(0, Math.log(sep * 1.4 / Math.max(d0, d1))); let az1 = this.az, el1 = this.el; if (o.body && id !== 'Sun' && id !== 'Earth') { const s = new THREE.Vector3(-b[0], -b[1], -b[2]).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6); az1 = Math.atan2(s.x, s.z); el1 = Math.max(-0.5, Math.min(0.5, Math.asin(s.y) + 0.25)); } // look at the sunlit side
    let dAz = ((az1 - this.az) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.fly = { a, b, to: id, cur: a, t: 0, d0, d1, hump, dur: 2.2 + Math.min(4, hump * 0.35), az0: this.az, dAz, el0: this.el, dEl: el1 - this.el }; this.card(o); }
  events() {
    const el = this.w.renderer.domElement, pts = new Map(); let down = null, pinch = 0;
    el.addEventListener('wheel', e => { if (!this.active) return; e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0016)); }, { passive: false });
    el.addEventListener('pointerdown', e => { if (!this.g.on) return; pts.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, t: performance.now(), m: 0 }; if (this.active) { this.drag = true; el.setPointerCapture && el.setPointerCapture(e.pointerId); } });
    el.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const [px, py] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (down) down.m += Math.hypot(e.clientX - px, e.clientY - py); if (!this.active) return;
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.zoom(pinch / d); pinch = d; return; }
      this.az -= (e.clientX - px) * 0.005; this.el = Math.max(-1.55, Math.min(1.55, this.el + (e.clientY - py) * 0.005)); });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; this.drag = pts.size > 0; if (!down || !this.g.on || (this.g.sv && this.g.sv.active)) { down = null; return; } const click = down.m < 6 && performance.now() - down.t < 500; down = null; if (!click) return;
      const o = this.pick(e, !this.active); if (!o) return; if (this.active) this.goTo(o.id); else if (!this.g.anim) { this.enterFromGlobe(this.g.cam, o.id); } };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  zoom(f) { if (this.fly) return; const fo = this.item(this.focus), min = fo ? fo.R * 1.2 : 1; this.dist = Math.max(min, Math.min(1.5e24, this.dist * f)); }
  /* ---------------- HTML ---------------- */
  ui() {
    const d = this.uiBox = document.createElement('div'); d.className = 'cosUI'; d.hidden = true;
    d.innerHTML = `<div class="cosTop"><input id="cosFind" placeholder="🔎 ${t('Planet, star, galaxy…')}" autocomplete="off"><div id="cosFound"></div></div>
      <div class="cosJump">${[['Earth', '🌍'], ['Moon', '🌙'], ['Sun', '☀️'], ['Mars', '🔴'], ['Jupiter', '🟠'], ['Saturn', '🪐'], ['Alpha Centauri A', '⭐'], ['Milky Way', '🌌'], ['Andromeda Galaxy', '🌀'], ['Observable universe', '🔭']].map(([id, i]) => `<button data-go="${id}" title="${esc(t(id))}">${i}</button>`).join('')}</div>
      <div class="cosCard" id="cosCard" hidden></div>
      <div class="cosBottom"><div class="cosScale"><i id="cosBar"></i><span id="cosScaleT"></span><b id="cosLevel"></b></div>
        <div class="cosTime"><button data-rate="0" title="${t('Pause')}">⏸</button><button data-rate="1" title="${t('Real time')}">▶</button><button data-rate="3600">1 h/s</button><button data-rate="86400">1 ${t('day')}/s</button><button data-rate="2592000">1 ${t('month')}/s</button><button data-rate="31557600">1 ${t('year')}/s</button><button id="cosNow" title="${t('Now')}">⟲</button><span id="cosDate"></span></div>
        <div class="cosNote">${t('Planets: JPL orbital elements · stars: Yale Bright Star Catalogue · the Milky Way, galaxy shapes and the cosmic web are illustrations.')} ${t('Surface maps: Solar System Scope (CC BY 4.0), from NASA data.')}</div></div>
      <button class="cosBack" id="cosBack">🌍 ${t('Back to Earth')}</button>`;
    document.body.appendChild(d);
    d.querySelectorAll('[data-go]').forEach(b => b.onclick = () => this.goTo(b.dataset.go));
    d.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => { this.rate = +b.dataset.rate; d.querySelectorAll('[data-rate]').forEach(x => x.classList.toggle('on', x === b)); });
    d.querySelector('#cosNow').onclick = () => { this.tOff = 0; this.rate = 1; };
    d.querySelector('#cosBack').onclick = () => { if (this.focus === 'Earth' && !this.fly) this.exit(); else { this.goTo('Earth'); this.fly.d1 = 6 * ER; } };
    const f = d.querySelector('#cosFind'), box = d.querySelector('#cosFound');
    f.oninput = () => { const q = f.value.trim().toLowerCase(); if (!q) { box.innerHTML = ''; return; } const L = this.items.filter(o => (o.name + ' ' + (o.km || '') + ' ' + t(o.name)).toLowerCase().includes(q)).slice(0, 10);
      box.innerHTML = L.map(o => `<div data-f="${esc(o.id)}" style="color:${o.col}">${esc(lang === 'km' && o.km ? o.km : t(o.name))} <em>${t(this.kindName(o.kind))}</em></div>`).join('') || `<div>${t('Nothing found')}</div>`;
      box.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { this.goTo(x.dataset.f); f.value = ''; box.innerHTML = ''; }); };
  }
  kindName(k) { return { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', probe: 'Space probe', galaxy: 'Galaxy', gcluster: 'Galaxy cluster', cluster: 'Star cluster', nebula: 'Nebula', blackhole: 'Black hole', quasar: 'Quasar', universe: 'Universe' }[k] || k; }
  card(o) { const c = this.uiBox.querySelector('#cosCard'); this.cardO = o; if (!o) { c.hidden = true; return; } c.hidden = false; this.cardT = 0; this.updCard(); }
  updCard() { const o = this.cardO, c = this.uiBox.querySelector('#cosCard'); if (!o || c.hidden) return; const p = this.pos[o.id], e = this.pos.Earth, dk = p && e ? Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]) : 0, lt = lightTime(dk);
    c.innerHTML = `<div class="cosCh"><b style="color:${o.col}">${esc(lang === 'km' && o.km ? o.km : t(o.name))}</b>${o.km && lang !== 'km' ? ` <span>${esc(o.km)}</span>` : ''}<button id="cosCardX">✕</button></div><div class="cosK">${t(this.kindName(o.kind))}</div>
      ${o.id !== 'Earth' && o.id !== 'Observable universe' ? `<div>📏 ${t('Distance from Earth')}: <b>${fmtKm(dk)}</b>${lt ? ` · ${t('light takes')} ${lt}` : ''}</div>` : ''}${o.body || o.kind === 'star' ? `<div>⭕ ${t('Radius')}: ${fmtKm(o.R)}${o.id !== 'Earth' ? ` (${(o.R / ER).toFixed(o.R / ER < 10 ? 2 : 0)} × ${t('Earth')})` : ''}</div>` : ''}
      ${o.info ? `<div class="cosInfo">${esc(t(o.info))}</div>` : ''}`;
    c.querySelector('#cosCardX').onclick = () => this.card(null); }
  hud(D) { this.cardT = (this.cardT || 0) + 1; if (this.cardT % 15 === 1) this.updCard(); const el = this.w.renderer.domElement, px = 120, km = 2 * this.dist * Math.tan(this.cam.fov * D2R / 2) * px / el.clientHeight;
    const n = Math.pow(10, Math.floor(Math.log10(km))), nice = [1, 2, 5].map(k => k * n).filter(v => v <= km).pop() || n; this.uiBox.querySelector('#cosBar').style.width = (nice / km * px).toFixed(0) + 'px'; this.uiBox.querySelector('#cosScaleT').textContent = fmtKm(nice);
    const fo = this.item(this.focus); this.uiBox.querySelector('#cosLevel').textContent = fo && fo.body && D < fo.R * 60 ? (lang === 'km' && fo.km ? fo.km : t(fo.name)) : t(SCALES.find(([v]) => D < v)[1]); const dt = new Date(this.now()); this.uiBox.querySelector('#cosDate').textContent = dt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  hideLabels() { this.labelBox.hidden = true; this.uiBox.hidden = true; }
}
