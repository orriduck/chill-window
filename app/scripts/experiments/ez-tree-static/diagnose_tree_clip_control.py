"""Cloud-only coverage/depth controls; collection is never production acceptance."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import diagnose_tree_surface_normals as diagnostic
import render_tree_surface_impostors as recipe

MODES = {
    "clip-default": ("CLIP", False, "Unchanged production leaf CLIP and default camera depth"),
    "clip-tight-depth": ("CLIP", True, "Only camera clip_start/end change; actual camera depths plus 5m margin"),
    "hashed-default": ("HASHED", False, "Binary source mask unchanged; leaf blend_method only; negative control"),
    "blend-default": ("BLEND", False, "Binary source mask unchanged; leaf blend_method only; unordered leaf triangles remain a visibility limitation"),
}
CHANNELS = ("constant", "albedo", "normal")
CONSTANT = (.5, 1.0, .5)


def material_policy(material):
    discard = [node for node in material.node_tree.nodes
               if node.bl_idname == "ShaderNodeMath" and node.operation == "LESS_THAN"
               and node.inputs[1].default_value == .5]
    return {"blendMethod": material.blend_method, "alphaThreshold": material.alpha_threshold,
            "useBackfaceCulling": material.use_backface_culling,
            "showTransparentBack": material.show_transparent_back,
            "useScreenRefraction": material.use_screen_refraction,
            "sourceAlphaCutoffNodeValues": [node.inputs[1].default_value for node in discard]}


def geometry_state(objects):
    result = {}
    for obj in objects:
        mesh = obj.data
        uv = b"".join(struct.pack("<2f", *item.uv) for item in mesh.uv_layers["UVMap"].data)
        positions = b"".join(struct.pack("<3f", *v.co) for v in mesh.vertices)
        topology = b"".join(struct.pack("<I", loop.vertex_index) for loop in mesh.loops)
        result[obj.name] = {"vertexCount": len(mesh.vertices), "loopCount": len(mesh.loops),
            "uvFloat32Sha256": hashlib.sha256(uv).hexdigest(),
            "positionFloat32Sha256": hashlib.sha256(positions).hexdigest(),
            "loopVertexIndexSha256": hashlib.sha256(topology).hexdigest(),
            "matrixWorld": [list(row) for row in obj.matrix_world]}
    return result


def camera_state(camera):
    return {"position": list(camera.location), "rotationEuler": list(camera.rotation_euler),
            "matrixWorld": [list(row) for row in camera.matrix_world],
            "type": camera.data.type, "orthoScale": camera.data.ortho_scale,
            "clipStart": camera.data.clip_start, "clipEnd": camera.data.clip_end}


def alpha_record(raw, pixels):
    # Preserve FLOAT32 alpha bits, independently from quantized PNG equality.
    float_alpha = b"".join(struct.pack("<f", raw[i]) for i in range(3, len(raw), 4))
    return pixels[3::4], float_alpha


def compare_alpha(left, right):
    png_left, float_left = left
    png_right, float_right = right
    return {"pngEqual": png_left == png_right,
            "pngMismatchCount": sum(a != b for a, b in zip(png_left, png_right)),
            "float32AlphaBitsEqual": float_left == float_right,
            "float32AlphaMismatchCount": sum(float_left[i:i + 4] != float_right[i:i + 4]
                                             for i in range(0, len(float_left), 4)),
            "pngAlphaSha256": hashlib.sha256(png_left).hexdigest(),
            "float32AlphaSha256": hashlib.sha256(float_left).hexdigest()}


def constant_radiance(raw, probes):
    errors, opaque_errors, partial_errors = [], [], []
    exact_loss = 0
    for i in range(0, len(raw), 4):
        rgba = raw[i:i + 4]
        if all(math.isfinite(v) for v in rgba) and rgba[3] > 0:
            error = max(abs(v - c * rgba[3]) for v, c in zip(rgba[:3], CONSTANT))
            errors.append(error)
            exact_loss += any(v < c * rgba[3] for v, c in zip(rgba[:3], CONSTANT))
            (opaque_errors if rgba[3] == 1 else partial_errors).append(error)
    records = []
    for x, y in probes:
        actual = diagnostic.sample(raw, x, y)
        target = [c * actual[3] for c in CONSTANT]
        records.append({"pixelFromTopLeft": [x, y], "actual": diagnostic.float_record(actual),
            "expectedAssociatedRgbFromActualAlpha": [diagnostic.numeric(v) for v in target],
            "actualMinusExpectedRgb": [diagnostic.numeric(a - b) for a, b in zip(actual[:3], target)],
            "actualToExpectedRadianceRatio": [diagnostic.numeric(a / b) if b else None for a, b in zip(actual[:3], target)]})
    return {"targetUnassociatedRgb": list(CONSTANT), "expectedAssociatedFormula": "RGB=C*actualAlpha",
        "coveredFiniteMaxRgbAbsoluteError": diagnostic.distribution(errors),
        "exactOpaqueMaxRgbAbsoluteError": diagnostic.distribution(opaque_errors),
        "partialCoverageMaxRgbAbsoluteError": diagnostic.distribution(partial_errors),
        "pixelsWithAnyExactRadianceDeficit": exact_loss, "probes": records,
        "radianceAcceptanceThreshold": None,
        "interpretation": "Exact measurements, including float rounding; no radiance tolerance invented and no postprocessing"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    root, output = args.source_root.resolve(), args.out.resolve()
    if root == output or root in output.parents:
        raise RuntimeError("Output must be outside source directory")
    if bpy.app.version_string != "4.0.2":
        raise RuntimeError("Requires exactly Blender 4.0.2")
    prior = json.loads((HERE / "clip-control-reference.json").read_text())
    reference_path = HERE / "normal-diagnostic-reference.json"
    if recipe.sha(reference_path) != prior["sourceReferenceSha256"]:
        raise RuntimeError("Immutable prior source reference changed")
    reference = json.loads(reference_path.read_text())
    source = json.loads((root / "cloud-manifest.json").read_text())
    cloud = json.loads((root / "cloud-impostors.json").read_text())
    verified = json.loads((root / "report.json").read_text())
    if source["source"]["commit"] != recipe.COMMIT or verified["sourceCommit"] != recipe.COMMIT:
        raise RuntimeError("Wrong pinned source")
    upstream = root / ".work/upstream"
    textures = upstream / "src/app/public/textures"
    paths = sorted([root / name for name in ("cloud-manifest.json", "cloud-impostors.json", "report.json")] +
        list((root / "raw").glob("*.json")) + list((root / "glb").glob("*.glb")) +
        list((upstream / "src/lib/presets").glob("*_large.json")) +
        [textures / "leaves" / f"{short}.png" for short in recipe.SEEDS] +
        list((textures / "bark/Bark001_1K-JPG").glob("*.jpg")))
    snapshot = [recipe.file_record(path, root) for path in paths]
    binding = next(tree for tree in cloud["trees"] if tree["preset"] == "Oak Large")
    raw_path, preset_path = root / "raw/oak-large-lod0.json", upstream / "src/lib/presets/oak_large.json"
    glb_path = root / "glb/oak-large-lod0-20m.glb"
    raw, settings = json.loads(raw_path.read_text()), json.loads(preset_path.read_text())
    if (raw["preset"], raw["lod"], settings["seed"]) != ("Oak Large", 0, 23399):
        raise RuntimeError("Wrong Oak geometry binding")
    for path, key in ((raw_path, "sourceRawGeometry"), (preset_path, "sourcePreset"), (glb_path, "sourceGlb")):
        if recipe.file_record(path, root) != {field: reference[key][field] for field in ("file", "bytes", "sha256")}:
            raise RuntimeError(f"Source differs from actual failed-run reference: {key}")
    if recipe.sha(raw_path) != binding["sourceRawGeometry"]["sha256"] or recipe.sha(preset_path) != source["generation"]["presetFiles"][preset_path.name]:
        raise RuntimeError("Raw/preset generation binding changed")
    if binding["sourceTextures"] != reference["sourceTextures"]:
        raise RuntimeError("Source texture binding changed")
    for item in binding["sourceTextures"]["files"]:
        if recipe.file_record(textures / item["file"], textures) != item:
            raise RuntimeError("Source texture bytes changed")
    glb_report = next(item for item in verified["models"] if item["file"] == str(glb_path.relative_to(root)))
    if recipe.sha(glb_path) != glb_report["sha256"]:
        raise RuntimeError("GLB verification binding changed")
    factors = [recipe.factor(settings[label]["tint"]) for label in ("bark", "leaves")]
    if factors != [item["pbrMetallicRoughness"]["baseColorFactor"] for item in recipe.glb_document(glb_path)["materials"]]:
        raise RuntimeError("GLB tint changed")
    output.mkdir(parents=True, exist_ok=True)
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
    camera = bpy.data.objects.new("ClipControlCamera", bpy.data.cameras.new("ClipControlCamera"))
    bpy.context.collection.objects.link(camera)
    camera.data.type, camera.data.ortho_scale = "ORTHO", 22.0
    scene.camera = camera
    angle = math.radians(135)
    recipe.camera_at(camera, (math.cos(angle), math.sin(angle), 0), (0, 0, 10.5))
    original_camera = camera_state(camera)
    scale = 20 / raw["sourceHeight"]
    branches, bv, branch_uv = recipe.mesh_object("oakBranches", raw["branch"], scale)
    leaves, lv, leaf_uv = recipe.mesh_object("oakLeaves", raw["leaves"], scale)
    objects, vertices = (branches, leaves), bv + lv
    uv_bindings = {"branch": branch_uv, "leaves": leaf_uv}
    if uv_bindings != reference["uvBindings"]:
        raise RuntimeError("UV binding differs from prior actual source")
    geometry_before = geometry_state(objects)
    bounds = [[min(v[i] for v in vertices), max(v[i] for v in vertices)] for i in range(3)]
    root_px = recipe.point_px(scene, camera, (0, 0, 0))
    projected = [recipe.point_px(scene, camera, point) for point in vertices]
    projected_bounds = [min(p[0] for p in projected), min(p[1] for p in projected), max(p[0] for p in projected), max(p[1] for p in projected)]
    if bounds != reference["sourceModelScale"]["actualBoundsBlenderWorldMetresXYZ"] or list(camera.location) != reference["productionFrame"]["cameraPositionBlenderWorldMetres"]:
        raise RuntimeError("Actual source bounds/camera differs from prior")
    # All actual Blender vertices in actual camera space, rather than an AABB estimate.
    world_vertices = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    depths = [-(camera.matrix_world.inverted() @ vertex).z for vertex in world_vertices]
    tight = (min(depths) - 5.0, max(depths) + 5.0)
    if tight[0] <= 0:
        raise RuntimeError("Conservative tight clip start must be positive")
    bark = textures / "bark/Bark001_1K-JPG"
    originals = {channel: [recipe.material("oak" + channel + "Branches", channel, camera,
        bark / "Bark001_1K-JPG_Color.jpg", factors[0], bark / "Bark001_1K-JPG_NormalGL.jpg"),
        recipe.material("oak" + channel + "Leaves", channel, camera, textures / "leaves/oak.png", factors[1], leaf=True)]
        for channel in ("albedo", "normal")}
    original_policies = {channel: [material_policy(mat) for mat in mats] for channel, mats in originals.items()}
    probes = sorted({tuple(item["pixel"]) for item in reference["oak135"]["failures"]} |
                    {(192, 128), (194, 128), (193, 127), (193, 129), (256, 256), (256, 450), (0, 0)})
    report = {"schemaVersion": 1, "diagnosticOnly": True, "runtimeImported": False,
        "visualAcceptance": False, "mechanismConfirmed": False, "productionVerifierUnchanged": True,
        "priorActualDiagnostic": prior, "compiler": diagnostic.compiler_metadata(),
        "reusedHelpers": [recipe.file_record(HERE / name, HERE) for name in ("diagnose_tree_surface_normals.py", "render_tree_surface_impostors.py")],
        "sourceBytesBefore": snapshot, "uvBindings": uv_bindings, "geometryBefore": geometry_before,
        "render": {"samples": 48, "resolutionPx": [512, 512], "engine": scene.render.engine,
            "cameraBefore": original_camera, "yawDegrees": 135, "normalViewTransform": "Raw",
            "constantViewTransform": "Raw", "albedoViewTransform": "Standard", "leafCutoff": .5,
            "dither": 0, "compositorEnabled": False},
        "actualBoundsBlenderWorldMetresXYZ": bounds, "rootPixelFromTopLeft": root_px,
        "projectedModelBoundsPixelExclusiveMax": projected_bounds,
        "priorFrameDifference": {"root": [a - b for a, b in zip(root_px, reference["productionFrame"]["rootPixelFromTopLeft"])],
            "bounds": [a - b for a, b in zip(projected_bounds, reference["productionFrame"]["projectedModelBoundsPixelExclusiveMax"])]},
        "depthCalculation": {"actualCameraDepthRange": [min(depths), max(depths)],
            "actualVertexCount": len(depths), "marginMetres": 5.0, "tightRequestedClipRange": list(tight),
            "formula": "depth=-(inverse(actual camera matrixWorld)*actual object matrixWorld*mesh vertex).z"},
        "originalMaterialPolicies": original_policies, "modes": {}}
    alpha_sets = {}
    try:
        for mode, (blend, narrow, meaning) in MODES.items():
            mode_report = {"meaning": meaning, "passes": {}}
            report["modes"][mode] = mode_report
            camera.data.clip_start, camera.data.clip_end = tight if narrow else (original_camera["clipStart"], original_camera["clipEnd"])
            state = camera_state(camera)
            mode_report["camera"] = state
            mode_projected = [recipe.point_px(scene, camera, point) for point in vertices]
            mode_report["rootPixelFromTopLeft"] = recipe.point_px(scene, camera, (0, 0, 0))
            mode_report["projectedModelBoundsPixelExclusiveMax"] = [min(p[0] for p in mode_projected), min(p[1] for p in mode_projected), max(p[0] for p in mode_projected), max(p[1] for p in mode_projected)]
            mode_report["framePositionUnchanged"] = mode_report["rootPixelFromTopLeft"] == root_px and mode_report["projectedModelBoundsPixelExclusiveMax"] == projected_bounds
            if not mode_report["framePositionUnchanged"]:
                raise RuntimeError("Camera depth changed projected frame position")
            mode_report["containsAllActualVertices"] = all(state["clipStart"] < depth < state["clipEnd"] for depth in depths)
            if not mode_report["containsAllActualVertices"]:
                raise RuntimeError("A mode camera excludes actual source vertices")
            alpha_sets[mode] = {}
            try:
                for channel in CHANNELS:
                    base = originals["normal" if channel == "constant" else channel]
                    selected = [diagnostic.variant(mat, "constant") if channel == "constant" else mat.copy() for mat in base]
                    try:
                        selected[1].blend_method = blend
                        policies = [material_policy(mat) for mat in selected]
                        for observed, expected in zip(policies, original_policies["normal" if channel == "constant" else channel]):
                            unchanged = dict(observed)
                            unchanged["blendMethod"] = expected["blendMethod"]
                            if unchanged != expected:
                                raise RuntimeError("Alpha/culling/backface policy changed beyond leaf blend_method")
                        if policies[0]["blendMethod"] != "OPAQUE" or policies[1]["sourceAlphaCutoffNodeValues"] != [.5]:
                            raise RuntimeError("Branch opaque or source binary leaf mask changed")
                        for obj, mat in zip(objects, selected):
                            obj.data.materials.clear()
                            obj.data.materials.append(mat)
                        metadata, rgba, direct, pixels = diagnostic.capture(scene, f"oak135-{mode}-{channel}", output, "albedo" if channel == "albedo" else "normal")
                        entry = {**metadata, "materialPolicies": policies,
                            **diagnostic.inspect(rgba, direct, pixels, probes, channel != "albedo", raw_to_png=channel != "albedo")}
                        mode_report["passes"][channel] = entry
                        alpha_sets[mode][channel] = alpha_record(rgba, pixels)
                        if channel == "constant":
                            mode_report["constantRadiance"] = constant_radiance(rgba, probes)
                        diagnostic.write_json(output / "clip-control.json", report)
                    finally:
                        for obj in objects:
                            obj.data.materials.clear()
                        for mat in selected:
                            bpy.data.materials.remove(mat)
                mode_report["pairedAlphaWithinMode"] = {channel: compare_alpha(alpha_sets[mode][channel], alpha_sets[mode]["albedo"]) for channel in CHANNELS}
                mode_report["pairedAlphaWithinModePassed"] = all(item["pngEqual"] and item["float32AlphaBitsEqual"] for item in mode_report["pairedAlphaWithinMode"].values())
                mode_report["geometryAfter"] = geometry_state(objects)
                mode_report["geometryUvUnchanged"] = mode_report["geometryAfter"] == geometry_before
            finally:
                camera.data.clip_start, camera.data.clip_end = original_camera["clipStart"], original_camera["clipEnd"]
                mode_report["cameraAfterRestore"] = camera_state(camera)
                mode_report["cameraRestoredExactly"] = mode_report["cameraAfterRestore"] == original_camera
            mode_report["alphaComparedToBaseline"] = {channel: compare_alpha(alpha_sets[mode][channel], alpha_sets["clip-default"][channel]) for channel in CHANNELS}
            mode_report["baselineAlphaComparisonIsAcceptanceGate"] = False
        baseline = report["modes"]["clip-default"]["passes"]
        report["baselineReproduction"] = {channel: {
            "decodedRgbaIdenticalToPriorActualArtifact": baseline[channel]["pngDecodedRgbaSha256"] == prior["passes"][channel]["pngDecodedRgbaSha256"],
            "pngFileShaIdenticalToPriorActualArtifact": baseline[channel]["png"]["sha256"] == prior["passes"][channel]["png"]["sha256"],
            "float32ShaIdenticalToPriorActualArtifact": baseline[channel]["float32RenderResultExport"]["rgbaFloat32Sha256"] == prior["passes"][channel]["rgbaFloat32Sha256"],
            "interpretation": "Actual full decoded RGBA hash comparison; a mismatch is not labelled reproduction"} for channel in CHANNELS}
        report["baselineDecodedRgbaReproduced"] = all(item["decodedRgbaIdenticalToPriorActualArtifact"] for item in report["baselineReproduction"].values())
        report["collectionCompleted"] = True
    except Exception as error:
        report["collectionCompleted"], report["collectionError"] = False, str(error)
        raise
    finally:
        report["sourceBytesAfter"] = [recipe.file_record(path, root) for path in paths]
        report["sourceBytesUnchanged"] = snapshot == report["sourceBytesAfter"]
        report["geometryAfter"] = geometry_state(objects)
        report["geometryUvUnchanged"] = report["geometryAfter"] == geometry_before
        report["cameraAfter"] = camera_state(camera)
        report["cameraRestoredExactly"] = report["cameraAfter"] == original_camera
        alpha_failed = report.get("collectionCompleted", False) and any(not item.get("pairedAlphaWithinModePassed", False) for item in report["modes"].values())
        if alpha_failed:
            report["collectionCompleted"], report["collectionError"] = False, "Strict within-mode paired alpha failed"
        for mode, item in report["modes"].items():
            normal_passes = [item["passes"].get(channel, {}) for channel in ("normal", "constant")]
            item["candidateModeNumericalGate"] = bool(report.get("collectionCompleted", False) and
                report.get("baselineDecodedRgbaReproduced", False) and report["sourceBytesUnchanged"] and
                report["geometryUvUnchanged"] and report["cameraRestoredExactly"] and
                item.get("geometryUvUnchanged", False) and item.get("cameraRestoredExactly", False) and
                item.get("containsAllActualVertices", False) and item.get("framePositionUnchanged", False) and item.get("pairedAlphaWithinModePassed", False) and
                all(p.get("nonfiniteRawRgbaPixels") == 0 and p.get("floatAbove1_02") == 0 and p.get("pngAbove1_02") == 0 and
                    p.get("decodedFloatNormalLengths", {}).get("count", 0) > 0 and p.get("decodedPngNormalLengths", {}).get("count", 0) > 0 for p in normal_passes))
            item["productionAccepted"] = False
        report["candidateGateMeaning"] = "Strict numerical diagnostic only: full finite normal/constant float and PNG lengths <=1.02, exact paired PNG/FLOAT32 alpha, reproduced baseline and unchanged source/geometry/camera. Constant radiance and BLEND visible-face correctness still require evidence review; true is never production acceptance."
        report["compilerAfterRender"] = diagnostic.compiler_metadata()
        diagnostic.write_json(output / "clip-control.json", report)
        if not report["sourceBytesUnchanged"] or not report["geometryUvUnchanged"] or not report["cameraRestoredExactly"]:
            raise RuntimeError("Source/geometry/UV/camera preservation failed")
        if alpha_failed:
            raise RuntimeError(report["collectionError"])


if __name__ == "__main__":
    main()
