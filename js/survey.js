// Field survey: mark points, measure distance (horizontal, along the ground, slope, climb) and area
// (planimetric and 3D surface), draped on the terrain; go to / stake out a coordinate; walk with a GNSS rover pole.
// Heights come from the terrain model (not exaggerated); this is a simulation, not survey-grade.
import * as THREE from 'three';
import { utm } from './hud.js?v=34';

export const CODES = ['Point', 'Boundary corner', 'Tree', 'Well / water', 'Building corner', 'Road / track', 'Benchmark', 'Other'];
const COL = { line: 0xffd23f, area: 0x29c7d9, point: 0xff6b3d, target: 0x37e07a };

/* UTM → lat/lon (WGS84) */
export function utmInv(E, N, zone = 48, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000, y = north ? N : N - 10000000, M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2, R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}
/* "11.56, 104.92" · "104.92 11.56" · "11°33'40\"N 104°55'38\"E" · "491500 1278000" · "48N 491500 1278000" */
export function parseCoord(txt) {
  const t = txt.trim().toUpperCase(); if (!t) return null;
  const dms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?/g)];
  if (dms.length >= 2) {
    const v = dms.map(m => ({ d: +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600, h: m[4] }));
    let lat = v.find(q => q.h === 'N' || q.h === 'S') || v[0], lon = v.find(q => q.h === 'E' || q.h === 'W') || v[1];
    return { lat: lat.d * (lat.h === 'S' ? -1 : 1), lon: lon.d * (lon.h === 'W' ? -1 : 1) };
  }
  const z = t.match(/\b(4[78])\s*([NP])?\b/), nums = (t.replace(/\b4[78]\s*[NP]?\b/, ' ').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 2) return null; const [a, b] = nums;
  if (Math.abs(a) > 1000 && Math.abs(b) > 1000) { const E = a < b ? a : b, N = a < b ? b : a; return { ...utmInv(E, N, z ? +z[1] : 48, true), utm: true }; }
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(Math.abs(a) > 30 && Math.abs(b) <= 30)) return { lat: a, lon: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a };
  return null;
}
const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(m < 10 ? 2 : 1) + ' m';
const fmtArea = m2 => m2 >= 10000 ? `${(m2 / 10000).toFixed(3)} ha (${Math.round(m2).toLocaleString()} m²)` : `${m2.toFixed(1)} m²`;
export { fmtLen, fmtArea };
const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const dirName = b => DIR8[Math.round(b / 45) % 8];

