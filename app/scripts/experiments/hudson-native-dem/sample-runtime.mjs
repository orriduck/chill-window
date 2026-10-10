import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const app = path.join(root, 'app');
const require = createRequire(path.join(app, 'package.json'));
const ts = require('typescript');
const { build } = require('esbuild');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const out = process.argv[process.argv.indexOf('--out') + 1];
if (!out || !process.argv.includes('--out')) throw new Error('--out required');
const realPath = path.join(app, 'src/engine/three/geography/RealWorld.ts');
const realText = await fs.readFile(realPath, 'utf8');
const ast = ts.createSourceFile(realPath, realText, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'RealWorld');
const methods = ['terrainHeight', 'terrainGeometry'].map(name => {
  const node = cls?.members.find(m => ts.isMethodDeclaration(m) && m.name.getText(ast) === name);
  if (!node) throw new Error(`Missing runtime method ${name}`);
  return { name, text: node.getText(ast), sha256: sha(node.getText(ast)) };
});
const chunk = cls.members.find(m => ts.isMethodDeclaration(m) && m.name.getText(ast) === 'createChunk').getText(ast);
// Fail closed if the runtime topology/placement changes; do not guess its new semantics.
if (!/const TILE = 256\b/.test(realText) || !/this\.terrainGeometry\(x0, z0, TILE, TILE, 8\)/.test(chunk)
  || !/ground\.position\.y = 0\.18\b/.test(chunk)) throw new Error('Runtime tile layout changed; update diagnostic adapter');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'native-dem-node-'));
