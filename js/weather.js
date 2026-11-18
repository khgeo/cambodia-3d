// Current weather for a point: Open-Meteo first, MET Norway (api.met.no) when Open-Meteo is busy
// (its free tier has a daily limit per network). Results are cached for 20 minutes.
const cache = new Map();
const MET = { clearsky: ['clear', '☀️', 'Clear'], fair: ['clear', '🌤️', 'Fair'], partlycloudy: ['clear', '⛅', 'Partly cloudy'], cloudy: ['haze', '☁️', 'Overcast'], fog: ['haze', '🌫️', 'Fog'],
  lightrain: ['rain', '🌦️', 'Light rain'], rain: ['rain', '🌧️', 'Rain'], heavyrain: ['rain', '🌧️', 'Heavy rain'], lightrainshowers: ['rain', '🌦️', 'Light showers'], rainshowers: ['rain', '🌧️', 'Showers'], heavyrainshowers: ['rain', '🌧️', 'Heavy showers'] };
const wmo = c => c >= 95 ? ['storm', '⛈️', 'Thunderstorm'] : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? ['rain', '🌧️', 'Rain'] : c === 45 || c === 48 ? ['haze', '🌫️', 'Fog'] : c === 3 ? ['haze', '☁️', 'Overcast'] : c === 2 ? ['clear', '⛅', 'Partly cloudy'] : ['clear', '☀️', 'Clear'];
const timed = (u, ms = 9000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(u, { signal: c.signal }).finally(() => clearTimeout(t)); };

async function openMeteo(lat, lon) {
  const r = await timed(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FBangkok&forecast_days=3`);
  const j = await r.json(); if (!r.ok || j.error) throw new Error(j.reason || 'HTTP ' + r.status); const c = j.current, d = j.daily, [wx, icon, label] = wmo(c.weather_code);
  return { src: 'Open-Meteo', wx, icon, label, temp: c.temperature_2m, feels: c.apparent_temperature, hum: c.relative_humidity_2m, cloud: c.cloud_cover, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, precip: c.precipitation,
    days: d.time.map((t, i) => ({ date: t, min: d.temperature_2m_min[i], max: d.temperature_2m_max[i], rain: d.precipitation_sum[i] })) };
}
async function metNo(lat, lon) {
  const r = await timed(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(), ts = j.properties.timeseries, now = ts[0].data, i = now.instant.details, sym = ((now.next_1_hours || now.next_6_hours || {}).summary || {}).symbol_code || 'fair', key = sym.replace(/_(day|night|polartwilight)$/, '');
  const [wx, icon, label] = /thunder/.test(key) ? ['storm', '⛈️', 'Thunderstorm'] : MET[key] || (/rain|sleet/.test(key) ? ['rain', '🌧️', 'Rain'] : ['clear', '🌤️', 'Fair']);
  // daily min / max / rain from the hourly series (Cambodia time, UTC+7)
  const byDay = new Map(); for (const s of ts) { const d = new Date(Date.parse(s.time) + 7 * 3600e3).toISOString().slice(0, 10), v = s.data.instant.details.air_temperature, p = s.data.next_1_hours ? s.data.next_1_hours.details.precipitation_amount || 0 : 0;
    const o = byDay.get(d) || { date: d, min: 99, max: -99, rain: 0 }; o.min = Math.min(o.min, v); o.max = Math.max(o.max, v); o.rain += p; byDay.set(d, o); }
  const T = i.air_temperature, rh = i.relative_humidity, ws = i.wind_speed, e = rh / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T)), feels = T + 0.33 * e - 0.7 * ws - 4; // Australian apparent temperature
  return { src: 'MET Norway', wx, icon, label, temp: T, feels: Math.round(feels * 10) / 10, hum: Math.round(rh), cloud: Math.round(i.cloud_area_fraction), wind: Math.round(ws * 3.6 * 10) / 10, windDir: i.wind_from_direction,
    precip: now.next_1_hours ? now.next_1_hours.details.precipitation_amount : 0, days: [...byDay.values()].slice(0, 3).map(o => ({ ...o, rain: Math.round(o.rain * 10) / 10 })) };
}
export async function currentWeather(lat, lon) {
  const k = lat.toFixed(2) + ',' + lon.toFixed(2), c = cache.get(k); if (c && Date.now() - c.t < 20 * 60e3) return c.v;
  let v = null, err = null; for (const f of [openMeteo, metNo]) { try { v = await f(lat, lon); break; } catch (e) { err = e; } }
  if (!v) throw err || new Error('no weather'); cache.set(k, { t: Date.now(), v }); return v;
}
