// Pure Node/static geometry audit. No WebGL, browser, pixels or GPU rendering.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'chill-game-assets-'));
try {
  const source = `import { GeoGameAssets } from ${JSON.stringify(path.join(app, 'src/engine/three/geography/GeoGameAssets.ts'))};
import * as THREE from 'three';
globalThis.self = globalThis;
globalThis.HTMLImageElement = class {};
globalThis.ProgressEvent = class { constructor(type, data) { this.type = type; Object.assign(this,data); } };
// Model palette pixels are already independently inspected. This stub avoids
// raster decoding while preserving genuine parsed UVs and texture bindings.
globalThis.createImageBitmap = async () => ({width:256,height:256,close(){}});
const nativeFetch = globalThis.fetch;
globalThis.fetch = async input => {
 const url = String(input instanceof Request ? input.url : input);
 if (url.startsWith('blob:')) return nativeFetch(input);
 const relative = url.replace(/^undefined|^\\//g,'');
 const bytes = await fs.readFile(path.join(${JSON.stringify(path.join(app, 'public'))},relative));
 return new Response(bytes);
};
const assets = new GeoGameAssets({texture:new THREE.Texture(),minTile:new THREE.Vector2()});
await assets.ready;
const templates = [...assets.templates].map(([name,t])=>{t.geometry.computeBoundingBox(); const b=t.geometry.boundingBox; return {name, triangles:t.geometry.getAttribute('position').count/3,min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray(),roofTop:t.geometry.userData.roofTop};});
if (assets.loadedAssets!==19 || templates.length!==18) throw new Error('Wrong source/template counts');
for (const t of templates.filter(t=>t.name.startsWith('house'))) if (t.min.some(v=>!Number.isFinite(v)) || t.max[1]<5 || t.max[1]*1.15>12.5 || t.size[0]<5 || t.size[2]<6) throw new Error('House proportions invalid:'+JSON.stringify(t));
const roofChecks = [];
for (const [name,t] of assets.templates) if (name.startsWith('house')) {
 const p=t.geometry.getAttribute('position'), {roofVertexStart:start,roofVertexCount:count,roofTop:top}=t.geometry.userData;
 const ridge=[];
 for(let i=start;i<start+count;i++) if(Math.abs(p.getY(i)-top)<.02) ridge.push(new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)));
 const box=new THREE.Box3().setFromPoints(ridge), span=box.getSize(new THREE.Vector3());
 if(span.z<6 || span.x>.08) throw new Error('Roof ridge is not one continuous depth ridge:'+name+':'+JSON.stringify(span));
 roofChecks.push({name, ridgeSpan:span.toArray()});
}
const placementChecks=[], lodChecks=[];
for(const distant of [false,true]) for(const footprint of [0.01,1000]) {
 const parent = new THREE.Group(), features=[];
 for(let i=0;i<60;i++) {const x=i*31,z=i*17;features.push({id:String(i),kind:'building',tags:{},holes:[],bounds:[x-footprint/2,z-footprint/2,x+footprint/2,z+footprint/2],coordinates:[{x:x-footprint/2,z:z-footprint/2},{x:x+footprint/2,z:z-footprint/2},{x:x+footprint/2,z:z+footprint/2},{x:x-footprint/2,z:z+footprint/2}]});}
 const ground=47;assets.addHouses(parent,features,()=>ground,distant);
 const variants=new Set();
 parent.traverse(mesh=>{if(!mesh.isInstancedMesh || !mesh.userData.gameAsset.startsWith('house')) return;
  const name=mesh.userData.gameAsset;variants.add(name.replace('houseLod','house'));
  const matrix=new THREE.Matrix4(), vector=new THREE.Vector3(), p=mesh.geometry.getAttribute('position');
  let minTop=Infinity,maxTop=-Infinity,minRoof=Infinity,maxRoof=-Infinity;
  for(let i=0;i<mesh.count;i++) {mesh.getMatrixAt(i,matrix);let top=-Infinity;
   for(let j=0;j<p.count;j++) {vector.fromBufferAttribute(p,j).applyMatrix4(matrix);top=Math.max(top,vector.y-ground);}
   const roofTop=mesh.geometry.userData.roofTop*new THREE.Vector3().setFromMatrixScale(matrix).y+matrix.elements[13]-ground;
   if(top<5-1e-5 || top>12+1e-5 || roofTop<5-1e-5) throw new Error('Actual placed house height outside5–12m:'+JSON.stringify({name,footprint,distant,top,roofTop}));
   minTop=Math.min(minTop,top);maxTop=Math.max(maxTop,top);minRoof=Math.min(minRoof,roofTop);maxRoof=Math.max(maxRoof,roofTop);
  }
  placementChecks.push({name,distant,footprint,minTop,maxTop,minRoof,maxRoof,count:mesh.count});
 });
 if(variants.size!==3) throw new Error('Audit did not exercise all three actual variants');
 if(!distant) parent.traverse(full=>{
  if(!full.isInstancedMesh || full.userData.houseDetail!=='full') return;
  const low=full.parent.children.find(mesh=>mesh.userData.gameAsset===full.userData.gameAsset.replace('house','houseLod'));
  if(!low || low.count!==full.count || low.material!==full.material || JSON.stringify([...low.instanceMatrix.array])!==JSON.stringify([...full.instanceMatrix.array])) throw new Error('LOD changed source matrices/palette');
  const before=full.geometry.boundingBox, after=low.geometry.boundingBox;
  if(before.min.distanceTo(after.min)>1e-5 || before.max.distanceTo(after.max)>1e-5) throw new Error('LOD changed house silhouette bounds');
  assets.setHouseDetail(parent,full.boundingSphere.center);
  if(!full.visible || low.visible) throw new Error('Close camera did not select full house geometry');
  assets.setHouseDetail(parent,full.boundingSphere.center.clone().add(new THREE.Vector3(0,1000,0)));
  if(full.visible || !low.visible) throw new Error('Map camera did not select low house geometry');
  lodChecks.push({name:full.userData.gameAsset,footprint,fullTriangles:full.geometry.getAttribute('position').count/3,lowTriangles:low.geometry.getAttribute('position').count/3,identicalMatrices:true,identicalPalette:true,identicalBounds:true,actualDistanceSelection:true});
 });
 const countBefore=assets.housesPlaced; assets.release(parent);
 if(assets.housesPlaced!==countBefore-features.length) throw new Error('LOD release duplicated geographic house counts');
}
const batch = new THREE.Group(); assets.addBatch(batch,'tree_oak',[{x:12,y:7,z:30,height:15,yaw:.3,variant:0}]);
if (batch.children.length!==1 || !batch.children[0].isInstancedMesh || !batch.children[0].userData.sharedGeometry || batch.children[0].instanceMatrix.count!==1) throw new Error('Shared instance batch failed');
console.log(JSON.stringify({sourceAssets:assets.loadedAssets,bytes:assets.assetBytes,templates,roofChecks,placementChecks,lodChecks,staticBatchVerified:true,textureRasterization:'stubbed; not a visual check'},null,2));
assets.dispose();`;
  const entry = path.join(app, '.game-asset-audit.mjs');
  await fs.writeFile(entry, `import fs from 'node:fs/promises';import path from 'node:path';\n${source}`);
  try {
    const output = path.join(temporary,'audit.mjs');
    await build({ entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:output,define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent' });
    await import(output);
  } finally { await fs.rm(entry,{force:true}); }
} finally { await fs.rm(temporary,{recursive:true,force:true}); }
