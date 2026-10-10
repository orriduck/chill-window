import * as THREE from 'three'

/** Readiness of the seven detailed tiles around the current geographic view.
 * Distant geometry remains visible until its matching source tile is uploaded. */
export class GeoDetailCoverage {
  readonly minTile = new THREE.Vector2()
  readonly pixels = new Uint8Array(7 * 7 * 4)
  readonly texture = new THREE.DataTexture(this.pixels, 7, 7, THREE.RGBAFormat)
  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
  }
  update(x: number, z: number, ready: (key: string) => boolean) {
    const minX = Math.floor(x / 256) - 3, minZ = Math.floor(z / 256) - 3
    this.minTile.set(minX, minZ)
    let changed = false
    for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
      const value = ready(`${minX + col},${minZ + row}`) ? 255 : 0, offset = (row * 7 + col) * 4
      if (this.pixels[offset] !== value || this.pixels[offset + 3] !== 255) changed = true
      this.pixels[offset] = value; this.pixels[offset + 3] = 255
    }
    if (changed) this.texture.needsUpdate = true
  }
  dispose() { this.texture.dispose() }
}

export const detailCoverageDeclarations = 'uniform sampler2D geoDetailCoverage;\nuniform vec2 geoDetailMinTile;'
export const detailCoverageLookup = (center: string) => `
vec2 geoDetailCell = floor(${center} / 256.0) - geoDetailMinTile;
float geoDetailReady = 0.0;
if (all(greaterThanEqual(geoDetailCell, vec2(0.0))) && all(lessThan(geoDetailCell, vec2(7.0)))) {
  geoDetailReady = texture2D(geoDetailCoverage, (geoDetailCell + 0.5) / 7.0).r;
}`
