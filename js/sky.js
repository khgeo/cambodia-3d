// Night sky (from the StarChart KH plugin): astronomy after Paul Schlyter (Sun, Moon, planets, ~1–2'), IAU 1976
// precession, horizontal coordinates, an all-sky horizon chart for the area and time, and real stars for the 3D sky.
// Star data: d3-celestial (Olaf Frohn, BSD-3) — Hipparcos / Yale Bright Star Catalogue.
const D2R = Math.PI / 180, R2D = 180 / Math.PI, rev = x => ((x % 360) + 360) % 360, sind = x => Math.sin(x * D2R), cosd = x => Math.cos(x * D2R), atan2d = (y, x) => Math.atan2(y, x) * R2D;
export const julian = d => d.getTime() / 864e5 + 2440587.5;
const gmst = jd => { const t = (jd - 2451545) / 36525; return rev(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t ** 3 / 38710000); };
export const lst = (jd, lon) => rev(gmst(jd) + lon);
export function precess(ra, dec, jd) {
  const t = (jd - 2451545) / 36525, zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600, z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600, th = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600;
  const a = cosd(dec) * sind(ra + zeta), b = cosd(th) * cosd(dec) * cosd(ra + zeta) - sind(th) * sind(dec), c = sind(th) * cosd(dec) * cosd(ra + zeta) + cosd(th) * sind(dec);
  return [rev(atan2d(a, b) + z), Math.asin(Math.max(-1, Math.min(1, c))) * R2D];
}
export function eqToHor(ra, dec, lat, L) { const ha = L - ra, sa = sind(dec) * sind(lat) + cosd(dec) * cosd(lat) * cosd(ha), alt = Math.asin(Math.max(-1, Math.min(1, sa))) * R2D, az = atan2d(-sind(ha) * cosd(dec), sind(dec) * cosd(lat) - cosd(dec) * sind(lat) * cosd(ha)); return [alt, rev(az)]; }
// atmospheric refraction (Bennett), degrees
const refr = alt => alt > -1 ? 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * D2R) / 60 : 0;

const EL = { Mercury: [[48.3313, 3.24587e-5], [7.0047, 5e-8], [29.1241, 1.01444e-5], [0.387098, 0], [0.205635, 5.59e-10], [168.6562, 4.0923344368]], Venus: [[76.6799, 2.4659e-5], [3.3946, 2.75e-8], [54.891, 1.38374e-5], [0.72333, 0], [0.006773, -1.302e-9], [48.0052, 1.6021302244]],
  Mars: [[49.5574, 2.11081e-5], [1.8497, -1.78e-8], [286.5016, 2.92961e-5], [1.523688, 0], [0.093405, 2.516e-9], [18.6021, 0.5240207766]], Jupiter: [[100.4542, 2.76854e-5], [1.303, -1.557e-7], [273.8777, 1.64505e-5], [5.20256, 0], [0.048498, 4.469e-9], [19.895, 0.0830853001]],
  Saturn: [[113.6634, 2.3898e-5], [2.4886, -1.081e-7], [339.3939, 2.97661e-5], [9.55475, 0], [0.055546, -9.499e-9], [316.967, 0.0334442282]], Uranus: [[74.0005, 1.3978e-5], [0.7733, 1.9e-8], [96.6612, 3.0565e-5], [19.18171, -1.55e-8], [0.047318, 7.45e-9], [142.5905, 0.011725806]],
  Neptune: [[131.7806, 3.0173e-5], [1.77, -2.55e-7], [272.8461, -6.027e-6], [30.05826, 3.313e-8], [0.008606, 2.15e-9], [260.2471, 0.005995147]] };
export const BODY_KM = { Sun: 'អាទិត្យ', Moon: 'ច័ន្ទ', Mercury: 'ពុធ', Venus: 'សុក្រ', Mars: 'អង្គារ', Jupiter: 'ព្រហស្បតិ៍', Saturn: 'សៅរ៍', Uranus: 'អ៊ុយរ៉ានុស', Neptune: 'នេបទូន' };
const kepler = (M, e) => { let E = M + R2D * e * sind(M) * (1 + e * cosd(M)); for (let k = 0; k < 10; k++) { const E1 = E - (E - R2D * e * sind(E) - M) / (1 - e * cosd(E)); if (Math.abs(E1 - E) < 1e-7) return E1; E = E1; } return E; };
const helio = (el, d) => { const [N, i, w, a, e, M] = el.map(([v, r]) => v + r * d), E = kepler(rev(M), e), xv = a * (cosd(E) - e), yv = a * Math.sqrt(1 - e * e) * sind(E), v = atan2d(yv, xv), r = Math.hypot(xv, yv);
  return [r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i)), r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i)), r * sind(v + w) * sind(i), rev(M)]; };
