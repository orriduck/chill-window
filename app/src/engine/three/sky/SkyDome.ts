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

// Per-pixel hash for dithering (kills gradient banding)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vDir);
  float y = clamp(dir.y, 0.0, 1.0);

  // Three-stop gradient: horizon -> mid -> zenith. A mid mix keeps the
  // transition soft instead of a two-color ramp that bands near the horizon.
  vec3 midColor = mix(horizonColor, zenithColor, 0.45);
  float t = pow(y, 0.6);
  vec3 sky = t < 0.35
    ? mix(horizonColor, midColor, smoothstep(0.0, 0.35, t))
    : mix(midColor, zenithColor, smoothstep(0.35, 1.0, t));

  // Haze band hugging the horizon — softens the sky/terrain junction so the
  // world doesn't read as a hard color-card edge.
  float haze = pow(1.0 - y, 6.0);
  sky = mix(sky, horizonColor, haze * 0.85);

  // Sun: hot core + defined disc + wide halo. The halo (not the disc) carries
  // most of the dawn/dusk warmth, so a low sun tints the sky instead of
  // showing a pale grey coin.
  float sunDot = dot(dir, normalize(sunDirection));
  float core = smoothstep(1.0 - sunSize * 0.35, 1.0 - sunSize * 0.1, sunDot);
  float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.35, sunDot);
  float halo = pow(max(sunDot, 0.0), 32.0) * 0.5 + pow(max(sunDot, 0.0), 8.0) * 0.15;
  sky += sunColor * (core * 1.2 + disc * 0.55 + halo) * sunIntensity;

  // Below the horizon, settle on the horizon color (dome bottom, safety)
  sky = mix(horizonColor, sky, smoothstep(-0.06, 0.0, dir.y));

  // Dither to prevent banding in smooth gradients
  sky += (hash(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);

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
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      vertexColors: true, // per-star brightness: dim dust + a few bright anchors
    })
    this.stars = new THREE.Points(this.createStarGeometry(), this.starMaterial)
    this.stars.frustumCulled = false
    this.stars.renderOrder = -99
    this.mesh.add(this.stars)
  }

  private createStarGeometry(): THREE.BufferGeometry {
    const count = 900
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
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
      // Mostly dim dust, ~8% bright anchors, slight warm/cool variety
      const bright = Math.random() < 0.08 ? 0.9 + Math.random() * 0.1 : 0.25 + Math.random() * 0.45
      const warm = Math.random() < 0.3
      colors[i * 3] = bright
      colors[i * 3 + 1] = bright * (warm ? 0.92 : 0.97)
      colors[i * 3 + 2] = bright * (warm ? 0.82 : 1.0)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
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
