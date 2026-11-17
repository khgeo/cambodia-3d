// Geospatial-intelligence tools: map notes, routes & access (route, reach, choke points), alerts (GDACS, NASA EONET,
// NASA VIIRS fire detections), counting objects in the image (find similar) and a share link.
import * as THREE from 'three';

export const HW = ['', 'motorway', 'motorway link', 'trunk', 'trunk link', 'primary', 'primary link', 'secondary', 'secondary link', 'tertiary', 'tertiary link', 'unclassified', 'residential', 'living street', 'service', 'pedestrian', 'track', 'footway', 'path', 'cycleway', 'steps', 'construction'];
const label = (txt, col, big) => { const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); x.font = `700 ${big ? 34 : 28}px system-ui, "Noto Sans Khmer", sans-serif`; x.lineWidth = 7; x.strokeStyle = '#000'; x.fillStyle = col; x.strokeText(txt, 8, 44); x.fillText(txt, 8, 44); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const disposeGroup = g => { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); g.clear(); };

/* ================= map notes (pins with text, source, confidence, time and photo) ================= */
const NKEY = 'cambodia3d.notes.v1', CONF = { high: '#3fdc5f', medium: '#ffb547', low: '#ff5a3c' };
export class Notes {
  constructor(w) { this.w = w; this.group = new THREE.Group(); try { this.list = JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch (e) { this.list = []; } }
  save() { try { localStorage.setItem(NKEY, JSON.stringify(this.list)); } catch (e) { // photos can fill the storage: keep the notes, drop the oldest photos
      for (const n of this.list) { if (n.photo) { n.photo = null; try { localStorage.setItem(NKEY, JSON.stringify(this.list)); return; } catch (e2) { } } } } }
  inAOI(n) { const a = this.w.D.aoi; return n.lon >= a.w && n.lon <= a.e && n.lat >= a.s && n.lat <= a.n; }
  here() { return this.list.filter(n => this.inAOI(n)); }
  add(x, z, o) { const F = this.w.F, n = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), lon: +F.lon(x).toFixed(7), lat: +F.lat(z).toFixed(7), t: new Date().toISOString(), title: o.title || 'Note', text: o.text || '', source: o.source || '', conf: o.conf || 'medium', photo: o.photo || null }; this.list.push(n); this.save(); this.rebuild(); return n; }
  update(n, o) { Object.assign(n, o); this.save(); this.rebuild(); }
  remove(n) { this.list = this.list.filter(q => q !== n); this.save(); this.rebuild(); }
  nearest(x, z, tol) { const F = this.w.F; let best = null, bd = tol; for (const n of this.here()) { const d = Math.hypot(F.x(n.lon) - x, F.z(n.lat) - z); if (d < bd) { bd = d; best = n; } } return best; }
  rebuild() {
    const w = this.w; if (!w.D) return; if (!this.group.parent) w.root.add(this.group); disposeGroup(this.group);
    for (const n of this.here()) { const x = w.F.x(n.lon), z = w.F.z(n.lat), y = w.hAt(x, z), col = CONF[n.conf] || CONF.medium;
      const c = document.createElement('canvas'); c.width = 64; c.height = 96; const g = c.getContext('2d'); g.fillStyle = col; g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(32, 92); g.bezierCurveTo(10, 56, 4, 44, 4, 32); g.arc(32, 32, 28, Math.PI, 0); g.bezierCurveTo(60, 44, 54, 56, 32, 92); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 11, 0, 7); g.fill();
      if (n.photo) { g.fillStyle = '#111'; g.font = '700 20px system-ui'; g.textAlign = 'center'; g.fillText('📷', 32, 40); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true })); pin.center.set(0.5, 0); pin.scale.set(0.028, 0.042, 1); pin.position.set(x, y + 0.3, z); pin.renderOrder = 40; pin.userData.note = n;
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(n.title, '#fff'), sizeAttenuation: false, depthTest: false, transparent: true })); lab.center.set(-0.02, -0.55); lab.scale.set(0.12, 0.015, 1); lab.position.copy(pin.position); lab.renderOrder = 41;
      this.group.add(pin, lab); }
  }
  geojson() { return { type: 'FeatureCollection', features: this.here().map(n => ({ type: 'Feature', properties: { title: n.title, text: n.text, source: n.source, confidence: n.conf, time: n.t, has_photo: !!n.photo }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } })) }; }
}

