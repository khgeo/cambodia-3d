// Indoor ride: pedal your exercise bike and ride the roads of the 3D area on the TV.
// The bike connects over Bluetooth (Web Bluetooth – Chrome / Edge on a laptop, Android or ChromeOS):
//   • FTMS indoor bike (0x1826): speed, cadence, power, heart rate; the road's slope is sent back as resistance
//     on bikes that support it ("simulation mode", like Zwift).
//   • Cycling Power (0x1818) or Speed & Cadence (0x1816) sensors; a heart-rate strap (0x180D).
// Speed: from power and the slope (a road-bike physics model), else from the bike's own speed, else from cadence.
// Without a bike: ↑/↓ keys or the slider pedal for you. ←/→ choose the turn at the next junction.
import * as THREE from 'three';
import { t } from './i18n.js?v=92';

const FTMS = 0x1826, IBD = 0x2ad2, FCP = 0x2ad9, CPS = 0x1818, CPM = 0x2a63, CSC = 0x1816, CSCM = 0x2a5b, HRS = 0x180d, HRM = 0x2a37;
const norm = a => ((a + 540) % 360) - 180, WHEEL = 2.105;

export class Ride {
  constructor(w) { this.w = w; this.active = false; this.s = { v: 0, cad: 0, pow: 0, hr: 0, bikeV: null, at: 0 }; this.virt = 0; this.cam = 'eye'; this.bob = 0; this.intent = null; this.dev = null; this.hrDev = null;
    this._key = e => this.key(e, true); this._keyUp = e => this.key(e, false); }
  /* ---------- road graph ---------- */
  build() {
    const roads = this.w.net ? this.w.net.roads : [], key = p => Math.round(p.x * 2) + ',' + Math.round(p.z * 2), id = new Map(), X = [], Z = [], Y = [], out = [], E = [];
    const node = p => { const k = key(p); let i = id.get(k); if (i === undefined) { i = X.length; id.set(k, i); X.push(p.x); Z.push(p.z); Y.push(p.y); out.push([]); } return i; };
    for (const r of roads) for (let k = 1; k < r.pts.length; k++) { const a = node(r.pts[k - 1]), b = node(r.pts[k]); if (a === b) continue; const L = Math.hypot(X[b] - X[a], Z[b] - Z[a]), base = { L, cls: r.cls, hw: r.hw || 3, oneway: !!r.oneway };
      E.push({ ...base, a, b }); out[a].push(E.length - 1); E.push({ ...base, a: b, b: a }); out[b].push(E.length - 1); }
    for (let i = 0; i < E.length; i++) E[i].rev = i ^ 1;
    this.G = { X, Z, Y, out, E }; this.deC = null;
  }
  hd(e) { const G = this.G; return Math.atan2(G.X[e.b] - G.X[e.a], G.Z[e.b] - G.Z[e.a]) * 180 / Math.PI; }
  // which way at the end of edge ei: your arrow choice, else the straightest, bigger roads first; dead end: turn round
  choose(ei, intent) { const G = this.G, e = G.E[ei], C = G.out[e.b].filter(i => i !== e.rev); if (!C.length) return e.rev;
    const turn = i => norm(this.hd(G.E[i]) - this.hd(e));
    if (intent) { const want = intent === 'left' ? 90 : intent === 'right' ? -90 : 0; return C.reduce((b, i) => Math.abs(turn(i) - want) < Math.abs(turn(b) - want) ? i : b, C[0]); }
    const cc = e.cls || 12, score = i => { const k = G.E[i].cls || 12; return Math.abs(turn(i)) + k * 4 + Math.max(0, k - cc) * 30 + (k >= 12 && cc < 12 ? 80 : 0) + (this.deadEnd(i) ? 500 : 0); }; // stay on the road you are on, not into lanes and yards
    return C.reduce((b, i) => score(i) < score(b) ? i : b, C[0]); }
  // does this way run out within ~300 m (a driveway, a lane into a yard)?
  deadEnd(ei) { const c = (this.deC || (this.deC = new Map())); if (c.has(ei)) return c.get(ei); const G = this.G, seen = new Set([G.E[ei].a]), st = [[ei, 0]]; let far = 0, n = 0;
    while (st.length && n++ < 400) { const [i, d0] = st.pop(), e = G.E[i], d = d0 + e.L; far = Math.max(far, d); if (far > 300) break; if (seen.has(e.b)) continue; seen.add(e.b); for (const j of G.out[e.b]) if (j !== e.rev) st.push([j, d]); }
    const r = far <= 300; c.set(ei, r); return r; }
  start() {
    const w = this.w, G = this.G; if (!G.E.length) return false; const tg = w.controls.target; let best = 0, bd = Infinity;
    G.E.forEach((e, i) => { const d = Math.hypot(G.X[e.a] - tg.x, G.Z[e.a] - tg.z) + (e.cls || 12) * 150; if (d < bd && e.L > 3 && !this.deadEnd(i)) { bd = d; best = i; } });
    this.e = best; this.off = 0; this.next = this.choose(best); this.dist = 0; this.time = 0; this.kcal = 0; this.climb = 0; this.hdS = null; this.v = 0; return true; }
  /* ---------- open / close ---------- */
  open() { const w = this.w; if (!w.D) return; this.build(); if (!this.start()) { alert(t('This 3D area has no roads to ride on.')); return; }
    this.active = true; if (w.mode !== 'orbit') w.setMode('orbit'); if (w.nav && w.nav.active) w.nav.close(); w.controls.enabled = false;
    this.hud(); this.bikeModel(); addEventListener('keydown', this._key); addEventListener('keyup', this._keyUp); document.body.classList.add('ride-on'); }
  close() { const w = this.w; this.active = false; w.controls.enabled = true; removeEventListener('keydown', this._key); removeEventListener('keyup', this._keyUp);
    if (this.box) { this.box.remove(); this.box = null; } if (this.rider) { w.scene.remove(this.rider); this.rider = null; } if (this.bars) { w.camera.remove(this.bars); w.scene.remove(w.camera); this.bars = null; }
    if (this.fov0 != null) { w.camera.fov = this.fov0; w.camera.updateProjectionMatrix(); this.fov0 = null; }
    document.body.classList.remove('ride-on'); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); this.onClose && this.onClose(); }
  key(e, down) { if (!this.active || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key;
    if (k === 'ArrowUp') { this.kUp = down; e.preventDefault(); } else if (k === 'ArrowDown') { this.kDn = down; e.preventDefault(); }
    else if (down && (k === 'ArrowLeft' || k === 'ArrowRight')) { this.turn(k === 'ArrowLeft' ? 'left' : 'right'); e.preventDefault(); }
    else if (down && (k === 'h' || k === 'H')) this.box.classList.toggle('min'); else if (down && (k === 'f' || k === 'F')) this.fullscreen(); else if (down && (k === 'c' || k === 'C')) this.cam = this.cam === 'eye' ? 'chase' : 'eye';
    else if (down && k === 'Escape') this.close(); }
  junc(ei) { const G = this.G, e = G.E[ei]; return G.out[e.b].filter(i => i !== e.rev).length >= 2; }
  turn(dir) { this.intent = dir; if (this.junc(this.e)) { this.next = this.choose(this.e, dir); this.intent = null; this.turnAt = this.next; } this.flash(dir === 'left' ? '⬅ ' + t('next junction: left') : '➡ ' + t('next junction: right')); }
  fullscreen() { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else el.requestFullscreen && el.requestFullscreen().catch(() => { }); this.box.classList.add('min'); }
  /* ---------- Bluetooth ---------- */
  async connect(all) {
    if (!navigator.bluetooth) { this.flash(t('This browser has no Bluetooth. Use Chrome or Edge on a laptop, Android phone or tablet (on iPhone/iPad: the Bluefy browser).'), 9000); return; }
    try { const opt = [FTMS, CPS, CSC, HRS, 0x180a], dev = await navigator.bluetooth.requestDevice(all ? { acceptAllDevices: true, optionalServices: opt } : { filters: [{ services: [FTMS] }, { services: [CPS] }, { services: [CSC] }], optionalServices: opt });
      this.dev = dev; dev.addEventListener('gattserverdisconnected', () => { this.status(t('Bike disconnected')); this.src = null; });
      this.status(t('Connecting…')); const g = await dev.gatt.connect(); this.src = null; this.ctrl = null; this.crank = this.wheel = null;
      try { const s = await g.getPrimaryService(FTMS), c = await s.getCharacteristic(IBD); c.addEventListener('characteristicvaluechanged', ev => this.ibd(ev.target.value)); await c.startNotifications(); this.src = 'FTMS';
        try { const cp = await s.getCharacteristic(FCP); cp.addEventListener('characteristicvaluechanged', () => { }); await cp.startNotifications(); await cp.writeValue(new Uint8Array([0x00])); await cp.writeValue(new Uint8Array([0x07])); this.ctrl = cp; } catch (e) { this.ctrl = null; } } catch (e) { }
      if (!this.src) try { const s = await g.getPrimaryService(CPS), c = await s.getCharacteristic(CPM); c.addEventListener('characteristicvaluechanged', ev => this.cpm(ev.target.value)); await c.startNotifications(); this.src = 'Power'; } catch (e) { }
      if (!this.src) try { const s = await g.getPrimaryService(CSC), c = await s.getCharacteristic(CSCM); c.addEventListener('characteristicvaluechanged', ev => this.csc(ev.target.value)); await c.startNotifications(); this.src = 'Speed/Cadence'; } catch (e) { }
      try { const s = await g.getPrimaryService(HRS), c = await s.getCharacteristic(HRM); c.addEventListener('characteristicvaluechanged', ev => this.hrm(ev.target.value)); await c.startNotifications(); } catch (e) { }
      this.status(this.src ? `🟢 ${dev.name || t('Bike')} · ${this.src}${this.ctrl ? ' · ' + t('slope → resistance') : ''}` : t('Connected, but no speed / power / cadence data found'));
    } catch (e) { if (e.name !== 'NotFoundError') this.status(t('Could not connect: ') + e.message); } }
  async connectHR() { if (!navigator.bluetooth) return this.connect(); try { const d = await navigator.bluetooth.requestDevice({ filters: [{ services: [HRS] }] }), g = await d.gatt.connect(), c = await (await g.getPrimaryService(HRS)).getCharacteristic(HRM);
    c.addEventListener('characteristicvaluechanged', ev => this.hrm(ev.target.value)); await c.startNotifications(); this.hrDev = d; this.flash('❤️ ' + (d.name || t('Heart rate'))); } catch (e) { } }
  ibd(v) { // FTMS Indoor Bike Data
    const f = v.getUint16(0, true); let o = 2; const S = this.s; S.at = performance.now();
    if (!(f & 1)) { S.bikeV = v.getUint16(o, true) / 100 / 3.6; o += 2; } if (f & 2) o += 2; if (f & 4) { S.cad = v.getUint16(o, true) / 2; o += 2; } if (f & 8) o += 2; if (f & 16) o += 3; if (f & 32) o += 2;
    if (f & 64) { S.pow = v.getInt16(o, true); S.hasPow = true; o += 2; } if (f & 128) o += 2; if (f & 256) o += 5; if (f & 512) { const h = v.getUint8(o); if (h) S.hr = h; o += 1; } }
  cpm(v) { const f = v.getUint16(0, true), S = this.s; S.pow = v.getInt16(2, true); S.hasPow = true; S.at = performance.now(); let o = 4; if (f & 1) o += 1; if (f & 4) o += 2;
    if (f & 16) { const r = v.getUint32(o, true), tm = v.getUint16(o + 4, true); this.wheelRev(r, tm, 2048); o += 6; } if (f & 32) { this.crankRev(v.getUint16(o, true), v.getUint16(o + 2, true)); } }
  csc(v) { const f = v.getUint8(0); let o = 1; this.s.at = performance.now(); if (f & 1) { this.wheelRev(v.getUint32(o, true), v.getUint16(o + 4, true), 1024); o += 6; } if (f & 2) this.crankRev(v.getUint16(o, true), v.getUint16(o + 2, true)); }
  crankRev(r, tm) { const p = this.crank; this.crank = { r, tm, at: performance.now() }; if (!p) return; const dr = (r - p.r + 65536) % 65536, dt = ((tm - p.tm + 65536) % 65536) / 1024; if (dt > 0) this.s.cad = dr * 60 / dt; else if (performance.now() - p.at > 2500) this.s.cad = 0; }
  wheelRev(r, tm, res) { const p = this.wheel; this.wheel = { r, tm, at: performance.now() }; if (!p) return; const dr = r - p.r, dt = ((tm - p.tm + 65536) % 65536) / res; if (dt > 0) this.s.bikeV = dr * WHEEL / dt; }
  hrm(v) { const f = v.getUint8(0); this.s.hr = f & 1 ? v.getUint16(1, true) : v.getUint8(1); }
  sendGrade(g) { if (!this.ctrl || this.busy) return; const b = new DataView(new ArrayBuffer(7)); b.setUint8(0, 0x11); b.setInt16(1, 0, true); b.setInt16(3, Math.round(THREE.MathUtils.clamp(g, -0.2, 0.2) * 10000), true); b.setUint8(5, 40); b.setUint8(6, 51);
    this.busy = true; this.ctrl.writeValue(b.buffer).catch(() => { }).finally(() => this.busy = false); }
  /* ---------- every frame ---------- */
  frame(dt) {
    const w = this.w, G = this.G, S = this.s, now = performance.now(); if (this.paused) dt = 0;
    let e = G.E[this.e]; const ex = w.exag || w.D.stats.exag || 1, grade = e.L > 0.5 ? (G.Y[e.b] - G.Y[e.a]) / ex / e.L : 0; this.grade = this.grade == null ? grade : this.grade + (grade - this.grade) * Math.min(1, dt * 1.5);
    // where the speed comes from
    const live = this.src && now - S.at < 3000; if (live && now - S.at > 2500) S.cad = 0;
    if (!live) { const pk = this.kUp ? 1 : this.kDn ? -1 : 0; this.virt = THREE.MathUtils.clamp(this.virt + pk * 60 * dt, 0, 120); }
    const cad = live ? S.cad : this.virt, pow = live ? (S.hasPow ? S.pow : null) : this.virt * 2.2;
    let target; if (pow != null && this.useP !== false) target = this.vFromP(Math.max(0, pow), this.grade); else if (live && S.bikeV != null) target = S.bikeV; else target = cad * 0.093;
    if (live && cad < 5 && !(S.bikeV > 0.5) && !(S.pow > 5)) target = 0;
    this.v += (target - this.v) * Math.min(1, dt * (target < this.v ? 0.8 : 1.2)); if (this.v < 0.05 && target === 0) this.v = 0;
    this.cad = cad; this.pow = pow != null ? pow : this.pFromV(this.v, this.grade);
    if (this.v > 0.2) { this.time += dt; this.kcal += Math.max(0, this.pow) * dt / 1000; }
    // move along the roads
    // don't ride through a slower vehicle just ahead in your lane: hang behind it until it pulls away
    if (this.ob) { const o = this.ob; for (const v of w.vehicles || []) { const dx = v.pos.x - o.pos.x, dz = v.pos.z - o.pos.z, along = dx * o.fwd.x + dz * o.fwd.z, lat = Math.abs(dx * o.fwd.z - dz * o.fwd.x);
      if (along > 0 && along < 7 + (v.len || 4) / 2 && lat < 1.6 && (v.cur ?? v.speed) > 1 && v.fwd.x * o.fwd.x + v.fwd.z * o.fwd.z > 0.5) this.v = Math.min(this.v, Math.max(0, (v.cur ?? v.speed) - 0.2)); } }
    let move = this.v * dt; this.dist += move;
    while (move > 0) { const rem = e.L - this.off; if (move < rem) { this.off += move; move = 0; } else { move -= rem; if (this.turnAt === this.next) { this.turnAt = null; this.flash(''); } this.e = this.next; e = G.E[this.e]; this.off = 0; const J = this.junc(this.e) && this.intent; this.next = this.choose(this.e, J ? this.intent : null); if (J) { this.intent = null; this.turnAt = this.next; } } }
    const f = this.off / e.L, dx = G.X[e.b] - G.X[e.a], dz = G.Z[e.b] - G.Z[e.a], L = e.L || 1, side = Math.max(0, e.hw - 0.9) * (e.oneway ? 0.6 : 1); // cyclists keep to the right edge, out of the cars' way
    const x = G.X[e.a] + dx * f - dz / L * side, z = G.Z[e.a] + dz * f + dx / L * side, y = Math.max(G.Y[e.a] + (G.Y[e.b] - G.Y[e.a]) * f, w.groundAt(x, z)); // keep to the right
    if (this.lastY != null && y > this.lastY) this.climb += (y - this.lastY) / ex; this.lastY = y;
    // look ahead 14 m along the way you are going
    const ahead = (dAhead) => { let ei = this.e, o = this.off + dAhead, nx = this.next; for (let k = 0; k < 4; k++) { const E2 = G.E[ei]; if (o <= E2.L) { const g = o / E2.L; return [G.X[E2.a] + (G.X[E2.b] - G.X[E2.a]) * g, G.Z[E2.a] + (G.Z[E2.b] - G.Z[E2.a]) * g]; } o -= E2.L; ei = nx; nx = this.choose(ei); } return [G.X[e.b], G.Z[e.b]]; };
    const [ax, az] = ahead(14), hd = Math.atan2(ax - G.X[e.a] - dx * f, az - G.Z[e.a] - dz * f); this.hdS = this.hdS == null ? hd : this.hdS + norm((hd - this.hdS) * 180 / Math.PI) * Math.PI / 180 * Math.min(1, dt * 2.5);
    const fx = Math.sin(this.hdS), fz = Math.cos(this.hdS); this.bob += dt * (this.cad || 0) / 60 * Math.PI * 2;
    this.ob = this.ob || { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), cur: 0 }; this.ob.pos.set(x, y, z); this.ob.fwd.set(fx, 0, fz); this.ob.cur = this.v;
    if (this.rider) { this.rider.position.set(x, y, z); this.rider.rotation.y = this.hdS; this.rider.userData.spin(this.v * dt / 0.34, this.bob); this.rider.visible = this.cam !== 'eye'; }
    let pos, look; if (this.cam === 'eye') { pos = new THREE.Vector3(x + fx * 0.2, y + 1.62 + Math.sin(this.bob * 2) * 0.012 * Math.min(1, this.cad / 60), z + fz * 0.2); look = new THREE.Vector3(x + fx * 20, y + 1.2 + this.grade * 20, z + fz * 20); }
    else { pos = new THREE.Vector3(x - fx * 6, y + 3.2, z - fz * 6); look = new THREE.Vector3(x + fx * 8, y + 1, z + fz * 8); }
    w.camera.position.lerp(pos, this.snap ? 1 : 1 - Math.exp(-dt * 10)); w.controls.target.lerp(look, this.snap ? 1 : 1 - Math.exp(-dt * 8)); this.snap = false; w.camera.lookAt(w.controls.target);
    if (this.bars) this.bars.visible = this.cam === 'eye'; const fov = this.cam === 'eye' ? 62 : 50; if (w.camera.fov !== fov) { if (this.fov0 == null) this.fov0 = w.camera.fov; w.camera.fov = fov; w.camera.updateProjectionMatrix(); }
    if ((this.gT = (this.gT || 0) + dt) > 2) { this.gT = 0; if (Math.abs(this.grade - (this.sentG ?? 99)) > 0.004) { this.sentG = this.grade; this.sendGrade(this.grade); } }
    if ((this.uT = (this.uT || 0) + dt) > 0.25) { this.uT = 0; this.upd(y / ex); }
    return new THREE.Vector3(x, y, z);
  }
  // road bike on a smooth road: 75 kg rider + 10 kg bike, CdA 0.32 m², Crr 0.005, air 1.18 kg/m³
  pFromV(v, g) { const m = 85, th = Math.atan(g); return (0.005 * m * 9.81 * Math.cos(th) + m * 9.81 * Math.sin(th) + 0.5 * 1.18 * 0.32 * v * v) * v; }
  vFromP(P, g) { let lo = 0, hi = 30; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (this.pFromV(m, g) > P) hi = m; else lo = m; } return P < 1 && g >= 0 ? 0 : lo; }
  /* ---------- the rider seen from behind, and handlebars in the eye view ---------- */
  bikeModel() { const w = this.w, M = (c, r = 0.6, m = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const g = new THREE.Group(), frame = M(0xc0392b, 0.4, 0.5), dark = M(0x1a1a1a), skin = M(0xc68a5e), shirt = M(0x2f80ed), shorts = M(0x222222);
    const tube = (a, b, r, m) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 8), m); mesh.position.copy(A).add(B).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.add(mesh); return mesh; };
    const wheels = []; for (const zz of [-0.5, 0.52]) { const wh = new THREE.Group(); wh.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 32), dark)); for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.66, 3), M(0xbbbbbb, 0.3, 0.8)); sp.rotation.z = k * Math.PI / 8; wh.add(sp); } wh.rotation.y = Math.PI / 2; wh.position.set(0, 0.34, zz); g.add(wh); wheels.push(wh); }
    tube([0, 0.34, -0.5], [0, 0.36, 0], 0.018, frame); tube([0, 0.36, 0], [0, 0.95, -0.12], 0.022, frame); tube([0, 0.95, -0.12], [0, 0.9, 0.42], 0.022, frame); tube([0, 0.36, 0], [0, 0.9, 0.42], 0.025, frame); tube([0, 0.9, 0.42], [0, 0.34, 0.52], 0.02, frame);
    tube([0, 0.9, 0.42], [0, 1.02, 0.47], 0.02, frame); tube([-0.22, 1.02, 0.5], [0.22, 1.02, 0.5], 0.015, dark); tube([0, 0.95, -0.12], [0, 1.0, -0.15], 0.012, dark);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.26), dark); seat.position.set(0, 1.02, -0.13); g.add(seat);
    // rider: torso leaning forward, arms to the bars, legs on rotating cranks
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 4, 8), shirt); body.position.set(0, 1.3, 0.1); body.rotation.x = 0.95; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.position.set(0, 1.55, 0.36); g.add(head); const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, 1.4), M(0xf2c94c)); helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.03, -0.01)); g.add(helmet);
    for (const s of [-1, 1]) tube([s * 0.16, 1.38, 0.24], [s * 0.2, 1.03, 0.49], 0.035, skin);
    const crank = new THREE.Group(); crank.position.set(0, 0.36, 0); g.add(crank); const legs = [];
    for (const s of [-1, 1]) { const th = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.44, 8), shorts), sh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.44, 8), skin); g.add(th, sh); legs.push([s, th, sh]); }
    g.userData.spin = (dRot, ph) => { for (const wh of wheels) wh.rotation.x -= dRot; for (const [s, th, sh] of legs) { const a = ph + (s > 0 ? 0 : Math.PI), foot = new THREE.Vector3(s * 0.11, 0.36 + Math.sin(a) * 0.17, Math.cos(a) * 0.17), hip = new THREE.Vector3(s * 0.1, 1.0, -0.1);
      const mid = hip.clone().add(foot).multiplyScalar(0.5), d = hip.distanceTo(foot), bend = Math.sqrt(Math.max(0, 0.44 * 0.44 - d * d / 4)), knee = mid.clone().add(new THREE.Vector3(0, 0.05, 1).normalize().multiplyScalar(bend));
      const put = (m, A, B) => { m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); }; put(th, hip, knee); put(sh, knee, foot); } };
    g.userData.spin(0, 0); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); w.scene.add(g); this.rider = g;
    // handlebars, stem and a little bike computer at the bottom of the eye view
    const b = new THREE.Group(); const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 10), dark); bar.rotation.z = Math.PI / 2; b.add(bar);
    for (const s of [-1, 1]) { const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10), M(0x333333, 0.9)); grip.rotation.z = Math.PI / 2; grip.position.x = s * 0.26; b.add(grip); }
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.1), dark); stem.position.set(0, -0.02, 0.05); b.add(stem);
    b.position.set(0, -0.27, -0.58); b.rotation.x = 0.35; w.camera.add(b); w.scene.add(w.camera); this.bars = b; this.snap = true; }
  /* ---------- HUD ---------- */
  hud() { const d = this.box = document.createElement('div'); d.className = 'rideHud'; d.innerHTML = `
    <div class="rdStats"><div class="rdBig"><b id="rdV">0</b><span>km/h</span></div>
      <div><b id="rdCad">0</b><span>rpm</span></div><div><b id="rdPow">0</b><span>W</span></div><div><b id="rdHr">–</b><span>❤️ bpm</span></div>
      <div><b id="rdDist">0.00</b><span>km</span></div><div><b id="rdTime">0:00</b><span>${t('time')}</span></div><div><b id="rdKcal">0</b><span>kcal</span></div><div><b id="rdGrade">0.0%</b><span>${t('slope')}</span></div></div>
    <div class="rdFlash" id="rdFlash" hidden></div>
    <div class="rdCtl"><div class="rdRow"><button id="rdConn">🚲 ${t('Connect bike')}</button><button id="rdAll" title="${t('Bike not in the list? Show all Bluetooth devices')}">🔎</button><button id="rdHrB">❤️ ${t('Heart rate')}</button><span id="rdStat">${t('No bike connected – use ↑ / ↓ or the slider to pedal')}</span></div>
      <div class="rdRow"><label>${t('Virtual pedalling')} <input type="range" id="rdVirt" min="0" max="120" value="0"></label>
        <button id="rdL" title="${t('Turn left at the next junction')} (←)">⬅</button><button id="rdR" title="${t('Turn right at the next junction')} (→)">➡</button>
        <button id="rdCam" title="C">🎥 ${t('View')}</button><button id="rdPause">⏸</button><button id="rdFull" title="F">📺 ${t('Full screen (TV)')}</button><button id="rdHide" title="H">▾</button><button id="rdX">✕</button></div>
      <div class="rdHint">${t('Keys: ↑ ↓ pedal (no bike) · ← → turn at the next junction · C view · F full screen · H hide controls · Esc stop')}</div></div>`;
    document.body.appendChild(d); const $ = id => d.querySelector('#' + id);
    $('rdConn').onclick = () => this.connect(); $('rdAll').onclick = () => this.connect(true); $('rdHrB').onclick = () => this.connectHR(); $('rdVirt').oninput = e => this.virt = +e.target.value;
    $('rdL').onclick = () => this.turn('left'); $('rdR').onclick = () => this.turn('right'); $('rdCam').onclick = () => this.cam = this.cam === 'eye' ? 'chase' : 'eye';
    $('rdPause').onclick = e => { this.paused = !this.paused; e.target.textContent = this.paused ? '▶' : '⏸'; }; $('rdFull').onclick = () => this.fullscreen(); $('rdHide').onclick = () => d.classList.toggle('min'); $('rdX').onclick = () => this.close();
    d.querySelector('.rdStats').onclick = () => d.classList.remove('min'); }
  status(s) { const e = this.box && this.box.querySelector('#rdStat'); if (e) e.textContent = s; }
  flash(s, ms = 2500) { const e = this.box && this.box.querySelector('#rdFlash'); if (!e) return; e.textContent = s; e.hidden = !s; clearTimeout(this._fl); if (s) this._fl = setTimeout(() => { if (!this.intent && !this.turnAt) e.hidden = true; }, ms); }
  upd(elev) { const d = this.box; if (!d) return; const $ = id => d.querySelector('#' + id), tm = Math.floor(this.time);
    $('rdV').textContent = (this.v * 3.6).toFixed(1); $('rdCad').textContent = Math.round(this.cad || 0); $('rdPow').textContent = Math.round(Math.max(0, this.pow || 0)); $('rdHr').textContent = this.s.hr || '–';
    $('rdDist').textContent = (this.dist / 1000).toFixed(2); $('rdTime').textContent = `${Math.floor(tm / 3600) ? Math.floor(tm / 3600) + ':' : ''}${String(Math.floor(tm / 60) % 60).padStart(Math.floor(tm / 3600) ? 2 : 1, '0')}:${String(tm % 60).padStart(2, '0')}`;
    $('rdKcal').textContent = Math.round(this.kcal); $('rdGrade').textContent = `${(this.grade * 100).toFixed(1)}%`; if (!this.src) $('rdVirt').value = Math.round(this.virt); }
}
