// Layer explorer: pull the landscape apart into an animated exploded stack.
// Above-ground layers (water, roads, plants, buildings, traffic) rise; derived map layers (land cover,
// elevation, soil, geology) sink below the imagery surface. A level bar picks / isolates a layer.
import * as THREE from 'three';
import { UNITS, SOIL_CLASSES, geologyAt, soilAt } from './section.js?v=69';
import { LC } from './landcover.js?v=69';

export const LAYERS = [
  { id: 'traffic', short: 'Traffic & people', name: 'Traffic & people', c: '#ff8a3d', side: 1, on: true },
  { id: 'buildings', short: 'Buildings', name: 'Buildings', c: '#e9e4d8', side: 1, on: true },
  { id: 'trees', short: 'Trees & plants', name: 'Trees & plants', c: '#3f8f3a', side: 1, on: true },
  { id: 'roads', short: 'Roads & rail', name: 'Roads, rail & bridges', c: '#f2c14e', side: 1, on: true },
  { id: 'water', short: 'Water (OSM)', name: 'Water', c: '#3d8fd1', side: 1, on: true },
  { id: 'surface', short: 'Satellite surface', name: 'Satellite surface', c: '#9fb7a0', side: 0, on: true },
  { id: 'lulc', short: 'Land cover (13 classes)', name: 'Land cover (13 classes, editable with 🖌️)', c: '#7fb85a', side: -1, on: true },
  { id: 'lctime', short: 'Land cover 2017–25', name: 'Land cover 2017–2025', c: '#e49635', side: -1, on: true, under: true },
  { id: 'elev', short: 'Elevation', name: 'Elevation & contours', c: '#d9b36a', side: -1, on: true },
  { id: 'topsoil', short: 'Topsoil 15–30 cm', name: 'Topsoil 15–30 cm', c: '#a8835a', side: -1, on: true, under: true },
  { id: 'subsoil', short: 'Subsoil 1–2 m', name: 'Subsoil 100–200 cm', c: '#8a5a3c', side: -1, on: true, under: true },
  { id: 'geology', short: 'Geology', name: 'Geology (rock units)', c: '#d89c78', side: -1, on: true, under: true },
  { id: 'deep', short: 'Deep Earth', name: 'Deep Earth: crust → core', c: '#f2c14e', side: -1, on: true },
];
// thickness of each sunk slab, as a share of the spacing (soil and rock look like real blocks)
const THICK = { lulc: 0.05, lctime: 0.05, elev: 0.05, topsoil: 0.14, subsoil: 0.22, geology: 0.38 };
// Esri / Impact Observatory 10 m annual land cover (Sentinel-2), 2017–2025
const IO = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';
export const IO_CLASSES = { 1: ['Water', '#419bdf'], 2: ['Trees', '#397d49'], 4: ['Flooded vegetation', '#7a87c6'], 5: ['Crops', '#e49635'], 7: ['Built area', '#c4281b'],
  8: ['Bare ground', '#a59b8f'], 9: ['Snow / ice', '#a8ebff'], 10: ['Clouds', '#616161'], 11: ['Rangeland', '#e3e2c3'] };
