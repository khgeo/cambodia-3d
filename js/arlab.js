// AR Lab: small 3D models for a geography class that you can walk around, turn, move and zoom —
// in the browser (drag, pinch), over the phone camera, or placed in the room with WebXR AR (Android Chrome).
// Models: seasons (Earth around the Sun with its tilted axis), Moon phases, Earth now (day/night, time zones),
// inside the Earth (pull the layers apart), the Solar System.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { t, lang } from './i18n.js?v=112';

const D2R = Math.PI / 180, TILT = 23.44 * D2R, TL = new THREE.TextureLoader();
const tex = f => { const x = TL.load('textures/space/' + f); x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 8; return x; };
const nm = (en, km) => lang === 'km' && km ? km : t(en);
// day/night globe lit by a point (the Sun) in world space; night side shows city lights
function litMat(day, night, sunW) {
  return new THREE.ShaderMaterial({ uniforms: { day: { value: day }, night: { value: night }, sunW, lit: { value: night ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sunW; uniform float lit; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ float d = dot(normalize(vN), normalize(sunW - vW)); float k = smoothstep(-0.08, 0.12, d); vec3 dc = texture2D(day, vUv).rgb * (0.25 + 0.95 * max(d, 0.0));
        vec3 nc = lit > 0.5 ? texture2D(night, vUv).rgb * 1.3 + vec3(0.01, 0.015, 0.03) : texture2D(day, vUv).rgb * 0.06; gl_FragColor = vec4(mix(nc, dc, k), 1.0);
        #include <colorspace_fragment>
      }` });
}
function circle(r, y, col, seg = 128) { const p = []; for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; p.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 })); }
function label(text, h = 0.05, col = '#fff') { const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 48; g.font = `600 ${fs}px system-ui, "Noto Sans Khmer", sans-serif`;
  const lines = String(text).split('\n'), w = Math.max(...lines.map(l => g.measureText(l).width)) + 40; c.width = Math.ceil(w); c.height = lines.length * fs * 1.25 + 24; g.font = `600 ${fs}px system-ui, "Noto Sans Khmer", sans-serif`;
  g.fillStyle = 'rgba(10,16,28,.72)'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 22); g.fill(); g.fillStyle = col; g.textBaseline = 'top'; lines.forEach((l, i) => g.fillText(l, 20, 12 + i * fs * 1.25));
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthWrite: false, transparent: true })); s.scale.set(h * c.width / c.height, h, 1); s.renderOrder = 5; return s; }
// an Earth with tilted axis, equator, tropics and polar circles (the lines in the classic seasons diagram)
function earth(r, sunW, { lines = true } = {}) {
  const tilt = new THREE.Group(), spin = new THREE.Group(); tilt.add(spin); tilt.rotation.z = -TILT; // the axis leans the same way all year (towards Polaris)
  spin.add(new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), litMat(tex('2k_earth_daymap.jpg'), tex('2k_earth_nightmap.jpg'), sunW)));
  if (lines) { for (const [lat, col] of [[0, '#ffffff'], [23.44, '#ffd84a'], [-23.44, '#ffd84a'], [66.56, '#5fd0ff'], [-66.56, '#5fd0ff']]) tilt.add(circle(r * 1.012 * Math.cos(lat * D2R), r * 1.012 * Math.sin(lat * D2R), col));
    const ax = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.025, r * 0.025, r * 3, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); tilt.add(ax); }
  return { tilt, spin }; }
function sun(r) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), new THREE.MeshBasicMaterial({ map: tex('2k_sun.jpg'), color: 0xfff4d6 })));
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(255,230,160,.9)'); gr.addColorStop(1, 'rgba(255,200,100,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(r * 4.5); g.add(s); return g; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLen = (latDeg, decl) => { const x = -Math.tan(latDeg * D2R) * Math.tan(decl); return x <= -1 ? 24 : x >= 1 ? 0 : 2 * Math.acos(x) / D2R / 15; };

export class ARLab {
  constructor(world) {
    this.w = world; const root = this.el = document.createElement('div'); root.id = 'arLab'; root.hidden = true;
    root.innerHTML = `<video id="arVideo" playsinline muted></video><div id="arCanvas"></div>
      <div class="arTop"><b>🥽 ${t('AR Lab')}</b><div class="arModels">${[['seasons', '🌍☀️', 'Seasons'], ['moon', '🌓', 'Moon phases'], ['earth', '🕒', 'Earth now & time zones'], ['inside', '🌋', 'Inside the Earth'], ['solar', '🪐', 'Solar System']].map(([k, i, n]) => `<button data-m="${k}" title="${t(n)}">${i} <span>${t(n)}</span></button>`).join('')}</div><button id="arX">✕</button></div>
      <div class="arBottom"><div id="arInfo"></div><div class="arCtl"><button id="arPlay">⏸</button><select id="arSpeed"><option value="0.3">0.3×</option><option value="1" selected>1×</option><option value="4">4×</option><option value="15">15×</option></select>
        <label><input type="checkbox" id="arLabels" checked> ${t('Labels')}</label><button id="arCam">📷 ${t('Camera')}</button><button id="arXR" hidden>🥽 ${t('Place in my room (AR)')}</button><button id="arMove" hidden>✥ ${t('Move')}</button></div>
        <div class="arHint" id="arHint">${t('Drag to turn · pinch or wheel to zoom · two fingers (or right-drag) to move')}</div></div>`;
    document.body.appendChild(root);
    const r = this.r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.xr.enabled = true; r.outputColorSpace = THREE.SRGBColorSpace; root.querySelector('#arCanvas').appendChild(r.domElement);
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(50, 1, 0.01, 50); this.cam.position.set(0, 0.55, 1.15);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, 1, 1); this.scene.add(dl);
    this.ctl = new OrbitControls(this.cam, r.domElement); this.ctl.enableDamping = true; this.ctl.minDistance = 0.15; this.ctl.maxDistance = 6; this.ctl.screenSpacePanning = true;
    this.stage = new THREE.Group(); this.scene.add(this.stage); this.sunW = { value: new THREE.Vector3() }; this.speed = 1; this.playing = true; this.time = 0;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00e5ff })); this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.scene.add(this.reticle);
    root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => this.load(b.dataset.m));
    root.querySelector('#arX').onclick = () => this.close();
    root.querySelector('#arPlay').onclick = e => { this.playing = !this.playing; e.target.textContent = this.playing ? '⏸' : '▶'; };
    root.querySelector('#arSpeed').onchange = e => { this.speed = +e.target.value; if (this.I) this.I.speed = this.speed; };
    root.querySelector('#arLabels').onchange = e => this.stage.traverse(o => { if (o.isSprite && o.userData.lab) o.visible = e.target.checked; });
    root.querySelector('#arCam').onclick = () => this.camera(!this.stream);
    root.querySelector('#arXR').onclick = () => this.startXR();
    root.querySelector('#arMove').onclick = () => { this.placed = false; this.stage.visible = false; };
    if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-ar').then(ok => { root.querySelector('#arXR').hidden = !ok; }).catch(() => { });
    addEventListener('resize', () => this.resize());
    // gestures while placed in AR (DOM overlay): one finger turns, two fingers pinch to scale
    const pts = new Map(); let pinch = 0;
    root.addEventListener('pointerdown', e => { if (!this.xr || e.target.closest('button,select,label,input')) return; pts.set(e.pointerId, [e.clientX, e.clientY]); });
    root.addEventListener('pointermove', e => { if (!this.xr || !pts.has(e.pointerId)) return; const [x0] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.stage.scale.multiplyScalar(Math.max(0.9, Math.min(1.1, d / pinch))); pinch = d; } else this.stage.rotation.y += (e.clientX - x0) * 0.01; });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; }; root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  }
  resize() { const W = innerWidth, H = innerHeight; if (this.r.xr.isPresenting) return; this.r.setSize(W, H); this.cam.aspect = W / H; this.cam.updateProjectionMatrix(); }
  open(model = 'seasons') { this.el.hidden = false; if (this.w) this.w.paused = true; this.resize(); this.load(this.model || model); this.clock = performance.now(); this.r.setAnimationLoop((ts, frame) => this.loop(frame)); }
  close() { this.el.hidden = true; this.r.setAnimationLoop(null); this.camera(false); if (this.r.xr.getSession()) this.r.xr.getSession().end(); if (this.w) this.w.paused = false; }
  async camera(on) { const v = this.el.querySelector('#arVideo');
    if (!on) { if (this.stream) this.stream.getTracks().forEach(k => k.stop()); this.stream = null; v.srcObject = null; this.el.classList.remove('cam'); return; }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); v.srcObject = this.stream; await v.play(); this.el.classList.add('cam'); }
    catch (e) { this.info(`<b>${t('Camera not available')}</b>: ${String(e.message || e)}`); } }
  async startXR() {
    try { const s = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: this.el } });
      this.camera(false); this.r.xr.setReferenceSpaceType('local'); await this.r.xr.setSession(s); this.xr = true; this.placed = false; this.stage.visible = false; this.stage.position.set(0, 0, 0); this.stage.scale.setScalar(0.5);
      this.el.classList.add('xr'); this.el.querySelector('#arMove').hidden = false; this.el.querySelector('#arHint').textContent = t('Point the phone at the floor or a table, then tap to place. One finger turns, two fingers resize.');
      const vs = await s.requestReferenceSpace('viewer'); this.hts = await s.requestHitTestSource({ space: vs });
      s.addEventListener('select', () => { if (!this.placed && this.reticle.visible) { this.stage.position.setFromMatrixPosition(this.reticle.matrix); this.stage.visible = true; this.placed = true; } });
      s.addEventListener('end', () => { this.xr = false; this.hts = null; this.reticle.visible = false; this.stage.visible = true; this.stage.position.set(0, 0, 0); this.stage.scale.setScalar(1); this.el.classList.remove('xr'); this.el.querySelector('#arMove').hidden = true; this.resize(); });
    } catch (e) { this.info(`<b>${t('AR could not start')}</b>: ${String(e.message || e)}`); } }
  info(h) { this.el.querySelector('#arInfo').innerHTML = h; }
  live(h) { const x = this.el.querySelector('#arLive'), n = performance.now(); if (x && n - (this._lv || 0) > 250) { this._lv = n; x.innerHTML = h; } }
  clear() { if (this.I) { this.I.dispose(); this.I = null; } this.stage.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.stage.clear(); this.upd = null; }
  async load(m) { this.clear(); this.model = m; this.el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === m)); this.time = 0;
    const S = this.stage, sunW = this.sunW, L = (s, en, km, h, col) => { const l = label(nm(en, km), h, col); l.userData.lab = true; l.visible = this.el.querySelector('#arLabels').checked; s.add(l); return l; };
    if (m === 'seasons') { // four Earths at the solstices and equinoxes, and one that travels through the year
      const sn = sun(0.09); S.add(sn); sunW.value.set(0, 0, 0); const R = 0.42; S.add(circle(R, 0, '#ffffff'));
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, ar = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); ar.position.set(R * Math.cos(a), 0, -R * Math.sin(a)); ar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a))); S.add(ar); } // Earth goes anticlockwise seen from the north
      const names = [['21 December · December solstice\nCambodia: cool dry season, shortest day', '២១ ធ្នូ · អយនកាលខែធ្នូ\nកម្ពុជា៖ រដូវប្រាំងត្រជាក់ ថ្ងៃខ្លីបំផុត'], ['20 March · March equinox\nday = night everywhere', '២០ មីនា · វិសុវកាលខែមីនា\nថ្ងៃ = យប់ គ្រប់ទីកន្លែង'], ['21 June · June solstice\nSun overhead at 23.4°N', '២១ មិថុនា · អយនកាលខែមិថុនា\nព្រះអាទិត្យត្រង់ក្បាលនៅ ២៣,៤°ជ'], ['23 September · September equinox\nday = night everywhere', '២៣ កញ្ញា · វិសុវកាលខែកញ្ញា\nថ្ងៃ = យប់ គ្រប់ទីកន្លែង']];
      this.es = []; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, E = earth(0.055, sunW); E.tilt.position.set(R * Math.cos(a), 0, -R * Math.sin(a)); S.add(E.tilt); this.es.push(E); const l = L(S, ...names[k], 0.05); l.position.copy(E.tilt.position).multiplyScalar(1.05).add(new THREE.Vector3(0, 0.15, 0)); }
      const E = this.mover = earth(0.07, sunW); S.add(E.tilt); E.tilt.visible = false; this.moverLab = null;
      this.upd = dt => { const yr = this.time / 30 % 1, dayN = Math.floor(yr * 365), a = (dayN - 0) / 365.25 * 2 * Math.PI; // day 0 = 21 Dec
        for (const e of this.es) e.spin.rotation.y += dt * 0.8; E.tilt.visible = this.travel; if (this.travel) { E.tilt.position.set(R * Math.cos(a), 0, -R * Math.sin(a)); E.spin.rotation.y += dt * 2.5; }
        const d = new Date(Date.UTC(2026, 11, 21) + dayN * 864e5), N = (355 + dayN) % 365, decl = TILT * Math.sin(2 * Math.PI * (N - 80) / 365);
        this.live(this.travel ? `<b>${d.getUTCDate()} ${t(MONTHS[d.getUTCMonth()])}</b> · ${t('Sun overhead at')} ${(Math.abs(decl) / D2R).toFixed(1)}°${decl >= 0 ? 'N' : 'S'} · ${t('day length in Phnom Penh')} ${dayLen(11.56, decl).toFixed(1)} h` : ''); };
      this.info(`<b>${t('Seasons')}</b> · ${t('The axis always leans 23.4° the same way, so in June the north leans towards the Sun and in December away from it.')}<br><label><input type="checkbox" id="arTravel"> ${t('Travel through the year')}</label> <span id="arLive"></span>`);
      this.el.querySelector('#arTravel').onchange = e => { this.travel = e.target.checked; this.time = 0; };
    }
    if (m === 'moon') { const E = earth(0.1, sunW, { lines: false }); S.add(E.tilt); E.tilt.rotation.z = 0; sunW.value.set(30, 0, 0); // sunlight from the right
      const sn = sun(0.04); sn.position.set(0.85, 0, 0); S.add(sn); L(S, 'Sunlight →', 'ពន្លឺព្រះអាទិត្យ →', 0.04, '#ffe9a8').position.set(0.62, 0.12, 0);
      const R = 0.38, mo = new THREE.Mesh(new THREE.SphereGeometry(0.03, 48, 24), litMat(tex('2k_moon.jpg'), null, sunW)); S.add(mo); S.add(circle(R, 0, '#8fa8c8'));
      const PH = [['New Moon', 'ព្រះច័ន្ទថ្មី (ងងឹត)'], ['Waxing crescent', 'កើតចន្ទ្រកាល'], ['First quarter', 'កើត ៨ កើត'], ['Waxing gibbous', 'កើតជិតពេញ'], ['Full Moon', 'ព្រះច័ន្ទពេញបូណ៌មី'], ['Waning gibbous', 'រនោចបន្ទាប់ពីពេញ'], ['Last quarter', '៨ រោច'], ['Waning crescent', 'រោចចន្ទ្រកាល']];
      const syn = 29.530589, ref = Date.UTC(2000, 0, 6, 18, 14), age0 = ((Date.now() - ref) / 864e5) % syn; // today's real phase to start
      this.upd = dt => { const age = (age0 + this.time * 1.5) % syn, a = age / syn * 2 * Math.PI; mo.position.set(R * Math.cos(a), 0, -R * Math.sin(a)); mo.rotation.y = a + Math.PI; E.spin.rotation.y += dt * 1.2;
        const k = Math.round(age / syn * 8) % 8, ill = (1 - Math.cos(a)) / 2;
        this.live(`<b>${nm(...PH[k])}</b> · ${t('lit')} ${Math.round(ill * 100)}% · ${t('Moon age')} ${age.toFixed(1)} ${t('days')}`); };
      this.info(`<b>${t('Moon phases')}</b> · <span id="arLive"></span><br>${t('The Sun always lights half of the Moon; the phase is how much of the lit half we see from Earth. 29.5 days from new Moon to new Moon; it starts at today’s real phase.')}`);
      // the Moon as seen from Earth at eight places on its orbit
      PH.forEach(([en, km], k) => { if (k % 2) return; const a = k / 8 * 2 * Math.PI, l = L(S, en, km, 0.035, '#cfe3ff'); l.position.set((R + 0.13) * Math.cos(a), 0.05, -(R + 0.13) * Math.sin(a)); });
    }
    if (m === 'earth') { const E = earth(0.25, sunW, { lines: true }); S.add(E.tilt); E.tilt.rotation.z = 0; const TZ = await import('./timezones.js?v=112');
      const cv = await TZ.tzCanvas(2048, { alpha: 0.28 }), ov = new THREE.Mesh(new THREE.SphereGeometry(0.2515, 96, 48), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })); ov.material.map.colorSpace = THREE.SRGBColorSpace; E.spin.add(ov);
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 10), new THREE.MeshBasicMaterial({ color: 0xff3355 })); const ll = (la, lo, r) => new THREE.Vector3(r * Math.cos(la * D2R) * Math.cos(lo * D2R), r * Math.sin(la * D2R), -r * Math.cos(la * D2R) * Math.sin(lo * D2R));
      pin.position.copy(ll(12.5, 105, 0.27)); pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), pin.position.clone().normalize().negate()); E.spin.add(pin);
      // three's sphere texture puts lon 0 at +x and 90°E at -z, the same frame as ll()
      this.upd = dt => { const now = Date.now() + this.time * 3600e3, d = now / 864e5 + 2440587.5 - 2451545, g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d, Lm = (q + 1.915 * Math.sin(g)) * D2R, e = 23.439 * D2R;
        const dec = Math.asin(Math.sin(e) * Math.sin(Lm)), ra = Math.atan2(Math.cos(e) * Math.sin(Lm), Math.cos(Lm)), gmst = ((280.46061837 + 360.98564736629 * d) % 360) * D2R, sl = (ra - gmst) / D2R; // sub-solar longitude
        sunW.value.copy(ll(dec / D2R, sl, 50)); const ph = new Date(now + 7 * 36e5);
        this.live(`${t('Phnom Penh')} <b>${String(ph.getUTCHours()).padStart(2, '0')}:${String(ph.getUTCMinutes()).padStart(2, '0')}</b> (UTC+7) · UTC ${new Date(now).toISOString().slice(11, 16)} · ${new Date(now + 7 * 36e5).toISOString().slice(0, 10)}`); };
      this.info(`<b>${t('Earth now & time zones')}</b> · <span id="arLive"></span> · ${t('time runs 1 hour per second (pause for now)')}<br>${t('Coloured bands are time zones; the yellow outline is UTC+7 (Cambodia). Day and night follow the real Sun.')}`);
    }
    if (m === 'inside') { const M = await import('./interior.js?v=112'); const g = new THREE.Group(); g.scale.setScalar(0.3); g.position.y = 0.05; S.add(g); sunW.value.set(5, 3, 5);
      const E = M.octant(new THREE.Vector3(0.3, 0.6, 1)); this.I = new M.Interior(M.INTERIORS.Earth, { E, parent: g, surface: U => M.cutMaterial(new THREE.MeshStandardMaterial({ map: tex('2k_earth_daymap.jpg'), roughness: 0.9 }), U) }); this.I.setOn(true); this.I.lab.hidden = true; this.I.speed = this.speed;
      this.info(`<b>${t('Inside the Earth')}</b> · ${t('Pull the layers apart')} <input type="range" id="arSplit" min="0" max="1" step="0.01" value="0" style="width:160px"><br>${t('Crust, mantle, liquid outer core, solid inner core at their true depths (PREM).')}`);
      this.el.querySelector('#arSplit').oninput = e => this.I.setSplit(+e.target.value);
      for (const ly of M.INTERIORS.Earth.layers) if (ly.r1 - ly.r0 > 0.1) { const l = L(g, ly.en, ly.km, 0.12); const mid = (ly.r0 + ly.r1) / 2; l.position.set(-1.35, mid * 1.2 - 0.2, 0); }
      this.upd = dt => { this.I.anim(dt); }; }
    if (m === 'solar') { const sn = sun(0.07); S.add(sn); sunW.value.set(0, 0, 0);
      const P = [['Mercury', 'ពុធ', 0.39, 0.24, 0.012, '2k_mercury.jpg'], ['Venus', 'សុក្រ', 0.72, 0.62, 0.02, '2k_venus_atmosphere.jpg'], ['Earth', 'ផែនដី', 1, 1, 0.021, '2k_earth_daymap.jpg'], ['Mars', 'អង្គារ', 1.52, 1.88, 0.015, '2k_mars.jpg'], ['Jupiter', 'ព្រហស្បតិ៍', 5.2, 11.86, 0.045, '2k_jupiter.jpg'], ['Saturn', 'សៅរ៍', 9.54, 29.46, 0.038, '2k_saturn.jpg'], ['Uranus', 'អ៊ុយរ៉ានុស', 19.2, 84, 0.028, '2k_uranus.jpg'], ['Neptune', 'ណិបទូន', 30.1, 164.8, 0.027, '2k_neptune.jpg']];
      this.pl = P.map(([en, km, au, yr, r, f], i) => { const R = 0.1 + Math.sqrt(au) * 0.085, m2 = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), litMat(tex(f), null, sunW)); S.add(circle(R, 0, '#5b6b84')); S.add(m2);
        if (en === 'Saturn') { const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.3, r * 2.2, 64), new THREE.MeshBasicMaterial({ color: 0xd8c08a, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })); rg.rotation.x = -Math.PI / 2 + 0.47; m2.add(rg); }
        const l = L(S, en, km, 0.03); return { m: m2, l, R, yr, a: i * 0.9 }; });
      this.upd = dt => { for (const p of this.pl) { p.a += dt * 0.6 / p.yr; p.m.position.set(p.R * Math.cos(p.a), 0, -p.R * Math.sin(p.a)); p.m.rotation.y += dt; p.l.position.copy(p.m.position).add(new THREE.Vector3(0, 0.05, 0)); } };
      this.info(`<b>${t('Solar System')}</b> · ${t('Distances are squeezed (square root) and planets enlarged so all fit on a table; speeds are true to each other: Earth goes round once while Neptune moves only 2°.')}`); }
  }
  loop(frame) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.clock) / 1000) * (this.playing ? this.speed : 0); this.clock = now; this.time += dt;
    if (this.upd) this.upd(dt);
    if (frame && this.hts && !this.placed) { const rs = this.r.xr.getReferenceSpace(), hits = frame.getHitTestResults(this.hts); if (hits.length) { this.reticle.visible = true; this.reticle.matrix.fromArray(hits[0].getPose(rs).transform.matrix); } else this.reticle.visible = false; }
    else this.reticle.visible = false;
    if (!this.r.xr.isPresenting) this.ctl.update(); this.r.render(this.scene, this.cam);
  }
}
