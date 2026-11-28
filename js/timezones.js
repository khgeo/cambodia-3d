// Time zones: Natural Earth 1:10m time-zone polygons (public domain; standard time, no daylight saving),
// drawn onto an equirectangular canvas for a globe overlay, plus live clocks for each zone and for world cities.
let TZ = null;
export async function loadTZ() { if (!TZ) TZ = fetch('data/timezones.json').then(r => r.json()).catch(() => []); return TZ; }
const PAL = ['#ff6b6b', '#ffb84d', '#ffe066', '#7ee081', '#4dd4c6', '#5aa9ff', '#9b8cff', '#ff7fd1'];
// fill + border canvas (W x W/2), Cambodia's zone (UTC+7) outlined
export async function tzCanvas(W = 4096, { alpha = 0.32, highlight = 7 } = {}) {
  const Z = await loadTZ(), H = W / 2, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
  const path = r => { g.beginPath(); let px = null; for (const [lo, la] of r) { const x = X(lo), y = Y(la); if (px != null && Math.abs(x - px) > W / 2) g.moveTo(x, y); else if (px == null) g.moveTo(x, y); else g.lineTo(x, y); px = x; } g.closePath(); };
  for (const z of Z) { const k = Number.isInteger(z.z) ? ((z.z % 8) + 8) % 8 : 6, col = PAL[k]; g.globalAlpha = Number.isInteger(z.z) ? alpha : alpha * 1.4; g.fillStyle = Number.isInteger(z.z) ? col : '#ffffff';
    for (const r of z.r) { path(r); g.fill(); } }
  g.globalAlpha = 0.85; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = Math.max(1, W / 2048); for (const z of Z) for (const r of z.r) { path(r); g.stroke(); }
  g.strokeStyle = '#ffe14d'; g.lineWidth = W / 700; g.globalAlpha = 1; for (const z of Z) if (z.z === highlight) for (const r of z.r) { path(r); g.stroke(); }
  return c;
}
export const fmtTime = (ms, off) => { const d = new Date(ms + off * 36e5); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export const fmtOff = o => `UTC${o >= 0 ? '+' : '−'}${Math.floor(Math.abs(o))}${o % 1 ? ':' + String(Math.round(Math.abs(o % 1) * 60)).padStart(2, '0') : ''}`;
// world clock: the browser's time-zone database gives each city's real local time, daylight saving included
export const CITIES = [['Phnom Penh', 'ភ្នំពេញ', 'Asia/Phnom_Penh', 104.9], ['Bangkok', 'បាងកក', 'Asia/Bangkok', 100.5], ['Hanoi', 'ហាណូយ', 'Asia/Ho_Chi_Minh', 105.8], ['Beijing', 'ប៉េកាំង', 'Asia/Shanghai', 116.4], ['Tokyo', 'តូក្យូ', 'Asia/Tokyo', 139.7], ['Sydney', 'ស៊ីដនី', 'Australia/Sydney', 151.2],
  ['New Delhi', 'ញូវដេលី', 'Asia/Kolkata', 77.2], ['Dubai', 'ឌូបៃ', 'Asia/Dubai', 55.3], ['Moscow', 'មូស្គូ', 'Europe/Moscow', 37.6], ['Paris', 'ប៉ារីស', 'Europe/Paris', 2.35], ['London', 'ឡុងដ៍', 'Europe/London', -0.13], ['New York', 'ញូវយ៉ក', 'America/New_York', -74], ['Los Angeles', 'ឡូសអេនជឺឡេស', 'America/Los_Angeles', -118.2]];
export function cityTime(ms, tz) { try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)), g = k => (p.find(x => x.type === k) || {}).value || '';
  return { time: `${g('hour')}:${g('minute')}`, off: g('timeZoneName').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+0').replace('-', '−') }; } catch (e) { return { time: '--:--', off: '' }; } }
// day or night at a longitude/latitude now: sun altitude from a simple solar position (degrees)
export function sunAlt(ms, lat, lon) { const d = ms / 864e5 + 2440587.5 - 2451545, g = (357.529 + 0.98560028 * d) * Math.PI / 180, q = 280.459 + 0.98564736 * d, L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180, e = 23.439 * Math.PI / 180;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), gmst = (280.46061837 + 360.98564736629 * d) % 360, ha = ((gmst + lon) * Math.PI / 180 - ra), la = lat * Math.PI / 180;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * 180 / Math.PI; }
