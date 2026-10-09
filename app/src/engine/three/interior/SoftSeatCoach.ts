import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture
type Track = <T extends Resource>(resource: T) => T

/** A window bay with two pairs of real upright seats. Coordinates follow the
 * coach wall: X along the train, Z into the aisle, Y relative to seated eyes.
 * Reference observations and material provenance live in REFERENCES.md. */
export function buildSoftSeatCoach(track: Track, centers: readonly number[], windowWidth: number, windowHeight: number) {
  const group = new THREE.Group()
  group.name = 'facing-soft-seat-bays'
  const texture = (kind: 'weave' | 'linen' | 'wood') => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = kind === 'weave' ? '#42686b' : kind === 'linen' ? '#ece7d9' : '#b18b5f'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 256; i += 2) {
      ctx.fillStyle = kind === 'wood' ? `rgba(65,37,15,${0.03 + (i % 11) * 0.006})` : 'rgba(255,255,255,.09)'
      ctx.fillRect(0, i, 256, 1)
      if (kind !== 'wood') {
        ctx.fillStyle = 'rgba(15,34,33,.13)'
        ctx.fillRect(i, 0, 1, 256)
      }
    }
    if (kind === 'weave') {
      ctx.fillStyle = 'rgba(193,208,170,.28)'
      for (let y = 0; y < 256; y += 18) for (let x = 0; x < 256; x += 18) {
        ctx.fillRect(x + (y % 36 ? 9 : 0), y, 2, 5)
      }
    }
    const tex = track(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 4
    return tex
  }
  const weave = texture('weave')
  const fabric = track(new THREE.MeshStandardMaterial({ map: weave, bumpMap: weave, bumpScale: 0.009, roughness: 0.94 }))
  const linenTex = texture('linen')
  const linen = track(new THREE.MeshStandardMaterial({ map: linenTex, bumpMap: linenTex, bumpScale: 0.004, roughness: 1 }))
  const edging = track(new THREE.MeshStandardMaterial({ color: 0x254246, roughness: 0.75 }))
  const hardware = track(new THREE.MeshStandardMaterial({ color: 0xb5bab5, roughness: 0.42, metalness: 0.45 }))
  const armrest = track(new THREE.MeshStandardMaterial({ color: 0x303b38, roughness: 0.7 }))
  const wood = track(new THREE.MeshStandardMaterial({ map: texture('wood'), roughness: 0.53 }))
  const ceramic = track(new THREE.MeshStandardMaterial({ color: 0xe5e1cd, roughness: 0.27 }))
  const tea = track(new THREE.MeshStandardMaterial({ color: 0x402b11, roughness: 0.18 }))
  const mesh = (parent: THREE.Group, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, radius = 0.04) => {
    const geometry = track(new RoundedBoxGeometry(...size, 3, Math.min(radius, Math.min(...size) / 2)))
    const object = new THREE.Mesh(geometry, mat)
    object.position.set(...pos)
    parent.add(object)
    return object
  }
  const seat = new THREE.Group()
  // Seat back spans across Z. The inside face points toward the opposite pair.
  mesh(seat, [0.25, 1.32, 1.08], [0, -0.40, 0], edging, 0.1)
  const back = mesh(seat, [0.23, 1.21, 1.01], [-0.13, -0.39, 0], fabric, 0.08)
  back.rotation.z = -0.055
  mesh(seat, [1.18, 0.28, 1.05], [-0.52, -1.13, 0], fabric, 0.1)
  mesh(seat, [1.1, 0.08, 1.07], [-0.52, -1.31, 0], edging)
  mesh(seat, [0.055, 0.29, 0.85], [-0.27, 0.05, 0], linen, 0.025)
  for (const z of [-0.5, 0.5]) {
    mesh(seat, [0.028, 1.04, 0.016], [-0.255, -0.47, z], edging, 0.007)
    mesh(seat, [0.82, 0.105, 0.09], [-0.46, -0.75, z * 1.17], armrest)
    mesh(seat, [0.055, 0.44, 0.045], [-0.12, -0.93, z * 1.17], hardware)
    mesh(seat, [0.07, 0.68, 0.07], [-0.36, -1.66, z * 0.84], hardware)
  }
  // A distinct front bolster and shallow lumbar pad read as upholstery,
  // with daylight between the outer armrest and the window wall.
  mesh(seat, [0.19, 0.24, 1.01], [-1.02, -1.10, 0], fabric, 0.08)
  mesh(seat, [0.13, 0.34, 0.92], [-0.28, -0.72, 0], fabric, 0.05)
  // One reusable mesh family for the whole coach, with shared textures/geometries.
  for (const centerX of centers) {
    for (const side of [-1, 1]) {
      for (const z of [0.94, 2.2]) {
        const chair = seat.clone(true)
        chair.position.set(centerX + side * 2.06, 0, z)
        if (side < 0) chair.rotation.y = Math.PI
        group.add(chair)
      }
    }
    mesh(group, [1.5, 0.09, 0.94], [centerX, -0.86, 0.79], wood, 0.045)
    mesh(group, [1.52, 0.024, 0.96], [centerX, -0.92, 0.79], hardware, 0.012)
    mesh(group, [0.08, 1.08, 0.1], [centerX, -1.47, 0.65], hardware)
    mesh(group, [0.65, 0.045, 0.38], [centerX, -2, 0.65], hardware)
    if (centerX === 0) {
      const cup = new THREE.Mesh(track(new THREE.CylinderGeometry(0.075, 0.065, 0.18, 24)), ceramic)
      cup.position.set(0.4, -0.715, 0.73)
      group.add(cup)
      const rim = new THREE.Mesh(track(new THREE.TorusGeometry(0.071, 0.009, 6, 24)), ceramic)
      rim.rotation.x = Math.PI / 2
      rim.position.set(0.4, -0.625, 0.73)
      group.add(rim)
      const liquid = new THREE.Mesh(track(new THREE.CircleGeometry(0.063, 24)), tea)
      liquid.rotation.x = -Math.PI / 2
      liquid.position.set(0.4, -0.636, 0.73)
      group.add(liquid)
      const handle = new THREE.Mesh(track(new THREE.TorusGeometry(0.047, 0.013, 8, 18)), ceramic)
      handle.position.set(0.488, -0.71, 0.73)
      group.add(handle)
      const book = new THREE.Group()
      mesh(book, [0.41, 0.018, 0.3], [0, 0, 0], edging, 0.008)
      mesh(book, [0.39, 0.033, 0.285], [0, 0.024, 0], linen, 0.008)
      mesh(book, [0.41, 0.012, 0.3], [0, 0.049, 0], edging, 0.006)
      book.position.set(-0.32, -0.802, 0.98)
      book.rotation.y = -0.16
      group.add(book)
    }
    // Bunched cloth, authored as a pleated surface, outside the clear aperture.
    for (const side of [-1, 1]) {
      const geometry = track(new THREE.PlaneGeometry(0.27, windowHeight + 0.07, 24, 12))
      const positions = geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i)
        const y = positions.getY(i)
        const pinch = 1 - 0.26 * Math.exp(-Math.pow((y + 0.42) * 3, 2))
        positions.setXYZ(i, x * pinch, y, Math.cos(x * 110) * 0.026)
      }
      geometry.computeVertexNormals()
      const curtain = new THREE.Mesh(geometry, linen)
      curtain.position.set(centerX + side * (windowWidth / 2 + 0.01), 0.3, 0.21)
      group.add(curtain)
      mesh(group, [0.23, 0.07, 0.06], [curtain.position.x, -0.12, 0.235], wood, 0.02)
    }
  }
  return group
}

/** Open metal shelves above the windows, never across the glass. */
export function buildSeatLuggageRacks(track: Track, centers: readonly number[], top: number) {
  const group = new THREE.Group()
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xc9c9bf, roughness: 0.45, metalness: 0.38 }))
  const railGeometry = track(new THREE.CylinderGeometry(0.018, 0.018, 4.7, 8))
  railGeometry.rotateZ(Math.PI / 2)
  const bracketGeometry = track(new THREE.BoxGeometry(0.045, 0.2, 0.6))
  for (const centerX of centers) {
    for (const z of [0.1, 0.25, 0.4, 0.55, 0.7]) {
      const rail = new THREE.Mesh(railGeometry, metal)
      rail.position.set(centerX, top + 0.18, z)
      group.add(rail)
    }
    for (const x of [-2.15, 0, 2.15]) {
      const bracket = new THREE.Mesh(bracketGeometry, metal)
      bracket.position.set(centerX + x, top + 0.13, 0.4)
      group.add(bracket)
    }
  }
  return group
}
