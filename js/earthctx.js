// The real Earth around the 3D area: the area sits at its true place, with satellite imagery of the land
// around it out to the horizon and the whole curved planet when you zoom far out. Rings of Esri imagery
// (a 900 km base, then Esri tiles z9–18 picked by distance from the camera, like a map app) and a NASA Blue Marble globe are built in the area's own metric frame
// (east-north-up at the area's centre), so the Earth's curvature and horizon are real.
// They are drawn first, without depth, so the 3D area and everything in it always sit on top.
// Turn it off to see the area alone, as a block.
import * as THREE from 'three';

const R = 6371008, D2R = Math.PI / 180;
const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const BLUE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&FORMAT=image/jpeg&WIDTH=4096&HEIGHT=2048&LAYERS=BlueMarble_ShadedRelief_Bathymetry';
const img = u => new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = u; });
const tx = (lon, z) => (lon + 180) / 360 * 2 ** z, ty = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
const lonOf = (x, z) => x / 2 ** z * 360 - 180, latOf = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / D2R;

export class EarthContext {
  constructor(w) {
    this.w = w; this.on = true; this.group = new THREE.Group(); this.group.visible = false; w.scene.add(this.group);
    this.U = { uLight: { value: 1 }, uHaze: { value: new THREE.Color(0xb9cde0) }, uCam: { value: new THREE.Vector3() }, uHz: { value: 6e4 } };
  }
  mat(map, order) {
    const m = new THREE.ShaderMaterial({ uniforms: { ...this.U, map: { value: map } }, depthTest: false, depthWrite: false, fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = min(gl_Position.z, gl_Position.w * 0.999999); }`,
      fragmentShader: `uniform sampler2D map; uniform float uLight; uniform vec3 uHaze; uniform vec3 uCam; uniform float uHz; varying vec2 vUv; varying vec3 vW;
        void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.5) discard; float d = length(vW - uCam); float h = 1.0 - exp(-d / uHz);
          vec3 col = mix(c.rgb * uLight, uHaze * max(uLight, 0.08), h * 0.85); gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    m.toneMapped = true; return m;
  }
  // local metres for a point at (lat, lon) on the sphere, height h above it
  frame(lat0, lon0, y0) {
    const ecef = (la, lo, h = 0) => { const c = Math.cos(la * D2R), r = R + h; return [r * c * Math.cos(lo * D2R), r * c * Math.sin(lo * D2R), r * Math.sin(la * D2R)]; };
    const O = ecef(lat0, lon0), sl = Math.sin(lat0 * D2R), cl = Math.cos(lat0 * D2R), so = Math.sin(lon0 * D2R), co = Math.cos(lon0 * D2R);
    return (la, lo) => { const p = ecef(la, lo), d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]];
      const e = -so * d[0] + co * d[1], n = -sl * co * d[0] - sl * so * d[1] + cl * d[2], u = cl * co * d[0] + cl * so * d[1] + sl * d[2]; return [e, u + y0, -n]; };
  }
  build() {
    const w = this.w, F = w.F, D = w.D; if (!F || !D) return;
    // the ground level at the edge of the area, so the land around meets it
    const hs = []; for (let k = 0; k <= 40; k++) { const f = k / 40; for (const [x, z] of [[D.X0 + D.W * f, D.Z0], [D.X0 + D.W * f, D.Z0 + D.H], [D.X0, D.Z0 + D.H * f], [D.X0 + D.W, D.Z0 + D.H * f]]) hs.push(w.hAt(x, z)); }
    hs.sort((a, b) => a - b); const y0 = hs[Math.floor(hs.length * 0.3)] - 0.6, key = `${F.lat0},${F.lon0},${F.W},${F.H}`; this.y0 = y0;
    if (key === this.key && this.group.children.length) { this.group.position.y = y0 - this.yB; this.apply(); return; }
    this.clear(); this.key = key; this.yB = y0; this.group.position.y = 0; const P = this.frame(F.lat0, F.lon0, y0);
    // whole planet (Blue Marble), equirectangular
    { const NX = 180, NY = 90, pos = [], uv = [], idx = [];
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const lo = -180 + 360 * i / NX, la = 90 - 180 * j / NY; pos.push(...P(la, lo)); uv.push(i / NX, 1 - j / NY); }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + NX + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const c = document.createElement('canvas'); c.width = c.height = 2; const ctx = c.getContext('2d'); ctx.fillStyle = '#1d3b5a'; ctx.fillRect(0, 0, 2, 2); const t0 = new THREE.CanvasTexture(c);
      const m = new THREE.Mesh(g, this.mat(t0)); m.material.side = THREE.FrontSide; m.renderOrder = -9; m.frustumCulled = false; this.group.add(m); this.globe = m;
      img(BLUE).then(i => { const t = new THREE.Texture(i); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; m.material.uniforms.map.value = t; }).catch(() => { }); }
    // imagery rings around the area, finer near it
    this.ring(F, P, 900e3, 8, -8.95); // a base of the region; sharp tiles come and go with the camera (see tiles())
    this.P = P; this.T = new Map(); this.tick = 0;
    this.apply();
  }
  ring(F, P, size, z, order) {
    const dLat = size / 2 / 110574, dLon = size / 2 / (111320 * Math.cos(F.lat0 * D2R)), s = F.lat0 - dLat, n = F.lat0 + dLat, wl = F.lon0 - dLon, el = F.lon0 + dLon;
    const x0 = Math.floor(tx(wl, z)), x1 = Math.floor(tx(el, z)), y0 = Math.floor(ty(n, z)), y1 = Math.floor(ty(s, z)), nx = x1 - x0 + 1, ny = y1 - y0 + 1;
    const c = document.createElement('canvas'); c.width = nx * 256; c.height = ny * 256; const g = c.getContext('2d'); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    let pending = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { pending++; img(ESRI(z, x, y)).then(i => { g.drawImage(i, (x - x0) * 256, (y - y0) * 256); t.needsUpdate = true; }).catch(() => { }).finally(() => { if (--pending === 0) t.needsUpdate = true; }); }
    // a curved grid over the tiles' extent, cut to the square, uv in the mosaic
    const N = 64, pos = [], uv = [], idx = [], LO0 = lonOf(x0, z), LO1 = lonOf(x1 + 1, z);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const lo = wl + (el - wl) * i / N, la = n - (n - s) * j / N; pos.push(...P(la, lo)); uv.push((lo - LO0) / (LO1 - LO0), 1 - (ty(la, z) - y0) / ny); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, this.mat(t)); m.renderOrder = order; m.frustumCulled = false; this.group.add(m);
    // soften the square edge into the ring below it
    m.material.fragmentShader = m.material.fragmentShader.replace('if (c.a < 0.5) discard;', 'if (c.a < 0.5) discard; vec2 q = abs(vUv2 - 0.5) * 2.0; if (max(q.x, q.y) > 1.0 - 0.06 * hash(gl_FragCoord.xy)) discard;')
      .replace('varying vec2 vUv;', 'varying vec2 vUv; varying vec2 vUv2; float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }');
    m.material.vertexShader = m.material.vertexShader.replace('varying vec2 vUv;', 'attribute vec2 aEdge; varying vec2 vUv; varying vec2 vUv2;').replace('vUv = uv;', 'vUv = uv; vUv2 = aEdge;');
    const u2 = []; for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) u2.push(i / N, j / N); geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(u2, 2));
  }
  clear() { if (this.T) this.T.clear(); for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); const t = m.material.uniforms.map.value; t && t.dispose && t.dispose(); m.material.dispose(); } this.globe = null; }
  /* ---------- sharp imagery near the camera: Esri tiles z9–18 chosen by distance, finer drawn over coarser ---------- */
  tileMesh(z, x, y) {
    const P = this.P, N = z < 12 ? 16 : 8, lo0 = lonOf(x, z), lo1 = lonOf(x + 1, z), la0 = latOf(y, z), la1 = latOf(y + 1, z), pos = [], uv = [], idx = [];
    for (let j = 0; j <= N; j++) { const yy = y + j / N, la = latOf(yy, z); for (let i = 0; i <= N; i++) { pos.push(...P(la, lo0 + (lo1 - lo0) * i / N)); uv.push(i / N, 1 - j / N); } }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
    const m = new THREE.Mesh(g, this.mat(t)); m.renderOrder = -8.9 + z * 0.02; m.frustumCulled = false; m.visible = false;
    const c = [(lo0 + lo1) / 2, (la0 + la1) / 2], ctr = P(c[1], c[0]);
    return { m, t, z, ready: false, busy: false, used: 0, ctr: new THREE.Vector3(...ctr), half: 40075016 * Math.cos(c[1] * D2R) / 2 ** z * 0.72, x, y, P0: P(la0, lo0), P1: P(la1, lo1) };
  }
  tiles(cam) {
    const w = this.w, D = w.D, F = w.F, now = ++this.tick, want = [], pos = cam.position, maxZ = 18;
    const inside = T => D && Math.min(T.P0[0], T.P1[0]) > D.X0 + 3 && Math.max(T.P0[0], T.P1[0]) < D.X0 + D.W - 3 && Math.min(T.P0[2], T.P1[2]) > D.Z0 + 3 && Math.max(T.P0[2], T.P1[2]) < D.Z0 + D.H - 3;
    const get = (z, x, y) => { const k = z + '/' + x + '/' + y; let T = this.T.get(k); if (!T) { T = this.tileMesh(z, x, y); this.T.set(k, T); this.group.add(T.m); } return T; };
    const walk = (z, x, y) => { const T = get(z, x, y); T.used = now; if (z > 12 && inside(T)) return;
      const d = Math.max(1, T.ctr.distanceTo(pos) - T.half), size = T.half / 0.72;
      if (z < maxZ && size / d > 0.62 && want.length < 520) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(z + 1, 2 * x + dx, 2 * y + dy); }
      else want.push(T); };
    // roots: z9 tiles over ±300 km of the area
    const z0 = 9, dLat = 300e3 / 110574, dLon = 300e3 / (111320 * Math.cos(F.lat0 * D2R));
    const roots = []; for (let y = Math.floor(ty(F.lat0 + dLat, z0)); y <= Math.floor(ty(F.lat0 - dLat, z0)); y++) for (let x = Math.floor(tx(F.lon0 - dLon, z0)); x <= Math.floor(tx(F.lon0 + dLon, z0)); x++) roots.push(get(z0, x, y));
    roots.sort((a, b) => a.ctr.distanceTo(pos) - b.ctr.distanceTo(pos)); for (const T of roots) walk(z0, T.x, T.y); // nearest first, so the detail budget goes where you look
    // show what is wanted; where a tile is still loading, its nearest loaded ancestor fills in
    for (const T of this.T.values()) T.m.visible = false;
    const queue = [];
    for (const T of want) { if (T.ready) { T.m.visible = true; continue; } queue.push(T); let z = T.z, x = T.x, y = T.y; while (z > z0) { z--; x >>= 1; y >>= 1; const A = this.T.get(z + '/' + x + '/' + y); if (!A) break; A.used = now; if (A.ready) { A.m.visible = true; break; } if (z <= T.z - 2 && !queue.includes(A)) queue.push(A); } }
    // load nearest first, a few at a time
    queue.sort((a, b) => (Math.min(a.z, 10) - Math.min(b.z, 10)) * 1e9 + a.ctr.distanceTo(pos) - b.ctr.distanceTo(pos)); // coarse first so there is never a hole, then nearest
    this.loading = this.loading || 0;
    for (const T of queue) { if (this.loading >= 12) break; if (T.busy || T.failed) continue; T.busy = true; this.loading++;
      img(ESRI(T.z, T.x, T.y)).then(i => { T.t.image = i; T.t.needsUpdate = true; T.ready = true; }).catch(() => { T.failed = true; }).finally(() => { T.busy = false; this.loading--; }); }
    // forget tiles not used for a while
    if (this.T.size > 500) for (const [k, T] of this.T) { if (now - T.used > 40 && !T.busy && T.z > z0) { this.group.remove(T.m); T.m.geometry.dispose(); T.t.dispose(); T.m.material.dispose(); this.T.delete(k); } }
  }
  setOn(on) { this.on = on; this.apply(); }
  apply() { const w = this.w, show = this.on && !!this.group.children.length && !(w.layers && w.layers.t > 0.01);
    this.group.visible = show; (w.sideWalls || []).forEach(m => m.visible = !show); if (w.basePlate) w.basePlate.visible = !show; if (w.sidesMesh) w.sidesMesh.visible = !show && !(w.sideWalls && w.sideWalls.length);
    if (w.extent) w.controls.maxDistance = show ? 2.5e6 : w.extent * 3; }
  // every frame: light and haze, sky and fog for the camera's height, far plane
  step() {
    const w = this.w, cam = w.camera, S = w.extent || 2000; this.apply(); if (!this.group.visible) { this.restore(); return; }
    this.fn = (this.fn || 0) + 1; if (this.P && (this.fn % 6 === 1 || !this.T.size)) this.tiles(cam);
    const alt = Math.max(1, cam.position.y - this.y0), sunY = w.sunDir ? w.sunDir.y : 1;
    this.U.uLight.value = THREE.MathUtils.clamp(0.25 + sunY * 1.6, 0.12, 1.05); this.U.uCam.value.copy(cam.position); this.U.uHz.value = 4e4 + alt * 9;
    const space = alt > 9e4; if (w.sky) w.sky.visible = !space; if (w.cloudDome) w.cloudDome.visible = alt < 6000;
    if (space) { if (!this.bg0) this.bg0 = w.scene.background; w.scene.background = new THREE.Color(0x02040a).lerp(new THREE.Color(0x0b1a33), THREE.MathUtils.clamp(1 - (alt - 9e4) / 4e5, 0, 1)); } else if (this.bg0 !== undefined) { w.scene.background = this.bg0; this.bg0 = undefined; }
    const d = cam.position.distanceTo(w.controls.target), fog = w.scene.fog;
    if (d > S * 2.5) { if (!this.fog0) this.fog0 = { near: fog.near, far: fog.far, cf: cam.far, cn: cam.near }; fog.near = d * 1.2; fog.far = d * 6; cam.far = Math.max(this.fog0.cf, d * 4); cam.near = Math.max(this.fog0.cn, d * 2e-4); cam.updateProjectionMatrix(); }
    else this.restore();
  }
  restore() { const w = this.w; if (this.fog0) { w.scene.fog.near = this.fog0.near; w.scene.fog.far = this.fog0.far; w.camera.far = this.fog0.cf; w.camera.near = this.fog0.cn; w.camera.updateProjectionMatrix(); this.fog0 = null; }
    if (this.bg0 !== undefined) { w.scene.background = this.bg0; this.bg0 = undefined; } if (w.sky && !w.sky.visible && !this.group.visible) w.sky.visible = true; }
}
