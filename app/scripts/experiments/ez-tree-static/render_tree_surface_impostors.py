"""Cloud-only Blender 4.0.2 bake of fixed source albedo and tree-local normals.

This is a separate recipe: the studio render and its manifest remain untouched.
"""
import argparse
import base64
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

COMMIT = "dcf309bd86bd521083d9c70f01f2de45fdc7c457"
SIZE = 512
YAWS = list(range(0, 360, 45))
SEEDS = {"ash": 29919, "oak": 23399}
UV_POLICY = {
    "source": "unchanged raw TEXCOORD_0 bytes, written unchanged by make-glb.py",
    "blenderAssignment": "U_blender = U_source; V_blender = 1 - V_source",
    "normalTextureChannels": "unchanged RGB; no green inversion; follow Blender 4.0.2 glTF importer data-texture -> tangent NormalMap path",
    "verifiedAt": "2026-10-10",
    "references": [
        {"url": "https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc#textures",
         "finding": "texture (0,0) is the image upper-left corner"},
        {"url": "https://github.com/blender/blender-addons/blob/v4.0.2/io_scene_gltf2/blender/imp/gltf2_blender_mesh.py#L525-L528",
         "finding": "uvs_gltf_to_blender maps u,v to u,1-v"},
        {"url": "https://github.com/blender/blender-addons/blob/v4.0.2/io_scene_gltf2/blender/imp/gltf2_blender_pbrMetallicRoughness.py#L467-L500",
         "finding": "normal() connects original texture color directly to tangent NormalMap Color, selects UVMap and source strength"},
        {"url": "https://github.com/blender/blender-addons/blob/v4.0.2/io_scene_gltf2/blender/imp/gltf2_blender_texture.py#L62-L70",
         "finding": "normal textures are data images and Color is directly linked; no green-channel conversion"},
        {"url": "https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/material/gpu_shader_material_normal_map.glsl#L4-L24",
         "finding": "NormalMap decodes 2*RGB-1 and evaluates T*x+B*y+N*z; front/back tangent sign and bitangent handedness are explicit"},
    ],
}
CAMERA = {"projection": "orthographic", "orthoScaleWorldMetres": 22.0,
          "distanceWorldMetres": 80.0, "targetWorldMetres": [0.0, 0.0, 10.5]}