/* ================= routes & access on the road network ================= */
const PROFILES = { car: { 1: 90, 2: 60, 3: 80, 4: 50, 5: 70, 6: 45, 7: 60, 8: 40, 9: 50, 10: 35, 11: 40, 12: 30, 13: 15, 14: 20, 16: 20, def: 30 }, moto: { 1: 70, 3: 70, 5: 60, 7: 55, 9: 45, 11: 40, 12: 30, 13: 15, 14: 20, 16: 25, 17: 10, 18: 10, def: 30 }, truck: { 1: 80, 3: 70, 5: 60, 7: 50, 9: 40, 11: 30, 12: 25, 14: 15, 16: 10, def: 25 }, foot: { def: 5 } };
export class Router {
  constructor(w) { this.w = w; this.group = new THREE.Group(); this.profile = 'car'; this.build(); }
  build() {
    const roads = this.w.net ? this.w.net.roads : [], key = p => Math.round(p.x * 2) + ',' + Math.round(p.z * 2), id = new Map(), X = [], Z = [], Y = [], adj = [];
    const node = p => { const k = key(p); let i = id.get(k); if (i === undefined) { i = X.length; id.set(k, i); X.push(p.x); Z.push(p.z); Y.push(p.y); adj.push([]); } return i; };
    this.edges = []; roads.forEach((r, ri) => { for (let k = 1; k < r.pts.length; k++) { const a = node(r.pts[k - 1]), b = node(r.pts[k]); if (a === b) continue; const L = Math.hypot(X[b] - X[a], Z[b] - Z[a]), e = this.edges.length; this.edges.push({ a, b, L, ri, cls: r.cls, bridge: !!r.bridge, oneway: !!r.oneway }); adj[a].push(e); adj[b].push(e); } });
    Object.assign(this, { X, Z, Y, adj, key, id, roads }); this.n = X.length;
  }
  speed(e) { const P = PROFILES[this.profile]; if (this.profile !== 'foot' && (e.cls === 17 || e.cls === 18 || e.cls === 20) && !P[e.cls]) return 0; return (P[e.cls] || P.def) / 3.6; }
  nearestNode(x, z) { let best = -1, bd = Infinity; const c = this.w.net && this.w.net.near(x, z, 150)[0]; if (c) { const p = this.roads[c[0]].pts[c[1]], i = this.id.get(this.key(p)); if (i !== undefined) return i; } for (let i = 0; i < this.n; i++) { const d = Math.hypot(this.X[i] - x, this.Z[i] - z); if (d < bd) { bd = d; best = i; } } return best; }
  // Dijkstra on travel time (s); a small binary heap keeps it fast on tens of thousands of nodes
  dijkstra(src, maxT = Infinity) {
    const n = this.n, T = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), H = [], push = (t, i) => { H.push([t, i]); let k = H.length - 1; while (k) { const p = (k - 1) >> 1; if (H[p][0] <= H[k][0]) break; [H[p], H[k]] = [H[k], H[p]]; k = p; } };
    const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; k = m; } } return top; };
    T[src] = 0; push(0, src); const order = [];
    while (H.length) { const [t, i] = pop(); if (t > T[i] || t > maxT) continue; order.push(i);
      for (const e of this.adj[i]) { const E = this.edges[e], j = E.a === i ? E.b : E.a, v = this.speed(E); if (!v) continue; const nt = t + E.L / v; if (nt < T[j]) { T[j] = nt; prev[j] = e; push(nt, j); } } }
    return { T, prev, order };
  }
  route(x0, z0, x1, z1) {
    const a = this.nearestNode(x0, z0), b = this.nearestNode(x1, z1); if (a < 0 || b < 0) return null; const { T, prev } = this.dijkstra(a); if (!isFinite(T[b])) return { none: true };
    const pts = [], seq = []; let i = b, L = 0, bridges = 0; while (i !== a) { const e = this.edges[prev[i]]; L += e.L; if (e.bridge) bridges++; pts.push(i); seq.push(e); i = e.a === i ? e.b : e.a; } pts.push(a); pts.reverse();
    const crow = Math.hypot(x1 - x0, z1 - z0); disposeGroup(this.group); this.line(pts, 0x23d5ff, 4.5); this.endMark(pts[0], 'A'); this.endMark(pts[pts.length - 1], 'B');
    return { L, T: T[b], crow, bridges, steps: seq.length };
  }
  line(nodes, color, width, op = 0.95) { const w = this.w, pos = [], idx = []; const P = nodes.map(i => new THREE.Vector3(this.X[i], this.Y[i] + 1.2, this.Z[i]));
    P.forEach((p, k) => { const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l * width / 2, nz = tx / l * width / 2; pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz); if (k) { const q = 2 * k; idx.push(q - 2, q, q - 1, q - 1, q, q + 1); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, side: THREE.DoubleSide, depthTest: false })); m.renderOrder = 30; if (!this.group.parent) w.root.add(this.group); this.group.add(m); }
  ribbons(segs, color, width, op = 0.92) { const pos = [], idx = []; let v = 0;
    for (const [a, b] of segs) { const ax = this.X[a], az = this.Z[a], bx = this.X[b], bz = this.Z[b], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * width / 2, nz = (bx - ax) / l * width / 2, ya = this.Y[a] + 1.3, yb = this.Y[b] + 1.3;
      pos.push(ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); v += 4; }
    if (!v) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthTest: false })); m.renderOrder = 30; if (!this.group.parent) this.w.root.add(this.group); this.group.add(m); }
  endMark(i, txt) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(txt, '#23d5ff', true), sizeAttenuation: false, depthTest: false, transparent: true })); s.center.set(0.02, 0); s.scale.set(0.11, 0.014, 1); s.position.set(this.X[i], this.Y[i] + 2, this.Z[i]); s.renderOrder = 42; this.group.add(s); }
  // how far you get in N minutes: roads coloured by travel-time band
  reach(x, z, minutes) {
    const src = this.nearestNode(x, z); if (src < 0) return null; const maxT = minutes * 60, { T } = this.dijkstra(src, maxT); disposeGroup(this.group);
    const bands = [[0.25, 0x2fdc6a], [0.5, 0xc6e83a], [0.75, 0xffb02e], [1.0001, 0xff4a3a]], segs = bands.map(() => []); let km = 0;
    for (const e of this.edges) { const t = Math.max(T[e.a], T[e.b]); if (!isFinite(t) || t > maxT) continue; const b = bands.findIndex(([f]) => t <= f * maxT); segs[b].push(e); km += e.L / 1000; }
    bands.forEach(([, col], k) => this.ribbons(segs[k].map(e => [e.a, e.b]), col, 3.4));
    this.endMark(src, '●'); return { km, n: segs.reduce((s, a) => s + a.length, 0) };
  }
  // choke points: the road pieces that most shortest trips pass through (sampled betweenness), plus bridges
  async choke(samples = 40, say = () => { }) {
    const n = this.n, score = new Float64Array(this.edges.length); if (!n) return [];
    for (let s = 0; s < samples; s++) { const src = (Math.random() * n) | 0, { T, prev, order } = this.dijkstra(src), dep = new Float64Array(n);
      for (let k = order.length - 1; k > 0; k--) { const i = order[k], e = prev[i]; if (e < 0) continue; const E = this.edges[e], p = E.a === i ? E.b : E.a; dep[p] += 1 + dep[i]; score[e] += 1 + dep[i]; }
      if (s % 5 === 4) { say(`Analysing the network… ${Math.round((s + 1) / samples * 100)}%`); await new Promise(r => setTimeout(r, 0)); } }
    disposeGroup(this.group); const max = Math.max(...score) || 1;
    // merge consecutive edges of the same road into pieces and keep the top ones
    const byRoad = new Map(); this.edges.forEach((e, k) => { const v = score[k] / max; if (v < 0.25) return; const key = e.ri; (byRoad.get(key) || byRoad.set(key, []).get(key)).push([k, v]); });
    const pieces = []; for (const [ri, arr] of byRoad) { const v = Math.max(...arr.map(a => a[1])), E = arr.map(a => this.edges[a[0]]); pieces.push({ ri, v, E, bridge: E.some(e => e.bridge), cls: E[0].cls }); }
    pieces.sort((a, b) => b.v - a.v); const top = pieces.slice(0, 12);
    this.ribbons(this.edges.filter(e => e.bridge).map(e => [e.a, e.b]), 0xd36bff, 7, 0.9);
    top.forEach((p, k) => { this.ribbons(p.E.map(e => [e.a, e.b]), p.v > 0.7 ? 0xff2a2a : p.v > 0.45 ? 0xff8a2a : 0xffd23f, 5, 0.95); const m = p.E[Math.floor(p.E.length / 2)]; this.endMark(m.a, `${k + 1}${p.bridge ? ' 🌉' : ''}`); });
    const F = this.w.F; return top.map((p, k) => { const m = p.E[Math.floor(p.E.length / 2)]; return { rank: k + 1, share: p.v, bridge: p.bridge, road: HW[p.cls] || 'road', lat: F.lat(this.Z[m.a]), lon: F.lon(this.X[m.a]) }; });
  }
  clear() { disposeGroup(this.group); }
}

