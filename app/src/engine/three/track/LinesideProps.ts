import * as THREE from 'three'
import { hash01 } from '../core/procedural'
import { roadCenterX, ROAD_VERGE } from '../terrain/TerrainGen'
import { applyAtlasUV, grassSpriteTex } from '../textures'

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
const GRASS_ATLAS_CELLS = [[0, 0], [0, 1]] as const
type GrassAtlasVariant = 0 | 1

// White wildflower specks scattered along the verge
const FLOWER_COUNT = 240
const FLOWER_X_MIN = 7
const FLOWER_X_MAX = 30

// Post-and-rail wooden fence paralleling the track (slowroad signature)
const FENCE_X = 13
const FENCE_POST_SPACING = 4
const FENCE_WINDOW = 600
const FENCE_POST_COUNT = Math.ceil(FENCE_WINDOW / FENCE_POST_SPACING)

type HeightSampler = (x: number, z: number) => number

/**
 * Lineside props that scroll past the side window: catenary poles with the
 * contact wire, grass tufts near the corridor, and a fence.
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

  private grass: THREE.InstancedMesh[] = []
  private grassData: { x: number; z: number; s: number; rot: number; variant: GrassAtlasVariant }[] = []
  private colorScratch = new THREE.Color()

  private flowers: THREE.InstancedMesh
  private flowerData: { x: number; z: number; s: number }[] = []

  private fencePosts: THREE.InstancedMesh
  private fenceRailsLow: THREE.InstancedMesh
  private fenceRailsHigh: THREE.InstancedMesh
  private fenceZ: number[] = []

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
      this.writePole(i)
    }
    this.poles.instanceMatrix.needsUpdate = true
    this.poleArms.instanceMatrix.needsUpdate = true
    this.group.add(this.poles, this.poleArms)

    // Contact wire above the rails, follows the camera like the track
    const wireMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.7 })
    )
    const wire = new THREE.Mesh(this.box(0.04, 0.04, POLE_WINDOW), wireMat)
    wire.position.set(0.8, 5.9, 0)
    wire.name = 'contactWire'
    this.group.add(wire)

    // ---- Grass tufts: crossed bitmap clumps from the shared vegetation
    // atlas, keeping the near verge consistent with the terrain foliage. ----
    const grassMat = this.track(
      new THREE.MeshStandardMaterial({
        map: grassSpriteTex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.9,
      })
    )
    for (const [col, row] of GRASS_ATLAS_CELLS) {
      const grassGeom = this.track(this.makeCrossedQuadGeometry())
      applyAtlasUV(grassGeom, col, row, 2, 2)
      const grass = new THREE.InstancedMesh(grassGeom, grassMat, GRASS_COUNT / GRASS_ATLAS_CELLS.length)
      grass.frustumCulled = false
      this.grass.push(grass)
    }
    for (let i = 0; i < GRASS_COUNT; i++) {
      this.grassData.push({
        x: 0,
        z: 0,
        s: 1,
        rot: 0,
        variant: (i % GRASS_ATLAS_CELLS.length) as GrassAtlasVariant,
      })
      this.resetGrass(i, -POLE_BEHIND + hash01(i, 0, 1) * GRASS_WINDOW)
    }
    for (const grass of this.grass) {
      grass.instanceMatrix.needsUpdate = true
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true
    }
    this.group.add(...this.grass)

    // ---- White wildflower specks ----
    const flowerGeom = this.track(new THREE.SphereGeometry(0.085, 5, 4))
    const flowerMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.5 })
    )
    this.flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, FLOWER_COUNT)
    this.flowers.frustumCulled = false
    for (let i = 0; i < FLOWER_COUNT; i++) {
      this.flowerData.push({ x: 0, z: 0, s: 1 })
      this.resetFlower(i, -POLE_BEHIND + hash01(i, 0, 2) * GRASS_WINDOW)
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
      this.writeFence(i)
    }
    this.fencePosts.instanceMatrix.needsUpdate = true
    this.fenceRailsLow.instanceMatrix.needsUpdate = true
    this.fenceRailsHigh.instanceMatrix.needsUpdate = true
    this.group.add(this.fencePosts, this.fenceRailsLow, this.fenceRailsHigh)

  }

  update(camZ: number) {
    // Instances are placed once and only rewritten after they pass the
    // recycle line. Re-uploading 1,900 matrices every frame caused grass to
    // shimmer and consumed enough CPU to make the terrain stream stutter.
    let polesChanged = false
    for (let i = 0; i < POLE_COUNT; i++) {
      if (this.poleZ[i] < camZ - POLE_BEHIND) {
        this.poleZ[i] += POLE_WINDOW
        this.writePole(i)
        polesChanged = true
      }
    }
    if (polesChanged) {
      this.poles.instanceMatrix.needsUpdate = true
      this.poleArms.instanceMatrix.needsUpdate = true
    }

    // Contact wire follows the camera (uniform along Z)
    const wire = this.group.getObjectByName('contactWire')
    if (wire) wire.position.z = camZ

    let grassChanged = false
    for (let i = 0; i < GRASS_COUNT; i++) {
      const g = this.grassData[i]
      if (g.z < camZ - POLE_BEHIND) {
        this.resetGrass(i, g.z + GRASS_WINDOW)
        grassChanged = true
      }
    }
    if (grassChanged) {
      for (const grass of this.grass) {
        grass.instanceMatrix.needsUpdate = true
        if (grass.instanceColor) grass.instanceColor.needsUpdate = true
      }
    }

    let flowersChanged = false
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const f = this.flowerData[i]
      if (f.z < camZ - POLE_BEHIND) {
        this.resetFlower(i, f.z + GRASS_WINDOW)
        flowersChanged = true
      }
    }
    if (flowersChanged) this.flowers.instanceMatrix.needsUpdate = true

    let fenceChanged = false
    for (let i = 0; i < FENCE_POST_COUNT; i++) {
      if (this.fenceZ[i] < camZ - POLE_BEHIND) {
        this.fenceZ[i] += FENCE_WINDOW
        this.writeFence(i)
        fenceChanged = true
      }
    }
    if (fenceChanged) {
      this.fencePosts.instanceMatrix.needsUpdate = true
      this.fenceRailsLow.instanceMatrix.needsUpdate = true
      this.fenceRailsHigh.instanceMatrix.needsUpdate = true
    }

  }

  private writePole(i: number) {
    this.dummy.position.set(POLE_X, 0, this.poleZ[i])
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(1)
    this.dummy.updateMatrix()
    this.poles.setMatrixAt(i, this.dummy.matrix)
    this.poleArms.setMatrixAt(i, this.dummy.matrix)
  }

  private resetGrass(i: number, z: number) {
    const g = this.grassData[i]
    g.z = z
    g.x = this.sampleClearX(GRASS_X_MIN, GRASS_X_MAX, z, i)
    g.s = 0.55 + hash01(i, z, 11) * 0.5
    g.rot = hash01(i, z, 12) * Math.PI
    this.setGrassColor(i, z)
    this.dummy.position.set(g.x, this.sampleHeight(g.x, z), z)
    this.dummy.rotation.set(0, g.rot, 0)
    this.dummy.scale.setScalar(g.s)
    this.dummy.updateMatrix()
    this.grass[g.variant].setMatrixAt(this.grassIndex(i), this.dummy.matrix)
  }

  private resetFlower(i: number, z: number) {
    const f = this.flowerData[i]
    f.z = z
    f.x = this.sampleClearX(FLOWER_X_MIN, FLOWER_X_MAX, z, i + GRASS_COUNT)
    f.s = 0.7 + hash01(i, z, 21) * 0.6
    this.colorScratch.setHSL(
      0.12 + hash01(i, z, 22) * 0.04,
      0.25 + hash01(i, z, 23) * 0.2,
      0.85 + hash01(i, z, 24) * 0.1,
    )
    this.flowers.setColorAt(i, this.colorScratch)
    this.dummy.position.set(f.x, this.sampleHeight(f.x, z) + 0.28, z)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(f.s)
    this.dummy.updateMatrix()
    this.flowers.setMatrixAt(i, this.dummy.matrix)
  }

  private writeFence(i: number) {
    const z = this.fenceZ[i]
    this.dummy.position.set(FENCE_X, this.sampleHeight(FENCE_X, z), z)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(1)
    this.dummy.updateMatrix()
    this.fencePosts.setMatrixAt(i, this.dummy.matrix)
    this.fenceRailsLow.setMatrixAt(i, this.dummy.matrix)
    this.fenceRailsHigh.setMatrixAt(i, this.dummy.matrix)
  }

  /** Two intersecting quads (X shape) for camera-facing grass volume. */
  private makeCrossedQuadGeometry(): THREE.BufferGeometry {
    const p1 = new THREE.PlaneGeometry(0.82, 0.58)
    p1.translate(0, 0.29, 0)
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

  /** Random x in [min, max] that keeps clear of the country road.
   *  Bias toward the near edge so the verge reads dense from the window. */
  private sampleClearX(min: number, max: number, z: number, key: number): number {
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = min + (max - min) * Math.pow(hash01(key, z, attempt), 1.5)
      if (Math.abs(x - roadCenterX(z)) > ROAD_VERGE) return x
    }
    return min + hash01(key, z, 9) * (max - min)
  }

  /** Keep the bitmap's native greens, varying only the natural light level. */
  private setGrassColor(i: number, z: number) {
    this.colorScratch.setHSL(
      0.2 + hash01(i, z, 41) * 0.06,
      0.16 + hash01(i, z, 43) * 0.1,
      0.76 + hash01(i, z, 42) * 0.14,
    )
    const grass = this.grass[this.grassData[i].variant]
    grass.setColorAt(this.grassIndex(i), this.colorScratch)
  }

  private grassIndex(i: number): number {
    return Math.floor(i / GRASS_ATLAS_CELLS.length)
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
    for (const grass of this.grass) grass.dispose()
    this.flowers.dispose()
    this.fencePosts.dispose()
    this.fenceRailsLow.dispose()
    this.fenceRailsHigh.dispose()
  }
}
