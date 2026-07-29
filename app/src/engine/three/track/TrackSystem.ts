import * as THREE from 'three'
import { ballastGravelReady, ballastGravelTex } from '../textures'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'
import { configureBallastTexture } from './ballast'

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
  private ballastTexture: THREE.Texture | null = null
  private disposed = false

  constructor() {
    const ballastMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xd0c7bc,
        roughness: 1.0,
        metalness: 0,
      })
    )
    // Texture.clone() marks a texture for upload. Waiting until the shared
    // image exists avoids that upload happening with no source pixels.
    void ballastGravelReady.then(() => {
      if (this.disposed) return
      this.ballastTexture = this.track(ballastGravelTex.clone())
      configureBallastTexture(this.ballastTexture)
      ballastMat.map = this.ballastTexture
      ballastMat.needsUpdate = true
    })
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
    this.group.position.set(0, trackElevationAt(camZ), camZ)
    this.group.rotation.x = -Math.atan(trackGradeAt(camZ))
    this.sleepers.position.z = -(camZ % SLEEPER_SPACING)
    // The geometry follows the train for precision, but the texture remains
    // in world space so the crushed stone visibly passes beneath the window.
    if (this.ballastTexture) {
      this.ballastTexture.offset.y = THREE.MathUtils.euclideanModulo(
        (camZ / SEGMENT) * this.ballastTexture.repeat.y,
        1,
      )
    }
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.track(new THREE.BoxGeometry(w, h, d))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    this.disposed = true
    for (const resource of this.disposables) resource.dispose()
    this.disposables = []
    this.sleepers.dispose()
  }
}
