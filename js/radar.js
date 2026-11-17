// Ground radar station: a rotating antenna and sweep, a radar scope (PPI) and aircraft in the sky.
// Aircraft come from a simulation and/or live ADS-B data (adsb.lol, or adsb.fi through your own proxy).
// A target is "detected" when the sweep passes over it, it is inside the range and above the radar horizon.
import * as THREE from 'three';

const EL_MAX = 40, KT = 0.514444, FT = 0.3048, R_E = 6371000, PROXY_KEY = 'cambodia3d.flightProxy';
const AIRPORTS = [['PNH', 11.5466, 104.8441], ['KTI', 11.3594, 104.9264], ['SAI', 13.3700, 104.2240], ['KOS', 10.5797, 103.6370], ['BKK', 13.6900, 100.7501], ['SGN', 10.8188, 106.6519]];
const TYPES = {
  airliner: { label: 'Airliner', alt: [9000, 12000], spd: [210, 250], icon: 'jet', t: ['A320', 'A321', 'B738', 'A20N', 'B77W', 'A333'] },
  regional: { label: 'Regional', alt: [1500, 6000], spd: [110, 160], icon: 'prop', t: ['AT72', 'AT76', 'DH8D'] },
  heli: { label: 'Helicopter', alt: [150, 600], spd: [45, 65], icon: 'heli', t: ['EC35', 'AS50', 'MI8'] },
  drone: { label: 'Drone', alt: [60, 150], spd: [10, 18], icon: 'drone', t: ['UAV'] },
};
const CALL = ['KME', 'CMB', 'AIQ', 'TGW', 'VJC', 'HVN', 'THA', 'CPA', 'SIA', 'CSN', 'CXA', 'BKP'];
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[(Math.random() * a.length) | 0];

function iconCanvas(kind, col) {
  const c = document.createElement('canvas'), S = 64; c.width = c.height = S; const g = c.getContext('2d'); g.translate(S / 2, S / 2); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 2.5; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'heli') { g.ellipse(0, 4, 7, 12, 0, 0, 7); g.moveTo(-1.5, 14); g.rect(-1.5, 14, 3, 14); g.moveTo(-26, -2); g.rect(-26, -3, 52, 3); g.rect(-1.5, -27, 3, 50); }
  else if (kind === 'drone') { g.rect(-6, -6, 12, 12); for (const [x, y] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) { g.moveTo(x + 7, y); g.arc(x, y, 7, 0, 7); } }
  else { const w = kind === 'prop' ? 25 : 27; g.moveTo(0, -28); g.lineTo(3.5, -20); g.lineTo(3.5, -6); g.lineTo(w, 5); g.lineTo(w, 9); g.lineTo(3.5, 3); g.lineTo(3, 18); g.lineTo(10, 25); g.lineTo(10, 28); g.lineTo(0, 25); g.lineTo(-10, 28); g.lineTo(-10, 25); g.lineTo(-3, 18); g.lineTo(-3.5, 3); g.lineTo(-w, 9); g.lineTo(-w, 5); g.lineTo(-3.5, -6); g.lineTo(-3.5, -20); g.closePath(); }
  g.stroke(); g.fill(); return c;
}

