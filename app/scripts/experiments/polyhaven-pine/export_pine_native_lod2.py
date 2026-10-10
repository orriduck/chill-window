import bpy, os
ROOT=os.path.dirname(os.path.abspath(__file__))
obj=bpy.data.objects['pine_tree_01_a_LOD2']
obj.location=(0.0,0.0,0.0)
# Build a glTF-compatible cutout leaf material with source RGB and dedicated alpha.
leaf=bpy.data.materials['pine_tree_01_twig']; leaf.use_nodes=True
nt=leaf.node_tree; nt.nodes.clear()
out=nt.nodes.new('ShaderNodeOutputMaterial');out.location=(600,0)
bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled');bsdf.location=(280,0)
color=nt.nodes.new('ShaderNodeTexImage');color.location=(-650,120)
color.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_diff_alpha_1k.png',check_existing=False)
color.image.colorspace_settings.name='sRGB'
nt.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
clip=nt.nodes.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=0.5;clip.location=(-350,-80)
nt.links.new(color.outputs['Alpha'],clip.inputs[0]);nt.links.new(clip.outputs[0],bsdf.inputs['Alpha'])
rough=nt.nodes.new('ShaderNodeTexImage');rough.location=(-650,-220)
rough.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_rough_1k.jpg',check_existing=True);rough.image.colorspace_settings.name='Non-Color'
nt.links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
normal=nt.nodes.new('ShaderNodeTexImage');normal.location=(-650,-470)
normal.image=bpy.data.images.load(f'{ROOT}/textures/pine_tree_01_twig_nor_gl_1k.jpg',check_existing=True);normal.image.colorspace_settings.name='Non-Color'
normalmap=nt.nodes.new('ShaderNodeNormalMap');normalmap.location=(-150,-400)
nt.links.new(normal.outputs['Color'],normalmap.inputs['Color']);nt.links.new(normalmap.outputs['Normal'],bsdf.inputs['Normal'])
nt.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
# Keep the author's native LOD2 geometry intact.
# Export only tree A; its source stage offset is removed, source dimensions preserved.
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
tri=sum(len(p.vertices)-2 for p in obj.data.polygons)
outpath=f'{ROOT}/pine_tree_01_a_LOD2-native-uncompressed.glb'
bpy.ops.export_scene.gltf(filepath=outpath,export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_image_format='AUTO',export_animations=False)
print('EXPORTED',outpath,'triangles',tri,'boundsMetersBlenderXYZ',list(obj.dimensions),'nativeLOD','pine_tree_01_a_LOD2','geometryUnmodified',True)
