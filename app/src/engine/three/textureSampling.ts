import * as THREE from 'three'

/**
 * Atlas cells must not sample their neighbours when a tree is minified in the
 * distance. Mip levels blend across cell borders, which can read as a second
 * silhouette floating above the selected tree. Keep the source cell intact
 * and let the geometry control the visible resolution instead.
 */
export function configureSpriteAtlas(tex: THREE.Texture): THREE.Texture {
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}