const sunPos = d => { const w = 282.9404 + 4.70935e-5 * d, e = 0.016709 - 1.151e-9 * d, M = rev(356.047 + 0.9856002585 * d), E = M + R2D * e * sind(M) * (1 + e * cosd(M)), xv = cosd(E) - e, yv = Math.sqrt(1 - e * e) * sind(E), v = atan2d(yv, xv), r = Math.hypot(xv, yv), lon = rev(v + w); return [r * cosd(lon), r * sind(lon), lon, M, w]; };
const eclToEq = (x, y, z, d) => { const ecl = 23.4393 - 3.563e-7 * d, xe = x, ye = y * cosd(ecl) - z * sind(ecl), ze = y * sind(ecl) + z * cosd(ecl); return [rev(atan2d(ye, xe)), atan2d(ze, Math.hypot(xe, ye))]; };
const toJ2000 = (lon, d) => lon - 3.82394e-5 * d;
// geocentric J2000 RA/Dec (Moon topocentric when lat/lon given), magnitude, Moon phase
export function bodies(jd, lat, lon) {
  const d = jd - 2451543.5, [xs, ys, lsun, Ms, ws] = sunPos(d), out = {};
  { const l = toJ2000(lsun, d), [ra, dec] = eclToEq(cosd(l), sind(l), 0, d); out.Sun = { ra, dec, mag: -26.7 }; }
  { const N = 125.1228 - 0.0529538083 * d, i = 5.1454, w = 318.0634 + 0.1643573223 * d, a = 60.2666, e = 0.0549, M = rev(115.3654 + 13.0649929509 * d), E = kepler(M, e);
    const xv = a * (cosd(E) - e), yv = a * Math.sqrt(1 - e * e) * sind(E), v = atan2d(yv, xv); let r = Math.hypot(xv, yv);
    const xh = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i)), yh = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i)), zh = r * sind(v + w) * sind(i);
    let lonm = atan2d(yh, xh), latm = atan2d(zh, Math.hypot(xh, yh)); const Lm = rev(N + w + M), Ls = rev(Ms + ws), Dd = rev(Lm - Ls), F = rev(Lm - N);
    lonm += -1.274 * sind(M - 2 * Dd) + 0.658 * sind(2 * Dd) - 0.186 * sind(Ms) - 0.059 * sind(2 * M - 2 * Dd) - 0.057 * sind(M - 2 * Dd + Ms) + 0.053 * sind(M + 2 * Dd) + 0.046 * sind(2 * Dd - Ms) + 0.041 * sind(M - Ms) - 0.035 * sind(Dd) - 0.031 * sind(M + Ms) - 0.015 * sind(2 * F - 2 * Dd) + 0.011 * sind(M - 4 * Dd);
    latm += -0.173 * sind(F - 2 * Dd) - 0.055 * sind(M - F - 2 * Dd) - 0.046 * sind(M + F - 2 * Dd) + 0.033 * sind(F + 2 * Dd) + 0.017 * sind(2 * M + F); r += -0.58 * cosd(M - 2 * Dd) - 0.46 * cosd(2 * Dd); lonm = toJ2000(lonm, d);
    let [ra, dec] = eclToEq(r * cosd(lonm) * cosd(latm), r * sind(lonm) * cosd(latm), r * sind(latm), d);
    if (lat != null) { const par = Math.asin(1 / r) * R2D, gclat = lat - 0.1924 * sind(2 * lat), rho = 0.99833 + 0.00167 * cosd(2 * lat), ha = rev(lst(jd, lon) - ra), g = atan2d(Math.tan(gclat * D2R), cosd(ha));
      ra -= par * rho * cosd(gclat) * sind(ha) / Math.max(cosd(dec), 1e-6); if (Math.abs(g) > 1e-6) dec -= par * rho * sind(gclat) * sind(g - dec) / sind(g); }
    const ls = toJ2000(lsun, d), el = Math.acos(Math.max(-1, Math.min(1, cosd(lonm - ls) * cosd(latm)))) * R2D; out.Moon = { ra: rev(ra), dec, mag: -12.7, phase: (1 - cosd(el)) / 2, waxing: rev(lonm - ls) < 180 }; }
  const MAGB = { Mercury: [-0.36, 0.027, 2.2e-13, 6], Venus: [-4.34, 0.013, 4.2e-7, 3], Mars: [-1.51, 0.016, 0, 1], Jupiter: [-9.25, 0.014, 0, 1], Saturn: [-9, 0.044, 0, 1], Uranus: [-7.15, 0.001, 0, 1], Neptune: [-6.9, 0.001, 0, 1] };
  for (const [name, el] of Object.entries(EL)) {
    let [xh, yh, zh] = helio(el, d);
    if (name === 'Jupiter' || name === 'Saturn') { const Mj = rev(19.895 + 0.0830853001 * d), Mst = rev(316.967 + 0.0334442282 * d); let lo = atan2d(yh, xh), la = atan2d(zh, Math.hypot(xh, yh)); const rr = Math.hypot(xh, yh, zh);
      if (name === 'Jupiter') lo += -0.332 * sind(2 * Mj - 5 * Mst - 67.6) - 0.056 * sind(2 * Mj - 2 * Mst + 21) + 0.042 * sind(3 * Mj - 5 * Mst + 21) - 0.036 * sind(Mj - 2 * Mst) + 0.022 * cosd(Mj - Mst) + 0.023 * sind(2 * Mj - 3 * Mst + 52) - 0.016 * sind(Mj - 5 * Mst - 69);
      else { lo += 0.812 * sind(2 * Mj - 5 * Mst - 67.6) - 0.229 * cosd(2 * Mj - 4 * Mst - 2) + 0.119 * sind(Mj - 2 * Mst - 3) + 0.046 * sind(2 * Mj - 6 * Mst - 69) + 0.014 * sind(Mj - 3 * Mst + 32); la += -0.02 * cosd(2 * Mj - 4 * Mst - 2) + 0.018 * sind(2 * Mj - 6 * Mst - 49); }
      xh = rr * cosd(lo) * cosd(la); yh = rr * sind(lo) * cosd(la); zh = rr * sind(la); }
    const xg = xh + xs, yg = yh + ys, zg = zh; let lg = atan2d(yg, xg); const bg = atan2d(zg, Math.hypot(xg, yg)), dist = Math.hypot(xg, yg, zg); lg = toJ2000(lg, d);
    const [ra, dec] = eclToEq(dist * cosd(lg) * cosd(bg), dist * sind(lg) * cosd(bg), dist * sind(bg), d), rh = Math.hypot(xh, yh, zh), fv = Math.acos(Math.max(-1, Math.min(1, (rh * rh + dist * dist - 1) / (2 * rh * dist)))) * R2D, b = MAGB[name];
    out[name] = { ra, dec, mag: Math.round((b[0] + 5 * Math.log10(rh * dist) + b[1] * fv + b[2] * fv ** b[3]) * 10) / 10 };
  }
  return out;
}

