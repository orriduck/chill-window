import * as THREE from 'three'
import { hash01 } from '../core/procedural'

const PLOT_COUNT = 8
const PLOT_WINDOW = 1200 // recycle window along Z
const PLOT_BEHIND = 120
const PLOT_W = 36
const PLOT_L = 68
const PLOT_X_MIN = 32
const PLOT_X_MAX = 92

const BALE_COUNT = 12

type HeightSampler = (x: number, z: number) => number
type FieldSampler = (z: number) => boolean

export function shouldShowFieldBale(isField: boolean): boolean {
  return isField
}

/** Farm fields: rectangular crop plots that hug the terrain, painted with
 *  striped canvas textures (wheat, vegetables, ploughed soil, rapeseed),
 *  plus scattered hay bales. Active in the field biome; plots recycle
 *  along Z like the other lineside systems. */
export class FieldPlots {
  readonly group = new THREE.Group()
  private sampleHeight: HeightSampler
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private dummy = new THREE.Object3D()
  private colorScratch = new THREE.Color()

  private materials: THREE.MeshStandardMaterial[] = []
  private plots: { mesh: THREE.Mesh; cx: number; cz: number; index: number }[] = []
  private bales: THREE.InstancedMesh
  private baleData: { x: number; z: number; rot: number; s: number; visible: boolean }[] = []