function tag(text, color, big) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = big ? 30 : 26; g.font = `600 ${fs}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 44; c.width = w; c.height = 48;
  g.fillStyle = 'rgba(17,23,31,.86)'; g.beginPath(); g.roundRect(0, 0, w, 48, 12); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(20, 24, 8, 0, 7); g.fill();
  g.font = `600 ${fs}px system-ui, sans-serif`; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 34, 25);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, sizeAttenuation: false, transparent: true }));
  s.center.set(0, -0.15); s.renderOrder = 20; const h = 0.032; s.scale.set(h * w / 48, h, 1); s.userData.w = w; return s;
}

export class Survey {
  constructor(world) {
    this.w = world; this.tool = 'points'; this.points = []; this.verts = []; this.target = null; this.code = CODES[0]; this.n = 0;
    this.group = new THREE.Group(); world.scene.add(this.group);
    this.pole = this.makePole(); this.pole.visible = false; world.scene.add(this.pole);
    this.active = false; this.level = null; this.stakeList = []; this.stakeIdx = -1;
    try { this.parcels = JSON.parse(localStorage.getItem('cambodia3d.parcels.v1') || '[]'); } catch (e) { this.parcels = []; }
  }
  sceneY(elev) { const D = this.D, w = this.w; return (elev - Math.max(D.hmin, 0)) * (w.exag ?? 1); }
  /* ---- cut / fill to a design level inside the area ---- */
  cutFill(level) {
    const tri = this.drapeTris(); let cut = 0, fill = 0;
    for (let i = 0; i < tri.length; i += 9) {
      const ax = tri[i], az = tri[i + 2], bx = tri[i + 3], bz = tri[i + 5], cx = tri[i + 6], cz = tri[i + 8], A = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      const h = (this.real(ax, az) + this.real(bx, bz) + this.real(cx, cz) + 3 * this.real((ax + bx + cx) / 3, (az + bz + cz) / 3)) / 6, d = h - level;
      if (d > 0) cut += A * d; else fill -= A * d;
    }
    return { cut, fill, net: cut - fill };
  }
  /* ---- parcels: saved polygons with a name and area, kept in this browser ---- */
  saveParcel(name) {
    if (this.verts.length < 3) return null; const m = this.measureArea();
    const p = { id: Date.now().toString(36), name: name || 'Parcel ' + (this.parcels.length + 1), coords: this.verts.map(v => { const ll = this.toLL(v.x, v.z); return [+ll.lon.toFixed(7), +ll.lat.toFixed(7)]; }), area: m.A, area3: m.A3, per: m.per2 };
    this.parcels.push(p); this.persist(); this.verts = []; this.redraw(); return p;
  }
  persist() { try { localStorage.setItem('cambodia3d.parcels.v1', JSON.stringify(this.parcels)); } catch (e) { } }
  parcelsHere() { const F = this.w.F; return this.parcels.filter(p => p.coords.some(c => this.inside(F.x(c[0]), F.z(c[1])))); }
  /* ---- stake-out list from a CSV of points ---- */
  importCSV(txt) {
    const lines = txt.split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return 0;
    const split = l => l.split(/[,;\t]/).map(v => v.trim().replace(/^"|"$/g, ''));
    let head = split(lines[0]).map(h => h.toLowerCase()); const hasHead = head.some(h => /[a-z]/.test(h) && !/^-?\d/.test(h));
    const col = (...names) => head.findIndex(h => names.includes(h));
    const iId = hasHead ? col('id', 'name', 'point', 'pt', 'label') : -1, iLat = hasHead ? col('lat', 'latitude', 'y_lat') : -1, iLon = hasHead ? col('lon', 'lng', 'long', 'longitude', 'x_lon') : -1,
      iE = hasHead ? col('e', 'easting', 'x', 'east') : -1, iN = hasHead ? col('n', 'northing', 'y', 'north') : -1;
    const out = [];
    (hasHead ? lines.slice(1) : lines).forEach((l, k) => {
      const v = split(l); let ll = null;
      if (iLat >= 0 && iLon >= 0) ll = { lat: +v[iLat], lon: +v[iLon] };
      else if (iE >= 0 && iN >= 0) ll = utmInv(+v[iE], +v[iN], 48, true);
      else { const nums = v.map(Number).filter(n => !isNaN(n)); if (nums.length >= 2) ll = parseCoord(nums.slice(-2).join(' ')) || parseCoord(nums.slice(0, 2).join(' ')); }
      if (ll && isFinite(ll.lat) && isFinite(ll.lon)) out.push({ id: iId >= 0 ? v[iId] : 'S' + (k + 1), lat: ll.lat, lon: ll.lon, done: false });
    });
    this.stakeList = out; this.stakeIdx = -1; return out.length;
  }
  stakeGo(i) {
    if (!this.stakeList.length) return null; this.stakeIdx = (i + this.stakeList.length) % this.stakeList.length; const s = this.stakeList[this.stakeIdx];
    return this.setTarget(s, s.id) ? s : false;
  }
  get D() { return this.w.D; }
  real(x, z) { return this.w.rawElevation(x, z); }
  toLL(x, z) { return { lat: this.w.F.lat(z), lon: this.w.F.lon(x) }; }
  inside(x, z) { const D = this.D; return x >= D.X0 && x <= D.X0 + D.W && z >= D.Z0 && z <= D.Z0 + D.H; }
  clear(all) { this.verts = []; if (all) { this.points = []; this.n = 0; this.target = null; } this.redraw(); }
  setTool(t) { this.tool = t; this.verts = []; this.redraw(); }
  /* ---- adding vertices / points ---- */
  add(x, z, src) {
    if (!this.D || !this.inside(x, z)) return;
    if (this.tool === 'points') {
      const ll = this.toLL(x, z), u = utm(ll.lat, ll.lon);
      this.points.push({ id: 'P' + (++this.n), code: this.code, x, z, ...ll, E: u.E, N: u.N, zone: u.zone, h: this.real(x, z), src: src || 'tap', t: new Date().toISOString() });
    } else this.verts.push({ x, z });
    if (this.target && this.stakeIdx >= 0 && Math.hypot(this.target.x - x, this.target.z - z) < 0.5 && this.stakeList[this.stakeIdx]) { this.stakeList[this.stakeIdx].done = true; const pt = this.points[this.points.length - 1]; if (pt && this.tool === 'points') pt.code = 'Staked ' + this.stakeList[this.stakeIdx].id; }
    this.redraw(); this.onChange && this.onChange();
  }
  undo() { if (this.tool === 'points') { this.points.pop(); } else this.verts.pop(); this.redraw(); this.onChange && this.onChange(); }
  // where the rover pole tip touches the ground (just in front of the surveyor)
  poleTip() { const wk = this.w.walker, fx = -Math.sin(wk.yaw), fz = -Math.cos(wk.yaw); return { x: wk.pos.x + fx * 0.8 - fz * 0.3, z: wk.pos.z + fz * 0.8 + fx * 0.3 }; }
  markAtPole() { const p = this.poleTip(); this.add(p.x, p.z, 'rover'); this.flash = 0.6; }
  /* ---- measurements (real elevations, metres) ---- */
  path(pts, closed) {
    const out = [], P = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 1.0));
      for (let k = i ? 1 : 0; k <= n; k++) { const t = k / n; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, seg: i }); }
    }
    let d2 = 0, d3 = 0, up = 0, down = 0, maxS = 0;
    out.forEach((p, i) => { p.h = this.real(p.x, p.z); if (i) { const q = out[i - 1], dh = p.h - q.h, ds = Math.hypot(p.x - q.x, p.z - q.z); d2 += ds; d3 += Math.hypot(ds, dh); if (dh > 0) up += dh; else down -= dh; } p.d = d2; });
    // steepest slope over a 10 m window (the terrain model is smooth at shorter scales)
    for (let i = 0, j = 0; i < out.length; i++) { while (j < out.length - 1 && out[j].d - out[i].d < 10) j++; const ds = out[j].d - out[i].d; if (ds > 5) maxS = Math.max(maxS, Math.abs(out[j].h - out[i].h) / ds * 100); }
    return { s: out, d2, d3, up, down, maxS };
  }
  measureLine() {
    const V = this.verts; if (V.length < 2) return null; const r = this.path(V), a = V[0], b = V[V.length - 1];
    const h0 = this.real(a.x, a.z), h1 = this.real(b.x, b.z), straight = Math.hypot(b.x - a.x, b.z - a.z);
    const segs = V.slice(1).map((q, i) => { const p = V[i], ds = Math.hypot(q.x - p.x, q.z - p.z), dh = this.real(q.x, q.z) - this.real(p.x, p.z); return { ds, dh, slope: dh / (ds || 1) * 100, brg: bearing(q.x - p.x, q.z - p.z) }; });
    return { ...r, straight, slope3: Math.hypot(straight, h1 - h0), dh: h1 - h0, grade: (h1 - h0) / (straight || 1) * 100, brg: bearing(b.x - a.x, b.z - a.z), segs };
  }
  measureArea() {
    const V = this.verts; if (V.length < 3) return null;
    let A = 0; for (let i = 0; i < V.length; i++) { const p = V[i], q = V[(i + 1) % V.length]; A += p.x * q.z - q.x * p.z; } A = Math.abs(A) / 2;
    const tri = this.drapeTris(), per = this.path(V, true);
    let A3 = 0, hs = [];
    for (let i = 0; i < tri.length; i += 9) {
      const a = new THREE.Vector3(tri[i], tri[i + 1], tri[i + 2]), b = new THREE.Vector3(tri[i + 3], tri[i + 4], tri[i + 5]), c = new THREE.Vector3(tri[i + 6], tri[i + 7], tri[i + 8]);
      for (const v of [a, b, c]) v.y = this.real(v.x, v.z);
      A3 += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; hs.push(a.y);
    }
    hs.sort((p, q) => p - q);
    return { A, A3, per2: per.d2, per3: per.d3, hmin: hs[0], hmax: hs[hs.length - 1], hmean: hs.reduce((s, v) => s + v, 0) / (hs.length || 1), tris: tri };
  }
  // polygon triangulated then subdivided so the fill hugs the ground (x, y=0, z triplets)
  drapeTris() {
    const V = this.verts, contour = V.map(p => new THREE.Vector2(p.x, p.z)); if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const faces = THREE.ShapeUtils.triangulateShape(contour, []); let A = 0; for (const f of faces) { const [a, b, c] = f.map(i => contour[i]); A += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2; }
    const maxE = Math.max(2, Math.sqrt(A) / 70), out = [];
    const sub = (a, b, c, d) => {
      const lab = a.distanceTo(b), lbc = b.distanceTo(c), lca = c.distanceTo(a), m = Math.max(lab, lbc, lca);
      if (m <= maxE || d > 9) { out.push(a.x, 0, a.y, b.x, 0, b.y, c.x, 0, c.y); return; }
      if (m === lab) { const p = a.clone().lerp(b, .5); sub(a, p, c, d + 1); sub(p, b, c, d + 1); }
      else if (m === lbc) { const p = b.clone().lerp(c, .5); sub(a, b, p, d + 1); sub(a, p, c, d + 1); }
      else { const p = c.clone().lerp(a, .5); sub(a, b, p, d + 1); sub(p, b, c, d + 1); }
    };
    for (const f of faces) sub(contour[f[0]], contour[f[1]], contour[f[2]], 0);
    return out;
  }
  /* ---- 3D drawing ---- */
  ribbon(samples, color, width) {
    const w = this.w, pos = [], idx = [];
    samples.forEach((p, i) => {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l * width / 2, nz = tx / l * width / 2;
      const y = w.hAt(p.x, p.z) + 0.25; pos.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
      if (i) { const k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 })); m.renderOrder = 5;
    // faint copy that shows through hills
    const ghost = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples.map(p => new THREE.Vector3(p.x, w.hAt(p.x, p.z) + 0.3, p.z))), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false }));
    ghost.renderOrder = 4; this.group.add(m, ghost);
  }
  stake(x, z, color, text, big) {
    const w = this.w, y = w.hAt(x, z), g = new THREE.Group(); g.position.set(x, y, z);
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xc9a46b })); peg.position.y = 0.45;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.3 })); flag.position.set(0.17, 0.78, 0);
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.45, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })); disc.position.y = 0.06;
    g.add(peg, flag, disc); if (text) { const s = tag(text, '#' + new THREE.Color(color).getHexString(), big); s.position.y = 1.0; g.add(s); }
    this.group.add(g);
  }
  redraw() {
    const g = this.group; g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); g.clear();
    if (!this.D || !this.w.hAt) return;
    for (const p of this.points) this.stake(p.x, p.z, COL.point, `${p.id} · ${p.h.toFixed(1)} m`);
    const V = this.verts, area = this.tool === 'area';
    if (V.length) {
      const col = area ? COL.area : COL.line, width = Math.max(0.35, Math.max(this.D.W, this.D.H) / 1400);
      if (V.length > 1) this.ribbon(this.path(V, area && V.length > 2).s, col, width);
      V.forEach((p, i) => this.stake(p.x, p.z, col, i === 0 ? (area ? 'A1' : 'Start') : area ? 'A' + (i + 1) : null));
      if (!area && V.length > 1) {
        const m = this.measureLine(); V.slice(1).forEach((q, i) => { const p = V[i], s = m.segs[i], t = tag(`${fmtLen(s.ds)} · ${s.slope >= 0 ? '↗' : '↘'} ${Math.abs(s.slope).toFixed(1)}%`, '#ffd23f');
          t.position.set((p.x + q.x) / 2, this.w.hAt((p.x + q.x) / 2, (p.z + q.z) / 2) + 1.5, (p.z + q.z) / 2); g.add(t); });
        const e = V[V.length - 1], t = tag(`Σ ${fmtLen(m.d3)} along ground`, '#ffd23f', true); t.position.set(e.x, this.w.hAt(e.x, e.z) + 3.5, e.z); g.add(t);
      }
      if (area && V.length > 2) {
        const m = this.measureArea(), tri = m.tris.slice(); for (let i = 0; i < tri.length; i += 3) tri[i + 1] = this.w.hAt(tri[i], tri[i + 2]) + 0.15;
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
        const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.area, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })); fill.renderOrder = 3; g.add(fill);
        const cx = V.reduce((s, p) => s + p.x, 0) / V.length, cz = V.reduce((s, p) => s + p.z, 0) / V.length, t = tag(fmtArea(m.A), '#29c7d9', true); t.position.set(cx, this.w.hAt(cx, cz) + 3, cz); g.add(t);
      }
    }
    for (const p of this.parcelsHere()) {
      const P = p.coords.map(c => ({ x: this.w.F.x(c[0]), z: this.w.F.z(c[1]) }));
      this.ribbon(this.path(P, true).s, 0xff9f1c, Math.max(0.3, Math.max(this.D.W, this.D.H) / 1800));
      const cx = P.reduce((s, q) => s + q.x, 0) / P.length, cz = P.reduce((s, q) => s + q.z, 0) / P.length, t = tag(`${p.name} · ${fmtArea(p.area)}`, '#ff9f1c'); t.position.set(cx, this.w.hAt(cx, cz) + 2, cz); g.add(t);
    }
    if (this.tool === 'area' && this.level != null && V.length > 2) {
      const sh = new THREE.Shape(V.map(p => new THREE.Vector2(p.x, -p.z))), geo = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2); geo.translate(0, this.sceneY(this.level), 0);
      const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3d7f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); plane.renderOrder = 6; g.add(plane);
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(V.map(p => new THREE.Vector3(p.x, this.sceneY(this.level), p.z))), new THREE.LineBasicMaterial({ color: 0xff3d7f })); g.add(edge);
    }
    if (this.target) this.drawTarget();
  }
  /* ---- go to / stake out ---- */
  setTarget(ll, label) {
    const F = this.w.F, x = F.x(ll.lon), z = F.z(ll.lat); if (!this.inside(x, z)) return false;
    const u = utm(ll.lat, ll.lon); this.target = { x, z, ...ll, E: u.E, N: u.N, label: label || 'Target', h: this.real(x, z) }; this.redraw(); return true;
  }
  drawTarget() {
    const T = this.target, y = this.w.hAt(T.x, T.z), ext = Math.max(this.D.W, this.D.H);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, ext * 0.25, 12, 1, true), new THREE.MeshBasicMaterial({ color: COL.target, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(T.x, y + ext * 0.125, T.z); this.group.add(beam); this.beam = beam;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.target, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(T.x, y + 0.12, T.z); this.group.add(ring); this.ring = ring;
    this.stake(T.x, T.z, COL.target, `🎯 ${T.label} · ${T.h.toFixed(1)} m`, true);
  }
  guidance() {
    const T = this.target; if (!T) return null; const w = this.w, from = w.mode === 'walk' ? this.poleTip() : w.mode === 'drive' && w.driver ? w.driver.pos : w.controls.target;
    const dx = T.x - from.x, dz = T.z - from.z, d = Math.hypot(dx, dz);
    return { d, brg: bearing(dx, dz), dh: T.h - this.real(from.x, from.z), dx, dz };
  }
  walkTo() {
    const w = this.w, T = this.target; if (!T) return;
    if (w.mode !== 'walk') { const c = w.controls.target; w.teleport(c.x, c.z, 'walk'); }
    w.walker.auto = { x: T.x, z: T.z, onArrive: () => { this.onArrive && this.onArrive(); } };
  }
  /* ---- the rover pole (GNSS antenna on a 2 m range pole, data controller at chest height) ---- */
  makePole() {
    const g = new THREE.Group(), mat = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: e || 0 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.0, 8), mat(0xe8e8e8, 0.4)); pole.position.y = 1.0;
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.2, 8), mat(0xd23a2a)); b.position.y = 0.1 + k * 0.4; g.add(b); }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 8).rotateX(Math.PI), mat(0x888888, 0.8)); tip.position.y = -0.03;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.07, 20), mat(0xf2f2f2)); ant.position.y = 2.04;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2c3e50)); dome.position.y = 2.075;
    const ctrl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.025), mat(0x222831)); ctrl.position.set(0, 1.25, 0.05); ctrl.rotation.x = -0.5;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.11), new THREE.MeshBasicMaterial({ color: 0x6fd3ff })); scr.position.set(0, 1.255, 0.064); scr.rotation.x = -0.5;
    const bubble = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 16).rotateX(Math.PI / 2), mat(0x3ddc84)); bubble.position.y = 1.5;
    g.add(pole, tip, ant, dome, ctrl, scr, bubble); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
  }
  step(dt) {
    const w = this.w;
    this.pole.visible = this.active && w.mode === 'walk';
    if (this.pole.visible) { const p = this.poleTip(); this.pole.position.set(p.x, w.hAt(p.x, p.z), p.z); this.pole.rotation.y = w.walker.yaw; }
    if (this.flash > 0) { this.flash -= dt; this.pole.scale.setScalar(1 + Math.max(0, this.flash) * 0.08); }
    if (this.beam) { const t = performance.now() / 1000; this.beam.material.opacity = 0.2 + 0.12 * Math.sin(t * 3); this.ring.scale.setScalar(1 + 0.25 * (t * 1.2 % 1)); this.ring.material.opacity = 0.9 * (1 - t * 1.2 % 1); }
    w.surveyHud = this.active ? this.guidance() : null;
  }
  /* ---- export ---- */
  csv() {
    return ['id,code,lat,lon,utm_zone,easting,northing,elevation_m,source,time', ...this.points.map(p => [p.id, `"${p.code}"`, p.lat.toFixed(7), p.lon.toFixed(7), p.zone + 'N', p.E.toFixed(2), p.N.toFixed(2), p.h.toFixed(2), p.src, p.t].join(','))].join('\n');
  }
  geojson() {
    const f = this.points.map(p => ({ type: 'Feature', properties: { id: p.id, code: p.code, elevation_m: +p.h.toFixed(2), easting: +p.E.toFixed(2), northing: +p.N.toFixed(2) }, geometry: { type: 'Point', coordinates: [+p.lon.toFixed(7), +p.lat.toFixed(7), +p.h.toFixed(2)] } }));
    const c = this.verts.map(v => { const ll = this.toLL(v.x, v.z); return [+ll.lon.toFixed(7), +ll.lat.toFixed(7), +this.real(v.x, v.z).toFixed(2)]; });
    if (this.tool === 'line' && c.length > 1) { const m = this.measureLine(); f.push({ type: 'Feature', properties: { kind: 'distance', horizontal_m: +m.d2.toFixed(2), along_ground_m: +m.d3.toFixed(2) }, geometry: { type: 'LineString', coordinates: c } }); }
    if (this.tool === 'area' && c.length > 2) { const m = this.measureArea(); f.push({ type: 'Feature', properties: { kind: 'area', area_m2: +m.A.toFixed(1), surface_area_m2: +m.A3.toFixed(1), perimeter_m: +m.per2.toFixed(2) }, geometry: { type: 'Polygon', coordinates: [[...c, c[0]]] } }); }
    for (const p of this.parcels) f.push({ type: 'Feature', properties: { kind: 'parcel', name: p.name, area_m2: +p.area.toFixed(1), surface_area_m2: +p.area3.toFixed(1), perimeter_m: +p.per.toFixed(2) }, geometry: { type: 'Polygon', coordinates: [[...p.coords, p.coords[0]]] } });
    return JSON.stringify({ type: 'FeatureCollection', features: f }, null, 1);
  }
  kml() {
    const pm = this.points.map(p => `<Placemark><name>${p.id}</name><description>${p.code} · ${p.h.toFixed(2)} m</description><Point><coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},${p.h.toFixed(2)}</coordinates></Point></Placemark>`);
    const c = this.verts.map(v => { const ll = this.toLL(v.x, v.z); return `${ll.lon.toFixed(7)},${ll.lat.toFixed(7)},0`; });
    if (this.tool === 'line' && c.length > 1) pm.push(`<Placemark><name>Distance</name><LineString><tessellate>1</tessellate><coordinates>${c.join(' ')}</coordinates></LineString></Placemark>`);
    if (this.tool === 'area' && c.length > 2) pm.push(`<Placemark><name>Area</name><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${[...c, c[0]].join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Cambodia 3D survey</name>${pm.join('')}</Document></kml>`;
  }
}
