// Layer explorer: pull the landscape apart into an animated exploded stack.
// Above-ground layers (water, roads, plants, buildings, traffic) rise; derived map layers (land cover,
// elevation, soil, geology) sink below the imagery surface. A level bar picks / isolates a layer.
import * as THREE from 'three';
import { UNITS, SOIL_CLASSES, geologyAt, soilAt } from './section.js?v=17';

export const LAYERS = [
  { id: 'traffic', name: 'Traffic & people', c: '#ff8a3d', side: 1, on: true },
  { id: 'buildings', name: 'Buildings', c: '#e9e4d8', side: 1, on: true },
  { id: 'trees', name: 'Trees & plants', c: '#3f8f3a', side: 1, on: true },
  { id: 'roads', name: 'Roads, rail & bridges', c: '#f2c14e', side: 1, on: true },
  { id: 'water', name: 'Water', c: '#3d8fd1', side: 1, on: true },
  { id: 'surface', name: 'Satellite surface', c: '#9fb7a0', side: 0, on: true },
  { id: 'lulc', name: 'Land cover (classified)', c: '#7fb85a', side: -1, on: true },
  { id: 'elev', name: 'Elevation & contours', c: '#d9b36a', side: -1, on: true },
  { id: 'topsoil', name: 'Topsoil 15–30 cm', c: '#a8835a', side: -1, on: true, under: true },
  { id: 'subsoil', name: 'Subsoil 100–200 cm', c: '#8a5a3c', side: -1, on: true, under: true },
  { id: 'geology', name: 'Geology (rock units)', c: '#d89c78', side: -1, on: true, under: true },
];
const LULC_PAL = { 0: [200, 200, 205], 1: [52, 120, 190], 2: [34, 110, 40], 3: [150, 196, 82], 4: [196, 140, 90], 5: [190, 186, 178] };
export const LULC_NAMES = { 1: 'Water', 2: 'Tree canopy', 3: 'Crop / grass', 4: 'Bare soil', 5: 'Built / roads', 0: 'Cloud (unknown)' };

