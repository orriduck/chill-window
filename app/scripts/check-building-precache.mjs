import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = readFileSync(path.join(app, 'dist/sw.js'), 'utf8')
const urls = [...script.matchAll(/\{url:"([^"]+)",revision:(?:"[^"]*"|null)\}/g)].map(match => match[1])
assert.ok(urls.length > 0, 'Generated SW precache entries were not found')
const hudson = 'models/osm2world/hudson/'
for (const name of ['buildings.pack.bin', 'buildings.pack.index.json', 'catalog.json']) {
  assert.equal(urls.filter(url => url === hudson + name).length, 1, `Missing or duplicated building precache transport ${name}`)
}
assert.equal(urls.filter(url => /^models\/osm2world\/hudson\/tile-[^/]+\/buildings\.glb$/.test(url)).length, 0)
const catalog = JSON.parse(readFileSync(path.join(app, 'public', hudson, 'catalog.json'), 'utf8'))
for (const tile of catalog.tiles) assert.ok(!urls.includes(hudson + tile.uri), `Standalone duplicate ${tile.uri}`)
for (const texture of catalog.textures) assert.ok(urls.includes(hudson + texture.uri), `Lost shared texture ${texture.uri}`)
const trees = readdirSync(path.join(app, 'public/models/trees')).filter(name => name.endsWith('.glb'))
for (const tree of trees) assert.ok(urls.includes('models/trees/' + tree), `Lost tree GLB ${tree}`)
console.log(JSON.stringify({ precacheEntries: urls.length, uniquePrecacheUrls: new Set(urls).size, pack: true, index: true, catalog: true,
  excludedHudsonStandaloneModels: catalog.tiles.length, standaloneHudsonModelsCached: 0,
  retainedSharedTextures: catalog.textures.length, retainedTreeGLBs: trees.length }, null, 2))
