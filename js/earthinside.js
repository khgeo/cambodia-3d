// Inside the Earth: a cutaway of the globe with the crust, mantle and core at their true depths (PREM), animated
// mantle convection and a swirling liquid outer core; a depth profile (temperature, pressure, density) for a journey
// down from Cambodia; and a seismic-wave simulation that shows why we know the outer core is liquid (shadow zones).
import * as THREE from 'three';

const RE = 6371;
// layers: name, Khmer, top and bottom depth (km), state, colour, note
export const LAYERS = [
  ['Crust', 'សំបកផែនដី', 0, 35, 'solid rock', '#9a8268', 'Continental crust is 30–70 km thick (about 35 km under Cambodia), ocean crust only 5–10 km. All rocks, soils and landforms we study sit on this thin skin.'],
  ['Lithospheric mantle', 'មែនថលលីតូស្វ៊ែ', 35, 100, 'solid, rigid', '#7a5d47', 'Together with the crust it forms the lithosphere, broken into tectonic plates that move a few cm per year.'],
  ['Asthenosphere (upper mantle)', 'អាស្តេណូស្វ៊ែ (មែនថលខាងលើ)', 100, 410, 'solid but soft, slowly flowing', '#b4532f', 'Hot rock that is soft enough to flow very slowly, so the plates can slide on it. Most magma comes from here.'],
  ['Transition zone', 'តំបន់អន្តរកាល', 410, 660, 'solid, denser minerals', '#c8452a', 'Pressure squeezes olivine into denser minerals; the zone may hold more water than all the oceans, locked in rock.'],
  ['Lower mantle', 'មែនថលខាងក្រោម', 660, 2891, 'solid, flows over millions of years', '#d9561f', 'The largest layer: 84% of Earth’s volume. Hot rock rises and cold slabs sink (convection), driving plate tectonics.'],
  ['Outer core', 'ស្នូលខាងក្រៅ', 2891, 5150, 'liquid iron and nickel', '#ff9a1f', 'Liquid metal swirling as the Earth turns. Its motion makes Earth’s magnetic field, which shields us from the solar wind.'],
  ['Inner core', 'ស្នូលខាងក្នុង', 5150, 6371, 'solid iron and nickel', '#fff0a0', 'As hot as the surface of the Sun (≈5,400 °C), but solid because the pressure is 3.6 million times the air pressure at the surface.'],
];
// depth (km) → temperature °C, pressure GPa, density g/cm³ (PREM and textbook estimates, rounded)
const PRO = [[0, 15, 0, 2.7], [35, 500, 1, 2.9], [35.1, 500, 1, 3.3], [100, 1300, 3.3, 3.4], [410, 1500, 13.7, 3.54], [410.1, 1500, 13.7, 3.72], [660, 1700, 23.8, 3.99], [660.1, 1700, 23.8, 4.38],
  [2891, 3800, 135.8, 5.57], [2891.1, 3800, 135.8, 9.9], [5150, 5300, 328.9, 12.17], [5150.1, 5300, 328.9, 12.76], [6371, 5450, 363.9, 13.09]];
