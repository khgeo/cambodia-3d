// MineralScope (port of the MineralScope 1.1 QGIS plugin): remote-sensing mineral mapping for Cambodia with free
// data processed on Google Earth Engine – dry-season composites (Sentinel-2, Landsat 8/9, ASTER SWIR / TIR),
// vegetation / cropland / built-up / water masks, band-ratio mineral indices, Crósta PCA, robust z-scores,
// DEM lineament density, fuzzy prospectivity models, false-positive control and ranked targets.
import { evaluate } from './gee.js?v=78';

export const INDEX_INFO = {
  iron_oxide: 'Iron oxide (hematite, goethite)', ferrous: 'Ferrous minerals', clay_oh: 'Clay / hydroxyl (OH) minerals', gossan: 'Gossan',
  crosta_oh: 'Crósta PCA – hydroxyl', crosta_fe: 'Crósta PCA – iron oxide', ferric: 'Ferric iron', ferrous_sil: 'Ferrous silicates (chlorite, amphibole, biotite)',
  ohi: 'OH-bearing minerals (Ninomiya OHI)', kli: 'Kaolinite (Ninomiya KLI)', ali: 'Alunite (Ninomiya ALI)', cli: 'Calcite (Ninomiya CLI)',
  phyllic: 'Phyllic: sericite / muscovite / illite', argillic: 'Argillic: kaolinite / alunite', propylitic: 'Propylitic: chlorite / epidote / calcite',
  crosta_alunite: 'Crósta PCA – alunite', crosta_kaolinite: 'Crósta PCA – kaolinite', crosta_sericite: 'Crósta PCA – sericite / illite',
  qi: 'Quartz index (Ninomiya QI)', ci: 'Carbonate index (Ninomiya CI)', mi: 'Mafic index (Ninomiya MI)', lineament_density: 'Structural edge (lineament) density' };
export const MODELS = {
  hydrothermal: ['Hydrothermal Au–Cu (porphyry / epithermal alteration)', { phyllic: 0.16, argillic: 0.10, ali: 0.07, kli: 0.05, propylitic: 0.06, ohi: 0.05, crosta_sericite: 0.05, crosta_alunite: 0.03, clay_oh: 0.09, crosta_oh: 0.05, iron_oxide: 0.06, gossan: 0.04, crosta_fe: 0.04, ferric: 0.03, qi: 0.05, lineament_density: 0.15 }],
  laterite: ['Laterite / bauxite / iron cap', { iron_oxide: 0.22, ferric: 0.15, crosta_fe: 0.10, gossan: 0.08, kli: 0.15, clay_oh: 0.15, argillic: 0.10, crosta_kaolinite: 0.05 }],
  carbonate: ['Limestone / marble (cement, lime, skarn host)', { cli: 0.35, ci: 0.35, propylitic: 0.15, lineament_density: 0.15 }],
  silica: ['Silica: quartz veins, silica caps, glass sand', { qi: 0.45, lineament_density: 0.25, phyllic: 0.15, iron_oxide: 0.15 }],
  mafic: ['Basalt-related gems & mafic rocks (sapphire / zircon placers)', { mi: 0.35, ferrous: 0.20, ferrous_sil: 0.20, iron_oxide: 0.10, lineament_density: 0.15 }] };
export const PROSPECT_PALETTE = ['2b0b3f', '6a1c6e', 'b73779', 'f1605d', 'feb078', 'fcfdbf'];
export const TARGET_CLASSES = [[0.70, 'very high'], [0.55, 'high'], [0.40, 'moderate']];
export const targetClass = s => (TARGET_CLASSES.find(([t]) => s >= t) || [0, 'low'])[1];

