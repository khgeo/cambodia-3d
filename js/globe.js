// Whole-Earth view: zoom out from the 3D plate to the globe and see where it sits, with live data:
// day/night from the real sun position, clouds from geostationary satellites (NASA GIBS: Himawari, GOES-East,
// GOES-West infrared), wind from Open-Meteo, satellites from CelesTrak orbital elements, and aircraft from the radar
// or (with your proxy) OpenSky.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const R_KM = 6371, D2R = Math.PI / 180;
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&FORMAT=';
const SAT_GROUPS = { stations: ['Space stations', '#ffffff', 3.5], visual: ['Brightest', '#ffe680', 2.2], 'gps-ops': ['GPS', '#7fd1ff', 2.4], weather: ['Weather', '#9cff9c', 2.4], starlink: ['Starlink', '#c8a0ff', 1.2] };
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
    this.w = world; this.on = false; this.opt = { clouds: true, night: true, wind: true, flights: true, sats: { stations: true, visual: true, 'gps-ops': false, weather: false, starlink: false } };
    const sc = this.scene = new THREE.Scene(); sc.background = new THREE.Color(0x02040a);
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.001, 200);
    this.ctl = new OrbitControls(this.cam, world.renderer.domElement); this.ctl.enabled = false; this.ctl.enablePan = false; this.ctl.minDistance = 1.015; this.ctl.maxDistance = 9; this.ctl.enableDamping = true; this.ctl.dampingFactor = 0.08;
    // stars
    { const N = 4000, p = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(80); p.set([v.x, v.y, v.z], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); sc.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }))); }
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
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 48), new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * f * 1.4; }' })));
    this.sunL = new THREE.DirectionalLight(0xffffff, 2.2); sc.add(this.sunL, new THREE.AmbientLight(0xffffff, 0.35));
    this.dyn = new THREE.Group(); sc.add(this.dyn);
    this.satObjs = {}; this.sats = {}; this.status = {};
  }
  /* ---------- the plate on the globe ---------- */
  placePlate() {
    const w = this.w, D = w.D; if (!D) return; if (this.plate) { this.scene.remove(this.plate); }
    const a = D.aoi, lat = (a.s + a.n) / 2, lon = (a.w + a.e) / 2; this.lat = lat; this.lon = lon;
    const g = new THREE.Group(), real = Math.max(D.W, D.H) / 1000 / R_KM, S = Math.max(real, 0.006);
    const top = new THREE.MeshBasicMaterial({ map: w.texSat }), side = new THREE.MeshBasicMaterial({ color: 0x8a7a5c });
    const box = new THREE.Mesh(new THREE.BoxGeometry(S, S * 0.12, S), [side, side, top, side, side, side]); box.position.y = S * 0.06; g.add(box);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 0.025, 6).translate(0, 0.0125, 0), new THREE.MeshBasicMaterial({ color: 0xffb547 })); g.add(pin);
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
    const p = xyz(this.lat, this.lon, 1); this.cam.position.copy(p.clone().multiplyScalar(1.03)); this.ctl.target.set(0, 0, 0); this.ctl.update();
    this.anim = { t: 0, from: 1.03, to: 3.4, dir: p.clone().normalize() }; this.onToggle && this.onToggle(true);
    if (!this.loaded) { this.loaded = true; this.loadBase(); }
    this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => this.refresh(), 60000);
  }
  leave() {
    if (!this.on || (this.anim && this.anim.out)) return; const p = xyz(this.lat, this.lon, 1).normalize(), d = this.cam.position.length();
    this.anim = { t: 0, from: d, to: 1.02, dir: p, start: this.cam.position.clone().normalize(), out: true };
  }
  finishLeave() { const w = this.w; this.on = false; this.ctl.enabled = false; w.controls.enabled = true; clearInterval(this.timer); w.clock.getDelta(); this.onToggle && this.onToggle(false); }
  /* ---------- data ---------- */
  async loadBase() {
    const W = 4096, H = 2048;
    loadImg(GIBS + `image/jpeg&WIDTH=${W}&HEIGHT=${H}&LAYERS=BlueMarble_ShadedRelief_Bathymetry`).then(i => { const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; this.U.day.value = t; }).catch(() => this.status.base = 'Base map not reachable');
    loadImg(GIBS + `image/jpeg&WIDTH=${W}&HEIGHT=${H}&LAYERS=VIIRS_Black_Marble&TIME=2016-01-01`).then(i => { const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; this.U.night.value = t; }).catch(() => { });
  }
  refresh() { if (this.opt.clouds) this.loadClouds(); if (this.opt.wind) this.loadWind(); this.loadSats(); if (this.opt.flights) this.loadFlights(); }
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
  async loadWind() {
    if (this.windAt && Date.now() - this.windAt < 30 * 60e3) return; this.windAt = Date.now();
    const lats = [], lons = []; for (let la = -80; la <= 80; la += 10) for (let lo = -180; lo < 180; lo += 10) { lats.push(la); lons.push(lo); }
    const NX = 36, NY = 17, U = new Float32Array(NX * NY), V = new Float32Array(NX * NY);
    try {
      for (let s = 0; s < lats.length; s += 210) { const la = lats.slice(s, s + 210), lo = lons.slice(s, s + 210);
        const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`)).json();
        (Array.isArray(j) ? j : [j]).forEach((r, k) => { const i = s + k, sp = r.current.wind_speed_10m, dr = r.current.wind_direction_10m * D2R; U[i] = -sp * Math.sin(dr); V[i] = -sp * Math.cos(dr); }); }
      this.wind = { U, V, NX, NY }; this.status.wind = 'Wind: Open-Meteo, 10 m above ground, now'; this.initParticles();
    } catch (e) { this.status.wind = 'Wind not reachable'; this.windAt = 0; } this.onInfo && this.onInfo();
  }
  windAt_(lat, lon) { const W = this.wind, fx = ((lon + 180) / 10) % W.NX, fy = Math.max(0, Math.min(W.NY - 1.001, (lat + 80) / 10)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = (x0 + 1) % W.NX, tx = fx - x0, ty = fy - y0;
    const g = (A, x, y) => A[y * W.NX + x], b = A => (g(A, x0, y0) * (1 - tx) + g(A, x1, y0) * tx) * (1 - ty) + (g(A, x0, y0 + 1) * (1 - tx) + g(A, x1, y0 + 1) * tx) * ty; return [b(W.U), b(W.V)]; }
  initParticles() {
    if (this.windLines) { this.dyn.remove(this.windLines); this.windLines.geometry.dispose(); }
    const N = this.nP = 5000, pos = new Float32Array(N * 6), col = new Float32Array(N * 8); this.P = new Float32Array(N * 3); // lat, lon, age
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
      P[i * 3 + 2] += dt; const Tt = 22000, a = xyz(la - v * Tt / 111000, lo - u * Tt / (111000 * Math.max(0.2, Math.cos(la * D2R))), 1.008), b = xyz(la1, lo1, 1.008); pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); // short streak behind each particle
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
  buildSatObj(grp) {
    if (this.satObjs[grp]) { this.dyn.remove(this.satObjs[grp]); this.satObjs[grp].traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const [, col, sz] = SAT_GROUPS[grp], list = this.sats[grp].list, g = new THREE.Group(), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: sz, sizeAttenuation: false, depthWrite: false })); pts.frustumCulled = false; g.add(pts); g.userData.pts = pts;
    if (grp === 'stations') { g.userData.labels = []; for (const s of list.filter(s => /ISS \(ZARYA\)|CSS \(TIANHE\)|TIANGONG/.test(s.name)).slice(0, 3)) { const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.font = '700 28px system-ui'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 5; const n = s.name.includes('ISS') ? 'ISS' : 'Tiangong'; x.strokeText(n, 6, 34); x.fillText(n, 6, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true })); sp.center.set(-0.05, 0.5); sp.scale.set(0.08, 0.015, 1); sp.renderOrder = 31; g.add(sp); g.userData.labels.push([s, sp]);
      // one orbit ahead
      const orb = [], now = Date.now(); for (let k = 0; k <= 120; k++) { const p = this.satPos(s.rec, new Date(now + k * 46e3)); if (p) orb.push(p); } g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(orb), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }))); } }
    this.satObjs[grp] = g; this.dyn.add(g); g.userData.k = 0;
  }
  satPos(rec, d) { const SJ = this.SJ, pv = SJ.propagate(rec, d); if (!pv || !pv.position) return null; const gd = SJ.eciToGeodetic(pv.position, SJ.gstime(d)); return xyz(gd.latitude / D2R, gd.longitude / D2R, 1 + gd.height / R_KM); }
  stepSats() {
    const d = new Date();
    for (const [grp, g] of Object.entries(this.satObjs)) {
      if (!g.visible) continue; const list = this.sats[grp].list, arr = g.userData.pts.geometry.attributes.position.array, n = list.length, chunk = n > 800 ? Math.ceil(n / 6) : n; // big groups are updated in slices
      for (let c = 0; c < chunk; c++) { const i = (g.userData.k + c) % n, p = this.satPos(list[i].rec, d); if (p) arr.set([p.x, p.y, p.z], i * 3); } g.userData.k = (g.userData.k + chunk) % n; g.userData.pts.geometry.attributes.position.needsUpdate = true;
      for (const [s, sp] of g.userData.labels || []) { const p = this.satPos(s.rec, d); if (p) sp.position.copy(p); }
    }
  }
  async loadFlights() {
    const rd = this.w.radar, proxy = rd ? rd.proxy : (localStorage.getItem('cambodia3d.flightProxy') || '');
    if (!proxy) { this.flightsLive = null; this.status.flights = 'World flights need your proxy (see the radar panel); the radar\'s aircraft are shown.'; return; }
    try { const u = 'https://opensky-network.org/api/states/all', url = proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(u)) : proxy + encodeURIComponent(u), j = await (await fetch(url)).json();
      this.flightsLive = (j.states || []).filter(s => s[5] != null && s[6] != null).map(s => [s[6], s[5], s[13] ?? s[7] ?? 0]); this.status.flights = `Flights: ${this.flightsLive.length.toLocaleString()} aircraft (OpenSky)`; }
    catch (e) { this.status.flights = 'World flights not reachable through your proxy'; }
    this.onInfo && this.onInfo();
  }
  stepFlights() {
    const rd = this.w.radar, src = this.flightsLive || (rd && rd.placed ? [...rd.targets.values()].map(t => [t.lat, t.lon, t.alt]) : []);
    if (!this.flPts) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30000 * 3), 3)); this.flPts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd23f, size: 2.2, sizeAttenuation: false, depthWrite: false })); this.flPts.frustumCulled = false; this.dyn.add(this.flPts); }
    this.flPts.visible = this.opt.flights; if (!this.opt.flights) return; const a = this.flPts.geometry.attributes.position.array, n = Math.min(30000, src.length);
    for (let i = 0; i < n; i++) { const [la, lo, al] = src[i], p = xyz(la, lo, 1.002 + al / 1000 / R_KM * 10); a.set([p.x, p.y, p.z], i * 3); } this.flPts.geometry.setDrawRange(0, n); this.flPts.geometry.attributes.position.needsUpdate = true; this.nFlights = n;
  }
  /* ---------- per frame ---------- */
  frame(dt) {
    const w = this.w, el = w.renderer.domElement, asp = el.clientWidth / Math.max(1, el.clientHeight); if (this.cam.aspect !== asp) { this.cam.aspect = asp; this.cam.updateProjectionMatrix(); }
    if (this.anim) { const A = this.anim; A.t = Math.min(1, A.t + dt / 2.2); const e = A.t * A.t * (3 - 2 * A.t), d = A.from + (A.to - A.from) * e;
      const dir = A.out ? A.start.clone().lerp(A.dir, e).normalize() : A.dir.clone(); this.cam.position.copy(dir.multiplyScalar(d)); if (A.t >= 1) { this.anim = null; if (A.out) { this.finishLeave(); return; } } }
    else { this.ctl.rotateSpeed = Math.min(1, (this.cam.position.length() - 1) * 0.5); this.ctl.zoomSpeed = 0.8; this.ctl.update();
      // zooming right down onto the plate brings you back to the 3D scene
      if (this.plate && this.cam.position.length() < 1.03 && this.cam.position.clone().normalize().dot(this.plate.position.clone().normalize()) > 0.9995) this.leave(); }
    const [sl, so] = sunLatLon(); const s = xyz(sl, so); this.U.sun.value.copy(s); this.U.nightOn.value = this.opt.night ? 1 : 0; this.sunL.position.copy(s.clone().multiplyScalar(10));
    this.clouds.visible = this.opt.clouds; this.clouds.rotation.y += dt * 0.0; this.stepWind(Math.min(dt, 0.05)); if (this.SJ) this.stepSats(); this.stepFlights();
    if (this.plate) { const k = Math.max(1, (this.cam.position.length() - 1) / 0.6); this.plate.scale.setScalar(Math.min(k, 6)); }
    w.renderer.render(this.scene, this.cam);
  }
  info() { const d = new Date(); return { utc: d.toISOString().slice(11, 16), ...this.status, sats: Object.entries(this.sats).filter(([g]) => this.opt.sats[g]).map(([g, v]) => `${SAT_GROUPS[g][0]} ${v.list.length}`).join(' · '), flights: this.status.flights || (this.nFlights ? `Aircraft: ${this.nFlights} from the radar` : '') }; }
}
export { SAT_GROUPS };
