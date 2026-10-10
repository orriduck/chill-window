#!/usr/bin/env python3
"""Fetch the official Poly Haven Pine Tree 01 1k Blender source and its linked maps."""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib, json

ROOT=Path(__file__).resolve().parent
UA='ChillWindowAssetRebuild/1.0 (+https://github.com/orriduck/chill-window)'
def fetch(url):
    with urlopen(Request(url,headers={'User-Agent':UA,'Accept':'application/json'}),timeout=180) as r:
        return r.read()
def md5(data): return hashlib.md5(data).hexdigest()
def sha256(data): return hashlib.sha256(data).hexdigest()
api=json.loads(fetch('https://api.polyhaven.com/files/pine_tree_01'))
entry=api['blend']['1k']['blend']
raw=fetch(entry['url'])
assert len(raw)==entry['size'] and md5(raw)==entry['md5'], 'Official .blend size/MD5 mismatch'
blend_path=ROOT/'pine_tree_01_1k.blend';blend_path.write_bytes(raw)
files=[]
for rel,info in entry['include'].items():
    data=fetch(info['url'])
    assert len(data)==info['size'] and md5(data)==info['md5'], f'Official texture size/MD5 mismatch: {rel}'
    path=ROOT/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    files.append({'path':rel,'url':info['url'],'bytes':len(data),'md5':md5(data),'sha256':sha256(data)})
manifest={'asset':'pine_tree_01','license':'CC0','api':'https://api.polyhaven.com/files/pine_tree_01','blend':{'url':entry['url'],'bytes':len(raw),'md5':md5(raw),'sha256':sha256(raw)},'textures':files}
(ROOT/'official-source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'blend':manifest['blend'],'textureCount':len(files),'textureBytes':sum(f['bytes'] for f in files)},indent=2))
