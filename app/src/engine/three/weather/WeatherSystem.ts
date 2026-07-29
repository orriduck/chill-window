import * as THREE from 'three'
import type { DayState } from '../sky/TimeOfDay'
import type { BiomeType } from '../terrain/Biome'

export const WeatherType = {
  CLEAR: 'clear',
  CLOUDY: 'cloudy',
  RAIN: 'rain',
  SNOW: 'snow',
  FOGGY: 'foggy',
} as const
export type WeatherType = (typeof WeatherType)[keyof typeof WeatherType]
type PrecipitationKind = 'rain' | 'snow'

const MAX_PARTICLES = 4000
const PARTICLE_BOX = { x: 140, y: 80, z: 140 }
const MAX_SPLASHES = 40
// A focus trip should not feel like it crosses several weather fronts.
// Auto weather is re-evaluated at most once over most journeys instead of
// being visibly shuffled every few minutes.
const MIN_SWITCH_SECONDS = 45 * 60
const MAX_SWITCH_SECONDS = 75 * 60
// Keep precipitation outside the carriage: transparent particles otherwise
// render over interior panels after the opaque scene pass.
const WINDOW_EXTERIOR_NEAR = 4

// Reused fog-tint colors — avoids per-frame allocation in applyToEnvironment()
const FOGGY_FOG_COLOR = new THREE.Color(0x9aa4ad)
const RAIN_FOG_COLOR = new THREE.Color(0x5a6570)
const SNOW_FOG_COLOR = new THREE.Color(0xe8eef2)

/** Weather that can plausibly be chosen by the automatic departure mode.
 * Snow needs higher ground in this compact route model; manual snow remains
 * available everywhere because it is an explicit passenger choice. */
export function automaticWeatherCandidates(biome: BiomeType): readonly WeatherType[] {
  const common: readonly WeatherType[] = [
    WeatherType.CLEAR,
    WeatherType.CLOUDY,
    WeatherType.RAIN,
    WeatherType.FOGGY,
  ]
  return biome === 'mountain' ? [...common, WeatherType.SNOW] : common
}

export function isAutomaticWeatherAllowed(weather: WeatherType, biome: BiomeType): boolean {
  return automaticWeatherCandidates(biome).includes(weather)
}

/** Preserve an explicit passenger preset; normalize only ambient auto weather
 * when a route segment no longer supports the current condition. */
export function weatherForRoute(
  current: WeatherType,
  override: WeatherType | null,
  biome: BiomeType,
): WeatherType {
  if (override !== null) return override
  return isAutomaticWeatherAllowed(current, biome) ? current : WeatherType.CLEAR
}

export function precipitationKindFor(weather: WeatherType): PrecipitationKind | null {
  if (weather === WeatherType.RAIN) return 'rain'
  if (weather === WeatherType.SNOW) return 'snow'
  return null
}

/** A single alpha sprite keeps particle quads from reading as white squares.
 * Snow is a soft disc; rain remains a narrow, vertically weighted streak. */
