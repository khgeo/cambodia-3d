// 3D GPS navigation on the road network of the 3D area: route planning (car / motorbike / walk, alternatives),
// turn-by-turn guidance with lane advice, traffic lights with countdowns (simulated timings), voice prompts,
// a follow camera, live GPS or a simulated drive, trip summary and GPX export.
import * as THREE from 'three';
import { t, lang } from './i18n.js?v=112';

const KMH = 1 / 3.6;
// travel speeds by OSM class (km/h): 1 motorway … 12 residential, 13 living street, 14 service, 16 track
const SPEED = { car: { 1: 90, 2: 60, 3: 80, 4: 50, 5: 65, 6: 45, 7: 55, 8: 40, 9: 45, 10: 35, 11: 35, 12: 28, 13: 12, 14: 18, 16: 20, def: 30 },
  moto: { 1: 70, 2: 50, 3: 65, 4: 45, 5: 55, 6: 40, 7: 50, 8: 38, 9: 42, 10: 32, 11: 32, 12: 26, 13: 14, 14: 18, 16: 22, def: 28 },
  walk: { def: 4.8 } };
// approximate legal limits for the banner (Cambodian Land Traffic Law: 40 km/h in towns, 90 outside for cars)
const limitOf = (cls, urban, prof) => { if (prof === 'walk') return 0; const m = prof === 'moto'; if (urban) return cls <= 7 ? (m ? 40 : 40) : 30; return cls <= 4 ? (m ? 70 : 90) : cls <= 6 ? (m ? 70 : 80) : cls <= 10 ? 60 : cls === 16 ? 30 : 40; };
const CLASS_NAME = { 1: 'Expressway', 2: 'Expressway ramp', 3: 'National road', 4: 'National road ramp', 5: 'Main road', 6: 'Main road ramp', 7: 'Provincial road', 8: 'Ramp', 9: 'Local road', 10: 'Ramp', 11: 'Village road', 12: 'Street', 13: 'Lane', 14: 'Service road', 16: 'Dirt track' };
const hash = (x, z) => { let h = Math.imul(Math.round(x * 3) | 0, 73856093) ^ Math.imul(Math.round(z * 3) | 0, 19349663); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h >>> 0) / 4294967296; };
const norm = a => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q, ms = 25000) {
  for (const ep of OVERPASS) { try { const c = new AbortController(), k = setTimeout(() => c.abort(), ms); const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: c.signal }); clearTimeout(k); if (r.ok) return await r.json(); } catch (e) { } }
  return null;
}

