#!/usr/bin/env python3
"""Rebuild the bundled, CC0 Scots-pine close-range GLB from its source archive.

Requires Node/npm and @gltf-transform/cli@4.5.1. Both source GLBs are vendored
beside this script. If the pinned CLI is already installed, conversion is offline;
the default npx command may download the CLI package on first use.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    "pine": {
        "source": ROOT / "scripts/tree-assets/mature-scots-pine-source.glb",
        "output": ROOT / "public/models/trees/mature-scots-pine-lod.glb",
        "sourceSha256": "16dfad1920598df1fc4acb06fee00a581bf25edf91206e1da089632c723eae6a",
        "outputSha256": "133a9653917dd511ab0af062f997946cfd966dc09b4d9b8c381c671866c962b6",
        "ratio": "0.1", "error": "0.02",
    },
    "oak": {
        "source": ROOT / "scripts/tree-assets/oak-street-tree-source.glb",
        "output": ROOT / "public/models/trees/oak-street-tree-lod.glb",
        "sourceSha256": "a02698ef246d8005110c291c510b8f7f397ae26e69414aa538cc4993b06256dd",
        "outputSha256": "d65f2515da582174c0321cb9a349f119496ded36633454e29f3666ac3c0fdc02",
        "ratio": "0.05", "error": "0.03",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset", choices=ASSETS, help="asset variant to rebuild")
    parser.add_argument("--cli", default="npx --yes @gltf-transform/cli@4.5.1",
                        help="pinned glTF Transform CLI command")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    asset = ASSETS[args.asset]
    source = asset["source"]
    output = args.output or asset["output"]
    if not source.is_file():
        raise SystemExit(f"Missing vendored source model: {source}")
    actual_source = sha256(source)
    if actual_source != asset["sourceSha256"]:
        raise SystemExit(f"Source checksum mismatch: {actual_source}")
    cli = args.cli.split()
    output.parent.mkdir(parents=True, exist_ok=True)
    command = cli + [
        "optimize", str(source), str(output),
        "--simplify-ratio", asset["ratio"], "--simplify-error", asset["error"],
        "--compress", "false", "--texture-compress", "false",
        "--palette", "false", "--instance", "false", "--join", "true",
    ]
    subprocess.run(command, check=True)
    actual_output = sha256(output)
    if output.resolve() == asset["output"].resolve() and actual_output != asset["outputSha256"]:
        raise SystemExit(f"Processed checksum differs from reviewed asset: {actual_output}")
    print(json.dumps({
        "asset": args.asset, "source": str(source.relative_to(ROOT)), "sourceSha256": actual_source,
        "output": str(output), "outputSha256": actual_output,
        "outputBytes": output.stat().st_size, "command": command,
    }, indent=2))


if __name__ == "__main__":
    main()

