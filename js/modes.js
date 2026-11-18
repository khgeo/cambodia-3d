// Player modes: Drive (pick a road, follow the network) and Walk (first-person anywhere)
import * as THREE from 'three';

/* ---------------- road network for the player ---------------- */
export class RoadNet {
  constructor(roads) { // roads: [{pts:[{x,y,z,s}], hw, oneway, cls}]
    this.roads = roads; this.cell = 8; this.grid = new Map();
    roads.forEach((r, ri) => r.pts.forEach((p, k) => {
      const key = Math.floor(p.x / this.cell) + ',' + Math.floor(p.z / this.cell);
      if (!this.grid.has(key)) this.grid.set(key, []); this.grid.get(key).push([ri, k]);
    }));
  }
  near(x, z, r) {
    const out = [], c = this.cell, i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const h of this.grid.get(i + ',' + j) || []) {
      const p = this.roads[h[0]].pts[h[1]], d = Math.hypot(p.x - x, p.z - z); if (d <= r) out.push([h[0], h[1], d]);
    }
    return out.sort((a, b) => a[2] - b[2]);
  }
}

export class Driver {
  constructor(world, net, mesh, kind) { this.w = world; this.net = net; this.mesh = mesh; this.kind = kind; this.speed = 40 / 3.6; this.pos = new THREE.Vector3(); this.fwd = new THREE.Vector3(0, 0, 1); }
  start(ri, k, dir) { this.ri = ri; this.dir = dir; const r = this.net.roads[ri]; this.s = r.pts[k].s; this.lastJump = null; this._init = false; }
  reverse() { this.dir *= -1; }
  // point on the driving lane at arc length s of road ri (clamped to the road)
  lanePoint(ri, s, dir, out) {
    const r = this.net.roads[ri], P = r.pts, L = P[P.length - 1].s; s = THREE.MathUtils.clamp(s, 0, L);
    let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], t = THREE.MathUtils.clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1);
    // lane offset uses the direction over ±4 m so it does not jump at polyline vertices
    const pa = this._at(P, s - 4), pb = this._at(P, s + 4); let tx = (pb.x - pa.x) * dir, tz = (pb.z - pa.z) * dir; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const off = r.oneway ? 0 : Math.max(0.8, r.hw * 0.5) * (this.kind.startsWith('moto') ? 1.35 : 1);
    return out.set(a.x + (b.x - a.x) * t - tz * off, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t + tx * off);
  }
  _at(P, s) {
    s = THREE.MathUtils.clamp(s, 0, P[P.length - 1].s); let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], t = THREE.MathUtils.clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
  step(dt) {
    let r = this.net.roads[this.ri]; const L = r.pts[r.pts.length - 1].s;
    const target = Math.min(this.speed, this.limit ?? Infinity); this.cur = this.cur ?? this.speed; this.cur += THREE.MathUtils.clamp(target - this.cur, -9 * dt, 3.5 * dt);
    this.s += this.cur * dt * this.dir;
    if (this.s < 0 || this.s > L) this.junction(this.s > L ? r.pts.length - 1 : 0);
    // target = lane point now; heading = towards a point a few metres ahead (look-ahead smooths the corners)
    const tgt = this._tgt || (this._tgt = new THREE.Vector3()), ahead = this._ahead || (this._ahead = new THREE.Vector3());
    this.lanePoint(this.ri, this.s, this.dir, tgt);
    const look = Math.max(3, Math.min(9, this.speed * 0.45));
    this.lanePoint(this.ri, this.s + look * this.dir, this.dir, ahead);
    const want = ahead.clone().sub(tgt); if (want.lengthSq() < 1e-6) want.copy(this.fwd); want.normalize();
    if (!this._init) { this.pos.copy(tgt); this.fwd.copy(want); this._init = true; }
    // critically-damped follow: position and heading glide instead of snapping segment to segment
    const kp = 1 - Math.exp(-dt * 14), kh = 1 - Math.exp(-dt * 7);
    this.pos.x += (tgt.x - this.pos.x) * kp; this.pos.z += (tgt.z - this.pos.z) * kp; this.pos.y += (tgt.y - this.pos.y) * (1 - Math.exp(-dt * 6));
    this.fwd.lerp(want, kh).normalize();
    this.mesh.position.copy(this.pos); this.mesh.lookAt(this.pos.clone().add(this.fwd));
  }
  junction(k) {
    const r = this.net.roads[this.ri], p = r.pts[k];
    const head = new THREE.Vector2(p.x - r.pts[Math.max(0, Math.min(r.pts.length - 1, k - this.dir * 2))].x, p.z - r.pts[Math.max(0, Math.min(r.pts.length - 1, k - this.dir * 2))].z).normalize();
    let best = null;
    for (const [ri, kk] of this.net.near(p.x, p.z, 5)) {
      if (ri === this.ri) continue; const rr = this.net.roads[ri], n = rr.pts.length;
      for (const dir of [1, -1]) {
        if (rr.oneway && dir < 0) continue;
        const k2 = kk + dir * 3; if (k2 < 0 || k2 >= n) continue;
        const v = new THREE.Vector2(rr.pts[k2].x - rr.pts[kk].x, rr.pts[k2].z - rr.pts[kk].z).normalize();
        const turn = Math.acos(THREE.MathUtils.clamp(head.dot(v), -1, 1)) + Math.random() * 0.5;
        if (turn < 2.3 && (!best || turn < best.turn)) best = { ri, kk, dir, turn };
      }
    }
    if (best) { this.ri = best.ri; this.dir = best.dir; this.s = this.net.roads[best.ri].pts[best.kk].s + this.dir * 0.1; }
    else { this.dir *= -1; this.s = THREE.MathUtils.clamp(this.s, 0, r.pts[r.pts.length - 1].s); } // dead end: U-turn
  }
}