try {
  const entry = `import * as THREE from ${JSON.stringify(require.resolve('three'))};
import {GeoData} from ${JSON.stringify(path.join(app, 'src/engine/three/geography/GeoData.ts'))};
import {hash01} from ${JSON.stringify(path.join(app, 'src/engine/three/core/procedural.ts'))};
import {PASSENGER_VIEWS} from ${JSON.stringify(path.join(app, 'src/engine/three/core/PassengerView.ts'))};
class Probe { constructor(public data: GeoData) {} sampleLand(){return {forest:false,farm:false}} ${methods.map(m => m.text).join('\n')} }
export {GeoData,Probe,PASSENGER_VIEWS};`;
  const bundle = path.join(temp, 'probe.mjs');
  await build({ stdin: { contents: entry, loader: 'ts', resolveDir: app }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
  const { GeoData, Probe, PASSENGER_VIEWS } = await import(bundle);
  const worldPath = path.join(app, 'public/geodata/hudson/world.json');
  const worldBytes = await fs.readFile(worldPath), world = JSON.parse(worldBytes);
  const elevationBytes = await fs.readFile(path.join(path.dirname(worldPath), world.dem.file));
  const heights = new Float32Array(elevationBytes.buffer.slice(elevationBytes.byteOffset, elevationBytes.byteOffset + elevationBytes.byteLength));
  const data = new GeoData(world, heights), probe = new Probe(data), tiles = new Map();
  function meshAt(x, z) {
    const cx = Math.floor(x / 256), cz = Math.floor(z / 256), key = `${cx},${cz}`;
    if (!tiles.has(key)) tiles.set(key, probe.terrainGeometry(cx * 256, cz * 256, 256, 256, 8));
    const geo = tiles.get(key), p = geo.getAttribute('position'), ids = geo.index;
    // Query actual indexed triangles in the containing cell, including exact edge tolerance.
    for (let i = 0; i < ids.count; i += 3) {
      const index = [ids.getX(i), ids.getX(i + 1), ids.getX(i + 2)];
      const v = index.map(j => [p.getX(j), p.getY(j), p.getZ(j)]);
      if (x < Math.min(...v.map(a => a[0])) - 1e-6 || x > Math.max(...v.map(a => a[0])) + 1e-6
        || z < Math.min(...v.map(a => a[2])) - 1e-6 || z > Math.max(...v.map(a => a[2])) + 1e-6) continue;
      const [a, b, c] = v, den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
      const w = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
      const weights = [u, w, 1 - u - w];
      if (weights.every(t => t >= -1e-6 && t <= 1 + 1e-6)) return { height: weights.reduce((h, t, j) => h + t * v[j][1], 0) + 0.18, tile: key, triangleOffset: i, indices: index, vertices: v, barycentric: weights };
    }
    return null;
  }
  const poses = [], samples = [], crossSections = [2590, 2690, 2790, 2890, 2990];
  for (let s = 2590; s <= 2990; s += 5) {
    const pose = data.pose(s), rail = data.railHeight(s), right = { x: pose.dz, z: -pose.dx };
    const yaw = PASSENGER_VIEWS.window.yaw;
    const view = { x: Math.cos(yaw) * pose.dx + Math.sin(yaw) * right.x, z: Math.cos(yaw) * pose.dz + Math.sin(yaw) * right.z };
    const rails = data.features.filter(f => f.kind === 'rail' && f.tags.railway === 'rail').flatMap(f => f.coordinates.slice(1).map((b, i) => {
      const a = f.coordinates[i], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((pose.x - a.x) * dx + (pose.z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-8)));
      const x = a.x + t * dx, z = a.z + t * dz;
      return { id: f.id, track: f.tags['railway:track_ref'] ?? f.tags.track_ref ?? null, tags: f.tags, segment: i, distance: Math.hypot(x - pose.x, z - pose.z), signedRight: (x - pose.x) * right.x + (z - pose.z) * right.z };
    })).sort((a, b) => a.distance - b.distance);
    const unique = rails.filter((r, i) => rails.findIndex(a => a.id === r.id) === i).slice(0, 4);
    poses.push({ ...pose, railHeight: rail, eyeHeight: rail + 2, right, view, nearestOSMRails: unique });
    const offsetTargets = [-30, -20, -18, -12, -8, -4, 4, 8, 12, 18, 20, 30];
    const offsets = crossSections.includes(s) ? Array.from({ length: 241 }, (_, i) => i - 120)
      : [...new Set([0, ...offsetTargets.flatMap(d => [d - 1, d, d + 1])])].sort((a, b) => a - b);
    for (const offset of offsets) {
      const x = pose.x + right.x * offset, z = pose.z + right.z * offset;
      const [longitude, latitude] = data.unproject(x, z), mesh = meshAt(x, z);
      samples.push({ s, offset, x, z, longitude, latitude, railHeight: rail, eyeHeight: rail + 2, engineering: data.engineeringKindAt(x, z), raw20m: data.heightAt(x, z), railBed: probe.terrainHeight(x, z), nearMesh: mesh?.height ?? null, mesh });
    }
  }
  const bounds = [Math.min(...samples.map(p => p.x)) - 16, Math.min(...samples.map(p => p.z)) - 16, Math.max(...samples.map(p => p.x)) + 16, Math.max(...samples.map(p => p.z)) + 16];
  const geographicCorners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]].map(([x, z]) => data.unproject(x, z));
  const grids = { dem20m: [], mesh8m: [] };
  for (let row = 0; row < world.dem.height; row++) for (let col = 0; col < world.dem.width; col++) {
    const x = world.dem.bounds[0] + col * world.dem.resolution[0], z = world.dem.bounds[1] + row * world.dem.resolution[1];
    if (x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]) grids.dem20m.push([x, z]);
  }
  for (const [key, geo] of tiles) {
    const p = geo.getAttribute('position'), ids = geo.index;
    for (let i = 0; i < ids.count; i += 3) {
      const v = [ids.getX(i), ids.getX(i + 1), ids.getX(i + 2)].map(j => [p.getX(j), p.getZ(j)]);
      if (v.some(([x, z]) => x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3])) grids.mesh8m.push({ tile: key, triangleOffset: i, vertices: v });
    }
  }
  const result = { schemaVersion: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), createdAt: new Date().toISOString(), sourceHashes: { world: sha(worldBytes), elevation: sha(elevationBytes), geoData: sha(await fs.readFile(path.join(app, 'src/engine/three/geography/GeoData.ts'))), realWorld: sha(realText), createChunk: sha(chunk), methods: methods.map(({ name, sha256 }) => ({ name, sha256 })) }, projection: { origin: world.origin, type: 'GeoData locally scaled spherical Mercator; geographic samples from actual unproject' }, dem: world.dem, routeSource: world.route.source, bounds, geographicCorners, crossSections, poses, samples, grids, rails: data.features.filter(f => f.kind === 'rail' && f.tags.railway === 'rail' && f.bounds[0] <= bounds[2] && f.bounds[2] >= bounds[0] && f.bounds[1] <= bounds[3] && f.bounds[3] >= bounds[1]).map(f => ({ id: f.id, tags: f.tags, coordinates: f.coordinates })), methodology: { extractedMethodTexts: methods, colorOnlyStub: 'sampleLand returns false/false; hash01 is the actual imported runtime helper. Colors do not enter vertex positions or indices.', meshYOffset: 0.18, geometry: 'exact current terrainGeometry method output; actual Float32 positions/index; barycentric interpolation', eye: 'unchanged GeoData.railHeight(s)+2m', runtimeImported: false, visualAcceptance: false } };
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(result));
  for (const geo of tiles.values()) geo.dispose();
} finally { await fs.rm(temp, { recursive: true, force: true }); }