/* ================= alerts: disasters and fires near the area ================= */
export async function alertsNear(lat, lon, km = 300, say = () => { }) {
  const out = [], dist = (la, lo) => { const R = 6371, dLa = (la - lat) * Math.PI / 180, dLo = (lo - lon) * Math.PI / 180, a = Math.sin(dLa / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(la * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
  const d0 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), d1 = new Date().toISOString().slice(0, 10), ICON = { EQ: '🌐', TC: '🌀', FL: '🌊', VO: '🌋', WF: '🔥', DR: '🏜️' }, NAME = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', WF: 'Wildfire', DR: 'Drought' };
  say('Checking GDACS…');
  try { const j = await (await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&fromdate=${d0}&todate=${d1}&alertlevel=Green;Orange;Red`)).json();
    for (const f of j.features || []) { const [lo, la] = f.geometry.coordinates, P = f.properties, d = dist(la, lo), big = P.eventtype === 'DR' || P.eventtype === 'TC' ? 2.5 : 1; if (d > km * big) continue;
      out.push({ src: 'GDACS', type: NAME[P.eventtype] || P.eventtype, icon: ICON[P.eventtype] || '⚠️', title: P.name, level: P.alertlevel, lat: la, lon: lo, km: d, from: P.fromdate, to: P.todate, url: P.url && P.url.report, id: 'g' + P.eventid + '_' + P.episodeid }); } } catch (e) { }
  say('Checking NASA EONET…');
  try { const j = await (await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30')).json();
    for (const ev of j.events || []) { const g = ev.geometry && ev.geometry[ev.geometry.length - 1]; if (!g || g.type !== 'Point') continue; const [lo, la] = g.coordinates, d = dist(la, lo); if (d > km) continue;
      out.push({ src: 'NASA EONET', type: ev.categories[0] ? ev.categories[0].title : 'Event', icon: '🛰️', title: ev.title, level: '', lat: la, lon: lo, km: d, from: ev.geometry[0].date, to: g.date, url: ev.link, id: 'e' + ev.id }); } } catch (e) { }
  say('Checking fire detections (VIIRS)…');
  try { out.push(...await firesNear(lat, lon, Math.min(km, 120), dist)); } catch (e) { }
  out.sort((a, b) => a.km - b.km); say(''); return out;
}
// VIIRS 375 m active-fire detections of the last two days from NASA GIBS (rendered points → positions)
async function firesNear(lat, lon, km, dist) {
  const dl = km / 111, dlo = km / (111 * Math.cos(lat * Math.PI / 180)), W = 512, H = 512, out = [], seen = new Set();
  for (const days of [0, 1]) { const t = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    for (const L of ['VIIRS_NOAA20_Thermal_Anomalies_375m_All', 'VIIRS_SNPP_Thermal_Anomalies_375m_All']) {
      const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=${lat - dl},${lon - dlo},${lat + dl},${lon + dlo}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=true&LAYERS=${L}&TIME=${t}`;
      const im = await new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = url; }).catch(() => null); if (!im) continue;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const q = (y * W + x) * 4; if (d[q + 3] < 100) continue; const la = lat + dl - (y + .5) / H * 2 * dl, lo = lon - dlo + (x + .5) / W * 2 * dlo, k = Math.round(la * 50) + ',' + Math.round(lo * 50); if (seen.has(k)) continue; seen.add(k);
        const dd = dist(la, lo); if (dd <= km) out.push({ src: 'NASA VIIRS', type: 'Active fire', icon: '🔥', title: `Fire detection ${t}`, level: '', lat: la, lon: lo, km: dd, from: t, to: t, id: 'f' + k + t }); } } }
  return out;
}