const ease = t => t * t * (3 - 2 * t);
function label(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = 'rgba(17,23,31,.82)'; g.beginPath(); g.roundRect(4, 14, 504, 68, 18); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(46, 48, 16, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = '600 34px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(text, 76, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 10; s.center.set(0, 0.5); return s;
}

export class LayerStack {
  constructor(world) {
    this.w = world; this.t = 0; this.target = 0; this.state = Object.fromEntries(LAYERS.map(l => [l.id, { on: l.on, op: 1 }]));
    this.focus = null; this.tex = {}; this.objs = {}; this.extra = null;
  }
  dispose() { if (this.extra) { this.w.root.remove(this.extra); this.extra = null; } for (const t of Object.values(this.tex)) t.dispose(); this.tex = {}; }
  /* ---- textures (planar over the AOI: u = x, v = z) ---- */
  texLulc() {
    const D = this.w.D, c = document.createElement('canvas'); c.width = D.gw; c.height = D.gh; const g = c.getContext('2d'), im = g.createImageData(D.gw, D.gh);
    for (let i = 0; i < D.cls.length; i++) { const p = LULC_PAL[D.cls[i]] || LULC_PAL[0]; im.data.set([p[0], p[1], p[2], 255], i * 4); }
    g.putImageData(im, 0, 0); return c;
  }
  texElev() {
    const w = this.w, D = w.D, N = 768, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), im = g.createImageData(N, N);
    const E = new Float32Array(N * N); let lo = 1e9, hi = -1e9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const e = w.rawElevation(D.X0 + (i + .5) / N * D.W, D.Z0 + (j + .5) / N * D.H); E[j * N + i] = e; lo = Math.min(lo, e); hi = Math.max(hi, e); }
    const rng = Math.max(1, hi - lo), step = [1, 2, 5, 10, 20, 25, 50, 100].find(v => rng / v <= 14) || 200;
    const ramp = [[0, [38, 115, 77]], [.25, [122, 170, 90]], [.5, [235, 220, 140]], [.75, [200, 140, 80]], [1, [150, 100, 90]]];
    const col = f => { for (let k = 1; k < ramp.length; k++) if (f <= ramp[k][0]) { const [a, A] = ramp[k - 1], [b, B] = ramp[k], u = (f - a) / (b - a); return A.map((v, q) => v + (B[q] - v) * u); } return ramp[4][1]; };
    const px = D.W / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, e = E[k], ex = E[j * N + Math.min(N - 1, i + 1)] - E[j * N + Math.max(0, i - 1)], ez = E[Math.min(N - 1, j + 1) * N + i] - E[Math.max(0, j - 1) * N + i];
      const sh = THREE.MathUtils.clamp(0.82 + (-ex + ez) / (2 * px) * 1.6, 0.45, 1.25), lvl = Math.floor(e / step);
      const ct = i < N - 1 && j < N - 1 && (Math.floor(E[k + 1] / step) !== lvl || Math.floor(E[k + N] / step) !== lvl), major = ct && (lvl * step) % (step * 5) === 0;
      const cc = col((e - lo) / rng).map(v => v * sh * (ct ? (major ? 0.45 : 0.68) : 1));
      im.data.set([cc[0], cc[1], cc[2], 255], k * 4);
    }
    g.putImageData(im, 0, 0); this.elevInfo = { lo, hi, step }; return c;
  }
  texUnder(kind) {
    const w = this.w, D = w.D, U = w.U, N = 384, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), im = g.createImageData(N, N), ids = new Uint8Array(N * N);
    const found = new Set();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lon = w.F.lon(D.X0 + (i + .5) / N * D.W), lat = w.F.lat(D.Z0 + (j + .5) / N * D.H); let hex;
      if (kind === 'geology') { const u = geologyAt(U, lon, lat); ids[j * N + i] = u; hex = (UNITS[u] || UNITS[0]).c; found.add(u); }
      else { const s = soilAt(U, lon, lat, kind === 'topsoil' ? 2 : 5); hex = s.color; found.add(s.cls); ids[j * N + i] = Object.keys(SOIL_CLASSES).indexOf(s.cls); }
      const C = new THREE.Color(hex); im.data.set([C.r * 255, C.g * 255, C.b * 255, 255], (j * N + i) * 4);
    }
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; if (ids[k] !== ids[k + 1] || ids[k] !== ids[k + N]) for (let q = 0; q < 3; q++) im.data[k * 4 + q] *= 0.55; }
    g.putImageData(im, 0, 0); return { c, found: [...found] };
  }
  /* ---- build the extra slabs (planar-UV copy of the terrain) ---- */
  async rebuild() {
    const w = this.w, D = w.D; if (!D || !w.terrainMesh) return; this.dispose();
    const grp = this.extra = new THREE.Group(); w.root.add(grp);
    const geo = w.terrainMesh.geometry.clone(), P = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) - D.X0) / D.W, 1 - (P.getZ(i) - D.Z0) / D.H);
    uv.needsUpdate = true; this.slabGeo = geo;
    const mk = (id, canvas) => {
      const t = this.tex[id] = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.flipY = true; t.anisotropy = 4;
      if (id === 'lulc') t.magFilter = THREE.NearestFilter;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1 }));
      m.receiveShadow = true; m.visible = false; grp.add(m); return m;
    };
    this.objs = {};
    this.slab = { lulc: mk('lulc', this.texLulc()), elev: mk('elev', this.texElev()) };
    this.legend = { lulc: [...new Set(D.cls)].sort().map(k => [LULC_NAMES[k], `rgb(${LULC_PAL[k]})`]) };
    // outline (frame) for every slab
    const ring = []; const n = 120, { X0, Z0, W, H } = D;
    const edge = (ax, az, bx, bz) => { for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; ring.push(new THREE.Vector3(x, w.hAt(x, z) + 0.4, z)); } };
    edge(X0, Z0, X0 + W, Z0); edge(X0 + W, Z0, X0 + W, Z0 + H); edge(X0 + W, Z0 + H, X0, Z0 + H); edge(X0, Z0 + H, X0, Z0);
    this.ringGeo = new THREE.BufferGeometry().setFromPoints(ring);
    this.frames = {}; this.labels = {};
    const ext = Math.max(W, H);
    for (const L of LAYERS) {
      const f = new THREE.LineLoop(this.ringGeo, new THREE.LineBasicMaterial({ color: L.c, transparent: true })); f.visible = false; grp.add(f); this.frames[L.id] = f;
      const s = label(L.name, L.c); s.scale.set(ext * 0.26, ext * 0.26 * 96 / 512, 1); s.visible = false; grp.add(s); this.labels[L.id] = s;
    }
    this.posts = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: ext * 0.012, gapSize: ext * 0.01, transparent: true, opacity: 0.55 }));
    this.posts.visible = false; grp.add(this.posts);
    this.collect();
    if (w.U) this.buildUnder();
    this.apply(true);
  }
  buildUnder() {
    const w = this.w; if (!w.U || !this.extra || this.slab.geology) return;
    for (const id of ['topsoil', 'subsoil', 'geology']) {
      if (id !== 'geology' && !w.U.soilOk) continue;
      const r = this.texUnder(id), t = this.tex[id] = new THREE.CanvasTexture(r.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const m = new THREE.Mesh(this.slabGeo, new THREE.MeshStandardMaterial({ map: t, roughness: 1, side: THREE.DoubleSide })); m.receiveShadow = true; m.visible = false; this.extra.add(m); this.slab[id] = m;
      this.legend[id] = id === 'geology' ? r.found.map(u => [(UNITS[u] || UNITS[0]).n, (UNITS[u] || UNITS[0]).c]) : r.found.map(s => [s, SOIL_CLASSES[s]]);
    }
    this.collect(); this.apply(true);
  }
  // which scene objects belong to which layer
  collect() {
    const w = this.w, o = this.objs = {};
    o.surface = [w.terrainMesh];
    o.water = [w.waterMesh].filter(Boolean);
    o.roads = [w.roadMesh, w.railMesh, w.bridgeMesh].filter(Boolean);
    o.buildings = [w.buildingsMesh].filter(Boolean);
    o.trees = [...(w.treeMeshes || []), w.grass && w.grass.group].filter(Boolean);
    o.traffic = [...(w.vehMeshes || []).flatMap(g => [g.paint, g.fixed]), ...Object.values(w.pm || {})].filter(Boolean);
    for (const k in this.slab || {}) o[k] = [this.slab[k]];
    for (const L of LAYERS) for (const m of o[L.id] || []) if (m.userData.base == null) m.userData.base = m.position.y;
  }
  available(id) { return !!(this.objs[id] && this.objs[id].length); }
  /* ---- layout ---- */
  layout() {
    const D = this.w.D, gap = Math.max(D.W, D.H) * 0.11, up = LAYERS.filter(l => l.side > 0 && this.state[l.id].on && this.available(l.id)).reverse(),
      down = LAYERS.filter(l => l.side < 0 && this.state[l.id].on && this.available(l.id));
    const off = { surface: 0 }; up.forEach((l, i) => off[l.id] = (i + 1) * gap); down.forEach((l, i) => off[l.id] = -(i + 1) * gap);
    return { off, gap, top: up.length * gap, bot: -down.length * gap };
  }
  apply(force) {
    const w = this.w; if (!w.D || !this.extra) return;
    const e = ease(this.t), { off, top, bot } = this.layout(), exploded = e > 0.002, D = w.D;
    for (const L of LAYERS) {
      const st = this.state[L.id], y = (off[L.id] || 0) * e, objs = this.objs[L.id] || [];
      const show = st.on && (L.side >= 0 || exploded) && (L.side >= 0 || L.id in off);
      const dim = this.focus && this.focus !== L.id ? 0.18 : 1, op = st.op * dim;
      for (const m of objs) { m.position.y = (m.userData.base || 0) + y; if (L.id !== 'trees' || m !== (w.grass && w.grass.group)) m.visible = show; this.setOpacity(m, op); }
      const fr = this.frames[L.id], lb = this.labels[L.id];
      if (fr) { fr.visible = exploded && show && objs.length > 0; fr.position.y = y; fr.material.opacity = Math.min(1, e * 1.5) * dim; }
      if (lb) { lb.visible = exploded && show && objs.length > 0; lb.position.set(D.X0 + D.W * 1.03, w.hAt(D.X0 + D.W, D.Z0 + D.H * 0.5) + y + 2, D.Z0 + D.H * 0.5); lb.material.opacity = Math.min(1, e * 1.5) * (this.focus && this.focus !== L.id ? 0.4 : 1); }
    }
    if (w.grass) w.grassOff = exploded || w._grassUserOff || !this.state.trees.on; // grass follows the viewer, hide it while exploded
    // block sides / base and cut walls only make sense when collapsed
    for (const m of [w.sidesMesh && !w.sideWalls ? w.sidesMesh : null, w.basePlate, ...(w.sideWalls || []), w.sectionGroup].filter(Boolean)) m.visible = !exploded;
    if (w.sidesMesh && w.sideWalls) w.sidesMesh.visible = false;
    // dashed corner posts
    if (exploded) {
      const pts = [], { X0, Z0, W, H } = D;
      for (const [x, z] of [[X0, Z0], [X0 + W, Z0], [X0 + W, Z0 + H], [X0, Z0 + H]]) { const h = w.hAt(x, z); pts.push(x, h + bot * e, z, x, h + top * e, z); }
      this.posts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); this.posts.computeLineDistances(); this.posts.visible = true;
    } else this.posts.visible = false;
    if (exploded !== this._wasExploded || force) {
      this._wasExploded = exploded;
      if (exploded) { this._shadow = w.sun.castShadow; w.sun.castShadow = false; this._refl = w.reflectOn; w.reflectOn = false; }
      else if (this._shadow != null) { w.sun.castShadow = this._shadow; w.reflectOn = this._refl; this._shadow = null; }
    }
  }
  setOpacity(m, op) {
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    if (!mats.length && m.children) { m.children.forEach(c => this.setOpacity(c, op)); return; }
    for (const mt of mats) {
      if (mt.userData.op0 == null) { mt.userData.op0 = mt.opacity; mt.userData.tr0 = mt.transparent; mt.userData.dw0 = mt.depthWrite; }
      const want = mt.userData.op0 * op, tr = mt.userData.tr0 || op < 0.999;
      if (mt.opacity !== want || mt.transparent !== tr) { mt.opacity = want; if (mt.transparent !== tr) { mt.transparent = tr; mt.needsUpdate = true; } mt.depthWrite = op < 0.999 ? op > 0.5 : mt.userData.dw0; }
    }
  }
  /* ---- animation, called every frame ---- */
  step(dt) {
    if (!this.extra) return;
    let changed = false;
    if (this.t !== this.target) { const d = Math.sign(this.target - this.t) * dt / 1.4; this.t = Math.abs(this.target - this.t) <= Math.abs(d) ? this.target : this.t + d; changed = true; }
    if (this.tour) {
      this.tour.time += dt;
      if (this.t === this.target && this.tour.time > 2.6) {
        this.tour.time = 0; const ids = this.order(); this.tour.i = (this.tour.i + 1) % (ids.length + 1);
        this.focus = this.tour.i < ids.length ? ids[this.tour.i] : null; this.onFocus && this.onFocus(this.focus); changed = true;
      }
    }
    if (changed || this.dirty) { this.dirty = false; this.apply(); this.onT && this.onT(this.t); }
  }
  order() { return LAYERS.filter(l => this.state[l.id].on && this.available(l.id)).map(l => l.id); }
  setExplode(v, instant) { this.target = v; if (instant) { this.t = v; this.apply(); } }
  setOn(id, on) { this.state[id].on = on; this.dirty = true; }
  setOp(id, op) { this.state[id].op = op; this.dirty = true; }
  setFocus(id) { this.focus = this.focus === id ? null : id; this.dirty = true; return this.focus; }
  frameCamera() {
    const w = this.w, D = w.D, { top, bot } = this.layout(), ext = Math.max(D.W, D.H), mid = (top + bot) / 2 + w.hAt(D.X0 + D.W / 2, D.Z0 + D.H / 2);
    const tgt = new THREE.Vector3(D.X0 + D.W * 0.6, mid, D.Z0 + D.H / 2), dir = new THREE.Vector3(-0.6, 0.25, 1).normalize();
    w.flight = { t: 0, p0: w.camera.position.clone(), q0: w.controls.target.clone(), p1: tgt.clone().addScaledVector(dir, ext * 1.5 + (top - bot)), q1: tgt };
  }
  play() { this.setExplode(1); this.frameCamera(); this.tour = { i: -1, time: 0 }; this.w.controls.autoRotate = true; this.w.controls.autoRotateSpeed = 0.6; }
  stop() { this.tour = null; this.w.controls.autoRotate = false; this.focus = null; this.dirty = true; this.onFocus && this.onFocus(null); }
}
