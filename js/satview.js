// Satellite close-up and a walk (float) inside the International Space Station.
// Close-up: the satellite's real position now (SGP4), the real Earth below it (same day/night map as the globe),
// stars, Sun and Moon behind. Models: NASA 3D Resources (public domain); Tiangong and the generic satellite are
// simple illustrations. Inside the ISS: the US segment and Zarya built as a walk-through, with the Cupola windows
// looking down on the real Earth under the station right now.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { t } from './i18n.js?v=95';

const R_KM = 6371, D2R = Math.PI / 180;
const MODELS = { iss: ['iss.glb', 109, 'NASA 3D Resources'], landsat: ['landsat8.glb', 10, 'NASA 3D Resources (Landsat 8)'], sentinel6: ['sentinel6.glb', 5.2, 'NASA 3D Resources'], goes: ['goes.glb', 20, 'NASA 3D Resources (GOES)'], generic: ['suomi.glb', 8, 'Illustrative model (NASA Suomi NPP)'] };
const modelFor = n => { const N = n.toUpperCase(); if (/ISS|ZARYA/.test(N)) return 'iss'; if (/TIANHE|CSS|TIANGONG/.test(N)) return 'tiangong'; if (/LANDSAT/.test(N)) return 'landsat'; if (/SENTINEL-6/.test(N)) return 'sentinel6'; if (/GOES|HIMAWARI|METEOSAT|FENGYUN|FY-|GEO-KOMPSAT|INSAT|ELEKTRO/.test(N)) return 'goes'; return 'generic'; };
let loader = null;
const getLoader = () => { if (!loader) { loader = new GLTFLoader(); const d = new DRACOLoader(); d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(d); loader.setMeshoptDecoder(MeshoptDecoder); } return loader; };
const cache = {};

