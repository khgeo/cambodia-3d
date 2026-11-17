import osmium, json, sys, os, collections
AM={'place_of_worship','school','hospital','clinic','marketplace','police','townhall','university','fuel','college','doctors','bank'}
PL={'city','town','village','hamlet','suburb','neighbourhood','locality','isolated_dwelling'}
out=collections.defaultdict(list)
def add(lon,lat,kind,t):
    nk=t.get('name:km') or (t.get('name') if any('ក'<=c<='៿' for c in t.get('name','')) else '')
    ne=t.get('name:en') or (t.get('name') if any(c.isascii() and c.isalpha() for c in t.get('name','')) else '')
    if kind!='peak' and not (nk or ne) and kind not in AM: return
    ele=t.get('ele','')
    out[(int((lon-102)//0.25),int((lat-10)//0.25))].append([round(lon,6),round(lat,6),kind,nk,ne,t.get('religion',''),ele])
class H(osmium.SimpleHandler):
    def node(self,n):
        t={k.k:k.v for k in n.tags}
        if not t: return
        if t.get('place') in PL: add(n.location.lon,n.location.lat,t['place'],t)
        elif t.get('amenity') in AM: add(n.location.lon,n.location.lat,t['amenity'],t)
        elif t.get('natural')=='peak': add(n.location.lon,n.location.lat,'peak',t)
    def way(self,w):
        t={k.k:k.v for k in w.tags}
        if t.get('amenity') in AM or (t.get('waterway')=='river' and t.get('name')):
            try:
                ls=[(nd.lon,nd.lat) for nd in w.nodes]
            except Exception: return
            if not ls: return
            if t.get('waterway')=='river':
                for i in range(0,len(ls),max(1,len(ls)//3)): add(ls[i][0],ls[i][1],'river',t)
            else:
                add(sum(p[0] for p in ls)/len(ls),sum(p[1] for p in ls)/len(ls),t['amenity'],t)
H().apply_file(sys.argv[1],locations=True)
os.makedirs(sys.argv[2],exist_ok=True); n=0
for (i,j),v in out.items():
    json.dump(v,open(f'{sys.argv[2]}/{i}_{j}.json','w'),ensure_ascii=False,separators=(',',':')); n+=len(v)
print(n,len(out))
