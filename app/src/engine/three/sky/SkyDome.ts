import * as THREE from 'three'

const SKY_RADIUS = 1000

const vertexShader = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 horizonColor;
uniform vec3 zenithColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float sunSize;
uniform float sunIntensity;

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);

  // Vertical gradient: horizon at eye level, zenith overhead
  float t = pow(clamp(dir.y, 0.0, 1.0), 0.55);
  vec3 sky = mix(horizonColor, zenithColor, t);

  // Sun disc + soft glow, larger near the horizon
  float sunDot = dot(dir, normalize(sunDirection));
  float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.4, sunDot);
  float glow = pow(max(sunDot, 0.0), 64.0) * 0.35;
  sky += sunColor * (disc + glow) * sunIntensity;

  gl_FragColor = vec4(sky, 1.0);
}
`

export class SkyDome {
  readonly mesh: THREE.Mesh
  private material: THREE.ShaderMaterial
  private stars: THREE.Points
  private starMaterial: THREE.PointsMaterial

  constructor() {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 32)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        horizonColor: { value: new THREE.Color(0xffdab9) },
        zenithColor: { value: new THREE.Color(0x1e3a5f) },
        sunColor: { value: new THREE.Color(0xfff5e1) },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        sunSize: { value: 0.002 },
        sunIntensity: { value: 1.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -100

    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    })
    this.stars = new THREE.Points(this.createStarGeometry(), this.starMaterial)
    this.stars.frustumCulled = false
    this.stars.renderOrder = -99
    this.mesh.add(this.stars)
  }

  private createStarGeometry(): THREE.BufferGeometry {
    const count = 600
    const positions = new Float32Array(count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      // Random points on the upper hemisphere of the dome
      do {
        v.set(Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1)
      } while (v.lengthSq() > 1 || v.y < 0.05)
      v.normalize().multiplyScalar(SKY_RADIUS * 0.95)
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }

  /** Keep the dome centered on the camera so it never gets closer. */
  update(cameraPos: THREE.Vector3) {
    this.mesh.position.copy(cameraPos)
  }

  setSkyColors(horizon: THREE.Color, zenith: THREE.Color) {
    ;(this.material.uniforms.horizonColor.value as THREE.Color).copy(horizon)
    ;(this.material.uniforms.zenithColor.value as THREE.Color).copy(zenith)
  }

  getHorizonColor(): THREE.Color {
    return this.material.uniforms.horizonColor.value as THREE.Color
  }

  setSun(direction: THREE.Vector3, color: THREE.Color, size: number, intensity: number) {
    ;(this.material.uniforms.sunDirection.value as THREE.Vector3).copy(direction)
    ;(this.material.uniforms.sunColor.value as THREE.Color).copy(color)
    this.material.uniforms.sunSize.value = size
    this.material.uniforms.sunIntensity.value = intensity
  }

  setStarOpacity(opacity: number) {
    this.starMaterial.opacity = opacity
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.stars.geometry.dispose()
    this.starMaterial.dispose()
  }
}
