import * as THREE from 'three'

const RAIL_GAUGE = 1.5
const SEGMENT = 400 // track length that follows the camera (uniform, no seam)
const SLEEPER_SPACING = 1.2
const SLEEPER_COUNT = Math.ceil(SEGMENT / SLEEPER_SPACING)

/**
 * The permanent way: ballast strip, twin rails and sleepers.
 * Everything is uniform along Z, so the whole group follows the camera;
 * sleepers stay on a fixed world lattice via a modulo offset.
 */
export class TrackSystem {
  readonly group = new THREE.Group()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private sleepers: THREE.InstancedMesh
  private dummy = new THREE.Object3D()

  /** Procedural gravel speckle so the ballast reads as crushed stone up close. */
  private makeBallastTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#8a8078'
    ctx.fillRect(0, 0, size, size)
    // Scatter stones: mixed light/dark angular specks, a few warm ones
    const tones = ['#9a9188', '#7a7068', '#6a6158', '#a39a8e', '#5f564c', '#948a7a']
    for (let i = 0; i < 900; i++) {
      const s = 1 + Math.random() * 2.5
      ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)]
      ctx.fillRect(Math.random() * size, Math.random() * size, s, s * (0.6 + Math.random() * 0.8))
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 60)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(tex)
  }

  constructor() {
    const ballastMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xbdb4a8, // tinted down by the texture's own mid-grey
        map: this.makeBallastTexture(),
        roughness: 1.0,
        metalness: 0,
      })
    )
    const steelMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 0.95 })
    )
    const sleeperMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    )

    // Ballast bed: slightly raised trapezoid-ish strip
    const ballast = new THREE.Mesh(this.box(8, 0.18, SEGMENT), ballastMat)
    ballast.position.y = 0.09
    ballast.receiveShadow = true
    this.group.add(ballast)

    // Twin rails
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.box(0.09, 0.16, SEGMENT), steelMat)
      rail.position.set(side * (RAIL_GAUGE / 2), 0.26, 0)
      rail.castShadow = true
      this.group.add(rail)
    }

    // Sleepers (instanced), per-sleeper brown variation — weathered timber,
    // not a uniform plastic strip
    const sleeperGeom = this.track(new THREE.BoxGeometry(2.4, 0.12, 0.3))
    this.sleepers = new THREE.InstancedMesh(sleeperGeom, sleeperMat, SLEEPER_COUNT)
    this.sleepers.castShadow = true
    this.sleepers.receiveShadow = true
    const sleeperColor = new THREE.Color()
    for (let i = 0; i < SLEEPER_COUNT; i++) {
      this.dummy.position.set(0, 0.16, i * SLEEPER_SPACING - SEGMENT / 2)
      this.dummy.updateMatrix()
      this.sleepers.setMatrixAt(i, this.dummy.matrix)
      sleeperColor.setHSL(0.07, 0.35 + Math.random() * 0.15, 0.16 + Math.random() * 0.08)
      this.sleepers.setColorAt(i, sleeperColor)
    }
    if (this.sleepers.instanceColor) this.sleepers.instanceColor.needsUpdate = true
    this.group.add(this.sleepers)

    // Baked AO: dark contact strips under the rails and ballast
    this.addContactAO()
  }

  /** Fake ambient occlusion: dark strips where objects meet the ground. */
  private addContactAO() {
    // Wide soft strip under the entire ballast bed
    const aoMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      })
    )
    const strip = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(10, SEGMENT)),
      aoMat
    )
    strip.rotation.x = -Math.PI / 2
    strip.position.y = 0.005
    strip.renderOrder = 1
    this.group.add(strip)

    // Narrower, darker strip right under each rail
    const railAOMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    )
    for (const side of [-1, 1]) {
      const railAO = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(0.5, SEGMENT)),
        railAOMat
      )
      railAO.rotation.x = -Math.PI / 2
      railAO.position.set(side * (RAIL_GAUGE / 2), 0.17, 0)
      railAO.renderOrder = 2
      this.group.add(railAO)
    }
  }

  /** Follow the camera along Z; sleepers re-align to the world lattice. */
  update(camZ: number) {
    this.group.position.z = camZ
    this.sleepers.position.z = -(camZ % SLEEPER_SPACING)
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
    this.sleepers.dispose()
  }
}