  constructor(sampleHeight: HeightSampler) {
    this.sampleHeight = sampleHeight

    // One material per crop type, shared across plots
    this.materials = [
      this.makeCropMaterial('#c9a851', '#b08f3c', 0.25), // ripe wheat
      this.makeCropMaterial('#4e7c36', '#3c6329', 0.3), // green vegetables
      this.makeCropMaterial('#6e4c2f', '#5b3d25', 0.35), // ploughed soil
      this.makeCropMaterial('#d6c63a', '#b8a92c', 0.2), // flowering rapeseed
    ]

    for (let i = 0; i < PLOT_COUNT; i++) {
      const mesh = new THREE.Mesh(this.buildPlotGeometry(0, 0), this.materials[i % this.materials.length])
      mesh.receiveShadow = true
      const plot = {
        mesh,
        cx: 0,
        cz: -PLOT_BEHIND + (i / PLOT_COUNT) * PLOT_WINDOW + hash01(i, 0, 1) * 60,
        index: i,
      }
      plot.cx = this.plotX(i, plot.cz)
      this.rebuildPlot(plot)
      this.plots.push(plot)
      this.group.add(mesh)
    }

    // Hay bales: cylinders lying on their side, golden straw
    const baleGeom = this.track(new THREE.CylinderGeometry(0.85, 0.85, 1.4, 10))
    baleGeom.rotateZ(Math.PI / 2) // axis along X — lying on the field
    const baleMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }))
    this.bales = new THREE.InstancedMesh(baleGeom, baleMat, BALE_COUNT)
    this.bales.frustumCulled = false
    this.bales.castShadow = true
    for (let i = 0; i < BALE_COUNT; i++) {
      this.baleData.push({
        x: 0,
        z: -PLOT_BEHIND + hash01(i, 0, 11) * PLOT_WINDOW,
        rot: 0,
        s: 1,
        visible: true,
      })
      this.resetBale(i, this.baleData[i].z)
    }
    if (this.bales.instanceColor) this.bales.instanceColor.needsUpdate = true
    this.bales.instanceMatrix.needsUpdate = true
    this.group.add(this.bales)
  }

  /** Each plot follows its own world-space biome, so a whole field never
   * disappears in one frame when the train crosses a segment boundary. */
  update(camZ: number, isFieldAt: FieldSampler) {
    this.group.visible = true
    for (const plot of this.plots) {
      if (plot.cz + PLOT_L / 2 < camZ - PLOT_BEHIND) {
        plot.cz += PLOT_WINDOW
        plot.cx = this.plotX(plot.index, plot.cz)
        this.rebuildPlot(plot)
      }
      plot.mesh.visible = isFieldAt(plot.cz)
    }

    let balesChanged = false
    for (let i = 0; i < BALE_COUNT; i++) {
      const b = this.baleData[i]
      if (b.z < camZ - PLOT_BEHIND) {
        this.resetBale(i, b.z + PLOT_WINDOW)
        balesChanged = true
      }
      const visible = shouldShowFieldBale(isFieldAt(b.z))
      if (visible !== b.visible) {
        b.visible = visible
        this.writeBale(i)
        balesChanged = true
      }
    }
    if (balesChanged) {
      this.bales.instanceMatrix.needsUpdate = true
      if (this.bales.instanceColor) this.bales.instanceColor.needsUpdate = true
    }
  }

  /** Rebuild a plot's geometry at its current centre, conformed to terrain. */
  private rebuildPlot(plot: { mesh: THREE.Mesh; cx: number; cz: number; index: number }) {
    plot.mesh.geometry.dispose()
    plot.mesh.geometry = this.buildPlotGeometry(plot.cx, plot.cz)
    plot.mesh.material = this.materials[Math.floor(hash01(plot.index, plot.cz, 2) * this.materials.length)]
    // The geometry is built in world coordinates; keep the mesh at origin
    plot.mesh.position.set(0, 0, 0)
  }

  private plotX(index: number, z: number): number {
    return PLOT_X_MIN + hash01(index, z, 3) * (PLOT_X_MAX - PLOT_X_MIN)
  }

  private resetBale(index: number, z: number) {
    const bale = this.baleData[index]
    bale.z = z
    bale.x = PLOT_X_MIN + hash01(index, z, 12) * (PLOT_X_MAX - PLOT_X_MIN)
    bale.rot = hash01(index, z, 13) * Math.PI
    bale.s = 0.8 + hash01(index, z, 14) * 0.5
    bale.visible = true
    this.colorScratch.setHSL(
      0.11,
      0.45 + hash01(index, z, 15) * 0.15,
      0.42 + hash01(index, z, 16) * 0.12,
    )
    this.bales.setColorAt(index, this.colorScratch)
    this.writeBale(index)
  }

  private writeBale(index: number) {
    const bale = this.baleData[index]
    this.dummy.position.set(bale.x, this.sampleHeight(bale.x, bale.z) + 0.82 * bale.s, bale.z)
    this.dummy.rotation.set(0, bale.rot, 0)
    this.dummy.scale.setScalar(bale.visible ? bale.s : 0)
    this.dummy.updateMatrix()
    this.bales.setMatrixAt(index, this.dummy.matrix)
  }

  private buildPlotGeometry(cx: number, cz: number): THREE.BufferGeometry {
    const geom = new THREE.PlaneGeometry(PLOT_W, PLOT_L, 5, 9)
    geom.rotateX(-Math.PI / 2)
    const pos = geom.attributes.position.array as Float32Array
    for (let i = 0; i < pos.length; i += 3) {
      const wx = cx + pos[i]
      const wz = cz + pos[i + 2]
      pos[i] = wx
      pos[i + 1] = this.sampleHeight(wx, wz) + 0.07
      pos[i + 2] = wz
    }
    geom.computeVertexNormals()
    return geom
  }

  /** Crop rows: alternating tonal stripes with a little noise, tiled along
   *  the plot length so the rows read as planted furrows. */
  private makeCropMaterial(base: string, row: string, noiseAmp: number): THREE.MeshStandardMaterial {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    // Furrow stripes across the texture (rows run along v)
    const rows = 8
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = row
      ctx.fillRect(0, r * (size / rows), size, size / rows / 2)
    }
    // Grain noise so the rows aren't razor-flat
    for (let i = 0; i < 900; i++) {
      const v = Math.floor((Math.random() - 0.5) * 255 * noiseAmp)
      ctx.fillStyle = v > 0 ? `rgba(255,255,240,${v / 255})` : `rgba(20,16,8,${-v / 255})`
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5)
    }
    const tex = this.track(new THREE.CanvasTexture(canvas))
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(3, 6)
    tex.colorSpace = THREE.SRGBColorSpace
    return this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }))
  }

  private track<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  dispose() {
    for (const plot of this.plots) plot.mesh.geometry.dispose()
    for (const r of this.disposables) r.dispose()
    this.disposables = []
    this.bales.dispose()
  }
}
