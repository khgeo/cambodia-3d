// Real night sky around the viewer (StarChart KH): stars sized and coloured by magnitude and colour index,
// planets, the Moon with its phase, constellation lines and floating names, for the area and the chosen time.
// Scene axes: east = +x, up = +y, north = -z.
import * as THREE from 'three';
import { skyNow, bvColor, BODY_KM, loadSky } from './sky.js?v=68';

const D2R = Math.PI / 180;
const dirOf = (alt, az) => { const a = alt * D2R, z = az * D2R; return [Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a)]; };
const PCOL = { Moon: '#f4f1e6', Mercury: '#d8cfc0', Venus: '#fff6c9', Mars: '#ff8a5a', Jupiter: '#ffe2b0', Saturn: '#f0d58a', Uranus: '#bfe9ef', Neptune: '#9fb8ff' };

const VS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float pr;
void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * pr; }`;
const FS = `varying vec3 vC; uniform float op;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float core = smoothstep(1.0, 0.0, d); float a = core * core * (3.0 - 2.0 * core);
  if (a < 0.01) discard; gl_FragColor = vec4(vC * (0.6 + 0.6 * core), a * op); }`;

export class SkyView {
  constructor(world) {
    this.w = world; this.group = new THREE.Group(); this.group.visible = false; this.group.renderOrder = -1; world.scene.add(this.group);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { op: { value: 1 }, pr: { value: world.renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pts = new THREE.Points(new THREE.BufferGeometry(), this.mat); this.pts.frustumCulled = false; this.group.add(this.pts);
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x5f8fe0, transparent: true, opacity: 0.32, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMat); this.lines.frustumCulled = false; this.group.add(this.lines);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; this.moonCv = cv;
    this.moonTex = new THREE.CanvasTexture(cv); this.moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.moonTex, transparent: true, depthWrite: false, fog: false })); this.moon.visible = false; this.group.add(this.moon);
    this.labels = []; this.showLines = true; this.showNames = true; this.opacity = 0;
    const host = world.renderer.domElement.parentElement; this.lab = document.createElement('div'); this.lab.className = 'skyLabels'; host.appendChild(this.lab);
  }
  async load() { this.S = this.S || await loadSky(); return this.S; }
  // rebuild for a place and time
  update(lat, lon, date, lang) {
    const S = this.S; if (!S) return; this.lat = lat; this.lon = lon; this.date = date; this.lang = lang;
    const sky = this.sky = skyNow(S, lat, lon, date), P = [], C = [], Z = [], L = [];
    for (const s of sky.stars) {
      if (s.mag > 6 || s.alt < -1) continue; const [r, g, b] = bvColor(s.bv), k = Math.min(1.35, 0.6 + Math.pow(10, -0.4 * (s.mag - 2)) * 0.55);
      P.push(...dirOf(s.alt, s.az)); C.push(r / 255 * k, g / 255 * k, b / 255 * k); Z.push(Math.max(2.2, Math.min(10, (6.8 - s.mag) * 1.45)));
      const nm = S.names[s.id]; if (nm && s.mag < 1.7 && s.alt > 2) L.push({ d: dirOf(s.alt, s.az), t: nm, c: 'star' });
    }
    for (const [n, b] of Object.entries(sky.body)) {
      if (n === 'Sun' || b.alt < -1) continue; const d = dirOf(b.alt, b.az), nm = lang === 'km' ? BODY_KM[n] : n;
      if (n === 'Moon') { this.drawMoon(b); this.moon.userData.d = new THREE.Vector3(...d); this.moon.visible = true; L.push({ d, t: (lang === 'km' ? BODY_KM.Moon : 'Moon') + ` ${Math.round((b.phase || 0) * 100)}%`, c: 'moon', off: 26 }); continue; }
      const col = new THREE.Color(PCOL[n] || '#ffffff'); P.push(...d); C.push(col.r * 1.3, col.g * 1.3, col.b * 1.3); Z.push(Math.max(6, Math.min(13, 9 - b.mag * 1.1)));
      L.push({ d, t: nm, c: 'planet', col: PCOL[n] });
    }
    if (!sky.body.Moon || sky.body.Moon.alt < -1) this.moon.visible = false;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(Z, 1));
    this.pts.geometry.dispose(); this.pts.geometry = g;
    // constellation stick figures and names
    const LP = [];
    for (const segs of Object.values(S.lines)) for (const seg of segs) for (let i = 1; i < seg.length; i++) {
      const [a1, z1] = sky.hor(seg[i - 1][0], seg[i - 1][1]), [a2, z2] = sky.hor(seg[i][0], seg[i][1]); if (a1 < -2 || a2 < -2) continue; LP.push(...dirOf(a1, z1), ...dirOf(a2, z2));
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3)); this.lines.geometry.dispose(); this.lines.geometry = lg;
    for (const [id, en, ra, dec, rank] of S.cons) {
      const k = S.km[id]; if (rank > 1 && !k) continue; const [alt, az] = sky.hor(ra, dec); if (alt < 6) continue;
      L.push({ d: dirOf(alt, az), t: lang === 'km' && k ? k : k ? `${en} · ${k}` : en.replace(/ /g, ' '), c: k ? 'zod' : 'con' });
    }
    this.lab.innerHTML = ''; this.labels = L.map(o => { const e = document.createElement('span'); e.className = 'sl ' + o.c; e.textContent = o.t; if (o.col) e.style.color = o.col; this.lab.appendChild(e); return { ...o, v: new THREE.Vector3(...o.d), e }; });
    return sky;
  }
  drawMoon(b) {
    const g = this.moonCv.getContext('2d'), r = 54, c = 64, ph = b.phase || 0; g.clearRect(0, 0, 128, 128);
    const glow = g.createRadialGradient(c, c, r * 0.8, c, c, 64); glow.addColorStop(0, 'rgba(255,250,230,.35)'); glow.addColorStop(1, 'rgba(255,250,230,0)'); g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#2b2f38'; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill();
    const s = b.waxing ? 1 : -1, k = Math.abs(1 - 2 * ph) * r; g.fillStyle = '#f2eedf'; g.beginPath();
    g.arc(c, c, r, -Math.PI / 2, Math.PI / 2, s < 0); g.ellipse(c, c, k, r, 0, Math.PI / 2, -Math.PI / 2, (ph > 0.5) === (s > 0)); g.fill();
    g.globalAlpha = 0.12; g.fillStyle = '#556'; for (const [x, y, rr] of [[50, 48, 10], [76, 60, 8], [60, 82, 12], [82, 40, 6]]) { g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); } g.globalAlpha = 1;
    this.moonTex.needsUpdate = true;
  }
  // each frame: follow the camera (the sky is infinitely far) and place the names
  frame(op) {
    const w = this.w, cam = w.camera, R = (w.extent || 3000) * 6, on = op > 0.02; this.group.visible = on; this.lab.style.display = on && this.showNames ? '' : 'none';
    if (!on) return; this.mat.uniforms.op.value = op; this.lineMat.opacity = 0.32 * op; this.lines.visible = this.showLines;
    this.group.position.copy(cam.position); this.pts.scale.setScalar(R); this.lines.scale.setScalar(R);
    if (this.moon.visible) { this.moon.position.copy(this.moon.userData.d).multiplyScalar(R * 0.98); const s = R * Math.tan(1.6 * D2R) * 2; this.moon.scale.set(s, s, 1); this.moon.material.opacity = Math.min(1, op * 1.2); }
    if (!this.showNames) return;
    const el = w.renderer.domElement, W = el.clientWidth, H = el.clientHeight, v = new THREE.Vector3(), fw = new THREE.Vector3(); cam.getWorldDirection(fw);
    for (const L of this.labels) {
      if (L.v.dot(fw) < 0.05) { L.e.style.display = 'none'; continue; }
      v.copy(L.v).multiplyScalar(R).add(cam.position).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { L.e.style.display = 'none'; continue; }
      L.e.style.display = ''; L.e.style.opacity = op; L.e.style.transform = `translate(${((v.x + 1) / 2 * W + (L.off || 7)).toFixed(1)}px,${((1 - v.y) / 2 * H - 7).toFixed(1)}px)`;
    }
  }
  dispose() { this.lab.remove(); this.w.scene.remove(this.group); }
}
