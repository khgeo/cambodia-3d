// Magnetic declination from the World Magnetic Model WMM-2025 (NOAA NCEI / BGS, public domain coefficients, valid 2025–2030).
// Spherical-harmonic synthesis, degree 12, Schmidt semi-normalised; geodetic → geocentric on WGS 84.
const G = [0, -29351.8, -1410.8, -2556.6, 2951.1, 1649.3, 1361, -2404.1, 1243.8, 453.6, 895, 799.5, 55.7, -281.1, 12.1, -233.2, 368.9, 187.2, -138.7, -142, 20.9, 64.4, 63.8, 76.9, -115.7, -40.9, 14.9, -60.7, 79.5, -77, -8.8, 59.3, 15.8, 2.5, -11.1, 14.2, 23.2, 10.8, -17.5, 2, -21.7, 16.9, 15, -16.8, 0.9, 4.6, 7.8, 3, -0.2, -2.5, -13.1, 2.4, 8.6, -8.7, -12.9, -1.3, -6.4, 0.2, 2, -1, -0.6, -0.9, 1.5, 0.9, -2.7, -3.9, 2.9, -1.5, -2.5, 2.4, -0.6, -0.1, -0.6, -0.1, 1.1, -1, -0.2, 2.6, -2, -0.2, 0.3, 1.2, -1.3, 0.6, 0.6, 0.5, -0.1, -0.4, -0.2, -1.3, -0.7], H = [0, 0, 4545.4, 0, -3133.6, -815.1, 0, -56.6, 237.5, -549.5, 0, 278.6, -133.9, 212, -375.6, 0, 45.4, 220.2, -122.9, 43, 106.1, 0, -18.4, 16.8, 48.8, -59.8, 10.9, 72.7, 0, -48.9, -14.4, -1, 23.4, -7.4, -25.1, -2.3, 0, 7.1, -12.6, 11.4, -9.7, 12.7, 0.7, -5.2, 3.9, 0, -24.8, 12.2, 8.3, -3.3, -5.2, 7.2, -0.6, 0.8, 10, 0, 3.3, 0, 2.4, 5.3, -9.1, 0.4, -4.2, -3.8, 0.9, -9.1, 0, 0, 2.9, -0.6, 0.2, 0.5, -0.3, -1.2, -1.7, -2.9, -1.8, -2.3, 0, -1.3, 0.7, 1, -1.4, 0, 0.6, -0.1, 0.8, 0.1, -1, 0.1, 0.2], GT = [0, 12, 9.7, -11.6, -5.2, -8, -1.3, -4.2, 0.4, -15.6, -1.6, -2.4, -6, 5.6, -7, 0.6, 1.4, 0, 0.6, 2.2, 0.9, -0.2, -0.4, 0.9, 1.2, -0.9, 0.3, 0.9, 0, -0.1, -0.1, 0.5, -0.1, -0.8, -0.8, 0.8, -0.1, 0.2, 0, 0.5, -0.1, 0.3, 0.2, 0, 0.2, 0, -0.1, 0.1, 0.3, -0.3, 0, 0.3, -0.1, 0.1, -0.1, 0.1, 0, 0.1, 0.1, 0, -0.3, 0, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0, 0, -0.1, -0.1, -0.1, -0.1, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 0, -0.1], HT = [0, 0, -21.5, 0, -27.7, -12.1, 0, 4, -0.3, -4.1, 0, -1.1, 4.1, 1.6, -4.4, 0, -0.5, 2.2, 0.4, 1.7, 1.9, 0, 0.3, -1.6, -0.4, 0.9, 0.7, 0.9, 0, 0.6, 0.5, -0.8, 0, -1, 0.6, -0.2, 0, -0.2, 0.5, -0.4, 0.4, -0.5, -0.6, 0.3, 0.2, 0, -0.3, 0.3, -0.3, 0.3, 0.2, -0.1, -0.2, 0.4, 0.1, 0, 0, 0, -0.2, 0.1, -0.1, 0.1, 0, -0.1, 0.2, 0, 0, 0, 0.1, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1];
const NMAX = 12, EPOCH = 2025, D2R = Math.PI / 180;
export function magnetic(lat, lon, altKm = 0, date = new Date()) {
  const y0 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)), y1 = new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1)), dt = date.getUTCFullYear() + (date - y0) / (y1 - y0) - EPOCH;
  // geodetic → geocentric spherical
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), sl = Math.sin(lat * D2R), cl = Math.cos(lat * D2R), Rc = a / Math.sqrt(1 - e2 * sl * sl);
  const p = (Rc + altKm) * cl, z = (Rc * (1 - e2) + altKm) * sl, r = Math.hypot(p, z), phc = Math.asin(z / r), sp = Math.sin(phc), cp = Math.cos(phc), re = 6371.2;
  // Schmidt semi-normalised associated Legendre functions P[n][m](sin phc) and derivatives wrt latitude
  const P = [], dP = []; for (let n = 0; n <= NMAX; n++) { P.push(new Array(NMAX + 1).fill(0)); dP.push(new Array(NMAX + 1).fill(0)); }
  P[0][0] = 1; dP[0][0] = 0;
  for (let n = 1; n <= NMAX; n++) for (let m = 0; m <= n; m++) {
    if (n === m) { const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n)); P[n][m] = k * cp * P[n - 1][m - 1]; dP[n][m] = k * (cp * dP[n - 1][m - 1] - sp * P[n - 1][m - 1]); }
    else { const k1 = (2 * n - 1) / Math.sqrt(n * n - m * m), k2 = n > 1 ? Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m)) : 0;
      P[n][m] = k1 * sp * P[n - 1][m] - (n > 1 ? k2 * P[n - 2][m] : 0); dP[n][m] = k1 * (sp * dP[n - 1][m] + cp * P[n - 1][m]) - (n > 1 ? k2 * dP[n - 2][m] : 0); }
  }
  let Xp = 0, Yp = 0, Zp = 0; const lam = lon * D2R;
  for (let n = 1; n <= NMAX; n++) { const ar = Math.pow(re / r, n + 2);
    for (let m = 0; m <= n; m++) { const i = n * (n + 1) / 2 + m, g = G[i] + dt * GT[i], h = H[i] + dt * HT[i], cm = Math.cos(m * lam), sm = Math.sin(m * lam), t = g * cm + h * sm;
      Xp -= ar * t * dP[n][m]; Yp += ar * m * (g * sm - h * cm) * P[n][m] / (Math.abs(cp) > 1e-10 ? cp : 1e-10); Zp -= (n + 1) * ar * t * P[n][m]; } }
  // rotate to geodetic frame
  const psi = phc - lat * D2R, X = Xp * Math.cos(psi) - Zp * Math.sin(psi), Y = Yp, Z = Xp * Math.sin(psi) + Zp * Math.cos(psi);
  const Hh = Math.hypot(X, Y);
  return { decl: Math.atan2(Y, X) / D2R, incl: Math.atan2(Z, Hh) / D2R, f: Math.hypot(Hh, Z), x: X, y: Y, z: Z, annual: null, model: 'WMM-2025' };
}
// declination and its yearly change (degrees, east positive)
export function declination(lat, lon, date = new Date()) { const d0 = magnetic(lat, lon, 0, date).decl, d1 = magnetic(lat, lon, 0, new Date(date.getTime() + 365.25 * 864e5)).decl; return { decl: d0, annual: d1 - d0 }; }
