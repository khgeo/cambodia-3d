// Digitizing: add your own roads, 3D buildings, trees and ponds on top of the landscape.
// Features are kept in lon/lat in this browser (localStorage), rebuilt whenever the scene is rebuilt,
// drivable (new roads join the Drive network) and exportable / importable as GeoJSON.
import * as THREE from 'three';
import { RoadNet } from './modes.js?v=80';
import { instTrees } from './vegetation.js?v=80';
import { makeBuildingMaterial } from './shaders.js?v=80';

const KEY = 'cambodia3d.edits.v1';
export const ROAD_TYPES = {
  primary: { name: 'Primary / national road', w: 12, surf: 'asphalt', lanes: 2, edge: true },
  secondary: { name: 'Secondary / provincial', w: 9, surf: 'asphalt', lanes: 2, edge: true },
  tertiary: { name: 'Tertiary / district', w: 7, surf: 'asphalt', lanes: 1 },
  residential: { name: 'Village street', w: 5, surf: 'concrete' },
  track: { name: 'Dirt / laterite track', w: 4, surf: 'laterite' },
  path: { name: 'Footpath / dyke path', w: 1.6, surf: 'dirt' },
};
export const ROOFS = { gable: 'Gable', hip: 'Hip', flat: 'Flat' };
export const WALLS = { '#e9e4d8': 'White', '#efe2c9': 'Cream', '#d9b48a': 'Yellow', '#a07a55': 'Wood', '#c8d3d6': 'Blue-grey', '#c97b63': 'Terracotta' };
export const ROOF_COLS = { '#a8452f': 'Red tile', '#8a8f94': 'Zinc', '#3e6b98': 'Blue', '#2f5e4b': 'Green', '#c9c6bf': 'Concrete' };
export const TREES = { coco: 'Coconut palm', sugarA: 'Sugar palm (Thnot)', round: 'Mango / round tree', tall: 'Tall tree', wide: 'Wide tree (rain tree)', bush: 'Bush' };

