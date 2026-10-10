"""Cloud-only source point observations for the actual Peekskill structures.

Keep classification/datum/coverage and source timestamps explicit. Class 1 is
not classified roof. This probe emits observations and planar clusters, never
an automatically accepted station mesh or a guessed canopy height.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import urllib.request

import laspy
import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, box
from shapely import contains_xy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OUT = HERE / "output/lidar"
OUT.mkdir(parents=True, exist_ok=True)
selection = json.loads((HERE / "lidar-selection.json").read_text())
overlay_path = REPO / "app/public/geodata/hudson/buildings.json"
assert hashlib.sha256(overlay_path.read_bytes()).hexdigest() == "0d5bd68c040b42f99138fbdb768167ef22e8c48b5442fe0bf7d889f7347bd54f"
overlay = json.loads(overlay_path.read_text())
features = {feature["id"]: feature for feature in overlay["features"] if feature["id"] in selection["sourceBuildingIds"]}
assert len(features) == 3


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def clusters(points, xy_scale, z_scale):
    """Describe dominant source planes; no plane is relabelled as roof here."""
    if z_scale is None or len(points) < 20:
        return {"status": "no_declared_vertical_units_or_fewer_than_20_points", "planes": []}
    xyz = np.asarray(points, dtype=float)[:, :3].copy()
    origin = np.median(xyz, axis=0)
    xyz[:, :2] = (xyz[:, :2] - origin[:2]) * xy_scale
    xyz[:, 2] *= z_scale
    remaining = np.arange(len(xyz))
    rng = np.random.default_rng(42)
    planes = []
    for _ in range(6):
        if len(remaining) < 20:
            break
        data = xyz[remaining]
        best = np.zeros(len(data), dtype=bool)
        for _ in range(200):
            sample = data[rng.choice(len(data), 3, replace=False)]
            design = np.column_stack([sample[:, :2], np.ones(3)])
            if abs(np.linalg.det(design)) < 0.1:
                continue
            coefficients = np.linalg.solve(design, sample[:, 2])
            # These are low-slope surfaces; steep stair/facade observations
            # remain in the raw source subset rather than becoming roofs.
            if np.linalg.norm(coefficients[:2]) > 1:
                continue
            residual = np.abs(data[:, 2] - np.column_stack([data[:, :2], np.ones(len(data))]) @ coefficients)
            mask = residual <= 0.08
            if mask.sum() > best.sum():
                best = mask
        if best.sum() < max(20, int(len(xyz) * 0.02)):
            break
        fit_points = data[best]
        design = np.column_stack([fit_points[:, :2], np.ones(len(fit_points))])
        coefficients, *_ = np.linalg.lstsq(design, fit_points[:, 2], rcond=None)
        residual = fit_points[:, 2] - design @ coefficients
        planes.append({"pointCount": len(fit_points), "fractionOfClassSubset": len(fit_points) / len(xyz),
                       "xyOriginSourceUnits": origin[:2].tolist(), "xyUnits": "metres relative to source origin",
                       "equation": "zMetres = a*xMetres + b*yMetres + c", "coefficients": coefficients.tolist(),
                       "zMetresRange": [float(fit_points[:, 2].min()), float(fit_points[:, 2].max())],
                       "xyExtentMetres": [float(fit_points[:, 0].min()), float(fit_points[:, 1].min()), float(fit_points[:, 0].max()), float(fit_points[:, 1].max())],
                       "residualRMSEMetres": float(np.sqrt(np.mean(residual ** 2)))})
        remaining = remaining[~best]
    return {"status": "source_plane_clusters_not_accepted_roofs", "toleranceMetres": 0.08, "planes": planes}


report = {"scope": "Actual station point-cloud coverage/classification/plane observations; no runtime mesh or invented heights", "catalogueQuery": selection["query"], "tiles": []}
for tile in selection["selectedTiles"]:
    path = OUT / Path(tile["downloadURL"]).name
    request = urllib.request.Request(tile["downloadURL"], headers={"User-Agent": "ChillWindowSourceProbe/1.0 (+https://github.com/orriduck/chill-window)"})
    with urllib.request.urlopen(request, timeout=90) as response, path.open("wb") as output:
        while block := response.read(1024 * 1024):
            output.write(block)
    assert path.stat().st_size == tile["sizeInBytes"], "Official source byte count changed"
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if tile.get("observedSha256"):
        assert sha == tile["observedSha256"], "Previously observed actual source bytes changed"
    with laspy.open(path) as reader:
        crs = reader.header.parse_crs()
        assert crs is not None, "No source CRS; refuse coordinate/height assumptions"
        transform = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
        source_bounds = box(reader.header.mins[0], reader.header.mins[1], reader.header.maxs[0], reader.header.maxs[1])
        axes = [{"name": axis.name, "unit": axis.unit_name, "unitConversionFactor": axis.unit_conversion_factor} for axis in crs.axis_info]
        assert len(axes) >= 2 and axes[0]["unitConversionFactor"] == axes[1]["unitConversionFactor"]
        xy_scale = axes[0]["unitConversionFactor"]
        z_scale = axes[2]["unitConversionFactor"] if len(axes) >= 3 else None
        polygons = {}
        coverage = {}
        for feature_id, feature in features.items():
            outer = [transform.transform(*point)[:2] for point in feature["coordinates"]]
            holes = [[transform.transform(*point)[:2] for point in ring] for ring in feature.get("holes", [])]
            polygon = Polygon(outer, holes)
            assert polygon.is_valid and polygon.area > 0
            polygons[feature_id] = polygon
            coverage[feature_id] = polygon.intersection(source_bounds).area / polygon.area
        subsets = {key: [] for key in features}
        ground = {key: [] for key in features}
        hist = Counter()
        for points in reader.chunk_iterator(200000):
            x, y, z = np.asarray(points.x), np.asarray(points.y), np.asarray(points.z)
            classifications = np.asarray(points.classification)
            returns, return_counts = np.asarray(points.return_number), np.asarray(points.number_of_returns)
            hist.update(dict(zip(*[values.tolist() for values in np.unique(classifications, return_counts=True)])))
            for key, polygon in polygons.items():
                inside = contains_xy(polygon, x, y)
                chosen = inside & np.isin(classifications, [1, 6])
                subsets[key].extend(np.column_stack([x[chosen], y[chosen], z[chosen], classifications[chosen], returns[chosen], return_counts[chosen]]).tolist())
                nearby = (classifications == 2) & contains_xy(polygon.buffer(8 / xy_scale), x, y) & ~inside
                ground[key].extend(z[nearby].tolist())
        metadata = {"title": tile["title"], "catalogueId": tile["sourceId"], "publicationDate": tile["publicationDate"], "surveyYearFromTitle": tile["surveyYearFromTitle"],
                    "acquisitionDateInterval": tile["acquisitionDateInterval"], "dateInterpretation": tile["dateInterpretation"],
                    "checksumPolicy": tile["checksumPolicy"], "sourceUrl": tile["downloadURL"],
                    "bytes": path.stat().st_size, "sha256": sha, "sourceCRSWKT": crs.to_wkt(), "axes": axes,
                    "headerBoundsSourceUnits": {"minimum": reader.header.mins.tolist(), "maximum": reader.header.maxs.tolist()},
                    "pointCount": reader.header.point_count, "classificationCounts": dict(sorted(hist.items())), "footprints": []}
        for key, rows in subsets.items():
            raw = np.asarray(rows, dtype=float).reshape((-1, 6))
            classified = raw[raw[:, 3] == 6] if len(raw) else raw
            unclassified = raw[raw[:, 3] == 1] if len(raw) else raw
            item = {"sourceId": key, "headerBoundsIntersectionFraction": coverage[key],
                    "coverageMethod": "LAS header XY bounding rectangle only; no point-density or surveyed-footprint completeness inferred", "class6BuildingPoints": len(classified), "class1UnclassifiedPoints": len(unclassified),
                    "sourceHeightAttribute": features[key]["buildingHeight"], "nearbyClass2GroundPoints": len(ground[key]),
                    "groundSourceZQuantiles": np.quantile(ground[key], [0.1, 0.5, 0.9]).tolist() if ground[key] else None,
                    "groundZUnits": "unchanged source CRS vertical units", "verticalUnitConversionToMetres": z_scale,
                    "classifiedPlaneObservations": clusters(classified, xy_scale, z_scale), "unclassifiedPlaneObservations": clusters(unclassified, xy_scale, z_scale),
                    "interpretation": "Class 6 denotes building observations. Class 1 is not classified roof; footprint clipping can include plants, platforms, bridge or other structures. Plane clusters are not accepted roof geometry."}
            metadata["footprints"].append(item)
            name = f'{tile["sourceId"]}-{key.replace("/", "-")}-points.json'
            write(OUT / name, {"sourceTileSha256": sha, "sourceCRSWKT": crs.to_wkt(), "axisUnits": axes,
                              "pointFields": ["x", "y", "z", "classification", "returnNumber", "numberOfReturns"],
                              "interpretation": item["interpretation"], "footprint": features[key]["coordinates"], "points": rows})
        report["tiles"].append(metadata)
    # Keep heavy raw LAZ only on the runner; publish bounded observations.
    path.unlink()
write(OUT / "station-point-observations.json", report)
print(json.dumps({"tiles": len(report["tiles"]), "footprintObservations": sum(len(tile["footprints"]) for tile in report["tiles"])}, indent=2))
