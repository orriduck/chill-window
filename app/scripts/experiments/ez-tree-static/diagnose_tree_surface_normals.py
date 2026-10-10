"""Bounded cloud-only evidence collection; never a production bake or repair."""
import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import struct
import sys
import tempfile
import zlib

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
# Blender --python does not promise to add the script directory to sys.path.
sys.path.insert(0, str(HERE))
import render_tree_surface_impostors as recipe

FAILURE_RUN = 38056124740
PASSES = {
    "albedo": "Unchanged production albedo; Standard view; coverage reference only",
    "normal": "Unchanged production Geometry/NormalMap normal chain; Raw view",
    "geometry-only": "Only branch shading-normal source changes from NormalMap to Geometry.Normal; same face-forward/normalize/encode",
    "constant": "Emission RGB = (0.5,1,0.5), a known unit local +Y normal; original alpha/culling; independent of normal chain",
    "length-finite": "RGB = (source vector length, product of source component self-compare flags, post-Normalize length); not encoded normals",
    "encoded-finite": "RGB = component self-compare flags of the original encoded vector; not encoded normals",
}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def numeric(value):
    return value if math.isfinite(value) else str(value)


def float_record(values):
    return {"rgba": [numeric(v) for v in values],
            "littleEndianFloat32Hex": struct.pack("<4f", *values).hex(),
            "allFinite": all(math.isfinite(v) for v in values)}


