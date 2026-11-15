// Cloud detection and gap filling for the AOI imagery mosaic.
// 1. find clouds (bright, grey, large blobs) per 256 px tile
// 2. for each cloudy tile try clear alternatives: Google/Esri, Esri Wayback archive (distinct versions only),
//    and finally Sentinel-2 cloudless (EOX) as a cloud-free fallback
// 3. colour-match the replacement to the surrounding image, also replace cloud shadows, feather-blend.

const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const GOOGLE = (z, x, y) => `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
const S2 = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`;
const WB_CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WB_TILE = (rel, z, x, y) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/${z}/${y}/${x}`;
const WB_TILEMAP = (rel, z, top, left, h, w) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/${rel}/${z}/${top}/${left}/${h}/${w}`;
export const S2_CREDIT = 'Sentinel-2 cloudless 2024 by EOX (s2maps.eu), contains modified Copernicus Sentinel data';

const isCloud = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (r + g + b) > 500 && (mx - mn) < 0.17 * mx + 6; };
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

// separable box blur of a 0..255 Uint8 mask (running sums, O(N) for any radius)
function boxBlur(src, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[o + x] = s / n; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

let releases = null;
async function waybackReleases() {
  if (releases) return releases;
  try {
    const j = await (await fetch(WB_CONFIG)).json();
    releases = Object.entries(j).map(([num, v]) => ({ num, date: (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || ['?'])[0] }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { releases = []; }
  return releases;
}

function loadImg(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }; await Promise.all(Array.from({ length: n }, run)); }

export async function fillClouds({ ictx, W, H, ir, zi, source, say }) {
  const data = ictx.getImageData(0, 0, W, H), d = data.data, N = W * H;
  // 1. raw cloud mask, then opening (removes white roofs / small bright objects), then dilation
  let m = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) if (isCloud(d[p], d[p + 1], d[p + 2])) m[i] = 255;
  let e = boxBlur(m, W, H, 4); for (let i = 0; i < N; i++) e[i] = e[i] >= 250 ? 255 : 0;
  // grow into the thinner, darker cloud margins and haze around the cores
  const nearCore = boxBlur(e, W, H, 60);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    if (e[i] || !nearCore[i]) continue;
    const r = d[p], g = d[p + 1], b = d[p + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (r + g + b > 380 && mx - mn < 0.22 * mx + 8) e[i] = 255;
  }
  m = boxBlur(e, W, H, 10); for (let i = 0; i < N; i++) m[i] = m[i] > 0 ? 255 : 0;
  e = null;
  const ntx = W / 256, nty = H / 256, cloudy = [];
  let cloudPx = 0;
  for (let ty = 0; ty < nty; ty++) for (let tx = 0; tx < ntx; tx++) {
    let c = 0; for (let y = 0; y < 256; y++) { const o = (ty * 256 + y) * W + tx * 256; for (let x = 0; x < 256; x++) if (m[o + x]) c++; }
    if (c / 65536 > 0.01) { cloudy.push({ tx, ty, frac: c / 65536 }); cloudPx += c; }
    else if (c) for (let y = 0; y < 256; y++) { const o = (ty * 256 + y) * W + tx * 256; for (let x = 0; x < 256; x++) m[o + x] = 0; }
  }
  const stats = { cloudPct: cloudPx / N * 100, filledPct: 0, sources: {} };
  if (!cloudy.length) return { stats, remain: null };
  say(`Clouds in ${cloudy.length} image tiles – searching for clear imagery…`);

  // 2. alternatives: which Wayback versions are actually different here (one tilemap request per release)
  const rels = await waybackReleases();
  const sample = rels.length ? [...rels.slice(0, 8), ...Array.from({ length: 8 }, (_, k) => rels[Math.min(rels.length - 1, 8 + Math.floor(k * (rels.length - 9) / 8))])] : [];
  const tileSizes = new Map(); // "x,y" -> [{rel, size}]
  await pool(sample, 6, async rel => {
    try {
      const j = await (await fetch(WB_TILEMAP(rel.num, zi, ir.y0, ir.x0, nty, ntx))).json();
      if (!j.data) return;
      for (let k = 0; k < j.data.length; k++) {
        if (!j.data[k]) continue; const tx = k % ntx, ty = Math.floor(k / ntx), key = tx + ',' + ty;
        if (!tileSizes.has(key)) tileSizes.set(key, []); tileSizes.get(key).push({ rel, size: j.size ? j.size[k] : 0 });
      }
    } catch { }
  });

  const fills = new Map(); let done = 0;
  // global colour stats of the clear primary image (fallback for colour matching)
  const gStat = [0, 0, 0, 0, 0, 0]; let gn = 0;
  for (let i = 0, p = 0; i < N; i += 7, p += 28) if (!m[i]) { for (let k = 0; k < 3; k++) { gStat[k] += d[p + k]; gStat[k + 3] += d[p + k] ** 2; } gn++; }
  const gMean = [0, 1, 2].map(k => gStat[k] / gn), gStd = [0, 1, 2].map(k => Math.sqrt(Math.max(1, gStat[k + 3] / gn - gMean[k] ** 2)));
  const tc = document.createElement('canvas'); tc.width = tc.height = 256;

  await pool(cloudy, 4, async t => {
    const X = ir.x0 + t.tx, Y = ir.y0 + t.ty, key = t.tx + ',' + t.ty;
    const cand = [source === 'google' ? { name: 'Esri', url: ESRI(zi, X, Y) } : { name: 'Google', url: GOOGLE(zi, X, Y) }];
    const seen = new Set();
    for (const { rel, size } of tileSizes.get(key) || []) { if (size && seen.has(size)) continue; seen.add(size); cand.push({ name: 'Esri Wayback ' + rel.date, url: WB_TILE(rel.num, zi, X, Y) }); }
    const local = document.createElement('canvas'); local.width = local.height = 256; const lc = local.getContext('2d', { willReadFrequently: true });
    let best = null, tries = 0;
    for (const c of cand) {
      if (tries >= 5) break;
      try {
        const im = await loadImg(c.url); tries++;
        lc.clearRect(0, 0, 256, 256); lc.drawImage(im, 0, 0, 256, 256); const px = lc.getImageData(0, 0, 256, 256).data;
        let clear = 0, tot = 0;
        for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) { const i = (t.ty * 256 + y) * W + t.tx * 256 + x; if (!m[i]) continue; tot++; const q = (y * 256 + x) * 4; if (!isCloud(px[q], px[q + 1], px[q + 2]) && px[q] + px[q + 1] + px[q + 2] > 30) clear++; }
        const score = tot ? clear / tot : 0;
        if (!best || score > best.score) best = { score, px, name: c.name };
        if (score > 0.96) break;
      } catch { }
    }
    if (!best || best.score < 0.8) { // Sentinel-2 cloudless: always clear, 10 m
      try {
        const zs = Math.min(zi, 16), f = 2 ** (zi - zs), sz = 256 / f, im = await loadImg(S2(zs, Math.floor(X / f), Math.floor(Y / f)));
        lc.imageSmoothingQuality = 'high'; lc.drawImage(im, (X % f) * sz, (Y % f) * sz, sz, sz, 0, 0, 256, 256);
        best = { score: 1, px: lc.getImageData(0, 0, 256, 256).data, name: 'Sentinel-2 cloudless 2024' };
      } catch { }
    }
    if (best) {
      // colour-match the replacement to this tile's clear pixels (or the whole image if the tile is mostly cloud)
      const s = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; let n = 0; const px = best.px;
      for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) {
        const i = (t.ty * 256 + y) * W + t.tx * 256 + x, q = (y * 256 + x) * 4, p = i * 4; if (m[i] || isCloud(px[q], px[q + 1], px[q + 2])) continue;
        for (let k = 0; k < 3; k++) { s[k] += d[p + k]; s[k + 3] += d[p + k] ** 2; s[k + 6] += px[q + k]; s[k + 9] += px[q + k] ** 2; } n++;
      }
      let mp, sp, mc, sc;
      if (n > 1500) { mp = [0, 1, 2].map(k => s[k] / n); sp = [0, 1, 2].map(k => Math.sqrt(Math.max(1, s[k + 3] / n - mp[k] ** 2))); mc = [0, 1, 2].map(k => s[k + 6] / n); sc = [0, 1, 2].map(k => Math.sqrt(Math.max(1, s[k + 9] / n - mc[k] ** 2))); }
      else {
        const a = [0, 0, 0, 0, 0, 0]; let c = 0; for (let q = 0; q < px.length; q += 8) { for (let k = 0; k < 3; k++) { a[k] += px[q + k]; a[k + 3] += px[q + k] ** 2; } c++; }
        // target colours from clear primary pixels in the surrounding 3x3 tiles (keeps neighbouring swaps consistent)
        const q2 = [0, 0, 0, 0, 0, 0]; let n2 = 0;
        for (let yy = Math.max(0, (t.ty - 1) * 256); yy < Math.min(H, (t.ty + 2) * 256); yy += 3) for (let xx = Math.max(0, (t.tx - 1) * 256); xx < Math.min(W, (t.tx + 2) * 256); xx += 3) {
          const i = yy * W + xx; if (m[i]) continue; const p = i * 4; for (let k = 0; k < 3; k++) { q2[k] += d[p + k]; q2[k + 3] += d[p + k] ** 2; } n2++;
        }
        if (n2 > 3000) { mp = [0, 1, 2].map(k => q2[k] / n2); sp = [0, 1, 2].map(k => Math.sqrt(Math.max(1, q2[k + 3] / n2 - mp[k] ** 2))); }
        else { mp = gMean; sp = gStd; }
        mc = [0, 1, 2].map(k => a[k] / c); sc = [0, 1, 2].map(k => Math.sqrt(Math.max(1, a[k + 3] / c - mc[k] ** 2)));
      }
      const out = new Uint8ClampedArray(256 * 256 * 3);
      for (let i = 0, q = 0; i < 65536; i++, q += 4) for (let k = 0; k < 3; k++) out[i * 3 + k] = (px[q + k] - mc[k]) * Math.min(1.6, Math.max(0.6, sp[k] / sc[k])) + mp[k];
      fills.set(key, { px: out, name: best.name, clearOk: best.score >= 0.8 || best.name.startsWith('Sentinel') });
    }
    done++; say(`Filling clouds ${done}/${cloudy.length}…`);
  });

  // heavily clouded tiles with a clear replacement are swapped whole (no half-transparent smudges)
  for (const t of cloudy) {
    const f = fills.get(t.tx + ',' + t.ty);
    if (f && f.clearOk && t.frac > 0.35) for (let y = 0; y < 256; y++) m.fill(255, (t.ty * 256 + y) * W + t.tx * 256, (t.ty * 256 + y) * W + t.tx * 256 + 256);
  }
  // 3. cloud shadows: near clouds and much darker than the replacement
  const near = boxBlur(m, W, H, 40);
  for (const t of cloudy) {
    const f = fills.get(t.tx + ',' + t.ty); if (!f) continue;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (t.ty * 256 + y) * W + t.tx * 256 + x; if (m[i] || !near[i]) continue;
      const p = i * 4, q = (y * 256 + x) * 3, lf = lum(f.px[q], f.px[q + 1], f.px[q + 2]);
      if (lf > 45 && lum(d[p], d[p + 1], d[p + 2]) < 0.62 * lf) m[i] = 200;
    }
  }
  // 4. feathered blend
  let w = boxBlur(m, W, H, 2); for (let i = 0; i < N; i++) w[i] = w[i] > 0 ? 255 : 0; w = boxBlur(w, W, H, 5);
  const remain = new Uint8Array(N); let filled = 0;
  for (let ty = 0; ty < nty; ty++) for (let tx = 0; tx < ntx; tx++) {
    const f = fills.get(tx + ',' + ty);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (ty * 256 + y) * W + tx * 256 + x, a = w[i] / 255; if (!a) continue;
      if (!f) { if (m[i]) remain[i] = 1; continue; }
      const p = i * 4, q = (y * 256 + x) * 3;
      for (let k = 0; k < 3; k++) d[p + k] = d[p + k] * (1 - a) + f.px[q + k] * a;
      if (m[i] === 255) { if (f.clearOk) filled++; else remain[i] = 1; }
    }
  }
  for (const f of fills.values()) stats.sources[f.name] = (stats.sources[f.name] || 0) + 1;
  ictx.putImageData(data, 0, 0);
  stats.filledPct = filled / N * 100;
  return { stats, remain };
}
