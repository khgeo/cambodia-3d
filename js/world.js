// Builds a 3D landscape for one AOI: terrain + imagery drape, OSM roads/rail/water/buildings,
// trees placed from the imagery, and traffic.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './geo.js';
import { makeRoadMaterial, makeBuildingMaterial } from './shaders.js';
import { vehicleKit } from './vehicles.js';

const IMAGERY = {
  esri: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  google: { url: (z, x, y) => `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`, max: 20, credit: 'Imagery © Google' },
};
const TERRAIN_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const tick = () => new Promise(r => setTimeout(r, 0));
const V3 = THREE.Vector3;

/* ---------- road style rules ---------- */
// class codes from the tiler: 1 motorway 2 mw_link 3 trunk 4 trunk_link 5 primary 6 p_link 7 secondary 8 s_link
// 9 tertiary 10 t_link 11 unclassified 12 residential 13 living 14 service 15 pedestrian 16 track
// 17 footway 18 path 19 cycleway 20 steps 21 construction
const BASE_W = { 1: 7.6, 2: 5.2, 3: 10.5, 4: 5.2, 5: 9, 6: 5, 7: 8, 8: 4.8, 9: 6.5, 10: 4.5, 11: 5, 12: 4.6, 13: 4, 14: 3.4, 15: 5, 16: 3.2, 17: 1.8, 18: 1.4, 19: 2, 20: 2, 21: 6 };
const RANK = { 1: 10, 2: 7, 3: 9, 4: 7, 5: 8, 6: 6, 7: 7, 8: 5, 9: 6, 10: 4, 11: 4, 12: 3, 13: 3, 14: 2, 15: 2, 16: 1, 17: 1, 18: 0, 19: 1, 20: 0, 21: 2 };
// surface codes in the shader: 1 asphalt 2 concrete 3 paving 4 laterite 5 gravel 6 sand 7 grass 8 planks 9 track 10 rail 11 footpath
function roadStyle(cls, surf, lanes, widthDm, flags) {
  const oneway = flags & 1, urban = flags & 8;
  let s;
  if (surf === 1) s = 1; else if (surf === 2) s = 2; else if (surf === 3) s = 3; else if (surf === 4) s = 4; else if (surf === 5) s = 5;
  else if (surf === 6) s = 6; else if (surf === 7) s = 7; else if (surf === 8) s = 8;
  else if (cls <= 10 || cls === 21 && false) s = 1;
  else if (cls === 11) s = urban ? 1 : 4;
  else if (cls === 12 || cls === 14) s = urban ? 2 : 4;
  else if (cls === 13 || cls === 15) s = 3;
  else if (cls === 16) s = 9;
  else if (cls >= 17 && cls <= 20) s = urban ? 11 : 4;
  else s = 4;
  if (cls === 16 && (surf === 1 || surf === 2)) s = surf;
  let mk = 0, ln = lanes || 0;
  if (s === 1 || s === 2) {
    if (cls === 1 || cls === 3) { if (oneway) { mk = 4; ln = ln || 2; } else { ln = ln || 2; mk = ln >= 4 ? 3 : 2; } }
    else if (cls === 5 || cls === 7) { ln = ln || 2; mk = oneway ? (ln > 1 ? 4 : 2) : (ln >= 4 ? 3 : 2); }
    else if (cls === 2 || cls === 4 || cls === 6 || cls === 8 || cls === 10) { ln = ln || 1; mk = oneway ? (ln > 1 ? 4 : 2) : 2; }
    else if (cls === 9) { ln = ln || 2; mk = oneway && ln > 1 ? 4 : 1; }
    else if (cls === 11 && s === 1) { mk = 1; ln = 2; }
    if (flags & 16) { mk = 4; ln = lanes || 2; }
  }
  let w = BASE_W[cls] || 4;
  if (cls === 12 && urban) w = 6;
  if (lanes && cls <= 12) w = lanes * 3.4 + (mk >= 2 ? 1.2 : 0.4);
  if (widthDm >= 20 && widthDm < 400) w = widthDm / 10;
  return { s, mk, lanes: Math.max(ln, 1), w };
}

/* ---------- small helpers ---------- */
class Frame {
  constructor(a) {
    this.lon0 = (a.w + a.e) / 2; this.lat0 = (a.s + a.n) / 2;
    this.mx = 111320 * Math.cos(this.lat0 * Math.PI / 180); this.mz = 110574;
    this.W = (a.e - a.w) * this.mx; this.H = (a.n - a.s) * this.mz;
  }
  x(lon) { return (lon - this.lon0) * this.mx; } z(lat) { return -(lat - this.lat0) * this.mz; }
  lon(x) { return this.lon0 + x / this.mx; } lat(z) { return this.lat0 - z / this.mz; }
}
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }; await Promise.all(Array.from({ length: n }, run)); }
function noiseTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), rnd = G.mulberry32(5);
  // value noise, several octaves, tileable
  const oct = [[8, .5], [16, .25], [32, .15], [64, .1]], grids = oct.map(([f]) => Array.from({ length: f * f }, rnd));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    oct.forEach(([f, amp], k) => {
      const gx = x / S * f, gy = y / S * f, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const g = grids[k], at = (i, j) => g[((j % f + f) % f) * f + ((i % f + f) % f)];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      v += amp * ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy);
    });
    const q = Math.max(0, Math.min(255, v * 255)); const o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = q; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
function waterNormals() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const h = (x, y) => { let v = 0; const T = 2 * Math.PI / S; for (const [a, b, ph, amp] of [[3, 1, 0.3, 1], [1, 4, 1.7, .8], [5, 3, 2.1, .5], [7, -2, .4, .4], [-4, 6, 1.1, .35], [11, 5, .9, .2]]) v += amp * Math.sin((a * x + b * y) * T + ph); return v; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1); const nx = -dx * 0.35, ny = -dy * 0.35, nz = 1, l = Math.hypot(nx, ny, nz);
    const o = (y * S + x) * 4; img.data[o] = (nx / l * .5 + .5) * 255; img.data[o + 1] = (ny / l * .5 + .5) * 255; img.data[o + 2] = (nz / l * .5 + .5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}

/* ====================================================================== */
export class World {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(container.clientWidth, container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.maxTex = Math.min(4096, r.capabilities.maxTextureSize >= 8192 ? 4096 : 2048);
    this.mobile = matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 700;

    const sc = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.5, 60000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49;

    this.sky = new Sky(); this.sky.scale.setScalar(45000); sc.add(this.sky);
    const u = this.sky.material.uniforms; u.turbidity.value = 4; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.hemi = new THREE.HemisphereLight(0xdfeaf5, 0x5a6640, 1.0); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2); this.sun.castShadow = true;
    const ms = this.mobile ? 2048 : 4096; this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.4;
    sc.add(this.sun, this.sun.target);
    this.sunDir = new V3();
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    sc.environmentIntensity = 0.45;
    sc.fog = new THREE.Fog(0xc6d2db, 2000, 9000);

