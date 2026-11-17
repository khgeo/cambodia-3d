// Underground: soil profiles (ISRIC SoilGrids 250 m, 0–200 cm) and surface geology (Geology of Cambodia 2006,
// ODC / Save Cambodia's Wildlife), sampled along a cross-section line, drawn as a 2D profile, as a cut wall in 3D
// and on the sides of the landscape block. Depth of rock units below the soil is schematic (not measured).
import * as THREE from 'three';

const GEO = { w: 102.18, n: 14.72, res: 0.002 };
export const UNITS = {
  1: { n: 'Young alluvium', c: '#dccb9e', p: 'dots', k: 'alluvium' },
  22: { n: 'Old alluvium', c: '#c9a46c', p: 'dots', k: 'oldall' },
  18: { n: 'Seasonally flooded alluvium', c: '#c3cfa6', p: 'dots', k: 'alluvium' },
  11: { n: 'Lake / river deposits', c: '#b7c4b0', p: 'dots', k: 'alluvium' },
  2: { n: 'Jurassic–Cretaceous sandstone', c: '#e3b887', p: 'sand' },
  3: { n: 'Triassic sandstone', c: '#d89c78', p: 'sand' },
  4: { n: 'Devono-Carboniferous sandstone & shale', c: '#aaa38c', p: 'shale' },
  5: { n: 'Cambrian–Silurian quartzite', c: '#cbbccb', p: 'quartz' },
  6: { n: 'Hornfels', c: '#9c91a3', p: 'meta' },
  7: { n: 'Basalt', c: '#6f6c76', p: 'volc' },
  8: { n: 'Rhyolite & dacite', c: '#da9292', p: 'volc' },
  9: { n: 'Andesite', c: '#b27c88', p: 'volc' },
  10: { n: 'Granite', c: '#e99c9c', p: 'granite' },
  12: { n: 'Lower–Middle Jurassic red beds', c: '#c9765c', p: 'sand' },
  13: { n: 'Upper Carboniferous–Lower Triassic sandstone', c: '#caa580', p: 'sand' },
  14: { n: 'Ouralo-Permian limestone, dolomite, marble', c: '#a3c6d8', p: 'lime' },
  15: { n: 'Permian limestone', c: '#92bad0', p: 'lime' },
  16: { n: 'Cambrian–Upper Silurian quartzites', c: '#c1b2c6', p: 'quartz' },
  17: { n: 'Precambrian amphibolite, quartzite, gneiss', c: '#9d8caa', p: 'meta' },
  19: { n: 'Late Triassic–Early Cretaceous granodiorite', c: '#eaa7a2', p: 'granite' },
  20: { n: 'Diorite & gabbro', c: '#bb8e8e', p: 'granite' },
  21: { n: 'Dolerite', c: '#817c82', p: 'volc' },
  0: { n: 'No geology data', c: '#a8a8a8', p: 'none' },
};
const BEDROCK_UNKNOWN = { n: 'Older sediments / bedrock (unknown)', c: '#a59a8a', p: 'shale' };
export const SOIL_CLASSES = {
  'Sand': '#e8d39a', 'Loamy sand': '#dcc287', 'Sandy loam': '#c9a46b', 'Loam': '#a8835a', 'Silt loam': '#b59a72', 'Silt': '#c7b48e',
  'Sandy clay loam': '#a46b45', 'Clay loam': '#8a5a3c', 'Silty clay loam': '#8f6a4e', 'Sandy clay': '#9a5236', 'Silty clay': '#6f5848', 'Clay': '#6b3f2e', 'No data': '#9a9a9a',
};
const DEPTHS = ['0-5cm', '5-15cm', '15-30cm', '30-60cm', '60-100cm', '100-200cm'], DEPTH_CM = [0, 5, 15, 30, 60, 100, 200];

export function usdaTexture(sand, silt, clay) {
  if (silt + 1.5 * clay < 15) return 'Sand';
  if (silt + 2 * clay < 30) return 'Loamy sand';
  if ((clay >= 7 && clay < 20 && sand > 52) || (clay < 7 && silt < 50)) return 'Sandy loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'Loam';
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'Silt loam';
  if (silt >= 80 && clay < 12) return 'Silt';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'Sandy clay loam';
  if (clay >= 27 && clay < 40 && sand > 20) return 'Clay loam';
  if (clay >= 27 && clay < 40) return 'Silty clay loam';
  if (clay >= 35 && sand > 45) return 'Sandy clay';
  if (clay >= 40 && silt >= 40) return 'Silty clay';
  return 'Clay';
}

