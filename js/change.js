// Change detection: compare the current image with an older Esri World Imagery Wayback version of the same area.
// Swipe between dates, show the old image, or highlight what changed (new roofs / clearing, vegetation gain, water).
const WB_CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const TILEMAP = (rel, z, y, x) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/${rel}/${z}/${y}/${x}/1/1`;
const TILE = (rel, z, x, y) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/${z}/${y}/${x}`;
const loadImg = u => new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = u; });
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }; await Promise.all(Array.from({ length: n }, run)); }

let CFG = null;
// the distinct image versions that exist for this area (newest first)
export async function versions(D, say = () => { }) {
  if (!CFG) { const j = await (await fetch(WB_CONFIG)).json(); CFG = Object.entries(j).map(([num, v]) => ({ num: +num, date: (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || ['?'])[0] })).sort((a, b) => b.date.localeCompare(a.date)); }
  const ntx = D.img.width / 256, nty = D.img.height / 256, tx = D.ir.x0 + Math.floor(ntx / 2), ty = D.ir.y0 + Math.floor(nty / 2), byNum = new Map(CFG.map(r => [r.num, r])), found = new Map(); let n = 0;
  await pool(CFG, 10, async r => {
    try { const j = await (await fetch(TILEMAP(r.num, D.zi, ty, tx))).json(); if (!j.data || !j.data[0]) return; const sel = j.select && j.select[0] ? +j.select[0] : r.num; if (!found.has(sel)) found.set(sel, byNum.get(sel) || r); } catch (e) { }
    if (++n % 20 === 0) say(`Checking image versions… ${n}/${CFG.length}`);
  });
  return [...found.values()].sort((a, b) => b.date.localeCompare(a.date));
}
// the whole area at one version, same pixel grid as the scene image
export async function mosaic(D, rel, say = () => { }) {
  const W = D.img.width, H = D.img.height, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), tiles = [];
  for (let y = 0; y < H / 256; y++) for (let x = 0; x < W / 256; x++) tiles.push([x, y]); let n = 0;
  await pool(tiles, 8, async ([x, y]) => { try { g.drawImage(await loadImg(TILE(rel, D.zi, D.ir.x0 + x, D.ir.y0 + y)), x * 256, y * 256); } catch (e) { } if (++n % 10 === 0) say(`Loading old image… ${Math.round(n / tiles.length * 100)}%`); });
  return c;
}
// change map: both images normalised (so a brighter or hazier date is not "change"), smoothed, then compared
export function changeMap(before, after, thr = 2.2) {
  const W = before.width, H = before.height, s = 2, w = Math.floor(W / s), h = Math.floor(H / s), sm = (cv) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.filter = 'blur(1.5px)'; g.drawImage(cv, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const A = sm(before), B = sm(after), N = w * h, st = (P) => { const m = [0, 0, 0], q = [0, 0, 0]; for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { const v = P[i * 4 + k]; m[k] += v; q[k] += v * v; } return m.map((v, k) => [v / N, Math.sqrt(Math.max(1, q[k] / N - (v / N) ** 2))]); };
  const sa = st(A), sb = st(B), out = document.createElement('canvas'); out.width = w; out.height = h; const og = out.getContext('2d'), im = og.createImageData(w, h); const cnt = { built: 0, veg: 0, water: 0, other: 0 };
  for (let i = 0; i < N; i++) {
    const a = [0, 1, 2].map(k => (A[i * 4 + k] - sa[k][0]) / sa[k][1]), b = [0, 1, 2].map(k => (B[i * 4 + k] - sb[k][0]) / sb[k][1]), d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d < thr) continue; // unchanged
    const ga = 2 * a[1] - a[0] - a[2], gb = 2 * b[1] - b[0] - b[2], la = a[0] + a[1] + a[2], lb = b[0] + b[1] + b[2];
    let col, k; if (gb - ga > 1.2) { col = [40, 220, 90]; k = 'veg'; } else if (lb - la < -2.2 && b[2] >= b[0]) { col = [40, 140, 255]; k = 'water'; } else if (lb - la > 1.2 || ga - gb > 1.2) { col = [255, 60, 40]; k = 'built'; } else { col = [255, 210, 60]; k = 'other'; }
    cnt[k]++; im.data.set([...col, Math.min(230, 90 + d * 40)], i * 4);
  }
  og.putImageData(im, 0, 0); const tot = N / 100; return { canvas: out, pct: { built: cnt.built / tot, veg: cnt.veg / tot, water: cnt.water / tot, other: cnt.other / tot, all: (cnt.built + cnt.veg + cnt.water + cnt.other) / tot } };
}
