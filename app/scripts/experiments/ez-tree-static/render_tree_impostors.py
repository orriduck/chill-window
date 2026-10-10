"""Render fixed EZ-Tree Ash/Oak LOD0 meshes into eight orthographic impostors.

Run with Blender 4.x in background mode. Geometry is decoded from the exact
raw source geometry JSON created by export-geometry.mjs; no tree generation,
random sampling, geographic placement, or GLB import is used here.
"""
import argparse
import base64
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

FRAME_SIZE = 512
ORTHO_SCALE_M = 22.0
TARGET_Z_M = 10.5
CAMERA_DISTANCE_M = 80.0
YAW_DEGREES = list(range(0, 360, 45))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rgba_hex(value):
    return [((value >> 16) & 255) / 255.0, ((value >> 8) & 255) / 255.0, (value & 255) / 255.0, 1.0]


def decoded_floats(encoded):
    raw = base64.b64decode(encoded)
    return struct.unpack("<" + "f" * (len(raw) // 4), raw)


def decoded_indices(encoded, index_type):
    raw = base64.b64decode(encoded)
    code = "H" if index_type == "Uint16Array" else "I"
    return struct.unpack("<" + code * (len(raw) // struct.calcsize(code)), raw)


def source_vertices(part, scale):
    values = decoded_floats(part["position"])
    vertices = []
    for i in range(0, len(values), 3):
        x, y, z = values[i:i + 3]
        # Rotate Three.js Y-up into Blender Z-up without reflection.
        vertices.append((x * scale, -z * scale, y * scale))
    return vertices


def source_normals(part):
    values = decoded_floats(part["normal"])
    return [(values[i], -values[i + 2], values[i + 1]) for i in range(0, len(values), 3)]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(datablocks):
            if item.users == 0:
                datablocks.remove(item)


def image_texture(path, colorspace):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    image.pack()
    return image


def make_material(name, base_path, tint, roughness=1.0, normal_path=None, roughness_path=None, leaf_alpha=False):
    material = bpy.data.materials.new(name)
    material.diffuse_color = tuple(tint)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = roughness
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    base_image = image_texture(base_path, "sRGB")
    base_node = nodes.new("ShaderNodeTexImage")
    base_node.image = base_image
    base_node.interpolation = "Linear"
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1.0
    multiply.inputs[2].default_value = tuple(tint)
    links.new(base_node.outputs["Color"], multiply.inputs[1])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])

    if leaf_alpha:
        links.new(base_node.outputs["Alpha"], shader.inputs["Alpha"])
        # Blender 4.0 Eevee's alpha clip matches the static glTF MASK intent.
        try:
            material.blend_method = "CLIP"
            material.alpha_threshold = 0.5
        except AttributeError:
            pass

    if normal_path:
        normal_image = image_texture(normal_path, "Non-Color")
        normal_node = nodes.new("ShaderNodeTexImage")
        normal_node.image = normal_image
        normal_node.interpolation = "Linear"
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    if roughness_path:
        roughness_image = image_texture(roughness_path, "Non-Color")
        roughness_node = nodes.new("ShaderNodeTexImage")
        roughness_node.image = roughness_image
        roughness_node.interpolation = "Linear"
        links.new(roughness_node.outputs["Color"], shader.inputs["Roughness"])
    return material


def make_mesh_object(name, part, scale, material):
    vertices = source_vertices(part, scale)
    normals = source_normals(part)
    uv_values = decoded_floats(part["uv"])
    uvs = list(zip(uv_values[::2], uv_values[1::2]))
    indices = decoded_indices(part["indices"], part["indexType"])
    faces = [tuple(indices[i:i + 3]) for i in range(0, len(indices), 3)]

    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    loop_normals = []
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]
            loop_normals.append(normals[vertex_index])
    try:
        mesh.normals_split_custom_set(loop_normals)
    except (AttributeError, RuntimeError):
        # The exact source vertex/UV topology remains intact; Blender recalculates normals if custom split normals are unsupported.
        pass
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj, vertices


def setup_camera_and_lighting(scene):
    camera_data = bpy.data.cameras.new("Fixed 22m orthographic impostor camera")
    camera = bpy.data.objects.new("ImpostorCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ORTHO_SCALE_M
    camera.data.lens = 50.0
    scene.camera = camera

    def area(name, location, energy, size, color):
        data = bpy.data.lights.new(name, type="AREA")
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj.rotation_euler = (Vector((0.0, 0.0, 10.0)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        return obj

    area("KeyArea", (22.0, -28.0, 33.0), 4200.0, 18.0, (1.0, 0.92, 0.82))
    area("FillArea", (-25.0, -12.0, 19.0), 2400.0, 22.0, (0.78, 0.86, 1.0))
    area("RimArea", (4.0, 25.0, 27.0), 3100.0, 16.0, (1.0, 1.0, 1.0))
    return camera


def project_pixel(scene, camera, point):
    ndc = world_to_camera_view(scene, camera, Vector(point))
    return [ndc.x * FRAME_SIZE, (1.0 - ndc.y) * FRAME_SIZE]


def projected_bounds(scene, camera, objects):
    points = []
    for obj in objects:
        for vertex in obj.data.vertices:
            p = obj.matrix_world @ vertex.co
            ndc = world_to_camera_view(scene, camera, p)
            points.append((ndc.x * FRAME_SIZE, (1.0 - ndc.y) * FRAME_SIZE))
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def bounds3(vertices):
    return [[min(v[i] for v in vertices), max(v[i] for v in vertices)] for i in range(3)]


def render_species(species, preset, raw_path, preset_path, texture_root, source_manifest, output_root, scene, camera):
    raw_bytes = raw_path.read_bytes()
    record = json.loads(raw_bytes)
    preset_record = json.loads(preset_path.read_text(encoding="utf-8"))
    preset_name = preset_path.name
    expected_preset_hash = source_manifest["generation"]["presetFiles"][preset_name]
    if sha256(preset_path) != expected_preset_hash:
        raise RuntimeError(f"source preset hash differs from EZ-Tree manifest: {preset_path}")
    scale = 20.0 / record["sourceHeight"]
    short = species.lower()
    leaf_path = texture_root / "leaves" / f"{short}.png"
    bark_root = texture_root / "bark" / "Bark001_1K-JPG"
    bark_path = bark_root / "Bark001_1K-JPG_Color.jpg"
    normal_path = bark_root / "Bark001_1K-JPG_NormalGL.jpg"
    rough_path = bark_root / "Bark001_1K-JPG_Roughness.jpg"

    branch_material = make_material(
        f"{species} branch | AmbientCG Bark001 CC0",
        bark_path,
        rgba_hex(preset_record["bark"]["tint"]),
        roughness=0.82,
        normal_path=normal_path,
        roughness_path=rough_path,
    )
    leaf_material = make_material(
        f"{species} leaf | EZ-Tree MIT alpha",
        leaf_path,
        rgba_hex(preset_record["leaves"]["tint"]),
        roughness=0.88,
        leaf_alpha=True,
    )
    branch_obj, branch_vertices = make_mesh_object(species + "Branches", record["branch"], scale, branch_material)
    leaves_obj, leaf_vertices = make_mesh_object(species + "Leaves", record["leaves"], scale, leaf_material)
    objects = [branch_obj, leaves_obj]
    model_vertices = branch_vertices + leaf_vertices
    bounds = bounds3(model_vertices)
    if bounds[2][0] < -0.01 or bounds[2][1] > 20.01:
        raise RuntimeError(f"scaled {species} bounds do not fit expected 20m author-preset scale: {bounds}")

    frames = []
    species_dir = output_root / "frames" / short.lower()
    species_dir.mkdir(parents=True, exist_ok=True)
    for yaw in YAW_DEGREES:
        radians = math.radians(yaw)
        camera.location = (
            CAMERA_DISTANCE_M * math.cos(radians),
            CAMERA_DISTANCE_M * math.sin(radians),
            TARGET_Z_M,
        )
        target = Vector((0.0, 0.0, TARGET_Z_M))
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()

        frame_name = f"{short.lower()}-azimuth-{yaw:03d}.png"
        frame_path = species_dir / frame_name
        scene.render.filepath = str(frame_path)
        bpy.ops.render.render(write_still=True)
        root_pixel = project_pixel(scene, camera, (0.0, 0.0, 0.0))
        bbox_pixels = projected_bounds(scene, camera, objects)
        frames.append({
            "yawDegrees": yaw,
            "file": str(frame_path.relative_to(output_root)),
            "bytes": frame_path.stat().st_size,
            "sha256": sha256(frame_path),
            "sizePx": [FRAME_SIZE, FRAME_SIZE],
            "camera": {"projection": "orthographic", "orthoScaleWorldMetres": ORTHO_SCALE_M, "distanceWorldMetres": CAMERA_DISTANCE_M, "targetWorldMetres": [0.0, 0.0, TARGET_Z_M]},
            "rootWorldMetres": [0.0, 0.0, 0.0],
            "rootPixelFromTopLeft": root_pixel,
            "rootUvFromTopLeft": [root_pixel[0] / FRAME_SIZE, root_pixel[1] / FRAME_SIZE],
            "projectedModelBoundsPixelExclusiveMax": bbox_pixels,
            "projectedModelBoundsUvFromTopLeft": [bbox_pixels[0] / FRAME_SIZE, bbox_pixels[1] / FRAME_SIZE, bbox_pixels[2] / FRAME_SIZE, bbox_pixels[3] / FRAME_SIZE],
        })

    # Actual packed source texture hashes are checked against the original EZ-Tree manifest.
    source_tex = source_manifest["textures"]["leaf"][short]
    if sha256(leaf_path) != source_tex["sha256"]:
        raise RuntimeError(f"source {species} leaf texture hash differs from EZ-Tree manifest")
    source_tex_paths = {
        "leaf": leaf_path,
        "barkColor": bark_path,
        "barkNormalGL": normal_path,
        "barkRoughness": rough_path,
    }
    expected_bark_hashes = {item["name"]: item["sha256"] for item in source_manifest["textures"]["bark"]["files"]}
    for label, path in source_tex_paths.items():
        expected_hash = source_tex["sha256"] if label == "leaf" else expected_bark_hashes[path.name]
        if sha256(path) != expected_hash:
            raise RuntimeError(f"source texture hash mismatch for {label}: {path}")
    tree_record = {
        "preset": preset,
        "seed": preset_record["seed"],
        "sourcePresetSha256": sha256(preset_path),
        "sourceRawGeometry": {"file": str(raw_path.relative_to(raw_path.parents[1])), "bytes": len(raw_bytes), "sha256": sha256(raw_path), "lod": record["lod"], "triangles": {"branches": record["branch"]["triangleCount"], "leaves": record["leaves"]["triangleCount"], "total": record["branch"]["triangleCount"] + record["leaves"]["triangleCount"]}},
        "sourceLicense": "EZ-Tree MIT; author preset geometry is an appearance proxy, not a local tree survey.",
        "sourceCommit": source_manifest["source"]["commit"],
        "sourceTextures": {
            "ezTreeLeafLicense": "MIT (bundled with EZ-Tree)",
            "barkLicense": "AmbientCG Bark001 CC0 1.0",
            "files": [{"file": str(path.relative_to(texture_root)), "bytes": path.stat().st_size, "sha256": sha256(path)} for path in source_tex_paths.values()],
            "leafAlphaMode": "MASK, source PNG alpha retained in material; cutoff 0.5",
        },
        "modelScale": {"policy": "uniform scale to 20m source-geometry vertical extent", "sourceUnitsDefinedByPreset": False, "scale": scale, "rootWorldMetres": [0.0, 0.0, 0.0], "actualModelBoundsWorldMetresXYZ": bounds},
        "frames": frames,
    }
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return tree_record


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True, help="EZ-Tree static eval root with raw/ and .work/upstream/ files")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    root = args.source_root.resolve()
    output_root = args.out.resolve()
    upstream = root / ".work" / "upstream"
    lib = upstream / "src" / "lib"
    texture_root = upstream / "src" / "app" / "public" / "textures"
    source_manifest = json.loads((root / "cloud-manifest.json").read_text(encoding="utf-8"))
    output_root.mkdir(parents=True, exist_ok=True)

    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    scene.render.resolution_x = FRAME_SIZE
    scene.render.resolution_y = FRAME_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.color = (0.12, 0.12, 0.12)
    scene.render.resolution_percentage = 100
    scene.camera = None
    camera = setup_camera_and_lighting(scene)

    tree_records = []
    for species, preset in (("Ash", "Ash Large"), ("Oak", "Oak Large")):
        raw_path = root / "raw" / f"{species.lower()}-large-lod0.json"
        preset_path = lib / "presets" / f"{species.lower()}_large.json"
        tree_records.append(render_species(species, preset, raw_path, preset_path, texture_root, source_manifest, output_root, scene, camera))

    manifest = {
        "schemaVersion": 1,
        "purpose": "Eight-view static tree impostor appearance assets; no in-app placement and no claim of surveyed Hudson species.",
        "source": source_manifest["source"],
        "render": {
            "blenderVersion": bpy.app.version_string,
            "engine": scene.render.engine,
            "samples": scene.eevee.taa_render_samples,
            "background": "transparent RGBA",
            "resolutionPx": [FRAME_SIZE, FRAME_SIZE],
            "horizontalYawDegrees": YAW_DEGREES,
            "camera": {"projection": "orthographic", "orthoScaleWorldMetres": ORTHO_SCALE_M, "distanceWorldMetres": CAMERA_DISTANCE_M, "targetWorldMetres": [0.0, 0.0, TARGET_Z_M]},
            "sharedCameraBounds": {"worldWidthMetres": ORTHO_SCALE_M, "worldHeightMetres": ORTHO_SCALE_M, "worldBottomMetres": TARGET_Z_M - ORTHO_SCALE_M / 2.0, "worldTopMetres": TARGET_Z_M + ORTHO_SCALE_M / 2.0},
            "lighting": "fixed three-area-light studio rig, identical for all species and yaw views",
            "colorManagement": {"viewTransform": scene.view_settings.view_transform, "exposure": scene.view_settings.exposure, "gamma": scene.view_settings.gamma},
        },
        "trees": tree_records,
        "heightAndSpeciesCaveat": "EZ-Tree author presets do not specify physical units or represent a Hudson field survey. Uniform 20m vertical scaling is a presentation choice; any dimensions and bounds here describe these rendered source meshes only.",
    }
    manifest_path = output_root / "tree-impostors.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Wrote", manifest_path, "SHA256", sha256(manifest_path))


main()