DEPTH_CLIPPING = {
    "policy": "all actual branch and leaf vertices in actual camera space, per tree and yaw",
    "formula": "depth=-(inverse(camera.matrix_world) @ (object.matrix_world @ vertex.co)).z",
    "marginMetres": 5.0,
    "sourceDepthVerificationToleranceMetres": 1e-4,
    "calibrationRequestedClipRange": [0.1, 1000.0],
}
CHANNELS = {
    "albedo": {"colorSpace": "sRGB", "viewTransform": "Standard",
               "formula": "sRGB_decode(source texture RGB) * exact GLB linear baseColorFactor; emission strength 1; sRGB encode",
               "illumination": "none; no RGB gain, exposure adjustment, studio lighting or tone mapping"},
    "normal": {"colorSpace": "linear data (Non-Color)", "viewTransform": "Raw",
               "formula": "face-forward normalized world shading normal; Three local XYZ = Blender world X,Z,-Y; encode (N+1)/2",
               "meaning": "48-sample averaged visible shading-normal vectors; AA and overlapping surfaces can shorten the decoded vector",
               "branchNormal": "Bark001 NormalGL, Non-Color, tangent-space ShaderNodeNormalMap using UVMap; node output is world-space, verified by calibration",
               "leafNormal": "source custom split shading normals via ShaderNodeNewGeometry.Normal; world-space, verified by calibration",
               "backfaces": "explicit face-forward: negate normal when dot(normal, Geometry.Incoming) < 0; Incoming is world-space toward-camera, constant inverse-forward for orthographic views; branch backfaces culled, leaves double-sided",
               "facingReferences": [
                   {"url": "https://github.com/blender/blender/blob/v4.0.2/source/blender/gpu/shaders/material/gpu_shader_material_geometry.glsl#L15-L19",
                    "finding": "Geometry Incoming is coordinate_incoming(g_data.P); Position and Normal are world-space surface data"},
                   {"url": "https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/engines/eevee/shaders/surface_lib.glsl#L231-L238",
                    "finding": "coordinate_incoming returns cameraVec(P) for mesh surfaces"},
                   {"url": "https://github.com/blender/blender/blob/v4.0.2/source/blender/draw/intern/shaders/common_view_lib.glsl#L14-L19",
                    "finding": "cameraVec is normalized(cameraPos-P) for perspective and ViewMatrixInverse[2].xyz for orthographic, pointing toward camera"},
               ],
               "runtime": "sample as linear data, decode 2*RGB-1 and normalize the alpha-weighted direction; zero/short vectors require inspection"},
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_record(path, root):
    return {"file": str(path.relative_to(root)), "bytes": path.stat().st_size, "sha256": sha(path)}


def floats(encoded):
    data = base64.b64decode(encoded)
    return struct.unpack("<" + "f" * (len(data) // 4), data)


def factor(value):
    # Exactly make-glb.py color(): normalized source HEX is a LINEAR factor.
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1.0]


def texture(nodes, path, colorspace):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Linear"
    node.extension = "REPEAT"
    return node


def material(name, channel, camera, base=None, tint=None, normal=None, leaf=False, probe=False):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = not leaf and not probe
    nodes, links = result.node_tree.nodes, result.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    base_node = texture(nodes, base, "sRGB") if base else None
    if channel == "albedo":
        multiply = nodes.new("ShaderNodeMixRGB")
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1.0
        multiply.inputs[2].default_value = tint
        links.new(base_node.outputs["Color"], multiply.inputs[1])
        links.new(multiply.outputs["Color"], emission.inputs["Color"])
    else:
        geometry = nodes.new("ShaderNodeNewGeometry")
        shading_normal = geometry.outputs["Normal"]
        if normal or probe in ("normal-map", "normal-map-tilted"):
            normal_map = nodes.new("ShaderNodeNormalMap")
            normal_map.space = "TANGENT"
            normal_map.uv_map = "UVMap"
            normal_map.inputs["Strength"].default_value = 1.0
            if normal:
                normal_tex = texture(nodes, normal, "Non-Color")
                links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
            else:
                normal_map.inputs["Color"].default_value = (
                    (0.65, 0.7, (math.sqrt(0.75) + 1) / 2, 1.0)
                    if probe == "normal-map-tilted" else (0.5, 0.5, 1.0, 1.0))
            shading_normal = normal_map.outputs["Normal"]
        # Blender's actual projection-aware world view direction is constant
        # across an orthographic image. A cameraPosition-P vector is incorrect
        # off-axis and can reverse grazing shading normals.
        dot = nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        links.new(shading_normal, dot.inputs[0])
        links.new(geometry.outputs["Incoming"], dot.inputs[1])
        negative = nodes.new("ShaderNodeMath")
        negative.operation = "LESS_THAN"
        negative.inputs[1].default_value = 0.0
        links.new(dot.outputs["Value"], negative.inputs[0])
        sign = nodes.new("ShaderNodeMath")
        sign.operation = "MULTIPLY_ADD"
        sign.inputs[1].default_value = -2.0
        sign.inputs[2].default_value = 1.0
        links.new(negative.outputs[0], sign.inputs[0])
        flip = nodes.new("ShaderNodeVectorMath")
        flip.operation = "SCALE"
        links.new(shading_normal, flip.inputs[0])
        links.new(sign.outputs[0], flip.inputs["Scale"])
        normalize = nodes.new("ShaderNodeVectorMath")
        normalize.operation = "NORMALIZE"
        links.new(flip.outputs[0], normalize.inputs[0])
        separate = nodes.new("ShaderNodeSeparateXYZ")
        links.new(normalize.outputs[0], separate.inputs[0])
        combine = nodes.new("ShaderNodeCombineXYZ")
        links.new(separate.outputs["X"], combine.inputs["X"])
        links.new(separate.outputs["Z"], combine.inputs["Y"])
        minus_y = nodes.new("ShaderNodeMath")
        minus_y.operation = "MULTIPLY"
        minus_y.inputs[1].default_value = -1.0
        links.new(separate.outputs["Y"], minus_y.inputs[0])
        links.new(minus_y.outputs[0], combine.inputs["Z"])
        encode = nodes.new("ShaderNodeVectorMath")
        encode.operation = "MULTIPLY_ADD"
        encode.inputs[1].default_value = (0.5, 0.5, 0.5)
        encode.inputs[2].default_value = (0.5, 0.5, 0.5)
        links.new(combine.outputs[0], encode.inputs[0])
        links.new(encode.outputs[0], emission.inputs["Color"])
    surface = emission.outputs[0]
    if leaf:
        # glTF MASK discards alpha < 0.5, including exactly 0.5 as opaque.
        discard = nodes.new("ShaderNodeMath")
        discard.operation = "LESS_THAN"
        discard.inputs[1].default_value = 0.5
        links.new(base_node.outputs["Alpha"], discard.inputs[0])
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        links.new(discard.outputs[0], mix.inputs[0])
        links.new(surface, mix.inputs[1])
        links.new(transparent.outputs[0], mix.inputs[2])
        surface = mix.outputs[0]
        result.blend_method = "CLIP"
        result.alpha_threshold = 0.5
        result.use_screen_refraction = False
    links.new(surface, output.inputs["Surface"])
    return result


def mesh_object(name, part, scale):
    p, n, uv = floats(part["position"]), floats(part["normal"]), floats(part["uv"])
    vertices = [(p[i] * scale, -p[i + 2] * scale, p[i + 1] * scale) for i in range(0, len(p), 3)]
    normals = [(n[i], -n[i + 2], n[i + 1]) for i in range(0, len(n), 3)]
    data = base64.b64decode(part["indices"])
    code = "H" if part["indexType"] == "Uint16Array" else "I"
    indices = struct.unpack("<" + code * (len(data) // struct.calcsize(code)), data)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [indices[i:i + 3] for i in range(0, len(indices), 3)])
    mesh.update(calc_edges=True)
    mesh.use_auto_smooth = True
    layer = mesh.uv_layers.new(name="UVMap")
    custom = []
    for poly in mesh.polygons:
        poly.use_smooth = True
        for index in poly.loop_indices:
            vertex = mesh.loops[index].vertex_index
            # Match the official glTF importer without touching source UV bytes.
            layer.data[index].uv = (uv[vertex * 2], 1.0 - uv[vertex * 2 + 1])
            custom.append(normals[vertex])
    expected_uv = b"".join(struct.pack("<2f", uv[index * 2], 1.0 - uv[index * 2 + 1]) for index in indices)

    def verified_uv_readback(stage):
        # Adding custom normals can move/reallocate CustomDataLayer entries.
        # Never dereference the earlier `layer` RNA object after that mutation.
        fresh_uv = mesh.uv_layers["UVMap"]
        actual_indices = tuple(loop.vertex_index for loop in mesh.loops)
        if actual_indices != indices:
            raise RuntimeError(f"{name} {stage}: actual Blender corner topology differs from exact source indices")
        actual = b"".join(struct.pack("<2f", *item.uv) for item in fresh_uv.data)
        if actual != expected_uv:
            diagnostics = {"mesh": name, "stage": stage, "expectedBytes": len(expected_uv), "actualBytes": len(actual),
                           "expectedSha256": hashlib.sha256(expected_uv).hexdigest(),
                           "actualSha256": hashlib.sha256(actual).hexdigest(), "firstMismatchLoops": []}
            for index in range(min(len(actual), len(expected_uv)) // 8):
                observed, expected = actual[index * 8:index * 8 + 8], expected_uv[index * 8:index * 8 + 8]
                if observed != expected:
                    diagnostics["firstMismatchLoops"].append({"loop": index, "sourceVertex": indices[index],
                                                             "actual": struct.unpack("<2f", observed),
                                                             "expected": struct.unpack("<2f", expected),
                                                             "actualHex": observed.hex(), "expectedHex": expected.hex()})
                    if len(diagnostics["firstMismatchLoops"]) == 8:
                        break
            print("UV_READBACK_FAILURE", json.dumps(diagnostics))
            raise RuntimeError(f"{name} {stage}: freshly acquired UVMap differs from exact source-derived float32 UV bytes")
        return hashlib.sha256(actual).hexdigest()

    before_normals_sha = verified_uv_readback("before custom normals")
    # No silent normal recalculation fallback: source split normals are required.
    mesh.normals_split_custom_set(custom)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    after_normals_sha = verified_uv_readback("after custom normals and object linking")
    uv_binding = {
        "sourceUvSha256": hashlib.sha256(base64.b64decode(part["uv"])).hexdigest(),
        "blenderLoopUvSha256": after_normals_sha,
        "blenderLoopUvBeforeNormalsSha256": before_normals_sha,
        "readbackPolicy": "reacquire UVMap RNA layer after custom-normal mutation; exact source-indexed little-endian float32 byte equality before and after",
        "assignment": UV_POLICY["blenderAssignment"], "loopCount": len(mesh.loops),
    }
    return obj, vertices, uv_binding


def point_px(scene, camera, point):
    ndc = world_to_camera_view(scene, camera, Vector(point))
    return [ndc.x * SIZE, (1.0 - ndc.y) * SIZE]


def camera_at(camera, direction, target):
    camera.location = Vector(target) + Vector(direction) * 80.0
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


def tight_depth_clipping(camera, objects, species, yaw):
    """Assign one conservative interval from every actual mesh vertex."""
    pose = camera.matrix_world.copy()
    projection = (camera.data.type, camera.data.ortho_scale)
    inverse_camera = camera.matrix_world.inverted()
    depths = [-(inverse_camera @ (obj.matrix_world @ vertex.co)).z
              for obj in objects for vertex in obj.data.vertices]
    if not depths or not all(math.isfinite(depth) for depth in depths):
        raise RuntimeError(f"{species}/{yaw}: empty or nonfinite actual camera depths")
    extrema = [min(depths), max(depths)]
    margin = DEPTH_CLIPPING["marginMetres"]
    requested = [extrema[0] - margin, extrema[1] + margin]
    if not all(math.isfinite(value) for value in requested) or requested[0] <= 0:
        raise RuntimeError(f"{species}/{yaw}: tight camera interval must be finite and positive")
    camera.data.clip_start, camera.data.clip_end = requested
    assigned = [camera.data.clip_start, camera.data.clip_end]
    if not all(math.isfinite(value) for value in assigned) or assigned[0] <= 0:
        raise RuntimeError(f"{species}/{yaw}: assigned camera interval must be finite and positive")
    contained = all(assigned[0] < depth < assigned[1] for depth in depths)
    if not contained:
        raise RuntimeError(f"{species}/{yaw}: assigned camera interval does not strictly enclose every actual vertex")
    pose_unchanged = camera.matrix_world == pose and projection == (camera.data.type, camera.data.ortho_scale)
    if not pose_unchanged:
        raise RuntimeError(f"{species}/{yaw}: clipping changed camera pose or orthographic scale")
    return {"species": species, "yawDegrees": yaw, "actualVertexCount": len(depths),
            "actualCameraDepthRange": extrema, "requestedClipRange": requested,
            "assignedClipRange": assigned, "marginMetres": margin,
            "containsAllActualVertices": contained, "cameraPoseUnchanged": pose_unchanged,
            "channelAssignedClipRanges": {}}


def require_depth_interval(camera, record, channel):
    """Check actual readback immediately before each paired-channel render."""
    assigned = [camera.data.clip_start, camera.data.clip_end]
    if assigned != record["assignedClipRange"]:
        raise RuntimeError(f"{record['species']}/{record['yawDegrees']}/{channel}: paired clip interval changed")
    record["channelAssignedClipRanges"][channel] = assigned


def render(scene, channel, path):
    scene.view_settings.view_transform = CHANNELS[channel]["viewTransform"]
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def calibrate(scene, camera, output):
    """Actual opaque front/back probes identify node space and backface behavior."""
    records = []
    folder = output / "calibration"
    folder.mkdir(parents=True, exist_ok=True)
    # Three local +X, +Y, +Z become Blender +X, +Z, -Y.
    for axis, world in (("x", (1, 0, 0)), ("y", (0, 0, 1)), ("z", (0, -1, 0))):
        normal = Vector(world)
        # A canonical object-local +Z plane, rotated by an object transform.
        # Identity objects would not distinguish object-space from world-space
        # NormalMap outputs; X/Z probes deliberately require that transform.
        vertices = [(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)]
        mesh = bpy.data.meshes.new("CalibrationPlane")
        mesh.from_pydata(vertices, [], [(0, 1, 2), (0, 2, 3)])
        mesh.update()
        layer = mesh.uv_layers.new(name="UVMap")
        raw_uv = ((0, 0), (1, 0), (1, 1), (0, 1))
        for loop in mesh.loops:
            u, v = raw_uv[loop.vertex_index]
            layer.data[loop.index].uv = (u, 1 - v)
        obj = bpy.data.objects.new("CalibrationPlane", mesh)
        bpy.context.collection.objects.link(obj)
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(normal)
        for mode in ("geometry", "normal-map", "normal-map-tilted"):
            mat = material("Calibration " + mode, "normal", camera, probe=mode)
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            for side in (1, -1):
                camera_at(camera, normal * side, (0, 0, 0))
                path = folder / f"{axis}-{mode}-{'front' if side == 1 else 'back'}.png"
                render(scene, "normal", path)
                image = bpy.data.images.load(str(path), check_existing=False)
                image.colorspace_settings.name = "Non-Color"
                offset = ((SIZE // 2) * SIZE + SIZE // 2) * 4
                rgba = list(image.pixels[offset:offset + 4])
                bpy.data.images.remove(image)
                tangent_input = [0.3, 0.4, math.sqrt(0.75)] if mode == "normal-map-tilted" else [0, 0, 1]
                # Mirrored V gives object-local T=+X, B=-Y, N=+Z.
                object_front = Vector((tangent_input[0], -tangent_input[1], tangent_input[2]))
                world_front = obj.rotation_quaternion @ object_front
                expected = [side * world_front.x, side * world_front.z, -side * world_front.y]
                actual = [2 * value - 1 for value in rgba[:3]]
                error = max(abs(a - b) for a, b in zip(actual, expected))
                length = math.sqrt(sum(value * value for value in actual))
                records.append({**file_record(path, output), "mode": mode, "threeLocalAxis": axis,
                                "objectLocalSourceNormal": [0, 0, 1], "expectedWorldFrontNormal": list(normal),
                                "objectRotationQuaternionWxyz": list(obj.rotation_quaternion),
                                "tangentNormalInput": tangent_input,
                                "expectedObjectFrontShadingNormal": list(object_front),
                                "sourceQuadUv": raw_uv, "blenderUvAssignment": UV_POLICY["blenderAssignment"],
                                "side": side, "centerRgbaLinear": rgba, "decodedCenterNormal": actual,
                                "expectedCenterNormal": expected, "maxComponentError": error,
                                "decodedLength": length, "passed": rgba[3] == 1.0 and error <= 0.01 and abs(length - 1) <= 0.01})
        bpy.data.objects.remove(obj, do_unlink=True)
    grazing_records = []
    # This deliberately fails the old perspective-position face-forward path:
    # true orthographic toward-camera = +X, while cameraPosition-P=(80,-5,0).
    grazing_normal = Vector((0.02, 0.9998, 0)).normalized()
    world_point = Vector((0, 5, 10.5))
    mesh = bpy.data.meshes.new("OffCenterGrazingPlane")
    mesh.from_pydata([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2), (0, 2, 3)])
    mesh.update()
    layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        u, v = ((0, 0), (1, 0), (1, 1), (0, 1))[loop.vertex_index]
        layer.data[loop.index].uv = (u, 1 - v)
    obj = bpy.data.objects.new("OffCenterGrazingPlane", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = world_point
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(grazing_normal)
    camera_at(camera, (1, 0, 0), (0, 0, 10.5))
    projected = point_px(scene, camera, world_point)
    pixel = [round(value) for value in projected]
    expected = [grazing_normal.x, grazing_normal.z, -grazing_normal.y]
    orthographic_dot = grazing_normal.dot(Vector((1, 0, 0)))
    perspective_dot = grazing_normal.dot(camera.location - world_point)
    if not (orthographic_dot > 0 and perspective_dot < 0):
        raise RuntimeError("Off-center calibration no longer exposes the perspective-vector bug")
    for mode in ("geometry", "normal-map"):
        mat = material("Off-center grazing " + mode, "normal", camera, probe=mode)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        path = folder / f"off-center-grazing-{mode}.png"
        render(scene, "normal", path)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        offset = ((SIZE - 1 - pixel[1]) * SIZE + pixel[0]) * 4
        rgba = list(image.pixels[offset:offset + 4])
        bpy.data.images.remove(image)
        actual = [2 * value - 1 for value in rgba[:3]]
        error = max(abs(a - b) for a, b in zip(actual, expected))
        length = math.sqrt(sum(value * value for value in actual))
        grazing_records.append({**file_record(path, output), "mode": mode,
                                "worldPoint": list(world_point), "worldShadingNormal": list(grazing_normal),
                                "cameraPosition": list(camera.location), "orthographicTowardCamera": [1, 0, 0],
                                "orthographicDot": orthographic_dot, "incorrectPerspectiveDot": perspective_dot,
                                "projectedCenterPixelFromTopLeft": projected, "samplePixelFromTopLeft": pixel,
                                "sampleRgbaLinear": rgba, "decodedSampleNormal": actual,
                                "expectedSampleNormal": expected, "maxComponentError": error, "decodedLength": length,
                                "passed": rgba[3] == 1.0 and error <= 0.01 and abs(length - 1) <= 0.01})
    bpy.data.objects.remove(obj, do_unlink=True)
    report = {"meaning": "synthetic transformed axis and off-center grazing planes; verifies node coordinates and projection-aware face-forward policy, not surveyed tree normals",
              "tolerance": 0.01, "probes": records, "orthographicFacingProbes": grazing_records,
              "passed": all(item["passed"] for item in records + grazing_records)}
    (output / "normal-calibration.json").write_text(json.dumps(report, indent=2) + "\n")
    if not report["passed"]:
        raise RuntimeError("Normal coordinate/backface calibration failed; inspect normal-calibration.json before baking")
    return report


def glb_document(path):
    data = path.read_bytes()
    size, kind = struct.unpack_from("<I4s", data, 12)
    if data[:4] != b"glTF" or kind != b"JSON":
        raise RuntimeError(f"Invalid source GLB: {path}")
    return json.loads(data[20:20 + size])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    root, output = args.source_root.resolve(), args.out.resolve()
    if output == root or root in output.parents and output.name == "impostors":
        raise RuntimeError("Use a separate surface-impostors output directory; preserve studio outputs")
    if bpy.app.version_string != "4.0.2":
        raise RuntimeError("This recipe requires Blender 4.0.2")
    source = json.loads((root / "cloud-manifest.json").read_text())
    cloud = json.loads((root / "cloud-impostors.json").read_text())
    verified = json.loads((root / "report.json").read_text())
    if source["source"]["commit"] != COMMIT or verified["sourceCommit"] != COMMIT:
        raise RuntimeError("Pinned source verification report missing or wrong")
    upstream = root / ".work/upstream"
    textures = upstream / "src/app/public/textures"
    # Snapshot every generated raw/GLB and source image/preset, not just LOD0.
    paths = sorted(list((root / "raw").glob("*.json")) + list((root / "glb").glob("*.glb")) +
                   list((upstream / "src/lib/presets").glob("*_large.json")) +
                   [textures / "leaves" / f"{short}.png" for short in SEEDS] +
                   list((textures / "bark/Bark001_1K-JPG").glob("*.jpg")))
    snapshot = [file_record(path, root) for path in paths]
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.dither_intensity = 0.0
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0.0
    camera = bpy.data.objects.new("FixedSurfaceCamera", bpy.data.cameras.new("FixedSurfaceCamera"))
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 22.0
    scene.camera = camera
    # Keep all twenty known-normal probes on their original default interval.
    # camera_at remains pose-only; production tightening never reaches calibrate.
    camera.data.clip_start, camera.data.clip_end = DEPTH_CLIPPING["calibrationRequestedClipRange"]
    calibration = calibrate(scene, camera, output)
    trees = []
    depth_frames = []
    for short, seed in SEEDS.items():
        preset = short.title() + " Large"
        reference = next(item for item in cloud["trees"] if item["preset"] == preset)
        raw_path = root / "raw" / f"{short}-large-lod0.json"
        raw = json.loads(raw_path.read_text())
        preset_path = upstream / "src/lib/presets" / f"{short}_large.json"
        settings = json.loads(preset_path.read_text())
        if (raw["preset"], raw["lod"], settings["seed"]) != (preset, 0, seed):
            raise RuntimeError(f"Full preset/LOD/seed binding failed: {short}")
        if sha(raw_path) != reference["sourceRawGeometry"]["sha256"] or sha(preset_path) != source["generation"]["presetFiles"][preset_path.name]:
            raise RuntimeError(f"Pinned raw geometry/preset changed: {short}")
        for item in reference["sourceTextures"]["files"]:
            if file_record(textures / item["file"], textures) != item:
                raise RuntimeError(f"Pinned source texture changed: {item['file']}")
        glb_path = root / "glb" / f"{short}-large-lod0-20m.glb"
        glb = glb_document(glb_path)
        glb_report = next(item for item in verified["models"] if item["file"] == str(glb_path.relative_to(root)))
        if sha(glb_path) != glb_report["sha256"]:
            raise RuntimeError("GLB differs from verified unchanged geometry/image content")
        factors = [factor(settings[label]["tint"]) for label in ("bark", "leaves")]
        if factors != [item["pbrMetallicRoughness"]["baseColorFactor"] for item in glb["materials"]]:
            raise RuntimeError("Albedo factors differ from GLB linear factors")
        scale = 20 / raw["sourceHeight"]
        branches, bv, branch_uv = mesh_object(short + "Branches", raw["branch"], scale)
        leaves, lv, leaf_uv = mesh_object(short + "Leaves", raw["leaves"], scale)
        vertices = bv + lv
        bounds = [[min(v[i] for v in vertices), max(v[i] for v in vertices)] for i in range(3)]
        leaf = textures / "leaves" / f"{short}.png"
        bark = textures / "bark/Bark001_1K-JPG"
        materials = {channel: [material(short + channel + "Branches", channel, camera, bark / "Bark001_1K-JPG_Color.jpg", factors[0], bark / "Bark001_1K-JPG_NormalGL.jpg"),
                               material(short + channel + "Leaves", channel, camera, leaf, factors[1], leaf=True)]
                     for channel in CHANNELS}
        frames = []
        for yaw in YAWS:
            angle = math.radians(yaw)
            camera_at(camera, (math.cos(angle), math.sin(angle), 0), (0, 0, 10.5))
            pixels = [point_px(scene, camera, vertex) for vertex in vertices]
            projected = [min(p[0] for p in pixels), min(p[1] for p in pixels), max(p[0] for p in pixels), max(p[1] for p in pixels)]
            root_pixel = point_px(scene, camera, (0, 0, 0))
            depth_clipping = tight_depth_clipping(camera, (branches, leaves), short, yaw)
            clipped_pixels = [point_px(scene, camera, vertex) for vertex in vertices]
            root_after = point_px(scene, camera, (0, 0, 0))
            projection_unchanged = root_after == root_pixel and clipped_pixels == pixels
            if not projection_unchanged:
                raise RuntimeError(f"{short}/{yaw}: clipping changed projected root or model bounds")
            depth_clipping["projectedRootAndBoundsUnchanged"] = projection_unchanged
            frame = {"yawDegrees": yaw, "camera": CAMERA, "cameraPositionBlenderWorldMetres": list(camera.location),
                     "rootPixelFromTopLeft": root_pixel,
                     "projectedModelBoundsPixelExclusiveMax": projected, "depthClipping": depth_clipping, "channels": {}}
            for channel in CHANNELS:
                for obj, mat in zip((branches, leaves), materials[channel]):
                    obj.data.materials.clear()
                    obj.data.materials.append(mat)
                path = output / "frames" / short / f"{short}-{channel}-azimuth-{yaw:03d}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                require_depth_interval(camera, depth_clipping, channel)
                render(scene, channel, path)
                frame["channels"][channel] = {**file_record(path, output), "sizePx": [SIZE, SIZE]}
            frames.append(frame)
            depth_frames.append(depth_clipping)
        trees.append({"species": short, "preset": preset, "seed": seed, "sourceCommit": COMMIT,
                      "sourcePreset": file_record(preset_path, root), "sourceRawGeometry": reference["sourceRawGeometry"],
                      "sourceGlb": file_record(glb_path, root), "sourceTextures": reference["sourceTextures"],
                      "linearBaseColorFactors": {"bark": factors[0], "leaves": factors[1]},
                      "uvBindings": {"branch": branch_uv, "leaves": leaf_uv},
                      "modelScale": {"scale": scale, "actualBoundsBlenderWorldMetresXYZ": bounds,
                                     "actualBoundsThreeLocalMetresXYZ": [bounds[0], bounds[2], [-bounds[1][1], -bounds[1][0]]],
                                     "heightMetres": bounds[2][1] - bounds[2][0], "sourceUnitsArePresentationOnly": True},
                      "frames": frames})
        for obj in (branches, leaves):
            bpy.data.objects.remove(obj, do_unlink=True)
    if snapshot != [file_record(path, root) for path in paths]:
        raise RuntimeError("Source raw/GLB/texture/preset bytes changed during bake")
    manifest = {"schemaVersion": 1, "source": source["source"], "channels": CHANNELS, "textureCoordinates": UV_POLICY,
                "render": {"blenderVersion": bpy.app.version_string, "engine": scene.render.engine, "samples": 48,
                           "resolutionPx": [SIZE, SIZE], "horizontalYawDegrees": YAWS, "camera": CAMERA,
                           "frameWorldBoundsMetres": [-11, -0.5, 11, 21.5], "background": "transparent RGBA8",
                           "exposure": 0.0, "gamma": 1.0, "look": "None", "ditherIntensity": 0.0,
                           "depthClipping": {**DEPTH_CLIPPING, "frames": depth_frames},
                           "leafAlphaCutoff": 0.5, "leafAlphaPolicy": "discard source interpolated alpha < 0.5; same explicit mask in both passes"},
                "normalCalibration": {"file": "normal-calibration.json", "sha256": sha(output / "normal-calibration.json"), "passed": calibration["passed"]},
                "sourceVerificationReport": file_record(root / "report.json", root),
                "sourcesBeforeAndAfter": snapshot, "sourceBytesUnchanged": True,
                "trees": trees, "runtimeImported": False, "visualAcceptance": False,
                "caveat": "Fixed author source geometry and surface proxies; 20m is presentation scale, not measured local tree height or surveyed Hudson species/locations."}
    (output / "tree-surface-impostors.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
