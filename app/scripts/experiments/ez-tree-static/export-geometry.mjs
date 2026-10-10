import * as THREE from 'three';
import { Tree } from './src/lib/tree.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const out=process.env.EZTREE_OUTPUT_DIR + '/raw'; mkdirSync(out,{recursive:true});
const details=[{}, {sectionStride:3,segmentFactor:0.75,leafStride:2,leafScale:1.25}, {sectionStride:6,segmentFactor:0.4,leafStride:2,leafScale:1.3,billboard:'single'}];
for(const preset of ['Ash Large','Oak Large']){
 const tree=new Tree(); tree.loadPreset(preset);
 const bounds=new THREE.Box3().setFromObject(tree); const height=bounds.max.y-bounds.min.y;
 for(let i=0;i<details.length;i++){
  const g=tree.createGeometry(details[i]);
  const record={preset,lod:i,sourceHeight:height,branch:serialize(g.branches),leaves:serialize(g.leaves)};
  writeFileSync(`${out}/${preset.toLowerCase().replace(' ','-')}-lod${i}.json`,JSON.stringify(record));
 }
}
function serialize(g){return {position:b64(g.getAttribute('position').array),normal:b64(g.getAttribute('normal').array),uv:b64(g.getAttribute('uv').array),indices:b64(g.index.array),indexType:g.index.array.constructor.name,positionCount:g.getAttribute('position').count,triangleCount:g.index.count/3};}
function b64(array){return Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('base64');}
