"""Extract OSM layers from the Cambodia PBF into pickled shapely lists."""
import osmium, pickle, sys
from shapely import wkb as swkb

ROAD = {  # highway -> class code
    'motorway': 1, 'motorway_link': 2, 'trunk': 3, 'trunk_link': 4, 'primary': 5, 'primary_link': 6,
    'secondary': 7, 'secondary_link': 8, 'tertiary': 9, 'tertiary_link': 10, 'unclassified': 11,
    'residential': 12, 'living_street': 13, 'service': 14, 'pedestrian': 15, 'track': 16,
    'footway': 17, 'path': 18, 'cycleway': 19, 'steps': 20, 'construction': 21, 'road': 11, 'raceway': 14,
}
SURF = {  # surface -> code (0 unknown)
    'asphalt': 1, 'paved': 1, 'chipseal': 1,
    'concrete': 2, 'concrete:plates': 2, 'concrete:lanes': 2,
    'paving_stones': 3, 'sett': 3, 'bricks': 3, 'cobblestone': 3, 'unhewn_cobblestone': 3,
    'unpaved': 4, 'dirt': 4, 'ground': 4, 'earth': 4, 'compacted': 5, 'fine_gravel': 5, 'gravel': 5,
    'laterite': 4, 'mud': 4, 'sand': 6, 'grass': 7, 'wood': 8, 'metal': 8,
}
WATERWAY = {'river': 1, 'canal': 2, 'stream': 3, 'ditch': 4, 'drain': 4}
LANDUSE = {  # (key,value) -> code
    ('natural', 'wood'): 1, ('landuse', 'forest'): 1, ('landuse', 'orchard'): 2, ('landuse', 'plantation'): 2,
    ('landuse', 'farmland'): 3, ('landuse', 'paddy'): 3, ('landuse', 'meadow'): 4, ('landuse', 'grass'): 4,
    ('natural', 'grassland'): 4, ('leisure', 'park'): 5, ('leisure', 'garden'): 5, ('natural', 'wetland'): 6,
    ('natural', 'scrub'): 7, ('natural', 'beach'): 8, ('natural', 'sand'): 8, ('landuse', 'residential'): 9,
    ('landuse', 'commercial'): 10, ('landuse', 'retail'): 10, ('landuse', 'industrial'): 11,
    ('landuse', 'construction'): 12, ('landuse', 'quarry'): 12, ('landuse', 'brownfield'): 12,
    ('landuse', 'cemetery'): 13, ('landuse', 'religious'): 14, ('leisure', 'pitch'): 15,
    ('aeroway', 'apron'): 16, ('aeroway', 'runway'): 16, ('aeroway', 'taxiway'): 16, ('landuse', 'military'): 17,
    ('landuse', 'farmyard'): 3, ('landuse', 'greenfield'): 4, ('leisure', 'sports_centre'): 15,
}
WATER_AREA = {('natural', 'water'), ('landuse', 'reservoir'), ('landuse', 'basin'), ('waterway', 'riverbank'),
              ('leisure', 'swimming_pool'), ('landuse', 'aquaculture')}
BTYPE = {'house': 1, 'detached': 1, 'hut': 1, 'cabin': 1, 'bungalow': 1, 'residential': 2, 'apartments': 3,
         'commercial': 4, 'retail': 4, 'office': 4, 'hotel': 4, 'industrial': 5, 'warehouse': 5, 'factory': 5,
         'temple': 6, 'religious': 6, 'church': 6, 'mosque': 6, 'monastery': 6, 'pagoda': 6, 'shrine': 6,
         'school': 7, 'university': 7, 'college': 7, 'hospital': 8, 'public': 8, 'government': 8,
         'roof': 9, 'shed': 10, 'garage': 10, 'stupa': 11, 'farm_auxiliary': 10, 'construction': 12}

def num(v):
    try:
        return float(str(v).split(';')[0].replace('m', '').replace(',', '.').strip())
    except Exception:
        return 0.0

ERR=[]
fab = osmium.geom.WKBFactory()
out = {'roads': [], 'rail': [], 'waterways': [], 'water': [], 'landuse': [], 'buildings': [], 'coast': []}

class H(osmium.SimpleHandler):
    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        try:
            if hw in ROAD:
                g = swkb.loads(fab.create_linestring(w), hex=True)
                surf = SURF.get(t.get('surface', ''), 0)
                lanes = int(num(t.get('lanes', '0')))
                width = num(t.get('width', '0'))
                ow = t.get('oneway') in ('yes', '1', 'true') or hw in ('motorway', 'motorway_link') or t.get('junction') == 'roundabout'
                flags = (1 if ow else 0) | (2 if t.get('bridge') not in (None, 'no') else 0) | (4 if t.get('tunnel') not in (None, 'no') else 0) \
                    | (16 if t.get('junction') == 'roundabout' else 0)
                layer = int(num(t.get('layer', '0')))
                out['roads'].append((w.id, ROAD[hw], surf, lanes, width, flags, layer, g, t.get('ref', ''), t.get('name:en') or t.get('name', '')))
            elif t.get('railway') in ('rail', 'light_rail', 'narrow_gauge'):
                g = swkb.loads(fab.create_linestring(w), hex=True)
                out['rail'].append((w.id, 2 if t.get('bridge') not in (None, 'no') else 0, int(num(t.get('layer', '0'))), g))
            elif t.get('waterway') in WATERWAY and w.nodes[0].ref != w.nodes[-1].ref:
                g = swkb.loads(fab.create_linestring(w), hex=True)
                out['waterways'].append((w.id, WATERWAY[t['waterway']], num(t.get('width', '0')), g))
            elif t.get('natural') == 'coastline':
                out['coast'].append(swkb.loads(fab.create_linestring(w), hex=True))
        except Exception as e:
            ERR.append(repr(e))

    def area(self, a):
        t = a.tags
        try:
            kind = None
            if 'building' in t and t.get('building') != 'no':
                kind = 'b'
            elif any((k, t.get(k)) in WATER_AREA for k in ('natural', 'landuse', 'waterway', 'leisure')):
                kind = 'w'
            else:
                for k in ('natural', 'landuse', 'leisure', 'aeroway'):
                    if (k, t.get(k)) in LANDUSE:
                        kind = ('l', LANDUSE[(k, t.get(k))]); break
            if kind is None:
                return
            g = swkb.loads(fab.create_multipolygon(a), hex=True)
            if kind == 'b':
                bt = BTYPE.get(t.get('building'), 0)
                if t.get('amenity') == 'place_of_worship' or t.get('religion') == 'buddhist' and bt == 0:
                    bt = 6
                h = num(t.get('height', '0')) or num(t.get('building:height', '0'))
                lv = num(t.get('building:levels', '0'))
                out['buildings'].append((a.orig_id(), bt, h, lv, g))
            elif kind == 'w':
                out['water'].append(g)
            else:
                out['landuse'].append((kind[1], g))
        except Exception as e:
            ERR.append(repr(e))

H().apply_file(sys.argv[1], locations=True)
import collections; print(collections.Counter(ERR).most_common(5))
for k, v in out.items():
    print(k, len(v))
pickle.dump(out, open('layers.pkl', 'wb'))
