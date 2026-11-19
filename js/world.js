// Builds a 3D landscape for one AOI.
// load(): network work (OSM tiles, terrain, imagery) + image analysis, done once per AOI.
// construct(): all geometry, re-run quickly when terrain height / smoothing changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './geo.js?v=77';
import { makeRoadMaterial, makeBuildingMaterial, makeTerrainMaterial, makeWaterMaterial } from './shaders.js?v=77';
import { noiseTexture, waterNormals, detailTextures, balanceGains, enhanceCanvas, classify, wb } from './textures.js?v=77';
import { buildTrees, GrassField } from './vegetation.js?v=77';
import { RoadNet, Driver, Walker } from './modes.js?v=77';
import { vehicleKit } from './vehicles.js?v=77';
import { human, cow, animMaterial, SHIRTS } from './people.js?v=77';
import { loadUnderground, sampleLine, wallMesh } from './section.js?v=77';
import { LayerStack } from './layers.js?v=77';
import { Survey } from './survey.js?v=77';
import { Editor } from './editor.js?v=77';
import { Atmos } from './atmos.js?v=77';
import { NightLights } from './lights.js?v=77';
import { loadIO, detailedLandCover, lcCanvas, LC } from './landcover.js?v=77';
import { Tactical, loadCatalog } from './tactical.js?v=77';
import { LcTrainer } from './lctrain.js?v=77';
import { Radar } from './radar.js?v=77';
import { Globe } from './globe.js?v=77';
import { SEASON } from './vegetation.js?v=77';
import { fillClouds, S2_CREDIT } from './clouds.js?v=77';
import { ResultLayers } from './results.js?v=77';

const IMAGERY = {
  esri: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  google: { url: (z, x, y) => `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`, max: 20, credit: 'Imagery © Google' },
};
const TERRAIN_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const tick = () => new Promise(r => setTimeout(r, 0));
const V3 = THREE.Vector3;

/* ---------- road style rules (class codes from tools/extract.py) ---------- */
const BASE_W = { 1: 7.6, 2: 5.2, 3: 10.5, 4: 5.2, 5: 9, 6: 5, 7: 8, 8: 4.8, 9: 6.5, 10: 4.5, 11: 5, 12: 4.6, 13: 4, 14: 3.4, 15: 5, 16: 3.2, 17: 1.8, 18: 1.4, 19: 2, 20: 2, 21: 6 };
const RANK = { 1: 10, 2: 7, 3: 9, 4: 7, 5: 8, 6: 6, 7: 7, 8: 5, 9: 6, 10: 4, 11: 4, 12: 3, 13: 3, 14: 2, 15: 2, 16: 1, 17: 1, 18: 0, 19: 1, 20: 0, 21: 2 };
function roadStyle(cls, surf, lanes, widthDm, flags) {
  const oneway = flags & 1, urban = flags & 8;
  let s;
  if (surf >= 1 && surf <= 8) s = surf;
  else if (cls <= 10) s = 1;
  else if (cls === 11) s = urban ? 1 : 4;
  else if (cls === 12 || cls === 14) s = urban ? 2 : 4;
  else if (cls === 13 || cls === 15) s = 3;
  else if (cls === 16) s = 9;
  else if (cls >= 17 && cls <= 20) s = urban ? 11 : 4;
  else s = 4;
  let mk = 0, ln = lanes || 0;
  if (s === 1 || s === 2) {
    if (cls === 1 || cls === 3) { ln = ln || 2; mk = oneway ? 4 : (ln >= 4 ? 3 : 2); }
    else if (cls === 5 || cls === 7) { ln = ln || 2; mk = oneway ? (ln > 1 ? 4 : 2) : (ln >= 4 ? 3 : 2); }
    else if ([2, 4, 6, 8, 10].includes(cls)) { ln = ln || 1; mk = oneway ? (ln > 1 ? 4 : 2) : 2; }
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

const WALK_AMP = 0.42, WALK_CYCLE = 4 * 0.85 * Math.sin(WALK_AMP); // ≈1.4 m per stride cycle
class Frame {
  constructor(a) {
    this.lon0 = (a.w + a.e) / 2; this.lat0 = (a.s + a.n) / 2;
    this.mx = 111320 * Math.cos(this.lat0 * Math.PI / 180); this.mz = 110574;
    this.W = (a.e - a.w) * this.mx; this.H = (a.n - a.s) * this.mz;
  }
  x(lon) { return (lon - this.lon0) * this.mx; } z(lat) { return -(lat - this.lat0) * this.mz; }
  lon(x) { return this.lon0 + x / this.mx; } lat(z) { return this.lat0 - z / this.mz; }
}
function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }; await Promise.all(Array.from({ length: n }, run)); }
function pointInRings(x, z, rings) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const densify = (pts, step) => {
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / step));
    for (let t = 1; t <= k; t++) out.push([ax + (bx - ax) * t / k, az + (bz - az) * t / k]);
  }
  return out;
};
const withS = pts => { let s = 0; return pts.map((p, i) => { if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); return { x: p[0], z: p[1], s, y: 0 }; }); };
function movingAvg(vals, win) { // uniform-ish spacing
  const n = vals.length, pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + vals[i];
  return vals.map((_, i) => { const a = Math.max(0, i - win), b = Math.min(n, i + win + 1); return (pre[b] - pre[a]) / (b - a); });
}