export function profile(d) { d = Math.max(0, Math.min(RE, d)); let i = 1; while (i < PRO.length - 1 && PRO[i][0] < d) i++; const a = PRO[i - 1], b = PRO[i], f = (d - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return { depth: d, T: a[1] + (b[1] - a[1]) * f, P: a[2] + (b[2] - a[2]) * f, rho: a[3] + (b[3] - a[3]) * f, layer: LAYERS.find(l => d >= l[2] && d <= l[3]) || LAYERS[6] }; }

import { Interior, INTERIORS } from './interior.js?v=110';
// the Earth's cutaway on the globe, opened at Cambodia, with a marker for the journey down
export class Inside {
  constructor(globe) {
    const la = 12.5 * Math.PI / 180, lo = 105 * Math.PI / 180; // Cambodia sits on the edge of the cut (same frame as the globe's xyz())
    const e1 = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)), e2 = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), e3 = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
    this.E = [e1, e2, e3]; this.I = new Interior(INTERIORS.Earth, { E: this.E, parent: globe.scene }); this.group = this.I.group;
    const top = this.I.layers[this.I.layers.length - 1].g;
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 8), new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthTest: false })); this.marker.renderOrder = 5; this.marker.visible = false; top.add(this.marker);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), e1.clone()]); this.axis = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.6, depthTest: false })); this.axis.computeLineDistances(); this.axis.renderOrder = 4; top.add(this.axis);
  }
  get speed() { return this.I.speed; } set speed(v) { this.I.speed = v; }
  setOn(on) { this.I.setOn(on); }
  setSplit(s) { this.I.setSplit(s); this.axis.visible = s < 0.01; }
  setDepth(d) { this.depth = d; this.marker.visible = d != null; if (d != null) this.marker.position.copy(this.E[0]).multiplyScalar(1 - d / RE); }
  view() { return this.E[0].clone().add(this.E[1]).add(this.E[2]).normalize().multiplyScalar(0.6).add(this.E[0].clone().multiplyScalar(0.4)).normalize(); }
  frame(cam, el, names) {
    if (!this.group.visible) return; const now = performance.now(), dt = Math.min(0.1, (now - (this.tl || now)) / 1000); this.tl = now; this.I.anim(dt);
    const rc = el.getBoundingClientRect(), v = new THREE.Vector3(), P = p => { v.copy(p).project(cam); return [(v.x + 1) / 2 * rc.width + rc.left, (1 - v.y) / 2 * rc.height + rc.top, v.z]; };
    const [cx, cy, cz] = P(this.E[0].clone().multiplyScalar(1.01)); let h = cz < 1 ? `<span class="kh" style="left:${cx.toFixed(0)}px;top:${(cy - 18).toFixed(0)}px">📍 ${names('Cambodia', 'កម្ពុជា')}</span>` : '';
    if (this.marker.visible) { const [x, y] = P(this.marker.position); h += `<span class="dp" style="left:${(x + 10).toFixed(0)}px;top:${y.toFixed(0)}px">⬇ ${Math.round(this.depth).toLocaleString()} km</span>`; }
    this.I.labels(cam, el, names, h);
  }
}

