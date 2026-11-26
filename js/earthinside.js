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

const R = LAYERS.map(l => 1 - l[3] / RE); // radius (Earth = 1) at the bottom of each layer
const FS = `uniform float t; varying vec2 vL;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
void main(){ float r = length(vL), ph = atan(vL.y, vL.x); vec3 c;
  if (r > 1.0) discard;
  if (r < ${R[5].toFixed(4)}) { float n = fbm(vec2(ph * 5.0, r * 30.0) + t * 0.15); c = mix(vec3(1.0, 0.9, 0.55), vec3(1.0, 1.0, 0.88), n) * (1.1 - r * 1.5); }
  else if (r < ${R[4].toFixed(4)}) { float a = ph * 3.0 + t * 0.25 * (1.2 - r); float w = fbm(vec2(r * 9.0 - t * 0.1, a)); float n = fbm(vec2(a * 2.0 + w * 2.5, r * 16.0 - t * 0.2));
    c = mix(vec3(0.95, 0.35, 0.03), vec3(1.0, 0.78, 0.22), n); }
  else if (r < ${R[3].toFixed(4)}) { float f = (r - ${R[4].toFixed(4)}) / ${(R[3] - R[4]).toFixed(4)}; float cell = sin(ph * 12.0) * 0.5 + 0.5;
    float n = fbm(vec2(ph * 9.0, f * 4.0 - t * 0.04 * (cell - 0.5) * 2.0)); c = mix(vec3(0.62, 0.17, 0.05), vec3(0.98, 0.5, 0.12), clamp((1.0 - f) * 0.65 + n * 0.55 + cell * 0.12 - 0.15, 0.0, 1.0)); }
  else if (r < ${R[2].toFixed(4)}) { float n = fbm(vec2(ph * 30.0, r * 60.0) + t * 0.03); c = mix(vec3(0.62, 0.2, 0.08), vec3(0.85, 0.32, 0.12), n); }
  else if (r < ${R[1].toFixed(4)}) { float n = fbm(vec2(ph * 40.0, r * 90.0) + t * 0.03); c = mix(vec3(0.55, 0.22, 0.1), vec3(0.8, 0.38, 0.16), n); }
  else if (r < ${R[0].toFixed(4)}) { c = vec3(0.42, 0.33, 0.26); }
  else { float n = fbm(vec2(ph * 300.0, r * 200.0)); c = mix(vec3(0.5, 0.42, 0.33), vec3(0.68, 0.58, 0.45), n); }
  float e = 1e9; ${R.slice(0, 6).map(v => `e = min(e, abs(r - ${v.toFixed(5)}));`).join(' ')}
  c *= 1.0 - 0.45 * smoothstep(0.0025, 0.0, e);
  gl_FragColor = vec4(c, 1.0); // colours written as sRGB, like a textbook figure
}`;

