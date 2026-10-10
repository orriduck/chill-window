#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BLENDER_BIN="${BLENDER_BIN:-blender}"
python3 "$ROOT/download_pine_source.py"
python3 "$ROOT/prepare_textures.py"
"$BLENDER_BIN" --background "$ROOT/pine_tree_01_1k.blend" --python "$ROOT/export_pine_native_lod2.py"
python3 "$ROOT/compact_pine_native_glb.py"
