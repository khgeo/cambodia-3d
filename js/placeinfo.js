// Place information like a map app: tap a place → name (Khmer / English), type, address, photos, details and
// what is nearby. Sources: OpenStreetMap (Nominatim, Overpass, bundled place names), Wikimedia Commons (photos),
// Wikipedia (articles nearby), Wikidata (main photo), geoBoundaries (province / district / commune), and the scene itself.
import * as THREE from 'three';

const timed = (u, o = {}, ms = 12000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(u, { ...o, signal: c.signal }).finally(() => clearTimeout(t)); };
const km = (a, b, c, d) => { const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180, h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------- province / district / commune from the bundled boundaries (offline, fast) ---------- */
let ADMIN = null;
async function admin() {
  if (ADMIN) return ADMIN;
  const buf = new Uint8Array(await (await fetch('data/kh_admin3.geojson.gz')).arrayBuffer()), gz = buf[0] === 0x1f && buf[1] === 0x8b; // the server may already have unzipped it
  const j = JSON.parse(gz ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf));
  ADMIN = j.features.map(f => { const P = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; let w = 180, e = -180, s = 90, n = -90; for (const poly of P) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return { p: f.properties, P, bb: [w, s, e, n] }; });
  return ADMIN;
}
const inRing = (x, y, R) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
export async function adminAt(lat, lon) { try { const A = await admin(); for (const a of A) { if (lon < a.bb[0] || lon > a.bb[2] || lat < a.bb[1] || lat > a.bb[3]) continue; for (const poly of a.P) if (inRing(lon, lat, poly[0]) && !poly.slice(1).some(h => inRing(lon, lat, h))) return a.p; } } catch (e) { } return null; }

