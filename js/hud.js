// Inset map + navigation readout (heading, coordinates, UTM, elevation, speed)
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function utm(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1, a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) Nn += 10000000;
  return { zone, hemi: lat >= 0 ? 'N' : 'S', E, N: Nn };
}

// MGRS (military grid reference), e.g. 48P VU 58857 50159
const BANDS = 'CDEFGHJKLMNPQRSTUVWX', COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'], ROWS = 'ABCDEFGHJKLMNPQRSTUV';
export function mgrs(lat, lon, digits = 5) {
  if (lat < -80 || lat > 84) return ''; const u = utm(lat, lon), band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))], set = ((u.zone - 1) % 3);
  const col = COLS[set][Math.floor(u.E / 100000) - 1], row = ROWS[(Math.floor(u.N / 100000) % 20 + (u.zone % 2 === 0 ? 5 : 0)) % 20], d = 10 ** (5 - digits);
  const e = String(Math.floor((u.E % 100000) / d)).padStart(digits, '0'), n = String(Math.floor((u.N % 100000) / d)).padStart(digits, '0');
  return `${u.zone}${band} ${col}${row} ${e} ${n}`;
}
export function mgrsParse(txt) { // → { zone, north, E, N } or null
  const m = String(txt).toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/); if (!m || m[5].length % 2) return null;
  const zone = +m[1], band = m[2], set = (zone - 1) % 3, ci = COLS[set].indexOf(m[3]), ri0 = ROWS.indexOf(m[4]); if (ci < 0 || ri0 < 0) return null;
  const k = m[5].length / 2, sc = 10 ** (5 - k), E = (ci + 1) * 100000 + (k ? +m[5].slice(0, k) * sc : 0) + sc / 2 * (k < 5 ? 1 : 0), ri = (ri0 - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  const bandLat = -80 + BANDS.indexOf(band) * 8, minN = utm(bandLat, (zone - 1) * 6 - 177).N;
  let N = ri * 100000 + (k ? +m[5].slice(k) * sc : 0) + sc / 2 * (k < 5 ? 1 : 0); while (N < minN - 150000) N += 2000000;
  return { zone, north: bandLat >= 0, E, N };
}

