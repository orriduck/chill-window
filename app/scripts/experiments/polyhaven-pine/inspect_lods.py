import bpy,json
print('VERSION',bpy.app.version_string)
for c in bpy.data.collections:
 if any(t in c.name.lower() for t in ('lod0','lod1','lod2')):
  objs=[]
  for o in c.all_objects:
   if o.type=='MESH':
    o.data.calc_loop_triangles();objs.append({'name':o.name,'triangles':len(o.data.loop_triangles),'vertices':len(o.data.vertices),'dimensions':list(o.dimensions)})
  if objs: print('COLLECTION',json.dumps({'name':c.name,'objects':objs},separators=(',',':')))
print('ALL LOD OBJECTS')
for o in bpy.data.objects:
 if o.type=='MESH' and 'lod' in o.name.lower():
  o.data.calc_loop_triangles();print(json.dumps({'name':o.name,'triangles':len(o.data.loop_triangles),'dimensions':list(o.dimensions)},separators=(',',':')))
