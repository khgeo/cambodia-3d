// Time of day (sun path, dusk, night with lit windows and stars), weather (clear, hazy, monsoon rain, storm with
// lightning) and a cinematic flight around the area.
import * as THREE from 'three';
import { NIGHT } from './shaders.js?v=109';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
export class Atmos {
  constructor(world) {
    this.w = world; this.hour = 9.5; this.weather = 'clear'; this.flash = 0; this.nextBolt = 4;
    const N = 1600, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const u = Math.random() * 2 - 1, t = Math.random() * 6.283, s = Math.sqrt(1 - u * u); pos.set([s * Math.cos(t), Math.abs(u) * 0.95 + 0.05, s * Math.sin(t)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.randGeo = g; this.stars.renderOrder = -1; this.stars.frustumCulled = false; world.scene.add(this.stars);
    // rain: short streaks in a box that follows the camera
    const R = 7000, rp = new Float32Array(R * 6); this.rainN = R; this.rainBox = 70;
    for (let i = 0; i < R; i++) { const x = (Math.random() - .5) * 140, y = Math.random() * 70, z = (Math.random() - .5) * 140; rp.set([x, y, z, x, y - 0.9, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xc8d4de, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; world.scene.add(this.rain);
    // night dome: a dark blue-black sky with a faint glow at the horizon, drawn over the daylight sky shader
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, uniforms: { op: { value: 0 } },
      vertexShader: 'varying float vy; void main(){ vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vy; uniform float op; void main(){ float h = clamp(vy, 0.0, 1.0); vec3 c = mix(vec3(0.075, 0.095, 0.15), vec3(0.008, 0.014, 0.035), pow(h, 0.45)); gl_FragColor = vec4(c, op); }' }));
    this.dome.frustumCulled = false; this.dome.renderOrder = -2; this.dome.visible = false; world.scene.add(this.dome);
    this.moon = new THREE.DirectionalLight(0x9fb8ff, 0); world.scene.add(this.moon, this.moon.target);
  }
  sunFromHour(h) { // Cambodia ~12°N: sunrise ~6:00, sunset ~18:00, sun high in the south at noon
    const t = (h - 6) / 12, elev = Math.sin(Math.PI * t) * 78 - (t < 0 || t > 1 ? 0 : 0), az = 90 + 180 * clamp(t, 0, 1); // east → south → west
    return { elev: t < 0 || t > 1 ? -12 - 30 * Math.min(Math.abs(t < 0 ? t : t - 1), 1) : elev, az };
  }
  apply(env) {
    const w = this.w, { elev, az } = this.sunFromHour(this.hour), night = clamp((2 - elev) / 10, 0, 1), dusk = clamp(1 - Math.abs(elev - 4) / 10, 0, 1);
    const wx = { clear: { turb: 4, ray: 2.2, sun: 1, fog: 1, exp: 1 }, haze: { turb: 10, ray: 3, sun: 0.75, fog: 0.55, exp: 0.95 }, rain: { turb: 18, ray: 0.6, sun: 0.25, fog: 0.22, exp: 0.85 }, storm: { turb: 20, ray: 0.3, sun: 0.12, fog: 0.15, exp: 0.75 } }[this.weather];
    const u = w.sky.material.uniforms; u.turbidity.value = wx.turb; u.rayleigh.value = lerp(wx.ray, 0.2, night); u.mieCoefficient.value = this.weather === 'clear' ? 0.004 : 0.012;
    w.setSun(Math.max(elev, -6), env, 180 - az);
    w.sun.intensity *= wx.sun * (1 - night); w.hemi.intensity = lerp(w.hemi.intensity * (0.6 + 0.4 * wx.sun), 0.24, night);
    w.hemi.color.set(0xdfeaf5).lerp(new THREE.Color(0x3a4a78), night); w.hemi.groundColor.set(0x5a6640).lerp(new THREE.Color(0x10141c), night);
    this.moon.intensity = 0.55 * night * (this.weather === 'clear' ? 1 : 0.3) * (this.realSky && this.moonK != null ? this.moonK * 1.4 : 1); if (!this.realSky) this.moon.position.set(-0.4, 1, 0.3).multiplyScalar(1000);
    w.renderer.toneMappingExposure = 0.62 * wx.exp * lerp(1, 1.35, night);
    NIGHT.value = clamp(night * 1.2 + dusk * 0.4, 0, 1) * (elev < 10 ? 1 : 0);
    const S = w.extent || 3000; w.scene.fog.near = S * 1.2 * wx.fog * (1 - night * 0.3); w.scene.fog.far = S * 5 * wx.fog;
    w.scene.fog.color.set(this.weather === 'clear' ? 0xc6d2db : 0x9aa4ab).lerp(new THREE.Color(0x0b1020), night).lerp(new THREE.Color(0xe8a070), dusk * 0.25 * (1 - night));
    w.sky.material.uniforms.mieDirectionalG.value = 0.8;
    this.stars.material.opacity = night * (this.weather === 'clear' ? 0.9 : this.weather === 'haze' ? 0.3 : 0);
    this.dome.material.uniforms.op.value = night * (this.weather === 'clear' ? 0.93 : 0.75); this.dome.visible = night > 0.01;
    if (w.cloudDome) { const C = w.cloudDome.userData.U, k = { clear: [0.4, 0, 0.6], haze: [0.22, 0.15, 0.3], rain: [0.92, 0.65, 0], storm: [1, 0.85, 0] }[this.weather] || [0.4, 0, 0.6]; C.uCover.value = k[0]; C.uDark.value = k[1]; C.uCirrus.value = k[2]; C.uNight.value = night; }
    this.rain.visible = this.weather === 'rain' || this.weather === 'storm';
    this.rain.material.opacity = this.weather === 'storm' ? 0.55 : 0.4; this.night = night;
    if (w.lights) w.lights.apply(Math.max(night, this.weather === 'storm' ? 0.5 : this.weather === 'rain' ? 0.35 : 0));
    if (w.reflU) w.reflDim = 1 - night * 0.6;
  }
  step(dt) {
    const w = this.w, cam = w.camera;
    this.stars.position.copy(cam.position); this.stars.scale.setScalar((w.extent || 3000) * 6);
    if (this.dome.visible) { this.dome.position.copy(cam.position); this.dome.scale.setScalar((w.extent || 3000) * 9); }
    if (this.sv && this.realSky) this.sv.frame(this.stars.material.opacity);
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position, a = p.array, B = this.rainBox, sp = (this.weather === 'storm' ? 26 : 18) * dt, wind = (this.weather === 'storm' ? 4 : 1.2) * dt;
      for (let i = 0; i < this.rainN; i++) {
        const k = i * 6; a[k + 1] -= sp; a[k + 4] -= sp; a[k] += wind; a[k + 3] += wind;
        if (a[k + 1] < -5) { const x = (Math.random() - .5) * 2 * B, z = (Math.random() - .5) * 2 * B, y = 60 + Math.random() * 10; a[k] = x; a[k + 1] = y; a[k + 2] = z; a[k + 3] = x - wind * 2; a[k + 4] = y - 0.9; a[k + 5] = z; }
      }
      p.needsUpdate = true; this.rain.position.set(cam.position.x, cam.position.y - 30, cam.position.z);
    }
    if (this.weather === 'storm') { // lightning: a white flash of sky and ground, then darkness
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 3 + Math.random() * 9; }
      if (this.flash > 0) { this.flash -= dt * 3.5; const f = Math.max(0, this.flash) * (Math.random() > 0.3 ? 1 : 0.2); w.hemi.intensity = this.baseHemi + f * 3; } else if (this.baseHemi != null) w.hemi.intensity = this.baseHemi;
    }
    if (this.tour) this.tourStep(dt);
  }
  setHour(h, env) { this.hour = h; this.apply(env); this.baseHemi = this.w.hemi.intensity; if (this.realSky) this.updateRealSky(); }
  // Real night sky (StarChart KH): stars, planets, Moon and constellations over the area at the chosen time
  async useRealSky(on) {
    this.realSky = !!on; this.stars.visible = !on;
    if (!on) { if (this.sv) this.sv.frame(0); return; }
    if (!this.sv) { const { SkyView } = await import('./skyview.js?v=109'); this.sv = new SkyView(this.w); await this.sv.load(); }
    this.updateRealSky();
  }
  // the sky time: an exact date from the Night sky panel, or today at the scene hour (Cambodia time, UTC+7)
  skyDate() { if (this.skyTime) return this.skyTime; const n = new Date(Date.now() + 7 * 36e5); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) + (this.hour - 7) * 36e5); }
  updateRealSky() {
    const F = this.w.F; if (!this.sv || !F) return;
    const sky = this.sv.update(F.lat0, F.lon0, this.skyDate(), this.lang || 'en'), m = sky && sky.body.Moon;
    if (m) { const a = Math.max(m.alt, 2) * Math.PI / 180, z = m.az * Math.PI / 180; this.moon.position.set(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a)).multiplyScalar(1000); this.moonK = m.alt > 0 ? 0.25 + 0.75 * (m.phase ?? 0.5) : 0.15; }
    return sky;
  }
  setWeather(k) { this.weather = k; this.apply(true); this.baseHemi = this.w.hemi.intensity; }
  /* ---- cinematic flight: a smooth closed spline around and across the area ---- */
  startTour() {
    const w = this.w, D = w.D, cx = D.X0 + D.W / 2, cz = D.Z0 + D.H / 2, R = Math.max(D.W, D.H) * 0.5, hc = w.hAt(cx, cz), pts = [], look = [];
    const N = 8; for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, r = R * (i % 2 ? 0.95 : 0.55), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, g = w.hAt(clamp(x, D.X0, D.X0 + D.W), clamp(z, D.Z0, D.Z0 + D.H));
      pts.push(new THREE.Vector3(x, Math.max(g, hc) + R * (i % 3 === 0 ? 0.12 : i % 3 === 1 ? 0.3 : 0.2), z));
      const b = a + 0.9, lx = cx + Math.cos(b) * R * 0.3, lz = cz + Math.sin(b) * R * 0.3; look.push(new THREE.Vector3(lx, w.hAt(lx, lz), lz));
    }
    this.tour = { path: new THREE.CatmullRomCurve3(pts, true, 'centripetal'), look: new THREE.CatmullRomCurve3(look, true, 'centripetal'), t: 0, dur: 75 };
    w.setMode('orbit'); w.controls.enabled = false; w.flight = null;
    const stop = () => this.stopTour(); this._stop = stop; setTimeout(() => { w.renderer.domElement.addEventListener('pointerdown', stop, { once: true }); addEventListener('keydown', stop, { once: true }); }, 300);
  }
  tourStep(dt) {
    const T = this.tour, w = this.w; T.t = (T.t + dt / T.dur) % 1; const p = T.path.getPointAt(T.t), q = T.look.getPointAt(T.t);
    w.camera.position.lerp(p, Math.min(1, dt * 2)); w.controls.target.lerp(q, Math.min(1, dt * 2)); w.camera.lookAt(w.controls.target);
  }
  stopTour() { if (!this.tour) return; this.tour = null; this.w.controls.enabled = true; this.onTourEnd && this.onTourEnd(); }
}
