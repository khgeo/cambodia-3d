// Rice SOS Mapper (port of the Rice SOS Mapper 2.1 QGIS plugin): rice planting date / start of season from the
// Sentinel-1 VH time series in Google Earth Engine (RIICE convention: each rice pixel's class is the S1 date on
// which its season started). Same detection rule and defaults as the plugin.
import { evaluate } from './gee.js?v=87';

export const DEFAULTS = { orbit: 'DESCENDING', min_grow_days: 30, post_days: 110, smooth_days: 7, near_days: 18, flood_db: -19, rise_db: 5, peak_db: -18.5, scale: 20, mask_worldcover: true, mask_water: true, mask_slope: true, cleanup_m: 0, mmu_px: 0 };
const RAMP = ['ff00ff', '9900ff', '2200ff', '0055aa', '009966', '00dd33', '99ff00', 'ffff00', 'ff9900', 'ff0000'];
export function rampColors(n) {
  const h2r = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)), out = [];
  for (let k = 0; k < n; k++) { const f = n > 1 ? k / (n - 1) : 0, x = f * (RAMP.length - 1), i = Math.min(Math.floor(x), RAMP.length - 2), t = x - i, a = h2r(RAMP[i]), b = h2r(RAMP[i + 1]);
    out.push(a.map((v, c) => Math.round(v + (b[c] - v) * t).toString(16).padStart(2, '0')).join('')); }
  return out;
}
const day = s => new Date(s + 'T00:00:00Z'), iso = d => d.toISOString().slice(0, 10), add = (s, n) => iso(new Date(day(s).getTime() + n * 864e5));
// default season: this year's wet-season planting if it has data after it, otherwise last year's
export function defaultSeason(now = new Date()) { const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; return { sos_start: `${y}-04-25`, sos_end: `${y}-07-31` }; }
function windowOf(p) { return [add(p.sos_start, -30), add(p.sos_end, +p.post_days)]; }
function s1(aoi, p, start, end) {
  let c = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(aoi).filterDate(start, end).filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH')).filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'));
  if (p.orbit !== 'BOTH') c = c.filter(ee.Filter.eq('orbitProperties_pass', p.orbit)); return c;
}
const dateList = col => col.aggregate_array('system:time_start').map(t => ee.Date(t).format('YYYY-MM-dd')).distinct().sort();
// client-side scan of the S1 dates: candidate SOS dates are those in the window with a growth window of data after them
export async function scanDates(aoi, p) {
  const [a, b] = windowOf(p), dates = await evaluate(dateList(s1(aoi, p, a, b)));
  if (!dates || !dates.length) return { all: [], cand: [], dropped: [], last: null };
  const last = dates[dates.length - 1], need = +p.min_grow_days + 12, cand = [], dropped = [];
  for (const d of dates) if (d >= p.sos_start && d <= p.sos_end) (add(d, need) <= last ? cand : dropped).push(d);
  return { all: dates, cand, dropped, last };
}
function dailyAndSmooth(aoi, p) {
  const [a, b] = windowOf(p), col = s1(aoi, p, a, b);
  const prep = img => { let x = img.select(['VH', 'VV']); x = x.updateMask(x.select('VH').gt(-35)).focalMedian(25, 'circle', 'meters'); return x.rename(['VH', 'VV']).copyProperties(img, ['system:time_start']); };
  const daily = ee.ImageCollection(dateList(col).map(ds => { const d = ee.Date.parse('YYYY-MM-dd', ds), img = col.filterDate(d, d.advance(1, 'day')).map(prep).mosaic();
    return img.rename(['VH', 'VV']).set('system:time_start', d.millis()).set('date', ds).set('doy', d.getRelative('day', 'year').add(1)); }));
  const near = ee.Filter.maxDifference({ difference: +p.smooth_days * 86400000, leftField: 'system:time_start', rightField: 'system:time_start' });
  const smooth = ee.ImageCollection(ee.Join.saveAll('nbrs').apply(daily, daily, near)).map(img => { img = ee.Image(img);
    const m = ee.ImageCollection.fromImages(img.get('nbrs')).select('VH').mean().updateMask(img.select('VH').mask());
    return ee.Image(m.rename('VHs').copyProperties(img, ['system:time_start', 'date', 'doy'])); });
  return { daily, smooth };
}
function cropMask(p) {
  let m = ee.Image(1);
  if (p.mask_worldcover) { const wc = ee.ImageCollection('ESA/WorldCover/v200').first(); m = m.and(wc.eq(40).or(wc.eq(30)).or(wc.eq(90))); }
  if (p.mask_water) m = m.and(ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0).gt(60).not());
  if (p.mask_slope) m = m.and(ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003')).lt(5));
  return m;
}
// image with bands cls (index into cand) and doy, int16, masked outside detected rice, clipped to the area
export function buildSOS(aoi, p, cand) {
  const { smooth } = dailyAndSmooth(aoi, p), dates = ee.List(cand), mask = cropMask(p);
  const flood = +p.flood_db, rise = +p.rise_db, peakDb = +p.peak_db, nearD = +p.near_days, grow = +p.min_grow_days, post = +p.post_days;
  const sos = smooth.filter(ee.Filter.inList('date', dates)).map(img => {
    const t = ee.Date(img.get('system:time_start')), vh = img.select('VHs');
    const nearMin = smooth.filterDate(t.advance(-nearD, 'day'), t.advance(nearD + 1, 'day')).select('VHs').min();
    const peak = smooth.filterDate(t.advance(grow, 'day'), t.advance(post, 'day')).select('VHs').max(), r = peak.subtract(vh);
    const isMin = vh.lte(nearMin.add(0.5)), low = vh.lte(flood).or(vh.lte(flood + 3).and(r.gte(rise + 2)));
    const ok = isMin.and(low).and(r.gte(rise)).and(peak.gte(peakDb));
    return ee.Image.cat([ee.Image.constant(dates.indexOf(img.get('date'))).toInt16().rename('cls'), vh.rename('vhStart'), r.rename('score')]).updateMask(ok).updateMask(mask);
  }).qualityMosaic('score');
  let cls = sos.select('cls');
  if (+p.cleanup_m > 0) cls = cls.focalMode(+p.cleanup_m, 'circle', 'meters').updateMask(cls.mask());
  if (+p.mmu_px > 1) cls = cls.updateMask(cls.connectedPixelCount(+p.mmu_px + 1, false).gte(+p.mmu_px));
  const doys = cand.map(d => Math.round((day(d) - day(d.slice(0, 4) + '-01-01')) / 864e5) + 1);
  return ee.Image.cat([cls.rename('cls'), cls.remap(cand.map((_, i) => i), doys).rename('doy')]).toInt16().clip(aoi);
}
export function visualize(img, n) { return img.select('cls').visualize({ min: 0, max: Math.max(n - 1, 1), palette: rampColors(n) }); }
// rice area (ha) per planting date
export async function areaByDate(img, region, scale) {
  const h = await evaluate(img.select('cls').reduceRegion({ reducer: ee.Reducer.frequencyHistogram(), geometry: region, scale, maxPixels: 1e10, bestEffort: true, tileScale: 4 }).get('cls'));
  const ha = scale * scale / 1e4, out = {}; for (const [k, v] of Object.entries(h || {})) out[+k] = v * ha; return out;
}
// VH time series at a point: raw and smoothed values and the detected SOS class there
export async function pointSeries(lon, lat, p, img) {
  const pt = ee.Geometry.Point([lon, lat]), { daily, smooth } = dailyAndSmooth(pt.buffer(30), p);
  const ser = (col, band) => col.map(i => ee.Feature(null, { date: i.get('date'), v: i.select(band).reduceRegion(ee.Reducer.mean(), pt, 10).get(band) })).filter(ee.Filter.notNull(['v'])).reduceColumns(ee.Reducer.toList(2), ['date', 'v']).get('list');
  const o = { raw: ser(daily, 'VH'), vv: ser(daily, 'VV'), smooth: ser(smooth, 'VHs') }; if (img) o.sos = img.reduceRegion(ee.Reducer.first(), pt, +p.scale);
  const r = await evaluate(ee.Dictionary(o)), clean = a => (a || []).filter(x => x[1] != null).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return { raw: clean(r.raw), vv: clean(r.vv), smooth: clean(r.smooth), sos: r.sos || {} };
}
// VH chart: raw dots, smoothed line, the detected planting date and the season window
export function drawChart(cv, s, p, cand, colors, L = x => x) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, m = { l: 40, r: 10, t: 14, b: 26 }; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const all = [...s.raw, ...s.smooth]; if (!all.length) { g.fillStyle = '#666'; g.font = '13px system-ui'; g.fillText(L('No Sentinel-1 data at this point'), 12, H / 2); return; }
  const t = d => day(d).getTime(), t0 = Math.min(...all.map(x => t(x[0]))), t1 = Math.max(...all.map(x => t(x[0]))), v0 = Math.min(-26, ...all.map(x => x[1])), v1 = Math.max(-8, ...all.map(x => x[1]));
  const X = d => m.l + (t(d) - t0) / (t1 - t0 || 1) * (W - m.l - m.r), Y = v => m.t + (v1 - v) / (v1 - v0) * (H - m.t - m.b);
  g.fillStyle = 'rgba(255,214,90,.18)'; g.fillRect(X(p.sos_start), m.t, X(p.sos_end) - X(p.sos_start), H - m.t - m.b);
  g.strokeStyle = '#e5e8ec'; g.fillStyle = '#556'; g.font = '10px system-ui'; g.lineWidth = 1;
  for (let v = Math.ceil(v0 / 5) * 5; v <= v1; v += 5) { g.beginPath(); g.moveTo(m.l, Y(v)); g.lineTo(W - m.r, Y(v)); g.stroke(); g.fillText(v + ' dB', 2, Y(v) + 3); }
  for (let k = 0; k <= 4; k++) { const tt = t0 + (t1 - t0) * k / 4, d = new Date(tt); g.fillText(`${d.getUTCDate()}/${d.getUTCMonth() + 1}`, m.l + (W - m.l - m.r) * k / 4 - 10, H - 8); }
  g.strokeStyle = '#d6763c'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(m.l, Y(+p.flood_db)); g.lineTo(W - m.r, Y(+p.flood_db)); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(40,90,170,.5)'; for (const [d, v] of s.raw) { g.beginPath(); g.arc(X(d), Y(v), 2.5, 0, 7); g.fill(); }
  g.strokeStyle = '#1b5fb5'; g.lineWidth = 2; g.beginPath(); s.smooth.forEach(([d, v], i) => i ? g.lineTo(X(d), Y(v)) : g.moveTo(X(d), Y(v))); g.stroke();
  const c = s.sos && s.sos.cls; if (c != null && cand[c]) { const x = X(cand[c]); g.strokeStyle = '#' + colors[c]; g.lineWidth = 3; g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, H - m.b); g.stroke(); g.fillStyle = '#222'; g.font = '600 11px system-ui'; g.fillText(L('SOS') + ' ' + cand[c], Math.min(x + 4, W - 90), m.t + 10); }
}
