// Detailed land cover (13 classes) for the area: the image classes (water, canopy, green, bare, built) refined with
// canopy density, nearness to villages and water, slope, OpenStreetMap (roads, buildings, water, land use) and the
// Esri | Impact Observatory 10 m Sentinel-2 land cover of the latest year.
export const LC = {
  1: { en: 'Open water', km: 'ផ្ទៃទឹក', c: '#4f8fd0', topo: '#a9cdea' },
  2: { en: 'Flooded / wet vegetation', km: 'រុក្ខជាតិលិចទឹក', c: '#6fa8b8', topo: '#c8e2e2' },
  3: { en: 'Dense forest', km: 'ព្រៃក្រាស់', c: '#1f5b2a', topo: '#8fc38a' },
  4: { en: 'Open forest / woodland', km: 'ព្រៃរេចរឹល', c: '#3f8a3a', topo: '#b5dba8' },
  5: { en: 'Shrubland / scattered trees', km: 'ព្រៃគុម្ពោត', c: '#7aa857', topo: '#d4ebc3' },
  6: { en: 'Orchard / village trees', km: 'ចម្ការឈើហូបផ្លែ', c: '#5f9e4a', topo: '#c3e3b2' },
  7: { en: 'Paddy rice field', km: 'ស្រែ', c: '#b8d46a', topo: '#f3f8dc' },
  8: { en: 'Other cropland', km: 'ដីដំណាំផ្សេងៗ', c: '#d9c25a', topo: '#f7f0cf' },
  9: { en: 'Grassland / pasture', km: 'វាលស្មៅ', c: '#a6c779', topo: '#eef6dc' },
  10: { en: 'Bare soil / fallow', km: 'ដីទទេ', c: '#c79a6a', topo: '#f2e4d2' },
  11: { en: 'Sand / riverbank', km: 'ខ្សាច់ / ច្រាំងទន្លេ', c: '#e8d7a6', topo: '#f8efd2' },
  12: { en: 'Built-up / houses', km: 'តំបន់លំនៅដ្ឋាន', c: '#d9776a', topo: '#f2c6b4' },
  13: { en: 'Roads & paved', km: 'ផ្លូវ និងផ្ទៃក្រាលកៅស៊ូ', c: '#8d8a86', topo: '#ffffff' },
  0: { en: 'Cloud / no data', km: 'ពពក / គ្មានទិន្នន័យ', c: '#cfd3d6', topo: '#ffffff' },
};
// Sat2Topo classes used by the mobility rules (1 Water 2 Built 3 Road 4 Trees 5 Grass/shrub 6 Crop/rice 7 Bare)
export const TO_SAT2TOPO = { 0: 7, 1: 1, 2: 1, 3: 4, 4: 4, 5: 5, 6: 4, 7: 6, 8: 6, 9: 5, 10: 7, 11: 7, 12: 2, 13: 3 };

const IO = 'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer';
export async function loadIO(aoi, W, H, year = 2025) {
  try {
    const GT = await import('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm'), sz = Math.min(500, Math.max(64, Math.round(Math.max(W, H) / 10)));
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
    const url = `${IO}/exportImage?bbox=${aoi.w},${aoi.s},${aoi.e},${aoi.n}&bboxSR=4326&imageSR=4326&size=${sz},${sz}&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor&renderingRule=${encodeURIComponent('{"rasterFunction":"None"}')}&f=image&time=${Date.UTC(year, 6, 1)}`;
    const im = await (await GT.fromArrayBuffer(await (await fetch(url, { signal: ctl.signal })).arrayBuffer())).getImage(); clearTimeout(to);
    return { w: im.getWidth(), h: im.getHeight(), d: (await im.readRasters())[0], year };
  } catch (e) { console.warn('IO land cover', e); return null; }
}

