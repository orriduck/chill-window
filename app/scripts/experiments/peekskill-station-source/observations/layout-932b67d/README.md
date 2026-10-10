# Actual Peekskill layout audit

Cloud run https://github.com/orriduck/chill-window/actions/runs/38053050173,
commit `932b67d7d554865ed698603b1a625ad72d4b6376`, geometry job passed on
2026-10-10. These are downloaded output files, not locally regenerated images.

17 source features, 9 valid polygon/line features, all 52 source vertices in
retained scene crop. Parent visually inspected the PNG: platforms, open canopy
outlines, station house and crossing topology align with the overhead image.
Overlay SHA `63d5b9c4f0e954f65443c41c1c3a8568908fd315afbe9a2445824b96e92b56d8`
was verified against actual validation metadata after downloading.

Yellow = active platforms, orange = open canopy footprints, magenta = station
house, cyan = crossing paths, green = entrances. Source tags, dimensions,
provenance and caveats remain in the exact JSON outputs. This plan-view audit
is not a reconstructed station mesh or proof of roof/bridge height. The point
job in the same cloud run is a separate acceptance step.
