import * as THREE from 'three'
import { roadCenterX, ROAD_VERGE } from '../terrain/TerrainGen'

// Catenary poles
const POLE_X = 8 // beside the track, inside the flattened corridor
const POLE_SPACING = 50
const POLE_WINDOW = 600 // recycle window along Z
const POLE_COUNT = Math.ceil(POLE_WINDOW / POLE_SPACING)
const POLE_BEHIND = 100 // recycle once this far behind the camera

// Grass tufts near the corridor edge — dense meadow, not scattered sprigs
const GRASS_COUNT = 1400
const GRASS_WINDOW = 400
const GRASS_X_MIN = 6.5
const GRASS_X_MAX = 70

// White wildflower specks scattered along the verge
const FLOWER_COUNT = 240
const FLOWER_X_MIN = 7
const FLOWER_X_MAX = 30

// Post-and-rail wooden fence paralleling the track (slowroad signature)
const FENCE_X = 13
const FENCE_POST_SPACING = 4
const FENCE_WINDOW = 600
const FENCE_POST_COUNT = Math.ceil(FENCE_WINDOW / FENCE_POST_SPACING)

// Mid-distance tree band (parallax layer between corridor and mountains)
const TREE_COUNT = 70
const TREE_WINDOW = 900
const TREE_X_MIN = 100
const TREE_X_MAX = 300

type HeightSampler = (x: number, z: number) => number

/**
 * Lineside props that scroll past the side window: catenary poles with the
 * contact wire, grass tufts near the corridor, and a mid-distance tree band.
 * Everything recycles along Z with a modulo window — infinite, no popping.
 */
export class LinesideProps {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private dummy = new THREE.Object3D()
  private sampleHeight: HeightSampler

  private poles: THREE.InstancedMesh
  private poleArms: THREE.InstancedMesh
  private poleZ: number[] = []

  private grass: THREE.InstancedMesh
  private grassData: { x: number; z: number; s: number; rot: number }[] = []
  private colorScratch = new THREE.Color()

  private flowers: THREE.InstancedMesh
  private flowerData: { x: number; z: number; s: number }[] = []

  private fencePosts: THREE.InstancedMesh
  private fenceRailsLow: THREE.InstancedMesh
  private fenceRailsHigh: THREE.InstancedMesh
  private fenceZ: number[] = []

  private trunks: THREE.InstancedMesh
  private foliage: THREE.InstancedMesh
  private foliageTop: THREE.InstancedMesh
  private treeData: { x: number; z: number; s: number; rot: number }[] = []

