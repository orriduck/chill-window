#!/usr/bin/env python3
"""Build converter controls for rare roof/part attributes just outside 1.2 km.

These explicit source examples are QA controls only. They are not included in
the Hudson 1.2 km corridor batch because their source footprints fall outside
the selection buffer.
"""
from __future__ import annotations
import argparse, importlib.util, json, subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("hudson_osm2world_prepare",HERE/"prepare.py")
prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--osm2world',default=prep.os.environ.get('OSM2WORLD_BIN'))
    ap.add_argument('--output',type=Path,default=HERE/'output/controls')
    args=ap.parse_args()
    if not args.osm2world: raise SystemExit('Pass --osm2world or set OSM2WORLD_BIN')
    world=json.loads(prep.WORLD.read_text()); overlay=json.loads(prep.BUILDINGS.read_text())
    features={f['id']:f for f in overlay['features']}
    tx=prep.transform_factory(); route=prep.route_geometry(world['route']['points'],tx)
    controls=[]
    # Source-rich church record, 1,335.587 m from the route: outside production buffer.
    f=features['overture/b00509c4-82e0-47d0-8708-cc9c8465530b']
    coords=prep.source_rings(f)[0]
    poly=prep.polygon_geometry(coords[0],coords[1],tx); distance=poly.Distance(route)
    controls.append({'name':'roof-appearance-b00509c4','records':[{
        'feature':f,'rings':coords,'height':f['buildingHeight']}],
        'distanceMetres':distance,'expectedSourceIds':[f['id']],
        'note':'QA only, outside the 1,200 m production corridor. Height is Microsoft ML estimate; roof/facade fields are retained Overture attributes.'})
    parent_id='overture/089ff554-8a84-4f2d-a845-70e66cb144fa'
    parent=features[parent_id]
    part=next(p for p in overlay['buildingParts'] if p['parentFeatureId']==parent_id)
    part_coordinates=part['geometry']['coordinates']
    part_poly=prep.polygon_geometry(part_coordinates[0],part_coordinates[1:],tx)
    parent_rings=prep.source_rings(parent)[0]
    parent_poly=prep.polygon_geometry(parent_rings[0],parent_rings[1],tx)
    records=[{'feature':parent,'rings':parent_rings,'height':parent['buildingHeight']}]
    part_feature={'id':'building_part/'+part['id'],'kind':'building_part','tags':{},
        'overtureProperties':part.get('properties',{}),
        'provenance':{'geometry':{'dataset':'Overture Maps','gersId':part['id']}},
        'parentFeatureId':parent_id}
    records.append({'feature':part_feature,'rings':(part_coordinates[0],part_coordinates[1:]),
        'height':part['buildingHeight'],'buildingPart':part})
    controls.append({'name':'part-minheight-089ff554','records':records,
        'distanceMetres':part_poly.Distance(route),'expectedSourceIds':[parent_id,'building_part/'+part['id']],
        'note':'QA only, part footprint is 1,254.94 m from the route, outside the 1,200 m production corridor. Source part has height=48 m, min_height=24 m, facade_material=brick; parent source height is 24 m.'})
    summaries=[]
    for control in controls:
        out=args.output/control['name'];out.mkdir(parents=True,exist_ok=True)
        osm=out/'buildings.osm'; raw=out/'converter-output.glb'; glb=out/'buildings.glb'
        source_map,expected=prep.write_osm(control['records'],osm)
        command=[args.osm2world,f'--input={osm}',f'--output={raw}','--lod=2']
        result=subprocess.run(command,cwd=out,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (out/'converter.log').write_text(result.stdout)
        if result.returncode: raise SystemExit(f"converter failed for {control['name']}; see converter.log")
        raw_sha,raw_bytes=prep.digest(raw),raw.stat().st_size
        textures=prep.externalize_glb(raw,args.output/'textures',destination=glb);raw.unlink()
        overrides=prep.apply_source_roof_overrides(glb,source_map)
        analysis=prep.analyze_glb(glb,expected)
        if control['name']=='part-minheight-089ff554':
            part_record=next(r for r in source_map if r['geometryRole']=='building_part')
            if not part_record['outputNodeBinding'].startswith('child_geometry_of:'):
                raise ValueError('expected the source part to remain associated with the source parent')
            if not any(b['min'][1] >= 23.9 and b['max'][1] >= 47.9 for b in analysis['meshPrimitiveBoundsXYZMetres']):
                raise ValueError('OSM2World output has no mesh in the source part min_height/height band')
        if {r['sourceId'] for r in source_map}!=set(control['expectedSourceIds']): raise ValueError('control source IDs changed')
        manifest={'name':control['name'],'scope':'out-of-corridor converter QA control; never part of the 1,200 m batch',
            'distanceToFRArouteMetres':control['distanceMetres'],'productionCorridorBufferMetres':prep.CORRIDOR_M,
            'note':control['note'],'inputOsmSha256':prep.digest(osm),'inputOsmBytes':osm.stat().st_size,
            'converterCommand':command,'converterOutputSha256':raw_sha,'converterOutputBytes':raw_bytes,
            'outputGlbSha256':prep.digest(glb),'outputGlbBytes':glb.stat().st_size,'textureFiles':textures,
            'sourceMaterialOverrides':overrides,'sourceRecords':source_map,'analysis':analysis}
        prep.save(out/'manifest.json',manifest)
        summaries.append({k:manifest[k] for k in ('name','scope','distanceToFRArouteMetres','note','outputGlbSha256','outputGlbBytes','converterOutputSha256','converterOutputBytes','sourceMaterialOverrides')}
            | {'sourceIds':[r['sourceId'] for r in source_map], 'triangles':analysis['triangles'],
               'materials':analysis['materials'],'boundsXYZMetres':analysis['boundsXYZMetres'],
               'meshPrimitiveBoundsXYZMetres':analysis['meshPrimitiveBoundsXYZMetres']})
        print(control['name'],json.dumps({'sourceIds':analysis['sourceNodeIds'],'triangles':analysis['triangles'],
            'materials':analysis['materials'],'bytes':glb.stat().st_size,'sha256':prep.digest(glb)},ensure_ascii=False))
    prep.save(args.output/'controls-summary.json',{'schemaVersion':1,'converter':'OSM2World 0.4.0 MIT',
        'sourceOverlaySha256':prep.digest(prep.BUILDINGS),'worldSha256':prep.digest(prep.WORLD),
        'note':'These controls are intentionally outside the 1,200 m batch; they are source-attribute converter tests only.',
        'controls':summaries})

if __name__=='__main__':main()
