import * as THREE from 'three'
import grassSpriteUrl from './assets/foliage_grass_summer.1eae2f9a.png'
import bushSpriteUrl from './assets/foliage_bush_summer.e9e13de8.png'
import treesNearUrl from './assets/trees_summer_near_04.69997768.png'
import treesNearBUrl from './assets/trees_summer_near_04b.84790ad5.png'
import treesFarUrl from './assets/trees_summer_far_04.df59f729.png'
import treesFarBUrl from './assets/trees_summer_far_04b.2a814171.png'
import groundGrassUrl from './assets/grass_summer_01.d4364fbb.jpg'
import groundRockUrl from './assets/rock_06.e37dd9a2.jpg'
import groundRockBumpUrl from './assets/rock_06_bump.4570639b.jpg'
import ballastGravelUrl from './assets/gravel_01.490410e9.jpg'
import riverSandUrl from './assets/sand_01.b8a432e9.jpg'
import { configureSpriteAtlas } from './textureSampling'

/**
 * Shared textures, loaded once. Sprite atlases stay whole — per-variant UV
 * windows are baked into each geometry's uv attribute (see atlasQuadUVs),
 * so no texture cloning is needed and everything works while the image is
 * still streaming in.
 */

const loader = new THREE.TextureLoader()

function load(url: string, srgb = true, onLoad?: () => void): THREE.Texture {
  const tex = loader.load(url, onLoad)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---- Ground ----
export const groundGrassTex = load(groundGrassUrl)
export const groundRockTex = load(groundRockUrl)
export const groundRockBumpTex = load(groundRockBumpUrl, false)
export const riverSandTex = load(riverSandUrl)
let resolveBallastGravelReady!: () => void
/** Resolves only after the shared gravel image is available to clone safely. */
export const ballastGravelReady = new Promise<void>((resolve) => {
  resolveBallastGravelReady = resolve
})
export const ballastGravelTex = load(ballastGravelUrl, true, resolveBallastGravelReady)

// ---- Sprite atlases ----
export const grassSpriteTex = configureSpriteAtlas(load(grassSpriteUrl)) // 2x2, 4 clump variants
export const bushSpriteTex = configureSpriteAtlas(load(bushSpriteUrl))   // 2x2, 4 bush variants
export const treeNearTex = configureSpriteAtlas(load(treesNearUrl))      // 4x2
export const treeNearBTex = configureSpriteAtlas(load(treesNearBUrl))    // 4x2
export const treeFarTex = configureSpriteAtlas(load(treesFarUrl))        // 2x2
export const treeFarBTex = configureSpriteAtlas(load(treesFarBUrl))      // 2x2

/** Rewrite a geometry's uv attribute to address one cell of an atlas.
 *  col/row are 0-based; row 0 is the TOP row of the image. */
export function applyAtlasUV(
  geom: THREE.BufferGeometry,
  col: number,
  row: number,
  cols: number,
  rows: number,
): void {
  const uv = geom.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    uv.setXY(
      i,
      (col + u) / cols,
      1 - (row + 1) / rows + v / rows,
    )
  }
  uv.needsUpdate = true
}

export function disposeSharedTextures(): void {
  for (const tex of [
    groundGrassTex,
    groundRockTex,
    groundRockBumpTex,
    riverSandTex,
    ballastGravelTex,
    grassSpriteTex,
    bushSpriteTex,
    treeNearTex,
    treeNearBTex,
    treeFarTex,
    treeFarBTex,
  ]) {
    tex.dispose()
  }
}