let SKY = null;
export async function loadSky() { if (!SKY) SKY = await (await fetch('data/sky.json')).json(); return SKY; }
// alt/az of everything for a place and time
export function skyNow(S, lat, lon, date) {
  const jd = julian(date), L = lst(jd, lon), stars = [];
  for (const [ra, dec, mag, bv, id] of S.stars) { const [r2, d2] = precess(ra, dec, jd), [alt, az] = eqToHor(r2, d2, lat, L); stars.push({ alt: alt + refr(alt), az, mag, bv, id }); }
  const B = bodies(jd, lat, lon), body = {}; for (const [k, v] of Object.entries(B)) { const [r2, d2] = precess(v.ra, v.dec, jd), [alt, az] = eqToHor(r2, d2, lat, L); body[k] = { ...v, alt: alt + refr(alt), az }; }
  return { jd, L, stars, body, hor: (ra, dec) => { const [r2, d2] = precess(ra, dec, jd), [alt, az] = eqToHor(r2, d2, lat, L); return [alt + refr(alt), az]; } };
}
export const bvColor = bv => { const t = Math.max(-0.4, Math.min(2, bv)); return t < 0 ? [170, 191, 255] : t < 0.4 ? [202 + t * 50, 215 + t * 40, 255] : t < 0.8 ? [255, 244 - (t - 0.4) * 40, 234 - (t - 0.4) * 110] : t < 1.4 ? [255, 228 - (t - 0.8) * 90, 190 - (t - 0.8) * 150] : [255, 180, 100]; };

