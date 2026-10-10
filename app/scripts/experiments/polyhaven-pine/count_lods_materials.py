import bpy,json
for name in ('pine_tree_01_a_LOD0','pine_tree_01_a_LOD1','pine_tree_01_a_LOD2'):
 o=bpy.data.objects[name]; counts={}
 for poly in o.data.polygons:
  mat=o.data.materials[poly.material_index].name if poly.material_index<len(o.data.materials) and o.data.materials[poly.material_index] else 'NONE'
  counts[mat]=counts.get(mat,0)+len(poly.vertices)-2
 print('MODEL',json.dumps({'object':name,'triangles':sum(counts.values()),'byMaterial':counts},separators=(',',':')))
print('LOD3_or_LOD4',[(o.name,o.type) for o in bpy.data.objects if any(t in o.name.upper() for t in ('LOD3','LOD4'))])
print('collections',[(c.name,len(c.objects)) for c in bpy.data.collections if 'LOD3' in c.name.upper() or 'LOD4' in c.name.upper()])
