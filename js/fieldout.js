// Field Boundaries outputs: a printable map layout (A3 / A4, title, legend, scale bar, north arrow, coordinate
// grid ticks, location inset, statistics, credits) and an A4 report (HTML, printed to PDF by the app).
export const SIZE = [[0, 1000, '#fde725', '< 1,000 m²'], [1000, 2500, '#5ec962', '1,000–2,500 m²'], [2500, 5000, '#21918c', '2,500–5,000 m²'], [5000, 10000, '#3b528b', '5,000–10,000 m²'], [10000, 1e12, '#440154', '≥ 10,000 m²']];
export const sizeClass = a => SIZE.findIndex(([lo, hi]) => a >= lo && a < hi);
const n0 = v => Math.round(v).toLocaleString('en-US');
export function stats(F) {
  const A = F.map(f => f.area_m2).sort((a, b) => a - b), tot = A.reduce((s, v) => s + v, 0), q = p => A.length ? A[Math.min(A.length - 1, Math.floor(p * A.length))] : 0;
  const cls = SIZE.map(([lo, hi]) => { const s = A.filter(v => v >= lo && v < hi); return { n: s.length, ha: s.reduce((a, b) => a + b, 0) / 1e4 }; });
  const src = {}; F.forEach(f => src[f.src || 'model'] = (src[f.src || 'model'] || 0) + 1);
  return { n: F.length, ha: tot / 1e4, mean: A.length ? tot / A.length : 0, median: q(0.5), p10: q(0.1), p90: q(0.9), min: A[0] || 0, max: A[A.length - 1] || 0, cls, src };
}
const tileImg = (z, x, y) => new Promise(ok => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; });
// the field map itself on the zoom-18 image of the area
export function fieldMap(im, F, W, H, o = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), k = Math.min(W / im.W, H / im.H), ox = (W - im.W * k) / 2, oy = (H - im.H * k) / 2;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.drawImage(im.canvas, ox, oy, im.W * k, im.H * k); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(ox, oy, im.W * k, im.H * k);
  const P = ([lo, la]) => [ox + im.px(lo) * k, oy + im.py(la) * k], lw = Math.max(1, W / 1400);
  F.forEach((f, i) => { const R = f.ring.map(P); g.beginPath(); R.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
    if (o.fill !== false) { g.globalAlpha = 0.38; g.fillStyle = SIZE[Math.max(0, sizeClass(f.area_m2))][2]; g.fill(); g.globalAlpha = 1; }
    g.strokeStyle = '#ffe14a'; g.lineWidth = 1.6 * lw; g.stroke(); });
  if (o.ids) { g.font = `600 ${Math.round(9 * lw)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    F.forEach((f, i) => { const R = f.ring.map(P); let x = 0, y = 0; R.forEach(p => { x += p[0]; y += p[1]; }); x /= R.length; y /= R.length; const side = Math.sqrt(f.area_m2) / im.mpp * k; if (side < 18 * lw) return; g.lineWidth = 3 * lw; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(i + 1, x, y); g.fillStyle = '#fff'; g.fillText(i + 1, x, y); }); }
  return { canvas: c, k, ox, oy };
}
// a print layout on one canvas: map frame left, side panel right
export async function layout(im, F, meta, paper = 'A3') {
  const mm = paper === 'A3' ? [420, 297] : [297, 210], S = 6, W = mm[0] * S, H = mm[1] * S, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); const M = 10 * S, side = 95 * S, mw = W - 2 * M - side - 6 * S, mh = H - 2 * M - 22 * S, mx = M, my = M + 22 * S;
  const kh = '"Noto Sans Khmer", '; try { await document.fonts.load('16px "Noto Sans Khmer"', 'ក'); await document.fonts.load('700 16px "Noto Sans Khmer"', 'ក'); } catch (e) { }
  g.fillStyle = '#16324f'; g.font = `700 ${11 * S}px ${kh}system-ui`; g.textBaseline = 'alphabetic'; g.fillText(meta.title, M, M + 10 * S);
  g.fillStyle = '#4a5a6a'; g.font = `${4.6 * S}px ${kh}system-ui`; g.fillText(meta.subtitle, M, M + 17 * S);
  const fm = fieldMap(im, F, mw, mh, { ids: meta.ids }); g.drawImage(fm.canvas, mx, my); g.strokeStyle = '#222'; g.lineWidth = 0.4 * S; g.strokeRect(mx, my, mw, mh);
  // coordinate ticks on the frame
  const k = fm.k, X = lo => mx + fm.ox + im.px(lo) * k, Y = la => my + fm.oy + im.py(la) * k, a = meta.aoi, step = (a.e - a.w) > 0.03 ? 0.01 : 0.005;
  g.fillStyle = '#222'; g.font = `${2.8 * S}px system-ui`; g.lineWidth = 0.25 * S;
  for (let lo = Math.ceil(a.w / step) * step; lo <= a.e; lo += step) { const x = X(lo); if (x < mx || x > mx + mw) continue; g.beginPath(); g.moveTo(x, my); g.lineTo(x, my - 2 * S); g.moveTo(x, my + mh); g.lineTo(x, my + mh + 2 * S); g.stroke(); g.textAlign = 'center'; g.fillText(lo.toFixed(3) + '°E', x, my + mh + 5.2 * S); }
  for (let la = Math.ceil(a.s / step) * step; la <= a.n; la += step) { const y = Y(la); if (y < my || y > my + mh) continue; g.beginPath(); g.moveTo(mx, y); g.lineTo(mx - 2 * S, y); g.moveTo(mx + mw, y); g.lineTo(mx + mw + 2 * S, y); g.stroke(); g.save(); g.translate(mx - 3 * S, y); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(la.toFixed(3) + '°N', 0, 0); g.restore(); }
  // side panel
  const sx = W - M - side; let y = my;
  const head = t => { g.fillStyle = '#16324f'; g.font = `700 ${4.4 * S}px ${kh}system-ui`; g.textAlign = 'left'; g.fillText(t, sx, y + 4 * S); y += 7 * S; };
  // north arrow + scale bar
  g.fillStyle = '#222'; g.beginPath(); g.moveTo(sx + 8 * S, y); g.lineTo(sx + 3 * S, y + 14 * S); g.lineTo(sx + 8 * S, y + 11 * S); g.lineTo(sx + 13 * S, y + 14 * S); g.closePath(); g.fill(); g.font = `700 ${4 * S}px system-ui`; g.textAlign = 'center'; g.fillText('N', sx + 8 * S, y + 19 * S);
  const mpp = im.mpp / k, nice = [50, 100, 200, 250, 500, 1000].filter(v => v / mpp < 60 * S).pop() || 100, bw = nice / mpp, bx = sx + 22 * S, by = y + 8 * S;
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff' : '#222'; g.fillRect(bx + i * bw / 4, by, bw / 4, 2 * S); } g.strokeStyle = '#222'; g.strokeRect(bx, by, bw, 2 * S);
  g.fillStyle = '#222'; g.font = `${3 * S}px system-ui`; g.fillText('0', bx, by + 6 * S); g.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', bx + bw, by + 6 * S);
  g.textAlign = 'left'; g.fillText(`1:${n0(Math.round(mpp / 0.000254 / 1000) * 1000)} (${paper})`, bx, by + 11 * S); y += 26 * S;
  head(meta.L.legend); g.font = `${3.4 * S}px ${kh}system-ui`;
  const st = stats(F); SIZE.forEach(([lo, hi, col, lab], i) => { g.globalAlpha = 0.6; g.fillStyle = col; g.fillRect(sx, y, 7 * S, 4.5 * S); g.globalAlpha = 1; g.strokeStyle = '#ffd000'; g.lineWidth = 0.4 * S; g.strokeRect(sx, y, 7 * S, 4.5 * S); g.fillStyle = '#222'; g.fillText(`${lab}  ·  ${st.cls[i].n} (${st.cls[i].ha.toFixed(1)} ha)`, sx + 10 * S, y + 3.6 * S); y += 6.3 * S; });
  g.strokeStyle = '#ffe14a'; g.lineWidth = 0.8 * S; g.strokeRect(sx + 0.5 * S, y + 0.5 * S, 6 * S, 3.5 * S); g.fillStyle = '#222'; g.fillText(meta.L.boundary || 'Field boundary', sx + 10 * S, y + 3.6 * S); y += 6 * S;
  y += 4 * S; head(meta.L.stats); g.font = `${3.4 * S}px ${kh}system-ui`;
  for (const [l, v] of [[meta.L.fields, n0(st.n)], [meta.L.total, st.ha.toFixed(1) + ' ha'], [meta.L.median, n0(st.median) + ' m²'], [meta.L.mean, n0(st.mean) + ' m²'], ['P10 – P90', `${n0(st.p10)} – ${n0(st.p90)} m²`]]) { g.fillStyle = '#4a5a6a'; g.fillText(l, sx, y + 3.5 * S); g.fillStyle = '#111'; g.textAlign = 'right'; g.fillText(v, sx + side, y + 3.5 * S); g.textAlign = 'left'; y += 5.6 * S; }
  // location inset (Cambodia, Esri imagery z6)
  y += 4 * S; head(meta.L.location); const iw = side, ih = iw * 0.78, kb = [102.2, 10.2, 107.8, 14.8], lx = lo => (lo + 180) / 360, ly = la => (1 - Math.log(Math.tan(la * Math.PI / 180) + 1 / Math.cos(la * Math.PI / 180)) / Math.PI) / 2, n = 64, ix0 = lx(kb[0]), iy0 = ly(kb[3]), s2 = Math.min(iw / (lx(kb[2]) - ix0), ih / (ly(kb[1]) - iy0)), jobs = [];
  g.save(); g.beginPath(); g.rect(sx, y, iw, ih); g.clip(); for (let tx = Math.floor(ix0 * n); tx <= Math.floor(lx(kb[2]) * n); tx++) for (let ty = Math.floor(iy0 * n); ty <= Math.floor(ly(kb[1]) * n); ty++) jobs.push(tileImg(6, tx, ty).then(t => t && g.drawImage(t, sx + (tx / n - ix0) * s2, y + (ty / n - iy0) * s2, s2 / n + 1, s2 / n + 1)));
  await Promise.all(jobs); const cx = sx + (lx((a.w + a.e) / 2) - ix0) * s2, cy = y + (ly((a.s + a.n) / 2) - iy0) * s2; g.strokeStyle = '#ff2b2b'; g.lineWidth = 0.7 * S; g.beginPath(); g.arc(cx, cy, 2.5 * S, 0, 7); g.stroke(); g.restore(); g.strokeStyle = '#222'; g.lineWidth = 0.3 * S; g.strokeRect(sx, y, iw, ih); y += ih + 6 * S;
  // credits
  g.fillStyle = '#4a5a6a'; g.font = `${2.7 * S}px ${kh}system-ui`; for (const t of meta.credits) { let line = ''; for (const w of t.split(' ')) { const tryL = line ? line + ' ' + w : w; if (g.measureText(tryL).width > side && line) { g.fillText(line, sx, y + 3 * S); y += 4.2 * S; line = w; } else line = tryL; } if (line) { g.fillText(line, sx, y + 3 * S); y += 4.2 * S; } }
  g.textAlign = 'left'; g.fillText(`${meta.L.date}: ${meta.date} · WGS 84 / EPSG:4326 · Cambodia 3D`, M, H - M + 6 * S);
  return { canvas: c, mm };
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function reportHTML(F, meta, mapUrl, L) {
  const st = stats(F), mx = Math.max(1, ...st.cls.map(c => c.n)), rows = F.map((f, i) => [i + 1, f]).slice(0, 400);
  const bars = `<svg viewBox="0 0 520 150" width="100%"><g font-size="11" font-family="system-ui">${st.cls.map((c, i) => `<rect x="${20 + i * 100}" y="${120 - 100 * c.n / mx}" width="70" height="${100 * c.n / mx}" fill="${SIZE[i][2]}"/><text x="${55 + i * 100}" y="${114 - 100 * c.n / mx}" text-anchor="middle">${c.n}</text><text x="${55 + i * 100}" y="138" text-anchor="middle">${esc(SIZE[i][3])}</text>`).join('')}</g></svg>`;
  return `<!doctype html><html><head><meta charset=utf-8><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;700&display=swap" rel=stylesheet><style>
body{font:13px/1.5 "Noto Sans Khmer",system-ui,sans-serif;color:#1d2733;margin:0;padding:22px 26px;width:768px}h1{font-size:22px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #2e5c8a;padding-bottom:3px;color:#22476b}
.sub{color:#5a6b7c}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.k div{background:#f3f6f9;border-radius:8px;padding:8px 10px}.k b{display:block;font-size:18px}
table{border-collapse:collapse;width:100%;font-size:11px}td,th{border-bottom:1px solid #dde3e9;padding:3px 5px;text-align:left}th{background:#eef2f6}.r{text-align:right;font-variant-numeric:tabular-nums}img{width:100%;border:1px solid #ccd;border-radius:4px}
.foot{color:#6b7a89;font-size:10.5px;margin-top:16px;border-top:1px solid #dde3e9;padding-top:6px}.cols{columns:2;column-gap:18px}</style></head><body>
<div class=sub>${esc(L.report)} · ${esc(meta.date)}</div><h1>${esc(meta.title)}</h1><div class=sub>${esc(meta.subtitle)}</div>
<div class=k><div>${esc(L.fields)}<b>${n0(st.n)}</b></div><div>${esc(L.total)}<b>${st.ha.toFixed(1)} ha</b></div><div>${esc(L.median)}<b>${n0(st.median)} m²</b></div><div>${esc(L.mean)}<b>${n0(st.mean)} m²</b></div></div>
<h2>${esc(L.map)}</h2><img src="${mapUrl}">
<h2>${esc(L.sizes)}</h2>${bars}<table><tr><th>${esc(L.cls)}</th><th class=r>${esc(L.fields)}</th><th class=r>ha</th><th class=r>%</th></tr>${st.cls.map((c, i) => `<tr><td>${esc(SIZE[i][3])}</td><td class=r>${c.n}</td><td class=r>${c.ha.toFixed(2)}</td><td class=r>${st.ha ? (100 * c.ha / st.ha).toFixed(1) : 0}</td></tr>`).join('')}</table>
<p class=sub>P10 ${n0(st.p10)} m² · P90 ${n0(st.p90)} m² · min ${n0(st.min)} m² · max ${n0(st.max)} m² · ${esc(L.sources)}: ${Object.entries(st.src).map(([k, v]) => `${esc(L[k] || k)} ${v}`).join(', ')}</p>
${(meta.owners || []).length ? `<h2>${esc(L.owners || 'Land owners')}</h2><table><tr><th>${esc(L.owner || 'Owner')}</th><th>${esc(L.village || 'Village')}</th><th class=r>${esc(L.lots || 'Lots')}</th><th class=r>ha</th><th>${esc(L.house || 'House')}</th></tr>${meta.owners.map(o => { const lf = F.filter(f => f.owner_id === o.id); return `<tr><td>${esc(o.name)}</td><td>${esc(o.village || '')}</td><td class=r>${lf.length}</td><td class=r>${(lf.reduce((a, f) => a + f.area_m2, 0) / 1e4).toFixed(2)}</td><td>${o.house ? o.house[1].toFixed(5) + ', ' + o.house[0].toFixed(5) : '—'}</td></tr>`; }).join('')}</table><p class=sub>${esc(L.ownerNote || '')}</p>` : ''}
<h2>${esc(L.method)}</h2><p>${esc(L.methodText)}</p>
<h2>${esc(L.list)}</h2><div class=cols><table><tr><th>ID</th><th class=r>m²</th><th class=r>ha</th><th class=r>${esc(L.perim)}</th><th>${esc(L.src)}</th></tr>${rows.map(([i, f]) => `<tr><td>${i}</td><td class=r>${n0(f.area_m2)}</td><td class=r>${(f.area_m2 / 1e4).toFixed(3)}</td><td class=r>${f.perim_m ? n0(f.perim_m) : '–'}</td><td>${esc(L[f.src || 'model'] || f.src || '')}</td></tr>`).join('')}</table></div>
${F.length > 400 ? `<p class=sub>${esc(L.more.replace('%d', F.length - 400))}</p>` : ''}
<div class=foot>${meta.credits.map(esc).join('<br>')}</div></body></html>`;
}