const dry = () => ee.Filter.or(ee.Filter.calendarRange(11, 12, 'month'), ee.Filter.calendarRange(1, 4, 'month'));
export function defaultDates(n = 3, today = new Date()) { const y = today.getUTCMonth() >= 10 ? today.getUTCFullYear() : today.getUTCFullYear() - 1; return [`${y - (n - 1)}-11-01`, new Date(today.getTime() + 864e5).toISOString().slice(0, 10)]; }
const safeDiv = (a, b, eps = 0.005) => a.divide(b).updateMask(b.gt(eps));
const membership = z => z.subtract(1.5).multiply(-2).exp().add(1).pow(-1);
function commonMask(aoi, crop = true, built = true, water = true) {
  let k = ee.Image(1); const wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
  if (crop) k = k.and(wc.neq(40)); if (built) k = k.and(wc.neq(50));
  if (water) k = k.and(wc.neq(80)).and(wc.neq(90)).and(wc.neq(95)).and(ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0).lt(30));
  return k.clip(aoi);
}
async function robustZ(stack, region, scale, log) {
  const bands = await evaluate(stack.bandNames()); if (!bands.length) return [null, {}];
  const st = await evaluate(stack.reduceRegion({ reducer: ee.Reducer.percentile([16, 50, 84]), geometry: region, scale, maxPixels: 1e9, bestEffort: true, tileScale: 4 }));
  const one = bands.length === 1, get = (b, s) => st[`${b}_${s}`] ?? (one ? st[s] : null), out = [], info = {};
  for (const b of bands) { const p16 = get(b, 'p16'), p50 = get(b, 'p50'), p84 = get(b, 'p84');
    if (p16 == null || p50 == null || p84 == null || p84 - p16 <= 1e-9) { log(`  · ${b}: no valid pixels after masking – skipped`); continue; }
    out.push(stack.select(b).subtract(p50).divide((p84 - p16) / 2).rename(b)); info[b] = { p16, p50, p84 }; }
  return out.length ? [ee.Image.cat(out), info] : [null, info];
}
function chooseComponent(vecs, ir, ia) {
  let best = null, bs = -1; vecs.forEach((row, k) => { const lr = row[ir], la = row[ia]; if (lr * la < 0) { let s = Math.abs(lr) + Math.abs(la); if (k === 0) s *= 0.5; if (s > bs) { best = k; bs = s; } } });
  if (best == null) { const d = vecs.map(r => Math.abs(r[ir] - r[ia])); best = vecs.length > 1 ? d.slice(1).reduce((bi, v, i) => v > d[bi] ? i + 1 : bi, 1) : 0; }
  return [best, vecs[best][ir] >= vecs[best][ia] ? 1 : -1];
}
// feature-oriented (selective) PCA, Crósta & Moore 1989
async function crosta(comp, bands, refl, absb, region, scale, name) {
  const img = comp.select(bands), means = await evaluate(img.reduceRegion({ reducer: ee.Reducer.mean(), geometry: region, scale, maxPixels: 1e9, bestEffort: true, tileScale: 4 }));
  if (bands.some(b => means[b] == null)) throw new Error('no valid pixels for PCA');
  const arrays = img.subtract(ee.Image.constant(bands.map(b => means[b]))).toArray();
  const cov = arrays.reduceRegion({ reducer: ee.Reducer.centeredCovariance(), geometry: region, scale, maxPixels: 1e9, bestEffort: true, tileScale: 4 }), eig = ee.Array(cov.get('array')).eigen();
  const r = await evaluate(ee.Dictionary({ vecs: eig.slice(1, 1), vals: eig.slice(1, 0, 1) })), vecs = r.vecs, vals = r.vals.map(v => v[0]);
  const [k, sign] = chooseComponent(vecs, bands.indexOf(refl), bands.indexOf(absb)), n = bands.length;
  const pcs = ee.Image(ee.Array(vecs)).matrixMultiply(arrays.toArray(1)).arrayProject([0]).arrayFlatten([bands.map((_, i) => 'pc' + (i + 1))]);
  const tot = vals.reduce((a, b) => a + b, 0) || 1;
  return [pcs.select('pc' + (k + 1)).multiply(sign).rename(name), { chosen_pc: k + 1, sign, variance_pct: vals.map(v => +(100 * v / tot).toFixed(1)) }];
}
const opticalIdx = (c, nir) => [safeDiv(c.select('red'), c.select('blue')).rename('iron_oxide'), safeDiv(c.select('swir1'), c.select(nir)).rename('ferrous'), safeDiv(c.select('swir1'), c.select('swir2')).rename('clay_oh'), safeDiv(c.select('swir1'), c.select('red')).rename('gossan')];
async function finishOptical(r, comp, nir, keep, o) {
  const ndvi = comp.normalizedDifference(['nir', 'red']), cm = comp.updateMask(keep.and(ndvi.lt(o.ndvi_max)).and(comp.select('blue').gt(0))), bands = opticalIdx(cm, nir);
  if (o.crosta) for (const [name, b4, refl, absb] of [['crosta_oh', ['blue', nir, 'swir1', 'swir2'], 'swir1', 'swir2'], ['crosta_fe', ['blue', 'red', nir, 'swir1'], 'red', 'blue']]) {
    try { const [img, info] = await crosta(cm, b4, refl, absb, o.aoi, o.scale, name); bands.push(img); r.crosta[name] = info; o.log(`  · Crósta ${name}: PC${info.chosen_pc} (sign ${info.sign > 0 ? '+' : '−'}1)`); } catch (e) { o.log(`  · Crósta ${name} skipped: ${e.message}`); } }
  const [z, info] = await robustZ(ee.Image.cat(bands), o.aoi, o.scale, o.log); if (!z) { r.notes.push('No pixels left after masking (dense vegetation / cropland?).'); return; }
  const names = await evaluate(z.bandNames()); r.zimg = z.rename(names.map(n => `${r.prefix}_${n}`)); r.zinfo = info; r.names = names;
  if (['iron_oxide', 'clay_oh', 'ferrous'].every(n => names.includes(n))) r.previews.push([`${r.label}: R iron oxide · G clay/OH · B ferrous`, z, { bands: ['iron_oxide', 'clay_oh', 'ferrous'], min: -1, max: 3 }]);
}
const R = (key, label, prefix) => ({ key, label, prefix, count: 0, zimg: null, zinfo: {}, crosta: {}, previews: [], notes: [] });
async function sentinel2(o, keep) {
  const r = R('s2', 'Sentinel-2 MSI', 's2'), cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  const col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(o.aoi).filterDate(o.start, o.end).filter(dry()).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60)).linkCollection(cs, ['cs_cdf']);
  r.count = await evaluate(col.size()); o.log(`Sentinel-2: ${r.count} dry-season scenes (${o.start} → ${o.end})`); if (!r.count) return null;
  const comp = col.map(img => img.select(['B2', 'B3', 'B4', 'B5', 'B8', 'B8A', 'B11', 'B12']).divide(10000).rename(['blue', 'green', 'red', 're1', 'nir', 'nir2', 'swir1', 'swir2']).updateMask(img.select('cs_cdf').gte(0.6)).toFloat()).median().clip(o.aoi);
  r.previews.push(['Sentinel-2 true colour (dry-season median)', comp, { bands: ['red', 'green', 'blue'], min: 0.02, max: 0.25, gamma: 1.2 }]);
  await finishOptical(r, comp, 'nir2', keep, o); return r;
}
async function landsat(o, keep) {
  const r = R('ls', 'Landsat 8/9 OLI', 'ls');
  const col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterBounds(o.aoi).filterDate(o.start, o.end).filter(dry()).filter(ee.Filter.lt('CLOUD_COVER', 70));
  r.count = await evaluate(col.size()); o.log(`Landsat 8/9: ${r.count} dry-season scenes`); if (!r.count) return null;
  const comp = col.map(img => { const clear = img.select('QA_PIXEL').bitwiseAnd(31).eq(0), sat = img.select('QA_RADSAT').eq(0);
    return img.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7']).multiply(0.0000275).add(-0.2).rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2']).updateMask(clear.and(sat)).toFloat(); }).median().clip(o.aoi);
  await finishOptical(r, comp, 'nir', keep, o); return r;
}
const UCC = { B01: 0.676, B02: 0.708, B3N: 0.423, B04: 0.1087, B05: 0.0348, B06: 0.0313, B07: 0.0299, B08: 0.0209, B09: 0.0159, B10: 0.006822, B11: 0.006780, B12: 0.006590, B13: 0.005693, B14: 0.005225 };
const ESUN = { B01: 1848, B02: 1549, B3N: 1114, B04: 225.4, B05: 86.63, B06: 81.85, B07: 74.85, B08: 66.49, B09: 59.85 }, VS = ['B01', 'B02', 'B3N', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09'], TIR = ['B10', 'B11', 'B12', 'B13', 'B14'];
const asterCloud = () => ee.Filter.or(ee.Filter.lt('CLOUDCOVER', 30), ee.Filter.notNull(['CLOUDCOVER']).not());
async function withBands(base, bands, log) { let col = base; for (const b of bands) col = col.filter(ee.Filter.listContains('ORIGINAL_BANDS_PRESENT', b)); let n = await evaluate(col.size());
  if (!n) { const all = await evaluate(base.size()); if (all) { log(`  · band-presence metadata gave 0 scenes; using all ${all} scenes`); col = base; n = all; } } return [col, n]; }
const ucc = (img, b) => ee.Number(ee.Algorithms.If(img.propertyNames().contains('GAIN_COEFFICIENT_' + b), img.get('GAIN_COEFFICIENT_' + b), UCC[b]));
function asterRefl(img) {
  const doy = ee.Date(img.get('system:time_start')).getRelative('day', 'year'), d = ee.Number(1).subtract(ee.Number(0.01672).multiply(doy.subtract(4).multiply(0.0172020989).cos()));
  const sinE = ee.Number(ee.Algorithms.If(img.propertyNames().contains('SOLAR_ELEVATION'), img.get('SOLAR_ELEVATION'), 60)).multiply(Math.PI / 180).sin();
  const refl = ee.Image.cat(VS.map((b, i) => img.select(b).subtract(1).multiply(ucc(img, b)).multiply(Math.PI).multiply(d.pow(2)).divide(sinE.multiply(ESUN[b])).rename('b' + (i + 1)))).updateMask(img.select('B01').gt(0).and(img.select('B04').gt(0)));
  return refl.updateMask(refl.select('b1').gt(0.35).not()).toFloat();
}
async function asterSwir(o, keep) {
  const r = R('ast', 'ASTER VNIR/SWIR (2000–2008)', 'ast'), base = ee.ImageCollection('ASTER/AST_L1T_003').filterBounds(o.aoi).filterDate('2000-03-01', '2008-04-01').filter(dry()).filter(asterCloud());
  const [col, n] = await withBands(base, ['B01', 'B04', 'B09'], o.log); r.count = n; o.log(`ASTER SWIR: ${n} dry-season scenes before the 2008 SWIR failure`); if (!n) return null;
  let c = col.map(asterRefl).median().clip(o.aoi); const ndvi = c.normalizedDifference(['b3', 'b2']); c = c.updateMask(keep.and(ndvi.lt(o.ndvi_max)));
  const b = k => c.select(k), bands = [safeDiv(b('b2'), b('b1')).rename('ferric'), safeDiv(b('b5'), b('b4')).rename('ferrous_sil'), safeDiv(b('b7'), b('b6')).multiply(safeDiv(b('b4'), b('b6'))).rename('ohi'),
    safeDiv(b('b4'), b('b5')).multiply(safeDiv(b('b8'), b('b6'))).rename('kli'), safeDiv(b('b7'), b('b5')).multiply(safeDiv(b('b7'), b('b8'))).rename('ali'), safeDiv(b('b6'), b('b8')).multiply(safeDiv(b('b9'), b('b8'))).rename('cli'),
    safeDiv(b('b5').add(b('b7')), b('b6')).rename('phyllic'), safeDiv(b('b4').add(b('b6')), b('b5')).rename('argillic'), safeDiv(b('b6').add(b('b9')), b('b7').add(b('b8'))).rename('propylitic')];
  if (o.crosta) for (const [name, b4, refl, absb] of [['crosta_alunite', ['b1', 'b3', 'b5', 'b7'], 'b7', 'b5'], ['crosta_kaolinite', ['b1', 'b3', 'b4', 'b6'], 'b4', 'b6'], ['crosta_sericite', ['b1', 'b3', 'b5', 'b6'], 'b5', 'b6']]) {
    try { const [img, info] = await crosta(c, b4, refl, absb, o.aoi, o.scale, name); bands.push(img); r.crosta[name] = info; o.log(`  · Crósta ${name}: PC${info.chosen_pc}`); } catch (e) { o.log(`  · Crósta ${name} skipped: ${e.message}`); } }
  const [z, info] = await robustZ(ee.Image.cat(bands), o.aoi, o.scale, o.log); if (!z) { r.notes.push('No ASTER pixels left after masking.'); return r; }
  const names = await evaluate(z.bandNames()); r.zimg = z.rename(names.map(x => 'ast_' + x)); r.zinfo = info; r.names = names;
  if (['phyllic', 'argillic', 'propylitic'].every(x => names.includes(x))) r.previews.push(['ASTER alteration: R phyllic · G argillic · B propylitic', z, { bands: ['phyllic', 'argillic', 'propylitic'], min: -1, max: 3 }]);
  return r;
}
async function asterTir(o, keep) {
  const r = R('tir', 'ASTER TIR', 'tir'), base = ee.ImageCollection('ASTER/AST_L1T_003').filterBounds(o.aoi).filter(dry()).filter(asterCloud());
  const [col, n] = await withBands(base, ['B10', 'B13', 'B14'], o.log); r.count = n; o.log(`ASTER TIR: ${n} dry-season scenes`); if (!n) return null;
  const t = col.map(img => { const rad = ee.Image.cat(TIR.map(b => img.select(b).subtract(1).multiply(ucc(img, b)).rename(b.toLowerCase())));
    const bt13 = ee.Image(1349.82).divide(ee.Image(865.65).divide(rad.select('b13')).add(1).log()); return rad.updateMask(img.select('B13').gt(0).and(bt13.gt(288))).toFloat(); }).median().clip(o.aoi).updateMask(keep);
  const bands = [t.select('b11').pow(2).divide(t.select('b10').multiply(t.select('b12'))).rename('qi'), safeDiv(t.select('b13'), t.select('b14'), 0.01).rename('ci'), safeDiv(t.select('b12'), t.select('b13'), 0.01).rename('mi')];
  const [z, info] = await robustZ(ee.Image.cat(bands), o.aoi, Math.max(o.scale, 90), o.log); if (!z) return r;
  const names = await evaluate(z.bandNames()); r.zimg = z.rename(names.map(x => 'tir_' + x)); r.zinfo = info; r.names = names;
  if (names.length === 3) r.previews.push(['ASTER TIR: R quartz · G carbonate · B mafic', z, { bands: ['qi', 'ci', 'mi'], min: -1, max: 3 }]);
  return r;
}
const glo30 = aoi => ee.ImageCollection('COPERNICUS/DEM/GLO30').filterBounds(aoi).select('DEM').mosaic().setDefaultProjection('EPSG:4326', null, 30);
async function structure(o, waterKeep) {
  const r = R('dem', 'Copernicus GLO-30 DEM structure', 'dem'), dem = glo30(o.aoi); let edges = null;
  for (const az of [0, 45, 90, 135]) { const e = ee.Algorithms.CannyEdgeDetector({ image: ee.Terrain.hillshade(dem, az, 30), threshold: 30, sigma: 1.5 }).gt(0); edges = edges ? edges.or(e) : e; }
  const density = edges.unmask(0).toFloat().reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 }).reproject({ crs: 'EPSG:32648', scale: 150 }).focalMean(1000, 'circle', 'meters').clip(o.aoi).updateMask(waterKeep).rename('lineament_density');
  r.count = 1; const [z, info] = await robustZ(density, o.aoi, Math.max(o.scale, 150), o.log);
  if (z) { r.zimg = z.rename(['dem_lineament_density']); r.zinfo = info; r.names = ['lineament_density']; o.log('DEM structure: lineament density ready'); }
  return r;
}
function cultivationMask(aoi) {
  const y = new Date().getUTCFullYear(), cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  const v = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(aoi).filterDate(`${y - 2}-01-01`, new Date().toISOString().slice(0, 10)).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50)).linkCollection(cs, ['cs_cdf'])
    .map(img => img.normalizedDifference(['B8', 'B4']).rename('ndvi').updateMask(img.select('cs_cdf').gte(0.6)).toFloat());
  const wet = v.filter(ee.Filter.calendarRange(6, 10, 'month')).reduce(ee.Reducer.percentile([90])), d = v.filter(dry()).reduce(ee.Reducer.percentile([10]));
  return wet.gt(0.55).and(d.lt(0.30)).and(wet.subtract(d).gt(0.30)).unmask(0).focalMax(40, 'circle', 'meters').not().clip(aoi);
}
const clearingMask = aoi => ee.Image('UMD/hansen/global_forest_change_2024_v1_12').select('lossyear').gte(24 - 15 + 1).unmask(0).not().clip(aoi);
const slopeWeight = aoi => ee.Terrain.slope(glo30(aoi)).divide(8).clamp(0, 1).multiply(0.4).add(0.6).clip(aoi);
function coherent(score, thr = 0.4, minD = 0.25) { const s = score.focalMean(60, 'circle', 'meters'), d = score.gte(thr).unmask(0).focalMean(150, 'circle', 'meters'); return s.updateMask(d.gte(minD)).updateMask(score.mask().focalMax(60, 'circle', 'meters')); }
function prospectivity(results, model, log) {
  const [label, weights] = MODELS[model], zb = {};
  for (const r of results) if (r && r.zimg) for (const nm of r.names) (zb[nm] = zb[nm] || []).push(r.zimg.select(`${r.prefix}_${nm}`).rename(nm).toFloat());
  let num = null, den = null, tot = 0, spec = 0; const used = [];
  for (const [k, w] of Object.entries(weights)) { if (!zb[k]) continue; const z = zb[k].length === 1 ? zb[k][0] : ee.ImageCollection(zb[k]).mean(), mu = membership(z), valid = mu.mask().gt(0).unmask(0);
    num = num ? num.add(mu.unmask(0).multiply(w)) : mu.unmask(0).multiply(w); den = den ? den.add(valid.multiply(w)) : valid.multiply(w); used.push([k, w]); tot += w; if (k !== 'lineament_density') spec += w; }
  if (!used.length || !spec) { log('Prospectivity: no spectral evidence available for this model – skipped'); return [null, label, used]; }
  log(`Prospectivity "${label}": ${used.length} evidence layers (${used.map(u => u[0]).join(', ')})`);
  return [num.divide(den).updateMask(den.gte(0.3 * tot)).rename('prospectivity').toFloat(), label, used];
}
async function targets(score, aoi, scale, thr = 0.4, minHa = 3, limit = 200) {
  const vec = ee.Image.cat(score.gte(thr).selfMask().toInt().rename('label'), score.rename('score')).reduceToVectors({ geometry: aoi, scale, crs: 'EPSG:32648', geometryType: 'polygon', eightConnected: true, labelProperty: 'label', reducer: ee.Reducer.mean(), maxPixels: 1e10, bestEffort: true, tileScale: 4 });
  const fc = vec.map(f => { const g = f.geometry(), c = g.centroid(10).transform('EPSG:4326', 1).coordinates();
    return ee.Feature(g.simplify(scale).transform('EPSG:4326', 1)).set({ score: ee.Number(f.get('mean')), area_ha: g.area(10).divide(1e4), lon: c.get(0), lat: c.get(1) }); })
    .filter(ee.Filter.gte('area_ha', minHa)).sort('score', false).limit(limit);
  return evaluate(fc);
}
// the whole run; o = { aoi, areaKm2, model, sensors {s2,ls,ast,tir,dem}, ndvi_max, crosta, masks..., log }
export async function run(o) {
  const [start, end] = defaultDates(o.n_seasons || 3); Object.assign(o, { start, end, scale: Math.max(60, Math.round(Math.sqrt(o.areaKm2 * 1e6 / 4e6))) });
  o.log(`Statistics at ${o.scale} m · ${start} → ${end}`);
  let keep = commonMask(o.aoi, o.mask_cropland, o.mask_builtup, o.mask_water);
  if (o.mask_cultivated) { keep = keep.and(cultivationMask(o.aoi)); o.log('  · cultivated-land mask: wet-season green, dry-season bare (Sentinel-2 NDVI)'); }
  if (o.mask_clearing) { keep = keep.and(clearingMask(o.aoi)); o.log('  · forest-clearing mask: Hansen GFC loss 2010–2024'); }
  const waterKeep = commonMask(o.aoi, false, false, true), results = [], S = o.sensors;
  for (const [k, fn] of [['s2', () => sentinel2(o, keep)], ['ls', () => landsat(o, keep)], ['ast', () => asterSwir(o, keep)], ['tir', () => asterTir(o, keep)], ['dem', () => structure(o, waterKeep)]]) {
    if (!S[k]) continue; o.step && o.step(k); try { const r = await fn(); if (r) results.push(r); } catch (e) { o.log(`⚠ ${k} failed: ${String(e.message).slice(0, 300)}`); } }
  if (!results.some(r => r.zimg)) throw new Error('No usable data for this area. Try a larger area, more dry seasons, a higher NDVI threshold, or switch off the cropland mask.');
  let [score, label, used] = prospectivity(results, o.model, o.log), tg = null;
  if (score) { if (o.slope_weight) { score = score.multiply(slopeWeight(o.aoi)).rename('prospectivity'); o.log('  · slope weighting: flat lowlands ×0.6 → slopes ≥8° ×1.0'); }
    if (o.coherence) { score = coherent(score).rename('prospectivity').toFloat(); o.log('  · spatial coherence: isolated anomalies removed'); }
    try { tg = await targets(score, o.aoi, Math.max(30, o.scale / 2)); o.log(`Targets: ${tg.features.length} coherent zones ≥ 0.40 and ≥ 3 ha`); } catch (e) { o.log('Targets skipped: ' + e.message); } }
  return { results, score, label, used, targets: tg, start, end, scale: o.scale };
}
export const scoreVis = s => s.visualize({ min: 0.15, max: 0.85, palette: PROSPECT_PALETTE });
