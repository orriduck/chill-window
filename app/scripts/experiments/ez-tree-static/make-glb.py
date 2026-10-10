import base64, json, math, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SRC=ROOT/'.work/upstream/src/app/public/textures'
OUT=ROOT/'glb'; OUT.mkdir(exist_ok=True)

def pad4(b, val=0): return b + bytes([val])*((-len(b))%4)
def color(hexval): return [((hexval>>16)&255)/255,((hexval>>8)&255)/255,(hexval&255)/255,1]

def build(preset,lod):
 raw=json.loads((ROOT/'raw'/f'{preset.lower().replace(" ","-")}-lod{lod}.json').read_text())
 short=preset.split()[0].lower(); scale=20/raw['sourceHeight']
 blobs=[]; views=[]; accessors=[]
 def add(data,target=None):
  offset=sum(len(x) for x in blobs); aligned=pad4(data); blobs.append(aligned)
  v={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
  if target: v['target']=target
  views.append(v); return len(views)-1
 def accessor(data,ctype,components,count,target,mins=None,maxs=None):
  vi=add(data,target); a={'bufferView':vi,'componentType':ctype,'count':count,'type':components}
  if mins is not None: a['min']=mins; a['max']=maxs
  accessors.append(a); return len(accessors)-1
 mesh_prims=[]
 for geom,matid in ((raw['branch'],0),(raw['leaves'],1)):
  pos=base64.b64decode(geom['position']); vals=struct.unpack('<'+'f'*(len(pos)//4),pos)
  ps=[x*scale for x in vals]; pbytes=struct.pack('<'+'f'*len(ps),*ps)
  triples=list(zip(ps[::3],ps[1::3],ps[2::3])); mins=[min(p[i] for p in triples) for i in range(3)]; maxs=[max(p[i] for p in triples) for i in range(3)]
  n=len(ps)//3
  pi=accessor(pbytes,5126,'VEC3',n,34962,mins,maxs)
  ni=accessor(base64.b64decode(geom['normal']),5126,'VEC3',n,34962)
  ui=accessor(base64.b64decode(geom['uv']),5126,'VEC2',n,34962)
  idx=base64.b64decode(geom['indices'])
  ctype=5123 if geom['indexType']=='Uint16Array' else 5125
  ii=accessor(idx,ctype,'SCALAR',len(idx)//(2 if ctype==5123 else 4),34963)
  mesh_prims.append({'attributes':{'POSITION':pi,'NORMAL':ni,'TEXCOORD_0':ui},'indices':ii,'material':matid,'mode':4})
 # Embed actual source texture bytes; ambientCG Bark001 maps + author Ash/Oak leaf texture.
 images=[]; textures=[]
 def tex(path,mime):
  i=len(images); data=path.read_bytes(); vi=add(data)
  images.append({'bufferView':vi,'mimeType':mime,'name':path.name})
  textures.append({'sampler':0,'source':i}); return len(textures)-1
 bark=SRC/'bark/Bark001_1K-JPG'
 base=tex(bark/'Bark001_1K-JPG_Color.jpg','image/jpeg')
 normal=tex(bark/'Bark001_1K-JPG_NormalGL.jpg','image/jpeg')
 rough=tex(bark/'Bark001_1K-JPG_Roughness.jpg','image/jpeg')
 leaf=tex(SRC/f'leaves/{short}.png','image/png')
 preset_json=json.loads((ROOT/'.work/upstream/src/lib/presets'/f'{short}_large.json').read_text())
 bark_factor=color(preset_json['bark']['tint']); leaf_factor=color(preset_json['leaves']['tint'])
 gltf={'asset':{'version':'2.0','generator':'EZ-Tree offline static export; source dcf309bd86bd521083d9c70f01f2de45fdc7c457'},
  'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':f'{preset} LOD{lod} (scaled to 20m)','mesh':0,'extras':{'sourcePreset':preset,'sourceLOD':lod,'sourceHeightUnits':raw['sourceHeight'],'scaleTo20m':scale}}],
  'meshes':[{'name':f'{preset} LOD{lod}','primitives':mesh_prims}],
  'materials':[{'name':'Bark001 CC0 PBR','pbrMetallicRoughness':{'baseColorFactor':bark_factor,'baseColorTexture':{'index':base},'metallicFactor':0,'roughnessFactor':1,'metallicRoughnessTexture':{'index':rough}},'normalTexture':{'index':normal}},
   {'name':f'{short.title()} leaves MIT alpha-mask','pbrMetallicRoughness':{'baseColorFactor':leaf_factor,'baseColorTexture':{'index':leaf},'metallicFactor':0,'roughnessFactor':1},'alphaMode':'MASK','alphaCutoff':0.5,'doubleSided':True}],
  'textures':textures,'images':images,'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],
  'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':0}]}
 binary=b''.join(blobs); gltf['buffers'][0]['byteLength']=len(binary)
 j=pad4(json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode(),32); binary=pad4(binary)
 total=12+8+len(j)+8+len(binary)
 glb=b'glTF'+struct.pack('<II',2,total)+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(binary),b'BIN\x00')+binary
 path=OUT/f'{short}-large-lod{lod}-20m.glb'; path.write_bytes(glb)
 print(path, 'bytes',len(glb),'triangles',sum(x['triangleCount'] for x in (raw['branch'],raw['leaves'])),'scale',scale)
for p in ('Ash Large','Oak Large'):
 for l in range(3): build(p,l)
