# Bounded tree coverage controls

Status: implemented for specification/quality review; UNCOMMITTED; new cloud experiment not run.

1. Freeze actual Oak135 source geometry, UV, source alpha/culling, camera/frame and 48-sample Blender 4.0.2 renderer; bind the previous actual diagnostic with decoded image and float hashes.
2. Reuse existing capture/PNG/inspection helpers; create four isolated modes and three channels per mode, twelve tree renders total.
3. Compute conservative tight camera depth from all actual vertices ±5m. Record containment and restore camera/materials between modes.
4. Record full-image normal gates, strict internal alpha pairing, constant radiance, known 46 offenders, baseline reproduction, and source/geometry/UV/camera preservation. Collection is evidence, never production or visual acceptance.
5. Add exact-branch cloud workflow and exact generic-cloud exclusion; retain old workflows and production gate unchanged.
6. Run only lightweight local AST/YAML/JSON/Node/source/diff checks, request parent specification and quality review, then await authorization to commit/push.
7. After an approved cloud run, inspect actual artifacts. BLEND visibility/triangle-ordering and the proposed EEVEE explanation remain unconfirmed until evidence supports them; do not import a diagnostic image into runtime.

Details and official sources: [CLIP-CONTROL-README.md](../../../app/scripts/experiments/ez-tree-static/CLIP-CONTROL-README.md).
