// Whole-Earth view: zoom out from the 3D plate to the globe and see where it sits, with live data:
// day/night from the real sun position, clouds from geostationary satellites (NASA GIBS: Himawari, GOES-East,
// GOES-West infrared), wind from Open-Meteo, satellites from CelesTrak orbital elements, and aircraft from the radar
// or (with your proxy) OpenSky.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { t } from './i18n.js?v=88';

const R_KM = 6371, D2R = Math.PI / 180;
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&FORMAT=';
const SAT_GROUPS = { stations: ['Space stations', '#ffffff', 3.5], resource: ['Earth observation', '#ff9f6b', 3], visual: ['Brightest', '#ffe680', 2.2], 'gps-ops': ['GPS', '#7fd1ff', 2.4], weather: ['Weather', '#9cff9c', 2.4], starlink: ['Starlink', '#c8a0ff', 1.2] };
export const xyz = (lat, lon, r = 1) => new THREE.Vector3(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));
const loadImg = (u) => new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => bad(new Error('image')); i.src = u; });
const isoDay = (d) => d.toISOString().slice(0, 10);

function sunLatLon(d = new Date()) {
  const N = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5, h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const B = 2 * Math.PI * (N - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // equation of time (min)
  return [-23.44 * Math.cos(2 * Math.PI * (N + 10) / 365), -15 * (h - 12 + eot / 60)];
}

export class Globe {
  constructor(world) {
    this.w = world; this.on = false; this.opt = { clouds: true, night: true, wind: true, flights: true, temp: false, rain: false, storms: true, radar: true, sats: { resource: true, stations: true, visual: true, 'gps-ops': false, weather: false, starlink: false } };
    const sc = this.scene = new THREE.Scene(); // the sky behind the Earth (stars, Sun, Moon, planets) is drawn by the cosmos view
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.001, 200);
    this.ctl = new OrbitControls(this.cam, world.renderer.domElement); this.ctl.addEventListener('start', () => { this.followSat = null; }); this.ctl.enabled = false; this.ctl.enablePan = false; this.ctl.minDistance = 1.0003; this.ctl.maxDistance = 9; this.ctl.enableZoom = false; this.ctl.enableDamping = true; this.ctl.dampingFactor = 0.08;
    // zoom by height above the ground, so you can go from space down to a few km smoothly
    world.renderer.domElement.addEventListener('wheel', e => { if (!this.on || this.anim || (this.cos && this.cos.active) || (this.sv && this.sv.active)) return; e.preventDefault();
      const d = this.cam.position.length(), alt0 = d - 1;
      if (alt0 >= 7.9 && e.deltaY > 0 && this.cos) { this.followSat = null; this.cos.enterFromGlobe(this.cam); return; } // keep zooming out: into space
      const alt = Math.min(8, Math.max(0.0003, alt0 * Math.exp(e.deltaY * 0.0012)));
      // keep the place under the cursor under the cursor: turn the view towards it by the same share as the height changes
      const el = world.renderer.domElement, r = el.getBoundingClientRect(), rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam);
      const hit = rc.intersectObject(this.earth, false)[0], c = this.cam.position.clone().normalize();
      if (hit) { const p = hit.point.clone().normalize(), ang = c.angleTo(p), f = 1 - alt / alt0; if (ang > 1e-6) { const ax = new THREE.Vector3().crossVectors(c, p).normalize(); c.applyAxisAngle(ax, ang * Math.max(-1, Math.min(1, f))); } }
      this.cam.position.copy(c.multiplyScalar(1 + alt)); this.cam.up.set(0, 1, 0); this.cam.lookAt(0, 0, 0); }, { passive: false });
    this.tiles = new Map();
    // earth with day / night
    const blank = (c) => { const cv = document.createElement('canvas'); cv.width = cv.height = 4; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 4, 4); return new THREE.CanvasTexture(cv); };
    this.U = { day: { value: blank('#1d3b5a') }, night: { value: blank('#000000') }, sun: { value: new THREE.Vector3(1, 0, 0) }, nightOn: { value: 1 } };
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.ShaderMaterial({ uniforms: this.U,
      vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sun; uniform float nightOn; varying vec2 vUv; varying vec3 vN;
        void main(){ float d = dot(normalize(vN), normalize(sun)); float k = mix(1.0, smoothstep(-0.12, 0.12, d), nightOn);
          vec3 dc = texture2D(day, vUv).rgb * (0.35 + 0.75 * max(d, 0.0) * nightOn + (1.0 - nightOn) * 0.65); vec3 nc = texture2D(night, vUv).rgb * 1.6 + vec3(0.01, 0.015, 0.03);
          gl_FragColor = vec4(mix(nc, dc, k), 1.0);
          #include <colorspace_fragment>
        }` }));
    sc.add(this.earth);
    // clouds
    this.cloudTex = blank('rgba(0,0,0,0)'); this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 128, 64), new THREE.MeshLambertMaterial({ map: this.cloudTex, transparent: true, depthWrite: false })); sc.add(this.clouds);
    // atmosphere rim
    this.rimU = { k: { value: 1 } }; sc.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 48), new THREE.ShaderMaterial({ uniforms: this.rimU, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float k; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * f * 1.4 * k; }' })));
    this.sunL = new THREE.DirectionalLight(0xffffff, 2.2); sc.add(this.sunL, new THREE.AmbientLight(0xffffff, 0.35));
    this.dyn = new THREE.Group(); sc.add(this.dyn);
    this.satObjs = {}; this.sats = {}; this.status = {};
  }
  /* ---------- the plate on the globe ---------- */
  placePlate() {
    const w = this.w, D = w.D; if (!D) return; if (this.plate) { this.scene.remove(this.plate); }
    const a = D.aoi, lat = (a.s + a.n) / 2, lon = (a.w + a.e) / 2; this.lat = lat; this.lon = lon;
    const g = new THREE.Group(), real = Math.max(D.W, D.H) / 1000 / R_KM, S = real; this.plateReal = real;
    const top = new THREE.MeshBasicMaterial({ map: w.texSat }), side = new THREE.MeshBasicMaterial({ color: 0x8a7a5c });
    const box = new THREE.Mesh(new THREE.BoxGeometry(S, S * 0.12, S), [side, side, top, side, side, side]); box.position.y = S * 0.06; g.add(box);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(S * 0.012, S * 0.012, S * 0.8, 6).translate(0, S * 0.4, 0), new THREE.MeshBasicMaterial({ color: 0xffb547 })); g.add(pin);
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d'); x.font = '700 40px system-ui, "Noto Sans Khmer", sans-serif'; x.fillStyle = '#ffb547'; x.strokeStyle = '#000'; x.lineWidth = 6;
    const txt = `Your 3D area · ${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`; x.strokeText(txt, 8, 60); x.fillText(txt, 8, 60);
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true })); lab.center.set(0, 0); lab.scale.set(0.16, 0.03, 1); lab.renderOrder = 30; this.plateLab = lab;
    const p = xyz(lat, lon, 1.0005); g.position.copy(p); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
    // keep the image "north up" on the plate
    const north = xyz(lat + 0.01, lon, 1.0005).sub(p).normalize(), loc = north.clone().applyQuaternion(g.quaternion.clone().invert()); g.rotateY(Math.atan2(-loc.x, -loc.z));
    this.plate = g; this.scene.add(g); this.plateS = S; if (this.plateLabOld) this.scene.remove(this.plateLabOld); lab.position.copy(xyz(lat, lon, 1.03)); this.scene.add(lab); this.plateLabOld = lab;
  }
  /* ---------- enter / leave ---------- */
  async enter() {
    if (this.on) return; const w = this.w; this.on = true; w.controls.enabled = false; this.ctl.enabled = true; this.placePlate();
    const p = xyz(this.lat, this.lon, 1); this.cam.position.copy(p.clone().multiplyScalar(1.002)); this.ctl.target.set(0, 0, 0); this.ctl.update();
    this.anim = { t: 0, from: 1.002, to: 3.4, dir: p.clone().normalize() }; this.onToggle && this.onToggle(true);
    if (!this.loaded) { this.loaded = true; this.loadBase(); import('./cosmos.js?v=88').then(M => { this.cos = new M.Cosmos(this); }).catch(e => console.warn('cosmos', e)); this.satEvents(); }
    this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => this.refresh(), 60000);
  }
  leave() {
    if (this.cos && this.cos.active) this.cos.exit();
    if (!this.on || (this.anim && this.anim.out)) return; const p = xyz(this.lat, this.lon, 1).normalize(), d = this.cam.position.length();
    this.anim = { t: 0, from: d, to: 1.0012, dir: p, start: this.cam.position.clone().normalize(), out: true };
  }
  finishLeave() { const w = this.w; if (this.sv && this.sv.active) this.sv.close(); if (this.cos) this.cos.hideLabels(); this.followSat = null; this.satCard(null); this.on = false; this.ctl.enabled = false; w.controls.enabled = true; clearInterval(this.timer); w.clock.getDelta(); this.onToggle && this.onToggle(false); }
  /* ---------- data ---------- */
  async loadBase() {
    const W = 4096, H = 2048;
    loadImg(GIBS + `image/jpeg&WIDTH=${W}&HEIGHT=${H}&LAYERS=BlueMarble_ShadedRelief_Bathymetry`).then(i => { const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; this.U.day.value = t; }).catch(() => this.status.base = 'Base map not reachable');
    loadImg(GIBS + `image/jpeg&WIDTH=${W}&HEIGHT=${H}&LAYERS=VIIRS_Black_Marble&TIME=2016-01-01`).then(i => { const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; this.U.night.value = t; }).catch(() => { });
  }
  refresh() { if (this.opt.clouds) this.loadClouds(); if (this.opt.wind || this.opt.temp) this.loadWind(); if (this.opt.rain) this.loadRain(); if (this.opt.storms) this.loadStorms(); this.loadSats(); if (this.opt.flights) this.loadFlights(); }
  async loadClouds() {
    if (this.cloudBusy || (this.cloudAt && Date.now() - this.cloudAt < 10 * 60e3)) return; this.cloudBusy = true;
    const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), acc = new Uint8ClampedArray(W * H);
    const layers = ['Himawari_AHI_Band13_Clean_Infrared', 'GOES-East_ABI_Band13_Clean_Infrared', 'GOES-West_ABI_Band13_Clean_Infrared']; let n = 0;
    await Promise.all(layers.map(async L => { try { const i = await loadImg(GIBS + `image/png&TRANSPARENT=true&WIDTH=${W}&HEIGHT=${H}&LAYERS=${L}`); const t = document.createElement('canvas'); t.width = W; t.height = H; const tg = t.getContext('2d'); tg.drawImage(i, 0, 0); const d = tg.getImageData(0, 0, W, H).data;
      for (let q = 0, p = 0; q < d.length; q += 4, p++) { if (!d[q + 3]) continue; const l = (d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255, a = Math.max(0, Math.min(1, (l - 0.42) / 0.38)) * 255; if (a > acc[p]) acc[p] = a; } n++; } catch (e) { } }));
    const im = g.createImageData(W, H); for (let p = 0; p < acc.length; p++) { const a = acc[p]; im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = 255; im.data[p * 4 + 3] = a; } g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.clouds.material.map = t; this.clouds.material.needsUpdate = true; if (this.cloudTex) this.cloudTex.dispose(); this.cloudTex = t;
    this.cloudAt = Date.now(); this.cloudBusy = false; this.status.clouds = n ? `Clouds: ${n} geostationary satellites (infrared, about 10–20 min old)` : 'Clouds not reachable'; this.onInfo && this.onInfo();
  }
  // Open-Meteo, many points per request; results are cached for the hour so reopening costs nothing
  async omGrid(lats, lons, key) {
    // cached for 3 hours, and a daily budget so the free Open-Meteo limit (also used by live weather) is never used up
    const slot = new Date().toISOString().slice(0, 11) + Math.floor(new Date().getUTCHours() / 3), ck = 'cambodia3d.om.' + key; try { const c = JSON.parse(localStorage.getItem(ck) || 'null'); if (c && c.h === slot && c.n === lats.length) return c.d; } catch (e) { }
    const bk = 'cambodia3d.omBudget', day = new Date().toISOString().slice(0, 10); let bud = {}; try { bud = JSON.parse(localStorage.getItem(bk) || '{}'); } catch (e) { } if (bud.day !== day) bud = { day, n: 0 };
    if (bud.blocked === day || bud.n + lats.length > 2500) throw new Error('daily budget'); bud.n += lats.length; try { localStorage.setItem(bk, JSON.stringify(bud)); } catch (e) { }
    const d = []; for (let s = 0; s < lats.length; s += 210) { const la = lats.slice(s, s + 210), lo = lons.slice(s, s + 210);
      const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&current=wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=ms`)).json();
      if (j.error) { if (/limit/i.test(j.reason || '')) { bud.blocked = day; try { localStorage.setItem(bk, JSON.stringify(bud)); } catch (e) { } } throw new Error(j.reason); } (Array.isArray(j) ? j : [j]).forEach(r => d.push([+r.current.wind_speed_10m.toFixed(1), Math.round(r.current.wind_direction_10m), +r.current.temperature_2m.toFixed(1)])); }
    try { localStorage.setItem(ck, JSON.stringify({ h: slot, n: lats.length, d })); } catch (e) { } return d;
  }
  toUV(d) { const U = new Float32Array(d.length), V = new Float32Array(d.length), T = new Float32Array(d.length); d.forEach(([sp, dr, t], i) => { U[i] = -sp * Math.sin(dr * D2R); V[i] = -sp * Math.cos(dr * D2R); T[i] = t; }); return { U, V, T }; }
  async loadWind() {
    if (this.windAt && Date.now() - this.windAt < 30 * 60e3) return; this.windAt = Date.now();
    const lats = [], lons = []; for (let la = -75; la <= 75; la += 15) for (let lo = -180; lo < 180; lo += 15) { lats.push(la); lons.push(lo); }
    try { const d = await this.omGrid(lats, lons, 'g15'); this.wind = { ...this.toUV(d), NX: 24, NY: 11, x0: -180, y0: -75, st: 15, wrap: true };
      this.status.wind = 'Wind & temperature: Open-Meteo, now (15° grid; 3° near where you look)'; if (!this.windLines) this.initParticles(); this.drawTemp();
    } catch (e) { this.status.wind = /budget|limit/.test(e.message) ? 'Wind: daily data limit reached – try again later' : 'Wind not reachable'; this.windAt = /budget|limit/.test(e.message) ? Date.now() : 0; } this.onInfo && this.onInfo();
  }
  // finer wind where the camera looks (shows the turning of storms)
  async loadDetail() {
    if (this.detBusy || !this.wind) return; const c = this.cam.position.clone().normalize(), lat = Math.round(Math.asin(c.y) / D2R / 3) * 3, lon = Math.round(Math.atan2(-c.z, c.x) / D2R / 3) * 3;
    if (this.det && Math.abs(this.det.lat - lat) < 8 && Math.abs(((this.det.lon - lon + 540) % 360) - 180) < 8 && Date.now() - this.det.at < 3600e3) return;
    this.detBusy = true; const N = 9, st = 3, y0 = Math.max(-84, Math.min(84 - (N - 1) * st, lat - 12)), x0 = lon - 12, lats = [], lons = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { lats.push(y0 + j * st); lons.push((((x0 + i * st) + 540) % 360) - 180); }
    try { const d = await this.omGrid(lats, lons, `d${y0}_${x0}`); this.det = { ...this.toUV(d), NX: N, NY: N, x0, y0, st, lat, lon, at: Date.now() }; } catch (e) { }
    this.detBusy = false;
  }
  windAt_(lat, lon) {
    const sample = (W, la, lo) => { let fx = (lo - W.x0) / W.st; if (W.wrap) fx = ((fx % W.NX) + W.NX) % W.NX; else { fx = ((lo - W.x0 + 540) % 360 - 180) / W.st; if (fx < 0 || fx > W.NX - 1) return null; }
      const fy = (la - W.y0) / W.st; if (!W.wrap && (fy < 0 || fy > W.NY - 1)) return null; const yy = Math.max(0, Math.min(W.NY - 1.001, fy)), x0 = Math.min(W.NX - 1, Math.floor(fx)), y0 = Math.floor(yy), x1 = W.wrap ? (x0 + 1) % W.NX : Math.min(W.NX - 1, x0 + 1), tx = fx - x0, ty = yy - y0;
      const g = (A, x, y) => A[y * W.NX + x], b = A => (g(A, x0, y0) * (1 - tx) + g(A, x1, y0) * tx) * (1 - ty) + (g(A, x0, y0 + 1) * (1 - tx) + g(A, x1, y0 + 1) * tx) * ty; return [b(W.U), b(W.V), b(W.T)]; };
    return (this.det && sample(this.det, lat, lon)) || sample(this.wind, lat, lon);
  }
  drawTemp() {
    if (!this.wind) return; const W = 360, H = 180, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), im = g.createImageData(W, H);
    const ramp = [[-30, [80, 40, 160]], [-10, [60, 120, 230]], [0, [120, 200, 240]], [10, [120, 210, 140]], [20, [240, 220, 90]], [28, [250, 150, 50]], [35, [220, 50, 40]], [45, [130, 0, 40]]];
    const col = t => { for (let k = 1; k < ramp.length; k++) if (t <= ramp[k][0]) { const [a, ca] = ramp[k - 1], [b, cb] = ramp[k], f = Math.max(0, (t - a) / (b - a)); return ca.map((v, i) => v + (cb[i] - v) * f); } return ramp[ramp.length - 1][1]; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const la = 89.5 - y, lo = -179.5 + x, r = this.windAt_(la, lo), [cr, cg, cb] = col(r[2]); im.data.set([cr, cg, cb, 150], (y * W + x) * 4); }
    g.putImageData(im, 0, 0); this.tempCanvas = c;
    if (!this.temp) { this.temp = new THREE.Mesh(new THREE.SphereGeometry(1.003, 128, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); this.scene.add(this.temp); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (this.temp.material.map) this.temp.material.map.dispose(); this.temp.material.map = t; this.temp.material.needsUpdate = true;
  }
  async loadRain() {
    if (this.rainAt && Date.now() - this.rainAt < 30 * 60e3) return; this.rainAt = Date.now();
    try { const i = await loadImg(GIBS + `image/png&TRANSPARENT=true&WIDTH=2048&HEIGHT=1024&LAYERS=IMERG_Precipitation_Rate_30min`); const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      if (!this.rain) { this.rain = new THREE.Mesh(new THREE.SphereGeometry(1.004, 128, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); this.scene.add(this.rain); }
      this.rain.material.map = t; this.rain.material.needsUpdate = true; this.status.rain = 'Rain: NASA IMERG, every 30 min (a few hours old)'; } catch (e) { this.status.rain = 'Rain not reachable'; this.rainAt = 0; } this.onInfo && this.onInfo();
  }
  // tropical cyclones from GDACS: track, forecast (dashed), wind areas and current strength
  async loadStorms() {
    if (this.stormAt && Date.now() - this.stormAt < 30 * 60e3) return; this.stormAt = Date.now();
    try {
      const j = await (await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC')).json(), now = Date.now();
      const act = (j.features || []).filter(f => now - Date.parse(f.properties.todate + 'Z') < 3 * 864e5);
      if (this.storms) { this.scene.remove(this.storms); this.storms.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } const G0 = this.storms = new THREE.Group(); this.scene.add(G0);
      const line = (co, col, dash, r = 1.009, op = 0.95) => { const pts = co.map(([lo, la]) => xyz(la, lo, r)); const g = new THREE.BufferGeometry().setFromPoints(pts), l = new THREE.Line(g, dash ? new THREE.LineDashedMaterial({ color: col, dashSize: 0.006, gapSize: 0.004, transparent: true, opacity: op }) : new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })); if (dash) l.computeLineDistances(); G0.add(l); };
      const names = [];
      for (const f of act) {
        const P = f.properties, geo = await (await fetch(P.url.geometry)).json(), C = { Green: 0x3fbf5f, Orange: 0xff9b2f, Red: 0xff3b30 };
        for (const q of geo.features) { const cl = q.properties.Class || ''; if (q.geometry.type === 'LineString') line(q.geometry.coordinates, q.properties.forecast ? 0xffd23f : 0xff5a3c, !!q.properties.forecast);
          else if (/^Poly_(Green|Orange|Red)/.test(cl)) for (const ring of q.geometry.coordinates) line(ring, C[cl.slice(5)], false, 1.0085, 0.35); }
        const [lo, la] = f.geometry.coordinates, sev = P.severitydata || {}, c = document.createElement('canvas'); c.width = 512; c.height = 112; const x = c.getContext('2d'); x.font = '700 40px system-ui'; x.fillStyle = '#ffd23f'; x.strokeStyle = '#000'; x.lineWidth = 6;
        const n1 = `🌀 ${P.eventname.replace(/-\d+$/, '')}`, n2 = (sev.severitytext || '').replace('(maximum wind speed of ', '· ').replace(')', ''); x.strokeText(n1, 8, 44); x.fillText(n1, 8, 44); x.font = '600 30px system-ui'; x.strokeText(n2, 8, 92); x.fillText(n2, 8, 92);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: true, transparent: true })); sp.center.set(-0.04, 0.5); sp.scale.set(0.16, 0.035, 1); sp.position.copy(xyz(la, lo, 1.012)); sp.renderOrder = 32; G0.add(sp);
        const dot = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.007, 24), new THREE.MeshBasicMaterial({ color: C[P.alertlevel] || 0xff9b2f, side: THREE.DoubleSide })); dot.position.copy(xyz(la, lo, 1.01)); dot.lookAt(0, 0, 0); G0.add(dot); names.push(`${P.eventname.replace(/-\d+$/, '')} (${sev.severity ? Math.round(sev.severity) + ' km/h' : P.alertlevel})`);
      }
      if (!act.length) this.stormAt = Date.now() - 27 * 60e3; // try again in a few minutes
      this.status.storms = act.length ? `Tropical cyclones (GDACS): ${names.join(', ')} – red track = past, yellow dashed = forecast` : 'No active tropical cyclones (GDACS)';
    } catch (e) { this.status.storms = 'Storm data (GDACS) not reachable'; this.stormAt = 0; } this.onInfo && this.onInfo();
  }
  initParticles() {
    if (this.windLines) { this.dyn.remove(this.windLines); this.windLines.geometry.dispose(); }
    const N = this.nP = 7000, pos = new Float32Array(N * 6), col = new Float32Array(N * 8); this.P = new Float32Array(N * 3); // lat, lon, age
    for (let i = 0; i < N; i++) this.respawn(i, Math.random() * 80);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.windLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })); this.windLines.frustumCulled = false; this.dyn.add(this.windLines);
  }
  respawn(i, age = 0) { this.P[i * 3] = Math.asin(Math.random() * 2 - 1) / D2R * 0.95; this.P[i * 3 + 1] = Math.random() * 360 - 180; this.P[i * 3 + 2] = age; }
  stepWind(dt) {
    if (!this.windLines) return; this.windLines.visible = this.opt.wind; if (!this.opt.wind) return;
    const P = this.P, pos = this.windLines.geometry.attributes.position.array, col = this.windLines.geometry.attributes.color.array, K = 2.2e4 * dt; // time lapse
    for (let i = 0; i < this.nP; i++) {
      let la = P[i * 3], lo = P[i * 3 + 1]; const [u, v] = this.windAt_(la, lo), s = Math.hypot(u, v), la1 = la + v * K / 111000, lo1 = lo + u * K / (111000 * Math.max(0.2, Math.cos(la * D2R)));
      P[i * 3 + 2] += dt; const Tt = 50000 * Math.min(1, 12 / Math.max(s, 0.1)) * Math.min(1, s / 2 + 0.3), a = xyz(la - v * Tt / 111000, lo - u * Tt / (111000 * Math.max(0.2, Math.cos(la * D2R))), 1.008), b = xyz(la1, lo1, 1.008); pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); // short streak behind each particle
      const t = Math.min(1, s / 18), fade = Math.min(1, P[i * 3 + 2] / 2) * Math.min(1, (90 - P[i * 3 + 2]) / 5); const r = 0.55 + t * 0.45, gg = 0.85 - t * 0.45, bb = 1 - t * 0.85; col.set([r, gg, bb, 0, r, gg, bb, 0.95 * fade], i * 8);
      P[i * 3] = la1; P[i * 3 + 1] = ((lo1 + 540) % 360) - 180; if (P[i * 3 + 2] > 90 || Math.abs(la1) > 82 || s < 0.3 && Math.random() < 0.02) this.respawn(i);
    }
    this.windLines.geometry.attributes.position.needsUpdate = true; this.windLines.geometry.attributes.color.needsUpdate = true;
  }
  async loadSats() {
    if (!this.SJ) { try { this.SJ = await import('https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm'); } catch (e) { this.status.sats = 'Satellite library not reachable'; return; } }
    for (const [grp, on] of Object.entries(this.opt.sats)) {
      if (!on) { if (this.satObjs[grp]) this.satObjs[grp].visible = false; continue; } if (this.satObjs[grp]) this.satObjs[grp].visible = true;
      if (this.sats[grp] && Date.now() - this.sats[grp].at < 6 * 3600e3) continue;
      try {
        const txt = await (await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${grp}&FORMAT=tle`)).text(), L = txt.split(/\r?\n/).filter(Boolean), list = [];
        for (let i = 0; i + 2 < L.length + 1; i += 3) { if (!L[i + 2]) break; try { list.push({ name: L[i].trim(), rec: this.SJ.twoline2satrec(L[i + 1], L[i + 2]) }); } catch (e) { } }
        this.sats[grp] = { at: Date.now(), list }; this.buildSatObj(grp);
      } catch (e) { this.status.sats = 'Satellite data (CelesTrak) not reachable'; }
    }
    this.onInfo && this.onInfo();
  }
  // satellites we care most about get a label, their orbit, and (Earth observation) their ground track and swath
  special(grp, name) {
    const N = name.toUpperCase();
    if (grp === 'resource') { const m = N.match(/^(LANDSAT [89]|SENTINEL-\d[A-D]?)\b/); if (!m) return null; const k = m[1], sw = /LANDSAT/.test(k) ? 185 : /SENTINEL-2/.test(k) ? 290 : /SENTINEL-1/.test(k) ? 250 : /SENTINEL-3/.test(k) ? 1270 : /SENTINEL-5P/.test(N) ? 2600 : 0;
      return { label: k.replace('SENTINEL-', 'Sentinel-').replace('LANDSAT ', 'Landsat '), swath: sw, eo: true, optical: !/SENTINEL-1|SENTINEL-6/.test(k) }; }
    if (grp === 'gps-ops') { const m = N.match(/PRN (\d+)/); return { label: m ? 'GPS ' + m[1] : name, gps: true }; }
    if (grp === 'weather') { if (!/GOES|HIMAWARI|METEOSAT|FENGYUN|FY-|NOAA 2|METOP|SUOMI|GEO-KOMPSAT|INSAT|ELEKTRO/.test(N)) return null; return { label: name.replace(/\s*\(.*\)/, '').replace(/^(\w)(\w+)/, (a, b, c) => b + c.toLowerCase()) }; }
    if (grp === 'stations') { if (/ISS \(ZARYA\)/.test(N)) return { label: 'ISS' }; if (/CSS \(TIANHE\)/.test(N)) return { label: 'Tiangong' }; }
    return null;
  }
  buildSatObj(grp) {
    if (this.satObjs[grp]) { this.dyn.remove(this.satObjs[grp]); this.satObjs[grp].traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
    const [, col, sz] = SAT_GROUPS[grp], list = this.sats[grp].list, g = new THREE.Group(), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: sz, sizeAttenuation: false, depthWrite: false })); pts.frustumCulled = false; g.add(pts); g.userData.pts = pts; g.userData.sp = [];
    for (const s of list) { const sp0 = this.special(grp, s.name); if (!sp0) continue; s.sp = sp0;
      const c = document.createElement('canvas'); c.width = 320; c.height = 52; const x = c.getContext('2d'); x.font = `700 ${sp0.eo ? 32 : 26}px system-ui`; x.fillStyle = col; x.strokeStyle = '#000'; x.lineWidth = 6;
      if (sp0.eo) { x.beginPath(); x.arc(14, 26, 9, 0, 7); x.fill(); x.fillRect(0, 22, 28, 8); } x.strokeText(sp0.label, sp0.eo ? 34 : 6, 36); x.fillText(sp0.label, sp0.eo ? 34 : 6, 36);
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: true, transparent: true })); lab.center.set(sp0.eo ? 0.044 : -0.03, 0.5); lab.scale.set(sp0.eo ? 0.1 : 0.08, sp0.eo ? 0.01625 : 0.013, 1); lab.renderOrder = 31; g.add(lab);
      const orbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: sp0.eo ? 0.55 : grp === 'gps-ops' ? 0.18 : 0.3 })); g.add(orbit);
      const item = { s, lab, orbit }; if (sp0.eo) { item.track = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: col, dashSize: 0.004, gapSize: 0.003, transparent: true, opacity: 0.7 })); g.add(item.track);
        if (sp0.swath) { item.swath = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })); g.add(item.swath); } }
      g.userData.sp.push(item); }
    this.satObjs[grp] = g; this.dyn.add(g); g.userData.k = 0; g.userData.orbAt = 0;
    if (grp === 'resource') this.predictPasses();
  }
  ecf(rec, d) { const SJ = this.SJ, pv = SJ.propagate(rec, d); if (!pv || !pv.position) return null; return pv.position; }
  // orbit drawn as a fixed ring in space (seen at this moment), ground track and swath for the next orbit
  updateOrbits(g) {
    const SJ = this.SJ, now = new Date(), gm = SJ.gstime(now);
    for (const it of g.userData.sp) {
      const rec = it.s.rec, per = 2 * Math.PI / rec.no * 60e3, ring = [], trk = [], L = [], Rr = [];
      for (let k = 0; k <= 160; k++) { const d = new Date(now.getTime() + per * k / 160), e = this.ecf(rec, d); if (!e) continue; const f = SJ.eciToEcf(e, gm); ring.push(new THREE.Vector3(f.x / R_KM, f.z / R_KM, -f.y / R_KM)); }
      it.orbit.geometry.dispose(); it.orbit.geometry = new THREE.BufferGeometry().setFromPoints(ring);
      if (it.track) { for (let k = 0; k <= 200; k++) { const d = new Date(now.getTime() + per * k / 200), e = this.ecf(rec, d); if (!e) continue; const gd = SJ.eciToGeodetic(e, SJ.gstime(d)); trk.push([gd.latitude / D2R, gd.longitude / D2R]); }
        it.track.geometry.dispose(); it.track.geometry = new THREE.BufferGeometry().setFromPoints(trk.map(([la, lo]) => xyz(la, lo, 1.0012))); it.track.computeLineDistances();
        if (it.swath) { const hw = it.s.sp.swath / 2 / R_KM, pos = [], idx = [];
          trk.forEach(([la, lo], k) => { const p = xyz(la, lo), q = xyz(...(trk[Math.min(trk.length - 1, k + 1)])), o = xyz(...(trk[Math.max(0, k - 1)])), t = q.clone().sub(o).normalize(), side = new THREE.Vector3().crossVectors(p, t).normalize();
            for (const sg of [-1, 1]) { const v = p.clone().addScaledVector(side, sg * Math.tan(hw)).normalize().multiplyScalar(1.0011); pos.push(v.x, v.y, v.z); } if (k) { const a = (k - 1) * 2; if (Math.abs(lo - trk[k - 1][1]) < 90) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
          const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); it.swath.geometry.dispose(); it.swath.geometry = sg; } }
    }
  }
  satPos(rec, d) { const SJ = this.SJ, pv = SJ.propagate(rec, d); if (!pv || !pv.position) return null; const gd = SJ.eciToGeodetic(pv.position, SJ.gstime(d)); return xyz(gd.latitude / D2R, gd.longitude / D2R, 1 + gd.height / R_KM); }
  stepSats() {
    const d = new Date(), t = performance.now();
    for (const [grp, g] of Object.entries(this.satObjs)) {
      if (!g.visible) continue; const list = this.sats[grp].list, arr = g.userData.pts.geometry.attributes.position.array, n = list.length, chunk = n > 800 ? Math.ceil(n / 6) : n; // big groups are updated in slices
      for (let c = 0; c < chunk; c++) { const i = (g.userData.k + c) % n, p = this.satPos(list[i].rec, d); if (p) arr.set([p.x, p.y, p.z], i * 3); } g.userData.k = (g.userData.k + chunk) % n; g.userData.pts.geometry.attributes.position.needsUpdate = true;
      for (const it of g.userData.sp) { const p = this.satPos(it.s.rec, d); if (p) { it.lab.position.copy(p); it.pos = p; } }
      if (t - g.userData.orbAt > 30000) { g.userData.orbAt = t; this.updateOrbits(g); }
    }
    if (this.satObjs['gps-ops'] && this.satObjs['gps-ops'].visible && (!this._gpsT || t - this._gpsT > 5000)) { this._gpsT = t; this.gpsVisible(); }
  }
  // which GPS satellites your area sees now (elevation above 10°) – useful for DGPS survey
  gpsVisible() {
    const g = this.satObjs['gps-ops']; if (!g || this.lat == null) return; const site = xyz(this.lat, this.lon), up = site.clone().normalize(), vis = [];
    for (const it of g.userData.sp) { if (!it.pos) continue; const v = it.pos.clone().sub(site), el = Math.asin(v.dot(up) / v.length()) / D2R; if (el > 10) vis.push([it.s.sp.label.replace('GPS ', ''), Math.round(el)]); }
    vis.sort((a, b) => b[1] - a[1]); this.status.gps = `GPS seen from your area now: ${vis.length} (PRN ${vis.map(([p, e]) => `${p}·${e}°`).join(', ')})`;
  }
  // next passes of Landsat / Sentinel over your area (within the swath), for the next 5 days
  predictPasses() {
    const g = this.satObjs.resource; if (!g || this.lat == null) return; const SJ = this.SJ, site = xyz(this.lat, this.lon), items = g.userData.sp.filter(i => i.s.sp.swath), out = [], t0 = Date.now(), step = 20e3, end = t0 + 10 * 864e5;
    const sunUp = d => { const [sl, so] = sunLatLon(d); return xyz(sl, so).dot(site) > 0.1; };
    let k = 0; const work = () => {
      const it = items[k]; if (!it) { out.sort((a, b) => a.t - b.t); this.passes = out; this.status.passes = out.length ? 'Next imaging passes over your area (local time; optical in daylight only): ' + out.slice(0, 10).map(p => `${p.name} – ${p.when}`).join(' · ') : 'No Landsat / Sentinel pass over your area in the next 10 days'; this.onInfo && this.onInfo(); return; }
      const hw = it.s.sp.swath / 2 / R_KM; let inPass = false, got = 0;
      for (let t = t0; t < end && got < 2; t += step) { const d = new Date(t), e = this.ecf(it.s.rec, d); if (!e) break; const gd = SJ.eciToGeodetic(e, SJ.gstime(d)), ang = xyz(gd.latitude / D2R, gd.longitude / D2R).angleTo(site);
        if (ang < hw) { if (!inPass) { inPass = true; const dark = !sunUp(d); if (it.s.sp.optical && dark) continue; got++; const dt = (t - t0) / 3600e3, loc = new Date(t + 7 * 3600e3), W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][loc.getUTCDay()], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][loc.getUTCMonth()];
          out.push({ name: it.s.sp.label, t, dark, when: (dt < 24 ? `in ${Math.floor(dt)} h ${Math.round((dt % 1) * 60)} min, ` : '') + `${W} ${loc.getUTCDate()} ${M} ${loc.toISOString().slice(11, 16)}` }); } } else inPass = false; }
      k++; setTimeout(work, 0); };
    work();
  }
  async loadFlights() {
    const rd = this.w.radar, proxy = rd ? rd.proxy : (localStorage.getItem('cambodia3d.flightProxy') || '');
    if (proxy) try { const u = 'https://opensky-network.org/api/states/all', url = proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(u)) : proxy + encodeURIComponent(u), j = await (await fetch(url)).json();
      // lat, lon, alt m, heading °, speed m/s, call sign
      this.flightsLive = (j.states || []).filter(s => s[5] != null && s[6] != null && !s[8]).map(s => ({ lat: s[6], lon: s[5], alt: s[13] ?? s[7] ?? 0, trk: s[10] || 0, gs: s[9] || 0, cs: (s[1] || '').trim() })); this.liveT = Date.now();
      this.status.flights = `Flights: ${this.flightsLive.length.toLocaleString()} aircraft live (OpenSky)`; this.onInfo && this.onInfo(); return; }
    catch (e) { this.status.flights = 'World flights not reachable through your proxy – showing simulated traffic'; }
    else this.status.flights = 'Simulated world air traffic (for live flights add your proxy in the radar panel)';
    this.flightsLive = null; if (!this.simF) this.seedFlights(); this.onInfo && this.onInfo();
  }
  // simulated traffic on great-circle routes between big airports
  seedFlights() {
    const A = [[13.69, 100.75], [11.55, 104.84], [11.36, 104.93], [13.37, 104.22], [10.82, 106.65], [21.22, 105.81], [1.36, 103.99], [3.12, 101.55], [-6.13, 106.66], [22.31, 113.91], [31.14, 121.81], [40.08, 116.6], [35.55, 139.78], [37.46, 126.44], [25.08, 121.23], [14.51, 121.02], [25.25, 55.36], [25.27, 51.61], [28.56, 77.1], [19.09, 72.87], [12.95, 77.67], [51.47, -0.45], [49.01, 2.55], [50.04, 8.56], [52.31, 4.76], [41.28, 28.75], [55.97, 37.41], [-33.94, 151.18], [-37.67, 144.84], [-36.85, 174.79], [33.94, -118.41], [37.62, -122.38], [40.64, -73.78], [41.98, -87.9], [33.64, -84.43], [25.79, -80.29], [49.19, -123.18], [43.68, -79.63], [19.44, -99.07], [-23.43, -46.47], [-34.82, -58.54], [-33.94, 18.6], [30.12, 31.41], [6.58, 3.32], [-1.32, 36.93], [9.03, 38.8], [21.68, 39.16], [24.44, 54.65], [64.13, -21.94], [61.17, -150.0]];
    const near = A.slice(0, 16); this.simF = [];
    for (let k = 0; k < 420; k++) { const a = k < 140 ? near[(Math.random() * near.length) | 0] : A[(Math.random() * A.length) | 0]; let b; do { b = A[(Math.random() * A.length) | 0]; } while (b === a);
      const pa = xyz(a[0], a[1]), pb = xyz(b[0], b[1]), ang = pa.angleTo(pb); if (ang < 0.03) { k--; continue; } this.simF.push({ pa, pb, ang, f: Math.random(), v: 245 / 6371000 / ang, cs: ['KME', 'CMB', 'AIQ', 'TGW', 'SIA', 'CPA', 'UAE', 'QTR', 'THA', 'VJC', 'ANA', 'JAL', 'KAL', 'BAW', 'AFR', 'DLH', 'UAL', 'AAL', 'DAL', 'QFA'][(Math.random() * 20) | 0] + ((Math.random() * 900 + 100) | 0) }); }
    this.routesDirty = true;
  }
  slerp(pa, pb, ang, f) { const s = Math.sin(ang); return pa.clone().multiplyScalar(Math.sin((1 - f) * ang) / s).add(pb.clone().multiplyScalar(Math.sin(f * ang) / s)); }
  planeMat() {
    const c = document.createElement('canvas'), S = 64; c.width = c.height = S; const g = c.getContext('2d'); g.translate(S / 2, S / 2); g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(0, -28); g.lineTo(4, -18); g.lineTo(4, -5); g.lineTo(27, 6); g.lineTo(27, 10); g.lineTo(4, 4); g.lineTo(3, 18); g.lineTo(10, 25); g.lineTo(10, 28); g.lineTo(0, 25); g.lineTo(-10, 28); g.lineTo(-10, 25); g.lineTo(-3, 18); g.lineTo(-4, 4); g.lineTo(-27, 10); g.lineTo(-27, 6); g.lineTo(-4, -5); g.lineTo(-4, -18); g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(c);
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: t }, size: { value: 15 * Math.min(2, devicePixelRatio) } },
      vertexShader: `attribute vec3 hdg; attribute vec3 col; varying float vA; varying vec3 vC; uniform float size;
        void main(){ vec4 p0 = projectionMatrix * modelViewMatrix * vec4(position,1.0); vec4 p1 = projectionMatrix * modelViewMatrix * vec4(position + hdg * 0.01, 1.0);
          vec2 d = p1.xy / p1.w - p0.xy / p0.w; d.x *= projectionMatrix[1][1] / projectionMatrix[0][0]; vA = atan(d.y, d.x) - 1.5707963; vC = col; gl_Position = p0; gl_PointSize = size; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec2 q = gl_PointCoord - 0.5; q.y = -q.y; float c = cos(-vA), s = sin(-vA); vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          vec4 t = texture2D(map, r + 0.5); if (t.a < 0.3 || abs(r.x) > 0.5 || abs(r.y) > 0.5) discard; gl_FragColor = vec4(vC, t.a); }` });
  }
  stepFlights(dt) {
    const N = 40000; if (!this.flPts) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); geo.setAttribute('hdg', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); geo.setAttribute('col', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      this.flPts = new THREE.Points(geo, this.planeMat()); this.flPts.frustumCulled = false; this.flPts.renderOrder = 25; this.scene.add(this.flPts); }
    const on = this.opt.flights; this.flPts.visible = on; if (this.routes) this.routes.visible = on && !this.flightsLive; if (!on) return;
    const P = this.flPts.geometry.attributes.position.array, Hd = this.flPts.geometry.attributes.hdg.array, Cl = this.flPts.geometry.attributes.col.array; let n = 0;
    const put = (p, h, c) => { if (n >= N) return; P.set([p.x, p.y, p.z], n * 3); Hd.set([h.x, h.y, h.z], n * 3); Cl.set(c, n * 3); n++; };
    if (this.flightsLive) { const el = (Date.now() - this.liveT) / 1000; for (const f of this.flightsLive) { const a = f.trk * D2R, d = f.gs * el, la = f.lat + Math.cos(a) * d / 111000, lo = f.lon + Math.sin(a) * d / (111000 * Math.max(0.1, Math.cos(f.lat * D2R)));
        const p = xyz(la, lo, 1.003 + f.alt / 1000 / R_KM * 8), nth = xyz(la + 0.1, lo, 1.003).sub(xyz(la, lo, 1.003)).normalize(), est = xyz(la, lo + 0.1, 1.003).sub(xyz(la, lo, 1.003)).normalize(); put(p, nth.multiplyScalar(Math.cos(a)).add(est.multiplyScalar(Math.sin(a))), [1, 0.82, 0.25]); } }
    else if (this.simF) {
      if (this.routesDirty) { this.routesDirty = false; if (this.routes) { this.scene.remove(this.routes); this.routes.geometry.dispose(); } const pts = [];
        for (const f of this.simF) { const m = Math.max(8, Math.ceil(f.ang * 40)); for (let k = 0; k < m; k++) { const a = this.slerp(f.pa, f.pb, f.ang, k / m).multiplyScalar(1.004), b = this.slerp(f.pa, f.pb, f.ang, (k + 1) / m).multiplyScalar(1.004); pts.push(a, b); } }
        this.routes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, depthWrite: false })); this.scene.add(this.routes); }
      for (const f of this.simF) { f.f += f.v * dt * 60; if (f.f >= 1) { f.f = 0; [f.pa, f.pb] = [f.pb, f.pa]; } const h = Math.sin(Math.PI * f.f), pu = this.slerp(f.pa, f.pb, f.ang, f.f), qu = this.slerp(f.pa, f.pb, f.ang, f.f + 0.001), p = pu.clone().multiplyScalar(1.004 + 0.0015 * Math.min(1, h * 6));
        put(p, qu.sub(pu).normalize(), [1, 0.82, 0.25]); } } // heading = direction of travel along the route }
    // the radar's own aircraft (simulated or live) near your area
    const rd = this.w.radar; if (rd && rd.placed) for (const t of rd.targets.values()) { if (t.src === 'sim' && this.flightsLive) continue; const a = t.trk * D2R, p = xyz(t.lat, t.lon, 1.002 + t.alt / 1000 / R_KM * 8), nth = xyz(t.lat + 0.1, t.lon).sub(xyz(t.lat, t.lon)).normalize(), est = xyz(t.lat, t.lon + 0.1).sub(xyz(t.lat, t.lon)).normalize();
      put(p, nth.multiplyScalar(Math.cos(a)).add(est.multiplyScalar(Math.sin(a))), t.det ? [0.35, 1, 0.55] : [0.6, 0.7, 0.6]); }
    this.flPts.geometry.setDrawRange(0, n); for (const k of ['position', 'hdg', 'col']) this.flPts.geometry.attributes[k].needsUpdate = true; this.nFlights = n;
  }
  // the radar keeps scanning on the globe: real range, sweep and the targets it paints
  stepRadar() {
    const rd = this.w.radar, on = this.opt.radar && rd && rd.placed; if (!on) { if (this.radarG) this.radarG.visible = false; return; }
    const R = rd.range * 1000, key = rd.lat.toFixed(4) + rd.lon.toFixed(4) + R;
    if (this.radarKey !== key) { this.radarKey = key; if (this.radarG) { this.scene.remove(this.radarG); this.radarG.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      const G0 = this.radarG = new THREE.Group(), circ = r => { const pts = []; for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2, [la, lo] = rd.ll(Math.sin(a) * r, Math.cos(a) * r); pts.push(xyz(la, lo, 1.0035)); } return pts; };
      for (let k = 1; k <= 4; k++) G0.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circ(R * k / 4)), new THREE.LineBasicMaterial({ color: 0x33ff66, transparent: true, opacity: k === 4 ? 0.8 : 0.35 })));
      // sweep wedge in the local tangent plane, fading behind the beam
      const pos = [], col = [], c0 = xyz(rd.lat, rd.lon, 1.0036), M = 40, W = 0.6; for (let k = 0; k < M; k++) { const a0 = -W * k / M, a1 = -W * (k + 1) / M, f0 = 1 - k / M, f1 = 1 - (k + 1) / M;
        const [la0, lo0] = rd.ll(Math.sin(a0) * R, Math.cos(a0) * R), [la1, lo1] = rd.ll(Math.sin(a1) * R, Math.cos(a1) * R), p0 = xyz(la0, lo0, 1.0036), p1 = xyz(la1, lo1, 1.0036);
        pos.push(c0.x, c0.y, c0.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); col.push(0.2, 1, 0.4, f0 * 0.55, 0.2, 1, 0.4, f0 * 0.55, 0.2, 1, 0.4, f1 * 0.55); }
      // build the wedge around the radar so it can be turned about the local vertical
      const gW = new THREE.BufferGeometry(); gW.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v, i) => v - [c0.x, c0.y, c0.z][i % 3]), 3)); gW.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      const wedge = new THREE.Mesh(gW, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })); const piv = new THREE.Group(); piv.position.copy(c0); piv.add(wedge); G0.add(piv); this.radarPiv = piv; this.radarUp = c0.clone().normalize();
      this.radarLab = []; this.scene.add(G0); }
    this.radarG.visible = true; this.radarPiv.quaternion.setFromAxisAngle(this.radarUp, -rd.az);
    // labels of detected aircraft
    const det = rd.list().slice(0, 12); while (this.radarLab.length < det.length) { const c = document.createElement('canvas'); c.width = 256; c.height = 40; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: true, transparent: true })); sp.center.set(-0.08, 0.5); sp.scale.set(0.075, 0.0117, 1); sp.renderOrder = 33; sp.userData.c = c; this.radarG.add(sp); this.radarLab.push(sp); }
    this.radarLab.forEach((sp, i) => { const t = det[i]; sp.visible = !!t && this.cam.position.length() < 2.2; if (!t) return; sp.position.copy(xyz(t.lat, t.lon, 1.003 + t.alt / 1000 / R_KM * 8)); const txt = `${t.flight || t.type} FL${Math.round(t.alt / 0.3048 / 100)}`;
      if (sp.userData.t !== txt) { sp.userData.t = txt; const x = sp.userData.c.getContext('2d'); x.clearRect(0, 0, 256, 40); x.font = '700 26px ui-monospace, monospace'; x.fillStyle = '#7dffa0'; x.strokeStyle = '#000'; x.lineWidth = 5; x.strokeText(txt, 4, 30); x.fillText(txt, 4, 30); sp.material.map.needsUpdate = true; } });
  }
  // high-resolution imagery (Esri World Imagery tiles) laid on the globe when you come close
  tileMesh(z, x, y) {
    const n = z < 8 ? 16 : 6, N = 2 ** z, pos = [], uv = [], idx = [], r = 1.0001;
    for (let j = 0; j <= n; j++) { const my = y + j / n, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my / N))) / D2R; for (let i = 0; i <= n; i++) { const lon = (x + i / n) / N * 360 - 180, p = xyz(lat, lon, r); pos.push(p.x, p.y, p.z); uv.push(i / n, 1 - j / n); } }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ depthWrite: false })); m.renderOrder = 1 + z; m.visible = false; return m;
  }
  updateTiles(alt) {
    const now = performance.now(), want = new Set(), c = this.cam.position.clone().normalize(), lat = Math.asin(c.y) / D2R, lon = Math.atan2(-c.z, c.x) / D2R;
    const zf = Math.round(Math.log2(1 / Math.max(alt, 1e-4)) + 4.2), z = Math.min(18, zf);
    if (z >= 5 && Math.abs(lat) < 84) {
      for (const [zz, rad] of [[z, 3], [Math.max(4, z - 3), 1]]) { const N = 2 ** zz, tx = Math.floor((lon + 180) / 360 * N), ty = Math.floor((1 - Math.log(Math.tan((45 + lat / 2) * D2R)) / Math.PI) / 2 * N);
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const y = ty + dy, x = ((tx + dx) % N + N) % N; if (y < 0 || y >= N) continue; want.add(`${zz}/${x}/${y}`); } }
    }
    for (const k of want) { let t = this.tiles.get(k); if (!t) { const [zz, x, y] = k.split('/').map(Number), m = this.tileMesh(zz, x, y); this.scene.add(m); t = { m, last: now }; this.tiles.set(k, t);
        const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { const tx = new THREE.Texture(im); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; tx.needsUpdate = true; m.material.map = tx; m.material.needsUpdate = true; m.visible = true; };
        im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zz}/${y}/${x}`; } t.last = now; t.m.userData.want = true; }
    for (const [k, t] of this.tiles) { const keep = want.has(k); if (!keep && t.m.visible && now - t.last < 1500) continue; if (!keep) { this.scene.remove(t.m); t.m.geometry.dispose(); if (t.m.material.map) t.m.material.map.dispose(); t.m.material.dispose(); this.tiles.delete(k); } }
    this.status.hires = z >= 5 ? `Imagery: Esri World Imagery, zoom level ${z}` : '';
  }
  /* ---------- per frame ---------- */
  frame(dt) {
    const w = this.w, el = w.renderer.domElement, asp = el.clientWidth / Math.max(1, el.clientHeight); if (this.cam.aspect !== asp) { this.cam.aspect = asp; this.cam.updateProjectionMatrix(); }
    if (this.sv && this.sv.active) { this.sv.frame(dt); return; }
    if (this.cos && this.cos.active) { this.cos.frame(dt); return; }
    if (this.followSat && !this.anim) { const p = this.satPos(this.followSat.rec, new Date()); if (p) { const d = this.cam.position.length(); this.cam.position.lerp(p.clone().setLength(d), Math.min(1, dt * 2)); this.satCardUpd(); } }
    if (this.anim) { const A = this.anim; A.t = Math.min(1, A.t + dt / 2.2); const e = A.t * A.t * (3 - 2 * A.t), d = A.from + (A.to - A.from) * e;
      const dir = A.out ? A.start.clone().lerp(A.dir, e).normalize() : A.dir.clone(); this.cam.position.copy(dir.multiplyScalar(d)); if (A.t >= 1) { this.anim = null; if (A.out) { this.finishLeave(); return; } } }
    else { this.ctl.rotateSpeed = Math.min(1, (this.cam.position.length() - 1) * 0.5); this.ctl.zoomSpeed = 0.8; this.ctl.update();
      // zooming right down onto the plate brings you back to the 3D scene
      if (this.plate && this.cam.position.length() < 1.0012 && this.cam.position.clone().normalize().angleTo(this.plate.position.clone().normalize()) < this.plateReal * 0.8) this.leave(); }
    const [sl, so] = sunLatLon(); const s = xyz(sl, so); this.U.sun.value.copy(s); this.U.nightOn.value = this.opt.night ? 1 : 0; this.sunL.position.copy(s.clone().multiplyScalar(10));
    this.clouds.visible = this.opt.clouds; this.clouds.rotation.y += dt * 0.0; this.stepWind(Math.min(dt, 0.05)); if (this.SJ) this.stepSats(); this.stepFlights(Math.min(dt, 0.1)); this.stepRadar();
    if (this.temp) this.temp.visible = this.opt.temp; if (this.rain) this.rain.visible = this.opt.rain; if (this.storms) this.storms.visible = this.opt.storms;
    if ((this.opt.wind || this.opt.temp) && this.cam.position.length() < 2.2 && (!this._detT || performance.now() - this._detT > 4000)) { this._detT = performance.now(); this.loadDetail(); }
    const dd = this.cam.position.length(), alt = dd - 1; if (this.plate) this.plate.scale.setScalar(Math.max(1, alt * 0.012 / this.plateReal));
    this.cam.near = Math.max(0.00005, alt * 0.4); this.cam.far = 60; this.cam.updateProjectionMatrix(); this.rimU.k.value = Math.min(1, alt / 0.08);
    if (!this._tileT || performance.now() - this._tileT > 400) { this._tileT = performance.now(); this.updateTiles(alt); }
    if (this.cos) { this.cos.renderBackground(this.cam); const r = w.renderer, ac = r.autoClear; r.autoClear = false; r.clearDepth(); r.render(this.scene, this.cam); r.autoClear = ac; }
    else w.renderer.render(this.scene, this.cam);
  }
  /* ---------- tap a satellite: card, and the view follows it ---------- */
  satEvents() {
    const el = this.w.renderer.domElement; let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, performance.now()]; });
    el.addEventListener('pointerup', e => { if (!this.on || !down || (this.cos && this.cos.active) || (this.sv && this.sv.active) || this.anim) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || performance.now() - down[2] > 500; down = null; if (moved) return;
      if (this.cos && this.cos.pick(e, true)) return; const s = this.pickSat(e); if (s) { this.followSat = s; this.satCard(s); const p = this.satPos(s.rec, new Date()); if (p) { const alt = p.length() - 1; this.anim = { t: 0, from: this.cam.position.length(), to: 1 + Math.max(alt * 2.2, alt + 0.25), dir: p.clone().normalize() }; } } });
  }
  pickSat(e) { const hidden = (c, p) => { const d = p.clone().sub(c), a = d.lengthSq(), b = 2 * c.dot(d), cc = c.lengthSq() - 1, disc = b * b - 4 * a * cc; if (disc < 0) return false; const t1 = (-b - Math.sqrt(disc)) / (2 * a); return t1 > 0 && t1 < 1; }; const r = this.w.renderer.domElement.getBoundingClientRect(), d = new Date(), v = new THREE.Vector3(), camD = this.cam.position.length(); let best = null, bd = 14;
    for (const [grp, g] of Object.entries(this.satObjs)) { if (!g.visible) continue; const list = this.sats[grp].list, arr = g.userData.pts.geometry.attributes.position.array;
      const C = this.cam.position; for (let i = 0; i < list.length; i++) { v.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]); if (!v.lengthSq()) continue; if (hidden(C, v)) continue;
        v.project(this.cam); if (v.z > 1) continue; const sx = (v.x + 1) / 2 * r.width + r.left, sy = (1 - v.y) / 2 * r.height + r.top, dd = Math.hypot(sx - e.clientX, sy - e.clientY) - (list[i].sp ? 6 : 0); if (dd < bd) { bd = dd; best = list[i]; best.grp = grp; } } }
    return best; }
  satCard(s) { let c = document.getElementById('satCard'); if (!s) { if (c) c.hidden = true; return; } if (!c) { c = document.createElement('div'); c.id = 'satCard'; c.className = 'satCard'; document.body.appendChild(c); } c.hidden = false; this.satCardUpd(); }
  satCardUpd() { const s = this.followSat, c = document.getElementById('satCard'); if (!s || !c || c.hidden) return; const now = performance.now(); if (this._scT && now - this._scT < 900) return; this._scT = now;
    const SJ = this.SJ, d = new Date(), pv = SJ.propagate(s.rec, d); if (!pv || !pv.position) return; const gd = SJ.eciToGeodetic(pv.position, SJ.gstime(d)), v = pv.velocity, sp = Math.hypot(v.x, v.y, v.z), per = 2 * Math.PI / s.rec.no;
    c.innerHTML = `<div class="cosCh"><b style="color:${SAT_GROUPS[s.grp] ? SAT_GROUPS[s.grp][1] : '#fff'}">🛰️ ${s.sp ? s.sp.label : s.name}</b><button id="satX">✕</button></div><div class="cosK">${SAT_GROUPS[s.grp] ? SAT_GROUPS[s.grp][0] : ''}${s.sp && s.sp.label !== s.name ? ' · ' + s.name : ''}</div>
      <div>⬆️ ${Math.round(gd.height).toLocaleString()} km · 💨 ${sp.toFixed(2)} km/s (${Math.round(sp * 3600).toLocaleString()} km/h)</div><div>🔄 ${per.toFixed(1)} min · ∠ ${(s.rec.inclo / D2R).toFixed(1)}° · 📍 ${(gd.latitude / D2R).toFixed(2)}°, ${(gd.longitude / D2R).toFixed(2)}°</div><div class="cosInfo">${t('The view follows it. Drag or tap ✕ to stop.')}</div><div class="row" style="margin-top:6px"><button id="satClose" class="primary" style="margin:0">🔭 ${t('3D close-up')}${/ISS/.test(s.name) ? ' · ' + t('go inside') : ''}</button></div>`;
    c.querySelector('#satX').onclick = () => { this.followSat = null; this.satCard(null); };
    c.querySelector('#satClose').onclick = async () => { if (!this.sv) { const M = await import('./satview.js?v=88'); this.sv = new M.SatView(this); } this.satCard(null); this.sv.onClose = () => { if (this.followSat) this.satCard(this.followSat); }; this.sv.open(s); }; }
  info() { const d = new Date(); return { utc: d.toISOString().slice(11, 16), ...this.status, radar: this.w.radar && this.w.radar.placed ? `Radar: ${this.w.radar.range} km, ${this.w.radar.list().length} aircraft detected` : '', sats: Object.entries(this.sats).filter(([g]) => this.opt.sats[g]).map(([g, v]) => `${SAT_GROUPS[g][0]} ${v.list.length}`).join(' · '), flights: this.status.flights || (this.nFlights ? `Aircraft: ${this.nFlights} from the radar` : '') }; }
}
export { SAT_GROUPS };
