// Rice Ecosystem Mapper (port of the Rice Ecosystem Mapper 0.6.5 QGIS plugin, rule-based method): Cambodia's rice
// ecosystems for one crop year (1 April → 31 March) from Sentinel-1 VH/VV and Sentinel-2 NDVI time series in
// Google Earth Engine. Same rules and defaults as the plugin's scripts/rice_ecosystem_gee.js.
import { evaluate } from './gee.js?v=72';

export const DEFAULTS = { step: 12, orbit: 'BOTH', orbit_norm: true, smooth: true, flood_vh: -19, rise_db: 4, peak_vh: -18, grow_days: 100, min_gap: 80,
  use_flood_vv: true, flood_vv: -15, dry_ndvi: 0.45, early_start: 0, sos_method: 'rise', slope_days: 36, reject_overflood: true, pre_days: 24, pre_margin: 1.5,
  water_vv: -16, recess_flood: 0.4, deep_flood: 0.6, deep_elev: 12, deep_ndvi: 0.4, deep_vh: -20, upland_on: false, upland_slope: 2, upland_elev: 100,
  upland_amp: 0.25, upland_ndvi: 0.55, upland_post: 0.45, paddy_max_slope: 6, perm_water: 80, crop_mask: false, cloud_cs: 0.6 };
export const CLASSES = [
  [1, 'Rainfed lowland rice', '7cb342', 'One wet-season crop planted with the monsoon, no dry-season crop'],
  [2, 'Wet-season double rice', 'c0ca33', 'Two crops inside the wet season (early + main), supplementary irrigation'],
  [3, 'Irrigated multiple-crop rice', '0d47a1', 'Wet-season crop plus a dry-season crop (2-3 crops a year)'],
  [4, 'Dry-season irrigated rice', '4fc3f7', 'Only a dry-season crop, irrigated (pumping from rivers / lakes, canals, reservoirs)'],
  [5, 'Flood-recession rice', 'ba68c8', 'Dry-season crop on land flooded in Aug-Nov, planted on residual moisture as the water recedes'],
  [6, 'Deepwater / floating rice (candidate)', '00897b', 'Crop established before a long deep flood in Aug-Nov, very low land'],
  [7, 'Upland rice (candidate)', 'f9a825', 'Rainfed crop on sloping / high land, no standing water (chamkar)']];
export const PALETTE = ['ffffff', ...CLASSES.map(c => c[2])];
// latest crop year whose series (1 Apr Y → 30 Jun Y+1) is complete
export const defaultYear = (now = new Date()) => now.getUTCMonth() >= 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
const WIN = { early: [0, 105], main: [106, 213], dry: [214, 333] }, DRY_GROWTH_END = 425, SERIES_DAYS = 456, FLOOD_WIN = [136, 243], WET_NOWATER = [30, 180];