function roadTexture(type) {
  const T = ROAD_TYPES[type], c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  const base = { asphalt: '#3d4044', concrete: '#b9b5ac', laterite: '#b5653a', dirt: '#9c7b55' }[T.surf];
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) { const v = Math.random() * 40 - 20; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 400})`; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  if (T.surf === 'laterite' || T.surf === 'dirt') { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(30, 0, 14, 256); g.fillRect(84, 0, 14, 256); }
  if (T.surf === 'concrete') { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, 128, 2); g.fillRect(63, 0, 2, 256); }
  if (T.surf === 'asphalt') {
    g.fillStyle = '#f2f0e6'; if (T.edge) { g.fillRect(5, 0, 3, 256); g.fillRect(120, 0, 3, 256); }
    g.fillStyle = T.lanes === 2 ? '#f2c14e' : '#f2f0e6'; g.fillRect(62, 0, 4, 140);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export class Editor {
  constructor(world) {
    this.w = world; this.group = new THREE.Group(); this.preview = new THREE.Group(); this.tool = 'road'; this.verts = []; this.active = false;
    this.snapOn = true;
    this.opts = { road: 'residential', floors: 1, roof: 'gable', wall: '#e9e4d8', roofC: '#a8452f', tree: 'coco', rect: true, stilt: false };
    try { this.features = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { this.features = []; }
    this.tex = {};
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.features)); } catch (e) { console.warn(e); } }
  get F() { return this.w.F; }
  ll(x, z) { return [+this.F.lon(x).toFixed(7), +this.F.lat(z).toFixed(7)]; }
  xz(c) { return { x: this.F.x(c[0]), z: this.F.z(c[1]) }; }
  inAOI(f) { const D = this.w.D; return f.coords.some(c => { const p = this.xz(c); return p.x >= D.X0 && p.x <= D.X0 + D.W && p.z >= D.Z0 && p.z <= D.Z0 + D.H; }); }
  setTool(t) { this.tool = t; this.verts = []; this.drawPreview(); }
  /* ---- snapping: to corners/vertices first, then to edges and road centrelines ---- */
  snapIndex() {
    const w = this.w, D = w.D, cell = 20, V = new Map(), E = new Map(), key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
    const addV = (x, z, kind) => { const k = key(x, z); (V.get(k) || V.set(k, []).get(k)).push({ x, z, kind }); };
    const addE = (a, b, kind) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / cell)); for (let i = 0; i <= n; i++) { const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n, k = key(x, z); const l = E.get(k) || E.set(k, []).get(k); if (l[l.length - 1] !== a) l.push({ a, b, kind }); } };
    const ring = (pts, kind, closed) => { pts.forEach(p => addV(p.x, p.z, kind)); for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) addE(pts[i], pts[(i + 1) % pts.length], kind); };
    for (const r of (w.net && w.net.roads) || []) { const P = r.pts; ring([P[0], P[P.length - 1]], 'road end', false); for (let i = 0; i < P.length - 1; i += 1) addE(P[i], P[i + 1], r.user ? 'your road' : 'road'); }
    for (const b of D.buildings || []) ring(b.ring.map(([x, z]) => ({ x, z })), 'building corner', true);
    for (const b of w.housesList || []) ring(b.ring.map(([x, z]) => ({ x, z })), 'house corner', true);
    for (const f of this.features) if (this.inAOI(f)) { const P = f.coords.map(c => this.xz(c)); if (f.type === 'tree') addV(P[0].x, P[0].z, 'tree'); else ring(P, f.type === 'road' ? 'your road' : 'your ' + f.type, f.type !== 'road'); }
    const sv = w.survey; if (sv) { for (const p of sv.points) addV(p.x, p.z, 'survey point ' + p.id); for (const p of sv.parcelsHere()) ring(p.coords.map(c => this.xz(c)), 'parcel', true); }
    this.snapIdx = { V, E, cell };
  }
  snap(x, z, tol) {
    if (!this.snapOn) return { x, z };
    if (!this.snapIdx) this.snapIndex(); const { V, E, cell } = this.snapIdx, ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    let best = null, bd = tol;
    for (const p of this.verts) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = { x: p.x, z: p.z, kind: p === this.verts[0] ? 'close shape' : 'vertex' }; } }
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const p of V.get(i + ',' + j) || []) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    if (best) return best;
    bd = tol * 0.8;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const e of E.get(i + ',' + j) || []) {
      const vx = e.b.x - e.a.x, vz = e.b.z - e.a.z, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - e.a.x) * vx + (z - e.a.z) * vz) / L)), px = e.a.x + vx * t, pz = e.a.z + vz * t, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = { x: px, z: pz, kind: 'on ' + e.kind }; }
    }
    // right angles: square to the previous segment when close to 90°
    if (!best && this.verts.length >= 2 && this.tool !== 'tree') {
      const a = this.verts[this.verts.length - 2], b = this.verts[this.verts.length - 1], ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz) || 1, nx = -uz / L, nz = ux / L, dx = x - b.x, dz = z - b.z;
      const along = (dx * ux + dz * uz) / L, perp = dx * nx + dz * nz; if (Math.abs(along) < tol * 0.8 && Math.abs(perp) > tol) return { x: b.x + nx * perp, z: b.z + nz * perp, kind: '90°' };
    }
    return best || { x, z };
  }
  hover(x, z, tol) {
    if (!this.active || this.tool === 'delete') { this.hoverPt = null; this.drawHover(); return null; }
    this.hoverPt = this.snap(x, z, tol); this.drawHover(); return this.hoverPt;
  }
  drawHover() {
    const w = this.w; if (!this.hoverG) { this.hoverG = new THREE.Group(); }
    if (!this.hoverG.parent) w.root.add(this.hoverG);
    const g = this.hoverG; g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); const p = this.hoverPt; if (!p || !w.hAt) return;
    const y = w.hAt(p.x, p.z) + 0.5, snapped = !!p.kind, col = snapped ? 0xffe14a : 0xff3df2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, depthTest: false, side: THREE.DoubleSide })); ring.position.set(p.x, y, p.z); ring.renderOrder = 12; g.add(ring);
    const L = this.verts[this.verts.length - 1];
    if (L && this.tool !== 'tree') { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(L.x, w.hAt(L.x, L.z) + 0.5, L.z), new THREE.Vector3(p.x, y, p.z)]), new THREE.LineDashedMaterial({ color: col, dashSize: 1.2, gapSize: 0.8, depthTest: false })); ln.computeLineDistances(); ln.renderOrder = 12; g.add(ln); }
    this.onHover && this.onHover(p);
  }
  /* ---- input ---- */
  tap(x, z) {
    const t = this.tool;
    if (t !== 'delete' && this.hoverPt && Math.hypot(this.hoverPt.x - x, this.hoverPt.z - z) < 30) { x = this.hoverPt.x; z = this.hoverPt.z; }
    else if (t !== 'delete') { const p = this.snap(x, z, this.tapTol || 3); x = p.x; z = p.z; }
    if ((t === 'building' && !this.opts.rect || t === 'pond') && this.verts.length >= 3 && Math.hypot(this.verts[0].x - x, this.verts[0].z - z) < 0.01) { this.finish(); return; }
    if (t === 'delete') { this.deleteNear(x, z); return; }
    if (t === 'tree') { this.addFeature({ type: 'tree', coords: [this.ll(x, z)], props: { kind: this.opts.tree, s: 0.85 + Math.random() * 0.4 } }); return; }
    this.verts.push({ x, z });
    if (t === 'building' && this.opts.rect && this.verts.length === 3) { this.finish(); return; }
    this.drawPreview(); this.onChange && this.onChange();
  }
  undo() { this.verts.pop(); this.drawPreview(); this.onChange && this.onChange(); }
  cancel() { this.verts = []; this.drawPreview(); this.onChange && this.onChange(); }
  // three taps → rectangle: first side A–B, third tap sets the depth
  rectFrom(V) {
    const [a, b, c] = V, ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz) || 1, nx = -uz / L, nz = ux / L, d = (c.x - a.x) * nx + (c.z - a.z) * nz;
    return [a, b, { x: b.x + nx * d, z: b.z + nz * d }, { x: a.x + nx * d, z: a.z + nz * d }];
  }
  finish() {
    const t = this.tool, V = this.verts; let ok = false;
    if (t === 'road' && V.length >= 2) { this.addFeature({ type: 'road', coords: V.map(p => this.ll(p.x, p.z)), props: { road: this.opts.road } }); ok = true; }
    if (t === 'building' && V.length >= 3) {
      const ring = this.opts.rect && V.length === 3 ? this.rectFrom(V) : V;
      this.addFeature({ type: 'building', coords: ring.map(p => this.ll(p.x, p.z)), props: { floors: this.opts.floors, roof: this.opts.roof, wall: this.opts.wall, roofC: this.opts.roofC, stilt: this.opts.stilt } }); ok = true;
    }
    if (t === 'pond' && V.length >= 3) { this.addFeature({ type: 'pond', coords: V.map(p => this.ll(p.x, p.z)), props: {} }); ok = true; }
    this.verts = []; this.drawPreview(); this.onChange && this.onChange(); return ok;
  }
  addFeature(f) { f.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); this.features.push(f); this.save(); this.rebuild(); this.onChange && this.onChange(); }
  deleteNear(x, z) {
    let best = null, bd = 25;
    for (const f of this.features) {
      if (!this.inAOI(f)) continue; const P = f.coords.map(c => this.xz(c));
      let d = Infinity;
      if (f.type === 'tree') d = Math.hypot(P[0].x - x, P[0].z - z);
      else { if ((f.type === 'building' || f.type === 'pond') && inside(P, x, z)) d = 0; for (let i = 0; i < P.length - 1 + (f.type === 'road' ? 0 : 1); i++) d = Math.min(d, segDist(P[i], P[(i + 1) % P.length], x, z)); }
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return false; this.features = this.features.filter(f => f !== best); this.save(); this.rebuild(); this.onChange && this.onChange(); return true;
  }
  clearAll() { this.features = this.features.filter(f => !this.inAOI(f)); this.save(); this.rebuild(); this.onChange && this.onChange(); }
  /* ---- 3D ---- */
  rebuild() {
    const w = this.w; if (!w.D || !w.hAt) return; this.snapIdx = null;
    this.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); this.group.clear();
    if (!this.group.parent) w.root.add(this.group); if (!this.preview.parent) w.root.add(this.preview);
    const here = this.features.filter(f => this.inAOI(f)), roads = here.filter(f => f.type === 'road'), blds = here.filter(f => f.type === 'building'), trees = here.filter(f => f.type === 'tree'), ponds = here.filter(f => f.type === 'pond');
    // roads: draped ribbon on a smoothed long profile; joined to the drive network
    const netRoads = [];
    for (const f of roads) {
      const T = ROAD_TYPES[f.props.road] || ROAD_TYPES.residential, P = f.coords.map(c => this.xz(c)), pts = [];
      for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 2)); for (let k = i ? 1 : 0; k <= n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
      let s = 0; pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; p.g = w.hAt(p.x, p.z); });
      pts.forEach((p, i) => { let a = 0, n = 0; for (let k = Math.max(0, i - 6); k <= Math.min(pts.length - 1, i + 6); k++) { a += pts[k].g; n++; } p.y = Math.max(a / n, p.g) + 0.12; });
      this.group.add(this.ribbon(pts, T.w, f.props.road));
      netRoads.push({ pts: pts.map(p => ({ x: p.x, y: p.y, z: p.z, s: p.s })), hw: T.w / 2, oneway: false, cls: 11, user: true });
    }
    if (w.net) { const base = w.net.roads.filter(r => !r.user); w.net = new RoadNet([...base, ...netRoads]); if (w.driver) w.driver.net = w.net; }
    if (w.applyCorridors) this.cleared = w.applyCorridors(netRoads.map(r => ({ pts: r.pts, hw: r.hw + 0.6 })));
    // buildings: same builder as the OSM buildings (walls with windows, gable / hip / flat roofs, stilts)
    if (blds.length) {
      const list = blds.map(f => ({ t: f.props.floors > 3 ? 3 : 1, hdm: 0, lv: f.props.floors, ring: f.coords.map(c => { const p = this.xz(c); return [p.x, p.z]; }), roof: f.props.roof, wall: new THREE.Color(f.props.wall).getHex(), roofC: new THREE.Color(f.props.roofC).getHex(), stilt: f.props.stilt ? 2.2 : 0 }));
      const g = w.buildBuildings(list, Math.random, { noStats: true });
      if (g) { const m = new THREE.Mesh(g, this.bmat || (this.bmat = makeBuildingMaterial())); m.castShadow = m.receiveShadow = true; this.group.add(m); }
      for (const b of list) this.block(b.ring);
    }
    // trees: the same instanced models as the image-derived forest
    if (trees.length) {
      const L = {}; for (const f of trees) { const p = this.xz(f.coords[0]); (L[f.props.kind] = L[f.props.kind] || []).push([p.x, p.z, f.props.kind === 'bush' ? 1.4 : (f.props.s || 1) * (f.props.kind.length > 4 && !f.props.kind.startsWith('sugar') ? 1 : 1) * (['round', 'tall', 'wide'].includes(f.props.kind) ? 3.2 : 1)]); }
      for (const m of instTrees(L, { hAt: w.hAt, pxAt: w.D.pxAt, rnd: Math.random })) { m.castShadow = true; this.group.add(m); }
    }
    // ponds: flat water at the lowest bank height, using the scene's water material (reflections, depth colour)
    for (const f of ponds) {
      const P = f.coords.map(c => this.xz(c)); let lo = Infinity; for (const p of P) lo = Math.min(lo, w.hAt(p.x, p.z));
      const sh = new THREE.Shape(P.map(p => new THREE.Vector2(p.x, -p.z))), g = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2); g.translate(0, lo - 0.25, 0);
      const m = new THREE.Mesh(g, w.waterMat); m.receiveShadow = true; this.group.add(m);
      const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...P, P[0]].map(p => new THREE.Vector3(p.x, w.hAt(p.x, p.z) + 0.05, p.z))), new THREE.LineBasicMaterial({ color: 0x7a6a4f }));
      this.group.add(rim); this.block(P.map(p => [p.x, p.z]));
      if (w.waterBodies) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } w.waterBodies.push({ level: lo - 0.25, x0, x1, z0, z1, user: true }); }
    }
    this.drawPreview();
  }
  ribbon(pts, width, type) {
    const pos = [], uv = [], idx = [], hw = width / 2;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      pos.push(p.x + nx * hw, p.y, p.z + nz * hw, p.x - nx * hw, p.y, p.z - nz * hw); uv.push(0, p.s / (width * 2), 1, p.s / (width * 2));
      if (i) { const k = 2 * i; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    });
    // shoulders sloping down to the ground so raised roads do not float
    const sh = [], shI = [], n = pts.length;
    for (const side of [1, -1]) { const base = sh.length / 3; pts.forEach((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l * side, nz = tx / l * side;
      const ox = p.x + nx * (hw + 1.6), oz = p.z + nz * (hw + 1.6); sh.push(p.x + nx * hw, p.y - 0.02, p.z + nz * hw, ox, this.w.hAt(ox, oz) - 0.05, oz); if (i) { const k = base + 2 * i; shI.push(k - 2, k, k - 1, k - 1, k, k + 1); } }); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = this.tex[type] || (this.tex[type] = roadTexture(type));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })); m.receiveShadow = true;
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sh, 3)); sg.setIndex(shI); sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: ROAD_TYPES[type].surf === 'asphalt' ? 0x8a7a62 : 0xa0754f, roughness: 1, side: THREE.DoubleSide })); sm.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m, sm); return grp;
  }
  // stop walkers going through new buildings and ponds
  block(ring) {
    const w = this.w, D = w.D; if (!w.bmask) return; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const P = ring.map(([x, z]) => ({ x, z }));
    for (let z = z0; z <= z1; z += D.MR * 0.7) for (let x = x0; x <= x1; x += D.MR * 0.7) if (inside(P, x, z)) { const i = Math.min(D.mw - 1, Math.max(0, ((x - D.X0) / D.MR) | 0)), j = Math.min(D.mh - 1, Math.max(0, ((z - D.Z0) / D.MR) | 0)); w.bmask[j * D.mw + i] = 1; }
  }
  drawPreview() {
    const w = this.w, g = this.preview; g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); if (!this.verts.length || !w.hAt) return;
    let V = this.verts; if (this.tool === 'building' && this.opts.rect && V.length === 3) V = this.rectFrom(V);
    const closed = this.tool !== 'road' && V.length > 2, pts = [...V, ...(closed ? [V[0]] : [])].map(p => new THREE.Vector3(p.x, w.hAt(p.x, p.z) + 0.5, p.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff3df2, depthTest: false })); line.renderOrder = 10; g.add(line);
    for (const p of V) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3df2, depthTest: false })); s.position.set(p.x, w.hAt(p.x, p.z) + 0.5, p.z); s.renderOrder = 11; g.add(s); }
  }
  /* ---- GeoJSON ---- */
  geojson() {
    return JSON.stringify({ type: 'FeatureCollection', features: this.features.map(f => ({ type: 'Feature', properties: { kind: f.type, ...f.props },
      geometry: f.type === 'tree' ? { type: 'Point', coordinates: f.coords[0] } : f.type === 'road' ? { type: 'LineString', coordinates: f.coords } : { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]]] } })) }, null, 1);
  }
  importGeoJSON(txt) {
    const j = JSON.parse(txt), feats = j.type === 'FeatureCollection' ? j.features : [j]; let n = 0;
    for (const ft of feats) {
      const g = ft.geometry, p = ft.properties || {}; if (!g) continue;
      const kind = p.kind || (g.type === 'Point' ? 'tree' : /LineString/.test(g.type) ? 'road' : 'building');
      const add = (type, coords, props) => { this.features.push({ id: Math.random().toString(36).slice(2), type, coords, props }); n++; };
      if (g.type === 'Point') add('tree', [g.coordinates.slice(0, 2)], { kind: TREES[p.kind] ? p.kind : 'coco', s: 1 });
      if (g.type === 'LineString') add('road', g.coordinates.map(c => c.slice(0, 2)), { road: ROAD_TYPES[p.road] ? p.road : p.highway && ROAD_TYPES[p.highway] ? p.highway : 'residential' });
      if (g.type === 'MultiLineString') g.coordinates.forEach(l => add('road', l.map(c => c.slice(0, 2)), { road: ROAD_TYPES[p.road] ? p.road : 'residential' }));
      const poly = rings => { const r = rings[0].map(c => c.slice(0, 2)); if (r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
        if (kind === 'pond' || p.natural === 'water') add('pond', r, {}); else add('building', r, { floors: +p.floors || +p['building:levels'] || 1, roof: ROOFS[p.roof] ? p.roof : 'gable', wall: p.wall || '#e9e4d8', roofC: p.roofC || '#a8452f', stilt: !!p.stilt }); };
      if (g.type === 'Polygon') poly(g.coordinates); if (g.type === 'MultiPolygon') g.coordinates.forEach(poly);
    }
    this.save(); this.rebuild(); this.onChange && this.onChange(); return n;
  }
}
function inside(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; }
function segDist(a, b, x, z) { const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L)); return Math.hypot(a.x + vx * t - x, a.z + vz * t - z); }