  constructor(sampleHeight: HeightSampler) {
    this.sampleHeight = sampleHeight

    // ---- Catenary poles: shaft + cross arm share the same transforms ----
    const poleMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x7d7d74, roughness: 0.6, metalness: 0.4 })
    )
    const shaftGeom = this.track(new THREE.CylinderGeometry(0.12, 0.18, 7, 6))
    shaftGeom.translate(0, 3.5, 0)
    const armGeom = this.track(new THREE.BoxGeometry(6.5, 0.12, 0.12))
    armGeom.translate(-3, 6.4, 0) // reaches from the pole over the track

    this.poles = new THREE.InstancedMesh(shaftGeom, poleMat, POLE_COUNT)
    this.poleArms = new THREE.InstancedMesh(armGeom, poleMat, POLE_COUNT)
    this.poles.castShadow = true
    // Instances scroll far from the origin, so the geometry-level bounding
    // sphere (which stays at the origin) must not drive frustum culling —
    // otherwise the whole set pops out once the camera leaves the origin.
    this.poles.frustumCulled = false
    this.poleArms.frustumCulled = false

    for (let i = 0; i < POLE_COUNT; i++) {
      this.poleZ.push(i * POLE_SPACING - POLE_BEHIND)
    }
    this.group.add(this.poles, this.poleArms)

    // Contact wire above the rails, follows the camera like the track
    const wireMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.7 })
    )
    const wire = new THREE.Mesh(this.box(0.04, 0.04, POLE_WINDOW), wireMat)
    wire.position.set(0.8, 5.9, 0)
    wire.name = 'contactWire'
    this.group.add(wire)

    // ---- Grass tufts: two crossed alpha-tested quads with a hand-drawn
    // blade texture — reads as grass, not miniature pine trees ----
    const grassGeom = this.track(this.makeCrossedQuadGeometry())
    const grassMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.makeGrassTexture(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.9,
      })
    )
    this.grass = new THREE.InstancedMesh(grassGeom, grassMat, GRASS_COUNT)
    this.grass.frustumCulled = false
    for (let i = 0; i < GRASS_COUNT; i++) {
      const z = -POLE_BEHIND + Math.random() * GRASS_WINDOW
      this.grassData.push({
        x: this.sampleClearX(GRASS_X_MIN, GRASS_X_MAX, z),
        z,
        s: 0.85 + Math.random() * 0.9,
        rot: Math.random() * Math.PI,
      })
      this.setGrassColor(i)
    }
    this.group.add(this.grass)

    // ---- White wildflower specks ----
    const flowerGeom = this.track(new THREE.SphereGeometry(0.085, 5, 4))
    const flowerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.5 })
    )
    this.flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, FLOWER_COUNT)
    this.flowers.frustumCulled = false
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const z = -POLE_BEHIND + Math.random() * GRASS_WINDOW
      this.flowerData.push({
        x: this.sampleClearX(FLOWER_X_MIN, FLOWER_X_MAX, z),
        z,
        s: 0.7 + Math.random() * 0.6,
      })
      // Occasional cream/pink tint so the verge is not pure white
      this.colorScratch.setHSL(0.12 + Math.random() * 0.04, 0.25 + Math.random() * 0.2, 0.85 + Math.random() * 0.1)
      this.flowers.setColorAt(i, this.colorScratch)
    }
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true
    this.group.add(this.flowers)

    // ---- Post-and-rail wooden fence ----
    const fenceMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2f2318, roughness: 0.95 })
    )
    const postGeom = this.track(new THREE.BoxGeometry(0.14, 1.2, 0.14))
    postGeom.translate(0, 0.6, 0)
    // Each rail spans from one post to the next (+Z), at two heights
    const railLowGeom = this.track(new THREE.BoxGeometry(0.05, 0.09, FENCE_POST_SPACING))
    railLowGeom.translate(0, 0.55, FENCE_POST_SPACING / 2)
    const railHighGeom = this.track(new THREE.BoxGeometry(0.05, 0.09, FENCE_POST_SPACING))
    railHighGeom.translate(0, 0.95, FENCE_POST_SPACING / 2)

    this.fencePosts = new THREE.InstancedMesh(postGeom, fenceMat, FENCE_POST_COUNT)
    this.fenceRailsLow = new THREE.InstancedMesh(railLowGeom, fenceMat, FENCE_POST_COUNT)
    this.fenceRailsHigh = new THREE.InstancedMesh(railHighGeom, fenceMat, FENCE_POST_COUNT)
    this.fencePosts.castShadow = true
    this.fencePosts.frustumCulled = false
    this.fenceRailsLow.frustumCulled = false
    this.fenceRailsHigh.frustumCulled = false
    for (let i = 0; i < FENCE_POST_COUNT; i++) {
      this.fenceZ.push(i * FENCE_POST_SPACING - POLE_BEHIND)
    }
    this.group.add(this.fencePosts, this.fenceRailsLow, this.fenceRailsHigh)

    // ---- Mid-distance tree band: trunk + two-tier foliage ----
    const trunkGeom = this.track(new THREE.CylinderGeometry(0.3, 0.4, 2, 6))
    trunkGeom.translate(0, 1, 0)
    const trunkMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 })
    )
    const foliageGeom = this.track(new THREE.ConeGeometry(2.2, 4, 7))
    foliageGeom.translate(0, 3.6, 0)
    const foliageMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2e6b47, roughness: 0.85, flatShading: true })
    )
    const foliageTopGeom = this.track(new THREE.ConeGeometry(1.4, 2.6, 7))
    foliageTopGeom.translate(0, 6.0, 0)
    const foliageTopMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x35794f, roughness: 0.85, flatShading: true })
    )
    this.trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, TREE_COUNT)
    this.foliage = new THREE.InstancedMesh(foliageGeom, foliageMat, TREE_COUNT)
    this.foliageTop = new THREE.InstancedMesh(foliageTopGeom, foliageTopMat, TREE_COUNT)
    this.trunks.frustumCulled = false
    this.foliage.frustumCulled = false
    this.foliageTop.frustumCulled = false
    for (let i = 0; i < TREE_COUNT; i++) {
      this.treeData.push({
        x: TREE_X_MIN + Math.random() * (TREE_X_MAX - TREE_X_MIN),
        z: -150 + Math.random() * TREE_WINDOW,
        s: 1.2 + Math.random() * 1.8,
        rot: Math.random() * Math.PI * 2,
      })
    }
    this.group.add(this.trunks, this.foliage, this.foliageTop)
  }

  update(camZ: number) {
    // Poles: recycle behind -> ahead
    for (let i = 0; i < POLE_COUNT; i++) {
      if (this.poleZ[i] < camZ - POLE_BEHIND) this.poleZ[i] += POLE_WINDOW
      this.dummy.position.set(POLE_X, 0, this.poleZ[i])
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()
      this.poles.setMatrixAt(i, this.dummy.matrix)
      this.poleArms.setMatrixAt(i, this.dummy.matrix)
    }
    this.poles.instanceMatrix.needsUpdate = true
    this.poleArms.instanceMatrix.needsUpdate = true

    // Contact wire follows the camera (uniform along Z)
    const wire = this.group.getObjectByName('contactWire')
    if (wire) wire.position.z = camZ

    // Grass: recycle, resample height in the blend zone
    for (let i = 0; i < GRASS_COUNT; i++) {
      const g = this.grassData[i]
      if (g.z < camZ - POLE_BEHIND) {
        g.z += GRASS_WINDOW
        g.x = this.sampleClearX(GRASS_X_MIN, GRASS_X_MAX, g.z)
        g.s = 0.85 + Math.random() * 0.9
        g.rot = Math.random() * Math.PI
        this.setGrassColor(i)
      }
      this.dummy.position.set(g.x, this.sampleHeight(g.x, g.z), g.z)
      this.dummy.rotation.set(0, g.rot, 0)
      this.dummy.scale.setScalar(g.s)
      this.dummy.updateMatrix()
      this.grass.setMatrixAt(i, this.dummy.matrix)
    }
    this.grass.instanceMatrix.needsUpdate = true

    // Flowers: recycle with the same window as the grass
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const f = this.flowerData[i]
      if (f.z < camZ - POLE_BEHIND) {
        f.z += GRASS_WINDOW
        f.x = this.sampleClearX(FLOWER_X_MIN, FLOWER_X_MAX, f.z)
        f.s = 0.7 + Math.random() * 0.6
      }
      this.dummy.position.set(f.x, this.sampleHeight(f.x, f.z) + 0.28, f.z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(f.s)
      this.dummy.updateMatrix()
      this.flowers.setMatrixAt(i, this.dummy.matrix)
    }
    this.flowers.instanceMatrix.needsUpdate = true

    // Fence: posts and their trailing rails share one transform each
    for (let i = 0; i < FENCE_POST_COUNT; i++) {
      if (this.fenceZ[i] < camZ - POLE_BEHIND) this.fenceZ[i] += FENCE_WINDOW
      const z = this.fenceZ[i]
      this.dummy.position.set(FENCE_X, this.sampleHeight(FENCE_X, z), z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()
      this.fencePosts.setMatrixAt(i, this.dummy.matrix)
      this.fenceRailsLow.setMatrixAt(i, this.dummy.matrix)
      this.fenceRailsHigh.setMatrixAt(i, this.dummy.matrix)
    }
    this.fencePosts.instanceMatrix.needsUpdate = true
    this.fenceRailsLow.instanceMatrix.needsUpdate = true
    this.fenceRailsHigh.instanceMatrix.needsUpdate = true

    // Tree band: recycle, resample height on the natural terrain
    for (let i = 0; i < TREE_COUNT; i++) {
      const t = this.treeData[i]
      if (t.z < camZ - 150) {
        t.z += TREE_WINDOW
        t.x = TREE_X_MIN + Math.random() * (TREE_X_MAX - TREE_X_MIN)
        t.s = 1.2 + Math.random() * 1.8
      }
      this.dummy.position.set(t.x, this.sampleHeight(t.x, t.z) - 0.15, t.z)
      this.dummy.rotation.set(0, t.rot, 0)
      this.dummy.scale.setScalar(t.s)
      this.dummy.updateMatrix()
      this.trunks.setMatrixAt(i, this.dummy.matrix)
      this.foliage.setMatrixAt(i, this.dummy.matrix)
      this.foliageTop.setMatrixAt(i, this.dummy.matrix)
    }
    this.trunks.instanceMatrix.needsUpdate = true
    this.foliage.instanceMatrix.needsUpdate = true
    this.foliageTop.instanceMatrix.needsUpdate = true
  }

  /** Two intersecting quads (X shape) for camera-facing grass volume. */
  private makeCrossedQuadGeometry(): THREE.BufferGeometry {
    const p1 = new THREE.PlaneGeometry(1.2, 0.8)
    p1.translate(0, 0.4, 0)
    const p2 = p1.clone()
    p2.rotateY(Math.PI / 2)
    const a = p1.toNonIndexed()
    const b = p2.toNonIndexed()
    p1.dispose()
    p2.dispose()
    const merge = (attrA: THREE.BufferAttribute, attrB: THREE.BufferAttribute) => {
      const out = new Float32Array(attrA.array.length + attrB.array.length)
      out.set(attrA.array as Float32Array, 0)
      out.set(attrB.array as Float32Array, attrA.array.length)
      return new THREE.BufferAttribute(out, attrA.itemSize)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', merge(a.attributes.position as THREE.BufferAttribute, b.attributes.position as THREE.BufferAttribute))
    geom.setAttribute('normal', merge(a.attributes.normal as THREE.BufferAttribute, b.attributes.normal as THREE.BufferAttribute))
    geom.setAttribute('uv', merge(a.attributes.uv as THREE.BufferAttribute, b.attributes.uv as THREE.BufferAttribute))
    a.dispose()
    b.dispose()
    return geom
  }

  /** Hand-drawn grass blades on a transparent canvas, tinted per-instance. */
  private makeGrassTexture(): THREE.Texture {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, size, size)
    // Fan of tapering blades, pale near-white so instanceColor drives the tint
    const blades = 7
    for (let i = 0; i < blades; i++) {
      const baseX = size * (0.2 + (i / (blades - 1)) * 0.6)
      const lean = (i / (blades - 1) - 0.5) * 26 + (Math.random() - 0.5) * 10
      const tipX = baseX + lean
      const tipY = 2 + Math.random() * 12
      const w = 2.5 + Math.random() * 2
      const shade = 200 + Math.floor(Math.random() * 55) // near-white, texture multiplies tint
      ctx.fillStyle = `rgb(${shade - 30},${shade},${shade - 60})`
      ctx.beginPath()
      ctx.moveTo(baseX - w, size)
      ctx.quadraticCurveTo(baseX - w * 0.4 + lean * 0.4, size * 0.5, tipX, tipY)
      ctx.quadraticCurveTo(baseX + w * 0.4 + lean * 0.4, size * 0.5, baseX + w, size)
      ctx.closePath()
      ctx.fill()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  /** Random x in [min, max] that keeps clear of the country road.
   *  Bias toward the near edge so the verge reads dense from the window. */
  private sampleClearX(min: number, max: number, z: number): number {
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = min + (max - min) * Math.pow(Math.random(), 1.5)
      if (Math.abs(x - roadCenterX(z)) > ROAD_VERGE) return x
    }
    return min + Math.random() * (max - min)
  }

  /** Vary grass tint so the verge does not read as a uniform carpet. */
  private setGrassColor(i: number) {
    this.colorScratch.setHSL(0.25 + Math.random() * 0.09, 0.5, 0.3 + Math.random() * 0.16)
    this.grass.setColorAt(i, this.colorScratch)
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const resource of this.disposables) resource.dispose()
    this.disposables = []
    this.poles.dispose()
    this.poleArms.dispose()
    this.grass.dispose()
    this.flowers.dispose()
    this.fencePosts.dispose()
    this.fenceRailsLow.dispose()
    this.fenceRailsHigh.dispose()
    this.trunks.dispose()
    this.foliage.dispose()
    this.foliageTop.dispose()
  }
}
