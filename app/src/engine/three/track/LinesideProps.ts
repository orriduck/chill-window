import * as THREE from 'three'

// Catenary poles
const POLE_X = 8 // beside the track, inside the flattened corridor
const POLE_SPACING = 50
const POLE_WINDOW = 600 // recycle window along Z
const POLE_COUNT = Math.ceil(POLE_WINDOW / POLE_SPACING)
const POLE_BEHIND = 100 // recycle once this far behind the camera

// Grass tufts near the corridor edge
const GRASS_COUNT = 180
const GRASS_WINDOW = 400
const GRASS_X_MIN = 6.5
const GRASS_X_MAX = 45

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
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []
  private dummy = new THREE.Object3D()
  private sampleHeight: HeightSampler

  private poles: THREE.InstancedMesh
  private poleArms: THREE.InstancedMesh
  private poleZ: number[] = []

  private grass: THREE.InstancedMesh
  private grassData: { x: number; z: number; s: number }[] = []
  private colorScratch = new THREE.Color()

  private trunks: THREE.InstancedMesh
  private foliage: THREE.InstancedMesh
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

    // ---- Grass tufts ----
    const grassGeom = this.track(new THREE.ConeGeometry(0.25, 0.6, 5))
    grassGeom.translate(0, 0.3, 0)
    const grassMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9, flatShading: true })
    )
    this.grass = new THREE.InstancedMesh(grassGeom, grassMat, GRASS_COUNT)
    for (let i = 0; i < GRASS_COUNT; i++) {
      this.grassData.push({
        x: GRASS_X_MIN + Math.random() * (GRASS_X_MAX - GRASS_X_MIN),
        z: -POLE_BEHIND + Math.random() * GRASS_WINDOW,
        s: 0.6 + Math.random() * 0.9,
      })
      this.setGrassColor(i)
    }
    this.group.add(this.grass)

    // ---- Mid-distance tree band ----
    const trunkGeom = this.track(new THREE.CylinderGeometry(0.3, 0.4, 2, 6))
    trunkGeom.translate(0, 1, 0)
    const trunkMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 })
    )
    const foliageGeom = this.track(new THREE.ConeGeometry(2.2, 5, 7))
    foliageGeom.translate(0, 4.5, 0)
    const foliageMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2e6b47, roughness: 0.85, flatShading: true })
    )
    this.trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, TREE_COUNT)
    this.foliage = new THREE.InstancedMesh(foliageGeom, foliageMat, TREE_COUNT)
    for (let i = 0; i < TREE_COUNT; i++) {
      this.treeData.push({
        x: TREE_X_MIN + Math.random() * (TREE_X_MAX - TREE_X_MIN),
        z: -150 + Math.random() * TREE_WINDOW,
        s: 1.5 + Math.random() * 2.5,
        rot: Math.random() * Math.PI * 2,
      })
    }
    this.group.add(this.trunks, this.foliage)
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
        g.x = GRASS_X_MIN + Math.random() * (GRASS_X_MAX - GRASS_X_MIN)
        g.s = 0.6 + Math.random() * 0.9
        this.setGrassColor(i)
      }
      this.dummy.position.set(g.x, this.sampleHeight(g.x, g.z), g.z)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(g.s)
      this.dummy.updateMatrix()
      this.grass.setMatrixAt(i, this.dummy.matrix)
    }
    this.grass.instanceMatrix.needsUpdate = true

    // Tree band: recycle, resample height on the natural terrain
    for (let i = 0; i < TREE_COUNT; i++) {
      const t = this.treeData[i]
      if (t.z < camZ - 150) {
        t.z += TREE_WINDOW
        t.x = TREE_X_MIN + Math.random() * (TREE_X_MAX - TREE_X_MIN)
        t.s = 1.5 + Math.random() * 2.5
      }
      this.dummy.position.set(t.x, this.sampleHeight(t.x, t.z), t.z)
      this.dummy.rotation.set(0, t.rot, 0)
      this.dummy.scale.setScalar(t.s)
      this.dummy.updateMatrix()
      this.trunks.setMatrixAt(i, this.dummy.matrix)
      this.foliage.setMatrixAt(i, this.dummy.matrix)
    }
    this.trunks.instanceMatrix.needsUpdate = true
    this.foliage.instanceMatrix.needsUpdate = true
  }

  /** Vary grass tint so the verge does not read as a uniform carpet. */
  private setGrassColor(i: number) {
    this.colorScratch.setHSL(0.26 + Math.random() * 0.06, 0.4, 0.22 + Math.random() * 0.14)
    this.grass.setColorAt(i, this.colorScratch)
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const resource of this.disposables) resource.dispose()
    this.disposables = []
    this.poles.dispose()
    this.poleArms.dispose()
    this.grass.dispose()
    this.trunks.dispose()
    this.foliage.dispose()
  }
}