def rgba_bytes(path):
    """Read exact RGBA8 PNG bytes without Blender color/alpha conversions."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("Not PNG")
    offset, payload = 8, bytearray()
    size = None
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        if zlib.crc32(kind + chunk) & 0xffffffff != crc:
            raise RuntimeError("PNG CRC mismatch")
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunk)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise RuntimeError("Expected non-interlaced RGBA8 PNG")
            size = width, height
        elif kind == b"IDAT":
            payload.extend(chunk)
        elif kind == b"IEND":
            break
        offset += length + 12
    if not size:
        raise RuntimeError("PNG IHDR missing")
    width, height = size
    stride = width * 4
    decoded = zlib.decompress(payload)
    if len(decoded) != height * (stride + 1):
        raise RuntimeError("PNG decompressed byte count mismatch")
    result, previous = bytearray(), bytearray(stride)
    for row in range(height):
        mode = decoded[row * (stride + 1)]
        scan = bytearray(decoded[row * (stride + 1) + 1:(row + 1) * (stride + 1)])
        for i in range(stride):
            left = scan[i - 4] if i >= 4 else 0
            up = previous[i]
            corner = previous[i - 4] if i >= 4 else 0
            if mode == 1:
                prediction = left
            elif mode == 2:
                prediction = up
            elif mode == 3:
                prediction = (left + up) // 2
            elif mode == 4:
                p = left + up - corner
                distances = abs(p - left), abs(p - up), abs(p - corner)
                prediction = (left if distances[0] <= min(distances[1:]) else
                              up if distances[1] <= distances[2] else corner)
            elif mode == 0:
                prediction = 0
            else:
                raise RuntimeError("Unsupported PNG filter")
            scan[i] = (scan[i] + prediction) & 255
        result.extend(scan)
        previous = scan
    return size, bytes(result)


def image_metadata(image):
    return {"name": image.name, "size": list(image.size), "channels": image.channels,
            "isFloat": image.is_float, "alphaMode": image.alpha_mode,
            "colorSpace": image.colorspace_settings.name, "source": image.source}


def float_pixels(image):
    values = array("f", [0.0]) * len(image.pixels)
    if values:
        image.pixels.foreach_get(values)
    return values


def float_sha(values):
    little = array("f", values)
    if sys.byteorder != "little":
        little.byteswap()
    return hashlib.sha256(little.tobytes()).hexdigest()


def capture(scene, name, output, channel="normal"):
    """ONE render, PNG plus same RenderResult FLOAT32 export; no second render."""
    settings = scene.render.image_settings
    settings.file_format, settings.color_mode, settings.color_depth = "PNG", "RGBA", "8"
    path = output / f"{name}.png"
    recipe.render(scene, channel, path)
    result = bpy.data.images["Render Result"]
    metadata = {"sourceRenderResult": image_metadata(result),
                "sourceRenderResultAccess": "Image.pixels RNA buffer, attempted before save_render",
                "png": recipe.file_record(path, output), "viewTransform": scene.view_settings.view_transform}
    try:
        direct = float_pixels(result)
        metadata["sourceRenderResultPixelFloatCount"] = len(direct)
    except Exception as error:
        direct = array("f")
        metadata["sourceRenderResultAccessError"] = str(error)
    if len(direct) == recipe.SIZE * recipe.SIZE * 4:
        metadata["sourceRenderResultFloat32Sha256"] = float_sha(direct)
    else:
        metadata["sourceRenderResultAvailable"] = False
        metadata["sourceRenderResultLimitation"] = "RNA exposed no complete Combined buffer; FLOAT32 save_render readback used and labelled separately"
    # Temporary FLOAT32 OpenEXR is an extraction of this same Combined result,
    # not a new render, not a HALF buffer, not a display-transformed PNG reload.
    with tempfile.TemporaryDirectory(prefix="tree-normal-float-") as temporary:
        exr = Path(temporary) / "combined.exr"
        settings.file_format, settings.color_depth = "OPEN_EXR", "32"
        settings.exr_codec = "ZIP"
        result.save_render(str(exr), scene=scene)
        image = bpy.data.images.load(str(exr), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        raw = float_pixels(image)
        metadata["float32RenderResultExport"] = {**image_metadata(image), "fileBytes": exr.stat().st_size,
            "exportSha256": recipe.sha(exr), "rgbaFloat32Sha256": float_sha(raw),
            "associationContract": "Blender Combined render buffer and OpenEXR associated/premultiplied RGB; original alpha_mode recorded above; values never altered",
            "extraction": "Render Result.save_render OPEN_EXR RGBA depth32 ZIP, reload Non-Color; temporary file deleted, not uploaded"}
        if len(raw) != recipe.SIZE * recipe.SIZE * 4 or not image.is_float:
            raise RuntimeError("Missing full FLOAT32 RGBA export")
        if len(direct) == len(raw):
            metadata["sourceRenderResultAvailable"] = True
            metadata["directVsExportFloat32BytesEqual"] = float_sha(direct) == float_sha(raw)
            metadata["directVsExportFiniteMaxAbsoluteDifference"] = max(
                (abs(a - b) for a, b in zip(direct, raw) if math.isfinite(a) and math.isfinite(b)), default=None)
        bpy.data.images.remove(image)
    settings.file_format, settings.color_depth = "PNG", "8"
    size, pixels = rgba_bytes(path)
    if size != (recipe.SIZE, recipe.SIZE):
        raise RuntimeError("PNG size changed")
    metadata["pngDecodedRgbaSha256"] = hashlib.sha256(pixels).hexdigest()
    return metadata, raw, direct, pixels


def unique(nodes, node_type, operation=None):
    matches = [node for node in nodes if node.bl_idname == node_type and
               (operation is None or node.operation == operation)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {node_type} {operation}, got {len(matches)}")
    return matches[0]


def replace_input(links, socket, source):
    for link in list(socket.links):
        links.remove(link)
    links.new(source, socket)


def finite_scalar(nodes, links, source):
    # Actual GPU semantics are calibrated below; do not equate a sanitized
    # final render buffer with finite source shader intermediates.
    compare = nodes.new("ShaderNodeMath")
    compare.operation = "COMPARE"
    compare.inputs[2].default_value = 0.0
    links.new(source, compare.inputs[0])
    links.new(source, compare.inputs[1])
    return compare.outputs[0]


def separate(nodes, links, source):
    node = nodes.new("ShaderNodeSeparateXYZ")
    links.new(source, node.inputs[0])
    return node.outputs


def combine(nodes, links, sources):
    node = nodes.new("ShaderNodeCombineXYZ")
    for source, socket in zip(sources, node.inputs):
        links.new(source, socket)
    return node.outputs[0]


def variant(original, mode):
    result = original.copy()
    result.name = original.name + "-" + mode
    nodes, links = result.node_tree.nodes, result.node_tree.links
    emission = unique(nodes, "ShaderNodeEmission")
    if mode == "constant":
        for link in list(emission.inputs["Color"].links):
            links.remove(link)
        emission.inputs["Color"].default_value = (0.5, 1.0, 0.5, 1.0)
        return result
    flip = unique(nodes, "ShaderNodeVectorMath", "SCALE")
    normalize = unique(nodes, "ShaderNodeVectorMath", "NORMALIZE")
    shading = flip.inputs[0].links[0].from_socket
    if mode == "geometry-only":
        geometry = unique(nodes, "ShaderNodeNewGeometry")
        dot = unique(nodes, "ShaderNodeVectorMath", "DOT_PRODUCT")
        replace_input(links, flip.inputs[0], geometry.outputs["Normal"])
        replace_input(links, dot.inputs[0], geometry.outputs["Normal"])
    elif mode == "encoded-finite":
        encoded = emission.inputs["Color"].links[0].from_socket
        flags = [finite_scalar(nodes, links, source) for source in separate(nodes, links, encoded)]
        replace_input(links, emission.inputs["Color"], combine(nodes, links, flags))
    elif mode == "length-finite":
        lengths = []
        for source in (shading, normalize.outputs[0]):
            length = nodes.new("ShaderNodeVectorMath")
            length.operation = "LENGTH"
            links.new(source, length.inputs[0])
            lengths.append(length.outputs["Value"])
        flags = [finite_scalar(nodes, links, source) for source in separate(nodes, links, shading)]
        for flag in flags[1:]:
            multiply = nodes.new("ShaderNodeMath")
            multiply.operation = "MULTIPLY"
            links.new(flags[0], multiply.inputs[0])
            links.new(flag, multiply.inputs[1])
            flags[0] = multiply.outputs[0]
        replace_input(links, emission.inputs["Color"], combine(nodes, links, [lengths[0], flags[0], lengths[1]]))
    else:
        raise RuntimeError("Unknown diagnostic variant")
    return result


def sample(raw, x, y):
    # Blender Image.pixels bottom-left; report/source PNG coordinates top-left.
    start = ((recipe.SIZE - 1 - y) * recipe.SIZE + x) * 4
    return list(raw[start:start + 4])


def norm(rgb):
    return math.sqrt(sum((2 * value - 1) ** 2 for value in rgb)) if all(math.isfinite(v) for v in rgb) else None


def straight(rgba):
    return [value / rgba[3] for value in rgba[:3]] if math.isfinite(rgba[3]) and rgba[3] > 0 else None


def distribution(values):
    values = sorted(value for value in values if value is not None and math.isfinite(value))
    return {"count": len(values), "min": values[0], "median": values[len(values) // 2],
            "p99": values[min(len(values) - 1, int(len(values) * .99))], "max": values[-1]} if values else {"count": 0}


def inspect(raw, direct, pixels, probes, encoded_normal, raw_to_png=True):
    floats, png_lengths, raw_lengths = [], [], []
    straight_channels = [[], [], []]
    nonfinite = above_float = above_png = opaque_float = opaque_png = 0
    flags_below_one, black_rgb_covered = 0, 0
    for y in range(recipe.SIZE):
        for x in range(recipe.SIZE):
            i = (y * recipe.SIZE + x) * 4
            rgba = sample(raw, x, y)
            nonfinite += not all(math.isfinite(v) for v in rgba)
            rgb = straight(rgba)
            if rgb is not None:
                floats.append(rgba[3])
                for values, value in zip(straight_channels, rgb):
                    values.append(value)
                black_rgb_covered += all(v == 0 for v in rgba[:3])
                flags_below_one += any(v < .999 for v in rgb) if not encoded_normal else 0
                if encoded_normal:
                    length = norm(rgb)
                    raw_lengths.append(length)
                    if length is not None and length > 1.02:
                        above_float += 1
                        opaque_float += rgba[3] >= 254.5 / 255
            if encoded_normal and pixels[i + 3]:
                length = norm([v / 255 for v in pixels[i:i + 3]])
                png_lengths.append(length)
                if length > 1.02:
                    above_png += 1
                    opaque_png += pixels[i + 3] == 255
    records = []
    for point in probes:
        x, y = point
        rgba = sample(raw, x, y)
        i = (y * recipe.SIZE + x) * 4
        byte = list(pixels[i:i + 4])
        rgb = straight(rgba)
        record = {"pixelFromTopLeft": point, "rawPremultipliedFloat32": float_record(rgba),
                  "pngStraightRgba8": byte,
                  "unassociatedRawRgb": [numeric(v) for v in rgb] if rgb else None}
        if len(direct) == len(raw):
            record["sourceRenderResultPixel"] = float_record(sample(direct, x, y))
        if raw_to_png and rgb and all(math.isfinite(v) for v in rgb):
            expected = [max(0, min(255, int(v * 255 + .5))) for v in rgb]
            record["rawToStraightQuantizedRgb8"] = expected
            record["pngMinusPredictedRgbBytes"] = [a - b for a, b in zip(byte[:3], expected)]
        if encoded_normal:
            record["decodedFloatNormalLength"] = norm(rgb) if rgb else None
            record["decodedPngNormalLength"] = norm([v / 255 for v in byte[:3]]) if byte[3] else None
        records.append(record)
    return {"nonfiniteRawRgbaPixels": nonfinite, "nonzeroFloatAlphaDistribution": distribution(floats),
            "unassociatedRawRgbChannelDistributions": [distribution(values) for values in straight_channels],
            "coveredRawExactlyBlackRgbPixels": black_rgb_covered,
            "unassociatedRgbAnyComponentBelow0999Count": flags_below_one if not encoded_normal else None,
            "decodedFloatNormalLengths": distribution(raw_lengths) if encoded_normal else None,
            "decodedPngNormalLengths": distribution(png_lengths) if encoded_normal else None,
            "floatAbove1_02": above_float if encoded_normal else None,
            "floatAbove1_02WithAlphaRoundingTo255": opaque_float if encoded_normal else None,
            "pngAbove1_02": above_png if encoded_normal else None,
            "pngAbove1_02Opaque": opaque_png if encoded_normal else None,
            "probes": records}


def calibrate_finite(scene, camera, output):
    """Real shader invalid inputs; detects compiler/sanitation blind spots."""
    mesh = bpy.data.meshes.new("DiagnosticFinitePlane")
    mesh.from_pydata([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2), (0, 2, 3)])
    mesh.update()
    layer = mesh.uv_layers.new(name="UVMap")
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for loop in mesh.loops:
        layer.data[loop.index].uv = uv[loop.vertex_index]
    obj = bpy.data.objects.new("DiagnosticFinitePlane", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = Vector(recipe.CAMERA["targetWorldMetres"])
    obj.rotation_euler = (camera.location - obj.location).to_track_quat("Z", "Y").to_euler()
    # Texture-fed -1/0/4 values prevent CPU constant folding of inverse sqrt.
    # Left half opaque, right half transparent; finite mask calibration tests
    # actual CLIP+Transparent materials and final black sanitization separately.
    image = bpy.data.images.new("DiagnosticInvalidInputs", 2, 1, alpha=True, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    image.pixels = [-1, 0, 4, 1, -1, 0, 4, 0]
    mat = bpy.data.materials.new("DiagnosticFiniteMaterial")
    mat.use_nodes = True
    mat.use_backface_culling = False
    mat.blend_method, mat.alpha_threshold = "CLIP", .5
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image, texture.interpolation, texture.extension = image, "Closest", "EXTEND"
    values = []
    for component in separate(nodes, links, texture.outputs["Color"]):
        inverse = nodes.new("ShaderNodeMath")
        inverse.operation = "INVERSE_SQRT"
        links.new(component, inverse.inputs[0])
        values.append(inverse.outputs[0])
    emission = nodes.new("ShaderNodeEmission")
    links.new(combine(nodes, links, values), emission.inputs["Color"])
    cutoff = nodes.new("ShaderNodeMath")
    cutoff.operation, cutoff.inputs[1].default_value = "LESS_THAN", .5
    links.new(texture.outputs["Alpha"], cutoff.inputs[0])
    mix = nodes.new("ShaderNodeMixShader")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    links.new(cutoff.outputs[0], mix.inputs[0])
    links.new(emission.outputs[0], mix.inputs[1])
    links.new(transparent.outputs[0], mix.inputs[2])
    target = nodes.new("ShaderNodeOutputMaterial")
    links.new(mix.outputs[0], target.inputs["Surface"])
    obj.data.materials.append(mat)
    points = [[220, 256], [292, 256], [0, 0]]
    metadata, raw, direct, pixels = capture(scene, "calibration-invalid-emission", output)
    raw_report = {**metadata, **inspect(raw, direct, pixels, points, False)}
    flags = [finite_scalar(nodes, links, value) for value in values]
    replace_input(links, emission.inputs["Color"], combine(nodes, links, flags))
    metadata, raw, direct, pixels = capture(scene, "calibration-finite-flags", output)
    flag_report = {**metadata, **inspect(raw, direct, pixels, points, False)}
    opaque = next((p for p in flag_report["probes"] if p["rawPremultipliedFloat32"]["rgba"][3] == 1), None)
    trustworthy = bool(opaque and all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v - expected) <= .01
                        for v, expected in zip(opaque["rawPremultipliedFloat32"]["rgba"][:3], [0, 0, 1])))
    bpy.data.objects.remove(obj, do_unlink=True)
    return {"invalidInputs": "texture RGB (-1,0,4), Math INVERSE_SQRT -> undefined negative sqrt, +Inf, 0.5; explicit half-image CLIP mask",
            "finiteFlagExpectedOpaqueRgb": [0, 0, 1], "finiteFlagsUsableOnThisActualCompiler": trustworthy,
            "interpretation": "If this calibration fails, source self-compare flags are inconclusive; never treat sanitized Combined RGB as proof of finite shader intermediates",
            "invalidEmission": raw_report, "finiteFlags": flag_report}


def compiler_metadata():
    result = {"platform": platform.platform(), "python": sys.version,
              "blender": {key: (value.decode(errors="replace") if isinstance(value, bytes) else value)
                          for key in ("version_string", "build_hash", "build_branch", "build_type", "build_cflags", "build_cxxflags")
                          if (value := getattr(bpy.app, key, None)) is not None},
              "requestedEnvironment": {key: os.environ.get(key) for key in ("LIBGL_ALWAYS_SOFTWARE", "EGL_PLATFORM")}}
    try:
        import gpu
        result["actualGpuPlatform"] = {key: getattr(gpu.platform, key)() for key in
                                       ("vendor_get", "renderer_get", "version_get", "backend_type_get")}
    except Exception as error:
        result["actualGpuPlatformUnavailable"] = str(error)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    root, output = args.source_root.resolve(), args.out.resolve()
    if root == output or root in output.parents:
        raise RuntimeError("Diagnostic output must be outside original source/asset directory")
    if bpy.app.version_string != "4.0.2":
        raise RuntimeError("Requires exactly Blender 4.0.2")
    source = json.loads((root / "cloud-manifest.json").read_text())
    cloud = json.loads((root / "cloud-impostors.json").read_text())
    verified = json.loads((root / "report.json").read_text())
    reference = json.loads((HERE / "normal-diagnostic-reference.json").read_text())
    if source["source"]["commit"] != recipe.COMMIT or verified["sourceCommit"] != recipe.COMMIT:
        raise RuntimeError("Wrong pinned source")
    output.mkdir(parents=True, exist_ok=True)
    upstream = root / ".work/upstream"
    textures = upstream / "src/app/public/textures"
    paths = sorted(list((root / "raw").glob("*.json")) + list((root / "glb").glob("*.glb")) +
                   list((upstream / "src/lib/presets").glob("*_large.json")) +
                   [textures / "leaves" / f"{short}.png" for short in recipe.SEEDS] +
                   list((textures / "bark/Bark001_1K-JPG").glob("*.jpg")))
    snapshot = [recipe.file_record(path, root) for path in paths]
    binding = next(tree for tree in cloud["trees"] if tree["preset"] == "Oak Large")
    raw_path = root / "raw/oak-large-lod0.json"
    preset_path = upstream / "src/lib/presets/oak_large.json"
    raw, settings = json.loads(raw_path.read_text()), json.loads(preset_path.read_text())
    if (raw["preset"], raw["lod"], settings["seed"]) != ("Oak Large", 0, 23399):
        raise RuntimeError("Wrong Oak source binding")
    if recipe.sha(raw_path) != binding["sourceRawGeometry"]["sha256"] or recipe.sha(preset_path) != source["generation"]["presetFiles"][preset_path.name]:
        raise RuntimeError("Raw/preset hash changed")
    for path, key in ((raw_path, "sourceRawGeometry"), (preset_path, "sourcePreset")):
        actual = recipe.file_record(path, root)
        if any(actual[field] != reference[key][field] for field in ("file", "bytes", "sha256")):
            raise RuntimeError(f"Source differs from actual failed-run reference: {key}")
    if binding["sourceTextures"] != reference["sourceTextures"]:
        raise RuntimeError("Source texture bindings differ from failed-run reference")
    for item in binding["sourceTextures"]["files"]:
        if recipe.file_record(textures / item["file"], textures) != item:
            raise RuntimeError("Source texture hash changed")
    glb_path = root / "glb/oak-large-lod0-20m.glb"
    glb_report = next(item for item in verified["models"] if item["file"] == str(glb_path.relative_to(root)))
    if recipe.sha(glb_path) != glb_report["sha256"]:
        raise RuntimeError("GLB hash changed")
    if recipe.file_record(glb_path, root) != reference["sourceGlb"]:
        raise RuntimeError("GLB differs from actual failed-run reference")
    factors = [recipe.factor(settings[label]["tint"]) for label in ("bark", "leaves")]
    if factors != [item["pbrMetallicRoughness"]["baseColorFactor"] for item in recipe.glb_document(glb_path)["materials"]]:
        raise RuntimeError("GLB factors changed")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine, scene.eevee.taa_render_samples = "BLENDER_EEVEE", 48
    scene.render.resolution_x = scene.render.resolution_y = recipe.SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent, scene.render.dither_intensity = True, 0.0
    scene.render.image_settings.compression = 15
    scene.view_settings.look, scene.view_settings.exposure, scene.view_settings.gamma = "None", 0.0, 1.0
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0
    scene.use_nodes = False
    camera = bpy.data.objects.new("FixedDiagnosticCamera", bpy.data.cameras.new("FixedDiagnosticCamera"))
    bpy.context.collection.objects.link(camera)
    camera.data.type, camera.data.ortho_scale = "ORTHO", 22.0
    scene.camera = camera
    angle = math.radians(135)
    recipe.camera_at(camera, (math.cos(angle), math.sin(angle), 0), (0, 0, 10.5))
    report = {"schemaVersion": 1, "diagnosticOnly": True, "runtimeImported": False, "visualAcceptance": False,
              "productionVerifierUnchanged": True, "mechanismConfirmed": False, "failureReference": reference,
              "productionRenderer": recipe.file_record(HERE / "render_tree_surface_impostors.py", HERE),
              "compiler": compiler_metadata(), "passes": {}, "render": {"samples": 48, "engine": scene.render.engine,
                  "resolutionPx": [recipe.SIZE, recipe.SIZE], "camera": recipe.CAMERA, "yawDegrees": 135,
                  "actualCameraPosition": list(camera.location), "dither": 0, "compositorEnabled": False,
                  "normalViewTransform": "Raw", "albedoViewTransform": "Standard", "leafAlphaCutoff": .5},
              "sourceBytesBefore": snapshot, "textureCoordinates": recipe.UV_POLICY}
    try:
        report["finiteShaderCalibration"] = calibrate_finite(scene, camera, output)
        scale = 20 / raw["sourceHeight"]
        branches, bv, branch_uv = recipe.mesh_object("oakBranches", raw["branch"], scale)
        leaves, lv, leaf_uv = recipe.mesh_object("oakLeaves", raw["leaves"], scale)
        report["uvBindings"] = {"branch": branch_uv, "leaves": leaf_uv}
        if report["uvBindings"] != reference["uvBindings"]:
            raise RuntimeError("Exact source/Blender UV binding differs from actual failed-run reference")
        vertices = bv + lv
        report["actualBoundsBlenderWorldMetresXYZ"] = [[min(v[i] for v in vertices), max(v[i] for v in vertices)] for i in range(3)]
        report["rootPixelFromTopLeft"] = recipe.point_px(scene, camera, (0, 0, 0))
        projected = [recipe.point_px(scene, camera, point) for point in vertices]
        report["projectedModelBoundsPixelExclusiveMax"] = [min(p[0] for p in projected), min(p[1] for p in projected),
                                                           max(p[0] for p in projected), max(p[1] for p in projected)]
        report["failedRunSceneComparison"] = {
            "worldBoundsEqual": report["actualBoundsBlenderWorldMetresXYZ"] == reference["sourceModelScale"]["actualBoundsBlenderWorldMetresXYZ"],
            "cameraPositionEqual": list(camera.location) == reference["productionFrame"]["cameraPositionBlenderWorldMetres"],
            "rootPixelDifference": [a - b for a, b in zip(report["rootPixelFromTopLeft"], reference["productionFrame"]["rootPixelFromTopLeft"])],
            "projectedBoundsDifference": [a - b for a, b in zip(report["projectedModelBoundsPixelExclusiveMax"], reference["productionFrame"]["projectedModelBoundsPixelExclusiveMax"])]}
        if not report["failedRunSceneComparison"]["worldBoundsEqual"] or not report["failedRunSceneComparison"]["cameraPositionEqual"]:
            raise RuntimeError("Actual bounds/camera differ from failed source scene")
        bark = textures / "bark/Bark001_1K-JPG"
        mats = {channel: [recipe.material("oak" + channel + "Branches", channel, camera,
                   bark / "Bark001_1K-JPG_Color.jpg", factors[0], bark / "Bark001_1K-JPG_NormalGL.jpg"),
                   recipe.material("oak" + channel + "Leaves", channel, camera, textures / "leaves/oak.png", factors[1], leaf=True)]
                for channel in ("albedo", "normal")}
        points = sorted({tuple(item["pixel"]) for item in reference["oak135"]["failures"]} |
                        {(192, 128), (194, 128), (193, 127), (193, 129), (256, 256), (256, 450), (0, 0)})
        alphas = {}
        for mode, meaning in PASSES.items():
            selected = mats[mode] if mode in mats else [variant(mat, mode) for mat in mats["normal"]]
            for obj, mat in zip((branches, leaves), selected):
                obj.data.materials.clear()
                obj.data.materials.append(mat)
            metadata, rgba, direct, pixels = capture(scene, "oak135-" + mode, output, "albedo" if mode == "albedo" else "normal")
            encoded = mode in ("normal", "geometry-only", "constant")
            report["passes"][mode] = {"meaning": meaning, **metadata,
                "pngPredictionPolicy": "Raw unassociate then nearest RGBA8 byte" if mode != "albedo" else "No byte prediction: Standard view sRGB-encodes linear albedo",
                **inspect(rgba, direct, pixels, points, encoded, raw_to_png=mode != "albedo")}
            alphas[mode] = pixels[3::4]
            report["passes"][mode]["pngAlphaSha256"] = hashlib.sha256(alphas[mode]).hexdigest()
            if mode == "constant":
                # Actual partial-coverage calibration of the float association;
                # both hypotheses are reported, not inferred from alpha_mode.
                premul_errors, straight_errors = [], []
                for i in range(0, len(rgba), 4):
                    values = rgba[i:i + 4]
                    if all(math.isfinite(v) for v in values) and 0 < values[3] < 1:
                        premul_errors.append(max(abs(v - c * values[3]) for v, c in zip(values[:3], (.5, 1, .5))))
                        straight_errors.append(max(abs(v - c) for v, c in zip(values[:3], (.5, 1, .5))))
                report["actualFloatAssociationControl"] = {
                    "meaning": "Same actual partial-coverage pixels; error against RGB=C*A versus RGB=C, C=(0.5,1,0.5)",
                    "premultipliedHypothesisAbsoluteError": distribution(premul_errors),
                    "straightHypothesisAbsoluteError": distribution(straight_errors),
                    "acceptanceGate": "none; read actual evidence before interpreting derived straight values"}
            if mode == "normal":
                report["baselineReproduction"] = {"pngSha256IdenticalToFailedRun": metadata["png"]["sha256"] == reference["oak135"]["normalPngSha256"],
                    "knownOffender193_128Actual": next(p for p in report["passes"][mode]["probes"] if p["pixelFromTopLeft"] == (193, 128)),
                    "interpretation": "Fresh standalone render may differ from previous full sequence; record actual reproduction, never infer previous values"}
            write_json(output / "normal-diagnostic.json", report)
        report["pairedPngAlpha"] = {mode: {"equalToAlbedo": alpha == alphas["albedo"],
                    "mismatchCount": sum(a != b for a, b in zip(alpha, alphas["albedo"]))} for mode, alpha in alphas.items()}
        if any(not item["equalToAlbedo"] for item in report["pairedPngAlpha"].values()):
            raise RuntimeError("Diagnostic alpha changed; inspect actual mismatch counts, no relaxed threshold")
        report["collectionCompleted"] = True
    except Exception as error:
        report["collectionCompleted"] = False
        report["collectionError"] = str(error)
        raise
    finally:
        after = [recipe.file_record(path, root) for path in paths]
        report["sourceBytesAfter"] = after
        report["sourceBytesUnchanged"] = snapshot == after
        report["compilerAfterRender"] = compiler_metadata()
        write_json(output / "normal-diagnostic.json", report)
        if snapshot != after:
            raise RuntimeError("Source bytes changed during diagnostic")


if __name__ == "__main__":
    main()