// Moon disc with its lit part (phase 0 = new, 1 = full); the lit limb faces the Sun
function moonPhase(g, x, y, r, ph, waxing) {
  g.fillStyle = '#3a3f4a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); const s = waxing ? 1 : -1, k = Math.abs(1 - 2 * ph) * r;
  g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(x, y, r, -Math.PI / 2, Math.PI / 2, s < 0); // lit half (east limb when waxing as drawn)
  g.ellipse(x, y, k, r, 0, Math.PI / 2, -Math.PI / 2, (ph > 0.5) === (s > 0)); g.fill();
}
/* all-sky horizon chart (zenith in the centre, north up, east LEFT – as you see the sky lying on your back) */
export function drawChart(cv, S, lat, lon, date, o = {}) {
  const u = o.px || 1, few = !!o.small, g = cv.getContext('2d'), W = cv.width, H = cv.height, R = Math.min(W, H) / 2 - (few ? 24 : 34) * u, cx = W / 2, cy = H / 2 + 6 * u, sky = skyNow(S, lat, lon, date), lang = o.lang || 'both';
  const P = (alt, az) => { const r = R * Math.tan((90 - alt) * D2R / 2) / Math.tan(45 * D2R); return [cx - Math.sin(az * D2R) * r, cy - Math.cos(az * D2R) * r]; };
  const sunAlt = sky.body.Sun.alt, night = sunAlt < -12, twi = Math.max(0, Math.min(1, (sunAlt + 18) / 24));
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R); bg.addColorStop(0, `rgb(${10 + 60 * twi},${18 + 80 * twi},${40 + 120 * twi})`); bg.addColorStop(1, `rgb(${20 + 90 * twi},${30 + 100 * twi},${60 + 120 * twi})`);
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = bg; g.fill(); g.clip();
  // grid: altitude 30/60, azimuth every 45°
  g.strokeStyle = 'rgba(140,170,210,.18)'; g.lineWidth = u; for (const a of [30, 60]) { g.beginPath(); for (let az = 0; az <= 360; az += 3) { const [x, y] = P(a, az); az ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  for (let az = 0; az < 360; az += 45) { const [x, y] = P(0, az); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
  // constellation lines
  g.strokeStyle = 'rgba(120,170,255,.5)'; g.lineWidth = 1.1 * u;
  for (const segs of Object.values(S.lines)) for (const seg of segs) { g.beginPath(); let started = false; for (const [ra, dec] of seg) { const [alt, az] = sky.hor(ra, dec); if (alt < -2) { started = false; continue; } const [x, y] = P(alt, az); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; } g.stroke(); }
  // stars
  const lim = o.maglim || 5.5;
  for (const s of sky.stars) { if (s.alt < 0 || s.mag > lim) continue; const [x, y] = P(s.alt, s.az), r = Math.max(0.6, (lim + 1 - s.mag) * 0.75) * u, [cr, cg, cb] = bvColor(s.bv); g.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${night ? 1 : 0.45 + 0.55 * (1 - twi)})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  // star names (brightest) and constellation names
  g.font = `${11 * u}px system-ui`; g.fillStyle = 'rgba(220,230,255,.85)'; for (const s of sky.stars) { const nm = S.names[s.id]; if (!nm || s.alt < 5 || s.mag > (few ? 0.9 : 2.2)) continue; const [x, y] = P(s.alt, s.az); g.fillText(nm, x + 5 * u, y - 4 * u); }
  g.font = `600 ${11.5 * u}px "Noto Sans Khmer", system-ui`; g.textAlign = 'center';
  for (const [id, en, ra, dec, rank] of S.cons) { if (few ? rank > 1 : (rank > 2 && !S.km[id])) continue; const [alt, az] = sky.hor(ra, dec); if (alt < 8) continue; const [x, y] = P(alt, az), k = S.km[id]; g.fillStyle = k ? 'rgba(255,214,120,.95)' : 'rgba(150,190,255,.8)'; g.fillText(lang === 'km' && k ? k : lang === 'both' && k && !few ? `${k} · ${en}` : (few && lang !== 'en' && k ? k : en), x, y); }
  // Moon and planets (Sun if above the horizon)
  for (const [k, b] of Object.entries(sky.body)) { if (b.alt < 0) continue; const [x, y] = P(b.alt, b.az), col = { Sun: '#ffd84a', Moon: '#f4f1e6', Mars: '#ff7a4a', Venus: '#fff6c9', Jupiter: '#ffe2b0', Saturn: '#f0d58a', Mercury: '#d8cfc0' }[k] || '#cde';
    const r = (k === 'Sun' ? 11 : k === 'Moon' ? 9 : Math.max(3, 5 - b.mag * 0.8)) * u; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (k === 'Moon') moonPhase(g, x, y, r, b.phase, b.waxing);
    g.font = `600 ${12 * u}px "Noto Sans Khmer", system-ui`; g.textAlign = 'left'; g.fillStyle = col; g.fillText(lang === 'km' ? BODY_KM[k] : lang === 'both' && !few ? `${BODY_KM[k]} ${k}` : k, x + r + 4 * u, y + 4 * u); }
  g.restore();
  // horizon ring and directions
  g.strokeStyle = '#7f95ad'; g.lineWidth = 2 * u; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  const DIRS = lang === 'en' || (few && lang !== 'km') ? ['N', 'E', 'S', 'W'] : lang === 'km' ? ['ជើង', 'កើត', 'ត្បូង', 'លិច'] : ['ជើង N', 'កើត E', 'ត្បូង S', 'លិច W'];
  g.font = `700 ${14 * u}px "Noto Sans Khmer", system-ui`; g.fillStyle = '#ffd27a'; g.textAlign = 'center'; g.textBaseline = 'middle'; [0, 90, 180, 270].forEach((az, k) => { const [x, y] = P(few ? -5.5 : -9, az); g.fillText(DIRS[k], x, y); });
  g.textBaseline = 'alphabetic';
  return sky;
}
