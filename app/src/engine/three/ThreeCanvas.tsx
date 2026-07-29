import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { TimeOfDay as TimeOfDayPreset } from '../time'
import { Scene3D } from './core/Scene3D'
import { CRUISE_SPEED, CRUISE_SPEED_KMH, cruiseSpeedForScheduledStop, TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { TerrainLOD } from './terrain/TerrainLOD'
import { WaterSystem } from './terrain/WaterSystem'
import { FieldPlots } from './terrain/FieldPlots'
import { SkyDome } from './sky/SkyDome'
import { TimeOfDay } from './sky/TimeOfDay'
import { WeatherSystem, WeatherType } from './weather/WeatherSystem'
import { WindowFrame, type WindowHudReadout } from './interior/WindowFrame'
import { TrackSystem } from './track/TrackSystem'
import { LinesideProps } from './track/LinesideProps'
import { StationManager } from './track/Station'
import { TunnelManager } from './track/Tunnel'
import { ValleyBridgeManager } from './track/ValleyBridge'
import { MountainRoadworkManager } from './track/MountainRoadworks'
import { PerfMonitor } from './core/PerfMonitor'
import { DebugMode } from './core/DebugMode'
import {
  createRoutePlan,
  nearestStationAnchor,
  routeContextAt,
  sampleRouteFeature,
  type RouteContext,
} from './terrain/RouteFeatures'

const MAX_DT = 0.1 // clamp delta time to avoid spiral of death on lag
export type WeatherPreset = WeatherType | 'auto'
export interface TrainMotionTelemetry {
  /** Current physical speed translated for the passenger HUD. */
  speedKmh: number
  /** 0..1 ratio for systems such as the rolling audio mix. */
  speedRatio: number
  /** Current physical acceleration, used by the synthesized traction/brake mix. */
  acceleration: number
}

/** Methods exposed to the parent for controlling the 3D train. */
export interface TrainControl {
  /** Set target speed (0 = stop at station, 15 = cruise). */
  setSpeed: (speed: number) => void
  /** Freeze/resume the journey simulation without losing its current motion state. */
  setPaused: (paused: boolean) => void
  /** Current camera Z position. */
  getZ: () => number
  /** Current rail grade as a fraction, e.g. 0.006 means 0.6%. */
  getGrade: () => number
  /** Current and upcoming terrain context at the physical camera position. */
  getRouteContext: () => RouteContext
  /** Current camera motion, used by the HUD and audio as the single source of truth. */
  getMotion: () => TrainMotionTelemetry
  /** Update the passive readouts mounted on the physical window surfaces. */
  setWindowHud: (readout: WindowHudReadout) => void
  /** Show a station ahead of the camera. */
  showStation: (name: string, zCenter: number) => void
  /** Select the authored route station that this focus segment will reach. */
  planStation: (name: string, durationSeconds: number) => void
  /** Build the next station outside the view before its arrival sequence starts. */
  prepareStation: (name: string) => void
  /** Create a station ahead and brake to its planned stop position. */
  approachStation: (name: string) => void
  /** Resume from a station with the gentler departure acceleration. */
  departStation: () => void
  /** Return the passenger view to the centered side-window pose. */
  resetView: () => void
  /** Remove the current station. */
  hideStation: () => void
}

interface ThreeCanvasProps {
  className?: string
  /** Parent passes a ref; we fill it with train control methods. */
  controlRef?: RefObject<TrainControl | null>
  /** Applies the setup-screen departure time to the 3D sky and lighting. */
  timePreset?: TimeOfDayPreset
  /** A concrete departure weather or the normal ambient weather cycle. */
  weatherPreset?: WeatherPreset
}

export default function ThreeCanvas({
  className,
  controlRef,
  timePreset = 'day',
  weatherPreset = 'auto',
}: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ---- Scene ----
    const scene = new Scene3D()
    const interiorScene = new THREE.Scene()
    // The route is selected once for this carriage session. Every streamed
    // system receives the same immutable plan, so a station never disagrees
    // with the terrain, roads, water, or railway engineering around it.
    const routePlan = createRoutePlan(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))

    // ---- Exterior group: everything outside the window frame ----
    // DebugMode F6 toggles this group's visibility to hide the outside world.
    const exteriorGroup = new THREE.Group()
    exteriorGroup.name = 'exterior'
    scene.add(exteriorGroup)

    // ---- Core systems ----
    const camera = new TrainCamera()
    const renderer = new WebGLRenderer()
    const terrain = new TerrainLOD(exteriorGroup, 'field', routePlan)
    const water = new WaterSystem(routePlan)
    const fields = new FieldPlots((x, z) => terrain.sampleHeight(x, z))
    const skyDome = new SkyDome()
    const timeOfDay = new TimeOfDay(timePreset)
    const weather = new WeatherSystem()
    weather.setOverride(weatherPreset === 'auto' ? null : weatherPreset)
    const windowFrame = new WindowFrame()
    const trackSystem = new TrackSystem()
    const lineside = new LinesideProps((x, z) => terrain.sampleHeight(x, z))
    const stations = new StationManager(routePlan)
    const tunnels = new TunnelManager(routePlan)
    const valleyBridges = new ValleyBridgeManager(routePlan)
    const mountainRoadworks = new MountainRoadworkManager((x, z) => terrain.sampleHeight(x, z), routePlan)
    const perfMonitor = new PerfMonitor(renderer.renderer)
    const debugMode = new DebugMode()
    let preparedStationStopZ: number | null = null
    let scheduledStationStopZ: number | null = null
    let scheduledStationCruiseSpeed: number | null = null
    let debugStationStopZ: number | null = null
    let debugStationStopTarget: number | null = null
    let debugStationBrakeAt = 0
    let debugStationDwellUntil: number | null = null
    let paused = false

    // Add exterior objects to the exteriorGroup
    exteriorGroup.add(skyDome.mesh)
    exteriorGroup.add(weather.group)
    exteriorGroup.add(trackSystem.group)
    exteriorGroup.add(lineside.group)
    exteriorGroup.add(stations.group)
    exteriorGroup.add(tunnels.group)
    exteriorGroup.add(valleyBridges.group)
    exteriorGroup.add(mountainRoadworks.group)
    exteriorGroup.add(water.mesh)
    exteriorGroup.add(fields.group)

    // The cabin renders in a dedicated foreground pass after the exterior.
    // This keeps weather and other transparent world effects behind the
    // physical carriage panels while preserving the view through the opening.
    interiorScene.add(windowFrame.group)

    scene.scene.fog = new THREE.Fog(0xbfe3f2, 200, 900)

    // Wire debug mode
    debugMode.init(scene.scene, exteriorGroup)
    debugMode.perfMonitor = perfMonitor

    // Show the origin station at the camera's starting position
    stations.showStation('Origin', camera.z)

    // Expose speed control to parent
    if (controlRef) {
      controlRef.current = {
        setSpeed: (s: number) => camera.setTargetSpeed(s),
        setPaused: (nextPaused: boolean) => { paused = nextPaused },
        getZ: () => camera.z,
        getGrade: () => camera.grade,
        getRouteContext: () => routeContextAt(camera.z, routePlan),
        getMotion: () => ({
          speedKmh: paused ? 0 : (camera.currentSpeed / CRUISE_SPEED) * CRUISE_SPEED_KMH,
          speedRatio: paused ? 0 : Math.min(1, camera.currentSpeed / CRUISE_SPEED),
          acceleration: paused ? 0 : camera.acceleration,
        }),
        setWindowHud: (readout: WindowHudReadout) => windowFrame.setHudReadout(readout),
        showStation: (name: string, zCenter: number) => stations.showStation(name, zCenter),
        planStation: (_name: string, durationSeconds: number) => {
          const anchor = nearestStationAnchor(camera.z, CRUISE_SPEED * durationSeconds, routePlan)
          scheduledStationStopZ = anchor.z - StationManager.APPROACH_STATION_LEAD
          scheduledStationCruiseSpeed = cruiseSpeedForScheduledStop(
            scheduledStationStopZ - camera.z,
            durationSeconds,
          )
        },
        prepareStation: (name: string) => {
          preparedStationStopZ = scheduledStationStopZ ?? camera.z + TrainCamera.STATION_PREPARE_DISTANCE
          stations.showStation(name, preparedStationStopZ + StationManager.APPROACH_STATION_LEAD)
        },
        approachStation: (name: string) => {
          const stopZ = preparedStationStopZ ?? scheduledStationStopZ ?? camera.z + TrainCamera.STATION_STOP_DISTANCE
          if (preparedStationStopZ === null) {
            stations.showStation(name, stopZ + StationManager.APPROACH_STATION_LEAD)
          }
          camera.beginStationApproach(stopZ)
          preparedStationStopZ = null
        },
        departStation: () => camera.departStation(scheduledStationCruiseSpeed ?? CRUISE_SPEED),
        resetView: () => camera.resetView(),
        hideStation: () => stations.hideStation(),
      }
    }

    const canvas = renderer.getDomElement()
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.cursor = 'grab'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    let activePointerId: number | null = null
    let lastPointerX = 0
    let lastPointerY = 0
    const endViewDrag = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return
      activePointerId = null
      canvas.style.cursor = 'grab'
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      activePointerId = event.pointerId
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onPointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return
      camera.panBy(event.clientX - lastPointerX, event.clientY - lastPointerY)
      lastPointerX = event.clientX
      lastPointerY = event.clientY
    }
    const onDoubleClick = () => camera.resetView()
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endViewDrag)
    canvas.addEventListener('pointercancel', endViewDrag)
    canvas.addEventListener('dblclick', onDoubleClick)

    const rect = container.getBoundingClientRect()
    camera.updateAspect(rect.width, rect.height)
    renderer.resize(rect.width, rect.height)

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(10, 20, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(2048, 2048)
    dirLight.shadow.camera.left = -50
    dirLight.shadow.camera.right = 50
    dirLight.shadow.camera.top = 50
    dirLight.shadow.camera.bottom = -50
    dirLight.shadow.camera.near = 0.5
    dirLight.shadow.camera.far = 200
    scene.add(dirLight)
    scene.add(dirLight.target)

    const interiorAmbient = new THREE.AmbientLight(0xf4f8f7, 0.46)
    interiorScene.add(interiorAmbient)
    const interiorKey = new THREE.DirectionalLight(0xffe5c5, 0.34)
    interiorKey.position.set(-2, 3, 2)
    interiorScene.add(interiorKey)

    // ---- Top-down state tracking ----
    let wasTopDown = false

    // ---- Biome boundary update throttle ----
    let lastSegmentZ = terrain.zSegmentStart
    let boundaryFrameCounter = 0

    let lastFrameTime = performance.now()
    let elapsedTime = 0
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)

      const now = performance.now()
      const dt = Math.min((now - lastFrameTime) / 1000, MAX_DT)
      lastFrameTime = now
      const simulationDt = paused ? 0 : dt
      elapsedTime += simulationDt

      // ---- Top-down camera toggle ----
      if (debugMode.isTopDown !== wasTopDown) {
        if (debugMode.isTopDown) {
          debugMode.enterTopDown(camera.camera)
        } else {
          debugMode.exitTopDown(camera.camera)
        }
        wasTopDown = debugMode.isTopDown
      }

      // Keep camera panning responsive while journey physics is paused.
      camera.update(dt, !paused)
      const jumpTarget = debugMode.consumeJumpTarget()
      if (jumpTarget !== null) camera.setZ(jumpTarget)
      if (debugMode.consumeStationProbe()) {
        const stopZ = camera.z + TrainCamera.STATION_PREPARE_DISTANCE
        stations.showStation('Test Station', stopZ + StationManager.APPROACH_STATION_LEAD)
        debugStationStopZ = stopZ
        debugStationStopTarget = stopZ
        debugStationDwellUntil = null
        debugStationBrakeAt = elapsedTime + TrainCamera.STATION_BRAKE_SECONDS
      }
      if (debugStationStopZ !== null && elapsedTime >= debugStationBrakeAt) {
        camera.beginStationApproach(debugStationStopZ)
        debugStationStopZ = null
      }
      if (
        debugStationStopTarget !== null &&
        debugStationDwellUntil === null &&
        camera.z >= debugStationStopTarget - 0.02
      ) {
        debugStationDwellUntil = elapsedTime + 3
      }
      if (debugStationDwellUntil !== null && elapsedTime >= debugStationDwellUntil) {
        camera.departStation()
        debugStationStopTarget = null
        debugStationDwellUntil = null
      }

      if (debugMode.isTopDown) {
        // Override position/orientation for top-down aerial view
        debugMode.applyTopDown(camera.camera)
      }

      const cam = camera.getCamera()
      const camPos = cam.position

      // Tunnel coverage must reach weather before rendering so snow/rain
      // cannot appear on the interior side of the bore wall.
      const tunnelD = tunnels.update(camPos.z)

      // Time of day drives sky, sun and lighting; weather modulates on top
      timeOfDay.update(simulationDt)
      const state = timeOfDay.state
      weather.update(simulationDt, cam, sampleRouteFeature(camPos.z, routePlan).current.biome)
      weather.setShelter(tunnelD)
      weather.applyToEnvironment(state)

      skyDome.update(camPos)
      skyDome.setSkyColors(state.horizonColor, state.zenithColor)
      skyDome.setSun(state.sunDirection, state.sunColor, state.sunSize, state.sunIntensity)
      skyDome.setStarOpacity(state.starOpacity)

      ambient.color.copy(state.ambientColor)
      dirLight.color.copy(state.dirColor)
      dirLight.position.copy(state.dirPosition).add(camPos)
      dirLight.target.position.copy(camPos)

      const fog = scene.scene.fog as THREE.Fog
      fog.color.copy(state.fogColor)

      // Tunnel enclosure: lights dim and fog closes in while inside the bore
      ambient.intensity = state.ambientIntensity * (1 - tunnelD * 0.8)
      dirLight.intensity = state.dirIntensity * (1 - tunnelD * 0.92)
      fog.near = THREE.MathUtils.lerp(state.fogNear, 8, tunnelD)
      fog.far = THREE.MathUtils.lerp(state.fogFar, 130, tunnelD)

      terrain.setDebugView(debugMode.terrainDebugView)
      terrain.setStreamingFrozen(debugMode.streamingFrozen)
      terrain.update(camPos)
      terrain.applyFrustumCulling(cam)
      trackSystem.update(camPos.z)
      lineside.update(camPos.z)
      stations.update(camPos.z, simulationDt, ambient.intensity)
      water.update(camPos.z, terrain.riverStrength, elapsedTime)
      valleyBridges.update(camPos.z)
      mountainRoadworks.update(camPos.z)
      fields.update(camPos.z, (z) => terrain.isBiomeAt(z, 'field'))
      windowFrame.update(
        cam,
        elapsedTime,
        weather.current === WeatherType.RAIN,
        Math.min(1, camera.currentSpeed / CRUISE_SPEED),
        tunnelD,
        ambient.intensity,
      )

      // Push fog back in top-down mode so terrain is visible from above
      const savedFogNear = fog.near
      const savedFogFar = fog.far
      if (debugMode.isTopDown) {
        fog.near = 400
        fog.far = 3000
      }

      // Top-down is an exterior-only terrain inspection view. In the normal
      // carriage view the interior remains a separate foreground pass.
      renderer.render(scene.scene, cam, debugMode.isTopDown ? undefined : interiorScene)
      perfMonitor.update() // F3 perf overlay

      // Restore fog for HUD boundary rendering
      if (debugMode.isTopDown) {
        fog.near = savedFogNear
        fog.far = savedFogFar
      }

      // ---- Debug HUD (F4) ----
      boundaryFrameCounter++
      if (boundaryFrameCounter % 30 === 0) {
        // Refresh biome boundaries if segment shifted
        if (terrain.zSegmentStart !== lastSegmentZ) {
          lastSegmentZ = terrain.zSegmentStart
          debugMode.updateBiomeBoundaries(
            terrain.zSegmentStart,
            TerrainLOD.SEGMENT_LENGTH,
            TerrainLOD.BLEND_LENGTH,
          )
        }
        // Refresh chunk grid
        debugMode.updateChunkBoundaries(camPos.z)
      }

      const info = renderer.renderer.info
      debugMode.updateHud({
        camPos,
        camSpeed: camera.currentSpeed,
        targetSpeed: camera.targetSpeed,
        routeGrade: camera.grade,
        routeElevation: camera.elevation,
        cameraPitch: camera.pitch,
        currentBiome: terrain.currentBiomeName,
        nextBiome: terrain.nextBiomeName,
        segmentStartZ: terrain.zSegmentStart,
        segmentLength: TerrainLOD.SEGMENT_LENGTH,
        blendLength: TerrainLOD.BLEND_LENGTH,
        chunkCount: terrain.chunkCount,
        fps: perfMonitor.currentFps,
        frameTime: perfMonitor.currentFrameTime,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        topDown: debugMode.topDown,
        sceneHidden: debugMode.sceneHidden,
        terrainDebugView: debugMode.terrainDebugView,
        streamingFrozen: debugMode.streamingFrozen,
        terrain: terrain.debugInfo,
      })
    }
    rafRef.current = requestAnimationFrame(loop)

    const onResize = () => {
      const r = container.getBoundingClientRect()
      camera.updateAspect(r.width, r.height)
      renderer.resize(r.width, r.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endViewDrag)
      canvas.removeEventListener('pointercancel', endViewDrag)
      canvas.removeEventListener('dblclick', onDoubleClick)
      if (controlRef) controlRef.current = null
      debugMode.dispose()
      terrain.dispose()
      water.dispose()
      fields.dispose()
      skyDome.dispose()
      weather.dispose()
      windowFrame.dispose()
      trackSystem.dispose()
      lineside.dispose()
      stations.dispose()
      tunnels.dispose()
      mountainRoadworks.dispose()
      perfMonitor.dispose()
      renderer.dispose()
      scene.dispose()
      interiorScene.clear()
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    }
  }, [controlRef, timePreset, weatherPreset])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'absolute', inset: 0, zIndex: 0 }}
    />
  )
}
