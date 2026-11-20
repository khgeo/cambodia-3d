// Ten real car models ("Generic passenger car pack" by Comrade1280, CC BY 4.0, sketchfab.com) for the traffic.
// Each car's body, glass, lights and wheels are merged into one geometry per material, moved to the car's own frame
// (centre at 0, wheels on the ground, front towards +Z) and drawn as instances. The body paint is recoloured per
// car in the shader: painted (coloured) texels take the instance colour, chrome, rubber and black trim stay as they are.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const URL = 'models/cars/generic_car_pack.glb';
// front of each model: +1 if the car's front already points the way of its long axis, -1 to turn it round
const FLIP = { Compact: 1, Coupe: 1, Hatchback: 1, minivan: 1, Offroad: 1, Pickup: 1, Sedan: 1, Sport: 1, SUV: 1, Wagon: 1 };
export const CAR_CREDIT = '"Generic passenger car pack" by Comrade1280 (CC BY 4.0)';
let promise = null;
export function loadCarPack() { return promise || (promise = build().catch(e => { console.warn('car pack', e); return null; })); }

function paintMaterial(src) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.32, metalness: 0.45 });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
    #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
      // strongly coloured texels are the paint: they take this car's colour with their own shading; chrome, black trim stay
      vec3 tx = diffuseColor.rgb; float mx = max(tx.r, max(tx.g, tx.b)), mn = min(tx.r, min(tx.g, tx.b)), s = (mx - mn) / (mx + 0.001);
      diffuseColor.rgb = mix(tx, vColor * (0.18 + 1.25 * mx), smoothstep(0.25, 0.45, s) * step(0.1, mx));
    #endif`); };
  m.customProgramCacheKey = () => 'carpaint'; return m;
}
async function build() {
  const g = await new GLTFLoader().loadAsync(URL), sc = g.scene; sc.updateMatrixWorld(true);
  const bodies = [], wheels = []; sc.traverse(o => { if (!o.isMesh && /[\s_]body$/i.test(o.name)) bodies.push(o); if (!o.isMesh && /^Wheel_/i.test(o.name)) wheels.push(o); });
  const box = o => new THREE.Box3().setFromObject(o), out = {};
  for (const B of bodies) {
    const name = B.name.replace(/[\s_]*body$/i, ''), bb0 = box(B), c0 = bb0.getCenter(new THREE.Vector3());
    // the cars stand at angles in the pack: undo the body's own heading (yaw only), then measure
    const q = B.getWorldQuaternion(new THREE.Quaternion()), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q), side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const ax = Math.abs(fwd.y) < 0.7 ? fwd : side, yaw0 = Math.atan2(ax.x, ax.z), R0 = new THREE.Matrix4().makeRotationY(-yaw0).multiply(new THREE.Matrix4().makeTranslation(-c0.x, 0, -c0.z));
    const bbox = o => { const b = new THREE.Box3(); o.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(R0, m.matrixWorld))); } }); return b; };
    const bb = bbox(B), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const ws = wheels.filter(w => { const p = bbox(w).getCenter(new THREE.Vector3()); return p.x > bb.min.x - 0.2 && p.x < bb.max.x + 0.2 && p.z > bb.min.z - 0.2 && p.z < bb.max.z + 0.2 && Math.abs(p.y - c.y) < 2; });
    let minY = bb.min.y; for (const w of ws) minY = Math.min(minY, bbox(w).min.y);
    // long axis → Z; which end is the front (FLIP); then centre, wheels on the ground
    const alongX = sz.x > sz.z, yaw = (alongX ? Math.PI / 2 : 0) + (FLIP[name] < 0 ? Math.PI : 0);
    const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeTranslation(-c.x, -minY, -c.z)).multiply(R0);
    const byMat = new Map(); const add = o => o.traverse(m => { if (!m.isMesh) return; const k = m.material.uuid; if (!byMat.has(k)) byMat.set(k, { mat: m.material, gs: [] });
      const geo = m.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(M, m.matrixWorld)); for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a); if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2)); byMat.get(k).gs.push(geo); });
    add(B); ws.forEach(add);
    const parts = []; for (const { mat, gs } of byMat.values()) { const geo = mergeGeometries(gs.map(x => x.index ? x.toNonIndexed() : x)); if (!geo) continue; const nm = mat.name || '';
      const paint = /^Body/i.test(nm) && !ws.some(w => w.getObjectByProperty('material', mat) && !B.getObjectByProperty('material', mat));
      let m; if (paint) m = paintMaterial(mat); else if (/^Glass/i.test(nm)) m = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.82 });
      else m = new THREE.MeshStandardMaterial({ map: mat.map, roughness: /^Whee/i.test(nm) ? 0.8 : 0.35, metalness: /^Optic/i.test(nm) ? 0.4 : 0.1 });
      parts.push({ geo, mat: m, paint }); }
    const len = alongX ? sz.x : sz.z; out[name] = { parts, len, width: alongX ? sz.z : sz.x, height: sz.y };
  }
  return out;
}
