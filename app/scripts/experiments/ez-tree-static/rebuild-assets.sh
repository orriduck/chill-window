#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMIT=dcf309bd86bd521083d9c70f01f2de45fdc7c457
WORK="$ROOT/.work"
rm -rf "$WORK"
mkdir -p "$WORK"
git init -q "$WORK/upstream"
git -C "$WORK/upstream" remote add origin https://github.com/dgreenheck/ez-tree.git
git -C "$WORK/upstream" fetch --depth=1 origin "$COMMIT"
git -C "$WORK/upstream" checkout -q --detach FETCH_HEAD
actual="$(git -C "$WORK/upstream" rev-parse HEAD)"
[[ "$actual" == "$COMMIT" ]]
mkdir -p "$WORK/run/src" "$WORK/run/node_modules/three/build"
cp -a "$WORK/upstream/src/lib" "$WORK/run/src/lib"
python3 - "$WORK/run/src/lib" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1])
for p in root.rglob('*.js'):
    s=p.read_text()
    def fix(m):
        pre,path,quote=m.groups()
        candidate=p.parent/path
        if candidate.suffix:
            if candidate.suffix=='.json' and " with { type: 'json' }" not in m.string[m.start():m.end()+32]:
                return pre+path+quote+" with { type: 'json' }"
            return m.group(0)
        if (p.parent/(path+'.js')).exists(): return pre+path+'.js'+quote
        if (p.parent/(path+'.json')).exists(): return pre+path+'.json'+quote+" with { type: 'json' }"
        return m.group(0)
    s=re.sub(r"(from\s+['\"])(\.[^'\"]+)(['\"])",fix,s)
    s=re.sub(r"from (['\"][^'\"]+\.json)(['\"])(?!\s+with)",r"from \1\2 with { type: 'json' }",s)
    p.write_text(s)
PY
cat > "$WORK/run/node_modules/three/package.json" <<'JSON'
{"type":"module","exports":"./build/three.module.js"}
JSON
curl -L --fail --silent --show-error https://raw.githubusercontent.com/mrdoob/three.js/r167/build/three.module.js -o "$WORK/run/node_modules/three/build/three.module.js"
echo '5289ca2dfde8572bd7715b9fa2ca929db12bae87e9a2cb53e431662df7039506  '"$WORK/run/node_modules/three/build/three.module.js" | sha256sum -c -
cp "$ROOT/export-geometry.mjs" "$WORK/run/export-geometry.mjs"
mkdir -p "$ROOT/raw" "$ROOT/glb" "$ROOT/previews"
(cd "$WORK/run" && EZTREE_OUTPUT_DIR="$ROOT" node export-geometry.mjs)
python3 "$ROOT/make-glb.py"
for pair in \
  'fb630c9f4ae0e344c884f0380d23b35bd93af8924dc0244190b83811634d4f50 src/lib/presets/ash_large.json' \
  'da60d7104796e5dc099effe778f22e055a8365549e2eb6cfa6fb0bb6a8190d6b src/lib/presets/oak_large.json' \
  '5ec987db3829a839856c32c79b18a33a78f209e911cad55c65abfb77f30e2d29 src/app/public/textures/leaves/ash.png' \
  '24451223cf396d22910a4932b8bb996a7274e63d81e24128c96a430ab67822b1 src/app/public/textures/leaves/oak.png'; do
  read -r sha path <<< "$pair"
  (cd "$WORK/upstream" && echo "$sha  $path" | sha256sum -c -)
done
