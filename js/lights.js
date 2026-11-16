// Night lights: street lamps along main and town roads with warm pools of light, and vehicle headlights /
// tail lights with a light beam on the road. Everything is additive glow, so it costs no real lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t;
}
const add = (color, tex, op = 1) => new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

export class NightLights {
  constructor(world) { this.w = world; this.group = new THREE.Group(); this.tex = glowTex(); this.level = 0; }
  build() {
    const w = this.w, g = this.group; g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); if (!w.net) return;
    w.root.add(g);
    // lamps every ~35 m, alternating sides, on main roads and town streets
    const lamps = [], cap = w.mobile ? 250 : 600;
    for (const r of w.net.roads) {
      if (r.user ? false : !(r.cls <= 8 || (r.urban && r.cls <= 12))) continue;
      const P = r.pts, L = P[P.length - 1].s; let side = 1;
      for (let s = 12; s < L && lamps.length < cap; s += 35) {
        let k = 0; while (k < P.length - 2 && P[k + 1].s < s) k++; const a = P[k], b = P[k + 1], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        const off = r.hw + 0.8; lamps.push({ x: a.x - tz / l * off * side, z: a.z + tx / l * off * side, nx: tz / l * side, nz: -tx / l * side }); side = -side;
      }
    }
    const n = lamps.length; this.nLamps = n; if (!n) return;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 7, 6).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.4 }), n);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 7, 0.65), pole.material, n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.12, 0.55).translate(0, 6.95, 1.3), new THREE.MeshStandardMaterial({ color: 0x3a3f44, emissive: 0xffc070, emissiveIntensity: 0 }), n);
    const bulb = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2).translate(0, 6.85, 1.3), add(0xffd59a, this.tex, 0), n);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2).translate(0, 0.25, 1.6), add(0xffb35c, this.tex, 0), n);
    const d = new THREE.Object3D();
    lamps.forEach((p, i) => { d.position.set(p.x, w.hAt(p.x, p.z), p.z); d.rotation.set(0, Math.atan2(p.nx, p.nz), 0); d.updateMatrix(); for (const m of [pole, arm, head, bulb, pool]) m.setMatrixAt(i, d.matrix); });
    for (const m of [pole, arm, head]) m.castShadow = true;
    bulb.renderOrder = pool.renderOrder = 7; this.lampMats = { head: head.material, bulb: bulb.material, pool: pool.material };
    g.add(pole, arm, head, bulb, pool);
    // headlights (beam on the road + two glows) and tail lights for every vehicle
    const N = (w.vehicles || []).length + 1; this.nVeh = N;
    this.beam = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.5, 14).rotateX(-Math.PI / 2).translate(0, 0.3, 8), add(0xfff2d0, this.tex, 0), N);
    const hg = new THREE.PlaneGeometry(0.55, 0.55), front = [], rear = [];
    for (const sx of [-0.62, 0.62]) { front.push(hg.clone().translate(sx, 0.75, 0)); rear.push(hg.clone().rotateY(Math.PI).translate(sx, 0.85, 0)); }
    const merge = gs => mergeGeometries(gs);
    this.heads = new THREE.InstancedMesh(merge(front), add(0xffffff, this.tex, 0), N); this.tails = new THREE.InstancedMesh(merge(rear), add(0xff2a1a, this.tex, 0), N);
    for (const m of [this.beam, this.heads, this.tails]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.renderOrder = 8; g.add(m); }
    this.d = new THREE.Object3D(); this.apply(this.level);
  }
  apply(night) {
    this.level = night; if (!this.lampMats) return; const k = THREE.MathUtils.smoothstep(night, 0.25, 0.8);
    this.lampMats.head.emissiveIntensity = 2.2 * k; this.lampMats.bulb.opacity = 0.95 * k; this.lampMats.pool.opacity = 0.55 * k;
    for (const m of [this.beam, this.heads, this.tails]) if (m) { m.material.opacity = (m === this.beam ? 0.32 : 0.9) * k; m.visible = k > 0.01; }
  }
  step() {
    if (!this.heads || !this.heads.visible) return;
    const w = this.w, d = this.d, list = (w.trafficOn === false ? [] : w.vehicles || []).slice(); let i = 0;
    if (w.driver && w.mode === 'drive') list.push({ pos: w.driver.pos, fwd: w.driver.fwd, len: w.kit[w.driver.kind].len });
    for (const v of list) {
      if (i >= this.nVeh) break; const L = (v.len || 4) / 2, fx = v.fwd.x, fz = v.fwd.z, n = Math.hypot(fx, fz) || 1;
      d.position.set(v.pos.x + fx / n * L, v.pos.y, v.pos.z + fz / n * L); d.rotation.set(0, Math.atan2(fx, fz), 0); d.scale.set(v.t && v.t.startsWith('moto') ? 0.5 : 1, 1, 1); d.updateMatrix();
      this.beam.setMatrixAt(i, d.matrix); this.heads.setMatrixAt(i, d.matrix);
      d.position.set(v.pos.x - fx / n * L, v.pos.y, v.pos.z - fz / n * L); d.updateMatrix(); this.tails.setMatrixAt(i, d.matrix); i++;
    }
    for (const m of [this.beam, this.heads, this.tails]) { m.count = i; m.instanceMatrix.needsUpdate = true; }
  }
}