/* ---------- OpenStreetMap ---------- */
async function reverse(lat, lon) {
  const r = await timed(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&extratags=1&namedetails=1&accept-language=km,en`); return r.json();
}
async function overpass(lat, lon, rad) {
  const q = `[out:json][timeout:12];(nwr(around:${rad},${lat},${lon})["name"]["highway"!~"."];);out center tags 60;`;
  // ask the mirrors at the same time and take the first answer, so a busy server cannot hold the card for long
  const ask = ep => timed(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q) }, 9000).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  let j; try { j = await Promise.any(['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'].map(ask)); } catch (e) { return null; }
  return (j.elements || []).map(e => ({ id: e.type + '/' + e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags || {} })).filter(e => e.lat != null);
}
/* ---------- photos and articles ---------- */
async function commonsPhotos(lat, lon, rad = 400) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=${rad}&ggslimit=14&ggsnamespace=6&prop=imageinfo|coordinates&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
  const j = await (await timed(u)).json(); return Object.values((j.query || {}).pages || {}).filter(p => p.imageinfo && /\.(jpe?g|png|webp)$/i.test(p.title)).map(p => { const ii = p.imageinfo[0], m = ii.extmetadata || {}, strip = h => String(h || '').replace(/<[^>]+>/g, '').trim();
    return { thumb: ii.thumburl, url: ii.descriptionurl, title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), author: strip(m.Artist && m.Artist.value).slice(0, 60), license: strip(m.LicenseShortName && m.LicenseShortName.value), lat: p.coordinates && p.coordinates[0].lat, lon: p.coordinates && p.coordinates[0].lon }; })
    .sort((a, b) => (a.lat != null ? km(lat, lon, a.lat, a.lon) : 9) - (b.lat != null ? km(lat, lon, b.lat, b.lon) : 9));
}
async function wikiNearby(lat, lon, lang = 'en') {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=10000&ggslimit=6&prop=extracts|pageimages|coordinates&exintro=1&explaintext=1&exsentences=2&piprop=thumbnail&pithumbsize=160&format=json&origin=*`;
  const j = await (await timed(u)).json(); return Object.values((j.query || {}).pages || {}).map(p => ({ title: p.title, text: p.extract || '', thumb: p.thumbnail && p.thumbnail.source, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, km: p.coordinates ? km(lat, lon, p.coordinates[0].lat, p.coordinates[0].lon) : null })).sort((a, b) => (a.km ?? 99) - (b.km ?? 99));
}
async function wikidataImage(q) {
  try { const j = await (await timed(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`)).json(), e = j.entities[q], f = e.claims.P18 && e.claims.P18[0].mainsnak.datavalue.value;
    return f ? { thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=480`, url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f)}`, title: f, author: 'Wikimedia Commons', license: '', main: true, desc: (e.descriptions.en || {}).value } : null; } catch (e) { return null; }
}

/* ---------- what a tag means, in English and Khmer ---------- */
const KIND = { place_of_worship: ['Pagoda / place of worship', 'វត្ត / ទីសក្ការៈ', '🛕'], school: ['School', 'សាលារៀន', '🏫'], university: ['University', 'សាកលវិទ្យាល័យ', '🎓'], college: ['College', 'មហាវិទ្យាល័យ', '🎓'], kindergarten: ['Kindergarten', 'មត្តេយ្យ', '🧸'],
  hospital: ['Hospital', 'មន្ទីរពេទ្យ', '🏥'], clinic: ['Clinic / health centre', 'មណ្ឌលសុខភាព', '⚕️'], pharmacy: ['Pharmacy', 'ឱសថស្ថាន', '💊'], marketplace: ['Market', 'ផ្សារ', '🛒'], restaurant: ['Restaurant', 'ភោជនីយដ្ឋាន', '🍽️'], cafe: ['Café', 'ហាងកាហ្វេ', '☕'],
  fuel: ['Fuel station', 'ស្ថានីយប្រេង', '⛽'], bank: ['Bank', 'ធនាគារ', '🏦'], police: ['Police', 'ប៉ុស្ដិ៍ប៉ូលិស', '👮'], townhall: ['Office / town hall', 'សាលាឃុំ / ការិយាល័យ', '🏛️'], post_office: ['Post office', 'ប្រៃសណីយ៍', '📮'],
  hotel: ['Hotel', 'សណ្ឋាគារ', '🏨'], guest_house: ['Guest house', 'ផ្ទះសំណាក់', '🏠'], attraction: ['Attraction', 'កន្លែងទាក់ទាញ', '⭐'], museum: ['Museum', 'សារមន្ទីរ', '🏛️'], viewpoint: ['Viewpoint', 'ចំណុចមើលទេសភាព', '🔭'],
  peak: ['Hill / peak', 'ភ្នំ', '⛰️'], river: ['River', 'ទន្លេ', '〰️'], village: ['Village', 'ភូមិ', '🏘️'], hamlet: ['Hamlet', 'ក្រុមភូមិ', '🏠'], town: ['Town', 'ក្រុង', '🏙️'], city: ['City', 'ទីក្រុង', '🏙️'], suburb: ['Quarter', 'សង្កាត់', '🏘️'] };
export function kindOf(tags) { const k = tags.amenity || tags.tourism || tags.shop || tags.place || tags.natural || tags.waterway || tags.leisure || tags.office || tags.building || ''; return { key: k, ...(KIND[k] ? { en: KIND[k][0], km: KIND[k][1], icon: KIND[k][2] } : { en: k ? k.replace(/_/g, ' ') : 'Place', km: '', icon: '📍' }) }; }

/* ---------- everything about one spot ---------- */
export async function placeInfo(lat, lon, near = []) {
  const out = { lat, lon };
  const [rev, ov, photos, wEn, wKm, adm] = await Promise.allSettled([reverse(lat, lon), overpass(lat, lon, 150), commonsPhotos(lat, lon), wikiNearby(lat, lon, 'en'), wikiNearby(lat, lon, 'km'), adminAt(lat, lon)]);
  out.reverse = rev.value || null; out.admin = adm.value || null; out.photos = photos.value || []; out.wiki = [...(wKm.value || []).slice(0, 2), ...(wEn.value || [])].slice(0, 6);
  let feats = ov.value || []; if (!ov.value) feats = near; // offline fallback: the bundled place names
  feats = feats.map(f => ({ ...f, d: km(lat, lon, f.lat, f.lon) * 1000 })).sort((a, b) => a.d - b.d); out.nearby = feats.slice(0, 12); out.overpass = !!ov.value;
  // the place itself: the nearest named feature within ~60 m, else what Nominatim found
  const main = feats.find(f => f.d < 60) || null, rt = out.reverse && out.reverse.namedetails ? out.reverse.namedetails : {};
  out.main = main ? main.tags : out.reverse ? { name: out.reverse.name, ...rt, ...(out.reverse.extratags || {}), [out.reverse.category]: out.reverse.type } : {};
  const q = out.main.wikidata; if (q) { const im = await wikidataImage(q); if (im) { out.photos.unshift(im); if (im.desc) out.wdDesc = im.desc; } }
  if (out.main.image && /^https?:/.test(out.main.image)) out.photos.unshift({ thumb: out.main.image, url: out.main.image, title: 'OpenStreetMap image', author: '', license: '' });
  return out;
}

/* ---------- names of places shown in the 3D scene ---------- */
export function placeLabels(world, list, lang) {
  const g = new THREE.Group(), D = world.D;
  for (const p of list) {
    const x = world.F.x(p.lon), z = world.F.z(p.lat); if (x < D.X0 || x > D.X0 + D.W || z < D.Z0 || z > D.Z0 + D.H) continue;
    const k = kindOf(p.tags), nk = p.tags['name:km'] || '', ne = p.tags['name:en'] || p.tags.name || '', name = lang === 'km' ? (nk || ne) : lang === 'en' ? (ne || nk) : [nk, ne].filter(Boolean).join(' · '); if (!name) continue;
    const big = /village|town|city|suburb/.test(k.key), c = document.createElement('canvas'), x2 = c.getContext('2d'), fs = big ? 34 : 26; x2.font = `700 ${fs}px "Noto Sans Khmer", system-ui, sans-serif`; const tw = x2.measureText(name).width;
    c.width = Math.ceil(tw + (big ? 30 : 64)); c.height = 64; const g2 = c.getContext('2d'); g2.font = `700 ${fs}px "Noto Sans Khmer", system-ui, sans-serif`; g2.textBaseline = 'middle';
    if (!big) { g2.fillStyle = 'rgba(255,255,255,.92)'; g2.beginPath(); g2.arc(24, 32, 20, 0, 7); g2.fill(); g2.font = '24px system-ui'; g2.textAlign = 'center'; g2.fillText(k.icon, 24, 33); g2.font = `700 ${fs}px "Noto Sans Khmer", system-ui, sans-serif`; g2.textAlign = 'left'; }
    g2.lineWidth = 7; g2.strokeStyle = 'rgba(0,0,0,.75)'; g2.strokeText(name, big ? 14 : 52, 33); g2.fillStyle = big ? '#fff3c4' : '#ffffff'; g2.fillText(name, big ? 14 : 52, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
    const h = big ? 0.03 : 0.024; s.scale.set(h * c.width / 64, h, 1); s.center.set(big ? 0.5 : 24 / c.width, 0); s.position.set(x, world.hAt(x, z) + (big ? 25 : 6), z); s.renderOrder = 38; s.userData.place = p; g.add(s);
  }
  return g;
}