/* ---------------- seismic waves: P and S rays through a layered Earth (2D cross-section, simplified PREM) ---------------- */
// velocity (km/s) by depth; S is 0 in the liquid outer core
const VP = [[0, 6.5], [35, 6.5], [35.1, 8.0], [410, 8.9], [410.1, 9.1], [660, 10.2], [660.1, 10.8], [2891, 13.7], [2891.1, 8.0], [5150, 10.3], [5150.1, 11.0], [6371, 11.3]];
const VS = [[0, 3.7], [35, 3.7], [35.1, 4.5], [410, 4.8], [410.1, 5.0], [660, 5.6], [660.1, 6.0], [2891, 7.3], [2891.1, 0], [5150, 0], [5150.1, 3.5], [6371, 3.7]];
const vAt = (T, d) => { let i = 1; while (i < T.length - 1 && T[i][0] < d) i++; const a = T[i - 1], b = T[i], f = (d - a[0]) / Math.max(1e-9, b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; };
const BND = [35, 410, 660, 2891, 5150];
// trace one ray from the surface at take-off angle i0 (from straight down); returns [x, y, t] points (km, s)
function trace(T, i0) { let x = 0, y = RE - 0.5, dx = Math.sin(i0), dy = -Math.cos(i0), t = 0; const out = [[x, y, 0]], ds = 12;
  for (let n = 0; n < 4000; n++) { const r = Math.hypot(x, y), d = RE - r, v = vAt(T, d); if (v <= 0) break;
    let nx = x + dx * ds, ny = y + dy * ds, r2 = Math.hypot(nx, ny), d2 = RE - r2;
    if (r2 >= RE) { const k = (RE - r) / Math.max(1e-6, r2 - r); out.push([x + dx * ds * k, y + dy * ds * k, t + ds * k / v]); break; }
    const b = BND.find(z => (d - z) * (d2 - z) < 0);
    if (b) { const ux = nx / r2, uy = ny / r2, eps = 0.2, v1 = vAt(T, d2 > d ? b - eps : b + eps), v2 = vAt(T, d2 > d ? b + eps : b - eps); t += ds / v; x = nx; y = ny;
      if (v2 <= 0) { out.push([x, y, t]); break; } // S waves cannot enter the liquid outer core
      const c = dx * ux + dy * uy, s1 = Math.sqrt(Math.max(0, 1 - c * c)), s2 = s1 * v2 / v1;
      if (s2 >= 1) { dx -= 2 * c * ux; dy -= 2 * c * uy; } // total reflection
      else { const tx = dx - c * ux, ty = dy - c * uy, tl = Math.hypot(tx, ty) || 1, sg = Math.sign(c) || 1, c2 = Math.sqrt(1 - s2 * s2); dx = sg * c2 * ux + s2 * tx / tl; dy = sg * c2 * uy + s2 * ty / tl; }
      out.push([x, y, t]); continue; }
    // bend with the velocity gradient: the ray turns towards slower rock (rays curve back up to the surface)
    const vn = vAt(T, d2); t += ds / ((v + vn) / 2); x = nx; y = ny;
    if (!BND.some(z => Math.abs(d2 - z) < 2)) { const dvdr = -(vAt(T, d2 + 1) - vAt(T, d2 - 1)) / 2, ux = x / r2, uy = y / r2, c = dx * ux + dy * uy, k = ds / vn * dvdr;
      dx -= k * (ux - c * dx); dy -= k * (uy - c * dy); const L = Math.hypot(dx, dy); dx /= L; dy /= L; }
    if (n % 3 === 0) out.push([x, y, t]); }
  return out; }
let RAYS = null;
export function seismic() { if (!RAYS) { RAYS = { P: [], S: [] }; for (let k = 1; k <= 150; k++) { const a = Math.pow(k / 151, 1.4) * Math.PI / 2 * 0.995; RAYS.P.push(trace(VP, a)); RAYS.S.push(trace(VS, a)); }
    const arr = L => L.map(r => r[r.length - 1]).filter(e => Math.abs(Math.hypot(e[0], e[1]) - RE) < 1).map(e => Math.atan2(e[0], e[1]) * 180 / Math.PI).sort((a, b) => a - b);
    const P = arr(RAYS.P), S = arr(RAYS.S); let gap = [0, 0]; for (let i = 1; i < P.length; i++) if (P[i - 1] > 60 && P[i] - P[i - 1] > gap[1] - gap[0]) gap = [P[i - 1], P[i]];
    RAYS.pShadow = gap.map(Math.round); RAYS.sShadow = Math.round(S[S.length - 1]); } return RAYS; }
// draw the cross-section with the rays up to time t (s); returns nothing
export function drawSeismic(cv, t, L) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2 + 6, s = (Math.min(W, H) / 2 - 22) / RE, Rr = seismic();
  g.clearRect(0, 0, W, H); const ring = (d, fill) => { g.beginPath(); g.arc(cx, cy, (RE - d) * s, 0, 7); g.fillStyle = fill; g.fill(); };
  ring(0, '#5a3a26'); ring(660, '#7a3518'); ring(2891, '#c0651a'); ring(5150, '#f3d77a');
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (const d of [660, 2891, 5150]) { g.beginPath(); g.arc(cx, cy, (RE - d) * s, 0, 7); g.stroke(); }
  // shadow zones on the surface (angles from the quake at the top)
  const arc = (a0, a1, col, r) => { g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 + a0 * Math.PI / 180, -Math.PI / 2 + a1 * Math.PI / 180); g.strokeStyle = col; g.lineWidth = 5; g.stroke(); g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 - a1 * Math.PI / 180, -Math.PI / 2 - a0 * Math.PI / 180); g.stroke(); };
  const done = t > 1250; if (t > 900) { arc(Rr.sShadow, 180, 'rgba(255,80,80,.85)', RE * s + 6); } if (done) arc(Rr.pShadow[0], Rr.pShadow[1], 'rgba(80,170,255,.9)', RE * s + 12);
  g.lineWidth = 1.2;
  for (const [key, col] of [['S', '255,90,90'], ['P', '90,180,255']]) for (const ray of Rr[key]) for (const sg of [1, -1]) {
    g.beginPath(); let last = null; for (const [x, y, tt] of ray) { if (tt > t) break; const px = cx + sg * x * s, py = cy - y * s; last ? g.lineTo(px, py) : g.moveTo(px, py); last = [px, py]; }
    g.strokeStyle = `rgba(${col},.35)`; g.stroke(); if (last && ray[ray.length - 1][2] > t) { g.fillStyle = `rgb(${col})`; g.fillRect(last[0] - 1.5, last[1] - 1.5, 3, 3); } }
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(W / 26)}px system-ui`; g.textAlign = 'center'; g.fillText('💥', cx, cy - RE * s + 2);
  g.font = `${Math.round(W / 30)}px system-ui,"Noto Sans Khmer"`; g.textAlign = 'left'; g.fillStyle = '#9fd0ff'; g.fillText(L.p, 6, H - 22); g.fillStyle = '#ff9a9a'; g.fillText(L.s, 6, H - 7);
  g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(`${Math.floor(t / 60)} ${L.min}`, W - 6, 14);
  if (t > 900) { g.fillStyle = '#ff9a9a'; g.textAlign = 'center'; g.fillText(L.sh, cx, cy + RE * s + 18 > H ? H - 38 : cy + RE * s - 30); }
  if (done) { g.fillStyle = '#9fd0ff'; g.textAlign = 'right'; g.fillText(L.ph, W - 6, H - 7); }
}
