// Builds a 3D landscape for one AOI.
// load(): network work (OSM tiles, terrain, imagery) + image analysis, done once per AOI.
// construct(): all geometry, re-run quickly when terrain height / smoothing changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from './geo.js?v=3';
import { makeRoadMaterial, makeBuildingMaterial, makeTerrainMaterial, makeWaterMaterial } from './shaders.js?v=3';
import { noiseTexture, waterNormals, detailTextures, balanceGains, enhanceCanvas, classify, wb } from './textures.js?v=3';
import { buildTrees, GrassField } from './vegetation.js?v=3';
import { RoadNet, Driver, Walker } from './modes.js?v=3';
import { vehicleKit } from './vehicles.js?v=3';

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
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49;

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
    this.uTime = { value: 0 };
    this.kit = vehicleKit();
    this.root = new THREE.Group(); sc.add(this.root);
    this.mode = 'orbit'; this.walker = new Walker(this);
    this.setSun(38, true);

    // taps (short press without drag) for picking roads / teleporting
    const el = r.domElement; let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, performance.now()]; });
    el.addEventListener('pointerup', e => {
      if (!down) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]), dt = performance.now() - down[2]; down = null;
      if (moved < 8 && dt < 450) this.onTap(e);
    });

    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.frame());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); }

  setSun(elev, env) {
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(140));
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
    this.root.clear(); this.vehicles = []; this.vehMeshes = []; this.driver = null; this.playerMesh = null;
  }

  /* ================================================================ LOAD */
  async load(aoi, opts, say) {
    this.clearGeometry(); this.setMode('orbit');
    for (const t of this.textures || []) t.dispose(); this.textures = [];
    const F = this.F = new Frame(aoi), W = F.W, H = F.H, X0 = -W / 2, X1 = W / 2, Z0 = -H / 2, Z1 = H / 2, S = Math.max(W, H);
    const D = this.D = { aoi, W, H, X0, Z0, X1, Z1, S, stats: {} };

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
    Object.assign(D, { roads, rails, waterways, landuse, buildings }); D.stats.roads = roads.length; this.views = null;

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
    const ntx = ir.x1 - ir.x0 + 1, nty = ir.y1 - ir.y0 + 1;
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
    const pxX = lon => (G.lon2tx(lon, zi) - ir.x0) * 256, pxY = lat => (G.lat2ty(lat, zi) - ir.y0) * 256;
    const u0 = pxX(F.lon(X0)) / img.width, u1 = pxX(F.lon(X1)) / img.width, v0 = 1 - pxY(F.lat(Z0)) / img.height, v1 = 1 - pxY(F.lat(Z1)) / img.height;
    const imgA = new THREE.Vector4((u1 - u0) / W, u0 - X0 * (u1 - u0) / W, (v1 - v0) / H, v0 - Z0 * (v1 - v0) / H);
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
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const [r, g, b] = pxAt(X0 + (i + .5) * C, Z0 + (j + .5) * C); cls[j * gw + i] = classify(r, g, b); }
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
      if (k === 2) splat[o] = 255;
      else if (k === 3) { if (nearB[q]) splat[o] = 255; else { splat[o + 1] = 255; splatRice[q] = 1; } }
      else if (k === 1) { splat[o + 1] = 120; splat[o + 2] = 135; }
      else if (k === 4) splat[o + 2] = 255;
      else splat[o + 3] = 255;
    }
    const tot = gw * gh || 1;
    this.lulc = { water: counts[1] / tot, tree: counts[2] / tot, crop: counts[3] / tot, bare: counts[4] / tot, built: counts[5] / tot };
    const splatTex = new THREE.DataTexture(splat, gw, gh, THREE.RGBAFormat); splatTex.magFilter = splatTex.minFilter = THREE.LinearFilter; splatTex.needsUpdate = true; this.textures.push(splatTex);
    const exclude = new Uint8Array(mw * mh); for (let i = 0; i < exclude.length; i++) exclude[i] = bmask[i] | rmask[i] | wmask[i];
    this.bmask = new Uint8Array(mw * mh); for (let i = 0; i < exclude.length; i++) this.bmask[i] = bmask[i] | wmask[i];
    Object.assign(D, { MR, mw, mh, C, gw, gh, cls, splatRice, exclude, nearB, wmask });
    D.nearBuilt = (x, z) => nearB[Math.min(gh - 1, Math.max(0, ((z - Z0) / C) | 0)) * gw + Math.min(gw - 1, Math.max(0, ((x - X0) / C) | 0))];

    this.terrainU = {
      uSplat: { value: splatTex }, uGrid: { value: new THREE.Vector4(X0, Z0, gw * C, gh * C) }, uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) },
      uGrass: { value: this.detail.grass }, uRice: { value: this.detail.rice }, uSoil: { value: this.detail.soil }, uGravel: { value: this.detail.gravel }, uDetailOn: { value: 1 },
    };
    this.terrainMat = makeTerrainMaterial(this.texSat, this.terrainU);
    this.waterU = { uHgt: { value: null }, uGrid: { value: new THREE.Vector4() }, uImg: this.uniforms.uImg, uImgA: this.uniforms.uImgA, uTime: this.uTime };
    this.waterMat = makeWaterMaterial(this.waterNormal, this.waterU);
    return D;
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
    const waterDepth = 1.1 + 0.5 * Math.min(exag, 2);
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
      for (const v of inside) Hg[v] = Math.min(Hg[v], level - waterDepth);
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
          if (Math.hypot(x - a.x - vx * t, z - a.z - vz * t) <= half) { const v = j * R + i; Hg[v] = Math.min(Hg[v], lvl[k] - waterDepth * 0.7); }
        }
      }
      waterLines.push({ pts, width });
    }
    // road grading: smooth each road's long profile and conform the terrain corridor to it
    const tgt = new Float32Array(Hg.length), wgt = new Float32Array(Hg.length);
    const graded = [];
    const grade = (pts, hw, win, isRoad) => {
      const g = pts.map(p => gridAt(p.x, p.z)), w = Math.max(1, Math.round(win / step));
      const sm = movingAvg(movingAvg(g, w), Math.max(1, w >> 1)).map(v => Math.max(v, this.seaY + 0.3));
      pts.forEach((p, i) => p.g = sm[i]);
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
      if (!isBridge) grade(pts, r.st.w / 2, r.cls <= 4 ? 120 : r.cls <= 8 ? 80 : r.cls <= 12 ? 45 : 25);
      graded.push({ r, pts, isBridge });
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
      this.root.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
      const bp = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e241c })); bp.position.y = bottom; this.root.add(bp);
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
      if (r.cls <= 16 && r.cls !== 15) netRoads.push({ pts, hw: st.w / 2, oneway, cls: r.cls });
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
      this.root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 })));
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
    if (wGeos.length) { const m = new THREE.Mesh(mergeGeometries(wGeos), this.waterMat); m.receiveShadow = true; this.root.add(m); }

    /* 5. buildings */
    say(`Building ${D.buildings.length} buildings…`); await tick();
    const bgeo = this.buildBuildings(D.buildings, rnd);
    if (bgeo) { const m = new THREE.Mesh(bgeo, makeBuildingMaterial()); m.castShadow = m.receiveShadow = true; this.buildingsMesh = m; this.root.add(m); }

    /* 6. trees + near grass */
    say('Planting trees from the image…'); await tick();
    const vctx = { ...D, mask: D.exclude, pxAt: D.pxAt, hAt, rnd, mobile: this.mobile };
    const t = buildTrees(vctx); this.treeMeshes = t.meshes; t.meshes.forEach(m => this.root.add(m));
    D.stats.trees = t.counts;
    this.grass = new GrassField(vctx, this.uTime, this.mobile); this.root.add(this.grass.group);

    /* 7. traffic */
    if (opts.traffic !== false) { say('Adding traffic…'); this.buildTraffic(rnd); }

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
    m.castShadow = m.receiveShadow = true; this.root.add(m);
  }

  /* ---------- buildings ---------- */
  buildBuildings(list, rnd) {
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
      const wallC = new THREE.Color(WALLS[(rnd() * WALLS.length) | 0]).convertSRGBToLinear();
      const winType = t === 9 || t === 10 ? 0 : (h > 6.5 || [3, 4, 7, 8].includes(t)) ? 2 : 1, top = gnd + h;
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
      const pitched = ob && !big && rect > 0.78 && ![3, 4, 5, 9].includes(t) && h < 10 && ob.b > 1.5;
      if (t === 11 && ob) {
        const r = Math.sqrt(area / Math.PI) * 0.9, g = new THREE.LatheGeometry([[0, 0], [r, 0], [r * 0.95, r * 0.6], [r * 0.55, r * 1.3], [r * 0.25, r * 1.9], [0.05, r * 3.2]].map(([x, y]) => new THREE.Vector2(x, y)), 12).toNonIndexed();
        const gp = g.attributes.position, gold = new THREE.Color(0xd8b25a).convertSRGBToLinear(), white = new THREE.Color(0xf2efe6).convertSRGBToLinear();
        for (let i = 0; i < gp.count; i++) push([gp.getX(i) + ob.cx, gp.getY(i) + top, gp.getZ(i) + ob.cz], gp.getY(i) > r * 1.3 ? gold : white, [0, 0, 0, 0]);
      } else if (pitched || (t === 6 && ob)) {
        const o = 0.45, pagoda = t === 6, P = (u, v, y) => [ob.cx + ob.ux * u + ob.vx * v, y, ob.cz + ob.uz * u + ob.vz * v];
        const roofC = new THREE.Color(pagoda ? 0xc0562a : ROOF_G[(rnd() * ROOF_G.length) | 0]).convertSRGBToLinear(), gableC = new THREE.Color(0xd9a441).convertSRGBToLinear();
        const tiers = pagoda ? [[1, 1, 0], [0.72, 0.8, 0.55]] : [[1, 1, 0]], hip = !pagoda && rnd() < 0.45;
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
        const roofC = new THREE.Color(ROOF_F[(rnd() * ROOF_F.length) | 0]).convertSRGBToLinear();
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
    this.D.stats.buildings = count;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 4));
    g.computeVertexNormals(); return g;
  }

  /* ---------- traffic ---------- */
  buildTraffic(rnd) {
    const PER_KM = { 1: 40, 2: 10, 3: 34, 4: 10, 5: 26, 6: 8, 7: 18, 8: 6, 9: 12, 10: 4, 11: 6, 12: 5, 14: 2 };
    const cap = this.mobile ? 500 : 1600, want = [];
    for (const ln of this.lanesForTraffic) { const L = ln.pts[ln.pts.length - 1].s, n = Math.floor(L / 1000 * (PER_KM[ln.cls] || 2) * (ln.urban ? 1.6 : 1) + rnd()); for (let k = 0; k < n; k++) want.push(ln); }
    const list = want.length > cap ? want.filter(() => rnd() < cap / want.length) : want;
    const types = Object.keys(this.kit), slots = Object.fromEntries(types.map(t => [t, []]));
    this.vehicles = [];
    for (const ln of list) {
      const r = rnd(); let t;
      if (ln.cls <= 4) t = r < 0.35 ? 'moto' : r < 0.75 ? 'car' : r < 0.85 ? 'bus' : 'truck';
      else if (ln.cls <= 8) t = r < 0.5 ? 'moto' : r < 0.8 ? 'car' : r < 0.9 ? 'tuktuk' : 'truck';
      else t = r < (ln.urban ? 0.62 : 0.72) ? 'moto' : r < 0.86 ? 'car' : r < 0.95 ? 'tuktuk' : 'truck';
      if (ln.st.w < 4 && (t === 'truck' || t === 'bus')) t = 'moto';
      const dir = ln.oneway ? 1 : (rnd() < 0.5 ? 1 : -1), src = dir > 0 ? ln.pts : ln.pts.slice().reverse(), hw = ln.st.w / 2;
      let off;
      if (ln.oneway) off = (ln.st.lanes > 1 ? (((rnd() * ln.st.lanes) | 0) + 0.5) / ln.st.lanes * 2 - 1 : 0) * (hw - 0.6);
      else { const per = Math.max(1, Math.round(ln.st.lanes / 2)); off = ((((rnd() * per) | 0) + 0.5) / per) * (hw - 0.4); }
      if (t === 'moto') off += (ln.oneway ? 0.6 : hw * 0.25) * rnd() * 0.8;
      const P = new Float32Array(src.length * 3), S = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        P[i * 3] = src[i].x - tz / l * off; P[i * 3 + 1] = src[i].y; P[i * 3 + 2] = src[i].z + tx / l * off;
        if (i) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
      }
      const speed = (ln.cls <= 4 ? 22 : ln.cls <= 8 ? 15 : ln.cls <= 10 ? 11 : 7) * (t === 'moto' ? 0.9 + rnd() * 0.3 : t === 'tuktuk' ? 0.65 : t === 'truck' || t === 'bus' ? 0.8 : 1);
      const v = { P, S, L: S[S.length - 1], u: rnd() * S[S.length - 1], speed, t, pos: new V3(), fwd: new V3(0, 0, 1) };
      slots[t].push(v); this.vehicles.push(v);
    }
    this.vehMeshes = [];
    for (const t of types) {
      const n = slots[t].length; if (!n) continue; const k = this.kit[t];
      const paint = new THREE.InstancedMesh(k.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 }), n);
      const fixed = new THREE.InstancedMesh(k.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), n);
      const c = new THREE.Color(); slots[t].forEach((v, i) => paint.setColorAt(i, c.set(k.palette[(rnd() * k.palette.length) | 0])));
      for (const m of [paint, fixed]) { m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.root.add(m); }
      this.vehMeshes.push({ paint, fixed, list: slots[t] });
    }
    this.updateTraffic(0);
    this.D.stats.vehicles = this.vehicles.length;
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
        d.position.copy(v.pos); look.copy(v.pos).add(v.fwd); d.lookAt(look); d.updateMatrix(); g.paint.setMatrixAt(i, d.matrix); g.fixed.setMatrixAt(i, d.matrix);
      });
      g.paint.instanceMatrix.needsUpdate = g.fixed.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- ground looks ---------- */
  setGround(style) {
    const D = this.D; if (!D) return;
    let tex = this.texSat;
    if (style === 'enhanced' && D.px) { if (!this.texEnh) this.texEnh = this.mkTex(enhanceCanvas(D.img, D.px, D.gains)); tex = this.texEnh; }
    if (style === 'lulc' && D.px) {
      if (!this.texStyl) {
        const c = document.createElement('canvas'), w = c.width = D.img.width, h = c.height = D.img.height, ctx = c.getContext('2d'), out = ctx.createImageData(w, h), s = D.px, o = out.data, g = D.gains, rnd = G.mulberry32(3);
        const PAL = { 1: [52, 92, 112], 2: [44, 86, 40], 3: [128, 160, 74], 4: [176, 112, 72], 5: [184, 178, 166] };
        for (let i = 0; i < s.length; i += 4) {
          const r = wb(s[i], 0, g), gg = wb(s[i + 1], 1, g), b = wb(s[i + 2], 2, g), p = PAL[classify(r, gg, b)], lum = 0.75 + (r + gg + b) / 765 * 0.5, j = 0.94 + rnd() * 0.1;
          o[i] = Math.min(255, (p[0] * 0.7 + r * 0.3) * lum * j); o[i + 1] = Math.min(255, (p[1] * 0.7 + gg * 0.3) * lum * j); o[i + 2] = Math.min(255, (p[2] * 0.7 + b * 0.3) * lum * j); o[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0); this.texStyl = this.mkTex(c);
      }
      tex = this.texStyl;
    }
    this.terrainMat.map = tex; this.terrainMat.needsUpdate = true; this.uniforms.uImg.value = tex;
  }

  setVisible(kind, on) {
    if (kind === 'trees') (this.treeMeshes || []).forEach(m => m.visible = on);
    if (kind === 'buildings' && this.buildingsMesh) this.buildingsMesh.visible = on;
    if (kind === 'traffic') { this.trafficOn = on; (this.vehMeshes || []).forEach(g => g.paint.visible = g.fixed.visible = on); }
    if (kind === 'shadows') this.sun.castShadow = on;
    if (kind === 'detail') { this.terrainU.uDetailOn.value = on ? 1 : 0; this.grassOff = !on; }
  }

  /* ---------- camera views & player modes ---------- */
  goView(name, instant) {
    this.setMode('orbit');
    const v = this.views && this.views[name]; if (!v) return;
    const p1 = new V3(...v.pos), q1 = new V3(...v.target);
    if (instant) { this.camera.position.copy(p1); this.controls.target.copy(q1); this.controls.update(); return; }
    this.flight = { t: 0, p0: this.camera.position.clone(), q0: this.controls.target.clone(), p1, q1 };
  }
  setMode(mode) {
    const prev = this.mode; this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    this.walker.active = mode === 'walk';
    this.camera.fov = mode === 'walk' ? 62 : 45; this.camera.updateProjectionMatrix();
    if (mode === 'walk' && prev !== 'walk') {
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
  groundAt(x, z) { return this.hAt ? this.hAt(x, z) : 0; }
  onTap(e) {
    if (!this.terrainMesh || (this.mode !== 'drive' && this.mode !== 'walk')) return;
    const r = this.renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObjects([this.terrainMesh, ...(this.roadMesh ? [this.roadMesh] : [])], false)[0]; if (!hit) return;
    if (this.mode === 'walk') { if (!this.walker.blocked(hit.point.x, hit.point.z)) this.walker.place(hit.point.x, hit.point.z); return; }
    if (this.mode === 'drive' && this.pickRoad) {
      const n = this.net.near(hit.point.x, hit.point.z, 30)[0]; if (!n) { this.onHint && this.onHint('No road there – tap closer to a road.'); return; }
      this.startDrive(n[0], n[1]);
    }
  }
  startDrive(ri, k, kind) {
    kind = kind || this.driveKind || 'car'; this.driveKind = kind;
    if (this.playerMesh) this.root.remove(this.playerMesh);
    const kit = this.kit[kind], g = new THREE.Group();
    const paint = new THREE.Mesh(kit.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, color: kind === 'tuktuk' ? 0x2a6fb0 : 0xc0392b }));
    const fixed = new THREE.Mesh(kit.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    paint.castShadow = fixed.castShadow = true; g.add(paint, fixed); this.root.add(g); this.playerMesh = g;
    const speed = this.driver ? this.driver.speed : 40 / 3.6;
    this.driver = new Driver(this, this.net, g, kind); this.driver.speed = speed; this.driver.start(ri, k, 1); this.driver.step(0);
    this.pickRoad = false; this._snap = true; this.onHint && this.onHint('Driving – the car follows the road network and turns at junctions.');
  }
  enterDrive() {
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
    const dt = Math.min(this.clock.getDelta(), 0.05); this.uTime.value += dt;
    if (this.trafficOn !== false) this.updateTraffic(dt);
    this.waterNormal.offset.x += dt * 0.012; this.waterNormal.offset.y += dt * 0.007;
    let focus;
    if (this.mode === 'drive' && this.driver) {
      this.driver.step(dt);
      const f = this.driver, back = this.kit[f.kind].len * 2.4 + (this.cockpit ? 0 : 5);
      const want = this.cockpit ? f.pos.clone().addScaledVector(f.fwd, 0.6).add(new V3(0, f.kind === 'moto' ? 1.6 : 1.35, 0))
        : f.pos.clone().addScaledVector(f.fwd, -back).add(new V3(0, 2.6 + back * 0.15, 0));
      this.camera.position.lerp(want, this.cockpit || this._snap ? 1 : Math.max(0.2, 1 - Math.exp(-dt * 6))); this._snap = false;
      const look = f.pos.clone().addScaledVector(f.fwd, 25); look.y += this.cockpit ? 1.2 : 1.0; this.camera.lookAt(look);
      focus = f.pos;
    } else if (this.mode === 'walk') { this.walker.step(dt, this.camera); focus = this.walker.pos; }
    else {
      if (this.flight) {
        const fl = this.flight; fl.t = Math.min(1, fl.t + dt / 1.6); const e = fl.t * fl.t * (3 - 2 * fl.t);
        this.camera.position.lerpVectors(fl.p0, fl.p1, e); this.controls.target.lerpVectors(fl.q0, fl.q1, e); if (fl.t >= 1) this.flight = null;
      }
      this.controls.update(); focus = this.controls.target;
    }
    if (this.grass) { if (this.grassOff) this.grass.group.visible = false; else this.grass.update(focus, this.mode === 'orbit' ? this.camera.position.distanceTo(focus) : 0); }
    const dist = this.mode === 'orbit' ? this.camera.position.distanceTo(focus) : 60;
    const half = THREE.MathUtils.clamp(dist * 0.9, 50, (this.extent || 2000) * 0.75), cam = this.sun.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = half * 6; cam.updateProjectionMatrix(); }
    this.sun.target.position.copy(focus); this.sun.position.copy(focus).addScaledVector(this.sunDir, half * 3);
    this.renderer.render(this.scene, this.camera);
  }
}
