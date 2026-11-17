// 3D tactical overlay and terrain analysis, after the author's Terrain Ops / TacMap KH QGIS plugins:
// TacMap symbols (NATO or Khmer/Soviet colours) on poles, line and area symbols draped on the ground,
// line of sight with profile, viewshed, GO / SLOW-GO / NO-GO mobility, range rings, own ↔ enemy measurement.
// For planning and training from open data – confirm on the ground.
import * as THREE from 'three';
import { TO_SAT2TOPO } from './landcover.js?v=26';

const KEY = 'cambodia3d.tac.v1';
let CAT = null, MOB = null;
export async function loadCatalog() {
  if (!CAT) CAT = await (await fetch('tac/catalog.json?v=1')).json();
  if (!MOB) MOB = await (await fetch('tac/mobility.json?v=1')).json();
  return { CAT, MOB };
}
const svgCache = new Map();
export async function symbolURL(code, color) {
  const k = code + color; if (svgCache.has(k)) return svgCache.get(k);
  const d = CAT.catalog[code]; if (!d || !d.svg) return null;
  let txt = await (await fetch('tac/svg/' + d.svg)).text();
  txt = txt.replace(/param\([^)]*\)\s*/g, '').replace(/#e8173d/gi, color);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt); svgCache.set(k, url); return url;
}
const img = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
export const mils = deg => deg * 6400 / 360;