/* ====================================================================== */
export class World {
  constructor(container) {
    this.results = new ResultLayers(this);
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(container.clientWidth, container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.maxTex = r.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
    this.mobile = matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 700;

    const sc = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.3, 60000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.screenSpacePanning = true; this.controls.zoomToCursor = true; // zoom towards the point under the cursor

    this.sky = new Sky(); this.sky.scale.setScalar(45000); sc.add(this.sky);
    const u = this.sky.material.uniforms; u.turbidity.value = 4; u.rayleigh.value = 2.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.hemi = new THREE.HemisphereLight(0xdfeaf5, 0x5a6640, 1.0); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2); this.sun.castShadow = true;
    const ms = this.mobile ? 2048 : 4096; this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.35;
    sc.add(this.sun, this.sun.target);
    this.sunDir = new V3();
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    sc.environmentIntensity = 0.45;
    sc.fog = new THREE.Fog(0xc6d2db, 2000, 9000);

    this.noise = noiseTexture(); this.waterNormal = waterNormals(); this.detail = detailTextures();
    this.reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType }); this.mirrorCam = new THREE.PerspectiveCamera(); this.reflectOn = true;
    this.reflU = { uRefl: { value: this.reflRT.texture }, uTexMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 } };
    this.uTime = { value: 0 };
    this.kit = vehicleKit();
    this.root = new THREE.Group(); sc.add(this.root);
    this.mode = 'orbit'; this.walker = new Walker(this);
    this.setSun(38, true);

    // taps (short press without drag) for picking roads / teleporting
    const el = r.domElement; let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, performance.now(), e.button]; });
    // a right-click (without dragging) finishes the line or area being drawn
    el.addEventListener('contextmenu', e => e.preventDefault());
    // land-cover training: paint with the left button while painting is on
    let painting = false, lastPaint = 0;
    const paintAt = e => { const r = el.getBoundingClientRect(), rc = this._rc || (this._rc = new THREE.Raycaster()); rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = rc.intersectObject(this.terrainMesh, false)[0]; if (!hit) return null; if (this.brush) { this.brush.position.set(hit.point.x, hit.point.y + 0.5, hit.point.z); this.brush.visible = true; } return hit.point; };
    // zooming out past the farthest view keeps going: out to the whole Earth
    el.addEventListener('wheel', e => { if (this.mode !== 'orbit' || (this.globe && this.globe.on) || !this.D || (this.layers && this.layers.t > 0.01)) return;
      const d = this.camera.position.distanceTo(this.controls.target); if (e.deltaY > 0 && d >= this.controls.maxDistance * 0.97) { this._oz = (this._oz || 0) + 1; if (this._oz >= 4) { this._oz = 0; this.openGlobe(); } } else this._oz = 0; }, { passive: true });
    let spaceDown = false;
    addEventListener('keydown', e => { if (e.code === 'Space' && this.lcPaint && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) { spaceDown = true; el.style.cursor = 'grab'; e.preventDefault(); } });
    addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; el.style.cursor = ''; } });
    el.addEventListener('pointerdown', e => { if (!this.lcPaint || (this.globe && this.globe.on) || this.mode !== 'orbit' || e.button !== 0 || spaceDown || e.altKey || !this.terrainMesh) return; painting = true; this.controls.enabled = false; const p = paintAt(e); if (p) this.onPaint && this.onPaint(p.x, p.z); }, true);
    el.addEventListener('pointermove', e => { if (!this.lcPaint || !this.terrainMesh) return; const now = performance.now(); if (now - lastPaint < 30) return; lastPaint = now; const p = paintAt(e); if (painting && p) this.onPaint && this.onPaint(p.x, p.z); });
    addEventListener('pointerup', () => { if (!painting) return; painting = false; this.controls.enabled = this.mode === 'orbit'; this.onPaintEnd && this.onPaintEnd(); });
    // digitizing: live snap marker + rubber band under the cursor
    let lastHover = 0;
    el.addEventListener('pointermove', e => {
      const ed = this.editor; if (!ed || !ed.active || this.mode !== 'orbit' || !this.terrainMesh || e.buttons || (this.layers && this.layers.t > 0.01)) return;
      const now = performance.now(); if (now - lastHover < 33) return; lastHover = now;
      const r = el.getBoundingClientRect(), rc = this._rc || (this._rc = new THREE.Raycaster());
      rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = rc.intersectObject(this.terrainMesh, false)[0]; if (!hit) return;
      ed.hover(hit.point.x, hit.point.z, this.pxToMetres(hit.point, 14));
    });
    el.addEventListener('pointerup', e => {
      if (!down) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]), dt = performance.now() - down[2]; down = null;
      if (moved < 8 && dt < 450) { if (e.button === 2) { if (!(this.globe && this.globe.on)) this.onRightClick && this.onRightClick(e); } else this.onTap(e); }
    });

    // hover tracking (mouse/trackpad): look around without dragging
    this.mouse = { x: 0, y: 0, inside: false }; this.lookOff = 0;
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return; const b = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - b.left) / b.width) * 2 - 1; this.mouse.y = ((e.clientY - b.top) / b.height) * 2 - 1; this.mouse.inside = true;
    });
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    this.hud = { speed: 0 }; this._prevFocus = null;
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => { try { this.frame(); } catch (e) { if (!this._errShown) { console.error(e); this._errShown = true; } } });
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); const pr = this.renderer.getPixelRatio() * 0.5; this.reflRT.setSize(Math.round(w * pr), Math.round(h * pr)); }

  setSun(elev, env, az) {
    if (az != null) this.sunAz = az;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(this.sunAz ?? 140));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const k = THREE.MathUtils.clamp((elev - 4) / 40, 0, 1);
    this.sun.color.set(0xffa860).lerp(new THREE.Color(0xfff3e2), k);
    this.sun.intensity = 1.6 + 1.8 * k; this.hemi.intensity = 0.5 + 0.6 * k;
    if (env) {
      const eu = this.envSky.material.uniforms; eu.sunPosition.value.copy(this.sunDir);
      for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[key].value = this.sky.material.uniforms[key].value;
      if (this.envRT) this.envRT.dispose(); this.envRT = this.pmrem.fromScene(this.envScene); this.scene.environment = this.envRT.texture;
    }
  }

  clearGeometry() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.root.clear(); this.railMesh = this.bridgeMesh = this.waterMesh = this.buildingsMesh = this.roadMesh = null; this.sideWalls = null; this.vehicles = []; this.vehMeshes = []; this.driver = null; this.playerMesh = null;
  }

  /* ================================================================ LOAD */
  async load(aoi, opts, say) {
    this.clearGeometry(); this.setMode('orbit'); this.results.clear(); if (this.nav && this.nav.active) this.nav.close();
    for (const t of this.textures || []) t.dispose(); this.textures = [];
    const F = this.F = new Frame(aoi), W = F.W, H = F.H, X0 = -W / 2, X1 = W / 2, Z0 = -H / 2, Z1 = H / 2, S = Math.max(W, H);
    const D = this.D = { aoi, W, H, X0, Z0, X1, Z1, S, stats: {} };

    const ioP = loadIO(aoi, W, H); // Esri | Impact Observatory 10 m land cover, fetched while the rest loads
    say('Loading OSM tiles…');
    const tr = G.tileRange(aoi, G.TZ), tl = [];
    for (let x = tr.x0; x <= tr.x1; x++) for (let y = tr.y0; y <= tr.y1; y++) tl.push([x, y]);
    const tiles = (await Promise.all(tl.map(([x, y]) => G.loadOsmTile(x, y).then(d => d && { x, y, d })))).filter(Boolean);
    const toXZ = ll => [F.x(ll[0]), F.z(ll[1])];
    const byId = new Map(), rails = [], waterways = [], waterPolys = [], landuse = [], buildings = [];
    for (const { x, y, d } of tiles) {
      for (const [cls, surf, lanes, wdm, flags, layer, id, enc] of d.r || []) {
        if (!byId.has(id)) byId.set(id, { cls, surf, lanes, wdm, flags, layer, parts: [] });
        byId.get(id).parts.push(G.decode(enc, x, y).map(toXZ));
      }
      for (const r of d.rl || []) for (const c of G.clipLine(G.decode(r[3], x, y).map(toXZ), X0, Z0, X1, Z1)) rails.push(c);
      for (const r of d.ww || []) for (const c of G.clipLine(G.decode(r[3], x, y).map(toXZ), X0, Z0, X1, Z1)) waterways.push({ t: r[0], wdm: r[1], pts: c });
      for (const p of d.w || []) {
        const rings = p[0].map(ring => G.decode(ring, x, y).map(toXZ)), outer = G.clipRing(rings[0], X0, Z0, X1, Z1);
        if (outer.length >= 3) waterPolys.push([outer, ...rings.slice(1).map(r => G.clipRing(r, X0, Z0, X1, Z1)).filter(r => r.length >= 3)]);
      }
      for (const p of d.l || []) landuse.push({ code: p[0], rings: p[1].map(ring => G.decode(ring, x, y).map(toXZ)) });
      for (const b of d.b || []) {
        const ring = G.decode(b[3], x, y).map(toXZ), c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
        if (c[0] < X0 || c[0] > X1 || c[1] < Z0 || c[1] > Z1) continue;
        const cr = G.clipRing(ring, X0, Z0, X1, Z1); if (cr.length >= 3) buildings.push({ t: b[0], hdm: b[1], lv: b[2], ring: cr });
      }
    }
    const roads = [];
    for (const [id, r] of byId) {
      const parts = r.parts.map(p => p.slice()), close = (a, b) => Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6;
      let merged = true;
      while (merged && parts.length > 1) {
        merged = false;
        outer: for (let i = 0; i < parts.length; i++) for (let j = 0; j < parts.length; j++) {
          if (i !== j && close(parts[i][parts[i].length - 1], parts[j][0])) { parts[i] = parts[i].concat(parts[j].slice(1)); parts.splice(j, 1); merged = true; break outer; }
        }
      }
      for (const p of parts) for (const c of G.clipLine(p, X0, Z0, X1, Z1)) roads.push({ ...r, id, pts: c, st: roadStyle(r.cls, r.surf, r.lanes, r.wdm, r.flags) });
    }
    roads.sort((a, b) => RANK[a.cls] - RANK[b.cls]);
    Object.assign(D, { roads, rails, waterways, landuse, buildings }); D.stats.roads = roads.length; this.views = null; this.U = null; this.section = null; if (this.survey) { this.survey.verts = []; this.survey.points = []; this.survey.n = 0; this.survey.target = null; } if (this.layers) { this.layers.ioYears = null; this.layers.flood = null; this.layers.t = this.layers.target = 0; this.layers.stop(); }

    say('Loading terrain…');
    let elev;
    try { elev = await this.loadTerrain(aoi, S < 2500 ? 14 : 13); } catch (e) { console.warn(e); elev = () => 0; say('Terrain unavailable – flat ground.'); }
    const cell = THREE.MathUtils.clamp(S / 560, 3, 8), nx = Math.ceil(W / cell), nz = Math.ceil(H / cell), dx = W / nx, dz = H / nz;
    const raw = new Float32Array((nx + 1) * (nz + 1)); let hmin = Infinity, hmax = -Infinity;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const v = elev(F.lon(X0 + i * dx), F.lat(Z0 + j * dz)); raw[j * (nx + 1) + i] = v; hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
    Object.assign(D, { raw, nx, nz, dx, dz, hmin, hmax });
    D.stats.elev = [hmin, hmax];

    /* imagery */
    const src = IMAGERY[opts.imagery] || IMAGERY.esri;
    let zi = Math.min(src.max, 19), ir;
    for (; zi > 10; zi--) { ir = G.tileRange(aoi, zi); if ((ir.x1 - ir.x0 + 1) * 256 <= this.maxTex && (ir.y1 - ir.y0 + 1) * 256 <= this.maxTex) break; }
    const ntx = ir.x1 - ir.x0 + 1, nty = ir.y1 - ir.y0 + 1; D.ir = ir; D.zi = zi;
    const img = document.createElement('canvas'); img.width = ntx * 256; img.height = nty * 256;
    const ictx = img.getContext('2d', { willReadFrequently: true }); ictx.fillStyle = '#6f7d5a'; ictx.fillRect(0, 0, img.width, img.height);
    const jobs = []; for (let x = ir.x0; x <= ir.x1; x++) for (let y = ir.y0; y <= ir.y1; y++) jobs.push([x, y]);
    let done = 0, failed = 0;
    await pool(jobs, 8, async ([x, y]) => {
      try { ictx.drawImage(await loadImage(src.url(zi, x, y)), (x - ir.x0) * 256, (y - ir.y0) * 256); } catch { failed++; }
      if (++done % 6 === 0 || done === jobs.length) say(`Loading imagery ${done}/${jobs.length} (zoom ${zi})…`);
    });
    if (failed === jobs.length && opts.imagery === 'google') { say('Google tiles blocked – switching to Esri…'); return this.load(aoi, { ...opts, imagery: 'esri' }, say); }
    this.credit = src.credit; D.stats.imageryZoom = zi;
    let cloud = null;
    if (opts.cloudFill !== false) {
      try { cloud = await fillClouds({ ictx, W: img.width, H: img.height, ir, zi, source: opts.imagery, say }); }
      catch (e) { console.warn('cloud fill failed', e); }
    }
    D.stats.cloud = cloud && cloud.stats;
    if (cloud && cloud.stats.sources) {
      const n = Object.keys(cloud.stats.sources);
      if (n.some(k => k.startsWith('Google'))) this.credit += ' · © Google';
      if (n.some(k => k.startsWith('Esri Wayback'))) this.credit += ' · Esri World Imagery Wayback';
      if (n.some(k => k.startsWith('Sentinel'))) this.credit += ' · ' + S2_CREDIT;
    }
    const pxX = lon => (G.lon2tx(lon, zi) - ir.x0) * 256, pxY = lat => (G.lat2ty(lat, zi) - ir.y0) * 256;
    const u0 = pxX(F.lon(X0)) / img.width, u1 = pxX(F.lon(X1)) / img.width, v0 = 1 - pxY(F.lat(Z0)) / img.height, v1 = 1 - pxY(F.lat(Z1)) / img.height;
    const imgA = new THREE.Vector4((u1 - u0) / W, u0 - X0 * (u1 - u0) / W, (v1 - v0) / H, v0 - Z0 * (v1 - v0) / H);
    { // inset-map base: AOI imagery with roads
      const mc = document.createElement('canvas'), asp = W / H; mc.width = asp >= 1 ? 512 : Math.round(512 * asp); mc.height = asp >= 1 ? Math.round(512 / asp) : 512;
      const c2 = mc.getContext('2d'), sx0 = pxX(F.lon(X0)), sx1 = pxX(F.lon(X1)), sy0 = pxY(F.lat(Z0)), sy1 = pxY(F.lat(Z1));
      c2.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, 0, 0, mc.width, mc.height);
      c2.lineCap = c2.lineJoin = 'round';
      for (const r of roads) {
        if (r.cls > 16) continue; c2.strokeStyle = r.cls <= 4 ? '#ff9a4a' : r.cls <= 10 ? '#ffe08a' : 'rgba(255,255,255,0.75)'; c2.lineWidth = r.cls <= 4 ? 2.4 : r.cls <= 10 ? 1.8 : 1;
        c2.beginPath(); r.pts.forEach((p, i) => { const x = (p[0] - X0) / W * mc.width, y = (p[1] - Z0) / H * mc.height; i ? c2.lineTo(x, y) : c2.moveTo(x, y); }); c2.stroke();
      }
      this.miniCanvas = mc;
    }
    let px = null; try { px = ictx.getImageData(0, 0, img.width, img.height).data; } catch { }
    const gains = px ? balanceGains(px) : { o: [0, 0, 0], g: [1, 1, 1], add: 0 };
    const pxAt = (x, z) => {
      if (!px) return [110, 130, 90];
      const i = Math.min(img.width - 1, Math.max(0, Math.round(pxX(F.lon(x))))), j = Math.min(img.height - 1, Math.max(0, Math.round(pxY(F.lat(z))))), o = (j * img.width + i) * 4;
      return [wb(px[o], 0, gains), wb(px[o + 1], 1, gains), wb(px[o + 2], 2, gains)];
    };
    Object.assign(D, { img, px, gains, pxAt, pxX, pxY, imgA });
    const mkTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); this.textures.push(t); return t; };
    this.texSat = mkTex(img); this.texEnh = null; this.texStyl = null; this.mkTex = mkTex;
    this.uniforms = { uImg: { value: this.texSat }, uImgA: { value: imgA }, uNoise: { value: this.noise } };

    /* rasters (1.5 m): buildings, roads, water – used for trees, grass and walking collisions */
    say('Reading land cover from the image…'); await tick();
    const MR = 1.5, mw = Math.ceil(W / MR), mh = Math.ceil(H / MR);
    const rast = () => { const c = document.createElement('canvas'); c.width = mw; c.height = mh; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = x.strokeStyle = '#fff'; x.lineCap = x.lineJoin = 'round'; return x; };
    const mxp = x => (x - X0) / MR, mzp = z => (z - Z0) / MR;
    const path = (ctx, pts, close) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(mxp(p[0]), mzp(p[1])) : ctx.moveTo(mxp(p[0]), mzp(p[1]))); if (close) ctx.closePath(); };
    const bctx = rast(); for (const b of buildings) { path(bctx, b.ring, true); bctx.fill(); }
    const rctx = rast(); for (const r of roads) { rctx.lineWidth = (r.st.w + 2.5) / MR; path(rctx, r.pts); rctx.stroke(); } rctx.lineWidth = 6 / MR; for (const r of rails) { path(rctx, r); rctx.stroke(); }
    const toU8 = ctx => { const d = ctx.getImageData(0, 0, mw, mh).data, o = new Uint8Array(mw * mh); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] > 100 ? 1 : 0; return o; };
    const bmask = toU8(bctx), rmask = toU8(rctx);

    /* imagery classification on a 2.5 m grid */
    const C = 2.5, gw = Math.floor(W / C), gh = Math.floor(H / C), cls = new Uint8Array(gw * gh);
    const remain = cloud && cloud.remain;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C;
      if (remain) { const pi = Math.min(img.width - 1, Math.max(0, Math.round(pxX(F.lon(x))))), pj = Math.min(img.height - 1, Math.max(0, Math.round(pxY(F.lat(z))))); if (remain[pj * img.width + pi]) { cls[j * gw + i] = 0; continue; } }
      const [r, g, b] = pxAt(x, z); cls[j * gw + i] = classify(r, g, b);
    }
    // drop OSM water polygons that the image shows as dry/vegetated now (seasonal flood areas)
    const keptWater = [];
    for (const rings of waterPolys) {
      const o = rings[0]; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const area = Math.abs(G.ringArea(o)); if (area < 30) continue;
      const stp = Math.max(C, Math.sqrt((x1 - x0) * (z1 - z0) / 900));
      let n = 0, wet = 0, green = 0;
      for (let z = z0 + stp / 2; z < z1; z += stp) for (let x = x0 + stp / 2; x < x1; x += stp) {
        if (!pointInRings(x, z, rings)) continue; n++;
        const k = cls[Math.min(gh - 1, ((z - Z0) / C) | 0) * gw + Math.min(gw - 1, ((x - X0) / C) | 0)];
        if (k === 1) wet++; else if (k === 2 || k === 3) green++;
      }
      if (area < 2500 || !n || wet / n >= 0.15 || green / n < 0.55) keptWater.push(rings);
    }
    D.waterPolys = keptWater; D.stats.waterDropped = waterPolys.length - keptWater.length;
    const wctx = rast();
    for (const rings of keptWater) { wctx.beginPath(); for (const r of rings) r.forEach((p, i) => i ? wctx.lineTo(mxp(p[0]), mzp(p[1])) : wctx.moveTo(mxp(p[0]), mzp(p[1]))); wctx.fill('evenodd'); }
    for (const wv of waterways) { wctx.lineWidth = (this.waterwayWidth(wv) + 1) / MR; path(wctx, wv.pts); wctx.stroke(); }
    const wmask = toU8(wctx);
    // forest / orchard polygons strengthen canopy in hazy imagery
    const lctx = rast();
    for (const l of landuse) if (l.code === 1 || l.code === 2) { lctx.beginPath(); for (const r of l.rings) r.forEach((p, i) => i ? lctx.lineTo(mxp(p[0]), mzp(p[1])) : lctx.moveTo(mxp(p[0]), mzp(p[1]))); lctx.fill('evenodd'); }
    const fmask = toU8(lctx);
    const mAt = (m, x, z) => m[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
    // near-built grid (within ~10 m of a building) for rice vs village grass, and coconut palms
    const nearB = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (mAt(bmask, X0 + (i + .5) * C, Z0 + (j + .5) * C)) nearB[j * gw + i] = 1;
    for (let pass = 0; pass < 4; pass++) { const c2 = nearB.slice(); for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) if (c2[j * gw + i - 1] || c2[j * gw + i + 1] || c2[(j - 1) * gw + i] || c2[(j + 1) * gw + i]) nearB[j * gw + i] = 1; }
    const counts = [0, 0, 0, 0, 0, 0];
    const splat = new Uint8Array(gw * gh * 4), splatRice = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C, q = j * gw + i;
      let k = cls[q];
      if (mAt(wmask, x, z)) k = 1; else if (k === 1) k = 1;
      if (mAt(rmask, x, z) || mAt(bmask, x, z)) k = 5;
      if (mAt(fmask, x, z) && k === 3) k = 2;
      cls[q] = k; counts[k]++;
      const o = q * 4; // r grass, g rice, b soil, a gravel
      if (k === 2) { splat[o] = 110; splat[o + 2] = 145; } else if (k === 0) splat[o] = 255;
      else if (k === 3) { if (nearB[q]) splat[o] = 255; else { splat[o + 1] = 255; splatRice[q] = 1; } }
      else if (k === 1) { splat[o + 1] = 120; splat[o + 2] = 135; }
      else if (k === 4) splat[o + 2] = 255;
      else splat[o + 3] = 255;
    }
    const tot = Math.max(1, gw * gh - counts[0]);
    this.lulc = { cloud: counts[0] / (gw * gh || 1), water: counts[1] / tot, tree: counts[2] / tot, crop: counts[3] / tot, bare: counts[4] / tot, built: counts[5] / tot };
    const splatTex = new THREE.DataTexture(splat, gw, gh, THREE.RGBAFormat); splatTex.magFilter = splatTex.minFilter = THREE.LinearFilter; splatTex.needsUpdate = true; this.textures.push(splatTex);
    const exclude = new Uint8Array(mw * mh); for (let i = 0; i < exclude.length; i++) exclude[i] = bmask[i] | rmask[i] | wmask[i];
    this.bmask = new Uint8Array(mw * mh); for (let i = 0; i < exclude.length; i++) this.bmask[i] = bmask[i] | wmask[i];
    Object.assign(D, { MR, mw, mh, C, gw, gh, cls, splatRice, exclude, nearB, wmask });
    D.rmask = rmask; D.bmaskOSM = bmask; D.landuse = landuse;
    say('Refining land cover (13 classes)…'); await tick();
    const det = detailedLandCover(D, F, await ioP, (x, z) => this.rawElevation(x, z)); D.lc = det.lc; D.lcPct = det.pct; D.lcIO = det.io;
    D.nearBuilt = (x, z) => nearB[Math.min(gh - 1, Math.max(0, ((z - Z0) / C) | 0)) * gw + Math.min(gw - 1, Math.max(0, ((x - X0) / C) | 0))];

    this.terrainU = {
      uSplat: { value: splatTex }, uGrid: { value: new THREE.Vector4(X0, Z0, gw * C, gh * C) }, uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) },
      uGrass: { value: this.detail.grass }, uRice: { value: this.detail.rice }, uSoil: { value: this.detail.soil }, uGravel: { value: this.detail.gravel }, uDetailOn: { value: 1 }, uSeason: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    this.terrainMat = makeTerrainMaterial(this.texSat, this.terrainU);
    this.waterU = { uHgt: { value: null }, uGrid: { value: new THREE.Vector4() }, uImg: this.uniforms.uImg, uImgA: this.uniforms.uImgA, uTime: this.uTime, ...this.reflU };
    this.waterMat = makeWaterMaterial(this.waterNormal, this.waterU);
    return D;
  }

  // compatibility for a cached older page (v1 app.js called world.build)
  async build(aoi, opts, progress) {
    const say = progress || (() => {});
    await this.load(aoi, opts, say);
    const st = await this.construct({ exaggeration: opts.exaggeration ?? 1.5, smooth: true }, say);
    const t = st.trees || {};
    return { stats: { ...st, trees: (t.round || 0) + (t.tall || 0) + (t.wide || 0), palms: (t.sugar || 0) + (t.coco || 0) } };
  }

  waterwayWidth(wv) { return wv.wdm >= 10 ? wv.wdm / 10 : ({ 1: 18, 2: 7, 3: 3.5, 4: 2 })[wv.t]; }

  async loadTerrain(aoi, z) {
    const r = G.tileRange(aoi, z), nx = r.x1 - r.x0 + 1, ny = r.y1 - r.y0 + 1;
    const c = document.createElement('canvas'); c.width = nx * 256; c.height = ny * 256; const ctx = c.getContext('2d', { willReadFrequently: true });
    const jobs = []; for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) jobs.push([x, y]);
    await pool(jobs, 6, async ([x, y]) => { ctx.drawImage(await loadImage(TERRAIN_URL(z, x, y)), (x - r.x0) * 256, (y - r.y0) * 256); });
    const d = ctx.getImageData(0, 0, c.width, c.height).data, Wd = c.width, Hd = c.height;
    const h = (px, py) => { px = Math.min(Wd - 1, Math.max(0, px)); py = Math.min(Hd - 1, Math.max(0, py)); const o = (py * Wd + px) * 4; return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768; };
    return (lon, lat) => {
      const fx = (G.lon2tx(lon, z) - r.x0) * 256 - 0.5, fy = (G.lat2ty(lat, z) - r.y0) * 256 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty) + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
    };
  }

  /* ============================================================ CONSTRUCT */
  async construct(opts, say) {
    const D = this.D; if (!D) return;
    const keepView = this.views ? { p: this.camera.position.clone(), t: this.controls.target.clone() } : null;
    const prevMode = this.mode; this.setMode('orbit');
    this.clearGeometry();
    const exag = opts.exaggeration ?? 1, smoothOn = opts.smooth !== false;
    if (!D.exclude0) { D.exclude0 = D.exclude.slice(); D.bmask0 = this.bmask.slice(); } else { D.exclude.set(D.exclude0); this.bmask.set(D.bmask0); }
    const { W, H, X0, Z0, X1, Z1, S, nx, nz, dx, dz, raw, hmin } = D, R = nx + 1;
    const rnd = G.mulberry32(Math.round(D.aoi.w * 1e4 + D.aoi.s * 1e3));
    D.stats.exag = exag;

    /* 1. terrain heights: exaggerate, smooth, carve water, grade roads */
    say('Shaping terrain…'); await tick();
    const base = Math.max(hmin, 0), Hg = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) Hg[i] = (raw[i] - base) * exag;
    this.seaY = -base * exag;
    if (smoothOn) {
      const tmp = new Float32Array(Hg.length);
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let s = 0, n = 0; for (let a = -1; a <= 1; a++) { const ii = i + a; if (ii < 0 || ii > nx) continue; s += Hg[j * R + ii]; n++; } tmp[j * R + i] = s / n; }
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let s = 0, n = 0; for (let a = -1; a <= 1; a++) { const jj = j + a; if (jj < 0 || jj > nz) continue; s += tmp[jj * R + i]; n++; } Hg[j * R + i] = s / n; }
      }
    }
    const gridAt = (x, z) => {
      let gx = (x - X0) / dx, gz = (z - Z0) / dz; gx = Math.min(Math.max(gx, 0), nx - 1e-6); gz = Math.min(Math.max(gz, 0), nz - 1e-6);
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
      return (Hg[j * R + i] * (1 - fx) + Hg[j * R + i + 1] * fx) * (1 - fz) + (Hg[(j + 1) * R + i] * (1 - fx) + Hg[(j + 1) * R + i + 1] * fx) * fz;
    };
    const waterDepth = 1.1 + 0.5 * Math.min(exag, 2), wLevel = new Float32Array(Hg.length).fill(NaN);
    const waterSurfaces = [];
    for (const rings of D.waterPolys) {
      const o = rings[0]; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const i0 = Math.max(0, Math.floor((x0 - X0) / dx)), i1 = Math.min(nx, Math.ceil((x1 - X0) / dx)), j0 = Math.max(0, Math.floor((z0 - Z0) / dz)), j1 = Math.min(nz, Math.ceil((z1 - Z0) / dz));
      const inside = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInRings(X0 + i * dx, Z0 + j * dz, rings)) inside.push(j * R + i);
      let level;
      if (inside.length >= 3) { const hs = inside.map(v => Hg[v]).sort((a, b) => a - b); level = hs[Math.floor(hs.length * 0.25)]; }
      else level = Math.min(...o.map(([x, z]) => gridAt(x, z)));
      level = Math.max(level, this.seaY + 0.05);
      for (const v of inside) { Hg[v] = Math.min(Hg[v], level - waterDepth); wLevel[v] = level; }
      waterSurfaces.push({ rings, level: level + 0.05 });
    }
    const step = Math.min(dx, dz) * 0.6;
    const waterLines = [];
    for (const wv of D.waterways) {
      const width = this.waterwayWidth(wv), pts = withS(densify(wv.pts, step));
      // skip channels that run inside a mapped water polygon
      let inPoly = 0; for (let k = 0; k < pts.length; k += 4) if (D.waterPolys.some(r => pointInRings(pts[k].x, pts[k].z, r))) inPoly++;
      if (inPoly > pts.length / 4 * 0.7) continue;
      const g = pts.map(p => gridAt(p.x, p.z)), win = Math.max(2, Math.round(40 / step));
      const lo = g.map((_, i) => { let m = Infinity; for (let k = Math.max(0, i - win); k <= Math.min(g.length - 1, i + win); k++) m = Math.min(m, g[k]); return m; });
      const lvl = movingAvg(lo, win).map(v => Math.max(v - 0.25, this.seaY + 0.05));
      pts.forEach((p, i) => p.y = lvl[i] + 0.05);
      const half = width / 2 + 0.6;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half - X0) / dx)), i1 = Math.min(nx, Math.ceil((Math.max(a.x, b.x) + half - X0) / dx));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - half - Z0) / dz)), j1 = Math.min(nz, Math.ceil((Math.max(a.z, b.z) + half - Z0) / dz));
        const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = X0 + i * dx, z = Z0 + j * dz, t = THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / L2, 0, 1);
          if (Math.hypot(x - a.x - vx * t, z - a.z - vz * t) <= half) { const v = j * R + i; Hg[v] = Math.min(Hg[v], lvl[k] - waterDepth * 0.7); wLevel[v] = lvl[k]; }
        }
      }
      waterLines.push({ pts, width });
    }
    // gentle banks: SRTM often puts forest canopy height on the land next to water, which made cliffs.
    // Chamfer distance from water, carrying the nearest water level, then cap the land to a slope.
    {
      const dist = new Float32Array(Hg.length).fill(1e9), lv = new Float32Array(Hg.length);
      for (let v = 0; v < Hg.length; v++) if (wLevel[v] === wLevel[v]) { dist[v] = 0; lv[v] = wLevel[v]; }
      const dd = Math.hypot(dx, dz), relax = (v, u, c) => { if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; lv[v] = lv[u]; } };
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const v = j * R + i; if (i) relax(v, v - 1, dx); if (j) { relax(v, v - R, dz); if (i) relax(v, v - R - 1, dd); if (i < nx) relax(v, v - R + 1, dd); } }
      for (let j = nz; j >= 0; j--) for (let i = nx; i >= 0; i--) { const v = j * R + i; if (i < nx) relax(v, v + 1, dx); if (j < nz) { relax(v, v + R, dz); if (i < nx) relax(v, v + R + 1, dd); if (i) relax(v, v + R - 1, dd); } }
      const slope = 0.06 + 0.06 * Math.min(exag, 2);
      for (let v = 0; v < Hg.length; v++) if (dist[v] > 0 && dist[v] < 80) Hg[v] = Math.min(Hg[v], lv[v] + 0.35 + dist[v] * slope);
    }
    // road grading: smooth each road's long profile and conform the terrain corridor to it
    const tgt = new Float32Array(Hg.length), wgt = new Float32Array(Hg.length);
    const graded = [];
    const profile = (pts, win) => {
      const g = pts.map(p => gridAt(p.x, p.z)), w = Math.max(1, Math.round(win / step));
      const sm = movingAvg(movingAvg(g, w), Math.max(1, w >> 1)).map(v => Math.max(v, this.seaY + 0.3));
      pts.forEach((p, i) => p.g = sm[i]);
    };
    const grade = (pts, hw, win, noProfile) => {
      if (!noProfile) profile(pts, win);
      const half = hw + 1.5, blend = 7;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1], r = half + blend;
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - X0) / dx)), i1 = Math.min(nx, Math.ceil((Math.max(a.x, b.x) + r - X0) / dx));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - r - Z0) / dz)), j1 = Math.min(nz, Math.ceil((Math.max(a.z, b.z) + r - Z0) / dz));
        const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = X0 + i * dx, z = Z0 + j * dz, t = THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / L2, 0, 1);
          const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t), ww = d <= half ? 1 : Math.max(0, 1 - (d - half) / blend);
          const v = j * R + i; if (ww > 0 && ww >= wgt[v]) { wgt[v] = ww; tgt[v] = a.g + (b.g - a.g) * t - 0.08; }
        }
      }
    };
    for (const r of D.roads) {
      if (r.flags & 4) continue;
      const pts = withS(densify(r.pts, step)); if (pts[pts.length - 1].s < 0.5) continue;
      const isBridge = (r.flags & 2) && pts[pts.length - 1].s > 6;
      if (!isBridge) profile(pts, r.cls <= 4 ? 120 : r.cls <= 8 ? 80 : r.cls <= 12 ? 45 : 25);
      graded.push({ r, pts, isBridge });
    }
    // junctions: each road meets the more important road it joins at that road's height,
    // easing its own long profile into the junction over ~30 m (no steps or floating ends)
    {
      const cell = 6, hash = new Map(), key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
      const order = graded.filter(g => !g.isBridge).sort((a, b) => (RANK[b.r.cls] ?? 0) - (RANK[a.r.cls] ?? 0) || b.pts[b.pts.length - 1].s - a.pts[a.pts.length - 1].s);
      for (const { r, pts } of order) {
        const hw = r.st.w / 2, anchors = [];
        pts.forEach(p => {
          const ci = Math.floor(p.x / cell), cj = Math.floor(p.z / cell); let best = null, bd = Infinity;
          for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (const q of hash.get(i + ',' + j) || []) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < q.hw + hw + 1 && d < bd) { bd = d; best = q; } }
          if (best) anchors.push({ s: p.s, g: best.g });
        });
        if (anchors.length) {
          const R2 = 30, base = pts.map(p => p.g);
          pts.forEach((p, i) => {
            let wsum = 0, gsum = 0, wmax = 0;
            for (const a of anchors) { const d = Math.abs(p.s - a.s); if (d >= R2) continue; const t = 1 - d / R2, w = t * t * (3 - 2 * t); wsum += w; gsum += w * a.g; wmax = Math.max(wmax, w); }
            if (wsum > 0) p.g = base[i] * (1 - wmax) + (gsum / wsum) * wmax;
          });
        }
        for (const p of pts) { const k = key(p.x, p.z); (hash.get(k) || hash.set(k, []).get(k)).push({ x: p.x, z: p.z, g: p.g, hw }); }
      }
      // conform the terrain: minor roads first so the major road corridor wins where they overlap
      for (const g of order.slice().reverse()) grade(g.pts, g.r.st.w / 2, 0, true);
    }
    const railPts = D.rails.map(c => { const pts = withS(densify(c, step)); grade(pts, 1.8, 160); return pts; });
    for (let v = 0; v < Hg.length; v++) if (wgt[v] > 0) Hg[v] = Hg[v] * (1 - wgt[v]) + tgt[v] * wgt[v];
    const hAt = (x, z) => {
      let gx = (x - X0) / dx, gz = (z - Z0) / dz; gx = Math.min(Math.max(gx, 0), nx - 1e-6); gz = Math.min(Math.max(gz, 0), nz - 1e-6);
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
      const a = Hg[j * R + i], b = Hg[(j + 1) * R + i], c = Hg[(j + 1) * R + i + 1], d = Hg[j * R + i + 1];
      return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
    };
    this.hAt = hAt; this.Hg = Hg;

    /* 2. terrain mesh + soil sides */
    say('Building terrain…'); await tick();
    {
      const pos = new Float32Array(R * (nz + 1) * 3), uv = new Float32Array(R * (nz + 1) * 2), idx = new Uint32Array(nx * nz * 6);
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const k = j * R + i, x = X0 + i * dx, z = Z0 + j * dz;
        pos[k * 3] = x; pos[k * 3 + 1] = Hg[k]; pos[k * 3 + 2] = z;
        uv[k * 2] = D.pxX(this.F.lon(x)) / D.img.width; uv[k * 2 + 1] = 1 - D.pxY(this.F.lat(z)) / D.img.height;
      }
      let q = 0; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * R + i, b = a + R, c = b + 1, d = a + 1; idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
      this.terrainMesh = new THREE.Mesh(g, this.terrainMat); this.terrainMesh.receiveShadow = true; this.root.add(this.terrainMesh);
      let lowest = Infinity; for (const v of Hg) lowest = Math.min(lowest, v);
      const bottom = lowest - 25, sp = [], scol = [], top = new THREE.Color(0x7a4a2c), bot = new THREE.Color(0x3b2a20);
      const edge = pts => { for (let k = 0; k < pts.length - 1; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1], ha = hAt(ax, az), hb = hAt(bx, bz);
        sp.push(ax, ha, az, bx, hb, bz, ax, bottom, az, bx, hb, bz, bx, bottom, bz, ax, bottom, az); for (const c of [top, top, bot, top, bot, bot]) scol.push(c.r, c.g, c.b); } };
      const line = (ax, az, bx, bz, n) => Array.from({ length: n + 1 }, (_, k) => [ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      edge(line(X0, Z1, X1, Z1, nx)); edge(line(X1, Z1, X1, Z0, nz)); edge(line(X1, Z0, X0, Z0, nx)); edge(line(X0, Z0, X0, Z1, nz));
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3)); sg.computeVertexNormals();
      this.sidesMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })); this.root.add(this.sidesMesh);
      const bp = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e241c })); bp.position.y = bottom; this.root.add(bp); this.bottom = bottom; this.basePlate = bp;
      // height texture for water depth shading
      const hf = new Uint16Array(Hg.length); for (let i = 0; i < Hg.length; i++) hf[i] = THREE.DataUtils.toHalfFloat(Hg[i]);
      const ht = new THREE.DataTexture(hf, R, nz + 1, THREE.RedFormat, THREE.HalfFloatType); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
      if (this.waterU.uHgt.value) this.waterU.uHgt.value.dispose();
      this.waterU.uHgt.value = ht; this.waterU.uGrid.value.set(X0 - dx / 2, Z0 - dz / 2, W + dx, H + dz);
    }

    /* 3. roads, rails, bridges */
    say(`Building ${graded.length} roads…`); await tick();
    const RB = { pos: [], a1: [], a2: [], idx: [] };
    const ribbon = (pts, hw, info, B = RB) => {
      const n = pts.length; if (n < 2) return; const base0 = B.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nxv = -tz, nzv = tx; let sc = 1;
        if (i > 0 && i < n - 1) { const px = p.x - a.x, pz = p.z - a.z, pl = Math.hypot(px, pz) || 1; sc = 1 / Math.max(0.6, (-pz / pl) * nxv + (px / pl) * nzv); }
        for (const sd of [-1, 1]) { B.pos.push(p.x + nxv * hw * sd * sc, p.y, p.z + nzv * hw * sd * sc); if (B.a1) { B.a1.push(sd * hw, p.s, hw, 0); B.a2.push(info[0], info[1], info[2], 0); } }
      }
      for (let i = 0; i < n - 1; i++) { const a = base0 + 2 * i, b = a + 1, c = a + 2, d = a + 3; B.idx.push(a, b, c, b, d, c); }
    };
    const bridgeParts = [];
    this.lanesForTraffic = []; const netRoads = [];
    for (const { r, pts, isBridge } of graded) {
      const st = r.st, L = pts[pts.length - 1].s, lift = 0.1 + RANK[r.cls] * 0.015;
      if (isBridge) {
        const hA = hAt(pts[0].x, pts[0].z), hB = hAt(pts[pts.length - 1].x, pts[pts.length - 1].z);
        let Hh = Math.min(7, Math.max(0.8, L * 0.05)); if (r.layer >= 1 && L > 60) Hh = Math.max(Hh, 5.5);
        Hh *= Math.max(0.4, Math.sqrt(Math.max(exag, 0.2)));
        for (const p of pts) { const t = p.s / L, ramp = THREE.MathUtils.smoothstep(t, 0, 0.3) * THREE.MathUtils.smoothstep(1 - t, 0, 0.3); p.y = Math.max(hA + (hB - hA) * t + Hh * ramp, hAt(p.x, p.z) + 0.6) + lift; }
        bridgeParts.push({ pts, hw: st.w / 2 });
      } else for (const p of pts) p.y = Math.max(p.g, hAt(p.x, p.z)) + lift;
      ribbon(pts, st.w / 2, [st.mk, st.lanes, st.s]);
      const oneway = (r.flags & 1) || (r.flags & 16) ? 1 : 0;
      if (r.cls <= 14 && r.cls !== 13 && L > 20) this.lanesForTraffic.push({ pts, st, cls: r.cls, oneway, urban: r.flags & 8 });
      if (r.cls <= 16 && r.cls !== 15) netRoads.push({ pts, hw: st.w / 2, oneway, cls: r.cls, urban: r.flags & 8, bridge: !!isBridge, lanes: st.lanes, id: r.id });
    }
    for (const pts of railPts) { for (const p of pts) p.y = Math.max(p.g, hAt(p.x, p.z)) + 0.32; ribbon(pts, 1.8, [0, 1, 10]); }
    if (RB.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(RB.pos, 3));
      g.setAttribute('aRoad', new THREE.Float32BufferAttribute(RB.a1, 4)); g.setAttribute('aRoad2', new THREE.Float32BufferAttribute(RB.a2, 4));
      g.setIndex(RB.idx); g.computeVertexNormals();
      this.roadMesh = new THREE.Mesh(g, makeRoadMaterial(this.uniforms)); this.roadMesh.receiveShadow = true; this.root.add(this.roadMesh);
    }
    if (railPts.length) {
      const RB2 = { pos: [], idx: [] };
      for (const pts of railPts) for (const o of [-0.5, 0.5]) ribbon(pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; return { x: p.x - tz / l * o, z: p.z + tx / l * o, y: p.y + 0.16, s: p.s }; }), 0.05, null, RB2);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(RB2.pos, 3)); g.setIndex(RB2.idx); g.computeVertexNormals();
      this.railMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })); this.root.add(this.railMesh);
    }
    this.buildBridges(bridgeParts);
    this.net = new RoadNet(netRoads);

    /* 4. water surfaces */
    say('Building water…'); await tick();
    const wGeos = [];
    for (const { rings, level } of waterSurfaces) {
      try {
        const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1])), holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
        const tris = THREE.ShapeUtils.triangulateShape(contour, holes), all = contour.concat(...holes), pos = [], uv = [];
        for (const t of tris) for (const k of t) { const p = all[k]; pos.push(p.x, level, p.y); uv.push(p.x / 25, p.y / 25); }
        if (!pos.length) continue;
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); wGeos.push(g);
      } catch (e) { }
    }
    for (const { pts, width } of waterLines) {
      const B = { pos: [], idx: [] }; ribbon(pts, width / 2 + 0.4, null, B);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3)); g.setIndex(B.idx);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.pos.flatMap((v, i) => i % 3 === 1 ? [] : [v / 25]), 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(B.pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); wGeos.push(g.toNonIndexed());
    }
    if (hmin < 1.5) {
      const g = new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2); g.translate(0, this.seaY + 0.1, 0);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 25, uv.getY(i) * H / 25); wGeos.push(g.toNonIndexed());
    }
    this.waterMesh = null;
    if (wGeos.length) { const m = new THREE.Mesh(mergeGeometries(wGeos), this.waterMat); m.receiveShadow = true; this.root.add(m); this.waterMesh = m; }
    this.waterBodies = [];
    const bb = (pts, level) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { const x = p.x ?? p[0], z = p.z ?? p[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } this.waterBodies.push({ level, x0, x1, z0, z1 }); };
    for (const w of waterSurfaces) bb(w.rings[0], w.level);
    for (const w of waterLines) bb(w.pts, w.pts.reduce((a, p) => a + p.y, 0) / w.pts.length);
    if (hmin < 1.5) this.waterBodies.push({ level: this.seaY + 0.1, x0: X0, x1: X1, z0: Z0, z1: Z1 });

    /* 5. buildings */
    say(`Building ${D.buildings.length} buildings…`); await tick();
    const bgeo = this.buildBuildings(D.buildings, rnd);
    if (bgeo) { const m = new THREE.Mesh(bgeo, makeBuildingMaterial()); m.castShadow = m.receiveShadow = true; this.buildingsMesh = m; this.root.add(m); }
    // rural houses inferred from the image where OpenStreetMap has none (built-up pixels next to roads)
    this.housesMesh = null; D.stats.houses = 0;
    if (this.inferHouses !== false) {
      const hs = this.inferHousesList(rnd); D.stats.houses = hs.length; this.housesList = hs;
      if (hs.length) { const g = this.buildBuildings(hs, rnd, { noStats: true }); if (g) { const m = new THREE.Mesh(g, makeBuildingMaterial()); m.castShadow = m.receiveShadow = true; this.housesMesh = m; this.root.add(m); } }
    }

    /* 6. trees + near grass */
    say('Planting trees from the image…'); await tick();
    // where palms belong: open lowland, not inside large forests or on hills/mountains
    const sat = new Uint32Array((D.gw + 1) * (D.gh + 1));
    for (let j = 0; j < D.gh; j++) for (let i = 0; i < D.gw; i++) sat[(j + 1) * (D.gw + 1) + i + 1] = (D.cls[j * D.gw + i] === 2 ? 1 : 0) + sat[j * (D.gw + 1) + i + 1] + sat[(j + 1) * (D.gw + 1) + i] - sat[j * (D.gw + 1) + i];
    const forestFrac = (x, z) => {
      const ci = ((x - X0) / D.C) | 0, cj = ((z - Z0) / D.C) | 0, r = 24, i0 = Math.max(0, ci - r), i1 = Math.min(D.gw, ci + r), j0 = Math.max(0, cj - r), j1 = Math.min(D.gh, cj + r), W1 = D.gw + 1;
      return (sat[j1 * W1 + i1] - sat[j0 * W1 + i1] - sat[j1 * W1 + i0] + sat[j0 * W1 + i0]) / Math.max(1, (i1 - i0) * (j1 - j0));
    };
    const slopeAt = (x, z) => { const e = 30, a = this.rawElevation(x + e, z) - this.rawElevation(x - e, z), b = this.rawElevation(x, z + e) - this.rawElevation(x, z - e); return Math.hypot(a, b) / (2 * e); };
    const palmOK = (x, z) => forestFrac(x, z) < 0.4 && slopeAt(x, z) < 0.07 && this.rawElevation(x, z) < 150;
    const vctx = { ...D, mask: D.exclude, pxAt: D.pxAt, hAt, rnd, mobile: this.mobile, palmOK };
    const t = buildTrees(vctx); this.treeMeshes = t.meshes; t.meshes.forEach(m => this.root.add(m));
    this._treeMat0 = this.treeMeshes.map(m => m.instanceMatrix.array.slice()); this.housesList0 = this.housesList || []; D.buildings0 = D.buildings0 || D.buildings; this._cleared = null;
    D.stats.trees = t.counts;
    this.grass = new GrassField(vctx, this.uTime, this.mobile); this.root.add(this.grass.group);

    /* 7. traffic */
    if (opts.traffic !== false) { say('Adding traffic…'); this.buildTraffic(rnd); }
    say('Adding people and cattle…'); this.netRoadsForPeople = netRoads; this.buildPeople(rnd);

    /* 8. views */
    const hc = hAt(0, 0); this.extent = S;
    this.views = {
      overview: { pos: [S * 0.45, hc + S * 0.55, S * 0.75], target: [0, hc, 0] },
      oblique: { pos: [S * 0.18, hc + S * 0.12, S * 0.3], target: [0, hc, -S * 0.05] },
      street: { pos: [S * 0.04, hc + 18, S * 0.1], target: [-S * 0.04, hc, -S * 0.03] },
    };
    this.controls.maxDistance = S * 3; this.controls.minDistance = 2;
    this.scene.fog.near = S * 1.2; this.scene.fog.far = S * 5;
    this.camera.far = S * 20; this.camera.updateProjectionMatrix(); this.sky.scale.setScalar(S * 12);
    if (keepView) { this.camera.position.copy(keepView.p); this.controls.target.copy(keepView.t); this.controls.update(); }
    else this.goView('overview', true);
    if (prevMode === 'walk') this.setMode('walk');
    if (!this.lights) this.lights = new NightLights(this); this.lights.build();
    if (!this.editor) { try { if (JSON.parse(localStorage.getItem('cambodia3d.edits.v1') || '[]').length) this.editor = new Editor(this); } catch (e) {} }
    if (this.editor) this.editor.rebuild();
    if (this.tactical) { this.tactical.clearAnalysis(); this.tactical.rebuild(); } else { try { if (JSON.parse(localStorage.getItem('cambodia3d.tac.v1') || '[]').length) loadCatalog().then(() => { this.tactical = this.tactical || new Tactical(this); this.tactical.rebuild(); }); } catch (e) {} }
    if (this.survey) this.survey.redraw();
    this.results.rebuild(); if (this.nav) this.nav.rebuild();
    this.exag = exag; if (this.layers) { const t = this.layers.t; await this.layers.rebuild(); this.layers.setExplode(t, true); }
    if (this.U) { this.applySideGeology(); if (this.section) this.makeSection(this.section.A, this.section.B); }
    say('');
    return D.stats;
  }

  /* ---------- bridges ---------- */
  buildBridges(parts) {
    if (!parts.length) return;
    const geos = [];
    const strip = (pts, offA, offB, dyA, dyB) => {
      const pos = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const q = [i, i + 1].map(k => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], p = pts[k], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
          return [[p.x + nx * offA, p.y + dyA, p.z + nz * offA], [p.x + nx * offB, p.y + dyB, p.z + nz * offB]]; });
        const [[a0, b0], [a1, b1]] = q; pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
    };
    for (const { pts, hw } of parts) {
      for (const sd of [-1, 1]) {
        geos.push(strip(pts, sd * hw, sd * hw, 0.02, -1.1), strip(pts, sd * (hw - 0.3), sd * (hw - 0.3), 0, 0.9), strip(pts, sd * (hw - 0.3), sd * hw, 0.9, 0.9), strip(pts, sd * hw, sd * hw, 0.9, 0));
      }
      geos.push(strip(pts, -hw, hw, -1.1, -1.1));
      const L = pts[pts.length - 1].s, n = Math.max(1, Math.round(L / 22));
      for (let k = 1; k < n; k++) {
        const i = pts.findIndex(p => p.s >= L * k / n); if (i < 1) continue; const p = pts[i];
        const gnd = this.hAt(p.x, p.z) - 1.5, top = p.y - 1.1; if (top - gnd < 2) continue;
        const a = pts[i - 1], pier = new THREE.BoxGeometry(hw * 1.5, top - gnd, 1.1); pier.rotateY(Math.atan2(p.x - a.x, p.z - a.z)); pier.translate(p.x, (top + gnd) / 2, p.z);
        geos.push(pier.toNonIndexed());
      }
    }
    const m = new THREE.Mesh(mergeGeometries(geos.map(x => { x.deleteAttribute('uv'); return x; })), new THREE.MeshStandardMaterial({ color: 0xb9b5ad, roughness: 0.85, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true; this.root.add(m); this.bridgeMesh = m;
  }

  /* ---------- buildings ---------- */
  buildBuildings(list, rnd, opts = {}) {
    const pos = [], col = [], wall = [];
    const WALLS = [0xe9e4d8, 0xf1ece2, 0xe8dcc0, 0xd9d3c7, 0xefe2c9, 0xe6d3c3, 0xcfd6d2, 0xf3efe6];
    const ROOF_G = [0xa8452f, 0x9a3b2c, 0xb4583a, 0x3e6b98, 0x58708a, 0x8a8f94, 0x6f7377, 0x2f5e4b, 0xb05a3c];
    const ROOF_F = [0xc9c6bf, 0xbab6ae, 0xd6d3cc, 0xa9a59e, 0x8f8b84];
    const tmp = new THREE.Color();
    const push = (p, c, w) => { pos.push(...p); col.push(c.r, c.g, c.b); wall.push(...w); };
    const tri = (a, b, c, color, w = [0, 0, 0, 0]) => { push(a, color, w); push(b, color, w); push(c, color, w); };
    let count = 0;
    for (const b of list) {
      const ring = b.ring, area = Math.abs(G.ringArea(ring)); if (area < 4) continue;
      count++;
      const t = b.t, big = area > 600;
      let h = b.hdm > 20 ? b.hdm / 10 : b.lv > 0 ? b.lv * 3.2 + 0.6 : 0;
      if (!h) h = ({ 1: 3.6, 2: 6.8, 3: 13, 4: 9.5, 5: 7, 6: 7, 7: 7.4, 8: 9.5, 9: 4, 10: 3, 11: 6, 12: 6 })[t] || (area > 250 ? 7.0 : 3.6 + rnd() * 3.3);
      let gnd = Infinity; for (const p of ring) gnd = Math.min(gnd, this.hAt(p[0], p[1])); gnd -= 0.3;
      if (b.stilt) { gnd += b.stilt; for (const p of ring) { const y0 = this.hAt(p[0], p[1]) - 0.2; for (const [dx, dz] of [[0, 0]]) { const px = p[0], pz = p[1], r = 0.13;
        const cyl = [[px - r, pz - r], [px + r, pz - r], [px + r, pz + r], [px - r, pz + r]]; for (let k = 0; k < 4; k++) { const A = cyl[k], B2 = cyl[(k + 1) % 4], pc = new THREE.Color(0x6b5440).convertSRGBToLinear(); tri([A[0], y0, A[1]], [B2[0], y0, B2[1]], [B2[0], gnd, B2[1]], pc); tri([A[0], y0, A[1]], [B2[0], gnd, B2[1]], [A[0], gnd, A[1]], pc); } } } }
      const stone = t === 6 && area >= 1500; // large temple complexes: sandstone, flat, no windows
      const wallC = new THREE.Color(b.wall != null ? b.wall : stone ? 0x9a8c72 : WALLS[(rnd() * WALLS.length) | 0]).convertSRGBToLinear();
      const winType = t === 9 || t === 10 || t === 6 || t === 11 ? 0 : (h > 6.5 || [3, 4, 7, 8].includes(t)) ? 2 : 1, top = gnd + h;
      let along = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const a0 = [p[0], gnd, p[1]], a1 = [q[0], gnd, q[1]], b0 = [p[0], top, p[1]], b1 = [q[0], top, q[1]];
        tmp.copy(wallC).multiplyScalar(0.92 + 0.12 * Math.abs(Math.sin(Math.atan2(q[1] - p[1], q[0] - p[0]))));
        const w = (s, y) => [along + s, y, winType, h];
        push(a0, tmp, w(0, 0)); push(a1, tmp, w(L, 0)); push(b1, tmp, w(L, h)); push(a0, tmp, w(0, 0)); push(b1, tmp, w(L, h)); push(b0, tmp, w(0, h));
        along += L;
      }
      const ob = G.obb(ring), rect = ob ? area / (4 * ob.a * ob.b) : 0;
      const pitched = b.roof ? (b.roof !== 'flat' && !!ob) : ob && !big && rect > 0.78 && ![3, 4, 5, 9].includes(t) && h < 10 && ob.b > 1.5;
      if (t === 11 && ob) {
        const r = Math.sqrt(area / Math.PI) * 0.9, g = new THREE.LatheGeometry([[0, 0], [r, 0], [r * 0.95, r * 0.6], [r * 0.55, r * 1.3], [r * 0.25, r * 1.9], [0.05, r * 3.2]].map(([x, y]) => new THREE.Vector2(x, y)), 12).toNonIndexed();
        const gp = g.attributes.position, gold = new THREE.Color(0xd8b25a).convertSRGBToLinear(), white = new THREE.Color(0xf2efe6).convertSRGBToLinear();
        for (let i = 0; i < gp.count; i++) push([gp.getX(i) + ob.cx, gp.getY(i) + top, gp.getZ(i) + ob.cz], gp.getY(i) > r * 1.3 ? gold : white, [0, 0, 0, 0]);
      } else if (pitched || (t === 6 && ob && area < 1500)) {
        const o = 0.45, pagoda = t === 6, P = (u, v, y) => [ob.cx + ob.ux * u + ob.vx * v, y, ob.cz + ob.uz * u + ob.vz * v];
        const roofC = new THREE.Color(b.roofC != null ? b.roofC : pagoda ? 0xc0562a : ROOF_G[(rnd() * ROOF_G.length) | 0]).convertSRGBToLinear(), gableC = new THREE.Color(0xd9a441).convertSRGBToLinear();
        const tiers = pagoda ? [[1, 1, 0], [0.72, 0.8, 0.55]] : [[1, 1, 0]], hip = !pagoda && (b.roof ? b.roof === 'hip' : rnd() < 0.45);
        let ybase = top;
        for (const [ka, kb, rise0] of tiers) {
          const A = ob.a * ka, B = ob.b * kb, rise = B * (pagoda ? 0.95 : 0.42 + rnd() * 0.12), y0 = ybase + (rise0 ? -rise * 0.15 : 0), y1 = y0 + rise;
          const ridgeA = hip ? Math.max(0, A - B) : A + o;
          const c1 = P(-A - o, -B - o, y0), c2 = P(A + o, -B - o, y0), c3 = P(A + o, B + o, y0), c4 = P(-A - o, B + o, y0), r1 = P(-ridgeA, 0, y1), r2 = P(ridgeA, 0, y1);
          tri(c1, c2, r2, roofC); tri(c1, r2, r1, roofC);
          const rc2 = roofC.clone().multiplyScalar(0.86); tri(c4, r1, r2, rc2); tri(c4, r2, c3, rc2);
          if (hip) { const rc3 = roofC.clone().multiplyScalar(0.93); tri(c1, r1, c4, rc3); tri(c2, c3, r2, rc3); }
          else { const gc = pagoda ? gableC : wallC; tri(P(-A, -B, y0), P(-A, B, y0), P(-A, 0, y1), gc); tri(P(A, -B, y0), P(A, B, y0), P(A, 0, y1), gc); }
          ybase = y0 + rise * 0.55;
        }
        if (pagoda) tri(P(-0.3, 0, ybase), P(0.3, 0, ybase), P(0, 0, ybase + ob.b * 0.9), gableC);
      } else {
        const roofC = new THREE.Color(stone ? 0x857a66 : ROOF_F[(rnd() * ROOF_F.length) | 0]).convertSRGBToLinear();
        const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
        for (const tr of THREE.ShapeUtils.triangulateShape(contour, [])) tri(...tr.map(k => [contour[k].x, top, contour[k].y]), roofC);
        if (big && ob && rnd() < 0.5) {
          const s = Math.min(4, Math.sqrt(area) * 0.15), cx = ob.cx, cz = ob.cz, y2 = top + 2.2, tc = roofC.clone().multiplyScalar(0.8);
          const q = [[cx - s, cz - s], [cx + s, cz - s], [cx + s, cz + s], [cx - s, cz + s]];
          for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; tri([p[0], top, p[1]], [r[0], top, r[1]], [r[0], y2, r[1]], tc); tri([p[0], top, p[1]], [r[0], y2, r[1]], [p[0], y2, p[1]], tc); }
          tri([q[0][0], y2, q[0][1]], [q[1][0], y2, q[1][1]], [q[2][0], y2, q[2][1]], tc); tri([q[0][0], y2, q[0][1]], [q[2][0], y2, q[2][1]], [q[3][0], y2, q[3][1]], tc);
        }
      }
    }
    if (!opts.noStats) this.D.stats.buildings = count;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 4));
    g.computeVertexNormals(); return g;
  }

  // Houses found in the satellite image: compact roof-coloured blobs (red / orange tile, blue sheet, bright zinc or
  // concrete) that stand out from their surroundings. Each roof gives the house its real position, size,
  // orientation and roof colour. Skipped where OSM already has buildings, on roads and on water.
  inferHousesList(rnd) {
    const D = this.D, F = this.F, { mw, mh, MR, exclude, X0, Z0 } = D, out = [], cap = this.mobile ? 700 : 1600;
    if (!D.px || !this.bmask) return out;
    const img = D.img, IW = img.width, px = D.px, g = D.gains;
    const sx0 = D.pxX(F.lon(X0)), sx1 = D.pxX(F.lon(X0 + D.W)), sy0 = D.pxY(F.lat(Z0)), sy1 = D.pxY(F.lat(Z0 + D.H)), mpp = D.W / (sx1 - sx0);
    if (mpp > 1.25) return out; // image too coarse to see single roofs
    const f = Math.max(1, Math.round(0.6 / mpp)), cell = mpp * f, gw = Math.floor((sx1 - sx0) / f), gh = Math.floor((sy1 - sy0) / f);
    const cls = new Uint8Array(gw * gh), V = new Float32Array(gw * gh), Sat = new Float32Array(gw * gh), R = new Float32Array(gw * gh), Gc = new Float32Array(gw * gh), B = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) { const x = Math.round(sx0 + i * f + u), y = Math.round(sy0 + j * f + v); if (x < 0 || y < 0 || x >= IW || y >= img.height) continue; const o = (y * IW + x) * 4; r += wb(px[o], 0, g); gg += wb(px[o + 1], 1, g); b += wb(px[o + 2], 2, g); n++; }
      if (!n) continue; r /= n; gg /= n; b /= n; const q = j * gw + i, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = (r + gg + b) / 3, sat = mx ? (mx - mn) / mx : 0;
      V[q] = v; Sat[q] = sat; R[q] = r; Gc[q] = gg; B[q] = b;
      if (r > gg + 18 && r > b + 26 && r > 92 && sat > 0.2) cls[q] = 1;                 // red / orange tiles
      else if (b > r + 16 && b > gg && v > 80 && sat > 0.16) cls[q] = 2;               // blue sheet roof
      else if (v > 178 && sat < 0.2) cls[q] = 3;                                         // zinc / concrete
    }
    const lab = new Int32Array(gw * gh).fill(-1), taken = new Map(), key = (x, z) => Math.floor(x / 10) + ',' + Math.floor(z / 10);
    const xAt = i => X0 + ((i + 0.5) * f) * mpp, zAt = j => Z0 + ((j + 0.5) * f) * (D.H / (sy1 - sy0));
    const mAt = (m, x, z) => m[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
    let comp = 0;
    for (let s0 = 0; s0 < gw * gh && out.length < cap; s0++) {
      const c = cls[s0]; if (!c || lab[s0] >= 0) continue;
      const st = [s0], mem = []; lab[s0] = comp;
      while (st.length) { const q = st.pop(); mem.push(q); if (mem.length > 4000) break; const i = q % gw, j = (q / gw) | 0;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const n2 = jj * gw + ii; if (lab[n2] < 0 && cls[n2] === c) { lab[n2] = comp; st.push(n2); } } }
      comp++;
      const area = mem.length * cell * cell; if (area < 9 || area > 450) continue;
      const pts = mem.map(q => [xAt(q % gw), zAt((q / gw) | 0)]), ob = G.obb(pts); if (!ob) continue;
      const a = ob.a + cell / 2, b = ob.b + cell / 2, fill = area / (4 * a * b);
      if (fill < (c === 3 ? 0.55 : 0.42) || b < 1.1 || a / b > 5) continue;
      // contrast with a ring around the roof
      let iv = 0, is = 0, rv = 0, rs = 0, rn = 0, mr = 0, mg = 0, mb = 0;
      for (const q of mem) { iv += V[q]; is += Sat[q]; mr += R[q]; mg += Gc[q]; mb += B[q]; }
      iv /= mem.length; is /= mem.length;
      const i0 = Math.min(...mem.map(q => q % gw)), i1 = Math.max(...mem.map(q => q % gw)), j0 = Math.min(...mem.map(q => (q / gw) | 0)), j1 = Math.max(...mem.map(q => (q / gw) | 0)), pad = 3;
      for (let j = j0 - pad; j <= j1 + pad; j++) for (let i = i0 - pad; i <= i1 + pad; i++) { if (i < 0 || j < 0 || i >= gw || j >= gh) continue; if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue; const q = j * gw + i; rv += V[q]; rs += Sat[q]; rn++; }
      if (!rn) continue; rv /= rn; rs /= rn;
      if (c === 3 && iv - rv < 20) continue;           // bright roofs must be clearly brighter than the ground around
      if (c !== 3 && is - rs < 0.07) continue;         // coloured roofs must be clearly more colourful
      const cx = ob.cx, cz = ob.cz;
      if (mAt(exclude, cx, cz) || mAt(D.rmask, cx, cz) || mAt(D.wmask, cx, cz)) continue;
      let near = false; for (let u = -1; u <= 1 && !near; u++) for (let v = -1; v <= 1; v++) for (const p of taken.get((Math.floor(cx / 10) + u) + ',' + (Math.floor(cz / 10) + v)) || []) if (Math.hypot(p[0] - cx, p[1] - cz) < 3) { near = true; break; }
      if (near) continue;
      // face the nearest road (if two roads are close, the nearer one wins): turn the roof's axes to the road direction
      if (this.net) { const nr = this.net.near(cx, cz, 45)[0]; if (nr) { const P = this.net.roads[nr[0]].pts, p0 = P[Math.max(0, nr[1] - 2)], p1 = P[Math.min(P.length - 1, nr[1] + 2)];
        let tx = p1.x - p0.x, tz = p1.z - p0.z; const tl = Math.hypot(tx, tz); if (tl > 0.1) { tx /= tl; tz /= tl;
          // long side along the road unless the roof is clearly turned the other way (then the gable end faces the road)
          const along = Math.abs(ob.ux * tx + ob.uz * tz) >= Math.SQRT1_2; if (along) { ob.ux = tx; ob.uz = tz; ob.vx = -tz; ob.vz = tx; } else { ob.ux = -tz; ob.uz = tx; ob.vx = -tx; ob.vz = -tz; } } } }
      const A2 = a + 0.25, B2 = b + 0.25, ring = [[-A2, -B2], [A2, -B2], [A2, B2], [-A2, B2]].map(([u, v]) => [cx + ob.ux * u + ob.vx * v, cz + ob.uz * u + ob.vz * v]);
      const n = mem.length, cl = v => Math.min(255, Math.round(v)), roofC = (cl(mr / n) << 16) | (cl(mg / n) << 8) | cl(mb / n);
      out.push({ t: 1, hdm: 0, lv: area > 220 ? 2 : 0, ring, stilt: area < 120 && rnd() < 0.5 ? 1.8 + rnd() * 0.6 : 0, roof: area > 400 ? 'flat' : a / b > 1.6 ? 'gable' : 'hip', roofC, wall: [0xa07a55, 0xd9cdb5, 0xe6dccb, 0xbfa27c, 0xc8d3d6, 0xefe2c9][(rnd() * 6) | 0], src: 'image roof' });
      (taken.get(key(cx, cz)) || taken.set(key(cx, cz), []).get(key(cx, cz))).push([cx, cz]);
      for (let u = -a; u <= a; u += MR) for (let v = -b; v <= b; v += MR) { const x = cx + ob.ux * u + ob.vx * v, z = cz + ob.uz * u + ob.vz * v, i = Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0)), j = Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)); exclude[j * mw + i] = 1; this.bmask[j * mw + i] = 1; }
    }
    return out;
  }

  /* ---------- traffic ---------- */
  buildTraffic(rnd) {
    const PER_KM = { 1: 40, 2: 10, 3: 34, 4: 10, 5: 26, 6: 8, 7: 18, 8: 6, 9: 12, 10: 4, 11: 6, 12: 5, 14: 2 };
    const cap = this.mobile ? 500 : 1600, want = [];
    for (const ln of this.lanesForTraffic) { const L = ln.pts[ln.pts.length - 1].s, n = Math.floor(L / 1000 * (PER_KM[ln.cls] || 2) * (ln.urban ? 1.6 : 1) + rnd()); for (let k = 0; k < n; k++) want.push(ln); }
    const list = want.length > cap ? want.filter(() => rnd() < cap / want.length) : want;
    const types = Object.keys(this.kit), slots = Object.fromEntries(types.map(t => [t, []]));
    this.vehicles = [];
    const lanesIdx = new Map(this.lanesForTraffic.map((l, i) => [l, i]));
    for (const ln of list) {
      const r = rnd(); let t;
      if (ln.cls <= 4) t = r < 0.25 ? 'moto' : r < 0.35 ? 'moto2' : r < 0.6 ? 'car' : r < 0.75 ? 'pickup' : r < 0.85 ? 'bus' : 'truck';
      else if (ln.cls <= 8) t = r < 0.38 ? 'moto' : r < 0.5 ? 'moto2' : r < 0.68 ? 'car' : r < 0.8 ? 'pickup' : r < 0.9 ? 'tuktuk' : 'truck';
      else t = r < (ln.urban ? 0.45 : 0.55) ? 'moto' : r < 0.68 ? 'moto2' : r < 0.8 ? 'car' : r < 0.87 ? 'pickup' : r < 0.96 ? 'tuktuk' : 'truck';
      if (ln.st.w < 4 && (t === 'truck' || t === 'bus')) t = 'moto';
      const dir = ln.oneway ? 1 : (rnd() < 0.5 ? 1 : -1), src = dir > 0 ? ln.pts : ln.pts.slice().reverse(), hw = ln.st.w / 2;
      let off;
      if (ln.oneway) off = (ln.st.lanes > 1 ? (((rnd() * ln.st.lanes) | 0) + 0.5) / ln.st.lanes * 2 - 1 : 0) * (hw - 0.6);
      else { const per = Math.max(1, Math.round(ln.st.lanes / 2)); off = ((((rnd() * per) | 0) + 0.5) / per) * (hw - 0.4); }
      if (t === 'moto' || t === 'moto2') off += (ln.oneway ? 0.6 : hw * 0.25) * rnd() * 0.8;
      const P = new Float32Array(src.length * 3), S = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        P[i * 3] = src[i].x - tz / l * off; P[i * 3 + 1] = src[i].y; P[i * 3 + 2] = src[i].z + tx / l * off;
        if (i) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
      }
      const speed = (ln.cls <= 4 ? 22 : ln.cls <= 8 ? 15 : ln.cls <= 10 ? 11 : 7) * (t.startsWith('moto') ? 0.9 + rnd() * 0.3 : t === 'tuktuk' ? 0.65 : t === 'truck' || t === 'bus' ? 0.8 : 1);
      const v = { P, S, L: S[S.length - 1], u: rnd() * S[S.length - 1], speed, base: speed, cur: speed, t, len: (this.kit[t] && this.kit[t].len) || 4, lat: 0, twoWay: !ln.oneway, shift: Math.max(2.2, hw * (ln.oneway ? 0.6 : 0.9)), group: lanesIdx.get(ln) + (dir > 0 ? 'f' : 'b'), pos: new V3(), fwd: new V3(0, 0, 1) };
      slots[t].push(v); this.vehicles.push(v);
    }
    this.vehMeshes = [];
    for (const t of types) {
      const n = slots[t].length; if (!n) continue; const k = this.kit[t];
      const paint = new THREE.InstancedMesh(k.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }), n);
      const fixed = new THREE.InstancedMesh(k.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), n);
      const c = new THREE.Color(); slots[t].forEach((v, i) => paint.setColorAt(i, c.set(k.palette[(rnd() * k.palette.length) | 0])));
      for (const m of [paint, fixed]) { m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.root.add(m); }
      this.vehMeshes.push({ paint, fixed, list: slots[t] });
    }
    this.trafficGroups = [...this.vehicles.reduce((m, v) => (m.get(v.group) || m.set(v.group, []).get(v.group)).push(v) && m, new Map()).values()];
    this.updateTraffic(0);
    this.D.stats.vehicles = this.vehicles.length;
  }
  updateTraffic(dt) {
    if (!this.vehMeshes) return;
    // car-following and overtaking within each lane: keep a safe gap; if the car ahead is slower and the road
    // is two-way, pull out to the left, pass and pull back in (Cambodia drives on the right)
    const P = this.driver && this.playerMesh ? this.driver : null, pv = P && this.mode === 'drive' && !P.parked ? (P.cur ?? P.speed) : 0, pLen = P ? (this.kit[P.kind] || {}).len || 4.5 : 0;
    if (dt > 0) for (const G of this.trafficGroups || []) {
      G.sort((a, b) => a.u - b.u);
      for (let i = 0; i < G.length; i++) {
        const v = G[i]; let want = v.base;
        // the player's vehicle (moving or parked) is an obstacle: follow it, or pass it on two-way roads
        if (P && !v.passing) {
          const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z, along = dx * v.fwd.x + dz * v.fwd.z, lat = Math.abs(dx * v.fwd.z - dz * v.fwd.x);
          if (along > 0 && along < 60 && lat < 2.1 + (v.t && v.t.startsWith('moto') ? -0.6 : 0)) {
            const same = P.fwd.x * v.fwd.x + P.fwd.z * v.fwd.z > 0.3, gap = along - (v.len + pLen) / 2, safe = 4 + v.cur * 1.1, pSp = same ? pv : 0;
            if (gap < safe) {
              if (v.twoWay && pSp < v.base - 1.5 && gap < safe * 0.7) v.passing = { u: (v.u + along) % v.L, len: pLen, cur: pSp };
              else want = Math.min(want, Math.max(0, pSp * Math.max(0, gap - 1.5) / safe));
            }
          }
        }
        if (v.passing) {
          const p = v.passing, ahead = ((v.u - p.u) % v.L + v.L) % v.L;
          if (p.cur !== undefined && !p.S) p.u = (p.u + p.cur * dt) % v.L; // pseudo-leader (the player's vehicle)
          want = v.base * 1.2 + 3; if (ahead > (v.len + p.len) / 2 + 7 && ahead < v.L / 2) v.passing = null;
        } else if (G.length > 1) {
          const ld = G[(i + 1) % G.length], gap = ((ld.u - v.u) % v.L + v.L) % v.L - (v.len + ld.len) / 2, safe = 4 + v.cur * 1.1;
          if (gap < safe) {
            if (v.twoWay && ld.cur < v.base - 1 && !ld.passing && !G.some(o => o.passing && o !== v && Math.abs(o.u - v.u) < 60)) v.passing = ld;
            else want = Math.min(v.base, Math.max(0, ld.cur * Math.max(0, gap - 1.5) / safe));
          }
        }
        v.cur += THREE.MathUtils.clamp(want - v.cur, -7 * dt, 2.8 * dt);
        const latWant = v.passing ? v.shift : 0; v.lat += THREE.MathUtils.clamp(latWant - v.lat, -1.3 * dt, 1.3 * dt);
      }
    }
    const d = this._d || (this._d = new THREE.Object3D()), look = new V3(), at = (v, u, out) => {
      u = ((u % v.L) + v.L) % v.L; const S = v.S, P = v.P; let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= u) lo = m; else hi = m; }
      const t = (u - S[lo]) / ((S[hi] - S[lo]) || 1); return out.set(P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t, P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t, P[lo * 3 + 2] + (P[hi * 3 + 2] - P[lo * 3 + 2]) * t);
    };
    const ahead = new V3();
    for (const g of this.vehMeshes) {
      g.list.forEach((v, i) => {
        v.u = (v.u + (v.cur ?? v.speed) * dt) % v.L;
        at(v, v.u, v.pos); at(v, v.u + 3.5, ahead);
        v.fwd.copy(ahead).sub(v.pos).normalize();
        if (v.lat) { const lx = v.fwd.z, lz = -v.fwd.x, n = Math.hypot(lx, lz) || 1; v.pos.x += lx / n * v.lat; v.pos.z += lz / n * v.lat; v.pos.y = Math.max(v.pos.y, this.hAt(v.pos.x, v.pos.z) + 0.1); }
        const steer = v.passing ? 0.12 : v.lat > 0.05 ? -0.12 : 0;
        d.position.copy(v.pos); look.copy(v.pos).add(v.fwd); d.lookAt(look); if (steer) d.rotateY(steer); d.updateMatrix(); g.paint.setMatrixAt(i, d.matrix); g.fixed.setMatrixAt(i, d.matrix);
      });
      g.paint.instanceMatrix.needsUpdate = g.fixed.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- people and cattle ---------- */
  buildPeople(rnd) {
    const D = this.D, hAt = this.hAt, cap = this.mobile ? 250 : 700, mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.root.add(m); return m; };
    const PER_KM = { 9: 3, 10: 2, 11: 3, 12: 6, 13: 8, 14: 2, 16: 2 };
    const walkers = [];
    for (const r of this.netRoadsForPeople) {
      const L = r.pts[r.pts.length - 1].s, n = Math.floor(L / 1000 * (PER_KM[r.cls] || 0) * (r.urban ? 2.2 : 1) + rnd());
      for (let k = 0; k < n && walkers.length < cap; k++) {
        const dir = rnd() < 0.5 ? 1 : -1, src = dir > 0 ? r.pts : r.pts.slice().reverse(), off = (rnd() < 0.5 ? -1 : 1) * (r.hw + 0.6 + rnd() * 0.6);
        const P = new Float32Array(src.length * 3), S = new Float32Array(src.length);
        for (let i = 0; i < src.length; i++) {
          const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, x = src[i].x - tz / l * off, z = src[i].z + tx / l * off;
          P[i * 3] = x; P[i * 3 + 1] = hAt(x, z); P[i * 3 + 2] = z; if (i) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
        }
        walkers.push({ P, S, L: S[S.length - 1], u: rnd() * S[S.length - 1], speed: 1.1 + rnd() * 0.4, pos: new V3(), fwd: new V3() });
      }
    }
    // farmers in the rice fields and herds of cattle grazing near villages
    const farmers = [], cows = [], { gw, gh, C, X0, Z0, cls, splatRice, nearB, exclude, mw, mh, MR } = D;
    const free = (x, z) => !exclude[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))];
    for (let t = 0; t < 6000 && farmers.length < (this.mobile ? 25 : 60); t++) {
      const q = (rnd() * gw * gh) | 0; if (!splatRice[q]) continue;
      const x = X0 + (q % gw + .5) * C, z = Z0 + (((q / gw) | 0) + .5) * C, n = 1 + ((rnd() * 3) | 0);
      for (let k = 0; k < n; k++) { const fx = x + (rnd() - .5) * 6, fz = z + (rnd() - .5) * 6; if (free(fx, fz)) farmers.push({ pos: new V3(fx, hAt(fx, fz), fz), rot: rnd() * 6.28 }); }
    }
    for (let t = 0; t < 8000 && cows.length < (this.mobile ? 30 : 70); t++) {
      const q = (rnd() * gw * gh) | 0; if (cls[q] !== 3 || !nearB[q] && rnd() > 0.15) continue;
      const x = X0 + (q % gw + .5) * C, z = Z0 + (((q / gw) | 0) + .5) * C, n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) { const cx = x + (rnd() - .5) * 10, cz = z + (rnd() - .5) * 10; if (free(cx, cz)) cows.push({ home: new V3(cx, 0, cz), pos: new V3(cx, hAt(cx, cz), cz), head: rnd() * 6.28, moving: 0, timer: rnd() * 8 }); }
    }
    const hw = human('walker'), hf = human('farmer'), c = new THREE.Color();
    this.people = { walkers, farmers, cows };
    this.pm = {
      wc: mk(hw.cloth, animMaterial(this.uTime, WALK_AMP, 0, false, true), Math.max(1, walkers.length)), wb: mk(hw.body, animMaterial(this.uTime, WALK_AMP, 0, false, true), Math.max(1, walkers.length)),
      fc: mk(hf.cloth, animMaterial(this.uTime, 0.12, 1.6), Math.max(1, farmers.length)), fb: mk(hf.body, animMaterial(this.uTime, 0.12, 1.6), Math.max(1, farmers.length)),
      cw: mk(cow(), animMaterial(this.uTime, 0.3, 2.2), Math.max(1, cows.length)),
    };
    // leg swing driven by distance walked: one stride cycle = two steps of 2·leg·sin(amp)
    const ph = this.people.phase = new Float32Array(Math.max(1, walkers.length)); walkers.forEach((v, i) => { v.ph0 = rnd() * 6.283; ph[i] = v.ph0; });
    for (const k of ['wc', 'wb']) this.pm[k].geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1).setUsage(THREE.DynamicDrawUsage));
    this.pm.wc.count = this.pm.wb.count = walkers.length; this.pm.fc.count = this.pm.fb.count = farmers.length; this.pm.cw.count = cows.length;
    walkers.forEach((w, i) => this.pm.wc.setColorAt(i, c.set(SHIRTS[(rnd() * SHIRTS.length) | 0])));
    const d = new THREE.Object3D();
    farmers.forEach((f, i) => { d.position.copy(f.pos); d.rotation.set(0.25, f.rot, 0, 'YXZ'); d.scale.setScalar(0.95 + rnd() * 0.1); d.updateMatrix(); this.pm.fc.setMatrixAt(i, d.matrix); this.pm.fb.setMatrixAt(i, d.matrix); this.pm.fc.setColorAt(i, c.set(SHIRTS[(rnd() * SHIRTS.length) | 0])); });
    cows.forEach((cw, i) => this.pm.cw.setColorAt(i, c.set([0xf4f1ea, 0xece4d4, 0xd9c2a0, 0xb8875a, 0xf4f1ea][(rnd() * 5) | 0])));
    this.D.stats.people = walkers.length + farmers.length; this.D.stats.cows = cows.length;
    this.updatePeople(0);
  }
  updatePeople(dt) {
    if (!this.people) return; const d = this._pd || (this._pd = new THREE.Object3D()), look = new V3(), { walkers, cows } = this.people;
    walkers.forEach((v, i) => {
      v.u = (v.u + v.speed * dt) % v.L; const S = v.S; let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= v.u) lo = m; else hi = m; }
      const t = (v.u - S[lo]) / ((S[hi] - S[lo]) || 1), P = v.P;
      v.pos.set(P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t, P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t, P[lo * 3 + 2] + (P[hi * 3 + 2] - P[lo * 3 + 2]) * t);
      v.fwd.set(P[hi * 3] - P[lo * 3], 0, P[hi * 3 + 2] - P[lo * 3 + 2]).normalize();
      d.position.copy(v.pos); look.copy(v.pos).add(v.fwd); d.lookAt(look); d.updateMatrix(); this.pm.wc.setMatrixAt(i, d.matrix); this.pm.wb.setMatrixAt(i, d.matrix);
      this.people.phase[i] = v.ph0 + v.u / WALK_CYCLE * 6.2832;
    });
    cows.forEach((cw, i) => {
      cw.timer -= dt; if (cw.timer <= 0) { cw.moving = Math.random() < 0.35 ? 0.35 : 0; cw.timer = 3 + Math.random() * 8; cw.head += (Math.random() - .5) * 1.5; }
      if (cw.moving) {
        const nx = cw.pos.x + Math.sin(cw.head) * cw.moving * dt, nz = cw.pos.z + Math.cos(cw.head) * cw.moving * dt;
        const D = this.D, ok = D.exclude && !D.exclude[Math.min(D.mh - 1, Math.max(0, ((nz - D.Z0) / D.MR) | 0)) * D.mw + Math.min(D.mw - 1, Math.max(0, ((nx - D.X0) / D.MR) | 0))];
        if (ok && Math.hypot(nx - cw.home.x, nz - cw.home.z) < 18) { cw.pos.x = nx; cw.pos.z = nz; cw.pos.y = this.hAt(nx, nz); } else cw.head += Math.PI * (0.5 + Math.random() * 0.5);
      }
      d.position.copy(cw.pos); d.rotation.set(0, cw.head, 0); d.scale.setScalar(1); d.updateMatrix(); this.pm.cw.setMatrixAt(i, d.matrix);
    });
    for (const k of ['wc', 'wb', 'cw']) this.pm[k].instanceMatrix.needsUpdate = true;
    for (const k of ['wc', 'wb']) { const at = this.pm[k].geometry.getAttribute('aPhase'); if (at) at.needsUpdate = true; }
  }

  /* ---------- planar water reflection at the nearest water level ---------- */
  renderReflection(focus) {
    const U = this.reflU; U.uReflOn.value = 0;
    if (!this.reflectOn || !this.waterMesh || !this.waterBodies || !this.waterBodies.length) return;
    let best = null, bd = Infinity;
    for (const b of this.waterBodies) { const dx = Math.max(b.x0 - focus.x, 0, focus.x - b.x1), dz = Math.max(b.z0 - focus.z, 0, focus.z - b.z1), dd = Math.hypot(dx, dz); if (dd < bd) { bd = dd; best = b; } }
    if (!best || bd > 1500) return;
    const h = best.level, cam = this.camera; if (cam.position.y < h + 0.15) return;
    const mc = this.mirrorCam, n = new V3(0, 1, 0), rp = new V3(0, h, 0);
    cam.updateMatrixWorld();
    const cp = new V3().setFromMatrixPosition(cam.matrixWorld), rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const view = new V3().subVectors(rp, cp); view.reflect(n).negate().add(rp);
    const la = new V3(0, 0, -1).applyMatrix4(rot).add(cp), target = new V3().subVectors(rp, la); target.reflect(n).negate().add(rp);
    mc.position.copy(view); mc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n); mc.lookAt(target);
    mc.near = cam.near; mc.far = cam.far; mc.updateMatrixWorld(); mc.projectionMatrix.copy(cam.projectionMatrix);
    U.uTexMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    const r = this.renderer, prevClip = r.clippingPlanes, prevAuto = r.shadowMap.autoUpdate;
    this.waterMesh.visible = false; r.clippingPlanes = [new THREE.Plane(n, -h + 0.02)]; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.reflRT); r.clear(); r.render(this.scene, mc); r.setRenderTarget(null);
    r.clippingPlanes = prevClip; r.shadowMap.autoUpdate = prevAuto; this.waterMesh.visible = true;
    U.uReflOn.value = 1;
  }

  /* ---------- ground looks ---------- */
  setGround(style) {
    const D = this.D; if (!D) return; this.groundStyle = style;
    let tex = this.texSat;
    if (style === 'enhanced' && D.px) { if (!this.texEnh) this.texEnh = this.mkTex(enhanceCanvas(D.img, D.px, D.gains)); tex = this.texEnh; }
    if (style === 'lulc' && D.px) {
      if (!this.texStyl) {
        const c = document.createElement('canvas'), w = c.width = D.img.width, h = c.height = D.img.height, g = c.getContext('2d');
        g.drawImage(D.img, 0, 0);
        const sx0 = D.pxX(this.F.lon(D.X0)), sx1 = D.pxX(this.F.lon(D.X0 + D.W)), sy0 = D.pxY(this.F.lat(D.Z0)), sy1 = D.pxY(this.F.lat(D.Z0 + D.H));
        g.imageSmoothingEnabled = true; g.drawImage(lcCanvas(D, D.lc), sx0, sy0, sx1 - sx0, sy1 - sy0);
        g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.75; g.drawImage(D.img, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        const base = document.createElement('canvas'); base.width = w; base.height = h; base.getContext('2d').drawImage(c, 0, 0); this._lulcBase = base;
        if (this.imgOver > 0) { g.globalAlpha = this.imgOver; g.drawImage(D.img, 0, 0); g.globalAlpha = 1; }
        this.texStyl = this.mkTex(c);
      }
      tex = this.texStyl;
    }
    this.terrainMat.map = tex; this.terrainMat.needsUpdate = true; this.uniforms.uImg.value = tex;
  }

  setVisible(kind, on) {
    if (this.layers && ['trees', 'buildings', 'traffic'].includes(kind)) { this.layers.setOn(kind, on); this.onLayerToggle && this.onLayerToggle(kind, on); }
    if (kind === 'detail') this._grassUserOff = !on;
    if (kind === 'trees') (this.treeMeshes || []).forEach(m => m.visible = on);
    if (kind === 'buildings' && this.buildingsMesh) this.buildingsMesh.visible = on;
    if (kind === 'houses' && this.housesMesh) this.housesMesh.visible = on;
    if (kind === 'traffic') { this.trafficOn = on; (this.vehMeshes || []).forEach(g => g.paint.visible = g.fixed.visible = on); }
    if (kind === 'shadows') this.sun.castShadow = on;
    if (kind === 'reflect') this.reflectOn = on;
    if (kind === 'traffic' && this.pm) for (const m of Object.values(this.pm)) m.visible = on;
    if (kind === 'detail') { this.terrainU.uDetailOn.value = on ? 1 : 0; this.grassOff = !on; }
  }

  /* ---------- camera views & player modes ---------- */
  // N key: look straight down with north at the top; again: tilt back to an oblique view, still facing north
  northView(top) {
    if (this.mode !== 'orbit') this.setMode('orbit');
    const q = this.controls.target.clone(), off = this.camera.position.clone().sub(q), d = off.length(), polar = Math.acos(Math.min(1, off.y / d)), az = Math.atan2(off.x, off.z);
    if (top == null) top = !(polar < 0.06 && Math.abs(az) < 0.06);
    const a = top ? 0.002 : 0.95, p1 = new V3(q.x, q.y + d * Math.cos(a), q.z + d * Math.sin(a));
    this.flight = { t: 0, p0: this.camera.position.clone(), q0: q.clone(), p1, q1: q }; return top;
  }
  goView(name, instant) {
    this.setMode('orbit');
    const v = this.views && this.views[name]; if (!v) return;
    const p1 = new V3(...v.pos), q1 = new V3(...v.target);
    if (instant) { this.camera.position.copy(p1); this.controls.target.copy(q1); this.controls.update(); return; }
    this.flight = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1, q1 };
  }
  setMode(mode) {
    const prev = this.mode; this.mode = mode;
    if (mode !== 'orbit' && this.layers && this.layers.t > 0) { this.layers.stop(); this.layers.setExplode(0, true); this.onLayersCollapse && this.onLayersCollapse(); }
    this.controls.enabled = mode === 'orbit';
    this.walker.active = mode === 'walk';
    this.camera.fov = mode === 'walk' ? 62 : 45; this.camera.updateProjectionMatrix();
    if (mode === 'walk' && prev === 'drive' && this.driver) {
      // get out on the right-hand (kerb) side and leave the vehicle parked
      const d = this.driver, f = d.fwd, n = Math.hypot(f.x, f.z) || 1, rx = -f.z / n, rz = f.x / n, off = (d.kind.startsWith('moto') ? 0.9 : 1.6) + 0.6;
      let x = d.pos.x + rx * off, z = d.pos.z + rz * off; if (this.walker.blocked(x, z)) { x = d.pos.x - rx * off; z = d.pos.z - rz * off; }
      this.walker.place(x, z, Math.atan2(-f.x, -f.z)); this.walker.pos.y = this.groundAt(x, z) + 1.65; d.parked = true; if (this.playerMesh) this.playerMesh.visible = true;
    } else if (mode === 'walk' && prev !== 'walk') {
      const t = this.controls.target; let x = t.x, z = t.z;
      for (let r = 0; r < 60 && this.walker.blocked(x, z); r += 3) { x = t.x + r; }
      const dirv = new V3().subVectors(t, this.camera.position); this.walker.place(x, z, Math.atan2(-dirv.x, -dirv.z));
      this.walker.pos.y = this.groundAt(x, z) + 1.65;
    }
    if (mode === 'orbit' && (prev === 'walk' || prev === 'drive')) {
      const p = prev === 'walk' ? this.walker.pos : (this.driver ? this.driver.pos : this.controls.target);
      this.controls.target.copy(p); this.camera.position.set(p.x + 40, p.y + 35, p.z + 50); this.controls.update();
    }
    if (this.onModeChange) this.onModeChange(mode);
  }
  rawElevation(x, z) {
    const D = this.D; if (!D || !D.raw) return 0;
    let gx = (x - D.X0) / D.dx, gz = (z - D.Z0) / D.dz; gx = Math.min(Math.max(gx, 0), D.nx - 1e-6); gz = Math.min(Math.max(gz, 0), D.nz - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, R = D.nx + 1, r = D.raw;
    return (r[j * R + i] * (1 - fx) + r[j * R + i + 1] * fx) * (1 - fz) + (r[(j + 1) * R + i] * (1 - fx) + r[(j + 1) * R + i + 1] * fx) * fz;
  }
  updateHud(focus, dt) {
    if (!this.F || !this.D || !this.D.raw || !this.hAt) return;
    let heading;
    if (this.mode === 'drive' && this.driver) heading = Math.atan2(this.driver.fwd.x, -this.driver.fwd.z);
    else if (this.mode === 'walk') heading = Math.atan2(-Math.sin(this.walker.yaw), Math.cos(this.walker.yaw));
    else { const v = new V3(); this.camera.getWorldDirection(v); heading = Math.atan2(v.x, -v.z); }
    if (this._prevFocus && dt > 0) { const jump = Math.hypot(focus.x - this._prevFocus.x, focus.z - this._prevFocus.z), sp = jump / dt; if (jump > 15) this.hud.speed = 0; else this.hud.speed += (sp - this.hud.speed) * Math.min(1, dt * 3); }
    this._prevFocus = { x: focus.x, z: focus.z };
    Object.assign(this.hud, { mode: this.mode, x: focus.x, z: focus.z, lon: this.F.lon(focus.x), lat: this.F.lat(focus.z), elev: this.rawElevation(focus.x, focus.z), heading: (THREE.MathUtils.radToDeg(heading) + 360) % 360,
      speedShown: this.mode === 'drive' && this.driver ? this.driver.speed : (this.mode === 'walk' ? this.hud.speed : 0), fov: this.camera.fov * this.camera.aspect });
  }
  /* ---------- underground: soil + geology, cross-sections ---------- */
  async ensureUnderground(say) {
    if (!this.U) { this.U = await loadUnderground(this, say); this.applySideGeology(); }
    if (this.layers) this.layers.buildUnder();
    return this.U;
  }
  applySideGeology() {
    if (!this.U || !this.D) return; const D = this.D, e = this.exag ?? 1;
    if (this.sideWalls) this.sideWalls.forEach(m => this.root.remove(m));
    const corners = [[D.X0, D.Z0 + D.H], [D.X0 + D.W, D.Z0 + D.H], [D.X0 + D.W, D.Z0], [D.X0, D.Z0], [D.X0, D.Z0 + D.H]];
    this.sideWalls = [];
    for (let k = 0; k < 4; k++) {
      const A = { x: corners[k][0], z: corners[k][1] }, B = { x: corners[k + 1][0], z: corners[k + 1][1] }, n = Math.min(320, Math.max(40, Math.round(Math.hypot(B.x - A.x, B.z - A.z) / 6)));
      const m = wallMesh(this, sampleLine(this, this.U, A, B, n), this.bottom, e); this.root.add(m); this.sideWalls.push(m);
    }
    if (this.sidesMesh) this.sidesMesh.visible = false;
  }
  async openLayers(say) {
    if (!this.layers) { this.layers = new LayerStack(this); await this.layers.rebuild(); }
    this.ensureUnderground(say).then(() => { this.layers.buildUnder(); this.onLayersReady && this.onLayersReady(); }).catch(e => console.warn(e));
    return this.layers;
  }
  openGlobe() { if (!this.globe) { this.globe = new Globe(this); this.globe.onToggle = v => this.onGlobe && this.onGlobe(v); } this.globe.enter(); return this.globe; }
  openRadar() { if (!this.radar) this.radar = new Radar(this); return this.radar; }
  async openTactical() { await loadCatalog(); if (!this.tactical) this.tactical = new Tactical(this); this.tactical.active = true; await this.tactical.rebuild(); return this.tactical; }
  openEditor() { if (!this.editor) { this.editor = new Editor(this); this.editor.rebuild(); } this.editor.active = true; return this.editor; }
  // rice-field stage: image (as photographed), planting (flooded), growing (green), ripening (golden), harvested (stubble)
  setSeason(k) {
    const S = { image: [0, 0, 0, 0, 1, null], planting: [0.28, 0.36, 0.36, 0.78, 0.35, 0x6f9a4a], growing: [0.24, 0.5, 0.14, 0.72, 1, 0x4f8f2a], ripening: [0.82, 0.66, 0.26, 0.78, 1.1, 0xd9b54a], harvested: [0.62, 0.52, 0.36, 0.72, 0.22, 0xa89064] }[k] || [0, 0, 0, 0, 1, null];
    this.terrainU.uSeason.value.set(S[0], S[1], S[2], S[3]); SEASON.h = S[4]; SEASON.col = S[5] != null ? new THREE.Color(S[5]) : null;
    if (this.grass) this.grass.center.set(1e9, 0, 1e9);
  }
  get LC() { return LC; }
  // clear trees, image houses and OSM buildings under new roads (corridor = half width + margin)
  applyCorridors(roads) {
    const D = this.D; if (!D || !this.treeMeshes || !this._treeMat0) return;
    const segs = []; for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i], r.pts[i + 1], r.hw]);
    const cell = 25, grid = new Map(); segs.forEach((sg, k) => { const [a, b, hw] = sg; for (let x = Math.floor((Math.min(a.x, b.x) - hw - 6) / cell); x <= Math.floor((Math.max(a.x, b.x) + hw + 6) / cell); x++) for (let z = Math.floor((Math.min(a.z, b.z) - hw - 6) / cell); z <= Math.floor((Math.max(a.z, b.z) + hw + 6) / cell); z++) { const key = x + ',' + z; (grid.get(key) || grid.set(key, []).get(key)).push(k); } });
    const dist = (x, z) => { let best = Infinity; for (const k of grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []) { const [a, b, hw] = segs[k], vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L)); best = Math.min(best, Math.hypot(a.x + vx * t - x, a.z + vz * t - z) - hw); } return best; };
    // trees: restore, then hide the ones within 2.5 m of a new road edge
    let trees = 0;
    this.treeMeshes.forEach((m, i) => { const arr = m.instanceMatrix.array; arr.set(this._treeMat0[i]); if (segs.length) for (let q = 0; q < m.count; q++) { const o = q * 16; if (dist(arr[o + 12], arr[o + 14]) < 2.5) { for (let e = 0; e < 16; e++) arr[o + e] = 0; trees++; } } m.instanceMatrix.needsUpdate = true; });
    const hit = ring => { if (!segs.length) return false; let cx = 0, cz = 0; for (const [x, z] of ring) { if (dist(x, z) < 0.8) return true; cx += x / ring.length; cz += z / ring.length; } return dist(cx, cz) < 0.8; };
    const houses = this.housesList0.filter(b => !hit(b.ring)), bld = D.buildings0.filter(b => !hit(b.ring));
    const changed = houses.length !== (this.housesList || []).length || bld.length !== D.buildings.length;
    this.housesList = houses; D.buildings = bld; D.stats.houses = houses.length;
    if (changed) {
      const rnd = G.mulberry32(Math.round(D.aoi.w * 1e4 + D.aoi.s * 1e3) + 7);
      for (const [key, list] of [['housesMesh', houses], ['buildingsMesh', bld]]) {
        const old = this[key]; if (old) { this.root.remove(old); old.geometry.dispose(); }
        const g = list.length ? this.buildBuildings(list, rnd, { noStats: true }) : null;
        if (g) { const m = new THREE.Mesh(g, old ? old.material : makeBuildingMaterial()); m.castShadow = m.receiveShadow = true; m.visible = old ? old.visible : true; this.root.add(m); this[key] = m; } else this[key] = null;
      }
      if (this.layers) this.layers.collect && this.layers.collect();
    }
    this._cleared = { trees, houses: this.housesList0.length - houses.length, buildings: D.buildings0.length - bld.length };
    return this._cleared;
  }
  // satellite image laid over the classified land cover (0 = off, 1 = image only)
  setImageOverlay(a) {
    this.imgOver = a; const t = this.texStyl; if (!t || !this._lulcBase) return; const g = t.image.getContext('2d');
    g.globalAlpha = 1; g.drawImage(this._lulcBase, 0, 0); if (a > 0) { g.globalAlpha = a; g.drawImage(this.D.img, 0, 0); g.globalAlpha = 1; } t.needsUpdate = true;
  }
  // painting mode: left-drag paints; right-drag rotates, Shift + right-drag or middle-drag pans, wheel zooms; hold Space (or Alt) to use the left button for moving
  setPaintMode(on) {
    this.lcPaint = on; const mb = this.controls.mouseButtons;
    if (on) { mb.LEFT = THREE.MOUSE.ROTATE; mb.MIDDLE = THREE.MOUSE.PAN; mb.RIGHT = THREE.MOUSE.ROTATE; } else { mb.LEFT = THREE.MOUSE.ROTATE; mb.MIDDLE = THREE.MOUSE.DOLLY; mb.RIGHT = THREE.MOUSE.PAN; }
    if (this.brush) this.brush.visible = on;
  }
  // change detection view on the ground: 'swipe' (old image west of the line, new east), 'before', 'after', 'changes'
  setCompare(o) {
    const D = this.D; if (!o) { this._cmp = null; if (this.texCmp) { this.texCmp.dispose(); this.texCmp = null; } this.setGround(this.groundStyle || 'sat'); return; }
    this._cmp = { ...(this._cmp || {}), ...o }; const c = this._cmp, W = D.img.width, H = D.img.height;
    if (!this.texCmp) { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; this.texCmp = this.mkTex(cv); }
    const g = this.texCmp.image.getContext('2d'); g.globalAlpha = 1; const aft = c.after || D.img; g.drawImage(c.mode === 'before' ? c.before : aft, 0, 0);
    if (c.mode === 'swipe' && c.before) { const sx = Math.round(W * c.swipe); g.drawImage(c.before, 0, 0, sx, H, 0, 0, sx, H); g.fillStyle = '#ffd23f'; g.fillRect(sx - 2, 0, 4, H); }
    if (c.mode === 'changes' && c.diff) { g.globalAlpha = 0.85; g.imageSmoothingEnabled = true; g.drawImage(c.diff, 0, 0, W, H); g.globalAlpha = 1; }
    this.texCmp.needsUpdate = true; this.terrainMat.map = this.texCmp; this.terrainMat.needsUpdate = true; this.uniforms.uImg.value = this.texCmp;
  }
  getTrainer() { if (!this.trainer) this.trainer = new LcTrainer(this); this.trainer.prepare(); return this.trainer; }
  refreshLC() { if (this.texStyl) { this.texStyl.dispose(); this.texStyl = null; } if (this.groundStyle === 'lulc') this.setGround('lulc'); if (this.layers && this.layers.refreshLulc) this.layers.refreshLulc(); }
  // quick feedback while painting: draw the class colour straight into the land-cover texture
  paintPreview(x, z, r, hex) {
    const D = this.D, t = this.texStyl; if (!t || this.groundStyle !== 'lulc') return; const c = t.image.getContext('2d'), px = D.pxX(this.F.lon(x)), py = D.pxY(this.F.lat(z)), pr = (D.pxX(this.F.lon(x + r)) - px);
    for (const cc of [c, this._lulcBase && this._lulcBase.getContext('2d')]) { if (!cc) continue; cc.fillStyle = hex; cc.globalAlpha = 0.9; cc.beginPath(); cc.arc(px, py, Math.max(1, pr), 0, 7); cc.fill(); cc.globalAlpha = 1; }
    if (this.imgOver > 0) { c.globalAlpha = this.imgOver * 0.5; c.save(); c.beginPath(); c.arc(px, py, Math.max(1, pr), 0, 7); c.clip(); c.drawImage(this.D.img, 0, 0); c.restore(); c.globalAlpha = 1; } t.needsUpdate = true;
  }
  getAtmos() { if (!this.atmos) this.atmos = new Atmos(this); return this.atmos; }
  openSurvey() { if (!this.survey) this.survey = new Survey(this); this.survey.active = true; this.survey.redraw(); return this.survey; }
  startSection() { this.sectionPick = 'A'; this.clearSection(); this.onSectionHint && this.onSectionHint('Tap point A on the ground or on the inset map'); }
  pickSectionPoint(x, z) {
    if (this.sectionPick === 'A') { this.sectionA = { x, z }; this.sectionPick = 'B'; this.drawSectionMarkers(this.sectionA); this.onSectionHint && this.onSectionHint('Now tap point B'); return; }
    if (this.sectionPick === 'B') { this.sectionPick = null; this.makeSection(this.sectionA, { x, z }); }
  }
  clearSection() { if (this.sectionGroup) { this.root.remove(this.sectionGroup); this.sectionGroup = null; } }
  drawSectionMarkers(A, B) {
    this.clearSection(); const g = this.sectionGroup = new THREE.Group(); this.root.add(g);
    const pole = (p, col) => { const h = this.hAt(p.x, p.z), m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 8), new THREE.MeshBasicMaterial({ color: col })); m.position.set(p.x, h + 7, p.z); g.add(m);
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: col })); b.position.set(p.x, h + 15, p.z); g.add(b); };
    pole(A, 0xe74c3c); if (B) {
      pole(B, 0x2f7fd0); const pts = []; for (let i = 0; i <= 200; i++) { const t = i / 200, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; pts.push(new V3(x, this.hAt(x, z) + 0.6, z)); }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe14a })));
    }
  }
  makeSection(A, B) {
    if (!this.U) return; const L = Math.hypot(B.x - A.x, B.z - A.z); if (L < 10) return;
    const S = sampleLine(this, this.U, A, B, Math.min(400, Math.max(60, Math.round(L / 4))));
    this.drawSectionMarkers(A, B);
    this.sectionWall = wallMesh(this, S, this.bottom, this.exag ?? 1); this.sectionWall.visible = this.sectionWallOn !== false; this.sectionGroup.add(this.sectionWall);
    this.section = { A, B, S }; this.onSection && this.onSection(S);
  }

  // jump to a place: walk → stand there (snapping onto a road if one is close), drive → nearest road, orbit → look there
  teleport(x, z, mode, exact) {
    if (!this.D) return; const D = this.D;
    if (this.sectionPick && !mode) { this.pickSectionPoint(x, z); return; }
    x = THREE.MathUtils.clamp(x, D.X0 + 2, D.X0 + D.W - 2); z = THREE.MathUtils.clamp(z, D.Z0 + 2, D.Z0 + D.H - 2);
    const m = mode || this.mode;
    if (m === 'walk') {
      const r = !exact && this.net && this.net.near(x, z, 10)[0];
      if (r) { const p = this.net.roads[r[0]].pts[r[1]]; x = p.x; z = p.z; }
      for (let k = 0; k < 40 && this.walker.blocked(x, z); k++) { const a = k * 2.4, d = 2 + k; x += Math.cos(a) * d * 0.5; z += Math.sin(a) * d * 0.5; }
      this.walker.place(x, z); this.walker.pos.y = this.groundAt(x, z) + 1.65; if (this.mode !== 'walk') this.setMode('walk');
    } else if (m === 'drive') {
      if (this.mode !== 'drive') this.setMode('drive');
      const n = this.net && this.net.near(x, z, 300)[0]; if (n) this.startDrive(n[0], n[1]); else this.onHint && this.onHint('No road near that point.');
    } else {
      this.setMode('orbit'); const off = new V3().subVectors(this.camera.position, this.controls.target), y = this.groundAt(x, z);
      if (off.length() > 600) off.setLength(600);
      this.flight = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1: new V3(x, y, z).add(off), q1: new V3(x, y, z) };
    }
  }
  groundAt(x, z) { return this.hAt ? this.hAt(x, z) : 0; }
  pxToMetres(p, px) { const d = this.camera.position.distanceTo(p); return Math.max(0.3, d * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / this.renderer.domElement.clientHeight * px); }
  onTap(e) {
    if (this.globe && this.globe.on) return;
    if (this.pickHandler && this.mode === 'orbit' && this.terrainMesh) { const r = this.renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const h = rc.intersectObject(this.terrainMesh, false)[0]; if (h) this.pickHandler(h.point.x, h.point.z, e); return; }
    if (this.radarPick && this.terrainMesh && this.mode === 'orbit') { const r = this.renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const h = rc.intersectObject(this.terrainMesh, false)[0]; if (h) { this.radarPick = false; this.radar.place(h.point.x, h.point.z); } return; }
    const tacPick = this.tactical && this.tactical.active && this.mode === 'orbit' && !this.sectionPick && !(this.layers && this.layers.t > 0.01);
    const edPick = !tacPick && this.editor && this.editor.active && this.mode === 'orbit' && !this.sectionPick && !(this.layers && this.layers.t > 0.01);
    const svPick = !edPick && this.survey && this.survey.active && this.mode === 'orbit' && !this.sectionPick && !(this.layers && this.layers.t > 0.01);
    if (!this.terrainMesh || (this.mode !== 'drive' && this.mode !== 'walk' && !this.sectionPick && !svPick && !edPick && !tacPick)) return;
    const r = this.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObjects([this.terrainMesh, ...(this.roadMesh ? [this.roadMesh] : [])], false)[0]; if (!hit) return;
    if (this.sectionPick) { this.pickSectionPoint(hit.point.x, hit.point.z); return; }
    if (tacPick) { this.tactical.tap(hit.point.x, hit.point.z); return; }
    if (edPick) { this.editor.tapTol = this.pxToMetres(hit.point, e.pointerType === 'touch' ? 26 : 14); if (e.pointerType === 'touch') this.editor.hoverPt = null; this.editor.tap(hit.point.x, hit.point.z); return; }
    if (svPick) { this.survey.add(hit.point.x, hit.point.z); return; }
    if (this.mode === 'walk') { if (!this.walker.blocked(hit.point.x, hit.point.z)) this.walker.place(hit.point.x, hit.point.z); return; }
    if (this.mode === 'drive' && this.pickRoad) {
      const n = this.net.near(hit.point.x, hit.point.z, 30)[0]; if (!n) { this.onHint && this.onHint('No road there – tap closer to a road.'); return; }
      this.startDrive(n[0], n[1]);
    }
  }
  startDrive(ri, k, kind) {
    kind = kind || this.driveKind || 'car'; this.driveKind = kind; if (this.onVehicle) this.onVehicle(kind);
    if (this.playerMesh) this.root.remove(this.playerMesh);
    const kit = this.kit[kind], g = new THREE.Group();
    const paint = new THREE.Mesh(kit.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide, color: kind === 'tuktuk' ? 0x2a6fb0 : 0xc0392b }));
    const fixed = new THREE.Mesh(kit.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    paint.castShadow = fixed.castShadow = true; g.add(paint, fixed); this.root.add(g); this.playerMesh = g;
    const speed = this.driver ? this.driver.speed : 40 / 3.6;
    this.driver = new Driver(this, this.net, g, kind); this.driver.speed = speed; this.driver.start(ri, k, 1); this.driver.step(0);
    this.pickRoad = false; this._snap = true; this.onHint && this.onHint('Driving – the car follows the road network and turns at junctions.');
  }
  enterDrive() {
    if (this.driver) this.driver.parked = false;
    this.setMode('drive'); this.flight = null;
    if (!this.driver) this.chooseRoad();
  }
  chooseRoad() {
    if (this.playerMesh) this.root.remove(this.playerMesh); this.playerMesh = null; this.driver = null;
    this.pickRoad = true; this.controls.enabled = true;
    this.onHint && this.onHint('Tap a road to start driving on it (drag to move the view).');
  }
  changeVehicle(kind) {
    this.driveKind = kind; if (!this.driver) return;
    const { ri, s, dir } = this.driver; this.startDrive(ri, 0, kind); this.driver.s = s; this.driver.dir = dir; this.driver.step(0);
  }

  frame() {
    if (this.paused) { this.clock.getDelta(); return; }
    if (this.globe && this.globe.on) { const gdt = Math.min(this.clock.getDelta(), 0.1); if (this.radar) this.radar.step(gdt); this.globe.frame(gdt); return; }
    const dt = Math.min(this.clock.getDelta(), 0.05); this.uTime.value += dt;
    if (this.trafficOn !== false) this.updateTraffic(dt);
    this.waterNormal.offset.x += dt * 0.012; this.waterNormal.offset.y += dt * 0.007;
    let focus;
    if (this.nav && this.nav.active && this.mode === 'orbit') focus = this.nav.frame(dt);
    else if (this.mode === 'drive' && this.driver) {
      { const d = this.driver, f = d.fwd; let lim = Infinity;
        for (const v of this.vehicles || []) { const dx = v.pos.x - d.pos.x, dz = v.pos.z - d.pos.z, along = dx * f.x + dz * f.z; if (along <= 0 || along > 70) continue;
          const lat = Math.abs(dx * f.z - dz * f.x); if (lat > 1.9) continue; const same = v.fwd.x * f.x + v.fwd.z * f.z, gap = along - ((v.len || 4) + ((this.kit[d.kind] || {}).len || 4.5)) / 2;
          const safe = 4 + d.speed * 0.9; if (gap < safe) lim = Math.min(lim, Math.max(0, (same > 0.3 ? (v.cur ?? v.speed) : 0) * Math.max(0, gap - 1.5) / safe)); }
        d.limit = lim; }
      this.driver.step(dt);
      const f = this.driver, back = this.kit[f.kind].len * 2.4 + (this.cockpit ? 0 : 5);
      const tgtOff = this.mouse.inside ? -this.mouse.x * 1.4 : 0; this.lookOff += (tgtOff - this.lookOff) * Math.min(1, dt * 4);
      this.lookPitch = (this.lookPitch || 0) + ((this.mouse.inside ? -this.mouse.y * 6 : 0) - (this.lookPitch || 0)) * Math.min(1, dt * 4);
      const fw = f.fwd.clone().setY(0).normalize().applyAxisAngle(new V3(0, 1, 0), this.lookOff), pitch = this.lookPitch;
      const want = this.cockpit ? f.pos.clone().addScaledVector(f.fwd, f.kind.startsWith('moto') ? 0.1 : 0.6).add(new V3(0, f.kind.startsWith('moto') ? 1.75 : f.kind === 'pickup' ? 1.7 : 1.3, 0))
        : f.pos.clone().addScaledVector(fw, -back).add(new V3(0, 2.6 + back * 0.15, 0));
      this.camera.position.lerp(want, this.cockpit || this._snap ? 1 : 1 - Math.exp(-dt * 5)); this._snap = false;
      const look = f.pos.clone().addScaledVector(fw, 25); look.y += (this.cockpit ? 1.2 : 1.0) + pitch; this.camera.lookAt(look);
      if (this.playerMesh) this.playerMesh.visible = !this.cockpit || f.kind.startsWith('moto');
      focus = f.pos;
    } else if (this.mode === 'walk') { this.walker.step(dt, this.camera); focus = this.walker.pos; }
    else {
      if (this.flight) {
        const fl = this.flight; fl.t = Math.min(1, fl.t + dt / 1.6); const e = fl.t * fl.t * (3 - 2 * fl.t);
        this.camera.position.lerpVectors(fl.p0, fl.p1, e); this.controls.target.lerpVectors(fl.q0, fl.q1, e); if (fl.t >= 1) this.flight = null;
      }
      this.controls.update(); focus = this.controls.target;
    }
    if (this.layers) this.layers.step(dt);
    if (this.survey) this.survey.step(dt);
    if (this.radar) this.radar.step(dt);
    if (this.atmos) this.atmos.step(dt);
    if (this.lights) this.lights.step();
    if (this.grass) { if (this.grassOff) this.grass.group.visible = false; else this.grass.update(focus, this.mode === 'orbit' ? this.camera.position.distanceTo(focus) : 0); }
    const dist = this.mode === 'orbit' ? this.camera.position.distanceTo(focus) : 60;
    const half = THREE.MathUtils.clamp(dist * 0.9, 50, (this.extent || 2000) * 0.75), cam = this.sun.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = half * 6; cam.updateProjectionMatrix(); }
    this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.sunDir, half * 3);
    this.updateHud(focus, dt);
    if (this.trafficOn !== false) this.updatePeople(dt);
    this.renderReflection(focus);
    this.renderer.render(this.scene, this.camera);
  }
}
