#!/usr/bin/env python3
"""Strict paired pixel/source checks; write real diagnostics even on failure."""
import argparse
import base64
import hashlib
import json
import math
import struct
from pathlib import Path
from PIL import Image

COMMIT = "dcf309bd86bd521083d9c70f01f2de45fdc7c457"
YAWS = list(range(0, 360, 45))
# Metres only: Float32 mesh/camera arithmetic, never a pixel tolerance.
DEPTH_TOLERANCE_METRES = 1e-4


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_file(root, record):
    path = root / record["file"]
    assert path.is_file(), str(path)
    assert len(path.read_bytes()) == record["bytes"] and sha(path) == record["sha256"], str(path)
    return path


def glb_document(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from("<I4s", data, 12)
    assert kind == b"JSON" and data[:4] == b"glTF"
    return json.loads(data[20:20 + length])


def rotate_quaternion(quaternion, vector):
    w, x, y, z = quaternion
    qv = [x, y, z]
    def cross(a, b):
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    t = [2 * value for value in cross(qv, vector)]
    c = cross(qv, t)
    return [vector[i] + w * t[i] + c[i] for i in range(3)]


def percentile(values, fraction):
    return sorted(values)[round((len(values) - 1) * fraction)] if values else None


def length_stats(values):
    return {"count": len(values), "min": min(values) if values else None,
            "p01": percentile(values, 0.01), "median": percentile(values, 0.5),
            "p99": percentile(values, 0.99), "max": max(values) if values else None,
            "shorterThan0_99": sum(value < 0.99 for value in values),
            "shorterThan0_5": sum(value < 0.5 for value in values),
            "nearZeroBelow0_05": sum(value < 0.05 for value in values),
            "within1PercentOfUnit": sum(abs(value - 1) <= 0.01 for value in values)}


def pixel_diagnostics(albedo, normal):
    a_pixels, n_pixels = list(albedo.getdata()), list(normal.getdata())
    opaque, interior, edge = [], [], []
    rgb = [[], [], []]
    samples = []
    mismatch = 0
    max_alpha_delta = 0
    upper_bound_failures = []
    width, height = albedo.size
    for i, (a, n) in enumerate(zip(a_pixels, n_pixels)):
        if a[3] != n[3]:
            mismatch += 1
            max_alpha_delta = max(max_alpha_delta, abs(a[3] - n[3]))
            if len(samples) < 16:
                samples.append({"pixel": [i % width, i // width], "albedoAlpha": a[3], "normalAlpha": n[3]})
        if n[3] == 0:
            continue
        decoded = [value / 255 * 2 - 1 for value in n[:3]]
        length = math.sqrt(sum(value * value for value in decoded))
        assert math.isfinite(length)
        if length > 1.02 and len(upper_bound_failures) < 16:
            upper_bound_failures.append({"pixel": [i % width, i // width], "rgba": n, "decodedLength": length})
        x, y = i % width, i // width
        central = (0 < x < width - 1 and 0 < y < height - 1 and
                   all(n_pixels[(y + dy) * width + x + dx][3] == 255 for dy in (-1, 0, 1) for dx in (-1, 0, 1)))
        if n[3] == 255:
            opaque.append(length)
        (interior if central else edge).append(length)
        if a[3] == 255:
            for channel in range(3):
                rgb[channel].append(a[channel])
    return {"alphaPair": {"identical": mismatch == 0, "mismatchingPixels": mismatch,
                          "maxByteDelta": max_alpha_delta, "firstMismatchPixels": samples},
            "normalDecodedLength": {"opaquePixels": length_stats(opaque), "opaque3x3InteriorPixels": length_stats(interior),
                                    "edgeAndPartialCoveragePixels": length_stats(edge),
                                    "above1_02Samples": upper_bound_failures,
                                    "contract": "multisample averages can be shorter than unit even at alpha 255; calibrations test unit normals; production finite vectors <=1.02"},
            "opaqueAlbedoRgbSrgbBytes": [{"min": min(values) if values else None,
                                          "median": percentile(values, 0.5), "p95": percentile(values, 0.95),
                                          "max": max(values) if values else None, "count": len(values)} for values in rgb]}


def verify_depth_clipping(record, source_vertices, species, yaw):
    """Derive depth independently from decoded, scaled raw Three vertices."""
    assert record["species"] == species and record["yawDegrees"] == yaw
    assert record["actualVertexCount"] == len(source_vertices)
    assert record["marginMetres"] == 5.0
    angle = math.radians(yaw)
    # Source -> Blender: (X,-Z,Y), at (80*cos(yaw),80*sin(yaw),10.5).
    # For a horizontal orthographic view depth is independent of source Y.
    depths = [80 - math.cos(angle) * v[0] + math.sin(angle) * v[2] for v in source_vertices]
    assert depths and all(math.isfinite(depth) for depth in depths)
    expected_range = [min(depths), max(depths)]
    expected_clip = [expected_range[0] - 5.0, expected_range[1] + 5.0]
    for key, expected in (("actualCameraDepthRange", expected_range),
                          ("requestedClipRange", expected_clip), ("assignedClipRange", expected_clip)):
        actual = record[key]
        assert len(actual) == 2 and all(math.isfinite(value) for value in actual)
        assert all(abs(a - b) <= DEPTH_TOLERANCE_METRES for a, b in zip(actual, expected)), (
            f"{species}/{yaw}: {key} {actual} differs from independently derived {expected}")
    near, far = record["assignedClipRange"]
    assert near > 0 and all(near < depth < far for depth in depths)
    assert record["containsAllActualVertices"] is True
    assert record["cameraPoseUnchanged"] is True and record["projectedRootAndBoundsUnchanged"] is True
    assert set(record["channelAssignedClipRanges"]) == {"albedo", "normal"}
    assert all(interval == record["assignedClipRange"] for interval in record["channelAssignedClipRanges"].values())
    return {"species": species, "yawDegrees": yaw, "actualVertexCount": len(depths),
            "sourceDerivedCameraDepthRange": expected_range, "sourceDerivedClipRange": expected_clip,
            "actualCameraDepthRange": record["actualCameraDepthRange"],
            "requestedClipRange": record["requestedClipRange"], "assignedClipRange": record["assignedClipRange"],
            "allSourceVerticesStrictlyContained": True, "pairedActualIntervalsIdentical": True, "passed": True}


def verify(root, output, report):
    manifest_path = output / "tree-surface-impostors.json"
    manifest = json.loads(manifest_path.read_text())
    report["manifestSha256"] = sha(manifest_path)
    render = manifest["render"]
    assert manifest["source"]["commit"] == COMMIT
    assert render["blenderVersion"] == "4.0.2" and render["engine"] == "BLENDER_EEVEE"
    assert render["samples"] == 48 and render["resolutionPx"] == [512, 512]
    assert render["horizontalYawDegrees"] == YAWS
    assert render["frameWorldBoundsMetres"] == [-11, -0.5, 11, 21.5]
    assert render["camera"] == {"projection": "orthographic", "orthoScaleWorldMetres": 22.0,
                                "distanceWorldMetres": 80.0, "targetWorldMetres": [0.0, 0.0, 10.5]}
    depth_policy = render["depthClipping"]
    assert depth_policy["policy"] == "all actual branch and leaf vertices in actual camera space, per tree and yaw"
    assert depth_policy["formula"] == "depth=-(inverse(camera.matrix_world) @ (object.matrix_world @ vertex.co)).z"
    assert depth_policy["marginMetres"] == 5.0
    assert depth_policy["sourceDepthVerificationToleranceMetres"] == DEPTH_TOLERANCE_METRES
    assert depth_policy["calibrationRequestedClipRange"] == [0.1, 1000.0]
    depth_records = depth_policy["frames"]
    assert len(depth_records) == 16
    depth_by_frame = {(item["species"], item["yawDegrees"]): item for item in depth_records}
    assert len(depth_by_frame) == 16 and set(depth_by_frame) == {(species, yaw) for species in ("ash", "oak") for yaw in YAWS}
    report["depthClipping"] = {"passed": False, "toleranceMetres": DEPTH_TOLERANCE_METRES,
                               "interpretation": "Float32 depth arithmetic tolerance in metres; all original pixel gates unchanged.", "frames": []}
    assert render["leafAlphaCutoff"] == 0.5 and render["exposure"] == 0.0 and render["gamma"] == 1.0
    assert render["look"] == "None" and render["ditherIntensity"] == 0.0
    assert set(manifest["channels"]) == {"albedo", "normal"}
    assert manifest["channels"]["albedo"]["viewTransform"] == "Standard"
    assert manifest["channels"]["albedo"]["colorSpace"] == "sRGB"
    assert manifest["channels"]["normal"]["viewTransform"] == "Raw"
    assert manifest["channels"]["normal"]["colorSpace"] == "linear data (Non-Color)"
    assert "dot(normal, Geometry.Incoming)" in manifest["channels"]["normal"]["backfaces"]
    assert len(manifest["channels"]["normal"]["facingReferences"]) == 3
    assert manifest["textureCoordinates"]["blenderAssignment"] == "U_blender = U_source; V_blender = 1 - V_source"
    assert "no green inversion" in manifest["textureCoordinates"]["normalTextureChannels"]
    assert len(manifest["textureCoordinates"]["references"]) == 5
    assert manifest["sourceBytesUnchanged"] and not manifest["visualAcceptance"]
    cloud = json.loads((root / "cloud-impostors.json").read_text())
    source = json.loads((root / "cloud-manifest.json").read_text())
    glb_report = json.loads(check_file(root, manifest["sourceVerificationReport"]).read_text())
    assert glb_report["sourceCommit"] == COMMIT
    checked = [str(check_file(root, record).relative_to(root)) for record in manifest["sourcesBeforeAndAfter"]]
    assert len([path for path in checked if path.startswith("raw/")]) == 6
    assert len([path for path in checked if path.startswith("glb/")]) == 6
    report["sourceFilesVerifiedUnchanged"] = checked
    calibration_path = output / manifest["normalCalibration"]["file"]
    assert sha(calibration_path) == manifest["normalCalibration"]["sha256"]
    calibration = json.loads(calibration_path.read_text())
    assert calibration["passed"] and manifest["normalCalibration"]["passed"]
    assert calibration["tolerance"] == 0.01
    assert {(p["threeLocalAxis"], p["mode"], p["side"]) for p in calibration["probes"]} == {
        (axis, mode, side) for axis in "xyz" for mode in ("geometry", "normal-map", "normal-map-tilted") for side in (-1, 1)}
    assert len(calibration["probes"]) == 18
    for probe in calibration["probes"]:
        path = check_file(output, probe)
        image = Image.open(path)
        assert image.mode == "RGBA" and image.size == (512, 512)
        rgba = image.getpixel((256, 255))  # Blender pixel array is bottom-up.
        assert rgba[3] == 255
        actual = [value * 2 / 255 - 1 for value in rgba[:3]]
        tangent_input = [0.3, 0.4, math.sqrt(0.75)] if probe["mode"] == "normal-map-tilted" else [0, 0, 1]
        assert probe["tangentNormalInput"] == tangent_input
        object_front = [tangent_input[0], -tangent_input[1], tangent_input[2]]
        assert all(abs(a - b) < 1e-6 for a, b in zip(probe["expectedObjectFrontShadingNormal"], object_front))
        world_front = rotate_quaternion(probe["objectRotationQuaternionWxyz"], object_front)
        expected = [probe["side"] * world_front[0], probe["side"] * world_front[2], -probe["side"] * world_front[1]]
        assert max(abs(a - e) for a, e in zip(actual, expected)) <= 0.01
        assert abs(math.sqrt(sum(v * v for v in actual)) - 1) <= 0.01
        assert all(abs(a - b) < 1e-6 for a, b in zip(probe["expectedCenterNormal"], expected)) and probe["passed"]
        assert probe["objectLocalSourceNormal"] == [0, 0, 1]
        assert probe["expectedWorldFrontNormal"] == {"x": [1, 0, 0], "y": [0, 0, 1], "z": [0, -1, 0]}[probe["threeLocalAxis"]]
        plane_world = rotate_quaternion(probe["objectRotationQuaternionWxyz"], [0, 0, 1])
        assert all(abs(a - b) < 1e-6 for a, b in zip(plane_world, probe["expectedWorldFrontNormal"]))
        assert probe["sourceQuadUv"] == [[0, 0], [1, 0], [1, 1], [0, 1]]
        assert probe["blenderUvAssignment"] == manifest["textureCoordinates"]["blenderAssignment"]
    facing_probes = calibration["orthographicFacingProbes"]
    assert len(facing_probes) == 2 and {p["mode"] for p in facing_probes} == {"geometry", "normal-map"}
    magnitude = math.sqrt(0.02 ** 2 + 0.9998 ** 2)
    world_normal = [0.02 / magnitude, 0.9998 / magnitude, 0]
    expected_local = [world_normal[0], world_normal[2], -world_normal[1]]
    for probe in facing_probes:
        path = check_file(output, probe)
        image = Image.open(path)
        assert image.mode == "RGBA" and image.size == (512, 512)
        assert probe["worldPoint"] == [0, 5, 10.5] and probe["cameraPosition"] == [80, 0, 10.5]
        assert probe["orthographicTowardCamera"] == [1, 0, 0]
        assert all(abs(a - b) < 1e-6 for a, b in zip(probe["worldShadingNormal"], world_normal))
        assert probe["orthographicDot"] > 0 and probe["incorrectPerspectiveDot"] < 0
        assert abs(probe["orthographicDot"] - world_normal[0]) < 1e-6
        assert abs(probe["incorrectPerspectiveDot"] - (80 * world_normal[0] - 5 * world_normal[1])) < 1e-5
        projected = [(0.5 + 5 / 22) * 512, 256]
        assert all(abs(a - b) < 0.001 for a, b in zip(probe["projectedCenterPixelFromTopLeft"], projected))
        assert probe["samplePixelFromTopLeft"] == [round(value) for value in projected]
        rgba = image.getpixel(tuple(probe["samplePixelFromTopLeft"]))
        assert rgba[3] == 255
        decoded = [2 * value / 255 - 1 for value in rgba[:3]]
        assert max(abs(a - b) for a, b in zip(decoded, expected_local)) <= 0.01
        assert abs(math.sqrt(sum(value * value for value in decoded)) - 1) <= 0.01
        assert all(abs(a - b) < 1e-6 for a, b in zip(probe["expectedSampleNormal"], expected_local))
        assert probe["passed"]
    report["calibrationVerified"] = True
    assert {tree["species"] for tree in manifest["trees"]} == {"ash", "oak"} and len(manifest["trees"]) == 2
    file_names = set()
    problems = []
    for tree in manifest["trees"]:
        short = tree["species"]
        preset = short.title() + " Large"
        assert tree["preset"] == preset and tree["seed"] == {"ash": 29919, "oak": 23399}[short]
        assert tree["sourceCommit"] == COMMIT
        reference = next(item for item in cloud["trees"] if item["preset"] == preset)
        assert tree["sourceRawGeometry"] == reference["sourceRawGeometry"]
        assert tree["sourceTextures"] == reference["sourceTextures"]
        raw = json.loads(check_file(root, tree["sourceRawGeometry"]).read_text())
        settings = json.loads(check_file(root, tree["sourcePreset"]).read_text())
        assert raw["preset"] == preset and raw["lod"] == 0 and settings["seed"] == tree["seed"]
        assert tree["sourcePreset"]["sha256"] == source["generation"]["presetFiles"][f"{short}_large.json"]
        assert tree["sourcePreset"]["sha256"] == reference["sourcePresetSha256"]
        for record in tree["sourceTextures"]["files"]:
            check_file(root / ".work/upstream/src/app/public/textures", record)
        glb = glb_document(check_file(root, tree["sourceGlb"]))
        expected_glb = next(item for item in glb_report["models"] if item["file"] == tree["sourceGlb"]["file"])
        assert tree["sourceGlb"]["sha256"] == expected_glb["sha256"] and expected_glb["originalCloudContentVerified"]
        assert [glb["materials"][i]["pbrMetallicRoughness"]["baseColorFactor"] for i in (0, 1)] == [tree["linearBaseColorFactors"][label] for label in ("bark", "leaves")]
        for label in ("bark", "leaves"):
            tint = settings[label]["tint"]
            assert tree["linearBaseColorFactors"][label] == [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255, 1]
        model = tree["modelScale"]
        assert abs(model["scale"] * raw["sourceHeight"] - 20) < 1e-8
        assert abs(model["heightMetres"] - 20) < 0.01
        assert model["sourceUnitsArePresentationOnly"]
        source_vertices = []
        for label in ("branch", "leaves"):
            data = base64.b64decode(raw[label]["position"])
            values = struct.unpack("<" + "f" * (len(data) // 4), data)
            source_vertices.extend([v * model["scale"] for v in values[i:i + 3]] for i in range(0, len(values), 3))
            uv_data = base64.b64decode(raw[label]["uv"])
            uv = struct.unpack("<" + "f" * (len(uv_data) // 4), uv_data)
            index_data = base64.b64decode(raw[label]["indices"])
            code = "H" if raw[label]["indexType"] == "Uint16Array" else "I"
            indices = struct.unpack("<" + code * (len(index_data) // struct.calcsize(code)), index_data)
            binding = tree["uvBindings"][label]
            assert binding["sourceUvSha256"] == hashlib.sha256(uv_data).hexdigest()
            blender_uv = b"".join(struct.pack("<2f", uv[index * 2], 1 - uv[index * 2 + 1]) for index in indices)
            expected_uv_sha = hashlib.sha256(blender_uv).hexdigest()
            assert binding["blenderLoopUvSha256"] == expected_uv_sha, (
                f"{short}/{label} actual Blender loop-UV hash {binding['blenderLoopUvSha256']} differs from exact source mapping {expected_uv_sha}")
            assert binding["blenderLoopUvBeforeNormalsSha256"] == expected_uv_sha
            assert "reacquire UVMap RNA layer" in binding["readbackPolicy"]
            assert binding["loopCount"] == len(indices) and binding["assignment"] == manifest["textureCoordinates"]["blenderAssignment"]
        actual = [[min(v[i] for v in source_vertices), max(v[i] for v in source_vertices)] for i in range(3)]
        assert model["actualBoundsThreeLocalMetresXYZ"] == actual
        assert model["actualBoundsBlenderWorldMetresXYZ"] == [actual[0], [-actual[2][1], -actual[2][0]], actual[1]]
        extras = glb["nodes"][0]["extras"]
        assert extras["sourcePreset"] == preset and extras["sourceLOD"] == 0
        assert extras["sourceHeightUnits"] == raw["sourceHeight"] and extras["scaleTo20m"] == model["scale"]
        assert [frame["yawDegrees"] for frame in tree["frames"]] == YAWS
        for frame in tree["frames"]:
            assert frame["camera"] == render["camera"]
            depth_record = frame["depthClipping"]
            assert depth_record == depth_by_frame[(short, frame["yawDegrees"])]
            depth_check = verify_depth_clipping(depth_record, source_vertices, short, frame["yawDegrees"])
            report["depthClipping"]["frames"].append(depth_check)
            angle = math.radians(frame["yawDegrees"])
            assert all(abs(a - b) < 1e-4 for a, b in zip(frame["cameraPositionBlenderWorldMetres"], [80 * math.cos(angle), 80 * math.sin(angle), 10.5]))
            root_px = frame["rootPixelFromTopLeft"]
            assert abs(root_px[0] - 256) < 0.001 and abs(root_px[1] - 500.3636) < 0.001
            assert all(0 < value < 512 for value in frame["projectedModelBoundsPixelExclusiveMax"])
            projected = [(((-math.sin(angle) * v[0] - math.cos(angle) * v[2]) / 22 + 0.5) * 512,
                          (0.5 + (10.5 - v[1]) / 22) * 512) for v in source_vertices]
            expected_bounds = [min(v[0] for v in projected), min(v[1] for v in projected),
                               max(v[0] for v in projected), max(v[1] for v in projected)]
            assert all(abs(a - b) < 0.001 for a, b in zip(frame["projectedModelBoundsPixelExclusiveMax"], expected_bounds))
            images = {}
            bounds = {}
            assert set(frame["channels"]) == {"albedo", "normal"}
            for channel, record in frame["channels"].items():
                path = check_file(output, record)
                assert record["file"] not in file_names
                file_names.add(record["file"])
                image = Image.open(path)
                assert image.mode == "RGBA" and image.size == (512, 512) and record["sizePx"] == [512, 512]
                alpha = image.getchannel("A")
                assert alpha.getextrema() == (0, 255)
                bbox = alpha.getbbox()
                assert bbox and 0 < bbox[0] < bbox[2] < 512 and 0 < bbox[1] < bbox[3] < 512
                assert abs(bbox[3] - root_px[1]) < 2
                images[channel], bounds[channel] = image, bbox
            diagnostics = pixel_diagnostics(images["albedo"], images["normal"])
            report["frames"].append({"preset": preset, "seed": tree["seed"], "yawDegrees": frame["yawDegrees"],
                                     "rootPixel": root_px, "alphaBoundsPx": bounds,
                                     "channels": frame["channels"], "depthClipping": depth_check, **diagnostics})
            if not diagnostics["alphaPair"]["identical"]:
                problems.append(f"{short}/{frame['yawDegrees']}: paired alpha bytes differ")
            if diagnostics["normalDecodedLength"]["above1_02Samples"]:
                problems.append(f"{short}/{frame['yawDegrees']}: decoded normal lengths exceed 1.02")
            assert diagnostics["normalDecodedLength"]["opaque3x3InteriorPixels"]["count"] > 0
    assert len(report["depthClipping"]["frames"]) == 16
    report["depthClipping"]["passed"] = True
    assert len(file_names) == 32
    assert {str(path.relative_to(output)) for path in (output / "frames").rglob("*.png")} == file_names
    report["frameCount"] = len(file_names)
    report["problems"] = problems
    assert not problems, "; ".join(problems)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    root = args.source_root.resolve()
    output = args.out.resolve() if args.out else root / "surface-impostors"
    report = {"passed": False, "frames": [], "runtimeImported": False, "visualAcceptance": False,
              "interpretation": "Observed opaque RGB and normal-length distributions are evidence, not a brightness target or unit-normal claim for AA averages."}
    try:
        verify(root, output, report)
        report["passed"] = True
    except Exception as error:
        report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        output.mkdir(parents=True, exist_ok=True)
        (output / "verified-surface-report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({key: value for key, value in report.items() if key != "frames"}, indent=2))


if __name__ == "__main__":
    main()