function createPrecipitationTexture(kind: PrecipitationKind): THREE.CanvasTexture {
  const width = kind === 'rain' ? 32 : 64
  const height = kind === 'rain' ? 96 : 64
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!

  if (kind === 'snow') {
    const radius = width * 0.5
    const glow = context.createRadialGradient(radius, radius, 0, radius, radius, radius)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.32, 'rgba(255,255,255,0.96)')
    glow.addColorStop(0.72, 'rgba(255,255,255,0.28)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)
  } else {
    const streak = context.createLinearGradient(0, 0, 0, height)
    streak.addColorStop(0, 'rgba(255,255,255,0)')
    streak.addColorStop(0.22, 'rgba(255,255,255,0.2)')
    streak.addColorStop(0.58, 'rgba(255,255,255,0.96)')
    streak.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = streak
    context.fillRect(width * 0.4, 0, width * 0.2, height)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface Cloud {
  mesh: THREE.Mesh
  speed: number
}

export class WeatherSystem {
  readonly group = new THREE.Group()
  current: WeatherType = WeatherType.CLEAR

  private clouds: Cloud[] = []
  private cloudGeo = new THREE.IcosahedronGeometry(1, 0)
  private cloudMat: THREE.MeshStandardMaterial | null = null

  // Pooled precipitation particles
  private points: THREE.Points
  private pointMat: THREE.PointsMaterial
  private positions = new Float32Array(MAX_PARTICLES * 3)
  private velocities = new Float32Array(MAX_PARTICLES * 3)
  private activeParticles = 0
  private particleKind: PrecipitationKind | null = null
  private particleOpacity = 0.7
  private snowParticleTexture: THREE.CanvasTexture
  private rainParticleTexture: THREE.CanvasTexture
  private shelter = 0
  private weatherForward = new THREE.Vector3()
  private weatherRight = new THREE.Vector3()

  // Pooled rain splashes
  private splashes: { mesh: THREE.Mesh; life: number }[] = []
  private splashGeo = new THREE.RingGeometry(0.06, 0.14, 8)

  private switchTimer = this.randomSwitchDelay()
  private time = 0
  private override: WeatherType | null = null

  constructor() {
    this.snowParticleTexture = createPrecipitationTexture('snow')
    this.rainParticleTexture = createPrecipitationTexture('rain')
    this.pointMat = new THREE.PointsMaterial({
      color: 0xaaccee,
      size: 0.12,
      map: this.snowParticleTexture,
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.04,
      depthWrite: false,
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setDrawRange(0, 0)
    this.points = new THREE.Points(geo, this.pointMat)
    this.points.frustumCulled = false
    this.points.visible = false
    this.group.add(this.points)

    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xcfe8ff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    for (let i = 0; i < MAX_SPLASHES; i++) {
      const mesh = new THREE.Mesh(this.splashGeo, splashMat.clone())
      mesh.rotation.x = -Math.PI / 2
      mesh.visible = false
      this.splashes.push({ mesh, life: 0 })
      this.group.add(mesh)
    }
  }

  setWeather(type: WeatherType) {
    if (type === this.current) return
    this.current = type
    this.switchTimer = this.randomSwitchDelay()
    this.rebuildClouds()
    this.configureParticles()
  }

  /** A departure preset holds weather steady; null resumes the ambient cycle. */
  setOverride(type: WeatherType | null) {
    this.override = type
    if (type !== null) this.setWeather(type)
    else this.switchTimer = this.randomSwitchDelay()
  }

  private randomSwitchDelay() {
    return MIN_SWITCH_SECONDS + Math.random() * (MAX_SWITCH_SECONDS - MIN_SWITCH_SECONDS)
  }

  private pickAutomaticWeather(biome: BiomeType): WeatherType {
    const types = automaticWeatherCandidates(biome)
    let next = types[Math.floor(Math.random() * types.length)]
    if (next === this.current) next = WeatherType.CLEAR
    return next
  }

  update(dt: number, camera: THREE.PerspectiveCamera, biome: BiomeType) {
    const cameraPos = camera.position
    this.time += dt
    const routeWeather = weatherForRoute(this.current, this.override, biome)
    if (routeWeather !== this.current) {
      // A snow event cannot continue across the route's lowland sections.
      // Reset to a quiet clear state rather than replacing it with another
      // arbitrary particle effect at the segment boundary.
      this.setWeather(routeWeather)
    } else if (this.override === null) {
      this.switchTimer -= dt
      if (this.switchTimer <= 0) {
        this.setWeather(this.pickAutomaticWeather(biome))
      }
    }

    this.group.position.set(0, 0, 0)
    this.updateClouds(dt, cameraPos)
    this.updateParticles(dt, camera)
    this.updateSplashes(dt)
  }

  /** Fade precipitation at a covered location such as a tunnel. Cloud state
   * can keep updating normally, while particles never cross the carriage view
   * through a solid tunnel wall. */
  setShelter(enclosure: number) {
    this.shelter = THREE.MathUtils.clamp(enclosure, 0, 1)
    const outdoors = 1 - this.shelter
    this.pointMat.opacity = this.particleOpacity * outdoors
    this.points.visible = this.particleKind !== null && outdoors > 0.02
  }

  /** Weather-driven overrides applied on top of the time-of-day state. */
  applyToEnvironment(state: DayState) {
    switch (this.current) {
      case WeatherType.FOGGY:
        state.fogNear = 50
        state.fogFar = 400
        state.sunIntensity = 0
        state.dirIntensity *= 0.5
        state.fogColor.lerp(FOGGY_FOG_COLOR, 0.5)
        break
      case WeatherType.RAIN:
        state.fogNear *= 0.6
        state.fogFar *= 0.7
        state.dirIntensity *= 0.6
        state.ambientIntensity *= 0.85
        state.sunIntensity *= 0.3
        state.fogColor.lerp(RAIN_FOG_COLOR, 0.4)
        break
      case WeatherType.SNOW:
        state.fogNear *= 0.7
        state.fogFar *= 0.75
        state.dirIntensity *= 0.8
        state.fogColor.lerp(SNOW_FOG_COLOR, 0.6)
        break
      case WeatherType.CLOUDY:
        state.dirIntensity *= 0.7
        state.sunIntensity *= 0.5
        break
      case WeatherType.CLEAR:
        break
    }
  }

  // ---- Clouds ----

  private rebuildClouds() {
    for (const cloud of this.clouds) {
      this.group.remove(cloud.mesh)
    }
    this.cloudMat?.dispose()
    this.cloudMat = null
    this.clouds = []

    const count =
      this.current === WeatherType.CLOUDY
        ? 40
        : this.current === WeatherType.RAIN || this.current === WeatherType.SNOW
          ? 25
          : 0
    if (count === 0) return

    const dark = this.current === WeatherType.RAIN
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: dark ? 0x8a929a : 0xffffff,
      transparent: true,
      opacity: dark ? 0.75 : 0.65,
      roughness: 1,
      flatShading: true,
    })

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.cloudGeo, this.cloudMat)
      const scale = 6 + Math.random() * 14
      mesh.scale.set(scale * (1.4 + Math.random()), scale * 0.5, scale)
      mesh.position.set(
        (Math.random() - 0.5) * 600,
        60 + Math.random() * 60,
        (Math.random() - 0.5) * 600
      )
      mesh.rotation.y = Math.random() * Math.PI * 2
      this.clouds.push({ mesh, speed: 1 + Math.random() * 2 })
      this.group.add(mesh)
    }
  }

  private updateClouds(dt: number, cameraPos: THREE.Vector3) {
    for (const cloud of this.clouds) {
      cloud.mesh.position.x += cloud.speed * dt
      // Wrap clouds around the camera
      if (cloud.mesh.position.x - cameraPos.x > 320) cloud.mesh.position.x -= 640
      if (cameraPos.x - cloud.mesh.position.x > 320) cloud.mesh.position.x += 640
      if (cloud.mesh.position.z - cameraPos.z > 320) cloud.mesh.position.z -= 640
      if (cameraPos.z - cloud.mesh.position.z > 320) cloud.mesh.position.z += 640
    }
  }

  // ---- Precipitation (pooled) ----

  private configureParticles() {
    const particleKind = precipitationKindFor(this.current)
    this.particleKind = particleKind
    this.pointMat.map = particleKind === 'rain'
      ? this.rainParticleTexture
      : particleKind === 'snow'
        ? this.snowParticleTexture
        : null
    this.pointMat.needsUpdate = true

    if (particleKind === 'rain') {
      this.activeParticles = 2500
      this.pointMat.color.setHex(0xaaccee)
      this.pointMat.size = 0.16
      this.particleOpacity = 0.6
    } else if (particleKind === 'snow') {
      this.activeParticles = 1800
      this.pointMat.color.setHex(0xffffff)
      this.pointMat.size = 0.18
      this.particleOpacity = 0.85
    } else {
      this.particleKind = null
      this.activeParticles = 0
      this.particleOpacity = 0
    }
    this.setShelter(this.shelter)
    this.points.geometry.setDrawRange(0, this.activeParticles)
  }

  private respawnParticle(i: number, cameraPos: THREE.Vector3) {
    const depth = WINDOW_EXTERIOR_NEAR + Math.random() * (PARTICLE_BOX.x - WINDOW_EXTERIOR_NEAR)
    const lateral = (Math.random() - 0.5) * PARTICLE_BOX.z
    this.positions[i * 3] = cameraPos.x + this.weatherForward.x * depth + this.weatherRight.x * lateral
    this.positions[i * 3 + 1] = cameraPos.y - 2 + Math.random() * PARTICLE_BOX.y
    this.positions[i * 3 + 2] = cameraPos.z + this.weatherForward.z * depth + this.weatherRight.z * lateral
    if (this.particleKind === 'rain') {
      this.velocities[i * 3] = -3
      this.velocities[i * 3 + 1] = -55 - Math.random() * 10
      this.velocities[i * 3 + 2] = -4
    } else {
      this.velocities[i * 3] = (Math.random() - 0.5) * 3
      this.velocities[i * 3 + 1] = -4 - Math.random() * 3
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3
    }
  }

  private updateParticles(dt: number, camera: THREE.PerspectiveCamera) {
    if (this.particleKind === null) return
    const cameraPos = camera.position
    camera.getWorldDirection(this.weatherForward)
    this.weatherRight.set(this.weatherForward.z, 0, -this.weatherForward.x).normalize()
    const groundY = cameraPos.y - 2

    for (let i = 0; i < this.activeParticles; i++) {
      if (this.positions[i * 3 + 1] === 0 && this.velocities[i * 3 + 1] === 0) {
        this.respawnParticle(i, cameraPos)
      }
      if (this.particleKind === 'snow') {
        this.velocities[i * 3] += Math.sin(this.time * 2 + i) * dt * 2
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt

      const dx = this.positions[i * 3] - cameraPos.x
      const dz = this.positions[i * 3 + 2] - cameraPos.z
      const forwardDepth = dx * this.weatherForward.x + dz * this.weatherForward.z
      if (
        this.positions[i * 3 + 1] < groundY ||
        Math.abs(dx) > PARTICLE_BOX.x / 2 ||
        Math.abs(dz) > PARTICLE_BOX.z / 2 ||
        forwardDepth < WINDOW_EXTERIOR_NEAR
      ) {
        if (this.particleKind === 'rain' && this.positions[i * 3 + 1] < groundY) {
          this.spawnSplash(this.positions[i * 3], groundY + 0.02, this.positions[i * 3 + 2])
        }
        this.respawnParticle(i, cameraPos)
      }
    }
    ;(this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
  }

  // ---- Rain splashes (pooled) ----

  private spawnSplash(x: number, y: number, z: number) {
    const splash = this.splashes.find((s) => !s.mesh.visible)
    if (!splash) return
    splash.mesh.position.set(x, y, z)
    splash.mesh.scale.setScalar(1)
    splash.mesh.visible = true
    splash.life = 0.3
    ;(splash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6
  }

  private updateSplashes(dt: number) {
    for (const splash of this.splashes) {
      if (!splash.mesh.visible) continue
      splash.life -= dt
      if (splash.life <= 0) {
        splash.mesh.visible = false
        continue
      }
      const t = 1 - splash.life / 0.3
      splash.mesh.scale.setScalar(1 + t * 3)
      ;(splash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t) * (1 - this.shelter)
    }
  }

  dispose() {
    this.cloudGeo.dispose()
    this.cloudMat?.dispose()
    this.points.geometry.dispose()
    this.pointMat.dispose()
    this.snowParticleTexture.dispose()
    this.rainParticleTexture.dispose()
    this.splashGeo.dispose()
    for (const splash of this.splashes) {
      ;(splash.mesh.material as THREE.Material).dispose()
    }
  }
}
