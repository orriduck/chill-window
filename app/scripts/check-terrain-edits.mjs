import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true } })
try {
  const { createContinuousRoutePlan } = await server.ssrLoadModule('/src/engine/three/terrain/RouteFeatures.ts')
  const { landscapeAt } = await server.ssrLoadModule('/src/engine/three/terrain/Landscape.ts')
  const { TerrainGen } = await server.ssrLoadModule('/src/engine/three/terrain/TerrainGen.ts')
  const { TerrainEdits, PATCH_SCENES } = await server.ssrLoadModule('/src/engine/three/terrain/TerrainEdits.ts')
  const plan = createContinuousRoutePlan(42), edits = new TerrainEdits(plan)
  const gen = new TerrainGen(plan, edits), base = new TerrainGen(plan)
  const height = (g, x, z) => g.getHeight(x, z, landscapeAt(z, plan).params)
  let samples = 0, maxHeightGap = 0, maxNormalGap = 0
  for (const cx of [-1, 0, 1]) for (const [scene, defaults] of Object.entries(PATCH_SCENES)) {
    const cz = 78, x0 = cx * 256, z0 = cz * 256
    const settings = { scene, relief: defaults.relief, seed: 12345 }
    edits.set(cx, cz, settings)
    const first = height(gen, x0 + 128, z0 + 128)
    edits.set(cx, cz, settings)
    assert.equal(first, height(gen, x0 + 128, z0 + 128))
    for (let t = 0; t <= 256; t += 4) {
      for (const [x, z, dx, dz] of [[x0,t+z0,1,0],[x0+256,t+z0,1,0],[x0+t,z0,0,1],[x0+t,z0+256,0,1]]) {
        assert.equal(height(gen, x, z), height(base, x, z), `edge moved: ${scene}`)
        const eps = 0.0001
        const gap = Math.abs(height(gen,x-dx*eps,z-dz*eps)-height(gen,x+dx*eps,z+dz*eps))
        maxHeightGap = Math.max(maxHeightGap,gap)
        assert(gap < 0.01, `height seam: ${scene} ${gap}`)
        const a = gen.getNormal(x-dx*eps,z-dz*eps,landscapeAt(z-dz*eps,plan).params)
        const b = gen.getNormal(x+dx*eps,z+dz*eps,landscapeAt(z+dz*eps,plan).params)
        const ngap = Math.hypot(a.nx-b.nx,a.ny-b.ny,a.nz-b.nz)
        maxNormalGap = Math.max(maxNormalGap,ngap)
        assert(ngap < 0.01, `normal seam: ${scene} ${ngap}`)
        samples++
      }
      // Adjacent interiors must remain numerically identical.
      for (const [x,z] of [[x0-128,z0+t],[x0+384,z0+t],[x0+t,z0-128],[x0+t,z0+384]]) assert.equal(height(gen,x,z),height(base,x,z))
    }
    edits.reset(cx,cz)
    assert.equal(height(gen,x0+128,z0+128),height(base,x0+128,z0+128))
  }
  console.log(JSON.stringify({ scenes:8, tiles:3, boundarySamples:samples,maxHeightGap,maxNormalGap,deterministic:true,neighborsUnchanged:true,restore:true,result:'pass' },null,2))
} finally { await server.close() }
