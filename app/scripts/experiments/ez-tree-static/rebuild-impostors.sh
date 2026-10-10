#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
command -v blender >/dev/null || { echo 'Blender 4.x is required' >&2; exit 2; }
[[ -s "$ROOT/raw/ash-large-lod0.json" && -s "$ROOT/raw/oak-large-lod0.json" ]] || {
  echo 'Run ./rebuild-assets.sh first to prepare pinned EZ-Tree geometry and textures.' >&2
  exit 2
}
blender -b --factory-startup -t 4 --python-exit-code 1 --python "$ROOT/render_tree_impostors.py" -- \
  --source-root "$ROOT" --out "$ROOT/impostors"
python3 "$ROOT/make_impostor_contact_sheets.py" \
  --manifest "$ROOT/impostors/tree-impostors.json" \
  --root "$ROOT/impostors" --out "$ROOT/impostors/contact"