function blank(im) { try { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; let grey = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2]; if (Math.abs(r - gg) < 6 && Math.abs(gg - b) < 6 && r > 185 && r < 235) grey++; } return grey > 200; } catch (e) { return false; } }
export class Hud {
  constructor(root, world) {
    this.w = world; this.root = root; this.canvas = root.querySelector('canvas'); this.text = root.querySelector('.hudtext');
    this.zoom = 0; // 0 auto
    root.querySelector('.hudzoom').onclick = () => { this.zoom = (this.zoom + 1) % 4; };
    setInterval(() => this.draw(), 120);
    // tap / click the inset map to jump there (walk: stand there; drive: nearest road; orbit: look there)
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.view) return; const b = this.canvas.getBoundingClientRect(), v = this.view;
      const x = v.cx - v.win / 2 + (e.clientX - b.left) / b.width * v.win, z = v.cz - v.winZ / 2 + (e.clientY - b.top) / b.height * v.winZ;
      this.w.teleport(x, z); e.preventDefault(); e.stopPropagation();
    });
  }
  // Esri's placeholder tile is flat light grey with a little text: nearly all pixels the same grey
  // (checked on a small copy; needs the tile to be readable, which Esri allows)
  // eslint-disable-next-line
  // Esri imagery tiles at the zoom that fits the window (0.3–4 m per screen pixel), cached; roads drawn on top
  tiles(ctx, cx, cz, win, winZ, S, T, dpr) {
    const F = this.w.F; if (!F) return; const lat0 = F.lat(cz), mpp = win / (S * dpr), z = Math.max(10, Math.min(this.maxZ || 19, Math.round(Math.log2(156543.03 * Math.cos(lat0 * Math.PI / 180) / mpp))));
    const tx = lon => (lon + 180) / 360 * 2 ** z, ty = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
    const lonOf = x => x / 2 ** z * 360 - 180, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
    const toPx = (lon, lat) => [(F.x(lon) - (cx - win / 2)) / win * S, (F.z(lat) - (cz - winZ / 2)) / winZ * T];
    const x0 = Math.floor(tx(F.lon(cx - win / 2))), x1 = Math.floor(tx(F.lon(cx + win / 2))), y0 = Math.floor(ty(F.lat(cz - winZ / 2))), y1 = Math.floor(ty(F.lat(cz + winZ / 2)));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 30) return; const C = this.tc || (this.tc = new Map()); let all = true;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = z + '/' + x + '/' + y; let im = C.get(k);
      if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; const zz = z;
        im.onload = () => { if (blank(im)) { im.bad = true; this.maxZ = Math.min(this.maxZ || 19, zz - 1); } }; // "Map data not yet available": no imagery this close here
        im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`; C.set(k, im); if (C.size > 300) C.delete(C.keys().next().value); }
      if (!im.complete || !im.naturalWidth || im.bad) { all = false; continue; }
      const [ax, ay] = toPx(lonOf(x), latOf(y)), [bx, by] = toPx(lonOf(x + 1), latOf(y + 1)); ctx.drawImage(im, ax, ay, bx - ax + 0.4, by - ay + 0.4); }
    // roads over the imagery
    const R = this.w.net && this.w.net.roads; if (!R) return; ctx.lineCap = ctx.lineJoin = 'round';
    const X0 = cx - win / 2, Z0 = cz - winZ / 2;
    for (const r of R) { const c = r.cls; ctx.strokeStyle = c <= 4 ? 'rgba(255,154,74,.85)' : c <= 10 ? 'rgba(255,224,138,.8)' : 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, Math.min(6, (r.hw || 3) * 2 / win * S * 0.6));
      ctx.beginPath(); let on = false; for (const p of r.pts) { const x = (p.x - X0) / win * S, y = (p.z - Z0) / winZ * T; on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } ctx.stroke(); }
  }
  draw() {
    const w = this.w, h = w.hud, D = w.D, mc = w.miniCanvas;
    if (this.root.hidden || !D || !mc || h.lat === undefined) return;
    // sharp on hi-DPI screens: draw at the real pixel density, in 260 × 163 drawing units
    const cv = this.canvas, ctx = cv.getContext('2d'), S = 260, T = 163, dpr = Math.min(3, (cv.clientWidth || S) / S * (window.devicePixelRatio || 1));
    if (cv.width !== Math.round(S * dpr)) { cv.width = Math.round(S * dpr); cv.height = Math.round(T * dpr); } ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // window size in metres: whole AOI in orbit view, close-up when walking/driving (tap ⊕ to change)
    const auto = h.mode === 'walk' ? 260 : h.mode === 'drive' ? 700 : Math.max(D.W, D.H) * 1.2;
    const win = [auto, 200, 600, Math.max(D.W, D.H) * 1.6][this.zoom];
    const cx = h.x, cz = h.z; // always keep our position in the centre of the inset map
    const winZ = win * T / S; this.view = { cx, cz, win, winZ };
    ctx.fillStyle = '#26303a'; ctx.fillRect(0, 0, S, T);
    const k = mc.width / D.W, sx = (cx - win / 2 - D.X0) * k, sy = (cz - winZ / 2 - D.Z0) * (mc.height / D.H);
    ctx.drawImage(mc, sx, sy, win * k, winZ * (mc.height / D.H), 0, 0, S, T);
    this.tiles(ctx, cx, cz, win, winZ, S, T, dpr); // full-resolution satellite tiles over it, with the roads
    const toPx = (x, z) => [(x - (cx - win / 2)) / win * S, (z - (cz - winZ / 2)) / winZ * T];
    // view cone + position arrow
    const [px, py] = toPx(h.x, h.z), hd = h.heading * Math.PI / 180, fov = Math.min(1.6, (h.fov || 60) * Math.PI / 180 / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, T * 0.36, hd - Math.PI / 2 - fov / 2, hd - Math.PI / 2 + fov / 2); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(px, py); ctx.rotate(hd);
    ctx.fillStyle = '#ff4d3d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // survey target: marker on the map, or an arrow at the edge pointing to it
    const sv = w.survey && w.survey.active && w.survey.target, g = w.surveyHud;
    if (sv) {
      let [tx, ty] = toPx(sv.x, sv.z); const inside = tx > 6 && tx < S - 6 && ty > 6 && ty < T - 6;
      ctx.strokeStyle = 'rgba(55,224,122,.9)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, py);
      if (!inside) { const k = Math.min(Math.abs((S / 2 - 8) / ((tx - px) || 1e-6)), Math.abs((T / 2 - 8) / ((ty - py) || 1e-6))); tx = px + (tx - px) * k; ty = py + (ty - py) * k; }
      ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#37e07a'; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(tx, ty, inside ? 6 : 4, 0, 7); ctx.fill(); ctx.stroke();
    }
    // north arrow
    ctx.fillStyle = 'rgba(17,23,31,.7)'; ctx.beginPath(); ctx.arc(S - 16, 16, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', S - 16, 14); ctx.beginPath(); ctx.moveTo(S - 16, 17); ctx.lineTo(S - 12, 25); ctx.lineTo(S - 20, 25); ctx.fill();
    // scale bar
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000], target = win / 4, len = nice.find(v => v >= target) || 2000, lp = len / win * S;
    ctx.fillStyle = 'rgba(17,23,31,.7)'; ctx.fillRect(6, T - 22, lp + 12, 16); ctx.fillStyle = '#fff'; ctx.fillRect(12, T - 12, lp, 3);
    ctx.font = '600 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', 14, T - 15);
    // readout
    const u = utm(h.lat, h.lon), dir = DIRS[Math.round(h.heading / 45) % 8], kmh = (h.speedShown || 0) * 3.6;
    this.text.innerHTML = `<b>${dir} ${h.heading.toFixed(0).padStart(3, '0')}°</b>${h.mode === 'orbit' ? '' : ` · <b>${kmh.toFixed(kmh < 10 ? 1 : 0)} km/h</b>`} · Elevation ${h.elev.toFixed(0)} m<br>` +
      `${h.lat.toFixed(5)}°N ${h.lon.toFixed(5)}°E<br>UTM ${u.zone}${u.hemi} ${u.E.toFixed(0)} E ${u.N.toFixed(0)} N<br>MGRS ${mgrs(h.lat, h.lon)}`;
    if (sv && g) this.text.innerHTML += `<br><b style="color:#37e07a">🎯 ${g.d >= 1000 ? (g.d / 1000).toFixed(2) + ' km' : g.d.toFixed(g.d < 10 ? 2 : 1) + ' m'} · ${DIRS[Math.round(g.brg / 45) % 8]} ${g.brg.toFixed(0).padStart(3, '0')}° · Δh ${g.dh >= 0 ? '+' : ''}${g.dh.toFixed(1)} m</b>`;
  }
}
