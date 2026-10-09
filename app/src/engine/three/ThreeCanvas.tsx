import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { TimeOfDay as TimeOfDayPreset } from '../time'
import { Scene3D } from './core/Scene3D'
import { CRUISE_SPEED, CRUISE_SPEED_KMH, cruiseSpeedForScheduledStop, TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { TerrainLOD } from './terrain/TerrainLOD'
import { WaterSystem } from './terrain/WaterSystem'
import { DistantHills } from './terrain/DistantHills'
import { WetlandDetails } from './terrain/WetlandDetails'
import { FieldPlots } from './terrain/FieldPlots'
import { SkyDome } from './sky/SkyDome'
import { TimeOfDay } from './sky/TimeOfDay'
import { WeatherSystem, WeatherType } from './weather/WeatherSystem'
import { WindowFrame, type WindowHudReadout, type WindowHudControlAnchor, type WindowHudControlHitArea } from './interior/WindowFrame'
import { TrackSystem } from './track/TrackSystem'
import { LinesideProps } from './track/LinesideProps'
import { StationManager } from './track/Station'
import { TunnelManager } from './track/Tunnel'
import { ValleyBridgeManager } from './track/ValleyBridge'
import { MountainRoadworkManager } from './track/MountainRoadworks'
import { LevelCrossingManager } from './track/LevelCrossing'
import { PerfMonitor } from './core/PerfMonitor'
import { TerrainEditor } from './core/TerrainEditor'
import { TerrainInspector } from './core/TerrainInspector'
import { landscapeAt } from './terrain/Landscape'
import { loadHudsonData } from './geography/GeoData'
import { RealWorld } from './geography/RealWorld'
import { GeoInspector } from './geography/GeoInspector'
import { DebugMode } from './core/DebugMode'
import {
  createContinuousRoutePlan,
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
  /** Set target speed (metres/second; 0 = stop at station). */
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
  /** Screen projection of the physical journey HUD's upper-right corner. */
  getWindowHudAnchor: () => WindowHudControlAnchor | null
  getWindowHudControlHitAreas: () => WindowHudControlHitArea[]
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
  onTerrainEditingChange?: (active: boolean) => void
}

export default function ThreeCanvas({
  className,
  controlRef,
  timePreset = 'day',
  weatherPreset = 'auto',
  onTerrainEditingChange,
}: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const terrainEditingListener = useRef(onTerrainEditingChange)
  useEffect(() => { terrainEditingListener.current = onTerrainEditingChange }, [onTerrainEditingChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ---- Scene ----
    const scene = new Scene3D()
    const interiorScene = new THREE.Scene()
    // The route is selected once for this carriage session. Every streamed
    // system receives the same immutable plan, so a station never disagrees
    // with the terrain, roads, water, or railway engineering around it.
    const worldQuery = new URLSearchParams(window.location.search)
    const routePlan = createContinuousRoutePlan(Number(worldQuery.get('worldSeed') ?? 42))

    let realWanted = true
    let realWorld: RealWorld | null = null
    let disposed = false
    let geographicDistance = 0
    let proceduralDistance = Number(worldQuery.get('worldZ') ?? 5)
    const geographicAbort = new AbortController()

    // ---- Exterior group: everything outside the window frame ----
    // DebugMode F6 toggles this group's visibility to hide the outside world.
    const exteriorGroup = new THREE.Group()
    exteriorGroup.name = 'exterior'
    scene.add(exteriorGroup)

    // ---- Core systems ----
    const camera = new TrainCamera()
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer()
    } catch {
      // Keep the React shell and setup controls mounted on environments that
      // cannot allocate WebGL (for example, a browser process without GPU
      // access) instead of letting an effect exception blank the whole app.
      if (controlRef) controlRef.current = null
      container.dataset.webgl = 'unavailable'
      scene.dispose()
      interiorScene.clear()
      return
    }
    const terrain = new TerrainLOD(exteriorGroup, 'field', routePlan)
    const water = new WaterSystem(routePlan)
    const fields = new FieldPlots((x, z) => terrain.sampleHeight(x, z))
    const wetlandDetails = new WetlandDetails((x, z) => terrain.sampleHeight(x, z))
    const distantHills = new DistantHills(z => landscapeAt(z, routePlan).lowland)
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
    const levelCrossings = new LevelCrossingManager(routePlan)
    const perfMonitor = new PerfMonitor(renderer.renderer)
    const debugMode = new DebugMode()
    debugMode.setGeographic(realWanted)
    debugMode.onTerrainEditingChange = active => terrainEditingListener.current?.(active)
    const terrainInspector = new TerrainInspector(routePlan)
    let preparedStationStopZ: number | null = null
    let scheduledStationStopZ: number | null = null
    let scheduledStationCruiseSpeed: number | null = null
    let debugStationStopZ: number | null = null
    let debugStationStopTarget: number | null = null
    let debugStationBrakeAt = 0
    let debugStationDwellUntil: number | null = null
    let paused = false
    let wasGrassProbe = false

    // Add exterior objects to the exteriorGroup
    exteriorGroup.add(skyDome.mesh)
    exteriorGroup.add(weather.group)
    exteriorGroup.add(trackSystem.group)
    exteriorGroup.add(lineside.group)
    exteriorGroup.add(stations.group)
    exteriorGroup.add(tunnels.group)
    exteriorGroup.add(valleyBridges.group)
    exteriorGroup.add(mountainRoadworks.group)
    exteriorGroup.add(levelCrossings.group)
    exteriorGroup.add(water.mesh)
    exteriorGroup.add(fields.group)
    exteriorGroup.add(wetlandDetails.group)
    exteriorGroup.add(distantHills.group)

    // The cabin renders in a dedicated foreground pass after the exterior.
    // This keeps weather and other transparent world effects behind the
    // physical carriage panels while preserving the view through the opening.
    interiorScene.add(windowFrame.group)

    scene.scene.fog = new THREE.Fog(0xbfe3f2, 200, 900)

    // Wire debug mode
    debugMode.init(scene.scene, exteriorGroup)
    debugMode.perfMonitor = perfMonitor
    debugMode.attachCarriageInspector((part, visible) => windowFrame.setDebugPartVisible(part, visible))

    // Show the origin station at the camera's starting position
    stations.showStation('Origin', camera.z)

    // Expose speed control to parent
    if (controlRef) {
      controlRef.current = {
        setSpeed: (s: number) => camera.setTargetSpeed(s),
        setPaused: (nextPaused: boolean) => { paused = nextPaused },
        getZ: () => camera.z,
        getGrade: () => camera.grade,
        getRouteContext: () => ({ ...routeContextAt(camera.z, routePlan), ...(realWanted ? { currentLabel: 'Hudson Highlands · 真实路线', nextLabel: 'Empire Service · 南行' } : {}) }),
        getMotion: () => ({
          speedKmh: paused || debugMode.isTopDown || (realWanted && !realWorld) ? 0 : (camera.currentSpeed / CRUISE_SPEED) * CRUISE_SPEED_KMH,
          speedRatio: paused || debugMode.isTopDown || (realWanted && !realWorld) ? 0 : Math.min(1, camera.currentSpeed / CRUISE_SPEED),
          acceleration: paused || debugMode.isTopDown || (realWanted && !realWorld) ? 0 : camera.acceleration,
        }),
        setWindowHud: (readout: WindowHudReadout) => windowFrame.setHudReadout(realWanted ? {
          ...readout, journey: 'Hudson Highlands · 南行', routeLabel: 'Empire Service · 南行', segmentLabel: 'Hudson Highlands · 真实路线',
          stationNames: ['样板起点', '样板终点'], currentSegment: 0,
          progress: realWorld ? camera.z / realWorld.data.length : 0,
        } : readout),
        getWindowHudAnchor: () => windowFrame.getHudControlAnchor(camera.getCamera()),
        getWindowHudControlHitAreas: () => windowFrame.getHudControlHitAreas(camera.getCamera()),
        showStation: (name: string, zCenter: number) => { if (!realWanted) stations.showStation(name, zCenter) },
        planStation: (name: string, durationSeconds: number) => {
          if (realWanted) return
          const cruiseSeconds = durationSeconds - CRUISE_SPEED / (2 * TrainCamera.DEPARTURE_ACCELERATION) - TrainCamera.STATION_BRAKE_SECONDS / 2
          const anchor = nearestStationAnchor(camera.z, CRUISE_SPEED * Math.max(1, cruiseSeconds), routePlan)
          scheduledStationStopZ = anchor.z - StationManager.APPROACH_STATION_LEAD
          scheduledStationCruiseSpeed = cruiseSpeedForScheduledStop(
            scheduledStationStopZ - camera.z,
            durationSeconds,
          )
          stations.queueStation(name, anchor.z)
        },
        prepareStation: (name: string) => {
          if (realWanted) return
          preparedStationStopZ = scheduledStationStopZ ?? camera.z + TrainCamera.STATION_PREPARE_DISTANCE
          stations.activateQueuedStation(name, preparedStationStopZ + StationManager.APPROACH_STATION_LEAD)
        },
        approachStation: (name: string) => {
          if (realWanted) { camera.beginStationApproach(Math.min(realWorld?.data.length ?? camera.z, camera.z + TrainCamera.STATION_STOP_DISTANCE)); return }
          const stopZ = preparedStationStopZ ?? scheduledStationStopZ ?? camera.z + TrainCamera.STATION_STOP_DISTANCE
          if (preparedStationStopZ === null) {
            stations.activateQueuedStation(name, stopZ + StationManager.APPROACH_STATION_LEAD)
          }
          camera.beginStationApproach(stopZ)
          preparedStationStopZ = null
        },
        departStation: () => camera.departStation(realWanted ? CRUISE_SPEED : scheduledStationCruiseSpeed ?? CRUISE_SPEED),
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
    const terrainEditor = new TerrainEditor(terrain, canvas, scene.scene)
    terrainInspector.attachEditor(terrainEditor)
    const geoInspector = new GeoInspector(canvas, realWanted)
    terrainInspector.setGeographic(realWanted)
    const applyGeographicMode = (real: boolean) => {
      if (real !== realWanted) {
        if (realWanted) geographicDistance = camera.z
        else proceduralDistance = camera.z
        preparedStationStopZ = scheduledStationStopZ = debugStationStopZ = debugStationStopTarget = debugStationDwellUntil = null
      }
      realWanted = real
      debugMode.setGeographic(real)
      geoInspector.setReal(real); terrainInspector.setGeographic(real)
      camera.setRailProfile(real && realWorld ? { height: s => realWorld!.data.railHeight(s), grade: s => realWorld!.data.railGrade(s) } : null)
      camera.setZ(real ? geographicDistance : proceduralDistance)
      camera.getCamera().far = real ? 8000 : 2000; camera.getCamera().updateProjectionMatrix()
      if (real && debugMode.isTopDown) geoInspector.recenter(camera.z)
    }
    void loadHudsonData(geographicAbort.signal).then(data => {
      if (disposed) return
      realWorld = new RealWorld(data); exteriorGroup.add(realWorld.group)
      geographicDistance = THREE.MathUtils.clamp(Number(worldQuery.get('routeMetres') ?? data.checkpoints[0].s), 0, data.length)
      geoInspector.setData(data)
      if (realWanted) applyGeographicMode(true)
    }).catch(error => {
      if (!disposed && error.name !== 'AbortError') geoInspector.fail(error.message)
    })

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
      if (event.button !== 0 || debugMode.isTopDown) return
      activePointerId = event.pointerId
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onPointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || debugMode.isTopDown) return
      camera.panBy(event.clientX - lastPointerX, event.clientY - lastPointerY)
      lastPointerX = event.clientX
      lastPointerY = event.clientY
    }
    const onDoubleClick = () => { if (!debugMode.isTopDown) camera.resetView() }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endViewDrag)
    canvas.addEventListener('pointercancel', endViewDrag)
    canvas.addEventListener('dblclick', onDoubleClick)

    const rect = container.getBoundingClientRect()
    camera.updateAspect(rect.width, rect.height)
    terrainEditor.resize(rect.width, rect.height)
    geoInspector.resize(rect.width, rect.height)
    renderer.resize(rect.width, rect.height)

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(10, 20, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(2048, 2048)
    dirLight.shadow.normalBias = 0.08
    dirLight.shadow.bias = -0.0002
    dirLight.shadow.camera.left = -50
    dirLight.shadow.camera.right = 50
    dirLight.shadow.camera.top = 50
    dirLight.shadow.camera.bottom = -50
    dirLight.shadow.camera.near = 0.5
    dirLight.shadow.camera.far = 200
    scene.add(dirLight)
    scene.add(dirLight.target)

    const interiorAmbient = new THREE.AmbientLight(0xf4f8f7, 0.85)
    interiorScene.add(interiorAmbient)
    const interiorKey = new THREE.DirectionalLight(0xffe5c5, 0.65)
    interiorKey.position.set(-2, 3, 2)
    interiorScene.add(interiorKey)

    // ---- Biome boundary update throttle ----
    let lastSegmentZ = terrain.zSegmentStart
    let boundaryFrameCounter = 0

    let motionSampleTime = performance.now()
    let motionSampleZ = camera.z
    let measuredSpeed = 0
    let lastFrameTime = performance.now()
    let elapsedTime = 0
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)

      const now = performance.now()
      const motionDt = Math.min((now - lastFrameTime) / 1000, 1)
      const dt = Math.min(motionDt, MAX_DT)
      lastFrameTime = now
      if (debugMode.grassProbe !== wasGrassProbe) {
        wasGrassProbe = debugMode.grassProbe
        weather.setOverride(debugMode.grassProbe ? WeatherType.CLEAR : (weatherPreset === 'auto' ? null : weatherPreset))
        if (debugMode.grassProbe) camera.setTargetSpeed(0)
      }
      if (debugMode.grassProbe) {
        timeOfDay.setPreset('day')
        camera.setTargetSpeed(0)
      }

      const geoCommand = geoInspector.consume()
      if (geoCommand.editing !== undefined) debugMode.setTerrainEditing(geoCommand.editing)
      if (geoCommand.recenter) geoInspector.recenter(camera.z)
      if (geoCommand.jump !== undefined && realWorld) {
        camera.setZ(THREE.MathUtils.clamp(geoCommand.jump, 0, realWorld.data.length))
        geoInspector.recenter(camera.z); motionSampleZ = camera.z; motionSampleTime = now; measuredSpeed = 0
      }
      if (geoCommand.time) timeOfDay.setPreset(geoCommand.time)
      if (geoCommand.weather) weather.setOverride(geoCommand.weather === 'rain' ? WeatherType.RAIN : WeatherType.CLEAR)
      const worldCommand = terrainInspector.consume()
      if (worldCommand.z !== undefined && !realWanted) {
        camera.setZ(worldCommand.z)
        motionSampleZ = camera.z
        motionSampleTime = now
        measuredSpeed = 0
      }
      if (worldCommand.speed !== undefined) {
        paused = false
        camera.setTargetSpeed(worldCommand.speed / 3.6)
        camera.currentSpeed = worldCommand.speed / 3.6
      }
      if (worldCommand.aerial !== undefined) debugMode.setTerrainEditing(worldCommand.aerial)
      if (worldCommand.recenter) terrainEditor.recenter(camera.z)
      if (worldCommand.inspectZ !== undefined) terrainEditor.recenter(worldCommand.inspectZ)
      if (worldCommand.mask !== undefined) debugMode.terrainDebugView = worldCommand.mask ? 1 : 0
      if (worldCommand.time) timeOfDay.setPreset(worldCommand.time)
      if (worldCommand.weather) weather.setOverride(worldCommand.weather === 'rain' ? WeatherType.RAIN : WeatherType.CLEAR)
      const editorMode = debugMode.isTopDown
      const simulationDt = paused || editorMode || (realWanted && !realWorld) ? 0 : dt
      elapsedTime += paused || editorMode || (realWanted && !realWorld) ? 0 : motionDt

      const passengerView = debugMode.consumePassengerView()
      if (passengerView) {
        camera.setPassengerView(passengerView)
        windowFrame.setPassengerView(passengerView)
      }
      const scenePreset = debugMode.consumeScenePreset()
      if (scenePreset && realWanted) {
        if (scenePreset === 'night') timeOfDay.setPreset('night')
        if (scenePreset === 'rain') weather.setOverride(WeatherType.RAIN)
      }
      if (scenePreset && !realWanted) {
        debugMode.grassProbe = false
        const biome = scenePreset === 'forest' ? 'forest' : scenePreset === 'lake' ? 'river' : scenePreset === 'mountain' ? 'mountain' : 'field'
        const segment = routePlan.beats.findIndex(beat => beat.biome === biome)
        camera.setZ(Math.max(0, segment) * 1500 + (scenePreset === 'lake' ? 1090 : 650))
        camera.resetView()
        motionSampleZ = camera.z
        motionSampleTime = now
        measuredSpeed = 0
        camera.setTargetSpeed(CRUISE_SPEED)
        camera.currentSpeed = CRUISE_SPEED
        timeOfDay.setPreset(scenePreset === 'night' ? 'night' : 'day')
        weather.setOverride(scenePreset === 'rain' ? WeatherType.RAIN : WeatherType.CLEAR)
      }

      const speedPreset = debugMode.consumeSpeedPreset()
      if (speedPreset !== null) {
        camera.setTargetSpeed(speedPreset / 3.6)
        camera.currentSpeed = speedPreset / 3.6
      }

      // Keep camera panning responsive while journey physics is paused.
      if (realWanted && realWorld && camera.targetSpeed > 0 && realWorld.data.length - camera.z <= TrainCamera.STATION_STOP_DISTANCE) camera.beginStationApproach(realWorld.data.length)
      camera.update(motionDt, !paused && !editorMode && (!realWanted || !!realWorld))
      if (realWanted && realWorld && camera.z > realWorld.data.length) { camera.setZ(realWorld.data.length); camera.setTargetSpeed(0); camera.currentSpeed = 0 }
      if (realWanted && realWorld && camera.currentSpeed === 0 && camera.targetSpeed === 0 && realWorld.data.length - camera.z < 0.05) camera.setZ(realWorld.data.length)
      const jumpTarget = debugMode.consumeJumpTarget()
      if (jumpTarget !== null) {
        camera.setZ(realWanted && realWorld ? realWorld.data.checkpoints[jumpTarget === 3400 ? 2 : jumpTarget === 5450 ? 0 : 1].s : jumpTarget)
        motionSampleZ = camera.z
        motionSampleTime = now
        measuredSpeed = 0
      }
      if (now - motionSampleTime >= 1000) {
        measuredSpeed = Math.abs(camera.z - motionSampleZ) / ((now - motionSampleTime) / 1000)
        motionSampleZ = camera.z
        motionSampleTime = now
      }
      debugMode.updateMotion(camera.z, paused || editorMode ? 0 : camera.currentSpeed, measuredSpeed)

      if (debugMode.consumeStationProbe() && !realWanted) {
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

      terrainEditor.setEnabled(editorMode && !realWanted, camera.z)
      terrainEditor.update(camera.z)
      terrainInspector.setEditing(editorMode)
      geoInspector.setEditing(editorMode, camera.z)
      const cam = editorMode ? (realWanted ? geoInspector.camera : terrainEditor.camera) : camera.getCamera()
      const camPos = editorMode ? (realWanted ? geoInspector.focus : terrainEditor.focus) : cam.position

      // Tunnel coverage must reach weather before rendering so snow/rain
      // cannot appear on the interior side of the bore wall.
      const geographicPose = realWorld?.data.pose(camera.z)
      const tunnelD = realWanted ? (!editorMode && geographicPose && realWorld?.data.engineeringKindAt(geographicPose.x, geographicPose.z) === 'tunnel' ? 1 : 0) : tunnels.update(camPos.z)

      // Time of day drives sky, sun and lighting; weather modulates on top
      timeOfDay.update(simulationDt)
      const state = timeOfDay.state
      const cabinDarkness = Math.max(state.starOpacity, tunnelD)
      interiorAmbient.intensity = THREE.MathUtils.lerp(0.85, 0.4, cabinDarkness)
      interiorKey.intensity = THREE.MathUtils.lerp(0.65, 0.2, cabinDarkness)
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

      if (realWanted) {
        if (realWorld) { realWorld.group.visible = true; realWorld.update(camera.z, editorMode, geoInspector.focus, geoInspector.layers) }
        terrain.surfaceVisible = terrain.vegetationVisible = terrain.settlementsVisible = terrain.farmlandVisible = terrain.waterVisible = false
        terrain.applyFrustumCulling(cam)
        for (const group of [trackSystem.group, lineside.group, stations.group, tunnels.group, valleyBridges.group, mountainRoadworks.group, levelCrossings.group, water.mesh, fields.group, wetlandDetails.group, distantHills.group]) group.visible = false
        skyDome.mesh.visible = weather.group.visible = !editorMode
        fog.near = THREE.MathUtils.lerp(1100, 8, tunnelD); fog.far = THREE.MathUtils.lerp(6000, 130, tunnelD)
      } else {
        if (realWorld) realWorld.group.visible = false
      distantHills.update(camPos.z, state.fogColor, state.ambientIntensity, tunnelD)
      terrain.setDebugView(debugMode.terrainDebugView)
      terrain.setStreamingFrozen(debugMode.streamingFrozen)
      terrain.updateWind(elapsedTime)
      terrain.update(camPos)
      terrain.surfaceVisible = terrainInspector.layers.ground
      terrain.vegetationVisible = terrainInspector.layers.vegetation
      terrain.settlementsVisible = terrainInspector.layers.settlements
      terrain.farmlandVisible = terrainInspector.layers.farmland
      terrain.waterVisible = terrainInspector.layers.water
      terrain.applyFrustumCulling(cam)
      trackSystem.update(camPos.z)
      lineside.update(camPos.z)
      stations.update(camPos.z, simulationDt, ambient.intensity)
      water.update(camPos.z, terrain.riverStrength, elapsedTime)
      valleyBridges.update(camPos.z)
      mountainRoadworks.update(camPos.z)
      levelCrossings.update(camPos.z)
      if (!routePlan.continuous) fields.update(camPos.z, z => terrain.farmlandStrengthAt(z), (x, z) => terrain.isSettlementAt(x, z))
      if (!routePlan.continuous) wetlandDetails.update(camPos.z, z => terrain.farmlandStrengthAt(z) > 0.5)
      water.mesh.visible &&= terrainInspector.layers.water
      fields.group.visible = !routePlan.continuous && terrainInspector.layers.farmland
      wetlandDetails.group.visible = !routePlan.continuous && terrainInspector.layers.farmland
      distantHills.group.visible &&= terrainInspector.layers.hills
      for (const group of [skyDome.mesh, weather.group, trackSystem.group, lineside.group, stations.group, tunnels.group, valleyBridges.group, mountainRoadworks.group, levelCrossings.group]) {
        group.visible = !editorMode
      }
      if (editorMode) {
        water.mesh.visible = false
        fields.group.visible = false
        wetlandDetails.group.visible = false
        distantHills.group.visible = false
      }
      }
      geoInspector.update(camera.z, realWorld)
      terrainInspector.update(camPos.z, camera.currentSpeed, terrain.chunkCount, terrain.debugInfo.pendingChunks, terrain.assetStatus)
      windowFrame.update(
        cam,
        elapsedTime,
        weather.current === WeatherType.RAIN,
        Math.min(1, camera.currentSpeed / CRUISE_SPEED),
        tunnelD,
        ambient.intensity,
      )

      // Push fog back in top-down mode so terrain is visible from above
      const savedBackground = scene.scene.background
      if (editorMode) scene.scene.background = new THREE.Color(0xcbd7c5)
      const savedFogNear = fog.near
      const savedFogFar = fog.far
      if (debugMode.isTopDown) {
        fog.near = realWanted ? 5000 : editorMode ? 1600 : 400
        fog.far = realWanted ? 15000 : editorMode ? 5000 : 3000
      }

      // Top-down is an exterior-only terrain inspection view. In the normal
      // carriage view the interior remains a separate foreground pass.
      renderer.render(scene.scene, cam, debugMode.isTopDown ? undefined : interiorScene)
      scene.scene.background = savedBackground
      perfMonitor.update() // F3 perf overlay

      // Restore fog for HUD boundary rendering
      if (debugMode.isTopDown) {
        fog.near = savedFogNear
        fog.far = savedFogFar
      }

      // ---- Debug HUD (F4) ----
      boundaryFrameCounter++
      if (boundaryFrameCounter % 30 === 0 && !realWanted) {
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
        currentBiome: realWanted ? 'Hudson Highlands · 真实地理' : terrain.currentBiomeName,
        nextBiome: realWanted ? 'Empire Service · 南行' : terrain.nextBiomeName,
        segmentStartZ: terrain.zSegmentStart,
        segmentLength: TerrainLOD.SEGMENT_LENGTH,
        blendLength: TerrainLOD.BLEND_LENGTH,
        chunkCount: realWanted ? realWorld?.chunkCount ?? 0 : terrain.chunkCount,
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
      terrainEditor.resize(r.width, r.height)
      geoInspector.resize(r.width, r.height)
      renderer.resize(r.width, r.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true; geographicAbort.abort()
      realWorld?.dispose(); geoInspector.dispose()
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endViewDrag)
      canvas.removeEventListener('pointercancel', endViewDrag)
      canvas.removeEventListener('dblclick', onDoubleClick)
      if (controlRef) controlRef.current = null
      debugMode.dispose()
      terrainInspector.dispose()
      terrainEditor.dispose()
      terrain.dispose()
      water.dispose()
      fields.dispose()
      wetlandDetails.dispose()
      distantHills.dispose()
      skyDome.dispose()
      weather.dispose()
      windowFrame.dispose()
      trackSystem.dispose()
      lineside.dispose()
      stations.dispose()
      tunnels.dispose()
      mountainRoadworks.dispose()
      levelCrossings.dispose()
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