export class SatView {
  constructor(globe) {
    this.g = globe; this.w = globe.w; this.active = false; this.inside = null;
    this.cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2e4); this.camE = new THREE.PerspectiveCamera(45, 1, 1e3, 4e7); this.bgCam = new THREE.PerspectiveCamera(45, 1, 0.001, 200);
    this.ctl = new OrbitControls(this.cam, this.w.renderer.domElement); this.ctl.enabled = false; this.ctl.enableDamping = true; this.ctl.enablePan = false;
    // the Earth in metres, with the globe's day/night shader and clouds, and a thin atmosphere
    const es = this.earthScene = new THREE.Scene(); const sph = new THREE.SphereGeometry(1, 256, 128);
    this.earth = new THREE.Mesh(sph, globe.earth.material); this.earth.scale.setScalar(R_KM * 1000); es.add(this.earth);
    this.cloudMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false }); this.clouds = new THREE.Mesh(sph, this.cloudMat); // the satellite cloud picture is coarse: keep it light so the ground shows this.clouds.scale.setScalar(R_KM * 1000 * 1.0016); es.add(this.clouds);
    this.atm = new THREE.Mesh(sph, new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { sun: globe.U.sun },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vW = normalize(position); vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 sun; varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); float d = smoothstep(-0.25, 0.3, dot(vW, normalize(sun))); gl_FragColor = vec4(0.3, 0.55, 1.0, 1.0) * f * 2.2 * d; }' }));
    this.atm.scale.setScalar(R_KM * 1000 * 1.012); es.add(this.atm); this.tileG = new THREE.Group(); this.tileG.scale.setScalar(R_KM * 1000); es.add(this.tileG); this.tiles = new Map(); this.sunE = new THREE.DirectionalLight(0xffffff, 2.2); es.add(this.sunE, new THREE.AmbientLight(0xffffff, 0.12));
    // the satellite
    const ss = this.satScene = new THREE.Scene(); this.sun = new THREE.DirectionalLight(0xffffff, 3.2); ss.add(this.sun, this.sun.target, new THREE.AmbientLight(0xffffff, 0.22)); this.earthLight = new THREE.HemisphereLight(0x000000, 0x4a78b8, 0.6); ss.add(this.earthLight);
    this.holder = new THREE.Group(); ss.add(this.holder);
    this.ui();
  }
  /* ---------------- where the satellite is ---------------- */
  state(d = new Date()) { // position (km, globe ECEF frame: y = north) and basis: forward along the track, up = zenith
    const g = this.g, SJ = g.SJ, rec = this.sat.rec, p0 = g.satPos(rec, d), p1 = g.satPos(rec, new Date(d.getTime() + 1000)); if (!p0 || !p1) return null;
    const p = p0.clone().multiplyScalar(R_KM), up = p0.clone().normalize(), fw = p1.clone().sub(p0).normalize(); fw.addScaledVector(up, -fw.dot(up)).normalize(); const side = new THREE.Vector3().crossVectors(fw, up);
    const pv = SJ.propagate(rec, d), v = pv && pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0, gd = pv && pv.position ? SJ.eciToGeodetic(pv.position, SJ.gstime(d)) : null;
    return { p, up, fw, side, B: new THREE.Matrix4().makeBasis(fw, up, side), v, gd };
  }
  /* ---------------- open / close ---------------- */
  async open(sat) {
    this.sat = sat; this.kind = modelFor(sat.name); this.active = true; this.box.hidden = false; document.body.classList.add('satview-on'); this.g.ctl.enabled = false; this.ctl.enabled = true;
    this.holder.clear(); this.say(t('Loading the 3D model…'));
    let obj, credit, size;
    if (this.kind === 'tiangong') { obj = tiangong(); size = 55; credit = t('Illustrative model'); }
    else { const [f, sz, cr] = MODELS[this.kind]; size = sz; credit = cr;
      try { if (!cache[f]) cache[f] = await getLoader().loadAsync('models/space/' + f); obj = cache[f].scene.clone(true); } catch (e) { console.warn(e); obj = tiangong(); credit = t('Illustrative model'); size = 20; }
      const bb = new THREE.Box3().setFromObject(obj), s = bb.getSize(new THREE.Vector3()), k = sz / Math.max(s.x, s.y, s.z), c = bb.getCenter(new THREE.Vector3()); obj.position.copy(c.multiplyScalar(-k)); obj.scale.setScalar(k);
      obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.metalness !== undefined) { m.metalness = Math.min(m.metalness, 0.35); m.roughness = Math.max(m.roughness ?? 0.5, 0.45); } }); } }); } // no environment map out here: very metallic parts would look black
    const wrap = new THREE.Group(); wrap.add(obj); this.holder.add(wrap); this.size = size; this.credit = credit;
    this.cam.position.set(size * 0.9, size * 0.45, size * 1.1); this.ctl.target.set(0, 0, 0); this.ctl.minDistance = size * 0.55; this.ctl.maxDistance = size * 40; this.ctl.update(); this.say(''); this.S = this.state(); this.hud();
    this.render();
  }
  close() { this.exitInside(); this.active = false; this.box.hidden = true; this.ctl.enabled = false; this.g.ctl.enabled = true; document.body.classList.remove('satview-on'); this.holder.clear(); this.onClose && this.onClose(); }
  /* ---------------- frame ---------------- */
  frame(dt) {
    const w = this.w, el = w.renderer.domElement, asp = el.clientWidth / Math.max(1, el.clientHeight);
    for (const c of [this.cam, this.camE, this.bgCam]) if (c.aspect !== asp) { c.aspect = asp; c.updateProjectionMatrix(); }
    const S = this.state(); if (!S) return; this.S = S;
    this.earth.position.copy(S.p).multiplyScalar(-1000); this.clouds.position.copy(this.earth.position); this.atm.position.copy(this.earth.position); this.tileG.position.copy(this.earth.position); if (this.cloudMat.map !== this.g.clouds.material.map) { this.cloudMat.map = this.g.clouds.material.map; this.cloudMat.needsUpdate = true; } this.clouds.visible = this.g.opt.clouds;
    this.tileT = (this.tileT || 0) + dt; if (this.tileT > 2 && S.gd) { this.tileT = 0; this.updTiles(S.gd.latitude / D2R, S.gd.longitude / D2R); }
    if (this.g.cos) { const sv = this.g.cos.sunEcef(); if (sv) this.g.U.sun.value.copy(sv); }
    const sunDir = this.g.U.sun.value; this.sun.position.copy(sunDir).multiplyScalar(100); this.sunE.position.copy(sunDir).multiplyScalar(1e8); this.earthLight.position.copy(S.up);
    // is the satellite in the Earth's shadow?
    const pe = S.p.clone().multiplyScalar(1 / R_KM), along = pe.dot(sunDir), perp = pe.clone().addScaledVector(sunDir, -along).length(); this.eclipse = along < 0 && perp < 1; this.sun.intensity = this.eclipse ? 0 : 3.2;
    let q;
    if (this.inside) { this.inside.step(dt); q = this.inside.cam.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromRotationMatrix(S.B)); this.camE.fov = this.bgCam.fov = this.inside.cam.fov; }
    else { this.holder.quaternion.setFromRotationMatrix(S.B); this.ctl.update(); q = this.cam.quaternion.clone(); this.camE.fov = this.bgCam.fov = this.cam.fov; }
    this.camE.position.set(0, 0, 0); this.camE.quaternion.copy(q); this.camE.updateProjectionMatrix();
    // 1 stars, Sun, Moon  2 Earth  3 satellite or the inside of the station
    const r = w.renderer, ac = r.autoClear;
    this.bgCam.position.copy(S.p).multiplyScalar(1 / R_KM); this.bgCam.quaternion.copy(q); this.bgCam.updateProjectionMatrix();
    if (this.g.cos) this.g.cos.renderBackground(this.bgCam); else { r.setClearColor(0x02040a, 1); r.clear(); }
    r.autoClear = false; r.clearDepth(); r.render(this.earthScene, this.camE); r.clearDepth();
    if (this.inside) r.render(this.inside.scene, this.inside.cam); else r.render(this.satScene, this.cam);
    r.autoClear = ac; this.hudT = (this.hudT || 0) + dt; if (this.hudT > 0.5) { this.hudT = 0; this.hud(); }
  }
  render() { this.tileT = 99; }
  // sharp imagery under the satellite (Esri World Imagery), lit by the Sun so the night side stays dark
  updTiles(lat, lon) { if (Math.abs(lat) > 84) return; const want = new Set();
    for (const [z, rad] of [[6, 2], [8, 2]]) { const N = 2 ** z, tx = Math.floor((lon + 180) / 360 * N), ty = Math.floor((1 - Math.log(Math.tan((45 + lat / 2) * D2R)) / Math.PI) / 2 * N);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const y = ty + dy, x = ((tx + dx) % N + N) % N; if (y >= 0 && y < N) want.add(`${z}/${x}/${y}`); } }
    for (const k of want) if (!this.tiles.has(k)) { const [z, x, y] = k.split('/').map(Number), m = this.g.tileMesh(z, x, y); { const P = m.geometry.attributes.position, nrm = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { const v = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)).normalize(); nrm.set([v.x, v.y, v.z], i * 3); } m.geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); } m.material.dispose(); m.material = new THREE.MeshLambertMaterial({ depthWrite: false, transparent: true, opacity: 0 }); m.renderOrder = z; this.tileG.add(m); this.tiles.set(k, m);
      const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { const tx = new THREE.Texture(im); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; tx.needsUpdate = true; m.material.map = tx; m.material.opacity = 1; m.material.transparent = false; m.material.needsUpdate = true; m.visible = true; };
      im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; }
    for (const [k, m] of this.tiles) if (!want.has(k)) { this.tileG.remove(m); m.geometry.dispose(); m.material.map && m.material.map.dispose(); m.material.dispose(); this.tiles.delete(k); } }
  /* ---------------- inside the ISS ---------------- */
  async enterInside() { if (this.kind !== 'iss') return; this.inside = new IssInside(this.w); this.box.classList.add('in'); this.hud(); }
  exitInside() { if (!this.inside) return; this.inside.dispose(); this.inside = null; this.box.classList.remove('in'); this.ctl.enabled = this.active; this.hud(); }
  /* ---------------- HTML ---------------- */
  ui() {
    const d = this.box = document.createElement('div'); d.className = 'satView'; d.hidden = true;
    d.innerHTML = `<div class="svCard" id="svCard"></div><div class="svBtns"><button id="svBack">↩ ${t('Back to the globe')}</button><button id="svIn" hidden>🚪 ${t('Go inside the ISS')}</button><button id="svOut" hidden>🛰️ ${t('Back outside')}</button></div>
      <div class="svPad" id="svPad"><button data-mv="f">▲</button><button data-mv="b">▼</button><button data-mv="u">⤒</button><button data-mv="d">⤓</button></div><div class="svRoom" id="svRoom"></div><div class="svMsg" id="svMsg"></div>`;
    document.body.appendChild(d);
    d.querySelector('#svBack').onclick = () => { this.close(); };
    d.querySelector('#svIn').onclick = () => this.enterInside(); d.querySelector('#svOut').onclick = () => this.exitInside();
    d.querySelectorAll('[data-mv]').forEach(b => { const k = b.dataset.mv; const on = e => { e.preventDefault(); if (this.inside) this.inside.pad[k] = 1; }, off = () => { if (this.inside) this.inside.pad[k] = 0; }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); });
  }
  say(s) { const m = this.box.querySelector('#svMsg'); m.textContent = s; m.hidden = !s; }
  hud() { const S = this.S, c = this.box.querySelector('#svCard'), s = this.sat; if (!s) return; const isISS = this.kind === 'iss';
    this.box.querySelector('#svIn').hidden = !isISS || !!this.inside; this.box.querySelector('#svOut').hidden = !this.inside;
    const name = s.sp ? s.sp.label : s.name;
    c.innerHTML = `<b>🛰️ ${name}</b>${s.sp && s.sp.label !== s.name ? `<span> · ${s.name}</span>` : ''}${S && S.gd ? `<div>⬆️ ${Math.round(S.gd.height).toLocaleString()} km · 💨 ${Math.round(S.v * 3600).toLocaleString()} km/h</div><div>📍 ${t('Over')} ${(S.gd.latitude / D2R).toFixed(2)}°, ${(S.gd.longitude / D2R).toFixed(2)}° · ${this.eclipse ? '🌑 ' + t('in the Earth\'s shadow') : '☀️ ' + t('in sunlight')}</div>` : ''}
      <div class="why">${this.inside ? t('Drag to look around, ▲ ▼ (or W/S) to float, ⤒ ⤓ (Q/E) up and down. The Cupola windows show the real Earth below the station now.') : t('Drag to turn around it, wheel or pinch to zoom. The Earth below is where it is right now.')}</div><div class="why">${this.inside ? t('Interior: illustration of the US segment and Zarya.') : this.credit || ''}</div>`;
    if (this.inside) { const rm = this.inside.room(); this.box.querySelector('#svRoom').innerHTML = rm ? `<b>${t(rm.name)}</b><span>${t(rm.info)}</span>` : ''; } else this.box.querySelector('#svRoom').innerHTML = ''; }
}

