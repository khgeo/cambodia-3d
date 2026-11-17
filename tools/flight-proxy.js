// Small CORS proxy for live flight data, for the Cambodia 3D Landscape radar.
// Deploy free on Cloudflare: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker →
// Edit code → paste this file → Deploy. Then paste https://<name>.<you>.workers.dev/?url= into the radar panel.
// Only the open ADS-B sites below can be fetched, so it cannot be used as an open proxy.
const ALLOW = ['opendata.adsb.fi', 'api.adsb.lol', 'opensky-network.org'];
const ORIGINS = ['https://khgeo.github.io', 'http://localhost', 'http://127.0.0.1'];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '', ok = ORIGINS.some(o => origin.startsWith(o));
    const cors = { 'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(req.url).searchParams.get('url');
    let u; try { u = new URL(target); } catch (e) { return new Response('Missing ?url=', { status: 400, headers: cors }); }
    if (u.protocol !== 'https:' || !ALLOW.includes(u.hostname)) return new Response('Host not allowed', { status: 403, headers: cors });
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'cambodia-3d-radar (github.com/khgeo/cambodia-3d)' }, cf: { cacheTtl: 5 } });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'max-age=5' } });
  },
};