/* ---------------- loading ---------------- */
function loadImg(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
export async function loadUnderground(world, say) {
  const a = world.D.aoi, pad = 0.01, U = { soil: {}, geo: null, soilOk: false };
  // geology raster crop (data/geology.png: unit id per 0.002° cell, rasterised from the ODC 2006 map)
  try {
    const im = await loadImg('data/geology.png?v=35');
    const x0 = Math.max(0, Math.floor((a.w - pad - GEO.w) / GEO.res)), x1 = Math.min(im.width, Math.ceil((a.e + pad - GEO.w) / GEO.res));
    const y0 = Math.max(0, Math.floor((GEO.n - (a.n + pad)) / GEO.res)), y1 = Math.min(im.height, Math.ceil((GEO.n - (a.s - pad)) / GEO.res));
    const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0; const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false; ctx.drawImage(im, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    U.geo = { x0, y0, w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
  } catch (e) { console.warn('geology', e); }
  // SoilGrids WCS (GeoTIFF, EPSG:4326) for the AOI: sand, silt, clay, SOC at 6 depths
  say && say('Loading soil profiles (ISRIC SoilGrids)…');
  try {
    const GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm');
    const jobs = [];
    for (const p of ['sand', 'silt', 'clay', 'soc']) for (const dpt of DEPTHS) jobs.push([p, dpt]);
    let done = 0, ok = 0;
    const run = async ([p, dpt]) => {
      const url = `https://maps.isric.org/mapserv?map=/map/${p}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${p}_${dpt}_mean&FORMAT=image/tiff` +
        `&SUBSET=long(${(a.w - pad).toFixed(4)},${(a.e + pad).toFixed(4)})&SUBSET=lat(${(a.s - pad).toFixed(4)},${(a.n + pad).toFixed(4)})` +
        `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326`;
      try {
        const buf = await (await fetch(url)).arrayBuffer(), tif = await GT.fromArrayBuffer(buf), img = await tif.getImage(), r = await img.readRasters();
        U.soil[p + dpt] = { bbox: img.getBoundingBox(), w: img.getWidth(), h: img.getHeight(), d: r[0] }; ok++;
      } catch (e) { console.warn('soilgrids', p, dpt, e); }
      done++; say && say(`Loading soil profiles ${done}/${jobs.length}…`);
    };
    let i = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (i < jobs.length) await run(jobs[i++]); }));
    U.soilOk = ok >= 12;
  } catch (e) { console.warn('geotiff', e); }
  return U;
}
export function geologyAt(U, lon, lat) {
  const g = U.geo; if (!g) return 0;
  const i = Math.floor((lon - GEO.w) / GEO.res) - g.x0, j = Math.floor((GEO.n - lat) / GEO.res) - g.y0;
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0; return g.d[(j * g.w + i) * 4];
}
function rasterAt(R, lon, lat) {
  if (!R) return null; const [x0, y0, x1, y1] = R.bbox, i = Math.floor((lon - x0) / (x1 - x0) * R.w), j = Math.floor((y1 - lat) / (y1 - y0) * R.h);
  if (i < 0 || j < 0 || i >= R.w || j >= R.h) return null; const v = R.d[j * R.w + i]; return v <= -32000 || v === 0 ? null : v;
}
export function soilAt(U, lon, lat, k) {
  const dpt = DEPTHS[k], s = rasterAt(U.soil['sand' + dpt], lon, lat), si = rasterAt(U.soil['silt' + dpt], lon, lat), c = rasterAt(U.soil['clay' + dpt], lon, lat), soc = rasterAt(U.soil['soc' + dpt], lon, lat);
  if (s == null || si == null || c == null) return { cls: 'No data', color: SOIL_CLASSES['No data'] };
  const t = s + si + c, sand = s / t * 100, silt = si / t * 100, clay = c / t * 100, cls = usdaTexture(sand, silt, clay);
  const dark = Math.min(0.35, (soc || 0) / 10 / 60); // SOC dg/kg → g/kg; darker topsoil with more organic carbon
  const col = new THREE.Color(SOIL_CLASSES[cls]).multiplyScalar(1 - dark);
  return { cls, color: '#' + col.getHexString(), sand, silt, clay, soc: soc != null ? soc / 10 : null };
}

