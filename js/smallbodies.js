// Small bodies of the Solar System: comets and asteroids on their real orbits (NASA/JPL Small-Body Database),
// meteor showers with their parent bodies, CNEOS fireballs and close approaches (snapshot), and the layers of
// Earth's atmosphere where meteoroids become meteors.
const D2R = Math.PI / 180, K = 0.01720209895; // Gaussian gravitational constant, rad/day (AU, days)
let DATA = null;
export async function loadSmall() { if (!DATA) DATA = fetch('data/smallbodies.json').then(r => r.json()).catch(e => { console.warn('small bodies', e); return { bodies: [], fireballs: [], cad: [] }; }); return DATA; }
export const jdOf = ms => ms / 864e5 + 2440587.5;

// heliocentric ecliptic J2000 position (AU) from q, e, i, Ω, ω, time of perihelion: ellipse, parabola or hyperbola
export function kepler(o, jd) {
  const { q, e } = o, tp = o.tpn && Math.abs(jd - o.tpn) < Math.abs(jd - o.tp) ? o.tpn : o.tp, dt = jd - tp; let x, y; // tpn: the next perihelion as JPL predicts it (planets pull long orbits)
  if (Math.abs(e - 1) < 1e-3) { // near-parabolic: Barker's equation
    const W = 1.5 * K * dt / Math.sqrt(2 * q * q * q), B = Math.cbrt(W + Math.sqrt(W * W + 1)), s = B - 1 / B, nu = 2 * Math.atan(s), r = q * (1 + s * s);
    x = r * Math.cos(nu); y = r * Math.sin(nu);
  } else if (e < 1) { const a = q / (1 - e), M = K / Math.pow(a, 1.5) * dt; let E = M + e * Math.sin(M);
    for (let k = 0; k < 30; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else { const a = q / (e - 1), M = K / Math.pow(a, 1.5) * dt; let H = Math.asinh(M / e);
    for (let k = 0; k < 40; k++) { const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1); H -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (e - Math.cosh(H)); y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  return rot(o, x, y);
}
function rot(o, x, y) { const w = o.w * D2R, O = o.om * D2R, I = o.i * D2R, cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [(cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y, (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y, sw * sI * x + cw * sI * y]; }
// the orbit as a line (AU, ecliptic), cut at rMax for long or open orbits
export function orbitLine(o, rMax = 60, n = 720) { const { q, e } = o, p = q * (1 + e), out = [];
  for (let k = 0; k <= n; k++) { const nu = -Math.PI + 2 * Math.PI * k / n, den = 1 + e * Math.cos(nu); if (den <= 1e-6) continue; const r = p / den; if (r > rMax) continue; out.push(rot(o, r * Math.cos(nu), r * Math.sin(nu))); }
  return out; }
export const period = o => o.e < 1 ? Math.pow(o.q / (1 - o.e), 1.5) : Infinity; // years
export function nextPerihelion(o, jd) { const P = period(o) * 365.25; if (!isFinite(P)) return o.tp; if (o.tpn && jd > (o.tp + o.tpn) / 2) return o.tpn; let t = o.tp; if (o.tpn && jd < o.tpn) return o.tpn; if (t < jd) t += Math.ceil((jd - t) / P) * P; return t; }
export const dateOfJd = jd => new Date((jd - 2440587.5) * 864e5);

// major annual meteor showers (IMO calendar): code, name, Khmer, active from, peak, to (month-day), radiant RA/Dec (deg), ZHR, speed km/s, parent
export const SHOWERS = [
  ['QUA', 'Quadrantids', 'ផ្កាយធ្លាក់ក្វាដ្រង់ទីដ', '12-28', '01-03', '01-12', 230, 49, 80, 41, '2003 EH1'],
  ['LYR', 'Lyrids', 'ផ្កាយធ្លាក់លីរីដ', '04-14', '04-22', '04-30', 271, 34, 18, 49, 'Thatcher (C/1861 G1)'],
  ['ETA', 'Eta Aquariids', 'ផ្កាយធ្លាក់អេតាអាក្វារីដ', '04-19', '05-06', '05-28', 338, -1, 50, 66, 'Halley'],
  ['SDA', 'Southern Delta Aquariids', 'ផ្កាយធ្លាក់ដែលតាអាក្វារីដខាងត្បូង', '07-12', '07-30', '08-23', 340, -16, 25, 41, '96P/Machholz'],
  ['PER', 'Perseids', 'ផ្កាយធ្លាក់ភើសៀដ', '07-17', '08-12', '08-24', 48, 58, 100, 59, 'Swift-Tuttle'],
  ['DRA', 'Draconids', 'ផ្កាយធ្លាក់ដ្រាកូនីដ', '10-06', '10-08', '10-10', 262, 54, 10, 20, 'Giacobini-Zinner'],
  ['STA', 'Southern Taurids', 'ផ្កាយធ្លាក់តូរីដខាងត្បូង', '09-10', '10-10', '11-20', 32, 9, 5, 27, 'Encke'],
  ['ORI', 'Orionids', 'ផ្កាយធ្លាក់អូរីយ៉ូនីដ', '10-02', '10-21', '11-07', 95, 16, 20, 66, 'Halley'],
  ['NTA', 'Northern Taurids', 'ផ្កាយធ្លាក់តូរីដខាងជើង', '10-20', '11-12', '12-10', 58, 22, 5, 29, 'Encke'],
  ['LEO', 'Leonids', 'ផ្កាយធ្លាក់លេអូនីដ', '11-06', '11-17', '11-30', 152, 22, 15, 71, 'Tempel-Tuttle'],
  ['GEM', 'Geminids', 'ផ្កាយធ្លាក់ជេមីនីដ', '12-04', '12-14', '12-20', 112, 33, 150, 35, 'Phaethon'],
  ['URS', 'Ursids', 'ផ្កាយធ្លាក់អ៊ូស៊ីដ', '12-17', '12-22', '12-26', 217, 76, 10, 33, '8P/Tuttle'],
].map(([code, en, km, from, peak, to, ra, dec, zhr, v, parent]) => ({ code, en, km, from, peak, to, ra, dec, zhr, v, parent }));
const md = (y, s) => { const [m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
// each shower's window around a date: is it active, days from the peak, expected rate (ZHR, falls off away from the peak)
export function showerState(date) { const t = date.getTime(), y = date.getUTCFullYear();
  return SHOWERS.map(s => { let best = null;
    for (const yy of [y - 1, y, y + 1]) { let a = md(yy, s.from), p = md(yy, s.peak), b = md(yy, s.to); if (a > p) a = md(yy - 1, s.from); if (b < p) b = md(yy + 1, s.to);
      const o = { s, active: t >= a && t <= b + 864e5, dPeak: (t - p) / 864e5, peak: new Date(p), from: new Date(a), to: new Date(b) }; if (!best || Math.abs(o.dPeak) < Math.abs(best.dPeak)) best = o; }
    best.rate = best.active ? Math.max(1, s.zhr * Math.pow(10, -0.12 * Math.abs(best.dPeak))) : 0; return best; }); }
export function nextShowers(date, n = 3) { const t = date.getTime(); return showerState(date).map(o => { let p = o.peak.getTime(); if (p < t - 2 * 864e5) p = md(new Date(p).getUTCFullYear() + 1, o.s.peak); return { ...o, next: new Date(p) }; }).filter(o => !o.active || o.dPeak > 1).sort((a, b) => a.next - b.next).slice(0, n); }

// "space rocks" glossary (Canadian Space Agency style)
export const LEARN = [
  ['☄️', 'Comet', 'ផ្កាយដុះកន្ទុយ', 'A ball of ice, dust and rock, a few km across, from the cold outer Solar System. Near the Sun the ice turns to gas and makes a glowing head (coma) and tails up to millions of km long that always point away from the Sun.', 'Halley'],
  ['🪨', 'Asteroid', 'អាចម៍ផ្កាយ', 'A rocky or metal body, from a few metres to about 1,000 km, orbiting the Sun. Most are in the asteroid belt between Mars and Jupiter; near-Earth asteroids cross close to Earth\'s orbit.', 'Ceres'],
  ['🔹', 'Meteoroid', 'មេតេអូរ៉ូអ៊ីត', 'A small piece of rock or metal in space, from a grain of sand up to about 1 m, usually broken off a comet or an asteroid.', null],
  ['🌠', 'Meteor', 'ផ្កាយធ្លាក់ (មេតេអូរ)', 'The streak of light when a meteoroid enters the atmosphere at 11–72 km/s and burns up, mostly 80–120 km high in the mesosphere. Many at once from one point in the sky is a meteor shower.', null],
  ['🔥', 'Fireball', 'ដុំភ្លើងមេតេអូរ', 'A very bright meteor, brighter than the planet Venus. Big ones can explode in the air (a bolide); the Chelyabinsk fireball in 2013 broke windows across a city.', null],
  ['🌑', 'Meteorite', 'អាចម៍ធ្លាក់ (មេតេអូរីត)', 'A piece of a meteoroid that survives the trip through the atmosphere and lands on the ground. Most are stony; some are iron. They are samples of asteroids, the Moon and Mars.', null],
];
// layers of the atmosphere: name, Khmer, base and top (km), colour, notes
export const ATM = [
  ['Troposphere', 'ស្រទាប់ទ្រូប៉ូស្វ៊ែ', 0, 12, '#5fb3ff', 'Weather, clouds and rain; airliners fly near the top (10–12 km). Temperature falls with height.'],
  ['Stratosphere', 'ស្រទាប់ស្ត្រាតូស្វ៊ែ', 12, 50, '#7f8cff', 'The ozone layer (15–35 km) absorbs UV light, so it warms with height. Weather balloons reach ~35 km.'],
  ['Mesosphere', 'ស្រទាប់មេសូស្វ៊ែ', 50, 85, '#b07cff', 'Most meteors burn up here. The coldest place in the atmosphere, about −90 °C.'],
  ['Thermosphere', 'ស្រទាប់ទែម៉ូស្វ៊ែ', 85, 600, '#ff8fd0', 'Very thin, hot air (up to 1,500 °C). Aurora and the International Space Station (≈420 km). Space begins at the Kármán line, 100 km.'],
  ['Exosphere', 'ស្រទាប់អ៊ិចសូស្វ៊ែ', 600, 10000, '#ffd38a', 'The last thin traces of air, slowly escaping to space; many satellites orbit here.'],
];
