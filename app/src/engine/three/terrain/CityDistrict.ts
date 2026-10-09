import * as THREE from 'three'
import type { RandomSource } from '../core/procedural'

/** A bounded street-and-lot plan; one instanced batch per building scale. */
export function createCityDistrict(cx: number, cz: number, heightAt: (x: number, z: number) => number, random: RandomSource, compact = false): THREE.Group {
  const group = new THREE.Group()
  group.name = 'city-district'
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const dummy = new THREE.Object3D()
  for (const tall of [false, true]) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = tall ? 256 : 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = tall ? '#abb4b6' : '#c4bcae'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let y = 8; y < canvas.height; y += 18) for (let x = 7; x < 128; x += 16) {
      ctx.fillStyle = random() < 0.15 ? '#bac2c0' : '#344950'
      ctx.fillRect(x, y, 9, 11)
      ctx.fillStyle = '#e2e0d7'
      ctx.fillRect(x - 1, y + 11, 11, 2)
    }
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85 })
    const roof = new THREE.MeshStandardMaterial({ color: tall ? 0x737f81 : 0x837e73, roughness: 1 })
    const buildings = new THREE.InstancedMesh(geometry, [material, material, roof, roof, material, material], 180)
    let count = 0
    for (let row = 0; row < (compact ? 5 : 22); row++) for (let column = 0; column < (compact ? 5 : 7); column++) {
      const x = cx + 24 + column * 28
      const z = cz - (compact ? 56 : 420) + row * (compact ? 28 : 40)
      const centrality = Math.max(0, 1 - Math.abs(z - cz) / (compact ? 120 : 450))
      const isTower = column > 1 && centrality > 0.35 && (row + column) % 3 !== 0
      if (isTower !== tall || random() < 0.12) continue // courtyards and open lots
      const h = tall ? 22 + centrality * 26 + random() * 14 : 7 + random() * 9
      dummy.position.set(x, heightAt(x, z) + h / 2 - 0.1, z)
      dummy.scale.set(12 + random() * 5, h, 17 + random() * 7)
      dummy.updateMatrix()
      buildings.setMatrixAt(count, dummy.matrix)
      buildings.setColorAt(count, new THREE.Color().setHSL(0.09 + random() * 0.05, 0.06, 0.72 + random() * 0.22))
      count++
    }
    buildings.count = count
    buildings.castShadow = false
    buildings.receiveShadow = true
    buildings.computeBoundingSphere()
    group.add(buildings)
  }
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x666966, roughness: 1 })
  const street = (x: number, z: number, width: number, length: number) => {
    const geom = new THREE.PlaneGeometry(width, length, Math.max(1, Math.ceil(width / 12)), Math.max(1, Math.ceil(length / 12)))
    geom.rotateX(-Math.PI / 2)
    const points = geom.attributes.position.array as Float32Array
    for (let i = 0; i < points.length; i += 3) points[i + 1] = heightAt(x + points[i], z + points[i + 2]) + 0.08
    geom.computeVertexNormals()
    const mesh = new THREE.Mesh(geom, asphalt)
    mesh.position.set(x, 0, z)
    group.add(mesh)
  }
  for (let column = 0; column < (compact ? 6 : 8); column++) street(cx + 10 + column * 28, cz, 5, compact ? 144 : 890)
  for (let row = 0; row <= (compact ? 5 : 22); row += 2) street(cx + (compact ? 80 : 108), cz - (compact ? 70 : 440) + row * (compact ? 28 : 40), compact ? 144 : 220, 5)
  return group
}
