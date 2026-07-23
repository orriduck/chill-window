import * as THREE from 'three'
import type { DayState } from '../sky/TimeOfDay'

export const WeatherType = {
  CLEAR: 'clear',
  CLOUDY: 'cloudy',
  RAIN: 'rain',
  SNOW: 'snow',
  FOGGY: 'foggy',
} as const
export type WeatherType = (typeof WeatherType)[keyof typeof WeatherType]

const MAX_PARTICLES = 4000
const PARTICLE_BOX = { x: 140, y: 80, z: 140 }
const MAX_SPLASHES = 40
const MIN_SWITCH_SECONDS = 120
const MAX_SWITCH_SECONDS = 180

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
  private particleKind: 'rain' | 'snow' | null = null

  // Pooled rain splashes
  private splashes: { mesh: THREE.Mesh; life: number }[] = []
  private splashGeo = new THREE.RingGeometry(0.06, 0.14, 8)

  private switchTimer = this.randomSwitchDelay()
  private time = 0

  constructor() {
    this.pointMat = new THREE.PointsMaterial({
      color: 0xaaccee,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
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

  private randomSwitchDelay() {
    return MIN_SWITCH_SECONDS + Math.random() * (MAX_SWITCH_SECONDS - MIN_SWITCH_SECONDS)
  }

  private pickRandomWeather(): WeatherType {
    const types = [
      WeatherType.CLEAR,
      WeatherType.CLOUDY,
      WeatherType.RAIN,
      WeatherType.SNOW,
      WeatherType.FOGGY,
    ]
    let next = types[Math.floor(Math.random() * types.length)]
    if (next === this.current) next = WeatherType.CLEAR
    return next
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    this.time += dt
    this.switchTimer -= dt
    if (this.switchTimer <= 0) {
      this.setWeather(this.pickRandomWeather())
    }

    this.group.position.set(0, 0, 0)
    this.updateClouds(dt, cameraPos)
    this.updateParticles(dt, cameraPos)
    this.updateSplashes(dt)
  }

  /** Weather-driven overrides applied on top of the time-of-day state. */
  applyToEnvironment(state: DayState) {
    switch (this.current) {
      case WeatherType.FOGGY:
        state.fogNear = 50
        state.fogFar = 400
        state.sunIntensity = 0
        state.dirIntensity *= 0.5
        state.fogColor.lerp(new THREE.Color(0x9aa4ad), 0.5)
        break
      case WeatherType.RAIN:
        state.fogNear *= 0.6
        state.fogFar *= 0.7
        state.dirIntensity *= 0.6
        state.ambientIntensity *= 0.85
        state.sunIntensity *= 0.3
        state.fogColor.lerp(new THREE.Color(0x5a6570), 0.4)
        break
      case WeatherType.SNOW:
        state.fogNear *= 0.7
        state.fogFar *= 0.75
        state.dirIntensity *= 0.8
        state.fogColor.lerp(new THREE.Color(0xe8eef2), 0.6)
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
    if (this.current === WeatherType.RAIN) {
      this.particleKind = 'rain'
      this.activeParticles = 2500
      this.pointMat.color.setHex(0xaaccee)
      this.pointMat.size = 0.1
      this.pointMat.opacity = 0.6
    } else if (this.current === WeatherType.SNOW) {
      this.particleKind = 'snow'
      this.activeParticles = 1800
      this.pointMat.color.setHex(0xffffff)
      this.pointMat.size = 0.18
      this.pointMat.opacity = 0.85
    } else {
      this.particleKind = null
      this.activeParticles = 0
    }
    this.points.visible = this.particleKind !== null
    this.points.geometry.setDrawRange(0, this.activeParticles)
  }

  private respawnParticle(i: number, cameraPos: THREE.Vector3) {
    this.positions[i * 3] = cameraPos.x + (Math.random() - 0.5) * PARTICLE_BOX.x
    this.positions[i * 3 + 1] = cameraPos.y + Math.random() * PARTICLE_BOX.y
    this.positions[i * 3 + 2] = cameraPos.z + (Math.random() - 0.5) * PARTICLE_BOX.z
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

  private updateParticles(dt: number, cameraPos: THREE.Vector3) {
    if (this.particleKind === null) return
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
      if (
        this.positions[i * 3 + 1] < groundY ||
        Math.abs(dx) > PARTICLE_BOX.x / 2 ||
        Math.abs(dz) > PARTICLE_BOX.z / 2
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
      ;(splash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t)
    }
  }

  dispose() {
    this.cloudGeo.dispose()
    this.cloudMat?.dispose()
    this.points.geometry.dispose()
    this.pointMat.dispose()
    this.splashGeo.dispose()
    for (const splash of this.splashes) {
      ;(splash.mesh.material as THREE.Material).dispose()
    }
  }
}