// manoeuvre icons (SVG), drawn white on the banner
const ICON = {
  straight: 'M12 3l-6 7h4v11h4V10h4z',
  slight_left: 'M7 3v8l2.5-2.5L14 13v8h4v-9.5L12.3 6l2.5-2.5z', slight_right: 'M17 3v8l-2.5-2.5L10 13v8H6v-9.5L11.7 6 9.2 3.5z',
  left: 'M9 5L3 10l6 5v-3h6v9h4V10a2 2 0 00-2-2H9z', right: 'M15 5l6 5-6 5v-3H9v9H5V10a2 2 0 012-2h8z',
  sharp_left: 'M4 4v8l2.7-2.7L15 17.6V21h4v-5L9.5 6.5 12 4z', sharp_right: 'M20 4v8l-2.7-2.7L9 17.6V21H5v-5l9.5-9.5L12 4z',
  uturn: 'M17 21V9a5 5 0 00-10 0v4H4l5 6 5-6h-3V9a1 1 0 012 0v12z', arrive: 'M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z',
  depart: 'M12 3l-6 7h4v11h4V10h4z',
};
const svg = (k, s = 44, col = '#fff') => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="${ICON[k] || ICON.straight}" fill="${col}"/></svg>`;
const TURN_WORD = { straight: 'Continue straight', slight_left: 'Keep left', slight_right: 'Keep right', left: 'Turn left', right: 'Turn right', sharp_left: 'Turn sharp left', sharp_right: 'Turn sharp right', uturn: 'Make a U-turn', arrive: 'Arrive at the destination', depart: 'Head off' };
const TURN_KM = { straight: 'បន្តត្រង់', slight_left: 'ចូលខាងឆ្វេង', slight_right: 'ចូលខាងស្ដាំ', left: 'បត់ឆ្វេង', right: 'បត់ស្ដាំ', sharp_left: 'បត់ឆ្វេងខ្លាំង', sharp_right: 'បត់ស្ដាំខ្លាំង', uturn: 'ត្រឡប់ក្រោយ', arrive: 'មកដល់ទិសដៅ', depart: 'ចេញដំណើរ' };
const turnType = d => { const a = Math.abs(d), sd = d < 0 ? 'left' : 'right'; if (a < 28) return 'straight'; if (a < 55) return 'slight_' + sd; if (a < 135) return sd; if (a < 165) return 'sharp_' + sd; return 'uturn'; };

export class Nav {
  constructor(world, opts = {}) {
    this.w = world; this.o = opts; this.active = false; this.prof = 'car'; this.trip = null; this.routes = []; this.sel = 0; this.from = null; this.to = null; this.pickWhat = 'to';
    this.voice = true; this.camMode = '3d'; this.follow = true; this.mult = 1; this.names = new Map(); this.signals = null; this.recent = [];
    try { this.recent = JSON.parse(localStorage.getItem('cambodia3d.nav.recent') || '[]'); } catch (e) { }
    this.group = new THREE.Group(); this.group.name = 'nav'; this.time = { value: 0 };
    this._down = e => { if (this.trip && e.isPrimary !== false) { this.follow = false; this.idle = 0; this.showRecenter(true); } };
    world.renderer.domElement.addEventListener('pointerdown', this._down); world.renderer.domElement.addEventListener('wheel', this._down, { passive: true });
  }

  /* ---------------- road graph (directed: one-way roads only one way) ---------------- */
  rebuild() { this.G = null; if (this.active) { this.build(); if (this.from && this.to) this.plan(); } }
  build() {
    const roads = this.w.net ? this.w.net.roads : [], key = p => Math.round(p.x * 2) + ',' + Math.round(p.z * 2), id = new Map(), X = [], Z = [], Y = [], out = [], nb = [];
    const node = p => { const k = key(p); let i = id.get(k); if (i === undefined) { i = X.length; id.set(k, i); X.push(p.x); Z.push(p.z); Y.push(p.y); out.push([]); nb.push(new Set()); } return i; };
    const E = [];
    roads.forEach((r, ri) => { for (let k = 1; k < r.pts.length; k++) { const a = node(r.pts[k - 1]), b = node(r.pts[k]); if (a === b) continue; const L = Math.hypot(X[b] - X[a], Z[b] - Z[a]);
      const base = { L, ri, cls: r.cls, lanes: r.lanes || 1, hw: r.hw, urban: !!r.urban, oneway: !!r.oneway, bridge: !!r.bridge };
      E.push({ ...base, a, b, dir: 1 }); out[a].push(E.length - 1); E.push({ ...base, a: b, b: a, dir: -1 }); out[b].push(E.length - 1); nb[a].add(b); nb[b].add(a); } });
    this.G = { X, Z, Y, out, E, deg: nb.map(s => s.size), key, id, roads, n: X.length };
  }
  nodeNear(x, z) { const G = this.G, c = this.w.net && this.w.net.near(x, z, 250)[0]; if (c) { const p = G.roads[c[0]].pts[c[1]], i = G.id.get(G.key(p)); if (i !== undefined) return i; }
    let best = -1, bd = Infinity; for (let i = 0; i < G.n; i++) { const d = Math.hypot(G.X[i] - x, G.Z[i] - z); if (d < bd) { bd = d; best = i; } } return best; }
  speedOf(e, prof = this.prof) { if (prof === 'walk') return SPEED.walk.def * KMH; if (e.oneway && e.dir < 0) return 0; if (this.avoidTracks && e.cls === 16) return (SPEED[prof][16] || 20) * KMH * 0.25; const S = SPEED[prof]; return (S[e.cls] || S.def) * KMH; }
  // A* on time (or distance); pen: edge index -> cost factor (for alternatives)
  search(a, b, { prof = this.prof, dist = false, pen = null } = {}) {
    const G = this.G, n = G.n, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), H = [], vmax = dist ? 1 : (prof === 'walk' ? SPEED.walk.def : 90) * KMH;
    const h = i => Math.hypot(G.X[i] - G.X[b], G.Z[i] - G.Z[b]) / vmax;
    const push = (f, i) => { H.push([f, i]); let k = H.length - 1; while (k) { const p = (k - 1) >> 1; if (H[p][0] <= H[k][0]) break; [H[p], H[k]] = [H[k], H[p]]; k = p; } };
    const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; k = m; } } return top; };
    g[a] = 0; push(h(a), a);
    while (H.length) { const [f, i] = pop(); if (i === b) break; if (f - h(i) > g[i] + 1e-9) continue;
      for (const ei of G.out[i]) { const e = G.E[ei], v = this.speedOf(e, prof); if (!v) continue; let c = dist ? e.L : e.L / v; if (pen && pen.has(ei)) c *= pen.get(ei);
        const ng = g[i] + c; if (ng < g[e.b]) { g[e.b] = ng; prev[e.b] = ei; push(ng + h(e.b), e.b); } } }
    if (!isFinite(g[b])) return null; const edges = []; let i = b; while (i !== a) { const ei = prev[i]; edges.push(ei); i = this.G.E[ei].a; } return edges.reverse();
  }

  /* ---------------- planning ---------------- */
  async open() {
    this.active = true; if (!this.G) this.build(); if (!this.group.parent) this.w.scene.add(this.group);
    this.loadExtras(); this.renderPanel();
  }
  close() { const was = this.active; this.stop(true); this.active = false; if (was && this.o.onClose) this.o.onClose(); this.clear3D(); this.w.scene.remove(this.group); this.from = this.to = null; this.routes = []; }
  async loadExtras() { // street names and traffic signals from OpenStreetMap (once per area)
    const D = this.w.D, a = D.aoi, k = [a.w, a.s, a.e, a.n].map(v => v.toFixed(4)).join(',');
    if (this._extrasFor === k) return; this._extrasFor = k; this.names = new Map(); this.signals = null;
    const bb = `${a.s - 0.002},${a.w - 0.002},${a.n + 0.002},${a.e + 0.002}`;
    const j = await overpass(`[out:json][timeout:25];(way["highway"]["name"](${bb});way["highway"]["ref"](${bb}););out tags;node["highway"="traffic_signals"](${bb});out;`);
    const sig = [];
    if (j) for (const e of j.elements || []) { const g = e.tags || {};
      if (e.type === 'way') this.names.set(e.id, { en: g['name:en'] || g.name || '', km: g['name:km'] || (/[ក-៿]/.test(g.name || '') ? g.name : '') || g.name || '', ref: g.ref || '' });
      else if (e.type === 'node' && g.highway === 'traffic_signals') sig.push({ x: this.w.F.x(e.lon), z: this.w.F.z(e.lat), osm: true }); }
    this.signals = sig; this.osmOk = !!j;
    if (this.routes.length && !this.trip) { this.routes.forEach(r => this.prepare(r)); this.label(this.routes); this.sel = 0; this.renderPanel(); this.draw(); }
  }
  setPoint(which, x, z, label) {
    if (!this.G) this.build(); const i = this.nodeNear(x, z); if (i < 0) { this.say('No road near that point.'); return; }
    const p = { x, z, node: i, label: label || this.placeLabel(x, z) }; this[which] = p;
    if (which === 'to' && label) { this.recent = [{ label, lon: this.w.F.lon(x), lat: this.w.F.lat(z) }, ...this.recent.filter(r => r.label !== label)].slice(0, 8); try { localStorage.setItem('cambodia3d.nav.recent', JSON.stringify(this.recent)); } catch (e) { } }
    if (this.from && this.to) this.plan(); else { this.drawMarks(); this.renderPanel(); }
  }
  placeLabel(x, z) { const n = this.w.net && this.w.net.near(x, z, 60)[0]; if (n) { const r = this.G.roads[n[0]]; return this.roadName({ ri: n[0], cls: r.cls }); } return `${this.w.F.lat(z).toFixed(5)}, ${this.w.F.lon(x).toFixed(5)}`; }
  pick(x, z) { if (this.trip) return; this.setPoint(this.pickWhat, x, z); if (this.pickWhat === 'from') this.pickWhat = 'to'; }
  plan() {
    const a = this.from.node, b = this.to.node; this.routes = []; if (a === b) { this.say('Start and destination are the same place.'); this.renderPanel(); return; }
    const fast = this.search(a, b); if (!fast) { this.say('No road route between these points (one-way streets or the network is split).'); this.renderPanel(); this.drawMarks(); return; }
    const R = [{ edges: fast, kind: 'Fastest' }], pen = new Map(); fast.forEach(ei => { pen.set(ei, 1.6); pen.set(ei ^ 1, 1.6); });
    const alt = this.search(a, b, { pen }), short = this.search(a, b, { dist: true });
    const same = (p, q) => { const s = new Set(p.map(e => e >> 1)); return q.filter(e => s.has(e >> 1)).length / Math.max(p.length, q.length) > 0.8; };
    if (alt && !same(fast, alt)) R.push({ edges: alt, kind: 'Alternative' }); if (short && !R.some(r => same(r.edges, short))) R.push({ edges: short, kind: 'Shortest' });
    R.forEach(r => this.prepare(r)); this.label(R); this.routes = R; this.sel = 0; this.renderPanel(); this.draw(); this.frameRoute();
  }
  label(R) { R.sort((a, b) => a.T - b.T); const sh = R.reduce((m, r) => r.L < m.L ? r : m, R[0]); R.forEach((r, i) => { r.kind = i === 0 ? 'Fastest' : r === sh ? 'Shortest' : 'Alternative'; }); if (sh === R[0] && R.length > 1) R[0].kind = 'Fastest'; }
  roadName(e) { const r = this.G.roads[e.ri], n = r && this.names.get(r.id); if (n) { const nm = lang === 'km' ? (n.km || n.en) : (n.en || n.km); if (nm && n.ref) return `${nm} (${n.ref})`; if (nm) return nm; if (n.ref) return (lang === 'km' ? 'ផ្លូវ ' : 'Road ') + n.ref; } return t(CLASS_NAME[e.cls] || 'Road'); }
  // polyline (driving on the right), manoeuvres, lights, times
  prepare(R) {
    const G = this.G, E = R.edges.map(i => G.E[i]), nodes = [E[0].a, ...E.map(e => e.b)], prof = this.prof;
    // centre-line points with the lateral offset of the right-hand carriageway
    const C = nodes.map((n, k) => { const e = E[Math.min(k, E.length - 1)]; return { x: G.X[n], z: G.Z[n], y: G.Y[n], off: prof === 'walk' ? 0 : e.oneway ? 0 : Math.min(e.hw * 0.5, 3.2), e: Math.min(k, E.length - 1) }; });
    for (let k = 0; k < C.length; k++) { let s = 0, w = 0; for (let j = Math.max(0, k - 2); j <= Math.min(C.length - 1, k + 2); j++) { s += C[j].off; w++; } C[k].o2 = s / w; }
    const P = C.map((p, k) => { const a = C[Math.max(0, k - 1)], b = C[Math.min(C.length - 1, k + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; return { x: p.x - tz / l * p.o2, z: p.z + tx / l * p.o2, y: p.y, e: p.e, n: nodes[k] }; });
    let s = 0; P.forEach((p, k) => { if (k) s += Math.hypot(p.x - P[k - 1].x, p.z - P[k - 1].z); p.s = s; }); R.P = P; R.L = s; R.E = E;
    // headings measured over ~12 m either side of a node
    const at = (k, dir) => { const s0 = P[k].s; let j = k; while (j + dir >= 0 && j + dir < P.length && Math.abs(P[j].s - s0) < 12) j += dir; return P[j]; };
    const hd = (p, q) => Math.atan2(q.x - p.x, -(q.z - p.z)) * 180 / Math.PI;
    const M = [];
    for (let k = 1; k < P.length - 1; k++) { const nd = P[k].n; if (G.deg[nd] < 3) continue; const ein = E[k - 1], eout = E[k];
      const d = norm(hd(P[k], at(k, 1)) - hd(at(k, -1), P[k])), ty = turnType(d), nameChange = this.roadName(ein) !== this.roadName(eout);
      if (ty === 'straight' && !nameChange) continue;
      // which ways can you go here (for the lane arrows)
      const opts = new Set(); for (const ei of G.out[nd]) { const o = G.E[ei]; if (o.b === ein.a || !this.speedOf(o, prof)) continue; const q = { x: G.X[o.b], z: G.Z[o.b] }; const dd = norm(hd(P[k], q) - hd(at(k, -1), P[k])); const tt = turnType(dd); opts.add(tt.includes('left') ? 'left' : tt.includes('right') ? 'right' : tt === 'uturn' ? 'uturn' : 'straight'); }
      const m = { k, s: P[k].s, type: ty, d, onto: this.roadName(eout), cls: eout.cls, ein, opts };
      if (M.length && m.s - M[M.length - 1].s < 15 && ty !== 'straight') M[M.length - 1] = m; else M.push(m); }
    M.push({ k: P.length - 1, s: R.L, type: 'arrive', onto: this.to ? this.to.label : '', opts: new Set() }); R.M = M;
    // traffic lights on the route: OpenStreetMap signals, else estimated at big junctions
    const sig = (this.signals && this.signals.length ? this.signals : []), Ls = [];
    const near = (x, z) => { let bk = -1, bd = 16; for (let k = 0; k < P.length; k++) { const d = Math.hypot(P[k].x - x, P[k].z - z); if (d < bd) { bd = d; bk = k; } } return bk; };
    for (const q of sig) { const k = near(q.x, q.z); if (k > 0 && k < P.length - 1) Ls.push({ s: P[k].s, k, x: q.x, z: q.z, osm: true }); }
    if (!sig.length) for (let k = 1; k < P.length - 1; k++) { const nd = P[k].n; if (G.deg[nd] < 3) continue; const big = G.out[nd].map(ei => G.E[ei]).filter(e => e.cls <= 7).length; if (big >= 3 && E[k - 1].cls <= 9) Ls.push({ s: P[k].s, k, x: G.X[nd], z: G.Z[nd], osm: false }); }
    Ls.sort((a, b) => a.s - b.s); const L2 = []; for (const l of Ls) if (!L2.length || l.s - L2[L2.length - 1].s > 30) L2.push(l);
    for (const l of L2) { const r = hash(l.x, l.z), C2 = 60 + Math.round(r * 60); Object.assign(l, { C: C2, G: Math.round(C2 * (0.38 + 0.2 * hash(l.z, l.x))), off: Math.round(r * 997) % C2, stop: Math.max(0, l.s - 7) });
      const m = M.find(m => Math.abs(m.s - l.s) < 20); l.turn = m ? m.type : 'straight'; }
    R.lights = L2;
    // time: driving + turns + expected waiting at red
    let T = 0; for (const e of E) T += e.L / this.speedOf(e, prof); T += M.filter(m => m.type !== 'straight' && m.type !== 'arrive').length * (prof === 'walk' ? 2 : 6);
    if (prof !== 'walk') T += L2.reduce((s2, l) => s2 + (l.C - l.G) ** 2 / (2 * l.C), 0);
    R.T = T; const names = []; for (const e of E) { const n = this.roadName(e); if (!names.includes(n)) names.push(n); } R.via = names.slice(0, 3);
  }
  // state of a light at time tt (s): green / yellow / red and seconds left
  now() { return this.trip && this.trip.sim ? this.trip.clock : Date.now() / 1000; }
  light(l, tt = this.now()) { const c = ((tt + l.off) % l.C + l.C) % l.C; if (c < l.G) return ['green', l.G - c]; if (c < l.G + 3) return ['yellow', l.G + 3 - c]; return ['red', l.C - c]; }

  /* ---------------- trip ---------------- */
  start(sim) {
    const R = this.routes[this.sel]; if (!R) return; this.stop(true);
    this.trip = { R, sim: sim === true, manual: sim === 'manual', clock: Date.now() / 1000, s: 0, v: 0, t0: performance.now(), driven: 0, waited: 0, stops: 0, said: new Set(), mi: 0, gpsOff: 0, hist: [], max: 0, last: null };
    this.follow = true; this.camMode = '3d'; this.makeCar(); this.draw(); this.renderHud(); this.o.onTrip && this.o.onTrip(true);
    if (sim === 'manual') this.manualStart(); else if (!sim) this.gpsStart(); this.announce(R.M[0], R.M[0].s, true);
  }
  stop(silent) {
    if (this.watch != null) { navigator.geolocation.clearWatch(this.watch); this.watch = null; }
    if (this.trip) { this.trip = null; this.w.controls.enabled = true; if (this.car) { this.group.remove(this.car); this.car = null; } if (this.ring) { this.group.remove(this.ring); this.ring = null; } this.removeHud(); this.o.onTrip && this.o.onTrip(false); if (!silent) { this.renderPanel(); this.draw(); } }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { }
  }
  gpsStart() {
    if (!navigator.geolocation) { this.toast('GPS is not available on this device – switching to a virtual GPS: you drive with the on-screen pedals.'); this.manualStart(); return; }
    this.watch = navigator.geolocation.watchPosition(p => this.gpsFix(p), e => { this.toast(t('GPS: ') + e.message); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  gpsFix(p) {
    const T = this.trip; if (!T || T.sim) return; const F = this.w.F, D = this.w.D, x = F.x(p.coords.longitude), z = F.z(p.coords.latitude);
    if (x < D.X0 - 80 || x > D.X0 + D.W + 80 || z < D.Z0 - 80 || z > D.Z0 + D.H + 80) { if (!T.manual) { this.toast('You are not in this 3D area – switching to a virtual GPS: you drive here with the on-screen pedals.'); navigator.geolocation.clearWatch(this.watch); this.watch = null; this.manualStart(); } return; }
    T.outside = false; const R = T.R; let bk = 0, bd = Infinity; const s0 = T.s; for (let k = 0; k < R.P.length; k++) { const q = R.P[k]; if (q.s < s0 - 60 || q.s > s0 + 400) continue; const d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; bk = k; } }
    T.fix = { x, z, acc: p.coords.accuracy, at: performance.now() }; if (p.coords.speed != null && p.coords.speed >= 0) T.gpsV = p.coords.speed;
    if (bd > Math.max(35, (p.coords.accuracy || 10) * 1.5)) { T.gpsOff++; if (T.gpsOff >= 4) { T.gpsOff = 0; this.reroute(x, z); } return; }
    T.gpsOff = 0; T.target = R.P[bk].s;
  }
  reroute(x, z) { const T = this.trip; if (!T) return; this.from = { x, z, node: this.nodeNear(x, z), label: t('Current position') }; const e = this.search(this.from.node, this.to.node); if (!e) return;
    const R = { edges: e, kind: 'Fastest' }; this.prepare(R); this.routes = [R]; this.sel = 0; T.R = R; T.s = 0; T.target = 0; T.said = new Set(); T.mi = 0; this.draw(); this.event('reroute', 'Route recalculated.'); this.toast('Route recalculated.'); }
  /* ---------------- virtual GPS: you drive on the road network with pedals; wrong turns re-route ---------------- */
  indexRoute(R) { R.kOf = new Map(); R.P.forEach((p, k) => { if (!R.kOf.has(p.n)) R.kOf.set(p.n, k); }); R.next = new Map(); R.edges.forEach(ei => R.next.set(this.G.E[ei].a, ei)); }
  manualStart() { const T = this.trip; if (!T) return; T.manual = true; T.sim = false; T.ce = T.R.edges[0]; T.off = 0; T.v = 0; this.indexRoute(T.R); this.pedal = {}; this.renderHud(); }
  edgeHd(e) { const G = this.G; return Math.atan2(G.X[e.b] - G.X[e.a], -(G.Z[e.b] - G.Z[e.a])) * 180 / Math.PI; }
  nextEdge(T, e) {
    const G = this.G, node = e.b; let C = G.out[node].filter(i => G.E[i].b !== e.a && this.speedOf(G.E[i])); if (!C.length) C = G.out[node].filter(i => this.speedOf(G.E[i])); if (!C.length) return null;
    let pick; const rn = T.R.next && T.R.next.get(node), turn = i => norm(this.edgeHd(G.E[i]) - this.edgeHd(e));
    if (C.length === 1) pick = C[0];
    else if (T.intent) { const want = T.intent === 'left' ? -90 : T.intent === 'right' ? 90 : 0; pick = C.reduce((b, i) => Math.abs(turn(i) - want) < Math.abs(turn(b) - want) ? i : b, C[0]); T.intent = null; this.showIntent(); }
    else if (rn != null && C.includes(rn)) pick = rn; else pick = C.reduce((b, i) => Math.abs(turn(i)) < Math.abs(turn(b)) ? i : b, C[0]);
    const onR = T.R.kOf && (T.R.kOf.has(node)); if (onR && pick !== rn && !T.arrived) this.manualReroute(T, pick);
    return pick; }
  manualReroute(T, ei) { const e = this.G.E[ei], r = this.search(e.b, this.to.node); if (!r) return; const R = { edges: r, kind: 'Fastest' }; this.prepare(R); this.indexRoute(R); this.routes = [R]; this.sel = 0; T.R = R; T.s = -e.L; T.mi = 0; T.said = new Set(); T.drawnMi = -1; this.draw(); this.event('reroute', 'Route recalculated.'); this.toast('Route recalculated.'); }
  manualStep(T, dt) {
    const G = this.G, P = this.pedal || {}; let e = G.E[T.ce]; const lim = limitOf(e.cls, e.urban, this.prof) || 40, vmax = Math.max(lim * KMH * 1.3, 6);
    if (P.gas) T.v = Math.min(vmax, T.v + 2.6 * dt); else if (P.brake) T.v = Math.max(0, T.v - 6.5 * dt); else T.v = Math.max(0, T.v - 0.35 * dt); if (T.arrived) T.v = 0;
    T.overT = !!lim && T.v * 3.6 > lim + 5; let move = T.v * dt;
    while (move > 0) { const rem = e.L - T.off; if (move < rem) { T.off += move; move = 0; } else { move -= rem; const nx = this.nextEdge(T, e); if (nx == null) { T.off = e.L; T.v = 0; break; } T.ce = nx; e = G.E[nx]; T.off = 0; } }
    const f = T.off / e.L, dx = G.X[e.b] - G.X[e.a], dz = G.Z[e.b] - G.Z[e.a], L = Math.hypot(dx, dz) || 1, o = this.prof === 'walk' || e.oneway ? 0 : Math.min(e.hw * 0.5, 3.2);
    T.mx = G.X[e.a] + dx * f - dz / L * o; T.mz = G.Z[e.a] + dz * f + dx / L * o; T.my = G.Y[e.a] + (G.Y[e.b] - G.Y[e.a]) * f; T.mhd = Math.atan2(dx, dz);
    const R = T.R, ka = R.kOf.get(e.a), kb = R.kOf.get(e.b); if (ka != null && kb === ka + 1) T.s = R.P[ka].s + (R.P[kb].s - R.P[ka].s) * f; else if (kb === 0) T.s = -(e.L - T.off);
    // red lights: stopping counts, running one is noticed
    const nl = R.lights.find(l => l.stop > T.s - 2); T.redStop = false; if (nl && this.prof !== 'walk') { const [st] = this.light(nl), d = nl.stop - T.s; if (st === 'red' && d < 15 && d > -1) T.redStop = true; if (st === 'red' && d < 0 && d > -2 && T.v > 2 && T.ranL !== nl) { T.ranL = nl; this.toast('🚨 You drove through a red light!'); } }
  }
  showIntent() { const b = this.el('nvIntent'); if (b) { const T = this.trip; b.textContent = T && T.intent ? (T.intent === 'left' ? '⬅ ' + t('next junction: left') : T.intent === 'right' ? '➡ ' + t('next junction: right') : '⬆ ' + t('next junction: straight')) : ''; b.hidden = !(T && T.intent); } }
  // the position along the route
  posAt(R, s) { const P = R.P; s = THREE.MathUtils.clamp(s, 0, R.L); let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f, k: lo, e: R.E[Math.min(a.e, R.E.length - 1)] }; }
  frame(dt) {
    const w = this.w, T = this.trip; this.time.value += dt;
    if (!T) { w.controls.update(); this.updateLights3D(null); if (this.ribbonMat) this.ribbonMat.uniforms.uHalf.value = Math.max(2.6, w.camera.position.distanceTo(w.controls.target) / 110); return w.controls.target; }
    const R = T.R, ddt = dt * (T.sim ? this.mult : 1); T.clock += ddt; const here = this.posAt(R, T.s), e = here.e, lim = limitOf(e.cls, e.urban, this.prof), cruise = this.speedOf(e) || 1;
    if (T.manual) this.manualStep(T, dt);
    else if (T.sim) { // simulated driver: road speed, slows for turns, stops at red lights
      let vmax = Math.min(cruise, (lim || 99) * KMH) * 0.97; const m = R.M[T.mi];
      if (m && m.type !== 'straight') { const vt = { arrive: 0, uturn: 3, sharp_left: 4, sharp_right: 4, left: 6, right: 6, slight_left: 10, slight_right: 10 }[m.type] ?? vmax; vmax = Math.min(vmax, Math.sqrt(vt * vt + 2 * 2.2 * Math.max(0, m.s - T.s - 4))); }
      const nl = R.lights.find(l => l.stop > T.s - 0.5); T.redStop = false;
      if (nl && this.prof !== 'walk') { const d = nl.stop - T.s, [st] = this.light(nl); if ((st === 'red' || (st === 'yellow' && d > 12)) && d < 140) { vmax = Math.min(vmax, Math.sqrt(2 * 3 * Math.max(0, d - 0.5))); T.redStop = d < 3; } }
      const a = vmax > T.v ? 2.2 : -3.5; T.v = THREE.MathUtils.clamp(T.v + a * ddt, Math.min(T.v, vmax), Math.max(T.v, vmax)); if (Math.abs(vmax - T.v) < 0.05) T.v = vmax;
      T.s = Math.min(R.L, T.s + T.v * ddt);
    } else if (T.target != null) { const ds = T.target - T.s; T.s += ds * Math.min(1, dt * 1.5); T.v = T.gpsV != null ? T.gpsV : Math.max(0, ds) * 1.5; }
    if (T.v < 0.3 && T.redStop) { if (!T.waiting) { T.waiting = true; T.stops++; } T.waited += ddt; } else T.waiting = false;
    T.driven = T.manual ? (T.driven || 0) + T.v * dt : T.s; T.max = Math.max(T.max, T.v); T.el = (T.el || 0) + ddt;
    while (T.mi < R.M.length - 1 && R.M[T.mi].s < T.s - 3) T.mi++;
    // car
    const p = T.manual ? { x: T.mx, z: T.mz, y: T.my } : this.posAt(R, T.s), q = this.posAt(R, Math.min(R.L, T.s + 4)), b = this.posAt(R, Math.max(0, T.s - 4)), hd = T.manual ? T.mhd : Math.atan2(q.x - b.x, q.z - b.z);
    T.hd = T.hd == null ? hd : T.hd + norm((hd - T.hd) * 180 / Math.PI) * Math.PI / 180 * Math.min(1, dt * 6);
    const gy = Math.max(p.y, w.groundAt(p.x, p.z)); if (this.car) { this.car.position.set(p.x, gy, p.z); this.car.rotation.y = T.hd; this.ring.position.set(p.x, gy + 0.15, p.z); }
    this.time.prog = T.s; if (this.ribbonMat) this.ribbonMat.uniforms.uProg.value = T.s;
    // camera
    if (this.follow) { const v = T.v, m = R.M[T.mi], near = m && m.s - T.s < 120 ? 0.72 : 1, fx = Math.sin(T.hd), fz = Math.cos(T.hd);
      let pos, look;
      if (this.camMode === '3d') { const back = (26 + v * 1.4) * near, hgt = (15 + v * 0.8) * near; pos = new THREE.Vector3(p.x - fx * back, gy + hgt, p.z - fz * back); look = new THREE.Vector3(p.x + fx * 18, gy, p.z + fz * 18); }
      else if (this.camMode === '2d') { const hgt = (110 + v * 4) * near; pos = new THREE.Vector3(p.x, gy + hgt, p.z + 0.01); look = new THREE.Vector3(p.x, gy, p.z); }
      else { const B = this.bounds(R); pos = new THREE.Vector3(B.cx, B.y + B.r * 1.5, B.cz + B.r * 0.8); look = new THREE.Vector3(B.cx, B.y, B.cz); }
      w.camera.position.lerp(pos, 1 - Math.exp(-dt * 3)); w.controls.target.lerp(look, 1 - Math.exp(-dt * 4)); w.camera.lookAt(w.controls.target);
    } else { w.controls.update(); this.idle += dt; if (this.idle > 10) { this.follow = true; this.showRecenter(false); } }
    if (this.ribbonMat) this.ribbonMat.uniforms.uHalf.value = Math.max(1.9, w.camera.position.distanceTo(w.controls.target) / (this.camMode === '3d' ? 24 : 70));
    // lights in 3D, lane band, arrow
    this.updateLights3D(T); if (T.drawnMi !== T.mi) { T.drawnMi = T.mi; this.drawGuide(R, R.M[T.mi]); }
    T.hudT = (T.hudT || 0) + dt; if (T.hudT > 0.2) { T.hudT = 0; this.updateHud(T); this.prompts(T); }
    if (T.s >= R.L - 1 && !T.arrived) this.arrive(T);
    return p;
  }
  arrive(T) { T.arrived = true; T.v = 0; this.announce({ type: 'arrive' }, 0); this.renderArrival(T); }
  bounds(R) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0; for (const p of R.P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y += p.y; } return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.max(80, Math.hypot(x1 - x0, z1 - z0) / 2), y: y / R.P.length }; }
  frameRoute() { const R = this.routes[this.sel]; if (!R) return; const B = this.bounds(R); this.w.flight = { t: 0, p0: this.w.camera.position.clone(), q0: this.w.controls.target.clone(), p1: new THREE.Vector3(B.cx, B.y + B.r * 1.6, B.cz + B.r * 0.9), q1: new THREE.Vector3(B.cx, B.y, B.cz) }; }

  /* ---------------- voice ---------------- */
  dist(m) { if (m < 1000) { const v = m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10; return [v, lang === 'km' ? 'ម៉ែត្រ' : 'm']; } return [(m / 1000).toFixed(m < 10000 ? 1 : 0), lang === 'km' ? 'គ.ម' : 'km']; }
  sentence(m, d, first, km = lang === 'km' && this.kmVoice()) {
    if (!m) return ''; const [v, u] = this.dist(d);
    if (km) { const w = TURN_KM[m.type]; if (m.type === 'arrive') return d < 30 ? 'មកដល់ទិសដៅហើយ' : `ទិសដៅនៅចម្ងាយ ${v} ${u} ទៀត`; return `${first ? 'ចេញដំណើរ។ ' : ''}ក្នុងចម្ងាយ ${v} ${u} ${w}${m.onto ? ' ចូល ' + m.onto : ''}`; }
    const w = TURN_WORD[m.type], onto = m.onto ? (m.type === 'straight' ? ' onto ' : ' onto ') + m.onto : '', U = u === 'm' ? 'metres' : 'kilometres';
    if (m.type === 'arrive') return d < 30 ? 'You have arrived.' : `${first ? 'Head off. ' : ''}The destination is in ${v} ${U}.`;
    return `${first ? 'Head off. ' : ''}${d < 30 ? '' : `In ${v} ${U}, `}${w.toLowerCase()}${onto}.`.replace(/^./, c => c.toUpperCase());
  }
  // Khmer voice: the phone's Khmer voice if it has one, otherwise recorded Khmer prompts (audio/km, Meta MMS-TTS)
  vLang() { return this.voiceLang || (lang === 'km' ? 'km' : 'en'); }
  clips(keys) { if (!this.voice || !keys.length) return; this._cq = keys.slice(); const a = this._au || (this._au = new Audio()); // one element, first played from a tap, so phones keep allowing it
    try { speechSynthesis.cancel(); } catch (e) { } const next = () => { const k = this._cq.shift(); if (!k) return; a.src = 'audio/km/' + k + '.mp3'; a.play().catch(() => { }); }; a.onended = next; a.onerror = next; a.pause(); next(); }
  kmKeys(m, d, first) { const K = []; if (first) K.push('depart'); if (!m) return K;
    if (m.type === 'arrive') { K.push(d < 30 ? 'arrive' : 'arrive_ahead'); return K; }
    if (d < 30) K.push('now'); else { const opts = [50, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 5000]; let b = opts[0]; for (const o of opts) if (Math.abs(o - d) < Math.abs(b - d)) b = o; K.push('d' + b); }
    K.push(m.type in TURN_KM ? m.type : 'straight'); return K; }
  announce(m, d, first) { if (this.vLang() === 'km') { const kv = this.kmVoice(); if (kv) this.speak(this.sentence(m, d, first, true), true); else this.clips(this.kmKeys(m, d, first)); } else this.speak(this.sentence(m, d, first, false), false); }
  event(key, en) { if (this.vLang() === 'km') { if (this.kmVoice()) this.speak({ red: 'ភ្លើងក្រហមនៅខាងមុខ សូមបន្ថយល្បឿន', reroute: 'កំពុងគណនាផ្លូវថ្មី', speeding: 'អ្នកកំពុងបើកលើសល្បឿនកំណត់', green: 'ភ្លើងបៃតងហើយ' }[key] || en, true); else this.clips([key]); } else this.speak(en, false); }
  kmVoice() { try { return speechSynthesis.getVoices().find(v => /^km/i.test(v.lang)); } catch (e) { return null; } }
  speak(s, km) { if (!this.voice || !s || !window.speechSynthesis) return; try { if (this._au) this._au.pause(); const u = new SpeechSynthesisUtterance(s), kv = km && this.kmVoice(); if (kv) { u.voice = kv; u.lang = kv.lang; } else u.lang = 'en-US'; u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { } }
  prompts(T) {
    const R = T.R, m = R.M[T.mi]; if (!m) return; const d = m.s - T.s, v = Math.max(T.v, 5), far = Math.max(350, v * 22), near = Math.max(90, v * 7);
    for (const [k, th] of [['f', far], ['n', near], ['x', 25]]) { const id = T.mi + k; if (d < th && d > (k === 'x' ? 0 : th * 0.55) && !T.said.has(id)) { T.said.add(id); if (k === 'f' && d < near) continue; this.announce(m, d, false); break; } }
    const nl = R.lights.find(l => l.stop > T.s), id = nl && 'L' + nl.s; if (nl && this.prof !== 'walk' && !T.said.has(id) && nl.stop - T.s < 160) { const [st, r] = this.light(nl); if (st === 'red' && r > 5) { T.said.add(id); this.event('red', `Red light ahead, ${Math.round(r)} seconds.`); } }
    if (T.manual && T.overT && performance.now() - (T.spT || 0) > 20000) { T.spT = performance.now(); this.event('speeding', 'You are over the speed limit.'); }
  }

  /* ---------------- 3D ---------------- */
  clear3D(keepCar) { for (const c of [...this.group.children]) { if (keepCar && (c === this.car || c === this.ring)) continue; this.group.remove(c); c.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map && m.map.dispose(); m.dispose(); }); } }); }
    this.ribbonMat = null; this.lights3D = []; this.guide = null; }
  draw() {
    this.clear3D(true); this.drawMarks(); if (!this.routes.length) return;
    this.routes.forEach((R, i) => { if (i !== this.sel && !this.trip) this.group.add(this.ribbon(R, false)); });
    const R = this.routes[this.sel]; this.group.add(this.ribbon(R, true)); this.makeLights(R);
    if (this.trip) this.drawGuide(R, R.M[this.trip.mi]);
  }
  ribbon(R, main) {
    const P = R.P, pos = [], nrm = [], sv = [], idx = [];
    P.forEach((p, k) => { const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      const y = Math.max(p.y, this.w.groundAt(p.x, p.z)) + 0.32; for (const v of [-1, 1]) { pos.push(p.x, y, p.z); nrm.push(-tz / l, tx / l, v); sv.push(p.s); }
      if (k) { const o = 2 * (k - 1); idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('aS', new THREE.Float32BufferAttribute(sv, 1)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      uniforms: { uHalf: { value: 2.6 }, uProg: { value: -1 }, uTime: this.time, uMain: { value: main ? 1 : 0 } },
      vertexShader: `attribute vec3 aN; attribute float aS; uniform float uHalf; varying float vS; varying float vV; void main(){ vS=aS; vV=aN.z; vec3 p=position+vec3(aN.x,0.,aN.y)*aN.z*uHalf; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
      fragmentShader: `uniform float uProg; uniform float uTime; uniform float uMain; varying float vS; varying float vV; void main(){ float a=abs(vV);
        vec3 edge=vec3(0.05,0.45,1.0), core=vec3(0.55,0.83,1.0); vec3 c=mix(core,edge,smoothstep(0.55,0.8,a)); c=mix(c,vec3(1.),smoothstep(0.86,0.9,a)*0.9);
        float ch=fract((vS+a*3.0)/9.0-uTime*0.6); c=mix(c,vec3(1.),step(0.82,ch)*(1.-step(0.62,a))*uMain);
        float al=uMain>0.5?0.95:0.55; if(uMain<0.5) c=vec3(0.55,0.62,0.72);
        if(vS<uProg){ c=vec3(0.45,0.5,0.56); al=0.55; }
        gl_FragColor=vec4(c,al*(1.-smoothstep(0.95,1.0,a))); }` });
    const m = new THREE.Mesh(g, mat); m.renderOrder = main ? 22 : 21; m.frustumCulled = false; if (main) this.ribbonMat = mat; m.userData.route = R; return m;
  }
  pin(x, z, col, txt) { const c = document.createElement('canvas'); c.width = 128; c.height = 160; const g = c.getContext('2d'); g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.moveTo(64, 154); g.bezierCurveTo(30, 100, 10, 80, 10, 58); g.arc(64, 58, 54, Math.PI, 0); g.bezierCurveTo(118, 80, 98, 100, 64, 154); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '700 56px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 60);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, sizeAttenuation: false })); s.center.set(0.5, 0); s.scale.set(0.035, 0.044, 1); s.position.set(x, this.w.groundAt(x, z) + 1, z); s.renderOrder = 40; return s; }
  drawMarks() { for (const c of [...this.group.children]) if (c.userData.mark) { this.group.remove(c); c.material.map.dispose(); c.material.dispose(); }
    for (const [p, col, tx] of [[this.from, '#2fbf71', 'A'], [this.to, '#e5484d', 'B']]) if (p) { const s = this.pin(p.x, p.z, col, tx); s.userData.mark = true; this.group.add(s); } }
  makeCar() {
    const w = this.w, kind = this.prof === 'moto' ? 'moto' : this.prof === 'walk' ? null : 'car', g = new THREE.Group();
    const kit = kind && w.kit && (w.kit[kind] || w.kit.car);
    if (kit) { const paint = new THREE.Mesh(kit.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.6, color: 0xe9edf2 })), fixed = new THREE.Mesh(kit.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
      paint.userData.shared = fixed.userData.shared = true; paint.castShadow = fixed.castShadow = true; g.add(paint, fixed); }
    else { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f7fd0 })); b.position.y = 0.9; g.add(b); }
    const glow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), new THREE.MeshBasicMaterial({ color: 0x23d5ff, transparent: true, opacity: 0.22, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; g.add(glow);
    this.car = g; this.group.add(g);
    // compass ring around the car, fixed to north
    const r = new THREE.Group(), rg = new THREE.RingGeometry(6.2, 6.45, 64), rm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })); rm.rotation.x = -Math.PI / 2; r.add(rm);
    const L = lang === 'km' ? ['ជើង', 'កើត', 'ត្បូង', 'លិច'] : ['N', 'E', 'S', 'W'];
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dz], i) => { const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d'); x.font = '700 40px "Noto Sans Khmer", system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(L[i], 64, 34); x.fillStyle = i ? '#fff' : '#ff4d4f'; x.fillText(L[i], 64, 34);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); s.scale.set(3.6, 1.8, 1); s.position.set(dx * 7.6, 0.6, dz * 7.6); s.renderOrder = 45; r.add(s); });
    this.ring = r; this.group.add(r);
  }
  // recommended lanes (teal band) and a 3D turn arrow before the next manoeuvre
  drawGuide(R, m) {
    if (this.guide) { this.group.remove(this.guide); this.guide.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); this.guide = null; }
    if (!m || m.type === 'arrive' || m.type === 'straight') return; const grp = new THREE.Group(), e = m.ein; if (!e) return;
    const per = e.oneway ? e.lanes : Math.max(1, Math.round(e.lanes / 2)), lw = Math.max(2.6, Math.min(3.6, (e.hw * 2) / Math.max(1, e.lanes)));
    const left = m.type.includes('left') || m.type === 'uturn', right = m.type.includes('right'), j0 = per <= 1 ? 0 : left ? 0 : right ? per - 1 : 0, j1 = per <= 1 ? 0 : left ? 0 : right ? per - 1 : per - 1;
    // band from 110 m before to the junction, centred on the recommended lanes (offset from the route line, which runs in the middle of the carriageway)
    if (this.prof !== 'walk' && per >= 2) { const s0 = Math.max(0, m.s - 110), s1 = m.s - 3, pos = [], idx = []; const mid = (per - 1) / 2, c = ((j0 + j1) / 2 - mid) * lw, half = ((j1 - j0 + 1) * lw) / 2;
      let v = 0; for (let s = s0; s <= s1; s += 3) { const p = this.posAt(R, s), q = this.posAt(R, Math.min(R.L, s + 2)), tx = q.x - p.x, tz = q.z - p.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, y = Math.max(p.y, this.w.groundAt(p.x, p.z)) + 0.22, fade = Math.min(1, (s - s0) / 30);
        pos.push(p.x + nx * (c - half), y, p.z + nz * (c - half), p.x + nx * (c + half), y, p.z + nz * (c + half)); if (v) idx.push(v - 2, v, v - 1, v - 1, v, v + 1); v += 2; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); const b = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1fc9a5, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 })); b.renderOrder = 21; grp.add(b); }
    // floating turn arrow
    { const s0 = Math.max(0, m.s - 16), s1 = Math.min(R.L, m.s + 14), pts = []; for (let s = s0; s <= s1; s += 1.5) { const p = this.posAt(R, s); pts.push(new THREE.Vector3(p.x, Math.max(p.y, this.w.groundAt(p.x, p.z)) + 2.2, p.z)); }
      if (pts.length > 3) { const pos = [], idx = [], W = 1.5; pts.forEach((p, k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1; pos.push(p.x - tz / l * W, p.y, p.z + tx / l * W, p.x + tz / l * W, p.y, p.z - tx / l * W); if (k) { const o = 2 * (k - 1); idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); } });
        const L = pts[pts.length - 1], P2 = pts[pts.length - 3], tx = L.x - P2.x, tz = L.z - P2.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l, ux = tx / l, uz = tz / l, base = pos.length / 3;
        pos.push(L.x + nx * 3.2, L.y, L.z + nz * 3.2, L.x - nx * 3.2, L.y, L.z - nz * 3.2, L.x + ux * 5, L.y, L.z + uz * 5); idx.push(base, base + 1, base + 2);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
        const a1 = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.96 })); a1.renderOrder = 47; grp.add(a1);
        const g2 = g.clone(), P = g2.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) - 0.15); const a2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ color: 0x1677ff, side: THREE.DoubleSide, depthTest: false })); a2.scale.set(1, 1, 1); a2.renderOrder = 46; grp.add(a2); } }
    this.guide = grp; this.group.add(grp);
  }
  // traffic lights: a pole with three lamps and a countdown bubble
  makeLights(R) {
    this.lights3D = []; const pole = new THREE.CylinderGeometry(0.12, 0.15, 6, 8), box = new THREE.BoxGeometry(0.5, 1.5, 0.45), lamp = new THREE.SphereGeometry(0.17, 10, 8); pole.userData = box.userData = lamp.userData = {};
    for (const l of R.lights) { const p = this.posAt(R, l.stop), q = this.posAt(R, Math.min(R.L, l.stop + 2)), tx = q.x - p.x, tz = q.z - p.z, ln = Math.hypot(tx, tz) || 1, e = p.e, side = (e.oneway ? e.hw : e.hw * 0.5) + 1.4;
      const x = p.x - tz / ln * side, z = p.z + tx / ln * side, y = this.w.groundAt(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(-tx, -tz);
      const pm = new THREE.Mesh(pole, new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6, roughness: 0.4 })); pm.position.y = 3; g.add(pm);
      const bm = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 })); bm.position.y = 5.6; g.add(bm);
      const lamps = ['#ff3b30', '#ffcc00', '#34c759'].map((c, i) => { const m = new THREE.Mesh(lamp, new THREE.MeshBasicMaterial({ color: 0x222222 })); m.position.set(0, 6.1 - i * 0.5, -0.24); m.userData.on = new THREE.Color(c); g.add(m); return m; });
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 112; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false })); sp.center.set(0.15, 0); sp.scale.set(0.075, 0.033, 1); sp.position.y = 7; sp.renderOrder = 48; g.add(sp);
      this.group.add(g); this.lights3D.push({ l, g, lamps, sp, cv, tex, last: '' }); }
  }
  updateLights3D(T) {
    const s = T ? T.s : -1, now = this.now(); let shown = 0;
    for (const L of this.lights3D || []) { const [st, r] = this.light(L.l, now), passed = L.l.stop < s - 5, ahead = !passed && L.l.s - s < 1500;
      L.lamps.forEach((m, i) => m.material.color.copy(i === ['red', 'yellow', 'green'].indexOf(st) ? m.userData.on : new THREE.Color(0x222222)));
      const show = T && ahead && shown < 3; L.sp.visible = !!show; if (!show) continue; shown++;
      const txt = st + Math.ceil(r) + L.l.turn; if (txt === L.last) continue; L.last = txt;
      const g = L.cv.getContext('2d'), col = st === 'red' ? '#ff3b30' : st === 'yellow' ? '#ffcc00' : '#34c759'; g.clearRect(0, 0, 256, 112);
      g.fillStyle = 'rgba(16,20,28,.88)'; g.beginPath(); g.roundRect(4, 4, 248, 92, 46); g.fill(); g.strokeStyle = col; g.lineWidth = 5; g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(50, 50, 36, 0, 7); g.fill(); const ic = new Path2D(ICON[L.l.turn === 'arrive' ? 'straight' : L.l.turn] || ICON.straight); g.save(); g.translate(26, 26); g.scale(2, 2); g.fillStyle = '#fff'; g.fill(ic); g.restore();
      g.fillStyle = col; g.font = '700 58px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Math.ceil(r)), 168, 52);
      g.fillStyle = 'rgba(16,20,28,.88)'; g.beginPath(); g.moveTo(30, 92); g.lineTo(42, 110); g.lineTo(56, 92); g.fill(); L.tex.needsUpdate = true; }
  }

  /* ---------------- HTML: planning panel, HUD ---------------- */
  el(id) { return document.getElementById(id); }
  fmtT(sec) { const m = Math.max(1, Math.round(sec / 60)); if (m < 60) return `${m} ${t('min')}`; return `${Math.floor(m / 60)} ${t('h')} ${m % 60} ${t('min')}`; }
  fmtD(m) { const [v, u] = this.dist(m); return `${v} ${u}`; }
  say(s) { this.msg = t(s); this.renderPanel(); }
  toast(s) { const h = this.el('nvToast'); if (!h) return; h.textContent = t(s); h.hidden = false; clearTimeout(this._toast); this._toast = setTimeout(() => h.hidden = true, 4500); }
  renderPanel() {
    const P = this.el('navContent'); if (!P) return; const R = this.routes, F = this.w.F;
    const pt = (p, what, ph) => `<div class="nvpt"><span class="nvdot ${what}"></span><div class="nvptx">${p ? `<b>${esc(p.label)}</b>` : `<i>${t(ph)}</i>`}</div><button data-np="${what}" class="${this.pickWhat === what ? 'on' : ''}" title="${t('Tap the map')}">📍</button>${what === 'from' ? `<button id="nvGps" title="${t('Use my GPS position')}">🛰️</button>` : ''}</div>`;
    let h = `<div class="seg nvprof">${[['car', '🚗', 'Car'], ['moto', '🏍️', 'Motorbike'], ['walk', '🚶', 'Walk']].map(([k, i, l]) => `<button data-prof="${k}" class="${this.prof === k ? 'on' : ''}">${i} ${t(l)}</button>`).join('')}</div>
      ${pt(this.from, 'from', 'Start: tap 📍 then the map, or 🛰️ GPS')}<div class="nvswap"><button id="nvSwap" title="${t('Swap')}">⇅</button></div>${pt(this.to, 'to', 'Destination: tap the map or search')}
      <div class="row"><input id="nvFind" placeholder="🔎 ${t('Search a place, pagoda, school, market, owner…')}" style="flex:1" autocomplete="off"></div><div id="nvFound" class="nvfound"></div>`;
    if (!this.to && this.recent.length) h += `<div class="svhelp">${t('Recent')}</div><div class="nvfound">${this.recent.map((r, i) => `<div data-rec="${i}">🕘 ${esc(r.label)}</div>`).join('')}</div>`;
    if (this.msg) h += `<div class="svhelp">⚠️ ${esc(this.msg)}</div>`;
    if (R.length) { h += `<div class="nvroutes">${R.map((r, i) => `<div class="nvroute ${i === this.sel ? 'on' : ''}" data-rt="${i}"><div class="nvrk">${t(r.kind)}${i && R[0] ? ` <span class="${r.T > R[0].T ? 'slow' : 'fast'}">${r.T > R[0].T ? '+' + this.fmtT(r.T - R[0].T) : ''}</span>` : ''}</div><div class="nvrt">${this.fmtT(r.T)}</div><div class="nvrd">${this.fmtD(r.L)} · 🚦 ${r.lights.length}</div><div class="nvvia">${t('via')} ${r.via.map(esc).join(', ')}</div></div>`).join('')}</div>`;
      const r = R[this.sel]; h += `<div class="nvsteps">${r.M.map((m, i) => `<div data-step="${i}">${svg(m.type, 20)}<span>${esc(lang === 'km' ? TURN_KM[m.type] : t(TURN_WORD[m.type]))}${m.onto && m.type !== 'arrive' ? ' → ' + esc(m.onto) : ''}</span><em>${this.fmtD(m.s)}</em></div>`).join('')}</div>`;
      h += `<div class="row"><button id="nvGo" class="primary" style="margin:0">▶ ${t('Start (GPS)')}</button><button id="nvSim" class="primary" style="margin:0;background:#1f9d6c">🎬 ${t('Simulate drive')}</button></div><div class="row"><button id="nvMan" class="primary" style="margin:0;background:#8a4fd0">🎮 ${t('Virtual GPS: drive it yourself')}</button></div><div class="row"><span>🔊 ${t('Voice language')}</span><select id="nvVL"><option value="km" ${this.vLang() === 'km' ? 'selected' : ''}>ខ្មែរ</option><option value="en" ${this.vLang() === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="row"><label><input type="checkbox" id="nvVoice" ${this.voice ? 'checked' : ''}> 🔊 ${t('Voice')}</label><label><input type="checkbox" id="nvTracks" ${this.avoidTracks ? 'checked' : ''}> ${t('Avoid dirt tracks')}</label><button id="nvGpx">📤 GPX</button></div>
        <div class="svhelp">${this.signals && this.signals.length ? '🚦 ' + t('Traffic lights from OpenStreetMap.') : '🚦 ' + t('Traffic lights estimated at big junctions (none mapped in OpenStreetMap here).')} ${t('Light timings and countdowns are simulated – Cambodia has no live signal feed.')}${this.osmOk === false ? ' ' + t('Street names could not be loaded (OpenStreetMap busy).') : ''}</div>`; }
    else h += `<div class="svhelp">${t('Set a start and a destination. Routes use the roads of this 3D area (one-way streets respected).')}</div>`;
    P.innerHTML = h;
    P.querySelectorAll('[data-prof]').forEach(b => b.onclick = () => { this.prof = b.dataset.prof; if (this.from && this.to) this.plan(); else this.renderPanel(); });
    P.querySelectorAll('[data-np]').forEach(b => b.onclick = () => { this.pickWhat = b.dataset.np; this.renderPanel(); });
    this.el('nvGps').onclick = () => this.gpsHere();
    this.el('nvSwap').onclick = () => { [this.from, this.to] = [this.to, this.from]; if (this.from && this.to) this.plan(); else { this.drawMarks(); this.renderPanel(); } };
    const find = this.el('nvFind'); find.oninput = () => this.search2(find.value); if (this._q) { find.value = this._q; this.search2(this._q); }
    P.querySelectorAll('[data-rec]').forEach(d => d.onclick = () => { const r = this.recent[+d.dataset.rec]; this.setPoint('to', F.x(r.lon), F.z(r.lat), r.label); });
    P.querySelectorAll('[data-rt]').forEach(d => d.onclick = () => { this.sel = +d.dataset.rt; this.renderPanel(); this.draw(); });
    P.querySelectorAll('[data-step]').forEach(d => d.onclick = () => { const r = R[this.sel], m = r.M[+d.dataset.step], p = this.posAt(r, m.s); this.w.teleport(p.x, p.z, 'orbit'); });
    if (R.length) { this.el('nvGo').onclick = () => this.start(false); this.el('nvSim').onclick = () => this.start(true); this.el('nvMan').onclick = () => this.start('manual'); this.el('nvVL').onchange = e => { this.voiceLang = e.target.value; this.clips([]); if (this.voice) this.announce(this.routes[this.sel].M[0], this.routes[this.sel].M[0].s, true); }; this.el('nvVoice').onchange = e => { this.voice = e.target.checked; };
      this.el('nvTracks').onchange = e => { this.avoidTracks = e.target.checked; this.plan(); }; this.el('nvGpx').onclick = () => this.gpx(); }
    this.msg = '';
  }
  gpsHere() { if (!navigator.geolocation) { this.say('GPS is not available on this device.'); return; } this.say('Finding your position…');
    navigator.geolocation.getCurrentPosition(p => { const F = this.w.F, D = this.w.D, x = F.x(p.coords.longitude), z = F.z(p.coords.latitude);
      if (x < D.X0 || x > D.X0 + D.W || z < D.Z0 || z > D.Z0 + D.H) { this.say('Your GPS position is outside this 3D area. Tap the map to set a start instead.'); return; }
      this.setPoint('from', x, z, t('My position')); }, e => this.say(t('GPS: ') + e.message), { enableHighAccuracy: true, timeout: 15000 }); }
  async search2(q) { this._q = q; const box = this.el('nvFound'); if (!box) return; q = q.trim().toLowerCase(); if (q.length < 1) { box.innerHTML = ''; return; }
    const list = (this.o.places ? await this.o.places() : []).filter(p => (p.name + ' ' + (p.alt || '')).toLowerCase().includes(q)).slice(0, 12);
    box.innerHTML = list.length ? list.map((p, i) => `<div data-pl="${i}">${p.icon || '📍'} ${esc(p.name)}${p.alt ? ` <em>${esc(p.alt)}</em>` : ''}</div>`).join('') : `<div class="svhelp">${t('Nothing found in this area.')}</div>`;
    box.querySelectorAll('[data-pl]').forEach(d => d.onclick = () => { const p = list[+d.dataset.pl]; this._q = ''; this.setPoint('to', p.x, p.z, p.name); }); }
  gpx() { const R = this.routes[this.sel]; if (!R) return; const F = this.w.F; const pts = R.P.filter((p, k) => k % 2 === 0 || k === R.P.length - 1).map(p => `<rtept lat="${F.lat(p.z).toFixed(7)}" lon="${F.lon(p.x).toFixed(7)}"><ele>${p.y.toFixed(1)}</ele></rtept>`).join('');
    const x = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Cambodia 3D Landscape – Geoinformatics and Research Lab, RUPP" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>${esc((this.from && this.from.label) + ' → ' + (this.to && this.to.label))}</name>${pts}</rte></gpx>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'application/gpx+xml' })); a.download = 'route_' + new Date().toISOString().slice(0, 10) + '.gpx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  renderHud() {
    this.removeHud(); const d = document.createElement('div'); d.id = 'navHud'; d.className = 'navhud';
    d.innerHTML = `<div class="nvTop"><div class="nvMan"><div id="nvIcon"></div><div><div class="nvDist" id="nvDist"></div><div class="nvRoad" id="nvRoad"></div></div></div><div class="nvLanes" id="nvLanes"></div><div class="nvThen" id="nvThen" hidden></div></div>
      <div class="nvSpeed"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg" id="nvRing"/></svg><b id="nvV">0</b><small>km/h</small><span class="nvLimit" id="nvLim"></span></div>
      <div class="nvSig" id="nvSig" hidden></div>
      <div class="nvSide"><button id="nvMode" title="${t('Camera: 3D follow / 2D north-up / whole route')}">🧭<br><small id="nvModeL"></small></button><button id="nvVoiceB">${this.voice ? '🔊' : '🔇'}</button>${this.trip.sim ? `<button id="nvMult">×${this.mult}</button><button id="nvPause">⏸</button>` : ''}</div>
      ${this.trip.manual ? `<div class="nvPedals"><button data-p="left" title="${t('Turn left at the next junction')}">◀</button><button data-p="gas" class="gas">▲<small>${t('Go')}</small></button><button data-p="brake" class="brake">▼<small>${t('Brake')}</small></button><button data-p="right" title="${t('Turn right at the next junction')}">▶</button></div><div class="nvIntent" id="nvIntent" hidden></div>` : ''}<button class="nvRecenter" id="nvRecenter" hidden>⌖ ${t('Re-centre')}</button><div class="nvToast" id="nvToast" hidden></div>
      <div class="nvBottom"><div class="nvProg"><i id="nvProg"></i></div><div class="nvBRow"><div><b id="nvRem"></b><div id="nvEta"></div></div><button id="nvExit">✕<br><small>${t('Exit')}</small></button></div></div>`;
    document.body.appendChild(d); document.body.classList.add('nav-on');
    const modes = ['3d', '2d', 'all'], ML = { '3d': '3D', '2d': '2D', all: t('Route') };
    this.el('nvModeL').textContent = ML[this.camMode];
    this.el('nvMode').onclick = () => { this.camMode = modes[(modes.indexOf(this.camMode) + 1) % 3]; this.el('nvModeL').textContent = ML[this.camMode]; this.follow = true; this.showRecenter(false); };
    this.el('nvVoiceB').onclick = e => { this.voice = !this.voice; e.target.textContent = this.voice ? '🔊' : '🔇'; if (!this.voice) try { speechSynthesis.cancel(); } catch (e2) { } };
    if (this.trip.sim) { this.el('nvMult').onclick = e => { this.mult = this.mult >= 8 ? 1 : this.mult * 2; e.target.textContent = '×' + this.mult; }; this.el('nvPause').onclick = e => { this._m = this._m || this.mult; if (this.mult) { this._m = this.mult; this.mult = 0; e.target.textContent = '▶'; } else { this.mult = this._m || 1; e.target.textContent = '⏸'; } }; }
    this.el('nvRecenter').onclick = () => { this.follow = true; this.showRecenter(false); };
    this.el('nvExit').onclick = () => this.stop();
    d.querySelectorAll('[data-p]').forEach(b => { const k = b.dataset.p; const on = e => { e.preventDefault(); if (k === 'left' || k === 'right') { this.trip.intent = this.trip.intent === k ? null : k; this.showIntent(); } else this.pedal[k] = 1; }, off = () => { if (this.pedal) this.pedal[k] = 0; };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
    if (!this._keys) { this._keys = e => { const T = this.trip; if (!T || !T.manual || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const dn = e.type === 'keydown', k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { this.pedal.gas = dn; e.preventDefault(); } else if (k === 'ArrowDown' || k === 's' || k === 'S') { this.pedal.brake = dn; e.preventDefault(); }
      else if (dn && (k === 'ArrowLeft' || k === 'a' || k === 'A')) { T.intent = 'left'; this.showIntent(); } else if (dn && (k === 'ArrowRight' || k === 'd' || k === 'D')) { T.intent = 'right'; this.showIntent(); } };
      addEventListener('keydown', this._keys); addEventListener('keyup', this._keys); }
  }
  removeHud() { const d = this.el('navHud'); if (d) d.remove(); document.body.classList.remove('nav-on'); }
  showRecenter(on) { const b = this.el('nvRecenter'); if (b) b.hidden = !on; }
  lanesHtml(m) { const e = m.ein; if (!e || this.prof === 'walk' || m.type === 'arrive') return ''; const per = e.oneway ? e.lanes : Math.max(1, Math.round(e.lanes / 2)), o = m.opts, want = m.type.includes('left') || m.type === 'uturn' ? 'left' : m.type.includes('right') ? 'right' : 'straight';
    const arrows = []; for (let j = 0; j < per; j++) { const a = []; if (per === 1) { a.push(...['left', 'straight', 'right'].filter(k => o.has(k) || k === want)); } else { if (j === 0 && (o.has('left') || want === 'left')) a.push('left'); if ((j > 0 && j < per - 1) || ((j === 0 || j === per - 1) && o.has('straight')) || want === 'straight' && j > 0 && j < per - 1) a.push('straight'); if (j === per - 1 && (o.has('right') || want === 'right')) a.push('right'); if (!a.length) a.push('straight'); }
      arrows.push(`<span class="${a.includes(want) ? 'on' : ''}">${a.map(k => svg(k === 'left' ? 'left' : k === 'right' ? 'right' : 'straight', 26, a.includes(want) && k === want ? '#fff' : 'rgba(255,255,255,.45)')).join('')}</span>`); }
    return arrows.join('<i></i>'); }
  updateHud(T) {
    const R = T.R, m = R.M[T.mi], d = Math.max(0, m.s - T.s), [v, u] = this.dist(d); if (!this.el('navHud')) return;
    this.el('nvIcon').innerHTML = svg(m.type, 54); this.el('nvDist').innerHTML = `${v}<small>${u}</small>`;
    this.el('nvRoad').textContent = m.type === 'arrive' ? (this.to ? this.to.label : '') : `${lang === 'km' ? TURN_KM[m.type] : t(TURN_WORD[m.type])}${m.onto ? ' · ' + m.onto : ''}`;
    this.el('nvLanes').innerHTML = d < 400 ? this.lanesHtml(m) : ''; const nx = R.M[T.mi + 1]; const th = this.el('nvThen'); th.hidden = !(nx && nx.s - m.s < 120 && d < 300); if (!th.hidden) th.innerHTML = `${t('then')} ${svg(nx.type, 22)}`;
    const here = this.posAt(R, T.s), lim = limitOf(here.e.cls, here.e.urban, this.prof), kmh = Math.round(T.v * 3.6), over = lim && kmh > lim + 2;
    this.el('nvV').textContent = kmh; this.el('nvLim').textContent = lim || ''; this.el('nvLim').hidden = !lim; const ring = this.el('nvRing'); ring.style.strokeDasharray = `${Math.min(1, kmh / Math.max(lim || 60, 40) / 1.25) * 276} 276`; ring.classList.toggle('over', !!over);
    // next light: countdown, what you will meet at this speed, and a speed for green
    const nl = R.lights.find(l => l.stop > T.s), sg = this.el('nvSig');
    if (nl && nl.s - T.s < 800 && this.prof !== 'walk') { const [st, r] = this.light(nl), dd = Math.max(0, nl.stop - T.s), vv = Math.max(T.v, 1), [atSt] = this.light(nl, this.now() + dd / vv);
      let tip = ''; if (T.v > 2 && atSt === 'red' && dd > 40) { const L2 = lim || 40; for (let kv = L2; kv >= 15; kv -= 1) { const [s2] = this.light(nl, this.now() + dd / (kv * KMH)); if (s2 === 'green') { tip = `🟢 ${t('Drive about')} ${kv} km/h ${t('to arrive on green')}`; break; } } }
      else if (T.v > 2 && dd > 30) tip = atSt === 'green' ? `🟢 ${t('You will arrive on green')}` : `🔴 ${t('It will be red when you arrive')}`;
      sg.hidden = false; sg.className = 'nvSig ' + st; sg.innerHTML = `<div class="nvSigB"><span class="nvSigI">${svg(nl.turn === 'arrive' ? 'straight' : nl.turn, 30)}</span><b>${Math.ceil(r)}</b></div><div class="nvSigT">🚦 ${this.fmtD(dd)}${nl.osm ? '' : ' · ' + t('estimated')}${tip ? '<br>' + tip : ''}</div>`; }
    else sg.hidden = true;
    const left = R.L - T.s, tl = left / Math.max(this.speedOf(here.e) * 0.8, 1) + R.lights.filter(l => l.stop > T.s).reduce((s, l) => s + (l.C - l.G) ** 2 / (2 * l.C), 0), eta = new Date(Date.now() + tl * 1000 / (T.sim && this.mult ? this.mult : 1));
    this.el('nvRem').textContent = `${this.fmtD(left)} · ${this.fmtT(tl)} · 🚦 ${R.lights.filter(l => l.stop > T.s).length}`; this.el('nvEta').textContent = `${t('Arrive')} ${eta.toTimeString().slice(0, 5)}${T.outside ? ' · ⚠️ ' + t('outside the 3D area') : ''}`;
    this.el('nvProg').style.width = (100 * T.s / R.L).toFixed(1) + '%';
  }
  renderArrival(T) { const d = this.el('navHud'); if (!d) return; const c = document.createElement('div'); c.className = 'nvArrive';
    const avg = T.el > 0 ? T.driven / T.el * 3.6 : 0;
    c.innerHTML = `<div class="nvArrH">🏁 ${t('You have arrived')}</div><div>${esc(this.to ? this.to.label : '')}</div><div class="nvArrG"><div><b>${this.fmtD(T.driven)}</b><small>${t('distance')}</small></div><div><b>${this.fmtT(T.el)}</b><small>${t('time')}</small></div><div><b>${avg.toFixed(0)} km/h</b><small>${t('average')}</small></div><div><b>${T.stops}</b><small>${t('red-light stops')}</small></div><div><b>${Math.round(T.waited)} s</b><small>${t('waiting at lights')}</small></div><div><b>${Math.round(T.max * 3.6)} km/h</b><small>${t('top speed')}</small></div></div><div class="row"><button id="nvAgain" class="primary" style="margin:0">↻ ${t('Again')}</button><button id="nvBack">✕ ${t('Close')}</button></div>`;
    d.appendChild(c); this.el('nvAgain').onclick = () => this.start(T.sim); this.el('nvBack').onclick = () => this.stop(); }
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