/* ================= count objects: click one example, find all similar ones in the image ================= */
export function findSimilar(canvas, px, py, tol = 28, minF = 0.4, maxF = 2.5, given = null) {
  const W = canvas.width, H = canvas.height, g = canvas.getContext('2d', { willReadFrequently: true }), d = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const q = (y * W + x) * 4; return [d[q], d[q + 1], d[q + 2]]; }, lab = ([r, g2, b]) => [0.299 * r + 0.587 * g2 + 0.114 * b, r - g2, (r + g2) / 2 - b];
  // example colour = mean of a 3×3 window; example blob by flood fill
  let ref = [0, 0, 0]; if (given) ref = given.ref; else for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const c = lab(at(Math.min(W - 1, Math.max(0, px + i)), Math.min(H - 1, Math.max(0, py + j)))); ref = ref.map((v, k) => v + c[k] / 9); }
  const close = (x, y) => { const c = lab(at(x, y)); return Math.hypot((c[0] - ref[0]) * 0.8, c[1] - ref[1], c[2] - ref[2]) < tol; };
  const mask = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (close(x, y)) mask[y * W + x] = 1;
  const lbl = new Int32Array(W * H), blobs = []; let id = 0; const st = [];
  for (let s = 0; s < W * H; s++) { if (!mask[s] || lbl[s]) continue; id++; let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; st.push(s); lbl[s] = id;
    while (st.length) { const q = st.pop(), x = q % W, y = (q / W) | 0; n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const nq of [q - 1, q + 1, q - W, q + W]) if (nq >= 0 && nq < W * H && mask[nq] && !lbl[nq] && Math.abs((nq % W) - x) <= 1) { lbl[nq] = id; st.push(nq); } }
    blobs[id] = { n, cx: sx / n, cy: sy / n, fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1)), w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
  const ex = given ? given.ex : blobs[lbl[py * W + px]]; if (!ex) return { count: 0, items: [], example: null };
  const items = blobs.filter(b => b && b.n >= ex.n * minF && b.n <= ex.n * maxF && b.fill > Math.min(0.35, ex.fill * 0.6) && Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h)) < Math.max(4, (Math.max(ex.w, ex.h) / Math.max(1, Math.min(ex.w, ex.h))) * 1.8));
  return { count: items.length, items, example: ex, ref };
}

/* ================= share link: area, view, notes, tactical symbols and your drawings in the URL ================= */
const b64u = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const B64U = buf => b64u(buf)
const toU = s => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function packState(obj) { const data = new TextEncoder().encode(JSON.stringify(obj)); if (!window.CompressionStream) return 'j' + toU(B64U(data));
  const cs = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw')); return 'z' + toU(B64U(await new Response(cs).arrayBuffer())); }
export async function unpackState(s) { if (!s) return null; const bytes = ub64u(s.slice(1)); if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return JSON.parse(await new Response(ds).text()); }