export class Tactical {
  constructor(world) {
    this.w = world; this.group = new THREE.Group(); this.anal = new THREE.Group(); this.prev = new THREE.Group();
    this.side = 'own'; this.conv = 'nato'; this.code = 'flag_rect'; this.mode = 'place'; this.verts = []; this.label = '';
    this.obsH = 2; this.tgtH = 2; this.vsR = 1500; this.vehicle = 'wheeled'; this.season = 'dry';
    try { this.features = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { this.features = []; }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.features)); } catch (e) { } }
  color(side, code) { const d = CAT.catalog[code]; if (d && d.fixed) return d.fixed; const c = CAT.conventions[this.conv]; return side === 'own' ? c[2] : side === 'enemy' ? c[3] : c[4]; }
  get F() { return this.w.F; }
  ll(x, z) { return [+this.F.lon(x).toFixed(7), +this.F.lat(z).toFixed(7)]; }
  xz(c) { return { x: this.F.x(c[0]), z: this.F.z(c[1]) }; }
  inAOI(f) { const D = this.w.D; return f.coords.some(c => { const p = this.xz(c); return p.x >= D.X0 && p.x <= D.X0 + D.W && p.z >= D.Z0 && p.z <= D.Z0 + D.H; }); }
  geomOf(code) { return CAT.catalog[code].geom; }
  /* ---------- input ---------- */
  tap(x, z) {
    const m = this.mode;
    if (m === 'delete') { this.deleteNear(x, z); return; }
    if (m === 'move') { if (!this.moving) { this.moving = this.nearest(x, z, 40, f => f.geom === 'point'); this.onMsg && this.onMsg(this.moving ? 'Now tap the new place' : 'Tap a symbol first'); } else { this.moving.coords = [this.ll(x, z)]; this.moving = null; this.save(); this.rebuild(); this.onChange && this.onChange(); } return; }
    if (m === 'los' || m === 'measure') { this.verts.push({ x, z }); if (this.verts.length === 2) { const [a, b] = this.verts; this.verts = []; this.lineOfSight(a, b); } this.drawPreview(); return; }
    if (m === 'viewshed') { this.viewshed(x, z); return; }
    if (m === 'ring') { this.add({ code: 'range_ring', geom: 'circle', side: this.side, coords: [this.ll(x, z)], props: { rings: this.rings || [500, 1000, 1500] } }); return; }
    const g = this.geomOf(this.code);
    if (g === 'point') { this.add({ code: this.code, geom: 'point', side: this.side, coords: [this.ll(x, z)], label: this.label }); return; }
    if (g === 'circle') { this.add({ code: this.code, geom: 'circle', side: this.side, coords: [this.ll(x, z)], props: { rings: this.rings || [500, 1000, 1500] } }); return; }
    this.verts.push({ x, z });
    if (g === 'sector' && this.verts.length === 3) { this.finish(); return; }
    if (g === 'dimension' && this.verts.length === 2) { this.finish(); return; }
    this.drawPreview(); this.onChange && this.onChange();
  }
  finish() {
    const g = this.geomOf(this.code), V = this.verts; let ok = false;
    if ((g === 'line' || g === 'dimension') && V.length >= 2) ok = true;
    if (g === 'polygon' && V.length >= 3) ok = true;
    if (g === 'sector' && V.length === 3) ok = true;
    if (ok) this.add({ code: this.code, geom: g, side: this.side, coords: V.map(p => this.ll(p.x, p.z)), label: this.label }, true);
    this.verts = []; this.drawPreview(); this.onChange && this.onChange(); return ok;
  }
  undo() { this.verts.pop(); this.drawPreview(); this.onChange && this.onChange(); }
  cancel() { this.verts = []; this.moving = null; this.drawPreview(); this.onChange && this.onChange(); }
  add(f, keep) { f.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); this.features.push(f); this.save(); this.rebuild(); if (!keep) this.verts = []; this.onChange && this.onChange(); }
  nearest(x, z, tol, filter) {
    let best = null, bd = tol;
    for (const f of this.features) { if (!this.inAOI(f) || (filter && !filter(f))) continue; for (const c of f.coords) { const p = this.xz(c), d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = f; } } }
    return best;
  }
  deleteNear(x, z) { const f = this.nearest(x, z, 40); if (!f) return; this.features = this.features.filter(q => q !== f); this.save(); this.rebuild(); this.onChange && this.onChange(); }
  clearAll() { this.features = this.features.filter(f => !this.inAOI(f)); this.save(); this.clearAnalysis(); this.rebuild(); this.onChange && this.onChange(); }
  clearAnalysis() { this.anal.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); this.anal.clear(); this.result = null; this.mobility = null; }
  /* ---------- 3D drawing ---------- */
  async rebuild() {
    const w = this.w; if (!w.D || !w.hAt || !CAT) return;
    for (const g of [this.group, this.anal, this.prev]) if (!g.parent) w.root.add(g);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group.clear();
    const ext = Math.max(w.D.W, w.D.H), lw = Math.max(1.2, ext / 700);
    for (const f of this.features.filter(f => this.inAOI(f))) {
      const col = this.color(f.side, f.code), P = f.coords.map(c => this.xz(c));
      if (f.geom === 'point') await this.pointSymbol(f, P[0], col);
      else if (f.geom === 'line' || f.geom === 'dimension') this.lineSymbol(f, P, col, lw);
      else if (f.geom === 'polygon') this.areaSymbol(f, P, col, lw);
      else if (f.geom === 'circle') for (const r of (f.props && f.props.rings) || [1000]) this.ring(P[0], r, col, lw * 0.7, `${r >= 1000 ? r / 1000 + ' km' : r + ' m'}`);
      else if (f.geom === 'sector') this.sector(P, col, lw);
    }
  }
  async pointSymbol(f, p, col) {
    const w = this.w, y = w.hAt(p.x, p.z), H = Math.max(8, Math.max(w.D.W, w.D.H) / 150), g = new THREE.Group(); g.position.set(p.x, y, p.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.012, H * 0.012, H, 6).translate(0, H / 2, 0), new THREE.MeshBasicMaterial({ color: 0x222222 })); g.add(pole);
    const foot = new THREE.Mesh(new THREE.RingGeometry(H * 0.05, H * 0.09, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); foot.position.y = 0.2; g.add(foot);
    try {
      const url = await symbolURL(f.code, col), im = await img(url), c = document.createElement('canvas'), S = 160; c.width = S; c.height = S + (f.label ? 44 : 0); const x = c.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,.0)'; x.drawImage(im, 0, 0, S, S);
      if (f.label) { x.font = '700 30px system-ui, "Noto Sans Khmer", sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = '#fff'; x.strokeText(f.label, S / 2, S + 32); x.fillStyle = col; x.fillText(f.label, S / 2, S + 32); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true })); sp.center.set(0.5, f.label ? 44 / (S + 44) : 0); sp.renderOrder = 15;
      const k = 0.042; sp.scale.set(k, k * c.height / S, 1); sp.position.y = H; g.add(sp);
    } catch (e) { console.warn(e); }
    g.userData.fid = f.id; this.group.add(g);
  }
  // ribbon draped over the ground along pts (x,z), optional dash pattern
  drape(pts, width, color, opts = {}) {
    const w = this.w, S = [];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 3)); for (let k = i ? 1 : 0; k <= n; k++) S.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
    let s = 0; S.forEach((p, i) => { if (i) s += Math.hypot(p.x - S[i - 1].x, p.z - S[i - 1].z); p.s = s; });
    const pos = [], idx = [], hw = width / 2, dash = opts.dash;
    S.forEach((p, i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, y = w.hAt(p.x, p.z) + 0.6;
      pos.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
      if (i) { const on = !dash || ((S[i - 1].s % (dash[0] + dash[1])) < dash[0]); if (on) { const k = 2 * i; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); } } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: !opts.top, transparent: !!opts.opacity, opacity: opts.opacity ?? 1, polygonOffset: true, polygonOffsetFactor: -4 })); m.renderOrder = 9;
    (opts.group || this.group).add(m); return S;
  }
  flat(shape2d, y, color, op = 1, group) { // small flat decoration (triangle, disc …) lying on the ground
    const g = new THREE.ShapeGeometry(shape2d).rotateX(-Math.PI / 2); g.translate(0, y, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: op < 1, opacity: op, polygonOffset: true, polygonOffsetFactor: -5 })); m.renderOrder = 9; (group || this.group).add(m); return m;
  }
  lineSymbol(f, P, col, lw) {
    const c = f.code, w = this.w, along = (S, every, fn) => { let next = every / 2; for (let i = 1; i < S.length; i++) if (S[i].s >= next) { const a = S[i - 1], b = S[i], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; fn(b, tx / l, tz / l); next += every; } };
    const tri = (p, tx, tz, size, side = 1) => { const nx = -tz * side, nz = tx * side, sh = new THREE.Shape([new THREE.Vector2(p.x - tx * size * 0.5, -(p.z - tz * size * 0.5)), new THREE.Vector2(p.x + tx * size * 0.5, -(p.z + tz * size * 0.5)), new THREE.Vector2(p.x + nx * size, -(p.z + nz * size))]); this.flat(sh, w.hAt(p.x, p.z) + 0.7, col); };
    const arrowHead = (S, size) => { const b = S[S.length - 1], a = S[Math.max(0, S.length - 4)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, ux = tx / l, uz = tz / l, nx = -uz, nz = ux;
      this.flat(new THREE.Shape([new THREE.Vector2(b.x + ux * size, -(b.z + uz * size)), new THREE.Vector2(b.x + nx * size * 0.7, -(b.z + nz * size * 0.7)), new THREE.Vector2(b.x - nx * size * 0.7, -(b.z - nz * size * 0.7))]), w.hAt(b.x, b.z) + 0.7, col); };
    const U = lw * 6;
    if (c === 'axis' || c === 'axis_planned') { const S = this.drape(P, lw * 5, col, { dash: c === 'axis_planned' ? [U * 2, U] : null, opacity: 0.85 }); arrowHead(S, lw * 9); }
    else if (c === 'route' || c === 'fire_direction') { const S = this.drape(P, lw * 1.4, col, { dash: c === 'route' ? [U, U * 0.6] : null }); arrowHead(S, lw * 5); }
    else if (c === 'phase_line') { const S = this.drape(P, lw * 1.2, '#222222', { dash: [U * 1.5, U * 0.8] }); this.tag(S[Math.floor(S.length / 2)], f.label || 'PL', '#222222'); }
    else if (c === 'boundary_dash' || c === 'boundary_dashdot') this.drape(P, lw, '#222222', { dash: c === 'boundary_dash' ? [U, U * 0.7] : [U * 1.6, U * 0.5] });
    else if (c === 'trench' || c === 'trench_zigzag' || c === 'fortified_line') { const S = this.drape(P, lw * 1.2, col); along(S, U * 0.8, (p, tx, tz) => this.drape([p, { x: p.x - tz * U * 0.5, z: p.z + tx * U * 0.5 }], lw * 0.8, col)); }
    else if (c === 'front_line' || c === 'boundary_arc') { const S = this.drape(P, lw * 1.2, col); along(S, U * 1.6, (p, tx, tz) => { const r = U * 0.45, sh = new THREE.Shape(); sh.absarc(p.x, -p.z, r, Math.atan2(-tz, tx), Math.atan2(-tz, tx) + Math.PI, false); this.flat(sh, w.hAt(p.x, p.z) + 0.7, col); }); }
    else if (c === 'wire' || c === 'abatis') { const S = this.drape(P, lw, col); along(S, U, (p, tx, tz) => { const r = U * 0.3; this.drape([{ x: p.x - tx * r - tz * r, z: p.z - tz * r + tx * r }, { x: p.x + tx * r + tz * r, z: p.z + tz * r - tx * r }], lw * 0.7, col); this.drape([{ x: p.x - tx * r + tz * r, z: p.z - tz * r - tx * r }, { x: p.x + tx * r - tz * r, z: p.z + tz * r + tx * r }], lw * 0.7, col); }); }
    else if (c === 'minefield_line' || c === 'obstacle_belt') { const S = this.drape(P, lw, col); along(S, U * 1.2, (p) => { const sh = new THREE.Shape(); sh.absarc(p.x, -p.z, U * 0.25, 0, Math.PI * 2); this.flat(sh, w.hAt(p.x, p.z) + 0.7, col); }); }
    else if (c === 'at_ditch') { const S = this.drape(P, lw * 1.2, col); along(S, U, (p, tx, tz) => tri(p, tx, tz, U * 0.6)); }
    else if (c === 'dimension') { const S = this.drape(P, lw * 0.8, '#222222'); arrowHead(S, lw * 4); arrowHead(S.slice().reverse(), lw * 4); const m = S[Math.floor(S.length / 2)], L = S[S.length - 1].s; this.tag(m, L >= 1000 ? (L / 1000).toFixed(2) + ' km' : L.toFixed(0) + ' m', '#222222'); }
    else this.drape(P, lw * 1.4, col);
    if (f.label && c !== 'phase_line' && c !== 'dimension') this.tag(P[0], f.label, col);
  }
  areaSymbol(f, P, col, lw) {
    const w = this.w, c = f.code, closed = [...P, P[0]];
    const dash = c === 'zone' ? [lw * 6, lw * 4] : null;
    if (c === 'def_area') { const S = this.drape(closed, lw * 1.3, col); let next = lw * 3; for (let i = 1; i < S.length; i++) if (S[i].s >= next) { const a = S[i - 1], b = S[i], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; this.drape([b, { x: b.x + tz / l * lw * 3, z: b.z - tx / l * lw * 3 }], lw * 0.8, col); next += lw * 5; } }
    else this.drape(closed, lw * 1.3, col, { dash });
    const shape = new THREE.Shape(P.map(p => new THREE.Vector2(p.x, -p.z))), g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), pa = g.attributes.position;
    // lift the fill onto the ground (subdivide large areas first)
    let geo = g; if (pa.count < 400) geo = subdivide(g, Math.max(3, Math.sqrt(Math.abs(THREE.ShapeUtils.area(shape.getPoints()))) / 40));
    const q = geo.attributes.position; for (let i = 0; i < q.count; i++) q.setY(i, w.hAt(q.getX(i), q.getZ(i)) + 0.4);
    const pattern = c === 'obstacle_area' || c === 'impassable' || c === 'minefield_area';
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: pattern ? 0.32 : 0.16, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 8; this.group.add(m);
    if (pattern) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } const st = lw * 6;
      for (let k = x0 - (z1 - z0); k < x1; k += st) { const seg = clipSeg(P, { x: k, z: z0 }, { x: k + (z1 - z0), z: z1 }); for (const s of seg) this.drape(s, lw * 0.5, col); if (c === 'impassable') for (const s of clipSeg(P, { x: k, z: z1 }, { x: k + (z1 - z0), z: z0 })) this.drape(s, lw * 0.5, col); } }
    if (f.label || c === 'objective') { const cx = P.reduce((s, p) => s + p.x, 0) / P.length, cz = P.reduce((s, p) => s + p.z, 0) / P.length; this.tag({ x: cx, z: cz }, f.label || 'OBJ', col); }
  }
  ring(p, r, col, lw, text, group) {
    const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }); }
    const D = this.w.D, inside = q => q.x > D.X0 && q.x < D.X0 + D.W && q.z > D.Z0 && q.z < D.Z0 + D.H; let run = [];
    for (const q of pts) { if (inside(q)) run.push(q); else { if (run.length > 1) this.drape(run, lw, col, { dash: [lw * 6, lw * 4], group }); run = []; } } if (run.length > 1) this.drape(run, lw, col, { dash: [lw * 6, lw * 4], group });
    const lab = pts.find(inside); if (lab) this.tag(lab, text, col, group);
  }
  sector([c, a, b], col, lw) {
    const r = Math.hypot(a.x - c.x, a.z - c.z), a0 = Math.atan2(a.z - c.z, a.x - c.x); let a1 = Math.atan2(b.z - c.z, b.x - c.x); if (a1 < a0) a1 += Math.PI * 2;
    const pts = [c]; for (let i = 0; i <= 40; i++) { const t = a0 + (a1 - a0) * i / 40; pts.push({ x: c.x + Math.cos(t) * r, z: c.z + Math.sin(t) * r }); } pts.push(c);
    this.drape(pts, lw, col); const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z))); const g = subdivide(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), Math.max(3, r / 40)), q = g.attributes.position;
    for (let i = 0; i < q.count; i++) q.setY(i, this.w.hAt(q.getX(i), q.getZ(i)) + 0.4);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); this.group.add(m);
  }
  tag(p, text, col, group) {
    const c = document.createElement('canvas'), x = c.getContext('2d'); x.font = '700 30px system-ui, "Noto Sans Khmer", sans-serif'; const wd = Math.ceil(x.measureText(text).width) + 22; c.width = wd; c.height = 44;
    x.font = '700 30px system-ui, "Noto Sans Khmer", sans-serif'; x.fillStyle = 'rgba(255,255,255,.88)'; x.beginPath(); x.roundRect(0, 0, wd, 44, 8); x.fill(); x.fillStyle = col; x.textBaseline = 'middle'; x.fillText(text, 11, 23);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
    s.center.set(0.5, -0.2); s.renderOrder = 16; const h = 0.02; s.scale.set(h * wd / 44, h, 1); s.position.set(p.x, this.w.hAt(p.x, p.z) + 1, p.z); (group || this.group).add(s); return s;
  }
  drawPreview() {
    const w = this.w, g = this.prev; g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); if (!this.verts.length || !w.hAt) return;
    const pts = this.verts.map(p => new THREE.Vector3(p.x, w.hAt(p.x, p.z) + 1, p.z));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff3df2, depthTest: false })); l.renderOrder = 20; g.add(l);
    for (const p of pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1, Math.max(w.D.W, w.D.H) / 600), 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3df2, depthTest: false })); s.position.copy(p); s.renderOrder = 20; g.add(s); }
  }
  /* ---------- terrain analysis ---------- */
  // ground + obstructions: tree canopy and buildings block sight (bare ground is used for movement)
  surface(x, z) {
    const w = this.w, D = w.D, h = w.rawElevation(x, z); if (!D.lc) return h;
    const k = D.lc[Math.min(D.gh - 1, Math.max(0, ((z - D.Z0) / D.C) | 0)) * D.gw + Math.min(D.gw - 1, Math.max(0, ((x - D.X0) / D.C) | 0))];
    return h + ({ 3: 15, 4: 10, 6: 8, 5: 3, 12: 6 })[k] || h + 0;
  }
  lineOfSight(A, B) {
    const w = this.w; this.clearAnalysis();
    const L = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(20, Math.ceil(L / 2)), oh = w.rawElevation(A.x, A.z) + this.obsH, th = w.rawElevation(B.x, B.z) + this.tgtH, prof = [];
    let blocked = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, g = w.rawElevation(x, z), s = t * L < 15 || (1 - t) * L < 15 ? g : this.surface(x, z), ray = oh + (th - oh) * t; // own position's trees do not block
      prof.push({ d: t * L, g, s, ray }); if (blocked < 0 && i > 0 && i < n && s > ray) blocked = i;
    }
    // seen / hidden along the ground from the observer (each sample against the running horizon)
    let maxA = -Infinity; const seen = prof.map((p, i) => { if (i === 0) return true; const a = (p.g + this.tgtH - oh) / p.d, vis = a >= maxA; maxA = Math.max(maxA, (p.s - oh) / p.d); return vis; });
    const S = prof.map((p, i) => ({ x: A.x + (B.x - A.x) * i / n, z: A.z + (B.z - A.z) * i / n })), lw = Math.max(1.5, Math.max(w.D.W, w.D.H) / 500);
    let run = [S[0]], cur = seen[0];
    for (let i = 1; i < S.length; i++) { if (seen[i] !== cur) { run.push(S[i]); this.drape(run, lw, cur ? '#29d06a' : '#ff3b30', { group: this.anal }); run = [S[i]]; cur = seen[i]; } else run.push(S[i]); }
    this.drape(run, lw, cur ? '#29d06a' : '#ff3b30', { group: this.anal });
    // the sight ray itself, floating
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(A.x, w.hAt(A.x, A.z) + this.obsH * (w.exag || 1), A.z), new THREE.Vector3(B.x, w.hAt(B.x, B.z) + this.tgtH * (w.exag || 1), B.z)]), new THREE.LineDashedMaterial({ color: blocked < 0 ? 0x29d06a : 0xff3b30, dashSize: 4, gapSize: 3, depthTest: false }));
    ray.computeLineDistances(); ray.renderOrder = 18; this.anal.add(ray);
    const dh = w.rawElevation(B.x, B.z) - w.rawElevation(A.x, A.z), brg = (Math.atan2(B.x - A.x, -(B.z - A.z)) * 180 / Math.PI + 360) % 360;
    let d3 = 0; for (let i = 1; i < prof.length; i++) d3 += Math.hypot(prof[i].d - prof[i - 1].d, prof[i].g - prof[i - 1].g);
    this.result = { kind: 'los', L, d3, dh, brg, mils: mils(brg), visible: blocked < 0, blockAt: blocked < 0 ? null : prof[blocked].d, seenPct: seen.filter(Boolean).length / seen.length * 100, prof, A, B };
    this.tag(A, 'A', '#111'); this.tag(B, blocked < 0 ? 'B ✓' : 'B ✕', blocked < 0 ? '#178a45' : '#c0392b', this.anal);
    this.onResult && this.onResult(this.result);
  }
  viewshed(x, z) {
    const w = this.w, D = w.D; this.clearAnalysis();
    const R = this.vsR, st = Math.max(4, R / 160), N = Math.ceil(2 * R / st), vis = new Uint8Array(N * N), oh = w.rawElevation(x, z) + this.obsH, rays = Math.ceil(2 * Math.PI * R / st);
    for (let k = 0; k < rays; k++) {
      const a = k / rays * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); let maxA = -Infinity;
      for (let d = st; d <= R; d += st * 0.7) {
        const px = x + ca * d, pz = z + sa * d; if (px < D.X0 || px > D.X0 + D.W || pz < D.Z0 || pz > D.Z0 + D.H) break;
        const g = w.rawElevation(px, pz), ang = (g + this.tgtH - oh) / d, i = Math.floor((px - x + R) / st), j = Math.floor((pz - z + R) / st);
        if (i >= 0 && j >= 0 && i < N && j < N) vis[j * N + i] = ang >= maxA ? 2 : Math.max(vis[j * N + i], 1);
        maxA = Math.max(maxA, ((d < 15 ? g : this.surface(px, pz)) - oh) / d);
      }
    }
    let seen = 0, tot = 0; const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), im = g.createImageData(N, N);
    for (let q = 0; q < vis.length; q++) { if (!vis[q]) continue; tot++; const v = vis[q] === 2; if (v) seen++; im.data.set(v ? [41, 208, 106, 120] : [255, 59, 48, 95], q * 4); }
    g.putImageData(im, 0, 0);
    this.drapeTexture(c, x - R, z - R, 2 * R, 2 * R);
    this.tag({ x, z }, `👁 ${(seen / Math.max(1, tot) * 100).toFixed(0)}%`, '#178a45', this.anal);
    this.ring({ x, z }, R, '#178a45', Math.max(1, Math.max(D.W, D.H) / 900), `${R} m`, this.anal);
    this.result = { kind: 'viewshed', x, z, R, seenPct: seen / Math.max(1, tot) * 100, obsH: this.obsH };
    this.onResult && this.onResult(this.result);
  }
  // a texture laid over the terrain inside the rectangle (x0, z0, w, h)
  drapeTexture(canvas, x0, z0, ww, hh) {
    const w = this.w, D = w.D, geo = w.terrainMesh.geometry.clone(), P = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) { uv.setXY(i, (P.getX(i) - x0) / ww, 1 - (P.getZ(i) - z0) / hh); P.setY(i, P.getY(i) + 0.5); }
    uv.needsUpdate = true; P.needsUpdate = true;
    const c2 = document.createElement('canvas'); c2.width = canvas.width + 2; c2.height = canvas.height + 2; c2.getContext('2d').drawImage(canvas, 1, 1); // transparent border
    const t = new THREE.CanvasTexture(c2); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.renderOrder = 7; this.anal.add(m); return m;
  }
  // GO / SLOW-GO / NO-GO over the area from slope, land cover, water, roads and season (rules in tac/mobility.json)
  mobilityMap() {
    const w = this.w, D = w.D; this.clearAnalysis(); if (!D.lc) return;
    const prof = MOB.profiles[this.vehicle], lcRules = this.season === 'wet' ? prof.landcover_wet : prof.landcover_dry, [s1, s2] = prof.slope;
    const st = 5, nx = Math.ceil(D.W / st), nz = Math.ceil(D.H / st), c = document.createElement('canvas'); c.width = nx; c.height = nz; const g = c.getContext('2d'), im = g.createImageData(nx, nz), cnt = { GO: 0, SLOW: 0, NO: 0 };
    const mAt = (m, x, z) => m ? m[Math.min(D.mh - 1, Math.max(0, ((z - D.Z0) / D.MR) | 0)) * D.mw + Math.min(D.mw - 1, Math.max(0, ((x - D.X0) / D.MR) | 0))] : 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = D.X0 + (i + .5) * st, z = D.Z0 + (j + .5) * st, e = 7.5, sl = Math.hypot(w.rawElevation(x + e, z) - w.rawElevation(x - e, z), w.rawElevation(x, z + e) - w.rawElevation(x, z - e)) / (2 * e) * 100;
      const k = D.lc[Math.min(D.gh - 1, ((z - D.Z0) / D.C) | 0) * D.gw + Math.min(D.gw - 1, ((x - D.X0) / D.C) | 0)];
      let v = lcRules[String(TO_SAT2TOPO[k] || 7)] || 'GO';
      if (mAt(D.rmask, x, z)) v = 'GO'; else { if (sl > s2) v = 'NO'; else if (sl > s1 && v === 'GO') v = 'SLOW'; if (k === 2 && prof.flooded) v = v === 'NO' ? 'NO' : prof.flooded; }
      cnt[v]++; im.data.set(v === 'GO' ? [46, 204, 64, 95] : v === 'SLOW' ? [255, 196, 0, 120] : [230, 40, 40, 135], (j * nx + i) * 4);
    }
    g.putImageData(im, 0, 0); this.drapeTexture(c, D.X0, D.Z0, D.W, D.H);
    const n = nx * nz; this.result = { kind: 'mobility', vehicle: prof.name, season: this.season, go: cnt.GO / n * 100, slow: cnt.SLOW / n * 100, no: cnt.NO / n * 100 };
    this.onResult && this.onResult(this.result);
  }
  ownEnemy() {
    const pts = s => this.features.filter(f => f.geom === 'point' && f.side === s && this.inAOI(f)).map(f => this.xz(f.coords[0]));
    const O = pts('own'), E = pts('enemy'); if (!O.length || !E.length) return false;
    let best = null, bd = Infinity; for (const o of O) for (const e of E) { const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { bd = d; best = [o, e]; } }
    this.lineOfSight(best[0], best[1]); return true;
  }
  geojson() {
    return JSON.stringify({ type: 'FeatureCollection', features: this.features.map(f => ({ type: 'Feature', properties: { code: f.code, side: f.side, label: f.label || '', name_en: CAT.catalog[f.code].en, name_km: CAT.catalog[f.code].km, ...(f.props || {}) },
      geometry: f.geom === 'point' || f.geom === 'circle' ? { type: 'Point', coordinates: f.coords[0] } : f.geom === 'polygon' ? { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]]] } : { type: 'LineString', coordinates: f.coords } })) }, null, 1);
  }
}
function subdivide(geo, maxE) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, out = [];
  const sub = (a, b, c, d) => { const m = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)); if (m <= maxE || d > 8) { out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); return; }
    const ab = a.clone().lerp(b, .5), bc = b.clone().lerp(c, .5), ca = c.clone().lerp(a, .5); sub(a, ab, ca, d + 1); sub(ab, b, bc, d + 1); sub(ca, bc, c, d + 1); sub(ab, bc, ca, d + 1); };
  for (let i = 0; i < p.count; i += 3) sub(new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1), new THREE.Vector3().fromBufferAttribute(p, i + 2), 0);
  const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); return r;
}
function inside(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; }
function clipSeg(P, a, b) { // parts of segment a–b inside polygon P (sampled)
  const n = 60, out = []; let run = [];
  for (let i = 0; i <= n; i++) { const p = { x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n }; if (inside(P, p.x, p.z)) run.push(p); else { if (run.length > 1) out.push(run); run = []; } }
  if (run.length > 1) out.push(run); return out;
}

