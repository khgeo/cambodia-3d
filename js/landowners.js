// Land owners for the field boundaries: who owns each lot, where the owner lives (house), and the links between an
// owner's house and all of their lots, drawn as arcs in 3D. Saved in this browser per area (nothing leaves the
// computer unless exported), and exported with the fields to GeoPackage / CSV / report.
import * as THREE from 'three';

export const OWNER_TYPES = [['person', 'Person'], ['family', 'Family / heirs'], ['org', 'Organisation / company'], ['state', 'State / public land']];
export const MARITAL = [['married', 'Married'], ['single', 'Single'], ['widowed', 'Widowed'], ['divorced', 'Divorced / separated']];
export const TITLES = [['hard', 'Hard title (ownership certificate)'], ['soft', 'Soft title (commune / district paper)'], ['reg', 'In systematic registration'], ['none', 'Possession only, no paper'], ['unknown', 'Unknown']];
export const ACQUIRED = [['inherited', 'Inherited'], ['bought', 'Bought'], ['gift', 'Gift'], ['allocated', 'Allocated (social land concession)'], ['cleared', 'Cleared / first occupied'], ['other', 'Other']];
export const FARMED = [['owner', 'Farmed by the owner'], ['rented', 'Rented out'], ['share', 'Sharecropped'], ['lent', 'Lent free'], ['idle', 'Not farmed']];
// the name shown everywhere: a married couple is "husband & wife"
export function displayName(o) { if (!o) return ''; if (o.type === 'person' && o.marital === 'married' && (o.husband || o.wife)) return [o.husband, o.wife].filter(Boolean).join(' & '); return o.name || o.husband || o.wife || ''; }
export const LAND_USE = ['Wet-season rice', 'Dry-season rice', 'Rice, two seasons', 'Cassava', 'Vegetables', 'Fruit trees / orchard', 'Cashew', 'Fallow', 'Pond', 'Other'];
const key = aoi => 'cambodia3d.fields.' + [aoi.w, aoi.s, aoi.e, aoi.n].map(v => v.toFixed(4)).join(',');
export function save(aoi, fields, owners) { try { localStorage.setItem(key(aoi), JSON.stringify({ date: new Date().toISOString(), fields, owners })); return true; } catch (e) { console.warn('save', e); return false; } }
export function load(aoi) { try { const s = localStorage.getItem(key(aoi)); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
export function forget(aoi) { try { localStorage.removeItem(key(aoi)); } catch (e) { } }
export const centroid = f => { const r = f.ring; return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; };
export function newOwner(owners, o) { const id = (owners.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1; const ow = { id, type: 'person', marital: 'married', name: '', husband: '', wife: '', sex: '', village: '', commune: '', phone: '', note: '', house: null, ...o }; ow.name = displayName(ow); owners.push(ow); return ow; }
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
  if (ow) { const lots = lotsOf(fields, ow.id), col = 0xff7a00, T = { value: 0 }, t0 = performance.now(), tick = () => { T.value = (performance.now() - t0) / 1000; };
    // the selected owner's lots blink, and light pulses run along the arcs from the house to each lot
    const fillM = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide });
    const arcM = new THREE.ShaderMaterial({ uniforms: { uT: T }, transparent: true, depthTest: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uT; varying vec2 vUv; void main(){ float p = fract(vUv.x * 3.0 - uT * 0.7); float g = smoothstep(0.0, 0.12, p) * smoothstep(0.32, 0.12, p); vec3 c = mix(vec3(1.0, 0.48, 0.0), vec3(1.0, 0.95, 0.6), g); gl_FragColor = vec4(c, 0.75 + 0.25 * g); }' });
    const blink = o => { o.onBeforeRender = () => { tick(); fillM.opacity = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(T.value * 5)); }; };
    for (const [f] of lots) { // lot outline and a blinking fill
      const R = f.ring.map(([lo, la]) => G(lo, la)), pts = [...R, R[0]].map(([x, y, z]) => new THREE.Vector3(x, y + 1.2, z)); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false })); l.renderOrder = 68; grp.add(l);
      try { const yb = R.reduce((m, p) => Math.max(m, p[1]), -1e9) + 0.8, tri = THREE.ShapeUtils.triangulateShape(R.map(([x, , z]) => new THREE.Vector2(x, z)), []), pos = []; for (const t of tri) for (const k of t) pos.push(R[k][0], yb, R[k][2]);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const m = new THREE.Mesh(g, fillM); m.renderOrder = 67; blink(m); grp.add(m); } catch (e) { } }
    if (ow.house) { const [hx, hy, hz] = G(...ow.house);
      // a ring that keeps spreading out from the owner's house
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, depthTest: false, side: THREE.DoubleSide }));
      ring.position.set(hx, hy + 0.8, hz); ring.renderOrder = 69; ring.onBeforeRender = () => { tick(); const f = (T.value * 0.8) % 1; ring.scale.setScalar(sz * (0.3 + 2.2 * f)); ring.material.opacity = 1 - f; }; grp.add(ring);
      for (const [f] of lots) { const [cx, cy, cz] = G(...centroid(f)), d = Math.hypot(cx - hx, cz - hz), hgt = Math.min(120, 8 + d * 0.25), pts = [];
        for (let k = 0; k <= 40; k++) { const t = k / 40; pts.push(new THREE.Vector3(hx + (cx - hx) * t, hy + (cy - hy) * t + Math.sin(Math.PI * t) * hgt + 1, hz + (cz - hz) * t)); }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, Math.max(0.35, sz * 0.05), 6), arcM); tube.renderOrder = 68; tube.onBeforeRender = tick; grp.add(tube);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(sz * 0.1, 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); dot.position.set(cx, cy + 1.2, cz); dot.renderOrder = 69; dot.onBeforeRender = () => { tick(); dot.scale.setScalar(1 + 0.35 * Math.sin(T.value * 5)); }; grp.add(dot); } } }
  world.scene.add(grp); world.ownerGroup = grp;
}
export function hide3D(world) { const g = world.ownerGroup; if (!g) return; world.scene.remove(g); g.traverse(o => { o.geometry && o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); world.ownerGroup = null; }