export function detailedLandCover(D, F, io, rawElevation) {
  const { gw, gh, C, X0, Z0, cls, mw, mh, MR, wmask, nearB, aoi } = D, n = gw * gh, lc = new Uint8Array(n);
  const mAt = (m, x, z) => m ? m[Math.min(mh - 1, Math.max(0, ((z - Z0) / MR) | 0)) * mw + Math.min(mw - 1, Math.max(0, ((x - X0) / MR) | 0))] : 0;
  const ioAt = (x, z) => { if (!io) return 0; const lon = F.lon(x), lat = F.lat(z), i = Math.min(io.w - 1, Math.max(0, Math.floor((lon - aoi.w) / (aoi.e - aoi.w) * io.w))), j = Math.min(io.h - 1, Math.max(0, Math.floor((aoi.n - lat) / (aoi.n - aoi.s) * io.h))); return io.d[j * io.w + i]; };
  // canopy density within ~10 m (summed-area table)
  const W1 = gw + 1, sat = new Uint32Array(W1 * (gh + 1));
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) sat[(j + 1) * W1 + i + 1] = (cls[j * gw + i] === 2 ? 1 : 0) + sat[j * W1 + i + 1] + sat[(j + 1) * W1 + i] - sat[j * W1 + i];
  const dens = (i, j, r) => { const i0 = Math.max(0, i - r), i1 = Math.min(gw, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(gh, j + r + 1); return (sat[j1 * W1 + i1] - sat[j0 * W1 + i1] - sat[j1 * W1 + i0] + sat[j0 * W1 + i0]) / ((i1 - i0) * (j1 - j0)); };
  // distance bands to water and to houses (dilation on the 2.5 m grid)
  const grow = (seed, passes) => { let a = seed.slice(); for (let p = 0; p < passes; p++) { const b = a.slice(); for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) { const q = j * gw + i; if (!b[q] && (b[q - 1] || b[q + 1] || b[q - gw] || b[q + gw])) a[q] = 1; } } return a; };
  const wseed = new Uint8Array(n); for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = j * gw + i; if (cls[q] === 1 || mAt(wmask, X0 + (i + .5) * C, Z0 + (j + .5) * C)) wseed[q] = 1; }
  const nearW = grow(wseed, 10), village = grow(nearB, 10);
  // OSM land use raster
  const lu = new Uint8Array(n);
  if (D.landuse) {
    const c = document.createElement('canvas'); c.width = gw; c.height = gh; const g = c.getContext('2d', { willReadFrequently: true });
    for (const l of D.landuse) { g.fillStyle = `rgb(${l.code},0,0)`; g.beginPath(); for (const r of l.rings) r.forEach((p, i) => i ? g.lineTo((p[0] - X0) / C, (p[1] - Z0) / C) : g.moveTo((p[0] - X0) / C, (p[1] - Z0) / C)); g.fill('evenodd'); }
    const d = g.getImageData(0, 0, gw, gh).data; for (let q = 0; q < n; q++) lu[q] = d[q * 4];
  }
  const slope = (x, z) => { if (!rawElevation) return 0; const e = 15, a = rawElevation(x + e, z) - rawElevation(x - e, z), b = rawElevation(x, z + e) - rawElevation(x, z - e); return Math.hypot(a, b) / (2 * e); };
  const counts = new Uint32Array(14);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const q = j * gw + i, x = X0 + (i + .5) * C, z = Z0 + (j + .5) * C, k = cls[q], io_ = ioAt(x, z), L = lu[q]; let o;
    const [r, g, b] = D.pxAt(x, z), v = (r + g + b) / 3;
    if (k === 0) o = 0;
    else if (mAt(wmask, x, z)) o = 1;
    else if (mAt(D.rmask, x, z)) o = 13;
    else if (mAt(D.bmaskOSM, x, z)) o = 12;
    else if (k === 1) o = io_ === 1 || io_ === 0 && v < 60 ? 1 : 2;
    else if (k === 2) {
      const cd = dens(i, j, 4);
      if (L === 2 || (village[q] && cd < 0.85)) o = 6;
      else if (cd > 0.7) o = 3; else if (cd > 0.35 || L === 1) o = 4; else o = 5;
    } else if (k === 3) {
      if (io_ === 4) o = 2;
      else if (L === 4 || L === 15) o = 9;
      else if (L === 7 || (io_ === 11 && dens(i, j, 4) > 0.12)) o = 5;
      else if (L === 2) o = 6;
      else if (village[q] && !(L === 3)) o = 9;
      else if (L === 3 || io_ === 5 || io_ === 0 && slope(x, z) < 0.03) o = slope(x, z) < 0.04 ? 7 : 8;
      else if (io_ === 11) o = 9; else o = 7;
    } else if (k === 4) {
      if (L === 8 || (nearW[q] && v > 150)) o = 11;
      else if (L === 3 || io_ === 5) o = 8; else o = 10;
    } else { // 5: built / grey / bright
      if (io_ === 7 || village[q] || L === 9 || L === 10 || L === 11) o = 12;
      else if (nearW[q] && v > 170) o = 11; else o = 10;
    }
    lc[q] = o; counts[o]++;
  }
  // tidy: majority filter removes single-cell speckle
  const out = lc.slice();
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const q = j * gw + i; if (lc[q] === 13 || lc[q] === 1 || lc[q] === 12) continue; const h = {}; let best = lc[q], bn = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const v = lc[q + a * gw + c]; h[v] = (h[v] || 0) + 1; if (h[v] > bn) { bn = h[v]; best = v; } }
    if (bn >= 5 && best !== 13) out[q] = best;
  }
  counts.fill(0); for (const v of out) counts[v]++;
  const tot = n - counts[0] || 1, pct = {}; for (let k = 0; k < 14; k++) if (counts[k]) pct[k] = counts[k] / (k ? tot : n);
  return { lc: out, pct, io: !!io };
}

// colour canvas of the classes (one pixel per 2.5 m cell, north up)
export function lcCanvas(D, lc, key = 'c') {
  const c = document.createElement('canvas'); c.width = D.gw; c.height = D.gh; const g = c.getContext('2d'), im = g.createImageData(D.gw, D.gh);
  const pal = {}; for (const k in LC) { const h = LC[k][key]; pal[k] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  for (let q = 0; q < lc.length; q++) { const p = pal[lc[q]] || pal[0]; im.data[q * 4] = p[0]; im.data[q * 4 + 1] = p[1]; im.data[q * 4 + 2] = p[2]; im.data[q * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}
