"""Cut extracted OSM layers into z13 JSON tiles + an overview road file."""
import pickle, json, math, os, collections, shutil
from shapely.geometry import box, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection, mapping
from shapely import make_valid

Z = 13
OUT = '../data'
L = pickle.load(open('layers.pkl', 'rb'))

def lon2x(lon): return (lon + 180) / 360 * 2 ** Z
def lat2y(lat): r = math.radians(lat); return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z
def x2lon(x): return x / 2 ** Z * 360 - 180
def y2lat(y): n = math.pi - 2 * math.pi * y / 2 ** Z; return math.degrees(math.atan(math.sinh(n)))

_boxes = {}
def tbox(x, y):
    b = _boxes.get((x, y))
    if b is None:
        b = box(x2lon(x), y2lat(y + 1), x2lon(x + 1), y2lat(y)); _boxes[(x, y)] = b
    return b

def tiles_for(bounds):
    w, s, e, n = bounds
    for x in range(int(lon2x(w)), int(lon2x(e)) + 1):
        for y in range(int(lat2y(n)), int(lat2y(s)) + 1):
            yield x, y

tiles = collections.defaultdict(lambda: collections.defaultdict(list))

def enc(coords, x, y):
    w, s = x2lon(x), y2lat(y + 1)
    out, px, py = [], 0, 0
    for c in coords:
        qx, qy = round((c[0] - w) * 1e6), round((c[1] - s) * 1e6)
        out += [qx - px, qy - py]; px, py = qx, qy
    return out

def lines(g):
    if g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if isinstance(g, (MultiLineString, GeometryCollection)):
        return [p for q in g.geoms for p in lines(q)]
    return []

def polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        return [p for q in g.geoms for p in polys(q)]
    return []

# --- urban density grid from building centroids (0.005 deg cells ≈ 550 m) ---
dens = collections.Counter()
for (_, _, _, _, g) in L['buildings']:
    c = g.representative_point(); dens[(int(c.x / 0.005), int(c.y / 0.005))] += 1
def urban(g):
    c = g.interpolate(0.5, normalized=True)
    return dens[(int(c.x / 0.005), int(c.y / 0.005))] >= 45

def add_lines(key, g, head, x_y_iter=None):
    for (x, y) in tiles_for(g.bounds):
        b = tbox(x, y)
        if not g.intersects(b): continue
        for part in lines(g.intersection(b)) if not b.contains(g) else [g]:
            if len(part.coords) < 2: continue
            tiles[(x, y)][key].append(head + [enc(part.coords, x, y)])

print('roads'); n = 0
for (wid, cls, surf, lanes, width, flags, layer, g, ref, name) in L['roads']:
    if urban(g): flags |= 8
    add_lines('r', g, [cls, surf, lanes, round(width * 10), flags, layer, wid])
print('rail')
for (wid, flags, layer, g) in L['rail']:
    add_lines('rl', g, [flags, layer, wid])
print('waterways')
for (wid, t, width, g) in L['waterways']:
    add_lines('ww', g, [t, round(width * 10), wid])

def add_polys(key, g, head, simp=0.00001):
    g = make_valid(g)
    if simp: g = g.simplify(simp, preserve_topology=True)
    for (x, y) in tiles_for(g.bounds):
        b = tbox(x, y)
        if not g.intersects(b): continue
        part = g if b.contains(g) else g.intersection(b)
        for p in polys(part):
            if p.area < 1e-9: continue
            rings = [enc(p.exterior.coords[:-1], x, y)] + [enc(i.coords[:-1], x, y) for i in p.interiors if len(i.coords) > 3]
            tiles[(x, y)][key].append(head + [rings])
print('water')
for g in L['water']: add_polys('w', g, [])
print('landuse')
for (code, g) in L['landuse']: add_polys('l', g, [code])
print('buildings')
for (bid, bt, h, lv, g) in L['buildings']:
    ps = polys(g)
    if not ps: continue
    p = max(ps, key=lambda q: q.area)
    c = p.representative_point()
    x, y = int(lon2x(c.x)), int(lat2y(c.y))
    tiles[(x, y)]['b'].append([bt, round(h * 10), round(lv), enc(p.exterior.coords[:-1], x, y)])

# --- write tiles ---
if os.path.exists(OUT + '/13'): shutil.rmtree(OUT + '/13')
total = 0; index = []
for (x, y), d in tiles.items():
    os.makedirs(f'{OUT}/13/{x}', exist_ok=True)
    s = json.dumps(d, separators=(',', ':'))
    open(f'{OUT}/13/{x}/{y}.json', 'w').write(s)
    total += len(s); index.append([x, y, len(s)])
print('tiles', len(tiles), 'MB', total / 1e6, 'max KB', max(i[2] for i in index) / 1e3)
json.dump({'z': Z, 'tiles': [[a, b] for a, b, _ in index]}, open(f'{OUT}/index.json', 'w'), separators=(',', ':'))

# --- overview major roads ---
feats = []
for (wid, cls, surf, lanes, width, flags, layer, g, ref, name) in L['roads']:
    if cls > 10: continue
    s = g.simplify(0.00012)
    feats.append({'type': 'Feature', 'properties': {'c': cls, 'r': ref},
                  'geometry': {'type': 'LineString', 'coordinates': [[round(a, 5), round(b, 5)] for a, b in s.coords]}})
s = json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':'), ensure_ascii=False)
open(f'{OUT}/overview_roads.geojson', 'w').write(s)
print('overview MB', len(s) / 1e6)
