import bpy, os, json
ROOT=os.path.dirname(os.path.abspath(__file__))
obj=bpy.data.objects['pine_tree_01_a_LOD2']
obj.location=(0.0,0.0,0.0)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
# Split by the author's material assignments. The alpha-card mesh remains untouched.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('pine_tree_01_a_LOD2')]
leaf_name='pine_tree_01_twig'
counts=[]
for part in parts:
 mats={m.name for m in part.data.materials if m}
 before=sum(len(poly.vertices)-2 for poly in part.data.polygons)
 # Only the three opaque wood meshes are simplified. Alpha foliage topology/card density is untouched.
 if leaf_name not in mats:
  mod=part.modifiers.new('Conservative branch reduction','DECIMATE');mod.decimate_type='COLLAPSE';mod.ratio=0.5
  bpy.context.view_layer.objects.active=part;part.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);part.select_set(False)
 part.data.calc_loop_triangles();after=len(part.data.loop_triangles)
 counts.append({'object':part.name,'materials':sorted(mats),'beforeTriangles':before,'afterTriangles':after,'ratio':after/before if before else 1})
# Rebuild a glTF-compatible foliage MASK using the dedicated source alpha and preserve PBR maps.
leaf=bpy.data.materials[leaf_name];leaf.use_nodes=True;nt=leaf.node_tree;nt.nodes.clear()
out=nt.nodes.new('ShaderNodeOutputMaterial');bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled')
color=nt.nodes.new('ShaderNodeTexImage');color.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_diff_alpha_1k.png',check_existing=False);color.image.colorspace_settings.name='sRGB'
nt.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
clip=nt.nodes.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=0.5;nt.links.new(color.outputs['Alpha'],clip.inputs[0]);nt.links.new(clip.outputs[0],bsdf.inputs['Alpha'])
rough=nt.nodes.new('ShaderNodeTexImage');rough.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_rough_1k.jpg',check_existing=True);rough.image.colorspace_settings.name='Non-Color';nt.links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
normal=nt.nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_nor_gl_1k.jpg',check_existing=True);normal.image.colorspace_settings.name='Non-Color'
normalmap=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(normal.outputs['Color'],normalmap.inputs['Color']);nt.links.new(normalmap.outputs['Normal'],bsdf.inputs['Normal']);nt.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
for part in parts: part.select_set(True)
bpy.ops.object.select_all(action='DESELECT')
for part in parts: part.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
tri=sum(len(poly.vertices)-2 for part in parts for poly in part.data.polygons)
outpath=f'{ROOT}/pine_tree_01_a_LOD2-branch50-uncompressed.glb'
bpy.ops.export_scene.gltf(filepath=outpath,export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_image_format='AUTO',export_animations=False)
print('BRANCH_VARIANT',json.dumps({'name':'pine A authored LOD2 with non-foliage meshes decimated 0.5','parts':counts,'totalTrianglesBefore':416451,'totalTrianglesAfter':tri,'leafTrianglesUnchanged':next(v['afterTriangles'] for v in counts if leaf_name in v['materials'])},separators=(',',':')))
