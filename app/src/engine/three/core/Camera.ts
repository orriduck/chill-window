import * as THREE from 'three'
import { trackElevationAt, trackGradeAt } from '../terrain/RouteProfile'

const CRUISE_SPEED = 15 // units/sec, matches original
const ACCEL_RATE = 3.5 // speed units/sec² — gentle departure
const DECEL_RATE = 4.5 // slightly faster braking
const STATION_BRAKE_DECEL = 0.94
const STATION_DEPART_ACCEL = 1.5
const LOOK_AHEAD_X = 50
const LOOK_AHEAD_Z = 12
const LOOK_Y = 1.5
const CAMERA_Y = 2
const LOOK_DISTANCE = Math.hypot(LOOK_AHEAD_X, LOOK_AHEAD_Z)
const BASE_VIEW_YAW = Math.atan2(LOOK_AHEAD_X, LOOK_AHEAD_Z)
const BASE_VIEW_PITCH = Math.atan2(LOOK_Y - CAMERA_Y, LOOK_DISTANCE)
const MAX_VIEW_YAW = 0.24
const MAX_VIEW_PITCH = 0.1
const VIEW_SENSITIVITY = 0.0028

/**
 * Side-window train camera with speed-controlled vibration.
 * Vibration scales with current speed — smooth when stopped, gentle at cruise.
 */
export class TrainCamera {
  static readonly STATION_STOP_DISTANCE = (CRUISE_SPEED * CRUISE_SPEED) / (2 * STATION_BRAKE_DECEL)
  static readonly STATION_BRAKE_SECONDS = CRUISE_SPEED / STATION_BRAKE_DECEL
  /** Preload while the complete platform is still outside the side-window frustum. */
  static readonly STATION_PREPARE_DISTANCE =
    CRUISE_SPEED * TrainCamera.STATION_BRAKE_SECONDS + TrainCamera.STATION_STOP_DISTANCE

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
  private stationStopZ: number | null = null
  private departingStation = false
  private viewYaw = 0
  private viewPitch = 0
  private targetViewYaw = 0
  private targetViewPitch = 0
  private lookTarget = new THREE.Vector3()
  private viewDirection = new THREE.Vector3()

  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    this.applyViewPose(5, 0)
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
    this.stationStopZ = null
    this.departingStation = false
    this.targetSpeed = Math.max(0, speed)
  }

  /** Brake along a smooth physical curve and stop at the middle of a station. */
  beginStationApproach(stopZ: number) {
    this.stationStopZ = Math.max(stopZ, this.camera.position.z)
    this.departingStation = false
    this.targetSpeed = 0
  }

  /** Leave a station with a gentler acceleration than ordinary speed changes. */
  departStation(speed = CRUISE_SPEED) {
    this.stationStopZ = null
    this.departingStation = true
    this.targetSpeed = Math.max(0, speed)
  }

  /** Move the passenger's head within the side-window viewing range. */
  panBy(deltaX: number, deltaY: number) {
    this.targetViewYaw = THREE.MathUtils.clamp(
      this.targetViewYaw - deltaX * VIEW_SENSITIVITY,
      -MAX_VIEW_YAW,
      MAX_VIEW_YAW,
    )
    this.targetViewPitch = THREE.MathUtils.clamp(
      this.targetViewPitch - deltaY * VIEW_SENSITIVITY,
      -MAX_VIEW_PITCH,
      MAX_VIEW_PITCH,
    )
  }

  /** Restore the centered side-window view without affecting train motion. */
  resetView() {
    this.targetViewYaw = 0
    this.targetViewPitch = 0
  }

  /** Debug-only travel shortcut that preserves the normal side-window pose. */
  setZ(z: number) {
    this.stationStopZ = null
    this.departingStation = false
    this.applyViewPose(z, 0)
  }

  update(dt: number) {
    this.time += dt

    const currentZ = this.camera.position.z
    if (this.stationStopZ !== null) {
      const remaining = this.stationStopZ - currentZ
      if (remaining <= 0.02) {
        this.currentSpeed = 0
      } else {
        const brakingSpeed = Math.sqrt(2 * STATION_BRAKE_DECEL * remaining)
        this.currentSpeed = Math.min(this.currentSpeed, brakingSpeed)
      }
    } else {
      // --- Speed smoothing ---
      const diff = this.targetSpeed - this.currentSpeed
      if (Math.abs(diff) > 0.01) {
        const rate = diff > 0
          ? (this.departingStation ? STATION_DEPART_ACCEL : ACCEL_RATE)
          : DECEL_RATE
        this.currentSpeed += Math.sign(diff) * Math.min(rate * dt, Math.abs(diff))
      } else {
        this.currentSpeed = this.targetSpeed
        this.departingStation = false
      }
    }

    // --- Position ---
    const z = this.stationStopZ === null
      ? currentZ + this.currentSpeed * dt
      : Math.min(this.stationStopZ, currentZ + this.currentSpeed * dt)
    if (this.stationStopZ !== null && z >= this.stationStopZ) {
      this.currentSpeed = 0
    }
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

    const viewAlpha = 1 - Math.exp(-dt * 14)
    this.viewYaw += (this.targetViewYaw - this.viewYaw) * viewAlpha
    this.viewPitch += (this.targetViewPitch - this.viewPitch) * viewAlpha
    this.applyViewPose(z, amp)
  }

  private applyViewPose(z: number, vibration: number) {
    const yaw = BASE_VIEW_YAW + this.viewYaw
    const pitch = BASE_VIEW_PITCH + this.viewPitch
    const cosPitch = Math.cos(pitch)
    this.camera.position.set(
      this.vibX * vibration,
      trackElevationAt(z) + CAMERA_Y + this.vibY * vibration,
      z,
    )
    const targetZ = this.camera.position.z + Math.cos(yaw) * cosPitch * LOOK_DISTANCE
    this.lookTarget.set(
      this.camera.position.x + Math.sin(yaw) * cosPitch * LOOK_DISTANCE,
      trackElevationAt(targetZ) + CAMERA_Y + Math.sin(pitch) * LOOK_DISTANCE,
      targetZ,
    )
    this.camera.lookAt(this.lookTarget)
    this.camera.rotateZ(this.vibRoll * vibration)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /** Current Z position (for chunk tracking). */
  get z(): number {
    return this.camera.position.z
  }

  get grade(): number {
    return trackGradeAt(this.camera.position.z)
  }

  get elevation(): number {
    return trackElevationAt(this.camera.position.z)
  }

  get pitch(): number {
    this.camera.getWorldDirection(this.viewDirection)
    return Math.asin(this.viewDirection.y)
  }
}