/* ---------------- first-person walker ---------------- */
export class Walker {
  constructor(world) {
    this.w = world; this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = -0.05; this.move = new THREE.Vector2(); this.run = false; this.keys = {};
    this.onKey = e => { this.keys[e.code] = e.type === 'keydown'; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.run = e.type === 'keydown'; };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
    const el = world.renderer.domElement; let last = null;
    this.onDown = e => { if (!this.active || e.target !== el) return; last = [e.clientX, e.clientY]; el.setPointerCapture?.(e.pointerId); };
    this.onMove = e => {
      if (this.active && e.pointerType === 'mouse' && !e.buttons && e.target === el) { // look by moving the cursor, no drag
        this.yaw -= (e.movementX || 0) * 0.0032; this.pitch = THREE.MathUtils.clamp(this.pitch - (e.movementY || 0) * 0.0026, -1.2, this.maxPitch || 1.0); return;
      }
      if (!this.active || !last) return; this.yaw -= (e.clientX - last[0]) * 0.005; this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - last[1]) * 0.004, -1.2, this.maxPitch || 1.0); last = [e.clientX, e.clientY]; };
    this.onUp = () => { last = null; };
    el.addEventListener('pointerdown', this.onDown); addEventListener('pointermove', this.onMove); addEventListener('pointerup', this.onUp);
  }
  place(x, z, yaw) { this.pos.set(x, 0, z); if (yaw !== undefined) this.yaw = yaw; }
  blocked(x, z) {
    const D = this.w.D; if (!D || !this.w.bmask) return false;
    if (x < D.X0 + 1 || x > D.X0 + D.W - 1 || z < D.Z0 + 1 || z > D.Z0 + D.H - 1) return true;
    const dr = this.w.driver; if (dr && dr.parked && this.w.playerMesh) { const dx = x - dr.pos.x, dz = z - dr.pos.z, f = dr.fwd, al = dx * f.x + dz * f.z, la = dx * f.z - dz * f.x, L = ((this.w.kit[dr.kind] || {}).len || 4.5) / 2 + 0.3; if (Math.abs(al) < L && Math.abs(la) < (dr.kind.startsWith('moto') ? 0.5 : 1.15)) return true; }
    const i = Math.min(D.mw - 1, ((x - D.X0) / D.MR) | 0), j = Math.min(D.mh - 1, ((z - D.Z0) / D.MR) | 0);
    return this.w.bmask[j * D.mw + i] > 0;
  }
  step(dt, cam) {
    const k = this.keys; let fx = this.move.y, sx = this.move.x;
    if (k.KeyW || k.ArrowUp) fx += 1; if (k.KeyS || k.ArrowDown) fx -= 1; if (k.KeyA || k.ArrowLeft) sx -= 1; if (k.KeyD || k.ArrowRight) sx += 1;
    // auto-walk to a target (go-to coordinate); any manual input takes over
    let autoRun = false;
    if (this.auto) {
      if (fx || sx) this.auto = null;
      else {
        const dx = this.auto.x - this.pos.x, dz = this.auto.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.45) { const a = this.auto; this.auto = null; a.onArrive && a.onArrive(); }
        else {
          const want = Math.atan2(-dx, -dz); let da = want - this.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); this.yaw += da * Math.min(1, dt * 5);
          fx = Math.abs(da) < 1.2 ? Math.min(1, d / 1.5 + 0.15) : 0; autoRun = d > 40;
          const p0 = this.auto.last; this.auto.last = { x: this.pos.x, z: this.pos.z };
          if (p0 && Math.hypot(p0.x - this.pos.x, p0.z - this.pos.z) < 1e-4 && fx > 0) { this.auto.stuck = (this.auto.stuck || 0) + dt; if (this.auto.stuck > 1.2) { const a = this.auto; this.auto = null; a.onBlocked && a.onBlocked(); } }
        }
      }
    }
    const len = Math.hypot(fx, sx); if (len > 1) { fx /= len; sx /= len; }
    const m = this.w.mouse; // keep turning while the cursor rests near the screen edge
    if (m && m.inside) { const ex = Math.abs(m.x) - 0.82, ey = Math.abs(m.y) - 0.85; if (ex > 0) this.yaw -= Math.sign(m.x) * ex / 0.18 * 1.6 * dt; if (ey > 0) this.pitch = THREE.MathUtils.clamp(this.pitch - Math.sign(m.y) * ey / 0.15 * 0.8 * dt, -1.2, this.maxPitch || 1.0); }
    const sp = (this.run || autoRun ? 5.5 : 1.6) * dt;
    const fwx = -Math.sin(this.yaw), fwz = -Math.cos(this.yaw), rx = -fwz, rz = fwx;
    const dx = (fwx * fx + rx * sx) * sp, dz = (fwz * fx + rz * sx) * sp;
    if (!this.blocked(this.pos.x + dx, this.pos.z + dz)) { this.pos.x += dx; this.pos.z += dz; }
    else if (!this.blocked(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    else if (!this.blocked(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
    const ground = this.w.groundAt(this.pos.x, this.pos.z);
    const bob = (fx || sx) ? Math.sin(performance.now() / (this.run ? 90 : 160)) * (this.run ? 0.05 : 0.025) : 0;
    this.pos.y += ((ground + 1.65 + bob) - this.pos.y) * Math.min(1, dt * 12);
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/* on-screen joystick for touch screens */
export function joystick(el, onMove) {
  const knob = el.querySelector('.knob'); let id = null, cx = 0, cy = 0;
  const R = 46;
  const set = (x, y) => { const d = Math.hypot(x, y), k = d > R ? R / d : 1; x *= k; y *= k; knob.style.transform = `translate(${x}px,${y}px)`; onMove(x / R, -y / R); };
  el.addEventListener('pointerdown', e => { id = e.pointerId; const b = el.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2; el.setPointerCapture(id); set(e.clientX - cx, e.clientY - cy); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
  const end = e => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; onMove(0, 0); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
