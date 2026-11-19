// Land owners for the field boundaries: who owns each lot, where the owner lives (house), and the links between an
// owner's house and all of their lots, drawn as arcs in 3D. Saved in this browser per area (nothing leaves the
// computer unless exported), and exported with the fields to GeoPackage / CSV / report.
import * as THREE from 'three';

export const LAND_USE = ['Wet-season rice', 'Dry-season rice', 'Rice, two seasons', 'Cassava', 'Vegetables', 'Fruit trees / orchard', 'Cashew', 'Fallow', 'Pond', 'Other'];
const key = aoi => 'cambodia3d.fields.' + [aoi.w, aoi.s, aoi.e, aoi.n].map(v => v.toFixed(4)).join(',');
export function save(aoi, fields, owners) { try { localStorage.setItem(key(aoi), JSON.stringify({ date: new Date().toISOString(), fields, owners })); return true; } catch (e) { console.warn('save', e); return false; } }
export function load(aoi) { try { const s = localStorage.getItem(key(aoi)); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
export function forget(aoi) { try { localStorage.removeItem(key(aoi)); } catch (e) { } }
export const centroid = f => { const r = f.ring; return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; };
export function newOwner(owners, o) { const id = (owners.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1; const ow = { id, name: o.name || '', village: o.village || '', phone: o.phone || '', note: o.note || '', house: null }; owners.push(ow); return ow; }
export function lotsOf(fields, id) { return fields.map((f, i) => [f, i]).filter(([f]) => f.owner_id === id); }

// a text label as a sprite (names in Khmer or English)
function label(text, color = '#ffffff') {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 44; g.font = `700 ${fs}px "Noto Sans Khmer", system-ui`; const w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = fs + 30;
  g.font = `700 ${fs}px "Noto Sans Khmer", system-ui`; g.fillStyle = 'rgba(17,23,31,.82)'; g.beginPath(); g.roundRect(0, 0, w, c.height, 18); g.fill(); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 18, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 70; s.userData.aspect = w / c.height; return s;
}
// house markers for every owner with a house; arcs from the selected owner's house to each of their lots
export function show3D(world, fields, owners, selOwner) {
  hide3D(world); const grp = new THREE.Group(), F = world.F, G = (lo, la) => { const x = F.x(lo), z = F.z(la); return [x, world.groundAt(x, z), z]; }, dist = world.camera.position.distanceTo(world.controls.target), sz = Math.max(6, dist / 40);
  for (const o of owners) { if (!o.house) continue; const [x, y, z] = G(...o.house), on = o.id === selOwner;
    const pin = new THREE.Mesh(new THREE.ConeGeometry(sz * 0.18, sz * 0.6, 4), new THREE.MeshBasicMaterial({ color: on ? 0xff7a00 : 0xffd23f, depthTest: false })); pin.rotation.x = Math.PI; pin.position.set(x, y + sz * 0.5, z); pin.renderOrder = 69; grp.add(pin);
    const lb = label(`🏠 ${o.name}${o.village ? ' · ' + o.village : ''}`, on ? '#ffb36b' : '#ffffff'); lb.position.set(x, y + sz * 1.25, z); lb.scale.set(sz * 0.42 * lb.userData.aspect, sz * 0.42, 1); grp.add(lb); }
  const ow = owners.find(o => o.id === selOwner);
  if (ow) { const lots = lotsOf(fields, ow.id), col = 0xff7a00;
    for (const [f] of lots) { // lot outline
      const R = f.ring.map(([lo, la]) => G(lo, la)), pts = [...R, R[0]].map(([x, y, z]) => new THREE.Vector3(x, y + 1.2, z)); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false })); l.renderOrder = 68; grp.add(l); }
    if (ow.house) { const [hx, hy, hz] = G(...ow.house);
      for (const [f] of lots) { const [cx, cy, cz] = G(...centroid(f)), d = Math.hypot(cx - hx, cz - hz), hgt = Math.min(120, 8 + d * 0.25), pts = [];
        for (let k = 0; k <= 40; k++) { const t = k / 40; pts.push(new THREE.Vector3(hx + (cx - hx) * t, hy + (cy - hy) * t + Math.sin(Math.PI * t) * hgt + 1, hz + (cz - hz) * t)); }
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.9 })); l.renderOrder = 68; grp.add(l);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(sz * 0.08, 10, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); dot.position.set(cx, cy + 1.2, cz); dot.renderOrder = 69; grp.add(dot); } } }
  world.scene.add(grp); world.ownerGroup = grp;
}
export function hide3D(world) { const g = world.ownerGroup; if (!g) return; world.scene.remove(g); g.traverse(o => { o.geometry && o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); world.ownerGroup = null; }
