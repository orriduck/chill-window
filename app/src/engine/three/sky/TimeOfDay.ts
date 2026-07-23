import * as THREE from 'three'

export const Phase = {
  DAWN: 0,
  DAY: 1,
  DUSK: 2,
  NIGHT: 3,
} as const
export type Phase = (typeof Phase)[keyof typeof Phase]

export const FULL_CYCLE_SECONDS = 300 // 5 minutes real time

interface PhaseKeyframe {
  horizon: number
  zenith: number
  sunColor: number
  sunIntensity: number
  ambientColor: number
  ambientIntensity: number
  dirColor: number
  dirIntensity: number
  fogNear: number
  fogFar: number
  starOpacity: number
}

const KEYS: Record<Phase, PhaseKeyframe> = {
  [Phase.DAWN]: {
    horizon: 0xffb27a,
    zenith: 0x8fa3cc,
    sunColor: 0xffd9a0,
    sunIntensity: 0.9,
    ambientColor: 0xffc4c4,
    ambientIntensity: 0.35,
    dirColor: 0xffb0a0,
    dirIntensity: 0.5,
    fogNear: 150,
    fogFar: 700,
    starOpacity: 0,
  },
  [Phase.DAY]: {
    horizon: 0xbfe3f2,
    zenith: 0x3a7bd5,
    sunColor: 0xfff5e1,
    sunIntensity: 1.2,
    ambientColor: 0xffffff,
    ambientIntensity: 0.45,
    dirColor: 0xffffff,
    dirIntensity: 0.9,
    fogNear: 200,
    fogFar: 900,
    starOpacity: 0,
  },
  [Phase.DUSK]: {
    horizon: 0xff8c5a,
    zenith: 0x4a3a6b,
    sunColor: 0xff9a5a,
    sunIntensity: 0.8,
    ambientColor: 0xd88a6a,
    ambientIntensity: 0.3,
    dirColor: 0xff8c50,
    dirIntensity: 0.45,
    fogNear: 120,
    fogFar: 600,
    starOpacity: 0.15,
  },
  [Phase.NIGHT]: {
    horizon: 0x1a2333,
    zenith: 0x05070f,
    sunColor: 0x000000,
    sunIntensity: 0,
    ambientColor: 0x6a7ab0,
    ambientIntensity: 0.18,
    dirColor: 0x8a9ac8,
    dirIntensity: 0.25,
    fogNear: 60,
    fogFar: 420,
    starOpacity: 1,
  },
}

const PHASE_COUNT = 4

/** Everything a frame needs to know about the current time of day. */
export class DayState {
  horizonColor = new THREE.Color()
  zenithColor = new THREE.Color()
  sunColor = new THREE.Color()
  sunDirection = new THREE.Vector3(0, 1, 0)
  sunSize = 0.002
  sunIntensity = 1
  ambientColor = new THREE.Color()
  ambientIntensity = 0.4
  dirColor = new THREE.Color()
  dirIntensity = 0.8
  dirPosition = new THREE.Vector3(10, 20, 10)
  fogColor = new THREE.Color()
  fogNear = 200
  fogFar = 900
  starOpacity = 0
}

export class TimeOfDay {
  private elapsed = 0
  readonly state = new DayState()

  private tmpA = new THREE.Color()
  private tmpB = new THREE.Color()

  get phase(): Phase {
    return (Math.floor((this.elapsed / FULL_CYCLE_SECONDS) * PHASE_COUNT) % PHASE_COUNT) as Phase
  }

  update(dt: number) {
    this.elapsed = (this.elapsed + dt) % FULL_CYCLE_SECONDS

    const cycleT = this.elapsed / FULL_CYCLE_SECONDS
    const phaseF = cycleT * PHASE_COUNT
    const phaseIndex = Math.floor(phaseF) % PHASE_COUNT
    const nextIndex = (phaseIndex + 1) % PHASE_COUNT
    // Smooth interpolation across each phase boundary
    const t = THREE.MathUtils.smoothstep(phaseF - Math.floor(phaseF), 0, 1)

    const a = KEYS[phaseIndex as Phase]
    const b = KEYS[nextIndex as Phase]
    const s = this.state

    s.horizonColor.copy(this.lerpColor(a.horizon, b.horizon, t))
    s.zenithColor.copy(this.lerpColor(a.zenith, b.zenith, t))
    s.sunColor.copy(this.lerpColor(a.sunColor, b.sunColor, t))
    s.ambientColor.copy(this.lerpColor(a.ambientColor, b.ambientColor, t))
    s.dirColor.copy(this.lerpColor(a.dirColor, b.dirColor, t))
    s.sunIntensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t)
    s.ambientIntensity = THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, t)
    s.dirIntensity = THREE.MathUtils.lerp(a.dirIntensity, b.dirIntensity, t)
    s.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, t)
    s.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, t)
    s.starOpacity = THREE.MathUtils.lerp(a.starOpacity, b.starOpacity, t)

    // Sun path: rises at DAWN start, peaks mid-DAY, sets at DUSK end.
    const daylightT = THREE.MathUtils.clamp(cycleT / 0.75, 0, 1)
    const elevation = Math.sin(daylightT * Math.PI) * THREE.MathUtils.degToRad(60)
    const azimuth = daylightT * Math.PI // east -> west
    const isNight = cycleT >= 0.75
    if (isNight) {
      // Moon: cool light from high above
      s.sunDirection.set(0, 1, -0.2).normalize()
    } else {
      s.sunDirection
        .set(Math.cos(azimuth), Math.sin(elevation), -0.45)
        .normalize()
    }
    // Larger sun near the horizon
    const lowFactor = 1 - Math.sin(Math.max(elevation, 0)) 
    s.sunSize = 0.0015 * (1 + lowFactor * 2.5)

    // Directional light hangs where the sun (or moon) is
    s.dirPosition.copy(s.sunDirection).multiplyScalar(100)
    s.dirPosition.z += 20

    // Fog blends to the horizon color
    s.fogColor.copy(s.horizonColor)
  }

  private lerpColor(a: number, b: number, t: number): THREE.Color {
    this.tmpA.setHex(a)
    this.tmpB.setHex(b)
    return this.tmpA.lerp(this.tmpB, t)
  }
}