function nonempty(col, bands) {
  const ph = ee.Image.constant(bands.map(() => 0)).rename(bands).toFloat().updateMask(ee.Image(0));
  return ee.ImageCollection(col).map(i => ee.Image(ee.Image(i).select(bands).toFloat().copyProperties(i, ['system:time_start']))).merge(ee.ImageCollection([ph]));
}
// image bands: ecosystem (0–7), intensity (crops a year), flood (Aug–Nov inundation %), sos_early / sos_main / sos_dry (day of year)
export function classify(aoi, YEAR, P) {
  P = { ...DEFAULTS, ...P }; const start = ee.Date.fromYMD(YEAR, 4, 1), OK = 'relativeOrbitNumber_start';
  let s1 = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(aoi).filterDate(start, start.advance(SERIES_DAYS + P.step, 'day')).filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')).filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));
  if (P.orbit !== 'BOTH') s1 = s1.filter(ee.Filter.eq('orbitProperties_pass', P.orbit));
  s1 = s1.map(img => ee.Image(ee.Image(10).pow(img.select(['VV', 'VH']).divide(10)).updateMask(img.select('VV').gt(-30)).copyProperties(img, ['system:time_start', OK])));
  if (P.orbit_norm !== false) { // harmonise relative orbits: scale each image by (mean of the orbits' means) / (its orbit's mean)
    const orbMeans = ee.ImageCollection.fromImages(s1.aggregate_array(OK).distinct().map(o => { const sub = s1.filter(ee.Filter.eq(OK, o)); return sub.mean().set(OK, o).set('n', sub.size()); })).filter(ee.Filter.gte('n', 6));
    const orbRef = orbMeans.mean();
    s1 = s1.map(img => { const m = orbMeans.filter(ee.Filter.eq(OK, img.get(OK)));
      const ratio = ee.Image(ee.Algorithms.If(m.size().gt(0), orbRef.divide(ee.Image(m.first())).unmask(1), ee.Image.constant([1, 1]).rename(['VV', 'VH'])));
      return ee.Image(img.multiply(ratio).copyProperties(img, ['system:time_start', OK])); });
  }
  const n = Math.ceil(SERIES_DAYS / P.step);
  const series = ee.ImageCollection.fromImages(ee.List.sequence(0, (n - 1) * P.step, P.step).map(o => {
    o = ee.Number(o); const d0 = start.advance(o, 'day'), sub = s1.filterDate(d0, d0.advance(P.step, 'day')), empty = ee.Image.constant([1, 1]).rename(['VV', 'VH']).updateMask(ee.Image(0));
    let img = ee.Image(ee.Algorithms.If(sub.size().gt(0), sub.mean(), empty)); if (P.smooth) img = img.reduceNeighborhood(ee.Reducer.mean(), ee.Kernel.square(1)).rename(['VV', 'VH']);
    const db = img.log10().multiply(10), mid = o.add(P.step / 2);
    return db.addBands(ee.Image.constant(mid).toFloat().rename('t').updateMask(db.select('VH').mask())).set('t0', mid);
  }));
  const LST = series.toList(500);
  // planting = composite in the window that is low (flooded / puddled), optionally standing water in VV, then canopy growth
  const detect = (win, growthEnd) => {
    const ks = []; for (let k = 0; k < n; k++) { const t = k * P.step + P.step / 2; if (t >= win[0] && t <= win[1]) ks.push(k); }
    const cand = ee.ImageCollection.fromImages(ee.List(ks).map(k => {
      k = ee.Number(k); const img = ee.Image(LST.get(k)), t0 = ee.Number(img.get('t0')); let hi = t0.add(P.grow_days); if (growthEnd) hi = hi.min(growthEnd);
      const vmax = nonempty(series.filter(ee.Filter.and(ee.Filter.gt('t0', t0), ee.Filter.lte('t0', hi))), ['VH']).max(), vh = img.select('VH');
      let ok = vh.lt(P.flood_vh).and(vmax.subtract(vh).gte(P.rise_db)).and(vmax.gte(P.peak_vh));
      if (P.reject_overflood !== false) { const pmax = nonempty(series.filter(ee.Filter.and(ee.Filter.lt('t0', t0), ee.Filter.gte('t0', t0.subtract(P.pre_days || 24)))), ['VH']).max().unmask(-99); ok = ok.and(pmax.lte(vmax.subtract(P.pre_margin || 1.5))); }
      if (P.use_flood_vv) { const prev = ee.Image(LST.get(k.subtract(1).max(0))); ok = ok.and(img.select('VV').lt(P.flood_vv).unmask(0).or(prev.select('VV').lt(P.flood_vv).unmask(0))); }
      let q = vmax.subtract(vh);
      if (P.sos_method === 'slope') q = nonempty(series.filter(ee.Filter.and(ee.Filter.gt('t0', t0), ee.Filter.lte('t0', t0.add(P.slope_days || 36)))), ['VH']).max().subtract(vh);
      else if (P.sos_method === 'first') q = img.select('t').multiply(-1);
      return img.select('t').addBands(q.rename('rise')).updateMask(ok.unmask(0));
    }));
    const tsos = cand.qualityMosaic('rise').select('t'); return [tsos.mask().gt(0).unmask(0), tsos.unmask(-999)];
  };
  const ndvi = (d0, d1) => { const cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
    return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(aoi).filterDate(d0, d1).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 80)).linkCollection(cs, ['cs_cdf'])
      .map(i => i.normalizedDifference(['B8', 'B4']).rename('NDVI').toFloat().updateMask(i.select('cs_cdf').gte(P.cloud_cs))).merge(ee.ImageCollection([ee.Image.constant(0).rename('NDVI').toFloat().updateMask(ee.Image(0))])); };
  const E = detect([P.early_start || 0, WIN.early[1]]), M = detect(WIN.main), D = detect(WIN.dry, DRY_GROWTH_END), Y1 = YEAR + 1;
  let early = E[0], main = M[0], dry = D[0];
  dry = dry.and(ndvi(`${YEAR}-12-01`, `${Y1}-05-01`).max().unmask(0).gte(P.dry_ndvi));
  main = main.and(early.not().or(M[1].subtract(E[1]).gte(P.min_gap)));
  const lastWet = ee.Image(-999).where(early, E[1]).where(main, M[1]);
  dry = dry.and(lastWet.lt(0).or(D[1].subtract(lastWet).gte(P.min_gap)));
  const wet = early.or(main), anyrice = wet.or(dry); let intensity = early.add(main).add(dry);
  const water = i => i.select('VV').lt(P.water_vv);
  const floodFreq = series.filter(ee.Filter.rangeContains('t0', FLOOD_WIN[0], FLOOD_WIN[1])).map(water).mean().unmask(0), allW = series.map(water).mean().unmask(0);
  const wetMinVV = series.filter(ee.Filter.rangeContains('t0', WET_NOWATER[0], WET_NOWATER[1])).select('VV').min().unmask(-30);
  const ndviEst = ndvi(`${YEAR}-06-01`, `${YEAR}-08-01`).max().unmask(0), ndviPre = ndvi(`${YEAR}-03-01`, `${YEAR}-06-01`).min().unmask(1);
  const ndviPeak = ndvi(`${YEAR}-08-01`, `${YEAR}-11-01`).max().unmask(0), ndviPost = ndvi(`${YEAR}-12-15`, `${Y1}-03-01`).median().unmask(1);
  const dem = ee.Image('USGS/SRTMGL1_003').select('elevation'), slope = ee.Terrain.slope(dem), wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
  const jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0);
  const vhFlood = series.filter(ee.Filter.rangeContains('t0', FLOOD_WIN[0], FLOOD_WIN[1])).select('VH').median().unmask(-30), ndviFlood = ndvi(`${YEAR}-09-01`, `${YEAR}-12-01`).max().unmask(0);
  const deep = floodFreq.gte(P.deep_flood).and(ndviEst.gte(P.deep_ndvi)).and(vhFlood.gte(P.deep_vh)).and(ndviFlood.gte(P.deep_ndvi)).and(dem.lte(P.deep_elev)).and(dry.not()).and(early.and(main).not());
  const recess = dry.and(wet.not()).and(floodFreq.gte(P.recess_flood));
  let cls = ee.Image(0).where(wet.and(dry.not()), 1).where(early.and(main).and(dry.not()), 2).where(wet.and(dry), 3).where(dry.and(wet.not()), 4).where(recess, 5).where(deep, 6);
  let paddyOk = slope.lte(P.paddy_max_slope); if (P.crop_mask) paddyOk = paddyOk.and(wc.eq(40).or(wc.eq(30)).or(wc.eq(90)).or(wc.eq(20)));
  cls = cls.where(paddyOk.not(), 0);
  const upland = anyrice.not().and(deep.not()).and(slope.gte(P.upland_slope).or(dem.gte(P.upland_elev))).and(ndviPeak.gte(P.upland_ndvi)).and(ndviPeak.subtract(ndviPre).gte(P.upland_amp))
    .and(wc.eq(20).or(wc.eq(30)).or(wc.eq(40)).or(wc.eq(60))).and(wetMinVV.gt(P.water_vv)).and(ndviPost.lte(P.upland_post));
  if (P.upland_on) cls = cls.where(upland, 7);
  cls = cls.where(wc.eq(50).or(jrc.gte(P.perm_water)).or(allW.gte(0.85)), 0);
  intensity = intensity.where(cls.eq(0).or(cls.eq(7)), 0).where(cls.eq(7), 1);
  const off = Math.round((Date.UTC(YEAR, 3, 1) - Date.UTC(YEAR, 0, 1)) / 864e5) + 1, isP = cls.gte(1).and(cls.lte(6));
  return ee.Image.cat([cls.rename('ecosystem'), intensity.rename('intensity'), floodFreq.multiply(100).round().rename('flood'),
    ee.Image(0).where(early.and(isP), E[1].add(off)).rename('sos_early'), ee.Image(0).where(main.and(isP), M[1].add(off)).rename('sos_main'), ee.Image(0).where(dry.and(isP), D[1].add(off)).rename('sos_dry')]).toInt16().clip(aoi);
}
export const VIEWS = {
  ecosystem: img => img.select('ecosystem').updateMask(img.select('ecosystem').gt(0)).visualize({ min: 0, max: 7, palette: PALETTE }),
  intensity: img => img.select('intensity').updateMask(img.select('intensity').gt(0)).visualize({ min: 1, max: 3, palette: ['c5e1a5', '43a047', '1b5e20'] }),
  flood: img => img.select('flood').updateMask(img.select('flood').gt(5)).visualize({ min: 0, max: 100, palette: ['e3f2fd', '0277bd', '01579b'] }),
};
// area (ha) per ecosystem class and per cropping intensity
export async function areas(img, region, scale = 20) {
  const r = await evaluate(ee.Dictionary({
    eco: ee.Image.pixelArea().divide(1e4).addBands(img.select('ecosystem')).reduceRegion({ reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'c' }), geometry: region, scale, maxPixels: 1e13, tileScale: 8, bestEffort: true }).get('groups'),
    int: ee.Image.pixelArea().divide(1e4).addBands(img.select('intensity')).reduceRegion({ reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'c' }), geometry: region, scale, maxPixels: 1e13, tileScale: 8, bestEffort: true }).get('groups') }));
  const map = g => Object.fromEntries((g || []).map(x => [x.c, x.sum])); return { eco: map(r.eco), int: map(r.int) };
}
export async function pointInfo(img, lon, lat) { return evaluate(img.reduceRegion(ee.Reducer.first(), ee.Geometry.Point([lon, lat]), 10)); }
