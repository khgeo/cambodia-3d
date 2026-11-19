// Result layers: maps made by the apps (field boundaries, rice planting dates, rice ecosystems, mineral prospects,
// EIA zones …). Each one stays in the scene after its app panel is closed, can be switched on/off and faded in the
// Display panel, and joins the Layers stack (pull apart / tour) like the built-in layers.
// A layer has a ground image (drawn on a copy of the terrain surface, aligned with the 3D image) and/or 3D objects.
import * as THREE from 'three';

export class ResultLayers {
  constructor(world) { this.w = world; this.list = []; this.onChange = null; }
  get(id) { return this.list.find(r => r.id === id); }
  // add or update: { id, name, icon, c (colour), canvas (same size as D.img), objs: () => [Object3D], legend: [[label, colour]], remake: () => void }
  set(id, o) {
    let r = this.get(id), isNew = !r;
    if (!r) { r = { id, name: id, icon: '🧩', c: '#ffe14a', on: true, op: 1, canvas: null, mesh: null, objs: null, legend: null, remake: null }; this.list.push(r); }
    const { canvas, ...rest } = o; Object.assign(r, rest);
    if (canvas !== undefined) this.paint(r, canvas);
    this.sync(r); if (isNew && !r.on) this.sync(r);
    this.changed(isNew);
    return r;
  }
  paint(r, canvas) {
    r.canvas = canvas;
    if (!canvas) { this.dropMesh(r); return; }
    if (r.mesh && r.mesh.material.map && r.mesh.material.map.image === canvas) { r.mesh.material.map.needsUpdate = true; return; }
    if (r.mesh) { r.mesh.material.map && r.mesh.material.map.dispose(); const t = this.tex(canvas); r.mesh.material.map = t; r.mesh.material.needsUpdate = true; return; }
    this.makeMesh(r);
  }
  tex(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  makeMesh(r) {
    const w = this.w; if (!w.terrainMesh || !r.canvas) return;
    const k = this.list.indexOf(r);
    const m = new THREE.Mesh(w.terrainMesh.geometry, new THREE.MeshStandardMaterial({ map: this.tex(r.canvas), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 - k, polygonOffsetUnits: -4 - k * 2 }));
    m.position.y = 0.15 + k * 0.03; m.renderOrder = 3 + k; m.receiveShadow = true; m.userData.result = r.id; r.mesh = m; w.scene.add(m);
  }
  dropMesh(r) { if (!r.mesh) return; this.w.scene.remove(r.mesh); r.mesh.material.map && r.mesh.material.map.dispose(); r.mesh.material.dispose(); r.mesh = null; }
  parts(r) { return [r.mesh, ...(r.objs ? r.objs() : [])].filter(Boolean); }
  // visibility and opacity, either directly or through the layer stack when it is open
  sync(r) {
    const L = this.w.layers;
    if (L && L.state && L.state[r.id]) { L.state[r.id].on = r.on; L.state[r.id].op = r.op; L.dirty = true; return; }
    for (const p of this.parts(r)) { p.visible = r.on; }
    if (r.mesh) r.mesh.material.opacity = r.op;
  }
  setOn(id, on) { const r = this.get(id); if (!r) return; r.on = on; this.sync(r); this.changed(false); }
  setOp(id, op) { const r = this.get(id); if (!r) return; r.op = op; this.sync(r); }
  remove(id) { const r = this.get(id); if (!r) return; this.dropMesh(r); r.dispose && r.dispose(); this.list = this.list.filter(x => x !== r); this.changed(true); }
  // terrain rebuilt (height exaggeration, smoothing): new surface copies, 3D objects remade by their app
  rebuild() { for (const r of this.list) { this.dropMesh(r); if (r.canvas) this.makeMesh(r); r.remake && r.remake(); this.sync(r); } this.changed(true); }
  // a new area: everything goes
  clear() { for (const r of [...this.list]) { this.dropMesh(r); r.dispose && r.dispose(); } this.list = []; this.changed(true); }
  changed(structure) { const L = this.w.layers; if (L && L.syncResults) L.syncResults(); this.onChange && this.onChange(structure); }
}