export class Radar {
  constructor(world) {
    this.w = world; this.group = new THREE.Group(); this.sky = new THREE.Group(); this.range = 150; this.rpm = 15; this.src = 'sim'; this.fit = true; this.nSim = 10;
    this.az = 0; this.targets = new Map(); this.status = ''; this.lastFetch = 0; this.placed = false; this.mast = 18; this.showAll = false;
    try { this.proxy = localStorage.getItem(PROXY_KEY) || ''; } catch (e) { this.proxy = ''; }
    this.tex = {};
  }
  get F() { return this.w.F; }
  setProxy(v) { this.proxy = v.trim(); try { localStorage.setItem(PROXY_KEY, this.proxy); } catch (e) { } }
  /* ---------- station ---------- */
  place(x, z) {
    const w = this.w; this.clear3D(); this.x = x; this.z = z; this.y = w.hAt(x, z); this.lon = this.F.lon(x); this.lat = this.F.lat(z); this.elev = w.rawElevation(x, z); this.placed = true;
    const g = this.group, M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2, ...o });
    g.position.set(x, this.y, z); if (!g.parent) w.root.add(g); if (!this.sky.parent) w.root.add(this.sky);
    const s = 1; // metres
    const base = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 9).translate(0, 0.3, 0), M(0x9a9a92)); base.receiveShadow = true;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 3.2).translate(2.2, 1.5 + 0.6, 2.2), M(0xe9e6dc));
    const tower = new THREE.Group(); for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, this.mast, 6).translate(0, this.mast / 2, 0), M(0xc8c8c8, { metalness: 0.6 })); leg.position.set(dx * 0.7, 0.6, dz * 0.7); leg.rotation.set(dz * 0.025, 0, -dx * 0.025); tower.add(leg); }
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 16).translate(0, this.mast + 0.6, 0), M(0x777777));
    const head = new THREE.Group(); head.position.y = this.mast + 0.8;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 12).translate(0, 0.6, 0), M(0x555555));
    const dish = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.2, 0.35).translate(0, 2.2, 0.6), M(0xf2f2f2, { metalness: 0.4 })); dish.rotation.x = -0.2;
    const feed = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.3, 0.3).translate(0, 1.4, -0.4), M(0x333333));
    head.add(ped, dish, feed); this.head = head;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 })); beacon.position.y = this.mast + 4.6; this.beacon = beacon;
    g.add(base, hut, tower, deck, head, beacon); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // sweep and range rings on the ground (scaled to the scene when "fit" is on)
    const R = this.sceneR(); this.R3 = R;
    // the beam is a vertical fan: it covers from the horizon up to EL_MAX at once while it turns
    const sw = new THREE.Group(); sw.position.y = this.mast + 2;
    const fan = (wid, op) => { const pos = [], idx = [], NE = 12, a0 = -wid * Math.PI / 180, a1 = 0; pos.push(0, 0, 0);
      for (const a of [a0, a1]) for (let k = 0; k <= NE; k++) { const e = k / NE * EL_MAX * Math.PI / 180; pos.push(R * Math.cos(e) * Math.sin(a), R * Math.sin(e), -R * Math.cos(e) * Math.cos(a)); }
      for (let k = 0; k < NE; k++) { const A = 1 + k, B = 1 + NE + 1 + k; idx.push(0, A, A + 1, 0, B, B + 1, A, B, A + 1, A + 1, B, B + 1); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
      const m = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); m.renderOrder = 8; return m; };
    sw.add(fan(3, 0.32)); for (let k = 1; k <= 6; k++) { const f = fan(4, 0.13 * (1 - k / 7)); f.rotation.y = k * 4 * Math.PI / 180; sw.add(f); } // afterglow
    this.sweep = sw; g.add(sw);
    // coverage: the radar sees from the horizon up to EL_MAX; above that is the cone of silence
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 12, 0, Math.PI * 2, Math.PI / 2 - EL_MAX * Math.PI / 180, EL_MAX * Math.PI / 180), new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    dome.position.y = this.mast + 2; dome.renderOrder = 7; g.add(dome);
    const domeW = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(R, 24, 4, 0, Math.PI * 2, Math.PI / 2 - EL_MAX * Math.PI / 180, EL_MAX * Math.PI / 180)), new THREE.LineBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.12, depthWrite: false }));
    domeW.position.y = this.mast + 2; g.add(domeW);
    for (let k = 1; k <= 4; k++) { const rr = R * k / 4, ring = new THREE.Mesh(new THREE.RingGeometry(rr - R * 0.003 - 0.4, rr + R * 0.003 + 0.4, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })); ring.position.y = 2.5; ring.renderOrder = 8; g.add(ring); }
    this.ringR = R; this.seedSim(); this.onChange && this.onChange();
  }
  sceneR() { const D = this.w.D; return this.fit ? Math.max(D.W, D.H) * 0.75 : this.range * 1000; }
  setRange(km) { this.range = km; if (this.placed) this.place(this.x, this.z); }
  setFit(on) { this.fit = on; if (this.placed) this.place(this.x, this.z); }
  clear3D() {
    for (const g of [this.group, this.sky]) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && !o.material.map.shared) o.material.map.dispose(); o.material.dispose(); } }); g.clear(); }
    for (const t of this.targets.values()) t.obj = null;
  }
  remove() { this.clear3D(); this.placed = false; this.targets.clear(); this.onChange && this.onChange(); }
  /* ---------- geometry: east/north metres from the radar ---------- */
  en(lat, lon) { return [(lon - this.lon) * Math.PI / 180 * R_E * Math.cos(this.lat * Math.PI / 180), (lat - this.lat) * Math.PI / 180 * R_E]; }
  ll(e, n) { return [this.lat + n / R_E * 180 / Math.PI, this.lon + e / (R_E * Math.cos(this.lat * Math.PI / 180)) * 180 / Math.PI]; }
  horizon(altM) { return 4120 * (Math.sqrt(Math.max(0, this.elev + this.mast)) + Math.sqrt(Math.max(0, altM))); } // radar horizon with 4/3 earth, metres
  /* ---------- simulated traffic ---------- */
  seedSim() { for (const [k, t] of this.targets) if (t.src === 'sim') this.targets.delete(k); if (this.src === 'live') return; for (let i = 0; i < this.nSim; i++) this.spawn(i < 2 ? 'regional' : i === 2 ? 'heli' : i === 3 ? 'drone' : 'airliner', true); }
  spawn(kind, anywhere) {
    const T = TYPES[kind], R = this.range * 1000, id = 'sim' + Math.random().toString(36).slice(2, 7); let e, n, trk;
    if (kind === 'drone') { const a = rnd(0, 6.28), r = rnd(1500, 6000); e = Math.cos(a) * r; n = Math.sin(a) * r; trk = rnd(0, 360); }
    else if (kind === 'heli') { const a = rnd(0, 6.28), r = rnd(5000, Math.min(R, 40000)); e = Math.cos(a) * r; n = Math.sin(a) * r; trk = rnd(0, 360); }
    else if (kind === 'regional') { const ap = pick(AIRPORTS.slice(0, 4)), [ae, an] = this.en(ap[1], ap[2]), a = rnd(0, 6.28), r = anywhere ? rnd(0.2, 1) * R : R * 1.1; e = ae + Math.cos(a) * r; n = an + Math.sin(a) * r; trk = (Math.atan2(ae - e, an - n) * 180 / Math.PI + 360) % 360; }
    else { const a = rnd(0, 6.28), off = rnd(-0.7, 0.7) * R, r = anywhere ? rnd(-0.9, 0.9) * R : -R * 1.15; trk = (a * 180 / Math.PI) % 360; const tx = Math.sin(a), tz = Math.cos(a); e = tx * r + tz * off; n = tz * r - tx * off; }
    const [lat, lon] = this.ll(e, n), alt = rnd(T.alt[0], T.alt[1]);
    this.targets.set(id, { id, src: 'sim', kind, lat, lon, alt: kind === 'airliner' ? Math.round(alt / 304.8) * 304.8 : alt, gs: rnd(T.spd[0], T.spd[1]), trk, vr: 0, flight: kind === 'drone' ? 'UAV-' + ((Math.random() * 90 + 10) | 0) : kind === 'heli' ? 'HEL' + ((Math.random() * 900 + 100) | 0) : pick(CALL) + ((Math.random() * 900 + 100) | 0), type: pick(T.t), t0: performance.now(), turn: kind === 'drone' ? 6 : kind === 'heli' ? rnd(-1.5, 1.5) : 0 });
  }
  /* ---------- live ADS-B ---------- */
  async fetchLive() {
    const nm = Math.min(250, Math.round(this.range / 1.852)), lat = this.lat.toFixed(4), lon = this.lon.toFixed(4);
    const urls = [['adsb.lol', `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`]];
    if (this.proxy) { const fi = `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`; urls.unshift(['adsb.fi via your proxy', this.proxy.includes('{url}') ? this.proxy.replace('{url}', encodeURIComponent(fi)) : this.proxy + encodeURIComponent(fi)]); }
    for (const [name, u] of urls) {
      try {
        const c = new AbortController(), to = setTimeout(() => c.abort(), 8000), r = await fetch(u, { signal: c.signal }); clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json(), list = j.ac || j.aircraft || [], now = performance.now(), seen = new Set();
        for (const a of list) {
          if (a.lat == null || a.lon == null) continue; const id = 'ads' + (a.hex || a.icao); seen.add(id); const ground = a.alt_baro === 'ground', alt = ground ? 0 : ((a.alt_geom ?? a.alt_baro ?? 0) * FT);
          const cat = String(a.category || ''), kind = cat === 'A7' ? 'heli' : cat === 'B6' ? 'drone' : (alt < 7000 && /AT7|DH8|C208|AT4/.test(a.t || '')) ? 'regional' : 'airliner';
          const o = this.targets.get(id) || { id, src: 'live' }; Object.assign(o, { kind, lat: a.lat, lon: a.lon, alt, gs: (a.gs || 0) * KT, trk: a.track ?? a.true_heading ?? o.trk ?? 0, vr: (a.baro_rate || a.geom_rate || 0) * FT / 60, flight: (a.flight || a.r || a.hex || '').trim(), type: a.t || '', desc: a.desc || '', reg: a.r || '', squawk: a.squawk || '', ground, t0: now - (a.seen_pos || 0) * 1000, turn: 0 });
          this.targets.set(id, o);
        }
        for (const [k, t] of this.targets) if (t.src === 'live' && !seen.has(k)) { if (t.obj) this.dropObj(t); this.targets.delete(k); }
        this.status = `Live: ${list.length} aircraft from ${name}`; this.liveOK = true; return;
      } catch (e) { this.status = `Live data not reachable (${name}: ${e.name === 'AbortError' ? 'timeout' : e.message})`; }
    }
    this.liveOK = false;
    if (!this.proxy) this.status += ' – the flight sites block web pages; add a proxy (see help) or use the simulation.';
  }
  /* ---------- per frame ---------- */
  step(dt) {
    if (!this.placed) return; const now = performance.now();
    if ((this.src === 'live' || this.src === 'both') && now - this.lastFetch > 10000) { this.lastFetch = now; this.fetchLive().then(() => this.onChange && this.onChange()); }
    const prev = this.az; this.az = (this.az + dt * this.rpm / 60 * Math.PI * 2) % (Math.PI * 2);
    this.head.rotation.y = -this.az; this.sweep.rotation.y = -this.az; this.beacon.visible = (now % 1200) < 250;
    const R = this.range * 1000, k = this.R3 / R, ak = this.fit ? k * 4 : 1;
    for (const t of [...this.targets.values()]) {
      // dead reckoning (and a gentle turn for helicopters and drones)
      if (t.src === 'sim' || dt > 0) { if (t.turn) t.trk = (t.trk + t.turn * dt + 360) % 360; const d = t.gs * dt, a = t.trk * Math.PI / 180; const [e0, n0] = this.en(t.lat, t.lon), [la, lo] = this.ll(e0 + Math.sin(a) * d, n0 + Math.cos(a) * d); t.lat = la; t.lon = lo; t.alt = Math.max(0, t.alt + (t.vr || 0) * dt); }
      const [e, n] = this.en(t.lat, t.lon), dist = Math.hypot(e, n), brg = (Math.atan2(e, n) + Math.PI * 2) % (Math.PI * 2); t.e = e; t.n = n; t.dist = dist; t.brg = brg;
      if (t.src === 'sim' && dist > R * 1.25) { if (t.obj) this.dropObj(t); this.targets.delete(t.id); this.spawn(t.kind, false); continue; }
      if (t.src === 'sim' && t.kind === 'drone' && dist > 9000) t.trk = (Math.atan2(-e, -n) * 180 / Math.PI + 360) % 360;
      // painted by the sweep this frame?
      const crossed = prev <= this.az ? brg > prev && brg <= this.az : brg > prev || brg <= this.az;
      if (crossed) { const el = Math.atan2(t.alt - this.elev - this.mast, dist) * 180 / Math.PI, vis = dist <= R && dist <= this.horizon(t.alt) && el <= EL_MAX && !t.ground; t.el = el; t.det = vis; if (vis) { t.hit = now; (t.trail = t.trail || []).push([e, n]); if (t.trail.length > 8) t.trail.shift(); } }
      // 3D
      const show = this.showAll || (t.hit && now - t.hit < 60000 / this.rpm * 1.5);
      if (!show || dist > R * 1.05) { if (t.obj) t.obj.visible = false; continue; }
      if (!t.obj) this.makeObj(t);
      const x = this.x + e * k, z = this.z - n * k, gy = this.w.hAt(Math.min(Math.max(x, this.w.D.X0), this.w.D.X0 + this.w.D.W), Math.min(Math.max(z, this.w.D.Z0), this.w.D.Z0 + this.w.D.H)), y = gy + Math.max(8, t.alt * ak);
      if (now - t.labTime > 3000) this.drawLab(t);
      t.obj.visible = true; t.obj.position.set(x, y, z); t.stem.scale.y = y - gy; t.stem.position.y = -(y - gy) / 2;
      // icon points along the track as seen on screen
      const p0 = new THREE.Vector3(x, y, z).project(this.w.camera), a = t.trk * Math.PI / 180, p1 = new THREE.Vector3(x + Math.sin(a) * 50, y, z - Math.cos(a) * 50).project(this.w.camera);
      t.icon.material.rotation = Math.atan2(p1.y - p0.y, (p1.x - p0.x) * this.w.camera.aspect) - Math.PI / 2;
      t.icon.material.color.set(t.det || this.showAll && !t.hit ? 0xffffff : 0x888888);
    }
    if (this.scope && !this.scope.hidden) this.drawScope(now);
  }
  makeObj(t) {
    const col = t.src === 'live' ? '#ffd23f' : t.kind === 'drone' ? '#ff6b6b' : t.kind === 'heli' ? '#7fd1ff' : '#5dff8a', key = t.kind + col;
    if (!this.tex[key]) { const tx = new THREE.CanvasTexture(iconCanvas(TYPES[t.kind].icon, col)); tx.colorSpace = THREE.SRGBColorSpace; tx.shared = true; this.tex[key] = tx; }
    const g = new THREE.Group(), icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[key], sizeAttenuation: false, depthTest: false, transparent: true })); icon.scale.set(0.045, 0.045, 1); icon.renderOrder = 20;
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; t.labC = c; t.col = col; this.drawLab(t);
    const lt = new THREE.CanvasTexture(c); lt.colorSpace = THREE.SRGBColorSpace; const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, sizeAttenuation: false, depthTest: false, transparent: true })); lab.center.set(-0.12, 0.5); lab.scale.set(0.09, 0.0225, 1); lab.renderOrder = 21;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })); g.add(icon, lab, stem); this.sky.add(g); t.obj = g; t.icon = icon; t.stem = stem; t.label = lab; t.labTime = performance.now();
  }
  drawLab(t) { const c = t.labC, x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.font = '700 26px ui-monospace, monospace'; x.fillStyle = t.col; x.strokeStyle = '#000'; x.lineWidth = 5;
    const l1 = t.flight || t.type, l2 = `FL${Math.round(t.alt / FT / 100).toString().padStart(3, '0')} ${Math.round(t.gs / KT)}kt`; x.strokeText(l1, 4, 26); x.fillText(l1, 4, 26); x.font = '600 22px ui-monospace, monospace'; x.strokeText(l2, 4, 54); x.fillText(l2, 4, 54);
    if (t.label) t.label.material.map.needsUpdate = true; t.labTime = performance.now(); }
  dropObj(t) { if (!t.obj) return; t.obj.traverse(o => { if (o.material) { if (o.material.map && !o.material.map.shared) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); }); this.sky.remove(t.obj); t.obj = null; }
  refreshLabels() { for (const t of this.targets.values()) if (t.obj) this.dropObj(t); }
  list() { const now = performance.now(); return [...this.targets.values()].filter(t => t.det && t.hit && now - t.hit < 60000 / this.rpm * 1.5).sort((a, b) => a.dist - b.dist); }
  /* ---------- radar scope ---------- */
  drawScope(now) {
    const c = this.scope, g = c.getContext('2d'), W = c.width, H = c.height, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 6, R = this.range * 1000;
    g.fillStyle = 'rgba(0,14,6,1)'; g.fillRect(0, 0, W, H);
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip(); g.fillStyle = '#021a0b'; g.fill();
    // afterglow of the sweep
    for (let i = 0; i < 30; i++) { const a0 = this.az - (i + 1) * 0.03 - Math.PI / 2, a1 = this.az - i * 0.03 - Math.PI / 2; g.fillStyle = `rgba(60,255,120,${0.28 * (1 - i / 30)})`; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a0, a1); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(80,255,140,.35)'; g.lineWidth = 1; for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, r * k / 4, 0, 7); g.stroke(); }
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); g.stroke(); }
    g.fillStyle = 'rgba(120,255,160,.7)'; g.font = '10px ui-monospace, monospace'; g.textAlign = 'left'; for (let k = 1; k <= 4; k++) g.fillText(Math.round(this.range * k / 4) + ' km', cx + 3, cy - r * k / 4 + 11);
    // airports
    g.fillStyle = 'rgba(120,200,255,.8)'; for (const [nm, la, lo] of AIRPORTS) { const [e, n] = this.en(la, lo); if (Math.hypot(e, n) > R) continue; const x = cx + e / R * r, y = cy - n / R * r; g.fillRect(x - 2, y - 2, 4, 4); g.fillText(nm, x + 4, y + 3); }
    // blips: brightness fades until the sweep paints them again
    const per = 60000 / this.rpm;
    for (const t of this.targets.values()) {
      if (!t.hit || now - t.hit > per * 1.5) continue; const f = Math.max(0.15, 1 - (now - t.hit) / (per * 1.3)), col = t.src === 'live' ? '255,210,63' : t.kind === 'drone' ? '255,107,107' : t.kind === 'heli' ? '127,209,255' : '93,255,138';
      (t.trail || []).forEach(([e, n], i) => { g.fillStyle = `rgba(${col},${0.12 + 0.05 * i})`; g.beginPath(); g.arc(cx + e / R * r, cy - n / R * r, 1.6, 0, 7); g.fill(); });
      const [e, n] = t.trail[t.trail.length - 1], x = cx + e / R * r, y = cy - n / R * r; g.fillStyle = `rgba(${col},${f})`; g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill();
      const a = t.trk * Math.PI / 180, L = 6 + t.gs / 25; g.strokeStyle = `rgba(${col},${f})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * L, y - Math.cos(a) * L); g.stroke();
      g.fillText(`${t.flight || t.type} ${Math.round(t.alt / FT / 100).toString().padStart(3, '0')}`, x + 5, y - 4);
    }
    g.restore(); g.strokeStyle = 'rgba(80,255,140,.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    g.fillStyle = 'rgba(120,255,160,.9)'; g.textAlign = 'center'; g.fillText('N', cx, cy - r + 11);
  }
}