// small 2D picture of a line or area symbol for the palette
export function linePreview(code, col) {
  const c = document.createElement('canvas'), W = 84, H = 26; c.width = W; c.height = H; const g = c.getContext('2d'); g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = g.fillStyle = col; g.lineWidth = 2; const y = H / 2, L = (x0, x1, yy = y) => { g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); };
  const arrow = (x, yy, s = 6) => { g.beginPath(); g.moveTo(x + s, yy); g.lineTo(x - s * 0.4, yy - s * 0.8); g.lineTo(x - s * 0.4, yy + s * 0.8); g.closePath(); g.fill(); };
  const dash = (a, b) => g.setLineDash([a, b]);
  switch (code) {
    case 'axis': case 'axis_planned': g.lineWidth = 7; g.globalAlpha = 0.85; if (code === 'axis_planned') dash(10, 5); L(6, W - 16); g.setLineDash([]); g.globalAlpha = 1; arrow(W - 10, y, 10); break;
    case 'route': dash(6, 4); L(6, W - 12); g.setLineDash([]); arrow(W - 8, y); break;
    case 'fire_direction': L(6, W - 12); arrow(W - 8, y); break;
    case 'phase_line': g.strokeStyle = g.fillStyle = '#222'; dash(9, 5); L(4, W - 4); g.setLineDash([]); g.font = '700 10px system-ui'; g.fillText('PL', W / 2 - 7, y - 4); break;
    case 'boundary_dash': g.strokeStyle = '#222'; dash(7, 5); L(4, W - 4); break;
    case 'boundary_dashdot': g.strokeStyle = '#222'; dash(10, 3, 2, 3); g.setLineDash([10, 3, 2, 3]); L(4, W - 4); break;
    case 'trench': L(4, W - 4, y - 2); for (let x = 8; x < W - 4; x += 7) L(x, x + 0.01, y - 2), g.beginPath(), g.moveTo(x, y - 2), g.lineTo(x, y + 4), g.stroke(); break;
    case 'trench_zigzag': g.beginPath(); for (let x = 4, k = 0; x <= W - 4; x += 7, k++) (k ? g.lineTo(x, y + (k % 2 ? -4 : 4)) : g.moveTo(x, y)); g.stroke(); break;
    case 'fortified_line': g.beginPath(); g.moveTo(4, y); for (let x = 4; x < W - 8; x += 10) { g.lineTo(x + 5, y); g.lineTo(x + 5, y - 5); g.lineTo(x + 10, y - 5); g.lineTo(x + 10, y); } g.stroke(); break;
    case 'front_line': case 'boundary_arc': L(4, W - 4, y + 3); for (let x = 12; x < W - 6; x += 14) { g.beginPath(); g.arc(x, y + 3, 4, Math.PI, 0); g.stroke(); } break;
    case 'obstacle_belt': case 'minefield_line': L(4, W - 4); for (let x = 10; x < W - 4; x += 12) { g.beginPath(); g.arc(x, y, 3, 0, 7); code === 'minefield_line' ? g.fill() : g.stroke(); } break;
    case 'wire': case 'abatis': L(4, W - 4); for (let x = 10; x < W - 4; x += 12) { g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x - 3, y + 3); g.lineTo(x + 3, y - 3); g.stroke(); } break;
    case 'at_ditch': L(4, W - 4, y + 3); for (let x = 8; x < W - 6; x += 9) { g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x + 3, y - 4); g.lineTo(x + 6, y + 3); g.fill(); } break;
    case 'sector_line': L(4, W - 4); break;
    case 'dimension': g.strokeStyle = g.fillStyle = '#222'; L(10, W - 10); arrow(W - 8, y, 5); g.save(); g.translate(8, y); g.rotate(Math.PI); arrow(0, 0, 5); g.restore(); break;
    case 'fire_sector': g.globalAlpha = 0.25; g.beginPath(); g.moveTo(10, y + 8); g.arc(10, y + 8, 60, -0.45, 0.05); g.closePath(); g.fill(); g.globalAlpha = 1; g.stroke(); break;
    case 'range_ring': dash(4, 3); g.beginPath(); g.arc(W / 2, y, 10, 0, 7); g.stroke(); g.beginPath(); g.arc(W / 2, y, 5, 0, 7); g.stroke(); break;
    default: { // areas
      const r = [8, 4, W - 16, H - 8]; g.globalAlpha = code === 'obstacle_area' || code === 'impassable' || code === 'minefield_area' ? 0.3 : 0.16; g.fillRect(...r); g.globalAlpha = 1;
      if (code === 'zone') dash(6, 4); g.strokeRect(...r); g.setLineDash([]);
      if (code === 'def_area') for (let x = r[0] + 4; x < r[0] + r[2]; x += 7) L(x, x + 0.01), g.beginPath(), g.moveTo(x, r[1]), g.lineTo(x, r[1] - 3), g.stroke();
      if (code === 'obstacle_area' || code === 'impassable') { g.save(); g.beginPath(); g.rect(...r); g.clip(); g.lineWidth = 1; for (let x = -20; x < W; x += 6) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 20, 0); g.stroke(); if (code === 'impassable') { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, H); g.stroke(); } } g.restore(); }
      if (code === 'minefield_area') for (let x = r[0] + 7; x < r[0] + r[2]; x += 10) { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
      if (code === 'objective') { g.font = '700 9px system-ui'; g.fillText('OBJ', W / 2 - 9, y + 3); }
    }
  }
  return c.toDataURL();
}
