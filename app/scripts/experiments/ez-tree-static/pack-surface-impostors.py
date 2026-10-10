#!/usr/bin/env python3
"""Losslessly pack verified albedo/normal views and independently read every cell."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "surface-impostors")
    args = parser.parse_args()
    source = args.out.resolve()
    manifest_path = source / "tree-surface-impostors.json"
    manifest = json.loads(manifest_path.read_text())
    report_path = source / "verified-surface-report.json"
    report = json.loads(report_path.read_text())
    assert report["passed"] and report["frameCount"] == 32
    assert report["manifestSha256"] == sha(manifest_path.read_bytes())
    out = source / "runtime"
    out.mkdir(parents=True, exist_ok=True)
    records = []
    for tree in manifest["trees"]:
        for channel in ("albedo", "normal"):
            atlas = Image.new("RGBA", (2048, 1024), (0, 0, 0, 0))
            cells = []
            for index, frame in enumerate(tree["frames"]):
                assert frame["yawDegrees"] == index * 45
                record = frame["channels"][channel]
                path = source / record["file"]
                assert sha(path.read_bytes()) == record["sha256"] and path.stat().st_size == record["bytes"]
                image = Image.open(path)
                assert image.mode == "RGBA" and image.size == (512, 512)
                x, y = index % 4 * 512, index // 4 * 512
                atlas.paste(image, (x, y))  # No alpha mask: copies all RGBA bytes.
                cells.append({"yawDegrees": frame["yawDegrees"], "sourceFile": record["file"],
                              "sourcePngSha256": record["sha256"], "sourcePixelSha256": sha(image.tobytes()),
                              "rectPxFromTopLeft": [x, y, 512, 512], "rootPixelInFrame": frame["rootPixelFromTopLeft"],
                              "rootUvFromTopLeft": [v / 512 for v in frame["rootPixelFromTopLeft"]],
                              "projectedModelBoundsPixelExclusiveMax": frame["projectedModelBoundsPixelExclusiveMax"],
                              "actualAlphaBoundsPx": image.getchannel("A").getbbox()})
            path = out / f"{tree['species']}-{channel}-8-view-atlas.png"
            atlas.save(path, compress_level=9)
            decoded = Image.open(path)
            assert decoded.mode == "RGBA" and decoded.size == (2048, 1024)
            for cell in cells:
                x, y, w, h = cell["rectPxFromTopLeft"]
                readback = sha(decoded.crop((x, y, x + w, y + h)).tobytes())
                assert readback == cell["sourcePixelSha256"]
                cell["atlasReadbackPixelSha256"] = readback
            records.append({"species": tree["species"], "preset": tree["preset"], "seed": tree["seed"],
                            "channel": channel, "channelDescription": manifest["channels"][channel],
                            "image": {"file": path.name, "bytes": path.stat().st_size, "sha256": sha(path.read_bytes()),
                                      "pixelSha256": sha(decoded.tobytes())},
                            "sizePx": [2048, 1024], "frames": cells, "sourceRawGeometry": tree["sourceRawGeometry"],
                            "sourceGlb": tree["sourceGlb"], "sourceTextures": tree["sourceTextures"],
                            "linearBaseColorFactors": tree["linearBaseColorFactors"], "uvBindings": tree["uvBindings"],
                            "modelScale": tree["modelScale"]})
    assert len(records) == 4
    runtime = {"schemaVersion": 1, "sourceManifestSha256": sha(manifest_path.read_bytes()),
               "verificationReportSha256": sha(report_path.read_bytes()), "source": manifest["source"],
               "sourceVerificationReport": manifest["sourceVerificationReport"],
               "render": manifest["render"], "channels": manifest["channels"], "normalCalibration": manifest["normalCalibration"],
               "textureCoordinates": manifest["textureCoordinates"],
               "frameCount": 32, "atlasCount": 4, "sourcePixelsUnchanged": True, "allCellsReadbackVerified": True,
               "sampling": {"framePx": 512, "columns": 4, "rows": 2, "maxMipLevel": 8,
                            "edgePolicy": "independent power-of-two cells; runtime clamps selected-cell bilinear UVs to mip texel centers and caps at mip8",
                            "normalFilter": "linear data; normalize decoded alpha-weighted shading-normal direction after sampling"},
               "runtimeImported": False, "visualAcceptance": False, "caveat": manifest["caveat"], "atlases": records}
    (out / "tree-surface-atlases.json").write_text(json.dumps(runtime, indent=2) + "\n")
    print("Packed four 2048x1024 RGBA atlases; all 32 source cells match lossless pixel readback")


if __name__ == "__main__":
    main()