/* ---------------- sampling ---------------- */
export function sampleLine(world, U, A, B, n) {
  const out = [], L = Math.hypot(B.x - A.x, B.z - A.z), D = world.D;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, lon = world.F.lon(x), lat = world.F.lat(z);
    const wi = Math.min(D.mw - 1, Math.max(0, ((x - D.X0) / D.MR) | 0)), wj = Math.min(D.mh - 1, Math.max(0, ((z - D.Z0) / D.MR) | 0));
    out.push({ d: t * L, x, z, lon, lat, elev: world.rawElevation(x, z), gy: world.hAt(x, z), geo: geologyAt(U, lon, lat), water: !!D.wmask[wj * D.mw + wi],
      soil: DEPTHS.map((_, k) => soilAt(U, lon, lat, k)) });
  }
  return out;
}

/* ---------------- patterns ---------------- */
const patCache = new Map();
function pattern(ctx, kind, base) {
  const key = kind + base; if (patCache.has(key)) return ctx.createPattern(patCache.get(key), 'repeat');
  const c = document.createElement('canvas'), S = 16; c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const ink = new THREE.Color(base).multiplyScalar(0.62).getStyle(); g.fillStyle = g.strokeStyle = ink; g.lineWidth = 1;
  if (kind === 'dots') { for (const [x, y] of [[3, 4], [11, 2], [7, 10], [14, 13], [1, 13]]) g.fillRect(x, y, 1.4, 1.4); }
  if (kind === 'sand') { for (const [x, y] of [[2, 3], [9, 2], [5, 8], [13, 7], [3, 13], [11, 12]]) { g.beginPath(); g.arc(x, y, 1, 0, 7); g.fill(); } }
  if (kind === 'shale') { g.beginPath(); g.moveTo(0, 4); g.lineTo(9, 4); g.moveTo(5, 12); g.lineTo(16, 12); g.stroke(); }
  if (kind === 'lime') { g.strokeRect(0.5, 0.5, 15, 7.5); g.beginPath(); g.moveTo(8, 8); g.lineTo(8, 16); g.stroke(); }
  if (kind === 'granite') { g.beginPath(); for (const [x, y] of [[4, 4], [12, 11]]) { g.moveTo(x - 2, y); g.lineTo(x + 2, y); g.moveTo(x, y - 2); g.lineTo(x, y + 2); } g.stroke(); }
  if (kind === 'volc') { g.beginPath(); for (const [x, y] of [[4, 5], [12, 12]]) { g.moveTo(x - 2.5, y - 2); g.lineTo(x, y + 2); g.lineTo(x + 2.5, y - 2); } g.stroke(); }
  if (kind === 'meta') { g.beginPath(); g.moveTo(0, 5); g.quadraticCurveTo(4, 2, 8, 5); g.quadraticCurveTo(12, 8, 16, 5); g.moveTo(0, 13); g.quadraticCurveTo(4, 10, 8, 13); g.quadraticCurveTo(12, 16, 16, 13); g.stroke(); }
  if (kind === 'quartz') { g.beginPath(); g.moveTo(2, 3); g.lineTo(6, 3); g.moveTo(10, 9); g.lineTo(14, 9); g.moveTo(4, 14); g.lineTo(8, 14); g.stroke(); }
  patCache.set(key, c); return ctx.createPattern(c, 'repeat');
}
// column layers from the ground surface downwards, in metres: [{top, bottom, fill, label}]
function columnLayers(s) {
  const u = UNITS[s.geo] || UNITS[0], L = [];
  L.push({ t: 0, b: 2, kind: 'soil' });
  if (u.k === 'alluvium') L.push({ t: 2, b: 1e4, unit: u });
  else if (u.k === 'oldall') { L.push({ t: 2, b: 22, unit: u }); L.push({ t: 22, b: 1e4, unit: BEDROCK_UNKNOWN }); }
  else if (s.geo === 0) L.push({ t: 2, b: 1e4, unit: UNITS[0] });
  else { L.push({ t: 2, b: 8, unit: u, weathered: true }); L.push({ t: 8, b: 1e4, unit: u }); }
  return L;
}
function paintColumn(ctx, x, w, yOf, s, gTopM, minSoilPx) {
  // yOf(depthMetres) → canvas y; gTopM unused hook for future water table
  for (const l of columnLayers(s)) {
    let y0 = yOf(l.t), y1 = yOf(l.b);
    if (l.kind === 'soil') {
      y1 = Math.max(y1, y0 + minSoilPx); const n = s.soil.length;
      for (let k = 0; k < n; k++) { const a = y0 + (y1 - y0) * DEPTH_CM[k] / 200, b = y0 + (y1 - y0) * DEPTH_CM[k + 1] / 200; ctx.fillStyle = s.soil[k].color; ctx.fillRect(x, a, w + 0.6, b - a + 0.6); }
      continue;
    }
    ctx.fillStyle = pattern(ctx, l.unit.p, l.weathered ? new THREE.Color(l.unit.c).lerp(new THREE.Color('#d8b98a'), 0.45).getStyle() : l.unit.c);
    ctx.fillRect(x, Math.max(y0, yOf(2) < y0 ? y0 : y0), w + 0.6, y1 - y0 + 0.6);
  }
}

