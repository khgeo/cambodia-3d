// Real 3D models of landmarks, put in place when the 3D area covers them. Each model is fitted to its real size
// (footprint and tallest point) and turned to its real heading; the generated buildings, trees and fields under it
// are cleared so it stands on its own.
//   Angkor Wat – photogrammetry by FUD-UJEP, CC BY 4.0 (sketchfab.com/3d-models/angkor-wat-be70b89f9c264fc19d63dca2ae78b224)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const LANDMARKS = [
  { id: 'angkor-wat', name: 'Angkor Wat', km: 'អង្គរវត្ត', url: 'models/landmarks/angkor_wat.glb',
    lat: 13.41245, lon: 103.8668, ew: 187, ns: 215, yaw: Math.PI, // the model's west faces +X: turn it round so west is west
    credit: '"Angkor Wat" by FUD-UJEP (CC BY 4.0)' },
];

export function landmarksIn(F, D) {
  return LANDMARKS.map(L => ({ L, x: F.x(L.lon), z: F.z(L.lat) })).filter(({ x, z, L }) => x + L.ew / 2 > D.X0 && x - L.ew / 2 < D.X0 + D.W && z + L.ns / 2 > D.Z0 && z - L.ns / 2 < D.Z0 + D.H);
}

// clear what the generator would put inside the footprint: buildings, trees, fields, grass
export function clearFootprints(D, list) {
  if (!list.length) return; const inside = (x, z) => list.some(({ x: cx, z: cz, L }) => Math.abs(x - cx) < L.ew / 2 + 6 && Math.abs(z - cz) < L.ns / 2 + 6);
  if (D.buildings) D.buildings = D.buildings.filter(b => { const r = b.ring || b.pts || []; if (!r.length) return true; let sx = 0, sz = 0; for (const p of r) { sx += p[0] ?? p.x; sz += p[1] ?? p.z; } return !inside(sx / r.length, sz / r.length); });
  const { mw, mh, MR, X0, Z0, exclude } = D; if (!exclude) return;
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) if (inside(X0 + (i + 0.5) * MR, Z0 + (j + 0.5) * MR)) exclude[j * mw + i] = 1;
}

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
export async function placeLandmarks(world, list) {
  const out = [];
  for (const { L, x, z } of list) {
    try {
      const g = await loader.loadAsync(L.url), m = g.scene; m.updateMatrixWorld(true);
      // robust extent: photogrammetry has stray triangles far out, so take the 1st–99th percentile of the vertices
      const X = [], Y = [], Z = [], v = new THREE.Vector3(); m.traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position, st = Math.max(1, Math.floor(P.count / 40000)); for (let i = 0; i < P.count; i += st) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); X.push(v.x); Y.push(v.y); Z.push(v.z); } });
      const pc = (A, q) => { A.sort((a, b) => a - b); return A[Math.min(A.length - 1, Math.floor(A.length * q))]; };
      const bb = new THREE.Box3(new THREE.Vector3(pc(X, 0.01), pc(Y, 0.0), pc(Z, 0.01)), new THREE.Vector3(pc(X, 0.99), pc(Y, 0.999), pc(Z, 0.99))), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      // the model's own ground: cast down onto the courtyard just inside a corner
      const rc = new THREE.Raycaster(), hits = []; for (const [fx, fz] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94], [0.5, 0.08], [0.5, 0.92]]) { rc.set(new THREE.Vector3(bb.min.x + sz.x * fx, bb.max.y + 5, bb.min.z + sz.z * fz), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObject(m, true)[0]; if (h) hits.push(h.point.y); }
      hits.sort((a, b) => a - b); const ground = hits.length ? hits[Math.floor(hits.length / 2)] : bb.min.y;
      // drop the photogrammetry skirt: stray triangles outside the footprint, and the slab hanging below the ground
      { const ex = 0.03 * Math.max(sz.x, sz.z), w = new THREE.Vector3(); m.traverse(o => { if (!o.isMesh || !o.geometry.index) return; const P = o.geometry.attributes.position, I = o.geometry.index.array, keep = [];
          const bad = i => { w.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); return w.x < bb.min.x - ex || w.x > bb.max.x + ex || w.z < bb.min.z - ex || w.z > bb.max.z + ex ? 2 : w.y < ground - 1.2 ? 1 : 0; };
          for (let t = 0; t < I.length; t += 3) { const a = bad(I[t]), b = bad(I[t + 1]), c2 = bad(I[t + 2]); if (a === 2 || b === 2 || c2 === 2 || (a && b && c2)) continue; keep.push(I[t], I[t + 1], I[t + 2]); }
          o.geometry.setIndex(keep); }); }
      const across = Math.max(sz.x, sz.z), sh = L.ew / across, sv = sh * (L.vscale || 1); // fit the footprint; keep the model's own proportions (no stretching up)
      const inner = new THREE.Group(); inner.add(m); m.position.set(-c.x, -ground, -c.z);
      const holder = new THREE.Group(); holder.add(inner); inner.scale.set(sh, sv, sh); holder.rotation.y = L.yaw || 0;
      holder.position.set(x, world.groundAt(x, z) - 0.15, z); holder.name = 'landmark:' + L.id;
      m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material.side = THREE.FrontSide; o.material.toneMapped = false; } } }); // photogrammetry is already lit and shaded: show its colours as they are
      world.root.add(holder); out.push({ L, obj: holder });
    } catch (e) { console.warn('landmark', L.id, e); }
  }
  return out;
}