export const IO_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
// Earth's interior, depth in metres (log scale on the block)
const DEEP = [
  [0, 2, 'Soil', '#8a5a3c'], [2, 8, 'Weathered rock (saprolite)', '#c49a6c'], [8, 15000, 'Upper crust: sediments, sandstone, granite', '#b0967a'],
  [15000, 33000, 'Lower crust (Moho ≈ 30–35 km)', '#8a7466'], [33000, 100000, 'Lithospheric mantle', '#6f8a5c'], [100000, 410000, 'Asthenosphere (soft mantle)', '#c46a3a'],
  [410000, 660000, 'Mantle transition zone', '#d9873f'], [660000, 2891000, 'Lower mantle', '#e0a24a'], [2891000, 5150000, 'Outer core (liquid iron)', '#f2c14e'], [5150000, 6371000, 'Inner core (solid iron)', '#fff1a8'],
];
const depthFrac = d => Math.log10(d + 1) / Math.log10(6371001);
const fmtD = d => d >= 1000 ? (d / 1000).toLocaleString() + ' km' : d + ' m';
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
    this.focus = null; this.tex = {}; this.objs = {}; this.extra = null; this.gapK = 0.11; this.year = 2025; this.change = false; this.flood = null;
  }
  dispose() { if (this.extra) { this.w.root.remove(this.extra); this.extra = null; } for (const t of Object.values(this.tex)) if (t.dispose) t.dispose(); this.tex = {}; this.ioTex = null; this.slab = {}; }
  /* ---- textures (planar over the AOI: u = x, v = z) ---- */
  lulcLegend() { const D = this.w.D; if (!D.lc) return [...new Set(D.cls)].sort().map(k => [LULC_NAMES[k], `rgb(${LULC_PAL[k]})`]); return Object.keys(D.lcPct || {}).map(Number).filter(k => k > 0 && D.lcPct[k] > 0.001).sort((a, b) => a - b).map(k => [LC[k].en, LC[k].c]); }
  // after land-cover training: redraw the land-cover slab from the edited classes
  refreshLulc() { const t = this.tex && this.tex.lulc; if (!t) return; const c = this.texLulc(); t.image = c; t.needsUpdate = true; if (this.legend) this.legend.lulc = this.lulcLegend(); }
  texLulc() {
    const D = this.w.D, c = document.createElement('canvas'); c.width = D.gw; c.height = D.gh; const g = c.getContext('2d'), im = g.createImageData(D.gw, D.gh);
    const src = D.lc || D.cls, rgb = {}; for (const k in LC) { const h = LC[k].c; rgb[k] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    for (let i = 0; i < src.length; i++) { const p = D.lc ? (rgb[src[i]] || [200, 200, 205]) : (LULC_PAL[src[i]] || LULC_PAL[0]); im.data.set([p[0], p[1], p[2], 255], i * 4); }
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
    this.legend = { lulc: this.lulcLegend() };
    this.slab = { lulc: mk('lulc', this.texLulc()), elev: mk('elev', this.texElev()) };
    this.mkSlab = mk; this.buildDeep(); this.buildFlood();

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
    this.secLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe14a, depthTest: false, transparent: true }));
    this.secLines.renderOrder = 9; this.secLines.visible = false; grp.add(this.secLines);
    this.secCurtain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    this.secCurtain.visible = false; grp.add(this.secCurtain);
    this.collect();
    if (w.U) this.buildUnder();
    if (this.ioYears) this.makeTimeSlab();
    this.skirts(); this.apply(true);
  }
  /* ---- thick blocks: side walls hanging under each sunk slab, coloured from its own edge ---- */
  skirts() {
    const D = this.w.D, gap = Math.max(D.W, D.H) * this.gapK;
    for (const [id, m] of Object.entries(this.slab || {})) {
      if (!THICK[id]) continue;
      if (m.userData.skirt) { m.remove(m.userData.skirt); m.userData.skirt.geometry.dispose(); }
      const P = this.ringGeo.attributes.position, th = gap * THICK[id], pos = [], uv = [], idx = [];
      for (let i = 0; i <= P.count; i++) {
        const k = i % P.count, x = P.getX(k), y = P.getY(k) - 0.4, z = P.getZ(k), u = (x - D.X0) / D.W, v = 1 - (z - D.Z0) / D.H;
        pos.push(x, y, z, x, y - th, z); uv.push(u, v, u, v);
        if (i < P.count) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const sk = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: m.material.map, roughness: 1, side: THREE.DoubleSide, color: 0xb8b0a8 }));
      m.add(sk); m.userData.skirt = sk;
    }
  }
  /* ---- deep Earth block: log-depth column from soil to the inner core ---- */
  buildDeep() {
    const D = this.w.D, w = this.w, c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const g = c.getContext('2d');
    const gid = w.U ? geologyAt(w.U, w.F.lon(D.X0 + D.W / 2), w.F.lat(D.Z0 + D.H / 2)) : 0, geoName = gid ? UNITS[gid].n : null;
    DEEP.forEach(([a, b, n, col], i) => {
      const y0 = depthFrac(a) * c.height, y1 = depthFrac(b) * c.height; g.fillStyle = col; g.fillRect(0, y0, c.width, y1 - y0 + 1);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y1 - 2, c.width, 3);
      const fs = Math.max(18, Math.min(44, (y1 - y0) * 0.55)); g.font = `600 ${fs}px system-ui, sans-serif`; g.textBaseline = 'middle';
      const label = (i === 2 && geoName ? `Upper crust (here: ${geoName})` : n) + `   ${fmtD(a)} – ${fmtD(b)}`;
      g.fillStyle = i >= 7 ? '#3a2a10' : '#fff'; g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = i >= 7 ? 0 : 4;
      if (y1 - y0 >= 20) { g.fillText(label, 40, (y0 + y1) / 2); g.textAlign = 'right'; g.fillText(label, c.width - 40, (y0 + y1) / 2); g.textAlign = 'left'; }
      g.shadowBlur = 0;
    });
    g.font = '24px system-ui'; g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'center';
    g.fillText('Depth on a logarithmic scale · surface to the centre of the Earth (6,371 km)', c.width / 2, c.height - 18); g.textAlign = 'left';
    const t = this.tex.deep = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const gap = Math.max(D.W, D.H) * this.gapK, Hd = gap * 2.4, box = new THREE.BoxGeometry(D.W, Hd, D.H);
    const side = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), top = new THREE.MeshStandardMaterial({ color: '#8a5a3c', roughness: 1 }), bot = new THREE.MeshStandardMaterial({ color: '#fff1a8', emissive: '#ffcf50', emissiveIntensity: 0.4 });
    const m = new THREE.Mesh(box, [side, side, top, bot, side, side]);
    const hc = Math.min(...[[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]].map(([u, v]) => w.hAt(D.X0 + D.W * u, D.Z0 + D.H * v)));
    m.position.set(D.X0 + D.W / 2, hc - Hd / 2, D.Z0 + D.H / 2); m.userData.base = m.position.y; m.visible = false;
    this.extra.add(m); this.slab.deep = m; this.deepH = Hd;
    this.legend.deep = DEEP.map(([a, b, n, c]) => [`${n} (${fmtD(a)}–${fmtD(b)})`, c]);
  }
  /* ---- flood level: a flat water sheet at a chosen elevation (bathtub model) ---- */
  buildFlood() {
    const D = this.w.D, m = new THREE.Mesh(new THREE.PlaneGeometry(D.W, D.H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d7fbf, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1, depthWrite: false }));
    m.position.set(D.X0 + D.W / 2, 0, D.Z0 + D.H / 2); m.visible = false; m.renderOrder = 2; this.floodMesh = m; this.extra.add(m);
    if (this.flood != null) this.setFlood(this.flood);
  }
  setFlood(level) {
    const w = this.w, D = w.D; this.flood = level; if (!this.floodMesh) return null;
    if (level == null) { this.floodMesh.visible = false; return null; }
    const base = Math.max(D.hmin, 0), exag = w.exag ?? 1; this.floodMesh.userData.base = (level - base) * exag; this.floodMesh.visible = true;
    let wet = 0, dsum = 0; for (const v of D.raw) if (v < level) { wet++; dsum += level - v; }
    this.dirty = true; return { pct: wet / D.raw.length * 100, depth: wet ? dsum / wet : 0 };
  }
  /* ---- land cover through time (Esri / Impact Observatory, 10 m) ---- */
  async loadTime(say) {
    if (this.ioYears || this._ioLoading) return; this._ioLoading = true;
    const w = this.w, a = w.D.aoi, GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm');
    const sz = Math.min(500, Math.max(64, Math.round(Math.max(w.D.W, w.D.H) / 10))), out = {};
    let n = 0;
    await Promise.all(IO_YEARS.map(async y => {
      const url = `${IO}/exportImage?bbox=${a.w},${a.s},${a.e},${a.n}&bboxSR=4326&imageSR=4326&size=${sz},${sz}&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor` +
        `&renderingRule=${encodeURIComponent('{"rasterFunction":"None"}')}&f=image&time=${Date.UTC(y, 6, 1)}`;
      try { const im = await (await GT.fromArrayBuffer(await (await fetch(url)).arrayBuffer())).getImage(); out[y] = { w: im.getWidth(), h: im.getHeight(), d: (await im.readRasters())[0] }; }
      catch (e) { console.warn('io lulc', y, e); }
      say && say(`Land cover through time ${++n}/${IO_YEARS.length}…`);
    }));
    this._ioLoading = false; if (!Object.keys(out).length) return;
    this.ioYears = out; this.makeTimeSlab(); this.collect(); this.skirts(); this.apply(true);
  }
  ioAt(y, lon, lat) { const R = this.ioYears[y]; if (!R) return 0; const a = this.w.D.aoi; const i = Math.min(R.w - 1, Math.max(0, Math.floor((lon - a.w) / (a.e - a.w) * R.w))), j = Math.min(R.h - 1, Math.max(0, Math.floor((a.n - lat) / (a.n - a.s) * R.h))); return R.d[j * R.w + i]; }
  ioCanvas(y, change) {
    const w = this.w, D = w.D, N = 384, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), im = g.createImageData(N, N), first = IO_YEARS.find(k => this.ioYears[k]);
    const counts = {};
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lon = w.F.lon(D.X0 + (i + .5) / N * D.W), lat = w.F.lat(D.Z0 + (j + .5) / N * D.H), v = this.ioAt(y, lon, lat); let col;
      if (change) { const v0 = this.ioAt(first, lon, lat); col = v0 === v ? '#5b5f63' : v0 === 2 ? '#e0312b' : v === 2 ? '#3cc34a' : v === 7 ? '#ff9f1c' : '#f0e35a'; counts[v0 === v ? 'same' : v0 === 2 ? 'treeloss' : v === 2 ? 'treegain' : v === 7 ? 'built' : 'other'] = 1; }
      else { col = (IO_CLASSES[v] || ['', '#000'])[1]; counts[v] = (counts[v] || 0) + 1; }
      const C = new THREE.Color(col); im.data.set([C.r * 255, C.g * 255, C.b * 255, 255], (j * N + i) * 4);
    }
    g.putImageData(im, 0, 0); return { c, counts };
  }
  makeTimeSlab() {
    if (!this.extra || !this.ioYears) return;
    if (!this.slab.lctime) { const m = this.slab.lctime = this.mkSlab('lctime', document.createElement('canvas')); m.material.map.magFilter = THREE.NearestFilter; }
    this.setYear(this.year, this.change);
  }
  setYear(y, change) {
    this.year = y; this.change = change; if (!this.slab.lctime) return;
    const key = (change ? 'c' : 'y') + y; this.ioTex = this.ioTex || {};
    if (!this.ioTex[key]) { const r = this.ioCanvas(y, change), t = new THREE.CanvasTexture(r.c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; this.ioTex[key] = { t, counts: r.counts }; this.tex[key] = t; }
    const { t, counts } = this.ioTex[key], m = this.slab.lctime; m.material.map = t; m.material.needsUpdate = true;
    if (m.userData.skirt) { m.userData.skirt.material.map = t; m.userData.skirt.material.needsUpdate = true; }
    const first = IO_YEARS.find(k => this.ioYears[k]);
    this.legend.lctime = change ? [[`Same as ${first}`, '#5b5f63'], [`Tree loss since ${first}`, '#e0312b'], ['New trees', '#3cc34a'], ['Became built-up', '#ff9f1c'], ['Other change', '#f0e35a']]
      : Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(k => [IO_CLASSES[k] ? IO_CLASSES[k][0] + ` ${(counts[k] / 384 / 3.84).toFixed(0)}%` : 'No data', (IO_CLASSES[k] || ['', '#000'])[1]]);
    this.dirty = true;
  }
  buildUnder() {
    const w = this.w; if (!w.U || !this.extra || this.slab.geology) return;
    for (const id of ['topsoil', 'subsoil', 'geology']) {
      if (id !== 'geology' && !w.U.soilOk) continue;
      const r = this.texUnder(id), t = this.tex[id] = new THREE.CanvasTexture(r.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const m = new THREE.Mesh(this.slabGeo, new THREE.MeshStandardMaterial({ map: t, roughness: 1, side: THREE.DoubleSide })); m.receiveShadow = true; m.visible = false; this.extra.add(m); this.slab[id] = m;
      this.legend[id] = id === 'geology' ? r.found.map(u => [(UNITS[u] || UNITS[0]).n, (UNITS[u] || UNITS[0]).c]) : r.found.map(s => [s, SOIL_CLASSES[s]]);
    }
    if (this.slab.deep) { this.extra.remove(this.slab.deep); this.slab.deep = null; this.buildDeep(); }
    this.collect(); this.apply(true);
  }
  // which scene objects belong to which layer
  collect() {
    const w = this.w, o = this.objs = {};
    o.surface = [w.terrainMesh, this.floodMesh].filter(Boolean);
    o.water = [w.waterMesh].filter(Boolean);
    o.roads = [w.roadMesh, w.railMesh, w.bridgeMesh].filter(Boolean);
    o.buildings = [w.buildingsMesh, w.housesMesh, w.editor && w.editor.group].filter(Boolean);
    o.trees = [...(w.treeMeshes || []), w.grass && w.grass.group].filter(Boolean);
    o.traffic = [...(w.vehMeshes || []).flatMap(g => [g.paint, g.fixed]), ...Object.values(w.pm || {})].filter(Boolean);
    for (const k in this.slab || {}) o[k] = [this.slab[k]];
    for (const L of LAYERS) for (const m of o[L.id] || []) if (m.userData.base == null) m.userData.base = m.position.y;
    if (this.floodMesh) this.floodMesh.userData.flood = true;
  }
  available(id) { return !!(this.objs[id] && this.objs[id].length); }
  /* ---- layout ---- */
  layout() {
    const D = this.w.D, gap = Math.max(D.W, D.H) * this.gapK, up = LAYERS.filter(l => l.side > 0 && this.state[l.id].on && this.available(l.id)).reverse(),
      down = LAYERS.filter(l => l.side < 0 && this.state[l.id].on && this.available(l.id));
    const off = { surface: 0 }; up.forEach((l, i) => off[l.id] = (i + 1) * gap);
    let y = 0; down.forEach(l => { y -= gap; off[l.id] = y; if (l.id !== 'deep') y -= gap * (THICK[l.id] || 0) * 0.6; });
    const bot = off.deep != null ? off.deep - (this.deepH || 0) : y;
    return { off, gap, top: up.length * gap, bot };
  }
  apply(force) {
    const w = this.w; if (!w.D || !this.extra) return;
    const e = ease(this.t), { off, top, bot } = this.layout(), exploded = e > 0.002, D = w.D;
    for (const L of LAYERS) {
      const st = this.state[L.id], y = (off[L.id] || 0) * e, objs = this.objs[L.id] || [];
      const show = st.on && (L.side >= 0 || exploded) && (L.side >= 0 || L.id in off);
      const dim = this.focus && this.focus !== L.id ? 0.18 : 1, op = st.op * dim;
      for (const m of objs) {
        m.position.y = (m.userData.base || 0) + y;
        if (m.userData.flood) { m.visible = show && this.flood != null; continue; }
        if (L.id !== 'trees' || m !== (w.grass && w.grass.group)) m.visible = show; this.setOpacity(m, op);
      }
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
    // the cross-section line cuts through every slab, with a light curtain joining them
    const sec = w.section;
    if (exploded && sec) {
      const lp = [], n = 80, { A, B } = sec;
      for (const L of LAYERS) {
        if (!(L.id in off) || !this.state[L.id].on || L.id === 'deep' || !(this.objs[L.id] || []).length) continue; const dy = off[L.id] * e;
        for (let k = 0; k < n; k++) for (const t of [k / n, (k + 1) / n]) { const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; lp.push(x, w.hAt(x, z) + dy + 1.2, z); }
      }
      this.secLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); this.secLines.visible = true;
      const h0 = w.hAt(A.x, A.z), h1 = w.hAt(B.x, B.z), lo = bot * e, hi = top * e;
      this.secCurtain.geometry.setAttribute('position', new THREE.Float32BufferAttribute([A.x, h0 + lo, A.z, B.x, h1 + lo, B.z, B.x, h1 + hi, B.z, A.x, h0 + lo, A.z, B.x, h1 + hi, B.z, A.x, h0 + hi, A.z], 3));
      this.secCurtain.visible = true;
    } else { this.secLines.visible = this.secCurtain.visible = false; }
    if (exploded !== this._wasExploded || force) {
      this._wasExploded = exploded;
      if (exploded) { this._shadow = w.sun.castShadow; w.sun.castShadow = false; this._refl = w.reflectOn; w.reflectOn = false; }
      else if (this._shadow != null) { w.sun.castShadow = this._shadow; w.reflectOn = this._refl; this._shadow = null; }
    }
  }
  setOpacity(m, op) {
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    if (m.children && m.children.length) m.children.forEach(c => this.setOpacity(c, op));
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
  flyToLayer(id) {
    const w = this.w, D = w.D, { off, gap } = this.layout(); if (!(id in off)) return;
    const ext = Math.max(D.W, D.H), y = off[id] * ease(this.target || this.t) + w.hAt(D.X0 + D.W / 2, D.Z0 + D.H / 2) - (id === 'deep' ? this.deepH / 2 : 0);
    const tgt = new THREE.Vector3(D.X0 + D.W / 2, y, D.Z0 + D.H / 2), dir = w.camera.position.clone().sub(w.controls.target); dir.y = Math.max(dir.y, 0); dir.normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    w.flight = { t: 0, p0: w.camera.position.clone(), q0: w.controls.target.clone(), p1: tgt.clone().addScaledVector(dir, ext * (id === 'deep' ? 1.5 : 1.15)), q1: tgt };
  }
  nudge(dx, dy) { // move the view: left/right in screen space, up/down along the stack
    const w = this.w, D = w.D, step = Math.max(D.W, D.H) * this.gapK * 0.6, v = new THREE.Vector3();
    if (dx) { v.setFromMatrixColumn(w.camera.matrix, 0); v.y = 0; v.normalize().multiplyScalar(dx * step); }
    if (dy) v.y += dy * step;
    w.flight = null; w.camera.position.add(v); w.controls.target.add(v);
  }
  zoom(f) { const w = this.w, d = w.camera.position.clone().sub(w.controls.target); w.flight = null; w.camera.position.copy(w.controls.target).addScaledVector(d, f); }
  setSpacing(k) { this.gapK = k; if (!this.extra) return; this.skirts(); const D = this.w.D; if (this.slab.deep) { this.extra.remove(this.slab.deep); this.slab.deep = null; this.buildDeep(); this.collect(); } this.dirty = true; }
  play() { this.setExplode(1); this.frameCamera(); this.tour = { i: -1, time: 0 }; this.w.controls.autoRotate = true; this.w.controls.autoRotateSpeed = 0.6; }
  stop() { this.tour = null; this.w.controls.autoRotate = false; this.focus = null; this.dirty = true; this.onFocus && this.onFocus(null); }
}