export class Inside {
  constructor(globe) {
    this.g = globe; this.group = new THREE.Group(); this.group.visible = false; globe.scene.add(this.group); this.U = { t: { value: 0 } };
    const la = 12.5 * Math.PI / 180, lo = 105 * Math.PI / 180; // Cambodia sits on the edge of the cut (same frame as the globe's xyz())
    const e1 = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)), e2 = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), e3 = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
    this.E = [e1, e2, e3]; // the removed piece is where p·e1 > 0, p·e2 > 0 and p·e3 > 0
    const mat = new THREE.ShaderMaterial({ uniforms: this.U, side: THREE.DoubleSide, vertexShader: 'varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: FS });
    this.faces = [[e1, e2, e3], [e1, e3, e2], [e2, e3, e1]].map(([u, v, n]) => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 192, 0, Math.PI / 2), mat), M = new THREE.Matrix4().makeBasis(u, v, new THREE.Vector3().crossVectors(u, v));
      m.quaternion.setFromRotationMatrix(M); m.position.copy(n).multiplyScalar(-0.0003); m.renderOrder = 1; this.group.add(m); return { u, v, n }; });
    // convection: particles going round cells in the mantle (rising hot, sinking cold), swirling flow in the outer core
    const P = [], C = [], sp = []; const r0 = R[4] + 0.02, r1 = 0.975;
    this.faces.forEach((f, fi) => { for (let i = 0; i < 3; i++) for (let L = 0.25; L < 1.0; L += 0.12) for (let k = 0; k < 14; k++) sp.push({ f, kind: 0, pc: (i + 0.5) * Math.PI / 6, rc: (r0 + r1) / 2, ap: Math.PI / 12 * 0.88, ar: (r1 - r0) / 2 * 0.92, L, s: k / 14 * 2 * Math.PI + L * 3, dir: (i + fi) % 2 ? 1 : -1 });
      for (let k = 0; k < 160; k++) sp.push({ f, kind: 1, p: Math.random() * Math.PI / 2, r: R[5] + 0.015 + Math.random() * (R[4] - R[5] - 0.03), w: 0.12 + Math.random() * 0.1 }); });
    this.sp = sp; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(sp.length * 3), 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(sp.length * 3), 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })); this.pts.frustumCulled = false; this.pts.renderOrder = 2; this.group.add(this.pts);
    // journey marker down the Cambodia edge
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 8), new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthTest: false })); this.marker.renderOrder = 5; this.marker.visible = false; this.group.add(this.marker);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), e1.clone().multiplyScalar(1.0)]); this.axis = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.6, depthTest: false })); this.axis.computeLineDistances(); this.axis.renderOrder = 4; this.group.add(this.axis);
    this.lab = document.createElement('div'); this.lab.className = 'insLabels'; this.lab.hidden = true; document.body.appendChild(this.lab); this.lang = 'en';
    this.t0 = performance.now(); this.speed = 1;
  }
  uniforms() { const [a, b, c] = this.E; return { cutOn: this.group.visible ? 1 : 0, e1: a, e2: b, e3: c }; }
  setOn(on) { this.group.visible = on; this.lab.hidden = !on; }
  setDepth(d) { this.depth = d; this.marker.visible = d != null; if (d != null) this.marker.position.copy(this.E[0]).multiplyScalar(1 - d / RE); }
  view() { const d = this.E[0].clone().add(this.E[1]).add(this.E[2]).normalize().multiplyScalar(0.6).add(this.E[0].clone().multiplyScalar(0.4)).normalize(); return d; }
  frame(cam, el, names) {
    if (!this.group.visible) return; const now = performance.now(), dt = Math.min(0.1, (now - (this.tl || now)) / 1000) * this.speed; this.tl = now; this.U.t.value += dt;
    const P = this.pts.geometry.attributes.position, C = this.pts.geometry.attributes.color, v = new THREE.Vector3();
    this.sp.forEach((s, i) => { let r, p, col;
      if (s.kind === 0) { s.s += dt * 0.35 * s.dir; const cs = Math.cos(s.s), sn = Math.sin(s.s); p = s.pc + s.ap * s.L * cs; r = s.rc + s.ar * s.L * sn; const up = cs * s.dir; // dr/ds·dir > 0: rising
        col = up > 0 ? [1, 0.85 + 0.15 * up, 0.35] : [0.35 + 0.2 * (1 + up), 0.12, 0.08]; }
      else { s.p += dt * s.w * (0.6 + 0.4 * Math.sin(s.r * 20 + s.p)); if (s.p > Math.PI / 2) s.p -= Math.PI / 2; p = s.p; r = s.r + 0.01 * Math.sin(this.U.t.value * 0.7 + s.w * 50); col = [1, 0.95, 0.6]; }
      v.copy(s.f.u).multiplyScalar(r * Math.cos(p)).addScaledVector(s.f.v, r * Math.sin(p)).addScaledVector(s.f.n, 0.002); P.setXYZ(i, v.x, v.y, v.z); C.setXYZ(i, ...col); });
    P.needsUpdate = true; C.needsUpdate = true;
    // labels on the cut faces, kept apart on screen
    const rc = el.getBoundingClientRect(), out = [], f = this.faces[0], f2 = this.faces[2];
    LAYERS.forEach(([en, km, a, b], k) => { const mid = 1 - (a + b) / 2 / RE, thin = b - a < 400, face = k >= 5 ? f2 : f, ang = k >= 5 ? 0.6 : thin ? 0.3 + k * 0.12 : 0.85;
      v.copy(face.u).multiplyScalar(mid * Math.cos(ang)).addScaledVector(face.v, mid * Math.sin(ang)).project(cam); if (v.z > 1) return;
      out.push([(v.x + 1) / 2 * rc.width + rc.left, (1 - v.y) / 2 * rc.height + rc.top, `${names(en, km)} <i>${a.toLocaleString()}–${b.toLocaleString()} km</i>`]); });
    out.sort((p, q) => p[1] - q[1]); for (let i = 1; i < out.length; i++) if (Math.abs(out[i][0] - out[i - 1][0]) < 160 && out[i][1] - out[i - 1][1] < 17) out[i][1] = out[i - 1][1] + 17;
    v.copy(this.E[0]).multiplyScalar(1.01).project(cam); const cx = (v.x + 1) / 2 * rc.width + rc.left, cy = (1 - v.y) / 2 * rc.height + rc.top;
    let h = out.map(([x, y, s]) => `<span style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px">${s}</span>`).join('') + `<span class="kh" style="left:${cx.toFixed(0)}px;top:${(cy - 18).toFixed(0)}px">📍 ${names('Cambodia', 'កម្ពុជា')}</span>`;
    if (this.marker.visible) { v.copy(this.marker.position).project(cam); h += `<span class="dp" style="left:${((v.x + 1) / 2 * rc.width + rc.left + 10).toFixed(0)}px;top:${((1 - v.y) / 2 * rc.height + rc.top).toFixed(0)}px">⬇ ${Math.round(this.depth).toLocaleString()} km</span>`; }
    if (h !== this._h) { this.lab.innerHTML = h; this._h = h; }
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
