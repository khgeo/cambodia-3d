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

export class Hud {
  constructor(root, world) {
    this.w = world; this.root = root; this.canvas = root.querySelector('canvas'); this.text = root.querySelector('.hudtext');
    this.zoom = 0; // 0 auto
    root.querySelector('.hudzoom').onclick = () => { this.zoom = (this.zoom + 1) % 4; };
    setInterval(() => this.draw(), 120);
    // tap / click the inset map to jump there (walk: stand there; drive: nearest road; orbit: look there)
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.view) return; const b = this.canvas.getBoundingClientRect(), v = this.view;
      const x = v.cx - v.win / 2 + (e.clientX - b.left) / b.width * v.win, z = v.cz - v.win / 2 + (e.clientY - b.top) / b.height * v.win;
      this.w.teleport(x, z); e.preventDefault(); e.stopPropagation();
    });
  }
  draw() {
    const w = this.w, h = w.hud, D = w.D, mc = w.miniCanvas;
    if (this.root.hidden || !D || !mc || h.lat === undefined) return;
    const cv = this.canvas, ctx = cv.getContext('2d'), S = cv.width;
    // window size in metres: whole AOI in orbit view, close-up when walking/driving (tap ⊕ to change)
    const auto = h.mode === 'walk' ? 260 : h.mode === 'drive' ? 700 : Math.max(D.W, D.H) * 1.2;
    const win = [auto, 200, 600, Math.max(D.W, D.H) * 1.6][this.zoom];
    const cx = h.x, cz = h.z; // always keep our position in the centre of the inset map
    this.view = { cx, cz, win };
    ctx.fillStyle = '#26303a'; ctx.fillRect(0, 0, S, S);
    const k = mc.width / D.W, sx = (cx - win / 2 - D.X0) * k, sy = (cz - win / 2 - D.Z0) * (mc.height / D.H);
    ctx.drawImage(mc, sx, sy, win * k, win * (mc.height / D.H), 0, 0, S, S);
    const toPx = (x, z) => [(x - (cx - win / 2)) / win * S, (z - (cz - win / 2)) / win * S];
    // view cone + position arrow
    const [px, py] = toPx(h.x, h.z), hd = h.heading * Math.PI / 180, fov = Math.min(1.6, (h.fov || 60) * Math.PI / 180 / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, S * 0.28, hd - Math.PI / 2 - fov / 2, hd - Math.PI / 2 + fov / 2); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(px, py); ctx.rotate(hd);
    ctx.fillStyle = '#ff4d3d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north arrow
    ctx.fillStyle = 'rgba(17,23,31,.7)'; ctx.beginPath(); ctx.arc(S - 16, 16, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', S - 16, 14); ctx.beginPath(); ctx.moveTo(S - 16, 17); ctx.lineTo(S - 12, 25); ctx.lineTo(S - 20, 25); ctx.fill();
    // scale bar
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000], target = win / 4, len = nice.find(v => v >= target) || 2000, lp = len / win * S;
    ctx.fillStyle = 'rgba(17,23,31,.7)'; ctx.fillRect(6, S - 22, lp + 12, 16); ctx.fillStyle = '#fff'; ctx.fillRect(12, S - 12, lp, 3);
    ctx.font = '600 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', 14, S - 15);
    // readout
    const u = utm(h.lat, h.lon), dir = DIRS[Math.round(h.heading / 45) % 8], kmh = (h.speedShown || 0) * 3.6;
    this.text.innerHTML = `<b>${dir} ${h.heading.toFixed(0).padStart(3, '0')}°</b>${h.mode === 'orbit' ? '' : ` · <b>${kmh.toFixed(kmh < 10 ? 1 : 0)} km/h</b>`}<br>` +
      `${h.lat.toFixed(5)}°N ${h.lon.toFixed(5)}°E<br>UTM ${u.zone}${u.hemi} ${u.E.toFixed(0)} E ${u.N.toFixed(0)} N<br>Elevation ${h.elev.toFixed(0)} m`;
  }
}
