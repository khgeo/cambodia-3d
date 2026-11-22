// Animated people (walkers, farmers with conical hats) and cattle. Limbs swing in the vertex shader:
// each vertex carries aAnim = (pivotY, pivotZ, phase sign, 0); rotation is about the X axis through the pivot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js?v=96';

function part(g, hex, anim = [0, 0, 0]) {
  g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, c = new THREE.Color(hex), col = new Float32Array(n * 3), an = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); an.set([anim[0], anim[1], anim[2], 0], i * 4); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aAnim', new THREE.BufferAttribute(an, 4)); g.deleteAttribute('uv'); return g;
}
const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const SKIN = 0x9c6b4a, HAIR = 0x15110f;

// returns { cloth: tinted per instance (shirt + sleeves), body: fixed colours }
export function human(kind = 'walker') {
  const cloth = [], body = [], hip = 0.92, sh = 1.42;
  cloth.push(part(B(0.38, 0.52, 0.22, 0, 1.17, 0), 0xffffff));                                  // torso
  for (const s of [-1, 1]) {
    cloth.push(part(B(0.1, 0.32, 0.11, s * 0.24, 1.26, 0), 0xffffff, [sh, 0, -s]));            // upper arm
    body.push(part(B(0.085, 0.3, 0.09, s * 0.25, 0.97, 0.01), SKIN, [sh, 0, -s]));             // forearm
    body.push(part(B(0.14, 0.48, 0.15, s * 0.1, 0.68, 0), kind === 'farmer' ? 0x2e2a26 : 0x2b2f3a, [hip, 0, s])); // thigh
    body.push(part(B(0.12, 0.42, 0.13, s * 0.1, 0.24, 0.0), kind === 'farmer' ? SKIN : 0x2b2f3a, [hip, 0, s]));     // shin
    body.push(part(B(0.12, 0.05, 0.24, s * 0.1, 0.025, 0.04), 0x1c1c1c, [hip, 0, s]));          // sandal
  }
  body.push(part(B(0.4, 0.14, 0.24, 0, 0.9, 0), kind === 'farmer' ? 0x2e2a26 : 0x2b2f3a));     // hips
  body.push(part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6).translate(0, 1.47, 0), SKIN));
  body.push(part(new THREE.SphereGeometry(0.12, 10, 8).scale(1, 1.15, 1.05).translate(0, 1.64, 0.01), SKIN));
  if (kind === 'farmer') {
    body.push(part(new THREE.ConeGeometry(0.36, 0.2, 14).translate(0, 1.82, 0), 0xd9c38e));     // conical hat (duon)
    body.push(part(B(0.28, 0.08, 0.26, 0, 1.47, 0), 0xb0342e));                                  // krama scarf
  } else body.push(part(new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.66, -0.01), HAIR));
  return { cloth: mergeGeometries(cloth), body: mergeGeometries(body) };
}

export function cow() {
  const p = [], c = 0xffffff;
  p.push(part(new THREE.SphereGeometry(0.5, 12, 8).scale(0.85, 0.8, 1.6).translate(0, 1.0, 0), c));
  p.push(part(new THREE.SphereGeometry(0.22, 8, 6).scale(1, 0.8, 1).translate(0, 1.38, -0.1), 0xe8e4dc));           // hump
  for (const [x, z, s] of [[0.24, 0.55, 1], [-0.24, 0.55, -1], [0.24, -0.55, -1], [-0.24, -0.55, 1]])
    p.push(part(new THREE.CylinderGeometry(0.07, 0.055, 0.78, 6).translate(x, 0.39, z), 0xd9d4ca, [0.78, z, s]));
  // head + neck, nodding when grazing (pivot at the shoulder)
  const head = [new THREE.CylinderGeometry(0.15, 0.2, 0.55, 8).rotateX(-0.9).translate(0, 1.1, 0.85), new THREE.SphereGeometry(0.17, 8, 6).scale(0.9, 0.9, 1.5).translate(0, 0.98, 1.12),
    new THREE.ConeGeometry(0.04, 0.16, 5).rotateZ(0.6).translate(0.12, 1.16, 1.0), new THREE.ConeGeometry(0.04, 0.16, 5).rotateZ(-0.6).translate(-0.12, 1.16, 1.0)];
  head.forEach((g, i) => p.push(part(g, i > 1 ? 0x3b342c : 0xeeeae2, [1.2, 0.7, 0.5])));
  p.push(part(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 4).rotateX(0.3).translate(0, 0.9, -0.85), 0x8a8478));         // tail
  return mergeGeometries(p);
}

// phased = the swing follows each walker's own distance travelled (attribute aPhase), so feet never slide
export function animMaterial(uTime, amp, speed, tinted, phased) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime; sh.uniforms.uAmp = { value: amp }; sh.uniforms.uSpeed = { value: speed };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aAnim; uniform float uTime, uAmp, uSpeed;' + (phased ? '\nattribute float aPhase;' : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (abs(aAnim.z) > 0.001) {
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float a = sin(${phased ? 'aPhase' : 'uTime * uSpeed + ph'}) * uAmp * aAnim.z;
  float c = cos(a), s = sin(a);
  vec3 q = transformed - vec3(0.0, aAnim.x, aAnim.y);
  transformed = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c) + vec3(0.0, aAnim.x, aAnim.y);
}`);
  };
  m.customProgramCacheKey = () => 'anim-' + amp + '-' + speed + (phased ? '-ph' : '');
  return m;
}

export const SHIRTS = [0xffffff, 0xe8e2d0, 0x3b5f9a, 0xb3261e, 0x2f7d4a, 0xd9b22a, 0x6a3d8f, 0x1c1e22, 0xd96c8a, 0x7aa0c8, 0x9a8f80];
