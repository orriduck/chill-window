import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true } })
try {
  const route = await server.ssrLoadModule('/src/engine/three/terrain/RouteFeatures.ts')
  const { landscapeAt } = await server.ssrLoadModule('/src/engine/three/terrain/Landscape.ts')
  const { TerrainGen } = await server.ssrLoadModule('/src/engine/three/terrain/TerrainGen.ts')
  const { trackElevationAt } = await server.ssrLoadModule('/src/engine/three/terrain/RouteProfile.ts')
  let boundaries = 0, maxHeightGap = 0, maxNormalGap = 0
  const sequences = []
  for (const seed of [0, 1, 42, 91, -10, 999999]) {
    const plan = route.createContinuousRoutePlan(seed)
    const gen = new TerrainGen(plan), revisit = new TerrainGen(route.createContinuousRoutePlan(seed))
    assert.deepEqual(route.routePlanIssues(plan), [])
    const ids = []
    for (let i = -20; i < 1200; i++) {
      const beat = route.routeBeatForSegment(i, plan)
      assert.deepEqual(route.routeBeatIssues(beat), [])
      const previous = route.routeBeatForSegment(i - 1, plan)
      if (beat.id === 'city-core') assert.equal(previous.id, 'urban-edge')
      if (beat.id === 'mountain-pass') assert(['foothills', 'mountain-pass'].includes(previous.id))
      const next = route.routeBeatForSegment(i + 1, plan)
      if (beat.id === 'city-core') assert.equal(next.id, 'urban-edge')
      if (beat.id === 'mountain-pass') assert(['foothills', 'mountain-pass'].includes(next.id))
      ids.push(beat.id)
      const z = i * route.ROUTE_SEGMENT_LENGTH
      // Includes route seams and both endpoints of the height morph.
      for (const join of [z, z + route.ROUTE_SEGMENT_LENGTH - route.ROUTE_BLEND_LENGTH]) {
        for (const x of [0, 20, 44, 88, 160, 256, 512, 768]) {
          const eps = 0.0001
          const a = gen.getHeight(x, join - eps, landscapeAt(join - eps, plan).params)
          const b = gen.getHeight(x, join + eps, landscapeAt(join + eps, plan).params)
          const gap = Math.abs(a - b)
          maxHeightGap = Math.max(maxHeightGap, gap)
          assert(gap < 0.01, `height seam seed=${seed} x=${x} z=${join}: ${gap}`)
          const na = gen.getNormal(x, join - eps, landscapeAt(join - eps, plan).params)
          const nb = gen.getNormal(x, join + eps, landscapeAt(join + eps, plan).params)
          const ngap = Math.hypot(na.nx - nb.nx, na.ny - nb.ny, na.nz - nb.nz)
          maxNormalGap = Math.max(maxNormalGap, ngap)
          assert(ngap < 0.01, `normal seam seed=${seed} z=${join}: ${ngap}`)
          assert.equal(gen.getHeight(x, join, landscapeAt(join, plan).params), revisit.getHeight(x, join, landscapeAt(join, plan).params))
          boundaries++
        }
      }
      assert(Math.abs(gen.getHeight(0, z, landscapeAt(z, plan).params) - trackElevationAt(z)) < 1e-12)
    }
    // Subsequent geographic regions must not be the initial fixed programme.
    assert.notDeepEqual(ids.slice(20, 40), ids.slice(40, 60))
    sequences.push(ids.join(','))
  }
  assert(new Set(sequences).size > 1)
  const one = route.createContinuousRoutePlan(42), two = route.createContinuousRoutePlan(43)
  assert.notEqual(new TerrainGen(one).getHeight(200, 19650, landscapeAt(19650, one).params), new TerrainGen(two).getHeight(200, 19650, landscapeAt(19650, two).params))
  console.log(JSON.stringify({ seeds: 6, segmentsPerSeed: 1220, samples: boundaries, maxHeightGap, maxNormalGap, result: 'pass' }, null, 2))
} finally { await server.close() }
