// Field editor: fix the model's field boundaries by hand on the 3D ground – select, move / add / delete vertices,
// draw new fields, split a field with a line, merge two fields, delete, undo. Fields are kept as lon/lat rings.
import * as THREE from 'three';

export class FieldEditor {
  constructor(world, fields, onChange) {
    this.w = world; this.fields = fields; this.onChange = onChange; this.tool = 'select'; this.sel = -1; this.sel2 = -1; this.draft = []; this.undoStack = [];
    this.group = new THREE.Group(); this.group.renderOrder = 50; world.scene.add(this.group); this.active = false; this.drag = null;
    const el = world.renderer.domElement; this.el = el;
    this._down = e => this.down(e); this._move = e => this.move(e); this._up = e => this.up(e);
    el.addEventListener('pointerdown', this._down, true); el.addEventListener('pointermove', this._move); addEventListener('pointerup', this._up);
  }
  dispose() { const el = this.el; el.removeEventListener('pointerdown', this._down, true); el.removeEventListener('pointermove', this._move); removeEventListener('pointerup', this._up); this.w.scene.remove(this.group); }
  // scene <-> lon/lat
  xz(p) { return [this.w.F.x(p[0]), this.w.F.z(p[1])]; }
  ll(x, z) { return [this.w.F.lon(x), this.w.F.lat(z)]; }
  ground(e) { const w = this.w, r = this.el.getBoundingClientRect(), rc = this._rc || (this._rc = new THREE.Raycaster()); rc.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), w.camera); const h = w.terrainMesh && rc.intersectObject(w.terrainMesh, false)[0]; return h ? h.point : null; }
  screen(x, z) { const v = new THREE.Vector3(x, this.w.groundAt(x, z) + 0.5, z).project(this.w.camera), r = this.el.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top, v.z]; }
  snapshot() { this.undoStack.push(JSON.stringify(this.fields)); if (this.undoStack.length > 40) this.undoStack.shift(); }
  undo() { const s = this.undoStack.pop(); if (!s) return; this.fields.splice(0, this.fields.length, ...JSON.parse(s)); this.sel = this.sel2 = -1; this.draw(); this.onChange('undo'); }
  setTool(t) { this.tool = t; this.draft = []; this.sel2 = -1; this.draw(); }
  hit(lon, lat) { // field under a point (the smallest, if nested)
    let best = -1, ba = Infinity; this.fields.forEach((f, i) => { const r = f.ring; let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > lat) !== (r[b][1] > lat) && lon < (r[b][0] - r[a][0]) * (lat - r[a][1]) / (r[b][1] - r[a][1]) + r[a][0]) c = !c; if (c && f.area_m2 < ba) { ba = f.area_m2; best = i; } }); return best;
  }
  // snap a new point to a nearby vertex of any field (keeps neighbouring edges together)
  snap(x, z, tol = 1.6) { let best = null, bd = tol; for (const f of this.fields) for (const p of f.ring) { const [px, pz] = this.xz(p), d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = [px, pz]; } } return best || [x, z]; }
  vertexAt(e, px = 12) { if (this.sel < 0) return null; const R = this.fields[this.sel].ring; let best = null, bd = px;
    R.forEach((p, i) => { const [x, z] = this.xz(p), [sx, sy] = this.screen(x, z), d = Math.hypot(sx - e.clientX, sy - e.clientY); if (d < bd) { bd = d; best = { i, mid: false }; } });
    if (!best) R.forEach((p, i) => { const q = R[(i + 1) % R.length], [ax, az] = this.xz(p), [bx, bz] = this.xz(q), [sx, sy] = this.screen((ax + bx) / 2, (az + bz) / 2), d = Math.hypot(sx - e.clientX, sy - e.clientY); if (d < bd) { bd = d; best = { i, mid: true }; } });
    return best; }
  down(e) {
    if (!this.active || e.button !== 0 || this.w.mode !== 'orbit') return;
    if (this.tool === 'select' && this.sel >= 0) { const v = this.vertexAt(e); if (v) { this.snapshot(); const R = this.fields[this.sel].ring; if (v.mid) { const q = R[(v.i + 1) % R.length]; R.splice(v.i + 1, 0, [(R[v.i][0] + q[0]) / 2, (R[v.i][1] + q[1]) / 2]); v.i++; }
      this.drag = v.i; this.w.controls.enabled = false; e.stopImmediatePropagation(); e.preventDefault(); } }
  }
  move(e) { if (this.drag == null) return; const p = this.ground(e); if (!p) return; const [x, z] = this.snap(p.x, p.z, 1.2), R = this.fields[this.sel].ring; R[this.drag] = this.ll(x, z); this.drawSel(); }
  up() { if (this.drag == null) return; this.drag = null; this.w.controls.enabled = true; this.touch(this.sel); this.draw(); this.onChange('vertex'); this.w._suppressTap = performance.now(); }
  // a tap on the ground (from the world's tap handler)
  tap(x, z, e) {
    if (this.w._suppressTap && performance.now() - this.w._suppressTap < 300) return;
    const [lon, lat] = this.ll(x, z);
    if (this.tool === 'select') { const i = this.hit(lon, lat); if (e && e.shiftKey && this.sel >= 0 && i >= 0 && i !== this.sel) this.sel2 = i; else { this.sel = i; this.sel2 = -1; } this.draw(); this.onChange('select'); return; }
    if (this.tool === 'draw' || this.tool === 'split') { const [sx, sz] = this.snap(x, z); this.draft.push([sx, sz]); if (this.tool === 'split' && this.draft.length === 2) this.finish(); else this.drawDraft(); }
  }
  // right-click: finish a drawing, or delete the vertex under the cursor
  rightClick(e) { if (this.tool === 'draw' && this.draft.length) { this.finish(); return true; } if (this.tool === 'select' && this.sel >= 0 && e) { const v = this.vertexAt(e); if (v && !v.mid && this.fields[this.sel].ring.length > 3) { this.snapshot(); this.fields[this.sel].ring.splice(v.i, 1); this.touch(this.sel); this.draw(); this.onChange('vertex'); return true; } } return false; }
  finish() {
    if (this.tool === 'draw') { if (this.draft.length < 3) return; this.snapshot(); this.fields.push({ ring: this.draft.map(([x, z]) => this.ll(x, z)), conf: 1, rect: 1, src: 'digitized' }); this.touch(this.fields.length - 1); this.sel = this.fields.length - 1; this.draft = []; this.draw(); this.onChange('add'); }
    else if (this.tool === 'split') { const [a, b] = this.draft; this.draft = []; const i = this.sel >= 0 ? this.sel : this.hit(...this.ll((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)); if (i < 0) { this.draw(); return; }
      const R = this.fields[i].ring.map(p => this.xz(p)), side = (p, s) => s * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
      const clip = s => { const out = []; for (let k = 0; k < R.length; k++) { const P = R[k], Q = R[(k + 1) % R.length], ip = side(P, s), iq = side(Q, s); if (ip) out.push(P); if (ip !== iq) { const d1 = (b[0] - a[0]) * (P[1] - a[1]) - (b[1] - a[1]) * (P[0] - a[0]), d2 = (b[0] - a[0]) * (Q[1] - a[1]) - (b[1] - a[1]) * (Q[0] - a[0]), t = d1 / (d1 - d2); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } } return out; };
      const A = clip(1), B = clip(-1); if (A.length < 3 || B.length < 3) { this.draw(); return; }
      this.snapshot(); const f = this.fields[i]; this.fields.splice(i, 1, { ...f, ring: A.map(([x, z]) => this.ll(x, z)), src: 'edited' }, { ...f, ring: B.map(([x, z]) => this.ll(x, z)), src: 'edited' }); this.touch(i); this.touch(i + 1); this.sel = i; this.draw(); this.onChange('split'); }
  }
  async merge(turf) { if (this.sel < 0 || this.sel2 < 0) return false; const T = await turf(), a = this.fields[this.sel], b = this.fields[this.sel2];
    // close the bund gap between them first, then union and shrink back
    const P = f => T.buffer(T.polygon([[...f.ring, f.ring[0]]]), 0.0015, { units: 'kilometers', steps: 2 }); let u = T.union(T.featureCollection([P(a), P(b)])); if (!u) return false; u = T.buffer(u, -0.0015, { units: 'kilometers', steps: 2 }); let g = u.geometry; if (g.type === 'MultiPolygon') g = { type: 'Polygon', coordinates: g.coordinates.sort((p, q) => T.area(T.polygon(q)) - T.area(T.polygon(p)))[0] };
    this.snapshot(); const keep = Math.min(this.sel, this.sel2), drop = Math.max(this.sel, this.sel2); this.fields.splice(drop, 1); this.fields[keep] = { ...a, ring: T.simplify(T.polygon(g.coordinates), { tolerance: 0.000005 }).geometry.coordinates[0].slice(0, -1), src: 'edited' }; this.touch(keep); this.sel = keep; this.sel2 = -1; this.draw(); this.onChange('merge'); return true; }
  remove() { if (this.sel < 0) return; this.snapshot(); this.fields.splice(this.sel, 1); this.sel = this.sel2 = -1; this.draw(); this.onChange('delete'); }
  // recompute area / perimeter of an edited field (local metres)
  touch(i) { const f = this.fields[i]; if (!f) return; const R = f.ring.map(p => this.xz(p)); let a = 0, per = 0; for (let k = 0, j = R.length - 1; k < R.length; j = k++) { a += R[j][0] * R[k][1] - R[k][0] * R[j][1]; per += Math.hypot(R[k][0] - R[j][0], R[k][1] - R[j][1]); } f.area_m2 = Math.abs(a / 2); f.perim_m = per; if (!f.src || f.src === 'model') f.src = 'edited'; }
  // drawing: selected field (cyan), its vertex handles (white) and edge midpoints (small), the draft line (magenta)
  line(pts, color, closed, lift = 0.9) { if (pts.length < 2) return; const w = this.w, P = []; const L = closed ? [...pts, pts[0]] : pts;
    for (let k = 1; k < L.length; k++) { const [ax, az] = L[k - 1], [bx, bz] = L[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4)); for (let t = 0; t <= n; t++) { const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n; P.push(new THREE.Vector3(x, w.groundAt(x, z) + lift, z)); } }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(P), new THREE.LineBasicMaterial({ color, depthTest: false })); l.renderOrder = 60; this.group.add(l); }
  dot(x, z, color, r) { const m = new THREE.Mesh(this._sph || (this._sph = new THREE.SphereGeometry(1, 10, 8)), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.scale.setScalar(r); m.position.set(x, this.w.groundAt(x, z) + 0.9, z); m.renderOrder = 61; this.group.add(m); }
  clear() { for (const c of [...this.group.children]) { this.group.remove(c); c.geometry !== this._sph && c.geometry.dispose(); c.material.dispose(); } }
  drawSel() { this.clear(); if (!this.active) return; const dist = this.w.camera.position.distanceTo(this.w.controls.target), r = Math.max(0.6, dist / 260);
    for (const [i, col] of [[this.sel, 0x00e5ff], [this.sel2, 0xff7a00]]) { if (i < 0 || !this.fields[i]) continue; const R = this.fields[i].ring.map(p => this.xz(p)); this.line(R, col, true);
      if (i === this.sel && this.tool === 'select') R.forEach(([x, z], k) => { this.dot(x, z, 0xffffff, r); const [x2, z2] = R[(k + 1) % R.length]; this.dot((x + x2) / 2, (z + z2) / 2, 0x00e5ff, r * 0.6); }); }
    this.drawDraft(true); }
  drawDraft(keep) { if (!keep) this.drawSel(); if (this.draft.length) { this.line(this.draft, 0xff3df2, false); this.draft.forEach(([x, z]) => this.dot(x, z, 0xff3df2, 0.8)); } }
  draw() { this.drawSel(); }
}
