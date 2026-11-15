"""Rasterise ODC 'Geology of Cambodia 2006' (GeoJSON, EPSG:32648) to data/geology.png (unit id per 0.002° cell)."""
import json, sys
from shapely.geometry import shape, Polygon
from shapely.ops import transform
from pyproj import Transformer
from PIL import Image, ImageDraw
tr = Transformer.from_crs(32648, 4326, always_xy=True).transform
j = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'geologyofcambodia2006.geojson'))
W0, E0, S0, N0, res = 102.18, 107.66, 10.22, 14.72, 0.002
w, h = int(round((E0 - W0) / res)), int(round((N0 - S0) / res))
img = Image.new('L', (w, h), 0); d = ImageDraw.Draw(img)
feats = sorted([(transform(tr, shape(f['geometry']).buffer(0)), f['properties']['map_id']) for f in j['features']], key=lambda t: -t[0].area)
px = lambda c: [((x - W0) / res, (N0 - y) / res) for x, y in c]
for g, mid in feats:
    for p in ([g] if isinstance(g, Polygon) else g.geoms): d.polygon(px(p.exterior.coords), fill=mid)
img.save('../data/geology.png', optimize=True)