    this.noise = noiseTexture();
    this.waterNormal = waterNormals();
    this.kit = vehicleKit();
    this.root = new THREE.Group(); sc.add(this.root);
    this.vehicles = []; this.follow = null; this.flight = null;
    this.setSun(38, true);

    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.frame());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
  }

  setSun(elev, env) {
    const phi = THREE.MathUtils.degToRad(90 - elev), th = THREE.MathUtils.degToRad(140);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const k = THREE.MathUtils.clamp((elev - 4) / 40, 0, 1);
    this.sun.color.set(0xffa860).lerp(new THREE.Color(0xfff3e2), k);
    this.sun.intensity = 1.6 + 1.8 * k; this.hemi.intensity = 0.5 + 0.6 * k;
    if (env) {
      const eu = this.envSky.material.uniforms; eu.sunPosition.value.copy(this.sunDir);
      for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[key].value = this.sky.material.uniforms[key].value;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene); this.scene.environment = this.envRT.texture;
    }
  }

  clear() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.root.clear(); this.vehicles = []; this.vehMeshes = []; this.follow = null;
    for (const t of this.textures || []) t.dispose(); this.textures = [];
  }

  /* -------------------------------------------------------------- */
  async build(aoi, opts, progress) {
    this.clear();
    const F = this.F = new Frame(aoi), W = F.W, H = F.H, X0 = -W / 2, X1 = W / 2, Z0 = -H / 2, Z1 = H / 2;
    const exag = opts.exaggeration || 1;
    const rnd = G.mulberry32(Math.round(aoi.w * 1e4 + aoi.s * 1e3));
    const say = m => progress && progress(m);
    const stats = this.stats = {};

    /* 1. OSM tiles */
    say('Loading OSM tiles…');
    const tr = G.tileRange(aoi, G.TZ), tl = [];
    for (let x = tr.x0; x <= tr.x1; x++) for (let y = tr.y0; y <= tr.y1; y++) tl.push([x, y]);
    const tiles = (await Promise.all(tl.map(([x, y]) => G.loadOsmTile(x, y).then(d => d && { x, y, d })))).filter(Boolean);
    if (!tiles.length) say('No OSM data here – building terrain and imagery only.');

    /* 2. terrain */
    say('Loading terrain…');
    const tz = Math.max(W, H) < 2500 ? 14 : 13;
    let elev;
    try { elev = await this.loadTerrain(aoi, tz); } catch (e) { console.warn('terrain failed', e); elev = () => 0; say('Terrain unavailable – using flat ground.'); }
    const cell = Math.max(4, Math.max(W, H) / 400);
    const nx = Math.ceil(W / cell), nz = Math.ceil(H / cell), dx = W / nx, dz = H / nz;
    const raw = new Float32Array((nx + 1) * (nz + 1));
    let hmin = Infinity, hmax = -Infinity;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const v = elev(F.lon(X0 + i * dx), F.lat(Z0 + j * dz)); raw[j * (nx + 1) + i] = v; if (v < hmin) hmin = v; if (v > hmax) hmax = v;
    }
    const base = Math.max(hmin, 0);
    const Hg = raw.map(v => (v - base) * exag);
    this.seaY = (0 - base) * exag;
    const hAt = (x, z) => {
      let gx = (x - X0) / dx, gz = (z - Z0) / dz; gx = Math.min(Math.max(gx, 0), nx - 1e-6); gz = Math.min(Math.max(gz, 0), nz - 1e-6);
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, R = nx + 1;
      const a = Hg[j * R + i], b = Hg[(j + 1) * R + i], c = Hg[(j + 1) * R + i + 1], d = Hg[j * R + i + 1];
      return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
    };
    this.hAt = hAt;
    stats.elev = [hmin, hmax];

    /* 3. imagery */
    const src = IMAGERY[opts.imagery] || IMAGERY.esri;
    let zi = Math.min(src.max, 19);
    let ir;
    for (; zi > 10; zi--) { ir = G.tileRange(aoi, zi); if ((ir.x1 - ir.x0 + 1) * 256 <= this.maxTex && (ir.y1 - ir.y0 + 1) * 256 <= this.maxTex) break; }
    const ntx = ir.x1 - ir.x0 + 1, nty = ir.y1 - ir.y0 + 1;
    const img = document.createElement('canvas'); img.width = ntx * 256; img.height = nty * 256;
    const ictx = img.getContext('2d', { willReadFrequently: true });
    ictx.fillStyle = '#6f7d5a'; ictx.fillRect(0, 0, img.width, img.height);
    const jobs = []; for (let x = ir.x0; x <= ir.x1; x++) for (let y = ir.y0; y <= ir.y1; y++) jobs.push([x, y]);
    let done = 0, failed = 0;
    await pool(jobs, 8, async ([x, y]) => {
      try { const im = await loadImage(src.url(zi, x, y)); ictx.drawImage(im, (x - ir.x0) * 256, (y - ir.y0) * 256); }
      catch { failed++; }
      done++; if (done % 6 === 0 || done === jobs.length) say(`Loading imagery ${done}/${jobs.length} (zoom ${zi})…`);
    });
    if (failed === jobs.length && opts.imagery === 'google') { say('Google tiles blocked – switching to Esri…'); return this.build(aoi, { ...opts, imagery: 'esri' }, progress); }
    this.credit = src.credit; stats.imageryZoom = zi;
    // world <-> imagery uv / pixel
    const pxX = lon => (G.lon2tx(lon, zi) - ir.x0) * 256, pxY = lat => (G.lat2ty(lat, zi) - ir.y0) * 256;
    const u0 = pxX(F.lon(X0)) / img.width, u1 = pxX(F.lon(X1)) / img.width;
    const v0 = 1 - pxY(F.lat(Z0)) / img.height, v1 = 1 - pxY(F.lat(Z1)) / img.height;
    const imgA = new THREE.Vector4((u1 - u0) / W, u0 - X0 * (u1 - u0) / W, (v1 - v0) / H, v0 - Z0 * (v1 - v0) / H);
    let pixels; try { pixels = ictx.getImageData(0, 0, img.width, img.height).data; } catch { pixels = null; }
    const pxAt = (x, z) => {
      if (!pixels) return [110, 130, 90];
      const px = Math.min(img.width - 1, Math.max(0, Math.round(pxX(F.lon(x))))), py = Math.min(img.height - 1, Math.max(0, Math.round(pxY(F.lat(z)))));
      const o = (py * img.width + px) * 4; return [pixels[o], pixels[o + 1], pixels[o + 2]];
    };
    this.imgCanvas = img; this.pixels = pixels;
    const mkTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; this.textures.push(t); return t; };
    this.texSat = mkTex(img);
    this.texEnh = null; this.texStyl = null;
    this.uniforms = { uImg: { value: this.texSat }, uImgA: { value: imgA }, uNoise: { value: this.noise } };

    /* 4. terrain mesh + diorama sides */
    say('Building terrain…');
    {
      const R = nx + 1, pos = new Float32Array(R * (nz + 1) * 3), uv = new Float32Array(R * (nz + 1) * 2), idx = [];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const k = j * R + i, x = X0 + i * dx, z = Z0 + j * dz;
        pos[k * 3] = x; pos[k * 3 + 1] = Hg[k]; pos[k * 3 + 2] = z;
        uv[k * 2] = pxX(F.lon(x)) / img.width; uv[k * 2 + 1] = 1 - pxY(F.lat(z)) / img.height;
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * R + i, b = a + R, c = b + 1, d = a + 1; idx.push(a, b, d, b, c, d); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      this.terrainMat = new THREE.MeshStandardMaterial({ map: this.texSat, roughness: 0.95 });
      const m = new THREE.Mesh(g, this.terrainMat); m.receiveShadow = true; this.root.add(m);
      // soil sides
      const bottom = (hmin - base) * exag - 25, sp = [], sc = [], soilTop = new THREE.Color(0x7a4a2c), soilBot = new THREE.Color(0x3b2a20);
      const edge = (pts) => { for (let k = 0; k < pts.length - 1; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1]; const ha = hAt(ax, az), hb = hAt(bx, bz);
        sp.push(ax, ha, az, bx, hb, bz, ax, bottom, az, bx, hb, bz, bx, bottom, bz, ax, bottom, az);
        for (const c of [soilTop, soilTop, soilBot, soilTop, soilBot, soilBot]) sc.push(c.r, c.g, c.b); } };
      const line = (ax, az, bx, bz, n) => Array.from({ length: n + 1 }, (_, k) => [ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      edge(line(X0, Z1, X1, Z1, nx)); edge(line(X1, Z1, X1, Z0, nz)); edge(line(X1, Z0, X0, Z0, nx)); edge(line(X0, Z0, X0, Z1, nz));
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); sg.computeVertexNormals();
      this.root.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
      const bp = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e241c })); bp.position.y = bottom; this.root.add(bp);
      this.bottom = bottom;
    }
    await tick();

    /* 5. decode OSM into local coordinates */
    const toXZ = ll => [F.x(ll[0]), F.z(ll[1])];
    const roadsById = new Map(), rails = [], waterways = [], waterPolys = [], landuse = [], buildings = [];
    for (const { x, y, d } of tiles) {
      for (const r of d.r || []) {
        const [cls, surf, lanes, wdm, flags, layer, id, enc] = r;
        if (!roadsById.has(id)) roadsById.set(id, { cls, surf, lanes, wdm, flags, layer, parts: [] });
        roadsById.get(id).parts.push(G.decode(enc, x, y).map(toXZ));
      }
      for (const r of d.rl || []) rails.push({ flags: r[0], layer: r[1], pts: G.decode(r[3], x, y).map(toXZ) });
      for (const r of d.ww || []) waterways.push({ t: r[0], wdm: r[1], pts: G.decode(r[3], x, y).map(toXZ) });
      for (const p of d.w || []) waterPolys.push(p[0].map(ring => G.decode(ring, x, y).map(toXZ)));
      for (const p of d.l || []) landuse.push({ code: p[0], rings: p[1].map(ring => G.decode(ring, x, y).map(toXZ)) });
      for (const b of d.b || []) buildings.push({ t: b[0], hdm: b[1], lv: b[2], ring: G.decode(b[3], x, y).map(toXZ) });
    }
    // stitch pieces of the same way split by tile borders
    const roads = [];
    for (const [id, r] of roadsById) {
      const parts = r.parts.map(p => p.slice());
      const close = (a, b) => Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6;
      let merged = true;
      while (merged && parts.length > 1) {
        merged = false;
        outer: for (let i = 0; i < parts.length; i++) for (let j = 0; j < parts.length; j++) {
          if (i === j) continue;
          if (close(parts[i][parts[i].length - 1], parts[j][0])) { parts[i] = parts[i].concat(parts[j].slice(1)); parts.splice(j, 1); merged = true; break outer; }
        }
      }
      for (const p of parts) for (const c of G.clipLine(p, X0, Z0, X1, Z1)) roads.push({ ...r, id, pts: c });
    }
    stats.roads = roads.length; stats.buildings = 0;

    /* 6. exclusion / landuse rasters for tree placement */
    const MR = 1.5, mw = Math.ceil(W / MR), mh = Math.ceil(H / MR);
    const mask = document.createElement('canvas'); mask.width = mw; mask.height = mh;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    const mx = x => (x - X0) / MR, mz = z => (z - Z0) / MR;
    mctx.lineCap = 'round'; mctx.lineJoin = 'round';

    /* 7. roads */
    say(`Building ${roads.length} road segments…`);
    const RB = { pos: [], nor: [], a1: [], a2: [], idx: [] };
    const bridgeParts = [];
    const ribbon = (pts, hw, info, B = RB) => { // pts: [{x,y,z,s}] ; info: [mk, lanes, surf]
      const n = pts.length; if (n < 2) return;
      const base = B.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        let nxv = -tz, nzv = tx, sc = 1;
        if (i > 0 && i < n - 1) { // miter
          let px = p.x - a.x, pz = p.z - a.z; const pl = Math.hypot(px, pz) || 1; const dot = (-pz / pl) * nxv + (px / pl) * nzv; sc = 1 / Math.max(0.6, dot);
        }
        for (const sd of [-1, 1]) {
          B.pos.push(p.x + nxv * hw * sd * sc, p.y, p.z + nzv * hw * sd * sc); B.nor.push(0, 1, 0);
          B.a1.push(sd * hw, p.s, hw, 0); B.a2.push(info[0], info[1], info[2], 0);
        }
      }
      for (let i = 0; i < n - 1; i++) { const a = base + 2 * i, b = a + 1, c = a + 2, d = a + 3; B.idx.push(a, b, c, b, d, c); }
    };
    const densify = (pts, step) => {
      const out = [[pts[0][0], pts[0][1]]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / step));
        for (let t = 1; t <= k; t++) out.push([ax + (bx - ax) * t / k, az + (bz - az) * t / k]);
      }
      return out;
    };
    const withS = pts => { let s = 0; return pts.map((p, i) => { if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); return { x: p[0], z: p[1], s }; }); };
    this.lanesForTraffic = [];
    const step = Math.min(dx, dz) * 0.6;
    roads.sort((a, b) => RANK[a.cls] - RANK[b.cls]);
    for (const r of roads) {
      if (r.flags & 4) continue; // tunnel
      const st = roadStyle(r.cls, r.surf, r.lanes, r.wdm, r.flags);
      const pts = withS(densify(r.pts, step));
      const L = pts[pts.length - 1].s; if (L < 0.5) continue;
      const lift = 0.12 + RANK[r.cls] * 0.018;
      const isBridge = (r.flags & 2) && L > 6;
      if (isBridge) {
        const hA = hAt(pts[0].x, pts[0].z), hB = hAt(pts[pts.length - 1].x, pts[pts.length - 1].z);
        let Hh = Math.min(7, Math.max(0.8, L * 0.05)); if (r.layer >= 1 && L > 60) Hh = Math.max(Hh, 5.5);
        for (const p of pts) {
          const t = p.s / L, ramp = THREE.MathUtils.smoothstep(t, 0, 0.3) * THREE.MathUtils.smoothstep(1 - t, 0, 0.3);
          p.y = Math.max(hA + (hB - hA) * t + Hh * ramp * exag ** 0.5, hAt(p.x, p.z) + 0.6) + lift;
        }
        bridgeParts.push({ pts, hw: st.w / 2, cls: r.cls });
      } else for (const p of pts) p.y = hAt(p.x, p.z) + lift;
      ribbon(pts, st.w / 2, [st.mk, st.lanes, st.s]);
      // raster mask for trees
      mctx.strokeStyle = '#fff'; mctx.lineWidth = (st.w + 3) / MR; mctx.beginPath();
      r.pts.forEach((p, i) => i ? mctx.lineTo(mx(p[0]), mz(p[1])) : mctx.moveTo(mx(p[0]), mz(p[1]))); mctx.stroke();
      if (r.cls <= 14 && r.cls !== 13 && L > 20) this.lanesForTraffic.push({ pts, st, cls: r.cls, oneway: (r.flags & 1) && !(r.flags & 16) ? 1 : (r.flags & 16 ? 1 : 0), urban: r.flags & 8 });
    }
    /* railways (metre gauge) */
    const railLines = [];
    for (const r of rails) for (const c of G.clipLine(r.pts, X0, Z0, X1, Z1)) {
      const pts = withS(densify(c, step)); for (const p of pts) p.y = hAt(p.x, p.z) + 0.35;
      ribbon(pts, 1.8, [0, 1, 10]); railLines.push(pts);
      mctx.strokeStyle = '#fff'; mctx.lineWidth = 6 / MR; mctx.beginPath(); c.forEach((p, i) => i ? mctx.lineTo(mx(p[0]), mz(p[1])) : mctx.moveTo(mx(p[0]), mz(p[1]))); mctx.stroke();
    }
    if (RB.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(RB.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(RB.nor, 3));
      g.setAttribute('aRoad', new THREE.Float32BufferAttribute(RB.a1, 4)); g.setAttribute('aRoad2', new THREE.Float32BufferAttribute(RB.a2, 4));
      g.setIndex(RB.idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, makeRoadMaterial(this.uniforms)); m.receiveShadow = true; this.root.add(m);
    }
    // steel rails
    if (railLines.length) {
      const RB2 = { pos: [], nor: [], a1: [], a2: [], idx: [] };
      for (const pts of railLines) for (const o of [-0.5, 0.5]) {
        const off = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; return { x: p.x - tz / l * o, z: p.z + tx / l * o, y: p.y + 0.16, s: p.s }; });
        ribbon(off, 0.05, [0, 0, 0], RB2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(RB2.pos, 3)); g.setIndex(RB2.idx); g.computeVertexNormals();
      this.root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })));
    }
    this.buildBridges(bridgeParts);
    await tick();

    /* 8. water */
    say('Building water…');
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2b4b55, roughness: 0.06, metalness: 0.15, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.86, side: THREE.DoubleSide });
    const wGeos = [];
    const polyToGeo = (rings, y) => {
      const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
      if (contour.length < 3) return null;
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes), all = contour.concat(...holes), pos = [], uv = [];
      for (const t of tris) for (const k of t) { const p = all[k]; pos.push(p.x, y, p.y); uv.push(p.x / 25, p.y / 25); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
      // make sure normals face up
      const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      return g;
    };
    for (const rings of waterPolys) {
      const outer = G.clipRing(rings[0], X0, Z0, X1, Z1); if (outer.length < 3) continue;
      const cr = [outer, ...rings.slice(1).map(r => G.clipRing(r, X0, Z0, X1, Z1)).filter(r => r.length >= 3)];
      let y = Infinity; for (const p of cr[0]) y = Math.min(y, hAt(p[0], p[1]));
      let g = null; try { g = polyToGeo(cr, Math.max(y, this.seaY) + 0.18); } catch (e) { try { g = polyToGeo([outer], Math.max(y, this.seaY) + 0.18); } catch (e2) {} } if (g) wGeos.push(g);
      mctx.fillStyle = '#fff'; mctx.beginPath(); for (const r of cr) r.forEach((p, i) => i ? mctx.lineTo(mx(p[0]), mz(p[1])) : mctx.moveTo(mx(p[0]), mz(p[1]))); mctx.fill('evenodd');
    }
    for (const wv of waterways) {
      const width = wv.wdm >= 10 ? wv.wdm / 10 : ({ 1: 18, 2: 7, 3: 3.5, 4: 2 })[wv.t];
      for (const c of G.clipLine(wv.pts, X0, Z0, X1, Z1)) {
        const pts = densify(c, step); const B = { pos: [], nor: [], a1: [], a2: [], idx: [] };
        const p3 = withS(pts); for (const p of p3) p.y = hAt(p.x, p.z) + 0.1; ribbon(p3, width / 2, [0, 0, 0], B);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(B.pos.flatMap((v, i) => i % 3 === 1 ? [] : [v / 25]), 2));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3)); g.setIndex(B.idx); wGeos.push(g.toNonIndexed());
        mctx.strokeStyle = '#fff'; mctx.lineWidth = (width + 2) / MR; mctx.beginPath(); c.forEach((p, i) => i ? mctx.lineTo(mx(p[0]), mz(p[1])) : mctx.moveTo(mx(p[0]), mz(p[1]))); mctx.stroke();
      }
    }
    if (hmin < 1.5) { // sea / tidal water at sea level
      const g = new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2); g.translate(0, this.seaY + 0.12, 0);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 25, uv.getY(i) * H / 25);
      wGeos.push(g.toNonIndexed());
    }
    if (wGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(wGeos.map(g => { g.deleteAttribute('aRoad'); return g; })), this.waterMat); m.receiveShadow = true; m.renderOrder = 2; this.root.add(m);
    }
    await tick();

    /* 9. buildings */
    say(`Building ${buildings.length} buildings…`);
    const bgeo = this.buildBuildings(buildings, X0, Z0, X1, Z1, rnd, (ring) => {
      mctx.fillStyle = '#fff'; mctx.beginPath(); ring.forEach((p, i) => i ? mctx.lineTo(mx(p[0]), mz(p[1])) : mctx.moveTo(mx(p[0]), mz(p[1]))); mctx.closePath(); mctx.fill();
    });
    if (bgeo) { const m = new THREE.Mesh(bgeo, makeBuildingMaterial()); m.castShadow = m.receiveShadow = true; this.buildingsMesh = m; this.root.add(m); }
    await tick();

    /* 10. trees from imagery */
    say('Placing trees from the imagery…');
    const lu = document.createElement('canvas'); lu.width = mw; lu.height = mh; const lctx = lu.getContext('2d', { willReadFrequently: true });
    for (const l of landuse) if (l.code === 1 || l.code === 2) {
      lctx.fillStyle = l.code === 1 ? '#f00' : '#0f0'; lctx.beginPath();
      for (const r of l.rings) r.forEach((p, i) => i ? lctx.lineTo(mx(p[0]), mz(p[1])) : lctx.moveTo(mx(p[0]), mz(p[1])));
      lctx.fill('evenodd');
    }
    this.buildTrees({ X0, Z0, W, H, mw, mh, MR, mask: mctx.getImageData(0, 0, mw, mh).data, lu: lctx.getImageData(0, 0, mw, mh).data, pxAt, rnd });
    await tick();

    /* 11. traffic */
    if (opts.traffic !== false) { say('Adding traffic…'); this.buildTraffic(rnd); }

    /* 12. camera, shadows, fog */
    const S = Math.max(W, H);
    this.extent = S;
    const hc = hAt(0, 0);
    this.views = {
      overview: { pos: [S * 0.45, hc + S * 0.55, S * 0.75], target: [0, hc, 0] },
      oblique: { pos: [S * 0.18, hc + S * 0.12, S * 0.3], target: [0, hc, -S * 0.05] },
      street: { pos: [S * 0.05, hc + 25, S * 0.12], target: [-S * 0.05, hc, -S * 0.05] },
    };
    this.controls.maxDistance = S * 3; this.controls.minDistance = 3;
    this.scene.fog.near = S * 1.2; this.scene.fog.far = S * 5;
    this.camera.far = S * 20; this.camera.updateProjectionMatrix(); this.sky.scale.setScalar(S * 12);
    this.goView('overview', true);
    say('');
    return { W, H, stats };
  }

  async loadTerrain(aoi, z) {
    const r = G.tileRange(aoi, z), nx = r.x1 - r.x0 + 1, ny = r.y1 - r.y0 + 1;
    const c = document.createElement('canvas'); c.width = nx * 256; c.height = ny * 256; const ctx = c.getContext('2d', { willReadFrequently: true });
    const jobs = []; for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) jobs.push([x, y]);
    await pool(jobs, 6, async ([x, y]) => { const im = await loadImage(TERRAIN_URL(z, x, y)); ctx.drawImage(im, (x - r.x0) * 256, (y - r.y0) * 256); });
    const d = ctx.getImageData(0, 0, c.width, c.height).data, Wd = c.width, Hd = c.height;
    const h = (px, py) => { px = Math.min(Wd - 1, Math.max(0, px)); py = Math.min(Hd - 1, Math.max(0, py)); const o = (py * Wd + px) * 4; return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768; };
    return (lon, lat) => {
      const fx = (G.lon2tx(lon, z) - r.x0) * 256 - 0.5, fy = (G.lat2ty(lat, z) - r.y0) * 256 - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty) + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
    };
  }

  /* ---------- bridges: deck fascia, parapets, piers ---------- */
  buildBridges(parts) {
    if (!parts.length) return;
    const geos = [];
    const strip = (pts, offA, offB, dyA, dyB) => {
      const pos = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const q = [i, i + 1].map(k => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], p = pts[k]; const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; const nx = -tz / l, nz = tx / l;
          return [[p.x + nx * offA, p.y + dyA, p.z + nz * offA], [p.x + nx * offB, p.y + dyB, p.z + nz * offB]]; });
        const [[a0, b0], [a1, b1]] = q; pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
    };
    for (const { pts, hw } of parts) {
      for (const sd of [-1, 1]) {
        geos.push(strip(pts, sd * hw, sd * hw, 0.02, -1.1));                     // fascia
        geos.push(strip(pts, sd * (hw - 0.3), sd * (hw - 0.3), 0, 0.9));         // parapet inner
        geos.push(strip(pts, sd * (hw - 0.3), sd * hw, 0.9, 0.9));               // parapet top
        geos.push(strip(pts, sd * hw, sd * hw, 0.9, 0));                         // parapet outer
      }
      geos.push(strip(pts, -hw, hw, -1.1, -1.1));                                 // soffit
      const L = pts[pts.length - 1].s, n = Math.max(1, Math.round(L / 22));
      for (let k = 1; k < n; k++) {
        const s = L * k / n; let i = pts.findIndex(p => p.s >= s); if (i < 1) continue; const p = pts[i];
        const gnd = this.hAt(p.x, p.z) - 1.5, top = p.y - 1.1; if (top - gnd < 2) continue;
        const a = pts[i - 1], ang = Math.atan2(p.x - a.x, p.z - a.z);
        const pier = new THREE.BoxGeometry(hw * 1.5, top - gnd, 1.1); pier.rotateY(ang); pier.translate(p.x, (top + gnd) / 2, p.z);
        geos.push(pier.toNonIndexed());
      }
    }
    const g = mergeGeometries(geos.map(x => { x.deleteAttribute('uv'); return x; }));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.85, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true; this.root.add(m);
  }

  /* ---------- buildings with gable / hip / pagoda roofs and windows ---------- */
  buildBuildings(list, X0, Z0, X1, Z1, rnd, markMask) {
    const pos = [], col = [], wall = [];
    const WALLS = [0xe9e4d8, 0xf1ece2, 0xe8dcc0, 0xd9d3c7, 0xefe2c9, 0xe6d3c3, 0xcfd6d2, 0xf3efe6];
    const ROOF_G = [0xa8452f, 0x9a3b2c, 0xb4583a, 0x3e6b98, 0x58708a, 0x8a8f94, 0x6f7377, 0x2f5e4b, 0xb05a3c];
    const ROOF_F = [0xc9c6bf, 0xbab6ae, 0xd6d3cc, 0xa9a59e, 0x8f8b84];
    const tmp = new THREE.Color();
    const push = (p, c, w) => { pos.push(...p); col.push(c.r, c.g, c.b); wall.push(...w); };
    const tri = (a, b, c, color, w = [0, 0, 0, 0]) => { push(a, color, w); push(b, color, w); push(c, color, w); };
    let count = 0;
    for (const b of list) {
      let ring = b.ring; if (ring.length < 3) continue;
      const c0 = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map(v => v / ring.length);
      if (c0[0] < X0 || c0[0] > X1 || c0[1] < Z0 || c0[1] > Z1) continue;
      ring = G.clipRing(ring, X0, Z0, X1, Z1); if (ring.length < 3) continue;
      const area = Math.abs(G.ringArea(ring)); if (area < 4) continue;
      count++; markMask(ring);
      const t = b.t; const big = area > 600;
      let h = b.hdm > 20 ? b.hdm / 10 : b.lv > 0 ? b.lv * 3.2 + 0.6 : 0;
      if (!h) h = ({ 1: 3.6, 2: 6.8, 3: 13, 4: 9.5, 5: 7, 6: 7, 7: 7.4, 8: 9.5, 9: 4, 10: 3, 11: 6, 12: 6 })[t] || (area > 250 ? 7.0 : 3.6 + rnd() * 3.3);
      let gnd = Infinity; for (const p of ring) gnd = Math.min(gnd, this.hAt(p[0], p[1]));
      gnd -= 0.3;
      const wallC = new THREE.Color(WALLS[(rnd() * WALLS.length) | 0]).convertSRGBToLinear();
      const winType = t === 9 || t === 10 ? 0 : (h > 6.5 || t === 4 || t === 3 || t === 8 || t === 7) ? 2 : 1;
      const top = gnd + h;
      // walls
      let along = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const a0 = [p[0], gnd, p[1]], a1 = [q[0], gnd, q[1]], b0 = [p[0], top, p[1]], b1 = [q[0], top, q[1]];
        const shade = 0.92 + 0.12 * Math.abs(Math.sin(Math.atan2(q[1] - p[1], q[0] - p[0]))); tmp.copy(wallC).multiplyScalar(shade);
        const w = (s, y) => [along + s, y, winType, h];
        push(a0, tmp, w(0, 0)); push(a1, tmp, w(L, 0)); push(b1, tmp, w(L, h));
        push(a0, tmp, w(0, 0)); push(b1, tmp, w(L, h)); push(b0, tmp, w(0, h));
        along += L;
      }
      // roof
      const ob = G.obb(ring);
      const rect = ob ? area / (4 * ob.a * ob.b) : 0;
      const pitched = ob && !big && rect > 0.78 && t !== 3 && t !== 4 && t !== 5 && t !== 9 && h < 10 && ob.b > 1.5;
      if (t === 11 && ob) { // stupa
        const r = Math.sqrt(area / Math.PI) * 0.9, g = new THREE.LatheGeometry([[0, 0], [r, 0], [r * 0.95, r * 0.6], [r * 0.55, r * 1.3], [r * 0.25, r * 1.9], [0.05, r * 3.2]].map(([x, y]) => new THREE.Vector2(x, y)), 12).toNonIndexed();
        const gp = g.attributes.position, gold = new THREE.Color(0xd8b25a).convertSRGBToLinear(), white = new THREE.Color(0xf2efe6).convertSRGBToLinear();
        for (let i = 0; i < gp.count; i++) push([gp.getX(i) + ob.cx, gp.getY(i) + top, gp.getZ(i) + ob.cz], gp.getY(i) > r * 1.3 ? gold : white, [0, 0, 0, 0]);
      } else if (pitched || t === 6) {
        const o = 0.45, pagoda = t === 6, pts = (u, v, y) => [ob.cx + ob.ux * u + ob.vx * v, y, ob.cz + ob.uz * u + ob.vz * v];
        const roofC = new THREE.Color(pagoda ? 0xc0562a : ROOF_G[(rnd() * ROOF_G.length) | 0]).convertSRGBToLinear();
        const gableC = new THREE.Color(pagoda ? 0xd9a441 : 0).convertSRGBToLinear();
        const tiers = pagoda ? [[1, 1, 0], [0.72, 0.8, 0.55]] : [[1, 1, 0]];
        const hip = !pagoda && rnd() < 0.45;
        let ybase = top;
        for (const [ka, kb, rise0] of tiers) {
          const A = ob.a * ka, B = ob.b * kb, rise = B * (pagoda ? 0.95 : 0.42 + rnd() * 0.12);
          const y0 = ybase + (rise0 ? -rise * 0.15 : 0), y1 = y0 + rise;
          const ridgeA = hip ? Math.max(0, A - B) : A + o;
          const c1 = pts(-A - o, -B - o, y0), c2 = pts(A + o, -B - o, y0), c3 = pts(A + o, B + o, y0), c4 = pts(-A - o, B + o, y0);
          const r1 = pts(-ridgeA, 0, y1), r2 = pts(ridgeA, 0, y1);
          const sideC = tmp.copy(roofC);
          tri(c1, c2, r2, sideC); tri(c1, r2, r1, sideC);
          tri(c4, r1, r2, roofC.clone().multiplyScalar(0.86)); tri(c4, r2, c3, roofC.clone().multiplyScalar(0.86));
          if (hip) { tri(c1, r1, c4, roofC.clone().multiplyScalar(0.93)); tri(c2, c3, r2, roofC.clone().multiplyScalar(0.93)); }
          else { // gable ends
            const gc = pagoda ? gableC : wallC;
            tri(pts(-A, -B, y0), pts(-A, B, y0), pts(-A, 0, y1), gc, [0, 0, 0, 0]);
            tri(pts(A, -B, y0), pts(A, B, y0), pts(A, 0, y1), gc, [0, 0, 0, 0]);
          }
          ybase = y0 + rise * 0.55;
        }
        if (pagoda) { const sp = pts(0, 0, ybase + ob.b * 0.9), gold = new THREE.Color(0xd9a441).convertSRGBToLinear(); tri(pts(-0.3, 0, ybase), pts(0.3, 0, ybase), sp, gold); }
      } else { // flat roof with parapet tint
        const roofC = new THREE.Color(ROOF_F[(rnd() * ROOF_F.length) | 0]).convertSRGBToLinear();
        const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        for (const tr of tris) tri(...tr.map(k => [contour[k].x, top, contour[k].y]), roofC);
        if (big && rnd() < 0.5) { // rooftop box (water tank / stair)
          const s = Math.min(4, Math.sqrt(area) * 0.15), cx = ob ? ob.cx : c0[0], cz = ob ? ob.cz : c0[1], y2 = top + 2.2, tc = roofC.clone().multiplyScalar(0.8);
          const q = [[cx - s, cz - s], [cx + s, cz - s], [cx + s, cz + s], [cx - s, cz + s]];
          for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; tri([p[0], top, p[1]], [r[0], top, r[1]], [r[0], y2, r[1]], tc); tri([p[0], top, p[1]], [r[0], y2, r[1]], [p[0], y2, p[1]], tc); }
          tri([q[0][0], y2, q[0][1]], [q[1][0], y2, q[1][1]], [q[2][0], y2, q[2][1]], tc); tri([q[0][0], y2, q[0][1]], [q[2][0], y2, q[2][1]], [q[3][0], y2, q[3][1]], tc);
        }
      }
    }
    this.stats.buildings = count;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 4));
    g.computeVertexNormals();
    return g;
  }

  /* ---------- trees: canopy pixels in the imagery -> instanced trees ---------- */
  buildTrees({ X0, Z0, W, H, mw, mh, MR, mask, lu, pxAt, rnd }) {
    const C = 2.5, gw = Math.floor(W / C), gh = Math.floor(H / C), cls = new Uint8Array(gw * gh);
    const counts = [0, 0, 0, 0, 0, 0];
    // 1 water 2 tree canopy 3 crop/grass 4 bare soil 5 built/other
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = X0 + (i + 0.5) * C, z = Z0 + (j + 0.5) * C, [r, g, b] = pxAt(x, z);
      const v = (r + g + b) / 3, exg = 2 * g - r - b;
      let k;
      if ((b > r + 4 && b >= g - 6 && v < 115) || (v < 48 && exg < 12)) k = 1;
      else if (exg > 10 && v < 105 && g >= r) k = 2;
      else if (exg > 6) k = 3;
      else if (r > g + 4 && r > b + 14) k = 4;
      else k = 5;
      const mi = (Math.min(mh - 1, Math.floor((z - Z0) / MR)) * mw + Math.min(mw - 1, Math.floor((x - X0) / MR))) * 4;
      if (mask[mi] > 128 && k === 2) k = 5;
      if (lu[mi] + lu[mi + 1] > 128 && k === 3) k = 2; // OSM forest polygons help in hazy imagery
      cls[j * gw + i] = k; counts[k]++;
    }
    const tot = gw * gh || 1;
    this.lulc = { water: counts[1] / tot, tree: counts[2] / tot, crop: counts[3] / tot, bare: counts[4] / tot, built: counts[5] / tot };
    const cap = this.mobile ? 22000 : 70000;
    const pBase = Math.min(0.32, cap / Math.max(1, counts[2]));
    const trees = [], palms = [];
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      if (cls[j * gw + i] !== 2) continue;
      let nb = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (cls[(j + a) * gw + i + b] === 2) nb++;
      const x = X0 + (i + rnd()) * C, z = Z0 + (j + rnd()) * C;
      if (nb <= 3) { if (rnd() < 0.45) palms.push([x, z]); continue; }           // isolated canopy → sugar palm
      if (rnd() < pBase * (nb >= 8 ? 1 : 0.7)) trees.push([x, z, nb]);
    }
    const d = new THREE.Object3D(), color = new THREE.Color();
    if (trees.length) {
      let canopy = mergeVertices(new THREE.IcosahedronGeometry(1, 1));
      const cp = canopy.attributes.position, rr = G.mulberry32(9);
      for (let i = 0; i < cp.count; i++) { const f = 0.82 + rr() * 0.36; cp.setXYZ(i, cp.getX(i) * f, cp.getY(i) * f * 0.8, cp.getZ(i) * f); }
      canopy.computeVertexNormals(); canopy.translate(0, 1.45, 0);
      const trunk = new THREE.CylinderGeometry(0.06, 0.1, 1.0, 5).translate(0, 0.5, 0);
      const imC = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), trees.length);
      const imT = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 }), trees.length);
      trees.forEach(([x, z, nb], k) => {
        const s = 2.4 + rnd() * 1.8 + (nb >= 8 ? 1.0 : 0);
        d.position.set(x, this.hAt(x, z) - 0.2, z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(s, s * (0.9 + rnd() * 0.5), s); d.updateMatrix();
        imC.setMatrixAt(k, d.matrix); imT.setMatrixAt(k, d.matrix);
        const [r, g, b] = pxAt(x, z); color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(1.25); color.offsetHSL(0, 0.04, 0);
        imC.setColorAt(k, color);
      });
      imC.castShadow = imT.castShadow = true; imC.receiveShadow = true; this.root.add(imC, imT); this.treeMeshes = [imC, imT];
    } else this.treeMeshes = [];
    if (palms.length) {
      const pTrunk = new THREE.CylinderGeometry(0.2, 0.28, 11, 6).translate(0, 5.5, 0);
      const fr = []; for (let k = 0; k < 14; k++) { const f = new THREE.ConeGeometry(1.25, 0.25, 7).rotateX(Math.PI / 2).translate(0, 0, 1.4); f.rotateX(-0.35 + (k % 3) * 0.35); f.rotateY(k / 14 * Math.PI * 2 + (k % 2) * 0.2); f.translate(0, 11.2, 0); fr.push(f.toNonIndexed()); }
      const imPT = new THREE.InstancedMesh(pTrunk, new THREE.MeshStandardMaterial({ color: 0x4f4032, roughness: 1 }), palms.length);
      const imPC = new THREE.InstancedMesh(mergeGeometries(fr), new THREE.MeshStandardMaterial({ color: 0x4f7a34, roughness: 0.85, side: THREE.DoubleSide }), palms.length);
      palms.forEach(([x, z], k) => { const s = 0.8 + rnd() * 0.45; d.position.set(x, this.hAt(x, z) - 0.2, z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.setScalar(s); d.updateMatrix(); imPT.setMatrixAt(k, d.matrix); imPC.setMatrixAt(k, d.matrix); });
      imPT.castShadow = imPC.castShadow = true; this.root.add(imPT, imPC); this.treeMeshes.push(imPT, imPC);
    }
    this.stats.trees = trees.length; this.stats.palms = palms.length;
  }

  /* ---------- traffic ---------- */
  buildTraffic(rnd) {
    const PER_KM = { 1: 40, 2: 10, 3: 34, 4: 10, 5: 26, 6: 8, 7: 18, 8: 6, 9: 12, 10: 4, 11: 6, 12: 5, 14: 2 };
    const cap = this.mobile ? 500 : 1600;
    const want = [];
    for (const ln of this.lanesForTraffic) {
      const L = ln.pts[ln.pts.length - 1].s, n = Math.floor(L / 1000 * (PER_KM[ln.cls] || 2) * (ln.urban ? 1.6 : 1) + rnd());
      for (let k = 0; k < n; k++) want.push(ln);
    }
    let list = want; if (list.length > cap) { list = want.filter(() => rnd() < cap / want.length); }
    const types = Object.keys(this.kit), slots = Object.fromEntries(types.map(t => [t, []]));
    for (const ln of list) {
      const urban = ln.urban, r = rnd(); let t;
      if (ln.cls <= 4) t = r < 0.35 ? 'moto' : r < 0.75 ? 'car' : r < 0.85 ? 'bus' : 'truck';
      else if (ln.cls <= 8) t = r < 0.5 ? 'moto' : r < 0.8 ? 'car' : r < 0.9 ? 'tuktuk' : 'truck';
      else t = r < (urban ? 0.62 : 0.72) ? 'moto' : r < 0.86 ? 'car' : r < 0.95 ? 'tuktuk' : 'truck';
      if (ln.st.w < 4 && (t === 'truck' || t === 'bus')) t = 'moto';
      // build lane path
      const dir = ln.oneway ? 1 : (rnd() < 0.5 ? 1 : -1);
      const src = dir > 0 ? ln.pts : ln.pts.slice().reverse();
      const hw = ln.st.w / 2;
      let off;
      if (ln.oneway) off = (ln.st.lanes > 1 ? (((rnd() * ln.st.lanes) | 0) + 0.5) / ln.st.lanes * 2 - 1 : 0) * (hw - 0.6);
      else { const per = Math.max(1, Math.round(ln.st.lanes / 2)); off = ((((rnd() * per) | 0) + 0.5) / per) * (hw - 0.4); }
      if (t === 'moto') off += (ln.oneway ? 0.6 : hw * 0.25) * (rnd() * 0.8);
      const P = new Float32Array(src.length * 3), S = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        P[i * 3] = src[i].x + (-tz / l) * off; P[i * 3 + 1] = src[i].y; P[i * 3 + 2] = src[i].z + (tx / l) * off;
        if (i) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
      }
      const L = S[S.length - 1];
      const speed = (ln.cls <= 4 ? 22 : ln.cls <= 8 ? 15 : ln.cls <= 10 ? 11 : 7) * (t === 'moto' ? 0.9 + rnd() * 0.3 : t === 'tuktuk' ? 0.65 : t === 'truck' || t === 'bus' ? 0.8 : 1) ;
      const v = { P, S, L, u: rnd() * L, speed, t, idx: slots[t].length, pos: new V3(), fwd: new V3(0, 0, 1) };
      slots[t].push(v); this.vehicles.push(v);
    }
    this.vehMeshes = [];
    for (const t of types) {
      const n = slots[t].length; if (!n) continue; const k = this.kit[t];
      const paint = new THREE.InstancedMesh(k.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 }), n);
      const fixed = new THREE.InstancedMesh(k.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), n);
      const c = new THREE.Color();
      slots[t].forEach((v, i) => paint.setColorAt(i, c.set(k.palette[(rnd() * k.palette.length) | 0])));
      for (const m of [paint, fixed]) { m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.root.add(m); }
      this.vehMeshes.push({ t, paint, fixed, list: slots[t] });
    }
    this.updateTraffic(0);
    this.stats.vehicles = this.vehicles.length;
  }

  updateTraffic(dt) {
    if (!this.vehMeshes) return;
    const d = this._d || (this._d = new THREE.Object3D()), look = new V3();
    for (const g of this.vehMeshes) {
      g.list.forEach((v, i) => {
        v.u = (v.u + v.speed * dt) % v.L;
        const S = v.S; let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= v.u) lo = m; else hi = m; }
        const t = (v.u - S[lo]) / ((S[hi] - S[lo]) || 1), P = v.P;
        v.pos.set(P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t, P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t, P[lo * 3 + 2] + (P[hi * 3 + 2] - P[lo * 3 + 2]) * t);
        v.fwd.set(P[hi * 3] - P[lo * 3], P[hi * 3 + 1] - P[lo * 3 + 1], P[hi * 3 + 2] - P[lo * 3 + 2]).normalize();
        d.position.copy(v.pos); look.copy(v.pos).add(v.fwd); d.lookAt(look); d.updateMatrix();
        g.paint.setMatrixAt(i, d.matrix); g.fixed.setMatrixAt(i, d.matrix);
      });
      g.paint.instanceMatrix.needsUpdate = g.fixed.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- ground styles ---------- */
  setGround(style) {
    if (!this.imgCanvas) return;
    let tex = this.texSat;
    if (style === 'enhanced') {
      if (!this.texEnh) {
        const c = document.createElement('canvas'); c.width = this.imgCanvas.width; c.height = this.imgCanvas.height; const ctx = c.getContext('2d');
        ctx.filter = 'contrast(1.18) saturate(1.3) brightness(1.04)'; ctx.drawImage(this.imgCanvas, 0, 0);
        this.texEnh = new THREE.CanvasTexture(c); this.texEnh.colorSpace = THREE.SRGBColorSpace; this.texEnh.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); this.textures.push(this.texEnh);
      }
      tex = this.texEnh;
    } else if (style === 'lulc') {
      if (!this.texStyl && this.pixels) {
        const c = document.createElement('canvas'), w = c.width = this.imgCanvas.width, h = c.height = this.imgCanvas.height, ctx = c.getContext('2d');
        const out = ctx.createImageData(w, h), s = this.pixels, o = out.data, rnd = G.mulberry32(3);
        const PAL = { 1: [52, 92, 112], 2: [44, 86, 40], 3: [128, 160, 74], 4: [176, 112, 72], 5: [184, 178, 166] };
        for (let i = 0; i < s.length; i += 4) {
          const r = s[i], g = s[i + 1], b = s[i + 2], v = (r + g + b) / 3, exg = 2 * g - r - b;
          const k = (b > r + 4 && b >= g - 6 && v < 115) || (v < 48 && exg < 12) ? 1 : exg > 10 && v < 105 && g >= r ? 2 : exg > 6 ? 3 : r > g + 4 && r > b + 14 ? 4 : 5;
          const p = PAL[k], lum = 0.75 + v / 255 * 0.5, jit = 0.94 + rnd() * 0.1;
          o[i] = Math.min(255, (p[0] * 0.7 + r * 0.3) * lum * jit); o[i + 1] = Math.min(255, (p[1] * 0.7 + g * 0.3) * lum * jit); o[i + 2] = Math.min(255, (p[2] * 0.7 + b * 0.3) * lum * jit); o[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        this.texStyl = new THREE.CanvasTexture(c); this.texStyl.colorSpace = THREE.SRGBColorSpace; this.texStyl.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); this.textures.push(this.texStyl);
      }
      tex = this.texStyl || this.texSat;
    }
    this.terrainMat.map = tex; this.terrainMat.needsUpdate = true; this.uniforms.uImg.value = tex;
  }

  setVisible(kind, on) {
    if (kind === 'trees') (this.treeMeshes || []).forEach(m => m.visible = on);
    if (kind === 'buildings' && this.buildingsMesh) this.buildingsMesh.visible = on;
    if (kind === 'traffic') { this.trafficOn = on; (this.vehMeshes || []).forEach(g => g.paint.visible = g.fixed.visible = on); }
    if (kind === 'shadows') this.sun.castShadow = on;
  }

  goView(name, instant) {
    if (name === 'drive') {
      const cand = this.vehicles.filter(v => v.t !== 'moto' && v.L > 300);
      this.follow = cand.length ? cand[(Math.random() * cand.length) | 0] : this.vehicles[0];
      this.controls.enabled = !this.follow; return;
    }
    this.follow = null; this.controls.enabled = true;
    const v = this.views[name]; if (!v) return;
    const p1 = new V3(...v.pos), q1 = new V3(...v.target);
    if (instant) { this.camera.position.copy(p1); this.controls.target.copy(q1); this.controls.update(); return; }
    this.flight = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1, q1 };
  }

  frame() {
    if (this.paused) { this.clock.getDelta(); return; }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.trafficOn !== false) this.updateTraffic(dt);
    if (this.waterMat) { this.waterMat.normalMap.offset.x += dt * 0.012; this.waterMat.normalMap.offset.y += dt * 0.007; }
    if (this.follow) {
      const f = this.follow, back = this.kit[f.t].len * 2.6 + 6;
      const want = f.pos.clone().addScaledVector(f.fwd, -back); want.y = Math.max(want.y, this.hAt ? this.hAt(want.x, want.z) : 0) + 3.5 + back * 0.2;
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 4));
      const look = f.pos.clone().addScaledVector(f.fwd, 20); look.y += 1.5;
      this.camera.lookAt(look); this.controls.target.copy(look);
    } else {
      if (this.flight) {
        const fl = this.flight; fl.t = Math.min(1, fl.t + dt / 1.6); const e = fl.t * fl.t * (3 - 2 * fl.t);
        this.camera.position.lerpVectors(fl.p0, fl.p1, e); this.controls.target.lerpVectors(fl.q0, fl.q1, e); if (fl.t >= 1) this.flight = null;
      }
      this.controls.update();
    }
    // shadow box follows the view, sized by camera distance
    const tgt = this.controls.target, dist = this.camera.position.distanceTo(tgt);
    const half = THREE.MathUtils.clamp(dist * 0.9, 60, (this.extent || 2000) * 0.75);
    const cam = this.sun.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = half * 6; cam.updateProjectionMatrix(); }
    this.sun.target.position.copy(tgt); this.sun.position.copy(tgt).addScaledVector(this.sunDir, half * 3);
    this.renderer.render(this.scene, this.camera);
  }
}
