# Actual source point observations

Successful cloud run https://github.com/orriduck/chill-window/actions/runs/38053050173,
commit `932b67d7d554865ed698603b1a625ad72d4b6376`, 2026-10-10. Exact downloaded
JSON outputs are preserved here. Parent checked source hashes/byte counts,
per-subset source binding and all reported point counts against raw rows.
The 2018 observed LAZ SHA is now pinned in the source selection for future runs.

| Survey year from title | OSM source ID | Class 1 | Class 6 | Nearby class 2 |
|---|---|---:|---:|---:|
| 2022 | osm/way/285221615 | 0 | 0 | 0 |
| 2022 | osm/way/1307801003 | 2781 | 0 | 6018 |
| 2022 | osm/way/1307801004 | 1953 | 0 | 4031 |
| 2018 | osm/way/285221615 | 2549 | 0 | 4249 |
| 2018 | osm/way/1307801003 | 2787 | 0 | 7910 |
| 2018 | osm/way/1307801004 | 1211 | 0 | 5307 |

2022 compound CRS: NAD83(2011)/UTM18 + NAVD88/Geoid18, metres.
2018 compound CRS: NAD83(2011)/Conus Albers + NAVD88/Geoid12B, metres.
The two height realizations and survey epochs must remain distinct. All retained
structure points are class 1, unclassified; no class-6 roof points were found.
Dominant low-slope plane clusters are observations, not accepted roof geometry.
Plan/section distribution inspection and roof validation are still pending.
Source XYZ values and return metadata are unchanged; no runtime mesh is derived.