/* ---------------- 2D profile ---------------- */
export function drawProfile(cv, S, opts = {}) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, L = 52, R = 14, T = 22;
  const secH = Math.round(H * 0.6), soilT = T + secH + 26, soilH = H - soilT - 22;
  ctx.fillStyle = '#f7f4ee'; ctx.fillRect(0, 0, W, H);
  const dist = S[S.length - 1].d, emaxG = Math.max(...S.map(s => s.elev)), eminG = Math.min(...S.map(s => s.elev));
  const below = Math.max(30, (emaxG - eminG) * 0.8), emin = eminG - below, emax = emaxG + Math.max(3, (emaxG - eminG) * 0.15);
  const X = d => L + d / dist * (W - L - R), Y = e => T + (emax - e) / (emax - emin) * secH, cw = (W - L - R) / S.length;
  // section
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, W - L - R, secH); ctx.clip();
  const sky = ctx.createLinearGradient(0, T, 0, T + secH * 0.5); sky.addColorStop(0, '#d9e8f4'); sky.addColorStop(1, '#f2f6f8'); ctx.fillStyle = sky; ctx.fillRect(L, T, W - L - R, secH);
  for (const s of S) paintColumn(ctx, X(s.d) - cw / 2, cw, dm => Y(s.elev - dm), s, s.elev, 3);
  for (const s of S) if (s.water) { ctx.fillStyle = 'rgba(70,130,180,0.85)'; ctx.fillRect(X(s.d) - cw / 2, Y(s.elev + 1.2), cw + 0.6, Y(s.elev) - Y(s.elev + 1.2)); }
  ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 1.6; ctx.beginPath(); S.forEach((s, i) => i ? ctx.lineTo(X(s.d), Y(s.elev)) : ctx.moveTo(X(s.d), Y(s.elev))); ctx.stroke();
  ctx.restore();
  // axes
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(L, T, W - L - R, secH);
  ctx.fillStyle = '#333'; ctx.font = '11px system-ui'; ctx.textAlign = 'right';
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200].find(v => (emax - emin) / v <= 7) || 500;
  for (let e = Math.ceil(emin / step) * step; e <= emax; e += step) { ctx.fillText(e + ' m', L - 4, Y(e) + 4); ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.moveTo(L, Y(e)); ctx.lineTo(W - R, Y(e)); ctx.stroke(); }
  ctx.textAlign = 'center';
  const ds = [50, 100, 200, 250, 500, 1000].find(v => dist / v <= 8) || 2000;
  for (let d = 0; d <= dist; d += ds) ctx.fillText(d >= 1000 ? (d / 1000).toFixed(d % 1000 ? 1 : 0) + ' km' : d + ' m', X(d), T + secH + 14);
  const ve = ((secH / (emax - emin)) / ((W - L - R) / dist));
  ctx.textAlign = 'left'; ctx.font = '600 12px system-ui'; ctx.fillStyle = '#222';
  ctx.fillText(`Cross-section A–B · ${(dist / 1000).toFixed(2)} km · vertical exaggeration ×${ve.toFixed(ve < 10 ? 1 : 0)}`, L, 15);
  ctx.font = '600 13px system-ui'; ctx.fillStyle = '#c0392b'; ctx.fillText('A', L + 3, T + 14); ctx.textAlign = 'right'; ctx.fillText('B', W - R - 3, T + 14);
  // soil strip (0–200 cm, real depth labels)
  ctx.textAlign = 'left'; ctx.fillStyle = '#222'; ctx.font = '600 11px system-ui'; ctx.fillText('Soil texture 0–200 cm (USDA classes from SoilGrids)', L, soilT - 6);
  S.forEach(s => { for (let k = 0; k < 6; k++) { const a = soilT + soilH * DEPTH_CM[k] / 200, b = soilT + soilH * DEPTH_CM[k + 1] / 200; ctx.fillStyle = s.soil[k].color; ctx.fillRect(X(s.d) - cw / 2, a, cw + 0.6, b - a + 0.6); } });
  ctx.strokeStyle = '#555'; ctx.strokeRect(L, soilT, W - L - R, soilH);
  ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = '#333';
  for (const cm of [0, 30, 60, 100, 200]) ctx.fillText(cm + ' cm', L - 4, soilT + soilH * cm / 200 + 3);
  ctx.textAlign = 'left'; ctx.fillStyle = '#666'; ctx.font = '10px system-ui';
  ctx.fillText('Rock below the soil is schematic: unit from the 2006 geological map, depths assumed (weathered zone ~2–8 m, old alluvium ~20 m).', L, H - 6);
}
export function legendHTML(S) {
  const units = [...new Set(S.map(s => s.geo))], soils = [...new Set(S.flatMap(s => s.soil.map(x => x.cls)))];
  const sw = (c, t) => `<span class="lg"><i style="background:${c}"></i>${t}</span>`;
  let h = '<b>Geology</b> ' + units.map(u => sw((UNITS[u] || UNITS[0]).c, (UNITS[u] || UNITS[0]).n)).join('');
  if (S.some(s => (UNITS[s.geo] || {}).k === 'oldall')) h += sw(BEDROCK_UNKNOWN.c, BEDROCK_UNKNOWN.n);
  h += '<br><b>Soil</b> ' + soils.map(c => sw(SOIL_CLASSES[c] || '#999', c)).join('');
  return h;
}
export function sectionCSV(S) {
  const head = ['distance_m', 'lon', 'lat', 'elevation_m', 'geology', 'water', ...DEPTHS.flatMap(d => [`soil_${d}`, `sand_${d}`, `silt_${d}`, `clay_${d}`, `soc_gkg_${d}`])];
  const rows = S.map(s => [s.d.toFixed(1), s.lon.toFixed(6), s.lat.toFixed(6), s.elev.toFixed(1), `"${(UNITS[s.geo] || UNITS[0]).n}"`, s.water ? 1 : 0,
    ...s.soil.flatMap(x => [x.cls, x.sand?.toFixed(1) ?? '', x.silt?.toFixed(1) ?? '', x.clay?.toFixed(1) ?? '', x.soc?.toFixed(1) ?? ''])].join(','));
  return [head.join(','), ...rows].join('\n');
}

/* ---------------- 3D cut walls (section and block sides) ---------------- */
export function wallMesh(world, S, bottom, exag) {
  const top = Math.max(...S.map(s => s.gy)), Hs = top - bottom, cw = 1024, ch = 512;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a4634'; ctx.fillRect(0, 0, cw, ch);
  const k = Math.max(exag, 1), colW = cw / S.length;
  S.forEach((s, i) => { const yG = (top - s.gy) / Hs * ch; paintColumn(ctx, i * colW, colW, dm => yG + dm * k / Hs * ch, s, s.elev, 4); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const pos = [], uv = [], idx = [];
  S.forEach((s, i) => { const u = i / (S.length - 1); pos.push(s.x, s.gy - 0.05, s.z, s.x, bottom, s.z); uv.push(u, 1 - (top - s.gy) / Hs, u, 0); });
  for (let i = 0; i < S.length - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.95 }));
}