/* Tiangong (China Space Station): core module and two lab modules in a T, with wings – an illustration */
function tiangong() {
  const g = new THREE.Group(), body = new THREE.MeshStandardMaterial({ color: 0xe8e6df, metalness: 0.3, roughness: 0.55 }), gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 }), panel = new THREE.MeshStandardMaterial({ color: 0x1b2a58, metalness: 0.5, roughness: 0.3, emissive: 0x050a1a });
  const cyl = (r, l, m) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 32), m);
  const core = cyl(2.1, 16.6, body); core.rotation.z = Math.PI / 2; g.add(core); const node = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), gold); node.position.x = 8.6; g.add(node);
  for (const s of [-1, 1]) { const lab = cyl(2.1, 17.9, body); lab.position.set(9.8, 0, s * 9.6); lab.rotation.x = Math.PI / 2; g.add(lab); const wing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 27), panel); wing.position.set(9.8, 0, s * 33); g.add(wing); const mast = cyl(0.08, 9, gold); mast.position.set(9.8, 0, s * 22); mast.rotation.x = Math.PI / 2; g.add(mast); }
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 11), panel); w.position.set(-5, 0, s * 8); g.add(w); }
  return g;
}

/* ---------------- the inside of the ISS (illustration) ---------------- */
const ROOMS = [ // name, box [x0,x1,y0,y1,z0,z1] in metres (x forward, y up, z starboard), wall style, info
  ['Zarya (FGB)', [-14.6, -2.2, -1.15, 1.15, -1.15, 1.15], 'ru', 'First module, launched in 1998: power and storage for the early station.'],
  ['Unity (Node 1)', [-2.2, 2.2, -1.35, 1.35, -1.35, 1.35], 'node', 'Connecting node, 1998. Six hatches join the US and Russian parts.'],
  ['Destiny (US Laboratory)', [2.2, 10.7, -1.05, 1.05, -1.05, 1.05], 'lab', 'Main US science lab, 2001: racks of experiments on all four walls.'],
  ['Harmony (Node 2)', [10.7, 15.9, -1.35, 1.35, -1.35, 1.35], 'node', 'Node with crew sleeping cabins; joins Kibo, Columbus and visiting spacecraft.'],
  ['Kibo (Japanese Experiment Module)', [12.25, 14.35, -1.05, 1.05, 1.35, 12.5], 'lab', 'Japan\'s lab, the largest module on the station.'],
  ['Columbus (European Laboratory)', [12.25, 14.35, -1.05, 1.05, -8.2, -1.35], 'lab', 'Europe\'s science lab, 2008.'],
  ['Tranquility (Node 3)', [-1.25, 1.25, -1.25, 1.25, -8.4, -1.35], 'node', 'Life support, exercise and the toilet – and the way to the Cupola.'],
  ['Cupola', [-1.1, 1.1, -3.05, -1.25, -5.9, -3.7], 'cupola', 'Seven windows looking down on Earth – the best view on the station.'],
];
function rackTex(style, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const base = style === 'ru' ? '#cfd8c0' : style === 'node' ? '#dad8d0' : '#e3e1da'; g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  if (style === 'node') { for (let i = 0; i < 9; i++) { g.fillStyle = ['#cbb994', '#d8c8a2', '#bcae8c', '#e9e4d6'][(r() * 4) | 0]; const x = r() * 420, y = r() * 420, w = 50 + r() * 80, h = 40 + r() * 70; g.fillRect(x, y, w, h); g.strokeStyle = '#7d6f55'; g.lineWidth = 2; g.strokeRect(x, y, w, h); g.fillStyle = '#ffffff'; g.fillRect(x + 6, y + 6, 26, 10); g.strokeStyle = '#3c5fa8'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); } }
  else { for (let col = 0; col < 2; col++) for (let row = 0; row < 4; row++) { const x = col * 256 + 6, y = row * 128 + 6; g.fillStyle = style === 'ru' ? '#c4ceb4' : ['#ececE6', '#d6d4cc', '#c9c7bf', '#f0efe9'][(r() * 4) | 0]; g.fillRect(x, y, 244, 116); g.strokeStyle = '#9a988f'; g.lineWidth = 2; g.strokeRect(x, y, 244, 116);
      const k = r(); if (k < 0.25) { g.fillStyle = '#1a1d22'; g.fillRect(x + 20, y + 18, 110, 70); g.fillStyle = '#2f6fd6'; g.fillRect(x + 26, y + 24, 98, 58); g.fillStyle = '#9fd0ff'; for (let i = 0; i < 5; i++) g.fillRect(x + 32, y + 30 + i * 10, 40 + r() * 40, 4); }
      else if (k < 0.5) { for (let i = 0; i < 10; i++) { g.fillStyle = ['#d33', '#3a3', '#fc3', '#999'][(r() * 4) | 0]; g.beginPath(); g.arc(x + 20 + i * 22, y + 30, 5, 0, 7); g.fill(); } g.fillStyle = '#555'; for (let i = 0; i < 6; i++) g.fillRect(x + 20 + i * 36, y + 60, 24, 34); }
      else if (k < 0.7) { g.fillStyle = '#cbb994'; g.fillRect(x + 10, y + 10, 224, 96); g.strokeStyle = '#3c5fa8'; g.lineWidth = 5; g.beginPath(); g.moveTo(x + 10, y + 58); g.lineTo(x + 234, y + 58); g.stroke(); }
      g.fillStyle = style === 'ru' ? '#2a4a2a' : '#1d2b55'; g.font = '700 15px system-ui'; g.fillText(style === 'ru' ? ['ПИТАНИЕ', 'ЗАПАС', 'БЛОК 4', 'СИСТЕМА'][(r() * 4) | 0] : ['EXPRESS RACK', 'WHC', 'MSG', 'HRF-2', 'CDRA', 'MELFI', 'FIR', 'ER-6', 'WORF'][(r() * 9) | 0], x + 140, y + 104);
      g.fillStyle = '#e0b84a'; g.fillRect(x + 236, y + 8, 6, 100); } }
  // cables
  g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.strokeStyle = ['#222', '#555', '#e8e8e8', '#2f5fae'][i]; g.beginPath(); const y = r() * 512; g.moveTo(0, y); g.bezierCurveTo(170, y + (r() - 0.5) * 160, 340, y + (r() - 0.5) * 160, 512, y + (r() - 0.5) * 60); g.stroke(); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
}
class IssInside {
  constructor(world) {
    this.w = world; const sc = this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(70, 1, 0.03, 60); sc.add(this.cam);
    sc.add(new THREE.AmbientLight(0xffffff, 0.55), new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.5));
    const mats = {}, mat = (style, seed) => mats[style + seed] || (mats[style + seed] = new THREE.MeshStandardMaterial({ map: rackTex(style, seed), roughness: 0.75, side: THREE.DoubleSide }));
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ac, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), glass = new THREE.MeshBasicMaterial({ color: 0x9ec9ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff7e8 }), rail = new THREE.MeshStandardMaterial({ color: 0xd8b24a, metalness: 0.4, roughness: 0.5 });
    const B = this.boxes = ROOMS.map(r => ({ name: r[0], b: r[1], style: r[2], info: r[3] }));
    // which faces touch another room: openings
    const touch = (A, face) => { const [x0, x1, y0, y1, z0, z1] = A.b, ax = face[0], sgn = face[1], v = ax === 'x' ? (sgn > 0 ? x1 : x0) : ax === 'y' ? (sgn > 0 ? y1 : y0) : (sgn > 0 ? z1 : z0);
      return B.filter(o => o !== A).map(o => { const [a0, a1, b0, b1, c0, c1] = o.b, ov = (p0, p1, q0, q1) => Math.min(p1, q1) - Math.max(p0, q0);
        if (ax === 'x' && Math.abs((sgn > 0 ? a0 : a1) - v) < 0.01 && ov(y0, y1, b0, b1) > 0.5 && ov(z0, z1, c0, c1) > 0.5) return [(Math.max(y0, b0) + Math.min(y1, b1)) / 2, (Math.max(z0, c0) + Math.min(z1, c1)) / 2];
        if (ax === 'y' && Math.abs((sgn > 0 ? b0 : b1) - v) < 0.01 && ov(x0, x1, a0, a1) > 0.5 && ov(z0, z1, c0, c1) > 0.5) return [(Math.max(x0, a0) + Math.min(x1, a1)) / 2, (Math.max(z0, c0) + Math.min(z1, c1)) / 2];
        if (ax === 'z' && Math.abs((sgn > 0 ? c0 : c1) - v) < 0.01 && ov(x0, x1, a0, a1) > 0.5 && ov(y0, y1, b0, b1) > 0.5) return [(Math.max(x0, a0) + Math.min(x1, a1)) / 2, (Math.max(y0, b0) + Math.min(y1, b1)) / 2];
        return null; }).find(Boolean); };
    let seed = 7;
    for (const A of B) { const [x0, x1, y0, y1, z0, z1] = A.b, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, L = { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
      for (const ax of ['x', 'y', 'z']) for (const sgn of [-1, 1]) {
        const others = ['x', 'y', 'z'].filter(a => a !== ax), w = L[others[0]], h = L[others[1]], open = touch(A, [ax, sgn]);
        const sh = new THREE.Shape(); sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.lineTo(-w / 2, -h / 2);
        let hole = null; const c = { x: cx, y: cy, z: cz };
        const flip = ax === 'y' ? -1 : 1;
        if (open) { const u = open[0] - c[others[0]], v = (open[1] - c[others[1]]) * flip, hs = 0.53; hole = new THREE.Path(); hole.moveTo(u - hs, v - hs); hole.lineTo(u - hs, v + hs); hole.lineTo(u + hs, v + hs); hole.lineTo(u + hs, v - hs); hole.lineTo(u - hs, v - hs); sh.holes.push(hole); }
        const win = A.style === 'cupola' && (ax !== 'y' || sgn < 0); // the Cupola: windows all round and below
        if (win) { const p = new THREE.Path(), r = ax === 'y' ? 0.42 : Math.min(w, h) * 0.36; if (ax === 'y') p.absarc(0, 0, r, 0, Math.PI * 2, true); else { p.moveTo(-r * 1.1, -r * 0.8); p.lineTo(-r * 1.1, r * 0.8); p.lineTo(r * 1.1, r * 0.8); p.lineTo(r * 1.1, -r * 0.8); p.lineTo(-r * 1.1, -r * 0.8); } sh.holes.push(p);
          const gm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); this.orient(gm, ax, sgn, A.b); gm.position[ax] += -sgn * 0.01; sc.add(gm); }
        const tex = A.style === 'cupola' ? null : mat(A.style === 'lab' && (ax === 'x') ? 'node' : A.style, (seed = (seed * 31 + 7) % 97) % 5 + 1);
        const geo = new THREE.ShapeGeometry(sh); const uv = geo.attributes.uv, P = geo.attributes.position; for (let i = 0; i < P.count; i++) uv.setXY(i, P.getX(i) / 1.9, P.getY(i) / 1.9);
        const m = new THREE.Mesh(geo, tex ? tex : new THREE.MeshStandardMaterial({ color: 0x5b5f66, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide })); this.orient(m, ax, sgn, A.b); sc.add(m);
        if (open) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 4), hatchMat); f.rotation.z = Math.PI / 4; this.orient(f, ax, sgn, A.b); const u = open[0], v = open[1]; f.position[others[0]] = u; f.position[others[1]] = v; f.position[ax] -= sgn * 0.02; sc.add(f); } }
      // lights along the corners, handrails, a lamp
      if (A.style !== 'cupola') { const along = L.x > L.z ? 'x' : 'z'; for (const [s1, s2] of [[1, 1], [-1, 1]]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? L.x * 0.8 : 0.08, 0.05, along === 'z' ? L.z * 0.8 : 0.08), lightMat); lg.position.set(cx + (along === 'z' ? s1 * (L.x / 2 - 0.06) : 0), y1 - 0.04, cz + (along === 'x' ? s1 * (L.z / 2 - 0.06) : 0)); sc.add(lg); }
        const pl = new THREE.PointLight(0xfff4e0, 6, 9, 1.6); pl.position.set(cx, cy + 0.5, cz); sc.add(pl);
        for (let i = 0; i < 3; i++) { const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), rail); hr.rotation.z = along === 'x' ? Math.PI / 2 : 0; hr.rotation.x = along === 'z' ? Math.PI / 2 : 0; hr.position.set(along === 'x' ? x0 + (i + 1) * L.x / 4 : x1 - 0.06, cy - 0.3, along === 'z' ? z0 + (i + 1) * L.z / 4 : z1 - 0.06); sc.add(hr); } }
      else { const pl = new THREE.PointLight(0xffffff, 2, 5, 2); pl.position.set(cx, y1 - 0.2, cz); sc.add(pl); } }
    // a few things floating about
    this.floaters = []; const fm = [new THREE.MeshStandardMaterial({ color: 0xc94b3c }), new THREE.MeshStandardMaterial({ color: 0x2b2f36 }), new THREE.MeshStandardMaterial({ color: 0xe9d9a8 })];
    for (let i = 0; i < 9; i++) { const A = B[(i * 3) % B.length]; if (A.style === 'cupola') continue; const [x0, x1, y0, y1, z0, z1] = A.b, m = new THREE.Mesh(i % 3 === 1 ? new THREE.BoxGeometry(0.28, 0.02, 0.2) : new THREE.BoxGeometry(0.12, 0.18, 0.05), fm[i % 3]);
      m.position.set(x0 + 0.4 + Math.random() * (x1 - x0 - 0.8), y0 + 0.4 + Math.random() * (y1 - y0 - 0.8), z0 + 0.4 + Math.random() * (z1 - z0 - 0.8)); m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04); m.userData.r = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(0.4); m.userData.box = A.b; sc.add(m); this.floaters.push(m); }
    // start in the Cupola, looking down at the Earth
    this.pos = new THREE.Vector3(0, -1.6, -4.8); this.yaw = 0; this.pitch = -1.2; this.vel = new THREE.Vector3(); this.pad = {}; this.keys = {};
    const el = world.renderer.domElement; let last = null;
    this._d = e => { last = [e.clientX, e.clientY]; }; this._m = e => { if (!last || !(e.buttons || e.pointerType === 'touch')) return; this.yaw -= (e.clientX - last[0]) * 0.004; this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - (e.clientY - last[1]) * 0.004)); last = [e.clientX, e.clientY]; }; this._u = () => { last = null; };
    this._k = e => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return; this.keys[e.key.toLowerCase()] = e.type === 'keydown'; };
    el.addEventListener('pointerdown', this._d); addEventListener('pointermove', this._m); addEventListener('pointerup', this._u); addEventListener('keydown', this._k); addEventListener('keyup', this._k);
  }
  // a face drawn in its own plane: local x → first other axis, local y → second (flipped for y faces), local z → the face normal
  orient(m, ax, sgn, b) { const [x0, x1, y0, y1, z0, z1] = b, c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], E = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const o = ['x', 'y', 'z'].filter(a => a !== ax), e1 = E[o[1]].clone().multiplyScalar(ax === 'y' ? -1 : 1); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(E[o[0]], e1, E[ax]));
    if (ax === 'x') m.position.set(sgn > 0 ? x1 : x0, c[1], c[2]); else if (ax === 'y') m.position.set(c[0], sgn > 0 ? y1 : y0, c[2]); else m.position.set(c[0], c[1], sgn > 0 ? z1 : z0); }
  room() { const p = this.pos; return this.boxes.find(A => { const [x0, x1, y0, y1, z0, z1] = A.b; return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1; }); }
  inside(p, m = 0.28) { return this.boxes.some(A => { const [x0, x1, y0, y1, z0, z1] = A.b; return p.x > x0 + m && p.x < x1 - m && p.y > y0 + m && p.y < y1 - m && p.z > z0 + m && p.z < z1 - m; }) || this.boxes.some((A, i) => this.boxes.some((B2, j) => j > i && this.inPortal(p, A.b, B2.b))); }
  inPortal(p, a, b) { // the opening between two touching rooms
    const lo = [Math.max(a[0], b[0]), Math.max(a[2], b[2]), Math.max(a[4], b[4])], hi = [Math.min(a[1], b[1]), Math.min(a[3], b[3]), Math.min(a[5], b[5])], d = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], th = d.findIndex(v => Math.abs(v) < 0.01); if (th < 0) return false;
    const P = [p.x, p.y, p.z]; for (let k = 0; k < 3; k++) { if (k === th) { if (Math.abs(P[k] - lo[k]) > 0.6) return false; } else { const c = (lo[k] + hi[k]) / 2; if (Math.abs(P[k] - c) > 0.53 - 0.12) return false; } } return true; }
  step(dt) {
    const k = this.keys, f = (k.w || k.arrowup || this.pad.f ? 1 : 0) - (k.s || k.arrowdown || this.pad.b ? 1 : 0), sd = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0), u = (k.q || this.pad.u ? 1 : 0) - (k.e || this.pad.d ? 1 : 0);
    const dir = new THREE.Vector3(Math.cos(this.pitch) * Math.cos(this.yaw), Math.sin(this.pitch), -Math.cos(this.pitch) * Math.sin(this.yaw)), right = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const want = dir.multiplyScalar(f).addScaledVector(right, sd).add(new THREE.Vector3(0, u, 0)).multiplyScalar(1.3); this.vel.lerp(want, Math.min(1, dt * 2.5));
    for (const ax of ['x', 'y', 'z']) { const n = this.pos.clone(); n[ax] += this.vel[ax] * dt; if (this.inside(n)) this.pos.copy(n); else this.vel[ax] *= -0.3; }
    this.cam.position.copy(this.pos); this.cam.rotation.set(0, 0, 0); this.cam.lookAt(this.pos.clone().add(new THREE.Vector3(Math.cos(this.pitch) * Math.cos(this.yaw), Math.sin(this.pitch), -Math.cos(this.pitch) * Math.sin(this.yaw))));
    const el = this.w.renderer.domElement, asp = el.clientWidth / Math.max(1, el.clientHeight); if (this.cam.aspect !== asp) { this.cam.aspect = asp; this.cam.updateProjectionMatrix(); }
    for (const m of this.floaters) { m.position.addScaledVector(m.userData.v, dt); m.rotation.x += m.userData.r.x * dt; m.rotation.y += m.userData.r.y * dt; const b = m.userData.box; ['x', 'y', 'z'].forEach((a, i) => { if (m.position[a] < b[i * 2] + 0.2 || m.position[a] > b[i * 2 + 1] - 0.2) m.userData.v[a] *= -1; }); }
  }
  dispose() { const el = this.w.renderer.domElement; el.removeEventListener('pointerdown', this._d); removeEventListener('pointermove', this._m); removeEventListener('pointerup', this._u); removeEventListener('keydown', this._k); removeEventListener('keyup', this._k);
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); }
}
