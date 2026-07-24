import * as THREE from 'three'

const CRUISE_SPEED = 15 // units/sec, matches original
const ACCEL_RATE = 3.5 // speed units/sec² — gentle departure
const DECEL_RATE = 4.5 // slightly faster braking
const LOOK_AHEAD_X = 50
const LOOK_AHEAD_Z = 12
const LOOK_Y = 1.5

/**
 * Side-window train camera with speed-controlled vibration.
 * Vibration scales with current speed — smooth when stopped, gentle at cruise.
 */
export class TrainCamera {
  camera: THREE.PerspectiveCamera
  private time = 0

  /** Target speed the camera accelerates toward (units/sec). */
  targetSpeed = CRUISE_SPEED
  /** Actual speed after smoothing. */
  currentSpeed = 0

  // Low-pass filtered vibration offsets
  private vibY = 0
  private vibX = 0
  private vibRoll = 0

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    this.camera.position.set(0, 2, 5)
    this.camera.lookAt(LOOK_AHEAD_X, LOOK_Y, 5)
    // Start stopped at the station — train departs when the journey begins
    this.currentSpeed = 0
    this.targetSpeed = 0
  }

  updateAspect(width: number, height: number) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /** Set desired travel speed. Camera accelerates/decelerates toward it. */
  setTargetSpeed(speed: number) {
    this.targetSpeed = Math.max(0, speed)
  }

  update(dt: number) {
    this.time += dt

    // --- Speed smoothing ---
    const diff = this.targetSpeed - this.currentSpeed
    if (Math.abs(diff) > 0.01) {
      const rate = diff > 0 ? ACCEL_RATE : DECEL_RATE
      this.currentSpeed += Math.sign(diff) * Math.min(rate * dt, Math.abs(diff))
    } else {
      this.currentSpeed = this.targetSpeed
    }

    // --- Position ---
    const z = this.camera.position.z + this.currentSpeed * dt
    this.camera.position.set(0, 2, z)
    this.camera.lookAt(LOOK_AHEAD_X, LOOK_Y, z + LOOK_AHEAD_Z)

    // --- Speed-scaled vibration ---
    // Normalize speed 0..1 for amplitude scaling
    const speedT = Math.min(1, this.currentSpeed / CRUISE_SPEED)
    // Square the factor so low speeds are very calm
    const amp = speedT * speedT

    // Raw oscillation at several incommensurate frequencies
    const t = this.time
    const rawY =
      Math.sin(t * 8.2) * 0.008 +
      Math.sin(t * 13.7 + 1.3) * 0.005 +
      Math.sin(t * 5.1 + 0.7) * 0.003
    const rawX =
      Math.sin(t * 9.4 + 0.7) * 0.005 +
      Math.sin(t * 6.3 + 2.1) * 0.003
    const rawRoll = Math.sin(t * 7.1) * 0.001

    // Low-pass filter: exponential moving average (smooths out high-freq jitter)
    const alpha = 1 - Math.exp(-dt * 12)
    this.vibY += (rawY - this.vibY) * alpha
    this.vibX += (rawX - this.vibX) * alpha
    this.vibRoll += (rawRoll - this.vibRoll) * alpha

    this.camera.position.y += this.vibY * amp
    this.camera.position.x += this.vibX * amp
    this.camera.rotateZ(this.vibRoll * amp)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /** Current Z position (for chunk tracking). */
  get z(): number {
    return this.camera.position.z
  }
}
