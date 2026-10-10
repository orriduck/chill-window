import struct,json,hashlib
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent
src=ROOT/'pine_tree_01_a_LOD2-native-uncompressed.glb'; dst=ROOT/'pine_tree_01_a_LOD2-native.glb'
b=src.read_bytes(); magic,ver,total=struct.unpack_from('<III',b,0); off=12; doc=None; blob=None
while off<len(b):
 n,t=struct.unpack_from('<II',b,off); chunk=b[off+8:off+8+n]
 if t==0x4e4f534a: doc=json.loads(chunk)
 elif t==0x4e4942: blob=chunk
 off+=8+n
assert doc and blob
image_by_view={im['bufferView']:im for im in doc.get('images',[]) if 'bufferView'in im}
original_view_bytes=[]; newbin=bytearray(); conversions=[]
for vi,v in enumerate(doc['bufferViews']):
 start=v.get('byteOffset',0); raw=blob[start:start+v['byteLength']]
 if vi in image_by_view:
  im=image_by_view[vi]; name=im.get('name','image')
  if im.get('mimeType')=='image/png':
   image=Image.open(__import__('io').BytesIO(raw))
   has_alpha=(image.mode in ('RGBA','LA') and image.getchannel('A').getextrema()!=(255,255))
   if not has_alpha:
    rgb=image.convert('RGB'); out=__import__('io').BytesIO(); rgb.save(out,'JPEG',quality=94,subsampling=0,optimize=True)
    raw=out.getvalue(); im['mimeType']='image/jpeg'
    conversions.append({'name':name,'before':v['byteLength'],'after':len(raw),'mimeType':im['mimeType']})
  else:
   conversions.append({'name':name,'before':v['byteLength'],'after':len(raw),'mimeType':im.get('mimeType')})
 else:
  original_view_bytes.append((vi,hashlib.sha256(raw).hexdigest(),len(raw)))
 while len(newbin)%4:newbin.append(0)
 v['byteOffset']=len(newbin);v['byteLength']=len(raw);newbin.extend(raw)
doc['buffers'][0]['byteLength']=len(newbin)
json_bytes=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(json_bytes)%4:json_bytes+=b' '
while len(newbin)%4:newbin.append(0)
total=12+8+len(json_bytes)+8+len(newbin)
out=bytearray(struct.pack('<III',0x46546C67,2,total));out.extend(struct.pack('<II',len(json_bytes),0x4E4F534A));out.extend(json_bytes);out.extend(struct.pack('<II',len(newbin),0x004E4942));out.extend(newbin)
dst.write_bytes(out)
# Verify every non-image view is byte-identical after its new offset.
rb=dst.read_bytes(); p=12+8+len(json_bytes)+8; chk=rb[p:]
for vi,sha,n in original_view_bytes:
 v=doc['bufferViews'][vi]; part=chk[v['byteOffset']:v['byteOffset']+v['byteLength']]
 assert len(part)==n and hashlib.sha256(part).hexdigest()==sha,(vi,'mesh/accessor view changed')
print('output',str(dst),'bytes',len(out),'sha256',hashlib.sha256(out).hexdigest())
print('non-image bufferViews verified',len(original_view_bytes))
print('image conversions',json.dumps(conversions,separators=(',',':')))
