import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { TimeOfDay as TimeOfDayPreset } from '../time'
import { Scene3D } from './core/Scene3D'
import { CRUISE_SPEED, CRUISE_SPEED_KMH, TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { SkyDome } from './sky/SkyDome'
import { TimeOfDay } from './sky/TimeOfDay'
import { WeatherSystem, WeatherType } from './weather/WeatherSystem'
import { WindowFrame, type WindowHudReadout, type WindowHudControlAnchor, type WindowHudControlHitArea } from './interior/WindowFrame'
import { PerfMonitor } from './core/PerfMonitor'
import { GeoData, loadHudsonData } from './geography/GeoData'
import { RealWorld } from './geography/RealWorld'
import { GeoInspector } from './geography/GeoInspector'
import { DebugMode } from './core/DebugMode'

const MAX_DT = 0.1
export type WeatherPreset = WeatherType | 'auto'
export interface TrainMotionTelemetry { speedKmh: number; speedRatio: number; acceleration: number }
export interface InitialWorldPreparationProof {
  startedAtMs: number; observedAtMs: number; routeMetres: number
  gpuPhase: string; gpuSequence: number; gpuCompleted: number
  pendingGpu: number; readyTiles: number; totalTiles: number
}
export interface WorldPreparation {
  phase: 'loading' | 'preparing' | 'gpu' | 'ready' | 'error'
  presentable: boolean; elapsedMs: number; error?: string
  startedAtMs?: number; initialReadyProof?: Readonly<InitialWorldPreparationProof>
}
export interface TrainControl {
  setSpeed: (speed: number) => void
  setPaused: (paused: boolean) => void
  getZ: () => number
  getGrade: () => number
  getRouteContext: () => { currentLabel: string; nextLabel: string }
  getMotion: () => TrainMotionTelemetry
  getPreparation: () => WorldPreparation
  setWindowHud: (readout: WindowHudReadout) => void
  getWindowHudAnchor: () => WindowHudControlAnchor | null
  getWindowHudControlHitAreas: () => WindowHudControlHitArea[]
  showStation: (name: string, zCenter: number) => void
  planStation: (name: string, durationSeconds: number) => void
  prepareStation: (name: string) => void
  approachStation: (name: string) => void
  departStation: () => void
  resetView: () => void
  hideStation: () => void
}
interface ThreeCanvasProps { className?: string; controlRef?: RefObject<TrainControl | null>; timePreset?: TimeOfDayPreset; weatherPreset?: WeatherPreset; onTerrainEditingChange?: (active: boolean) => void; onPreparationChange?: (state: WorldPreparation) => void }

/** The exterior is always built from the bundled Hudson GIS/USGS snapshot.
 * There is no procedural-world initializer or alternate route mode here. */
export default function ThreeCanvas({ className, controlRef, timePreset = 'day', weatherPreset = 'auto', onTerrainEditingChange, onPreparationChange }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const onInspectionChange = useRef(onTerrainEditingChange)
  const preparationListener = useRef(onPreparationChange)
  const environment = useRef<((time: TimeOfDayPreset, weather: WeatherPreset) => void) | null>(null)
  const settings = useRef({ timePreset, weatherPreset })
  useEffect(() => {
    settings.current = { timePreset, weatherPreset }
    environment.current?.(timePreset, weatherPreset)
  }, [timePreset, weatherPreset])
  useEffect(() => { onInspectionChange.current = onTerrainEditingChange }, [onTerrainEditingChange])
  useEffect(() => { preparationListener.current = onPreparationChange }, [onPreparationChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const preparationStarted = performance.now()
    let preparationPhase: WorldPreparation['phase'] = 'loading', preparationError: string | undefined
    let preparationMs: number | null = null
    let initialReadyProof: Readonly<InitialWorldPreparationProof> | undefined
    const reportPreparation = (phase: WorldPreparation['phase'], error?: string) => {
      preparationPhase = phase; preparationError = error
      preparationListener.current?.({ phase, presentable: phase === 'ready', elapsedMs: performance.now() - preparationStarted,
        startedAtMs: preparationStarted, initialReadyProof, error })
    }
    reportPreparation('loading')
    const scene = new Scene3D()
    const interiorScene = new THREE.Scene()
    const exteriorGroup = new THREE.Group(); exteriorGroup.name = 'real-hudson-exterior'; scene.add(exteriorGroup)
    const interiorAmbient = new THREE.AmbientLight(0xf4f8f7, 0.85); interiorScene.add(interiorAmbient)
    const interiorKey = new THREE.DirectionalLight(0xffe5c5, 0.65); interiorKey.position.set(-2, 3, 2); interiorScene.add(interiorKey)
    const camera = new TrainCamera()
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer() }
    catch { if (controlRef) controlRef.current = null; reportPreparation('error', 'WebGL unavailable'); container.dataset.webgl = 'unavailable'; scene.dispose(); interiorScene.clear(); return }
    const sky = new SkyDome()
    const time = new TimeOfDay(settings.current.timePreset)
    const weather = new WeatherSystem(); weather.setOverride(settings.current.weatherPreset === 'auto' ? null : settings.current.weatherPreset)
    environment.current = (preset, weatherPreset) => {
      time.setPreset(preset); weather.setOverride(weatherPreset === 'auto' ? null : weatherPreset)
    }
    const windowFrame = new WindowFrame()
    const perf = new PerfMonitor(renderer.renderer)
    const debug = new DebugMode()
    debug.init(scene.scene, exteriorGroup); debug.perfMonitor = perf
    debug.onTerrainEditingChange = active => onInspectionChange.current?.(active)
    if (new URLSearchParams(window.location.search).has('debugTerrain')) debug.setTerrainEditing(true)
    debug.attachCarriageInspector((part, visible) => windowFrame.setDebugPartVisible(part, visible))
    const inspector = new GeoInspector(renderer.getDomElement(), true)
    exteriorGroup.add(sky.mesh, weather.group); interiorScene.add(windowFrame.group)
    scene.scene.fog = new THREE.Fog(0x9caeb4, 350, 2600)
    let world: RealWorld | null = null
    let data: GeoData | null = null
    let disposed = false, paused = false, elapsed = 0, requestedSpeed = 0, worldReady = false
    let pendingDeparture = false
    let pendingJump: number | null = null
    let gpuChunkInFlight = false
    let motionSampleTime = performance.now(), motionSampleZ = camera.z, measuredSpeed = 0, previousTime = motionSampleTime
    const abort = new AbortController()
    const motionSpeed = () => paused || debug.isTopDown || !worldReady ? 0 : (camera.currentSpeed / CRUISE_SPEED) * CRUISE_SPEED_KMH
    if (controlRef) controlRef.current = {
      setSpeed: speed => { requestedSpeed = speed; pendingDeparture = false; if (worldReady) camera.setTargetSpeed(speed) }, setPaused: value => { paused = value }, getZ: () => camera.z, getGrade: () => camera.grade,
      getRouteContext: () => ({ currentLabel: camera.z < 11420 ? 'Hudson Highlands · 真实路线' : 'Empire Service · Hudson Valley', nextLabel: 'Empire Service · 南行' }),
      getMotion: () => ({ speedKmh: motionSpeed(), speedRatio: motionSpeed() / CRUISE_SPEED_KMH, acceleration: paused || debug.isTopDown || !worldReady ? 0 : camera.acceleration }),
      getPreparation: () => ({ phase: preparationPhase, presentable: worldReady && world?.presentable === true,
        elapsedMs: preparationMs ?? performance.now() - preparationStarted, startedAtMs: preparationStarted, initialReadyProof, error: preparationError }),
      setWindowHud: readout => {
        const stations = data?.stations.filter(station => station.inCurrentRoute).sort((a, b) => a.sMetres - b.sMetres) ?? []
        const nearest = stations.find(station => station.sMetres >= camera.z) ?? stations.at(-1)
        windowFrame.setHudReadout({ ...readout, journey: 'Hudson Highlands · 南行', routeLabel: 'Empire Service · 南行',
          segmentLabel: nearest ? `${nearest.name} · Metro-North 经行站` : 'Hudson Highlands · 真实路线',
          stationNames: stations.map(station => station.name), currentSegment: Math.max(0, stations.findIndex(station => station === nearest) - 1),
          progress: data ? camera.z / data.length : 0 })
      },
      getWindowHudAnchor: () => windowFrame.getHudControlAnchor(camera.getCamera()), getWindowHudControlHitAreas: () => windowFrame.getHudControlHitAreas(camera.getCamera()),
      showStation: () => {}, planStation: () => {}, prepareStation: () => {},
      // Source-backed Metro-North platforms are rendered by RealWorld. The
      // Empire Service train passes these stations without a scheduled stop.
      approachStation: () => {},
      departStation: () => {
        requestedSpeed = CRUISE_SPEED; pendingDeparture = !worldReady
        if (worldReady) camera.departStation(requestedSpeed)
      }, resetView: () => camera.resetView(), hideStation: () => {},
    }
    const canvas = renderer.getDomElement()
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none'; container.appendChild(canvas)
    void loadHudsonData(abort.signal).then(async route => {
      if (disposed) return
      const query = new URLSearchParams(window.location.search)
      const startS = THREE.MathUtils.clamp(Number(query.get('routeMetres') ?? route.checkpoints[0].s), 0, route.length)
      reportPreparation('preparing')
      data = route; world = new RealWorld(route, startS); exteriorGroup.add(world.group)
      camera.setZ(startS)
      camera.setRailProfile({ height: s => route.railHeight(s), grade: s => route.railGrade(s) }); inspector.setData(route)
      void world.ready
        .then(async () => {
          if (!disposed && world) {
            reportPreparation('gpu')
            const prepared = world.captureGpuChunks()
            await renderer.warmup(scene.scene, camera.getCamera(), world.group)
            if (!disposed) world.markGpuChunks(prepared)
          }
        })
        .then(() => {
          if (!disposed && world) {
            world.gpuWarmupMs = renderer.warmupMs; world.presentable = true; worldReady = true
            // Snapshot the actual first uploaded view immediately after the
            // completed warmup fence/markGpuChunks and before departure or any
            // subsequent RAF can queue a forward-tile GPU batch.
            initialReadyProof = Object.freeze({ startedAtMs: preparationStarted, observedAtMs: performance.now(), routeMetres: camera.z,
              gpuPhase: renderer.preparation.phase, gpuSequence: renderer.preparation.sequence, gpuCompleted: renderer.preparation.completed,
              ...world.gpuCoverageAt(camera.z) })
            inspector.setInitialPreparation(initialReadyProof)
            preparationMs = performance.now() - preparationStarted; reportPreparation('ready')
            if (pendingDeparture) { camera.departStation(requestedSpeed); pendingDeparture = false }
            else camera.setTargetSpeed(requestedSpeed)
          }
        })
        .catch(error => { if (!disposed) { reportPreparation('error', error.message); inspector.fail(`场景预热失败：${error.message}`) } })
    }).catch(error => { if (!disposed && error.name !== 'AbortError') { reportPreparation('error', error.message); inspector.fail(error.message) } })

    let pointer: number | null = null, lastX = 0, lastY = 0
    const endDrag = (event: PointerEvent) => { if (pointer !== event.pointerId) return; pointer = null; canvas.style.cursor = 'grab'; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId) }
    const down = (event: PointerEvent) => { if (event.button !== 0 || debug.isTopDown) return; pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing' }
    const move = (event: PointerEvent) => { if (pointer !== event.pointerId || debug.isTopDown) return; camera.panBy(event.clientX - lastX, event.clientY - lastY); lastX = event.clientX; lastY = event.clientY }
    const doubleClick = () => { if (!debug.isTopDown) camera.resetView() }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('dblclick', doubleClick)
    const rect = container.getBoundingClientRect(); camera.updateAspect(rect.width, rect.height); inspector.resize(rect.width, rect.height); renderer.resize(rect.width, rect.height)
    const ambient = new THREE.HemisphereLight(0xbad1dc, 0x475b3b, 0.85); scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.08; sun.shadow.bias = -0.0002; sun.shadow.camera.left = -50; sun.shadow.camera.right = 50; sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50; sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 200; scene.add(sun); scene.add(sun.target)

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const now = performance.now(), motionDt = Math.min((now - previousTime) / 1000, 1), dt = Math.min(motionDt, MAX_DT); previousTime = now
      const command = inspector.consume()
      if (command.editing !== undefined) debug.setTerrainEditing(command.editing)
      if (command.recenter) inspector.recenter(camera.z)
      if (command.jump !== undefined && data) {
        pendingJump = THREE.MathUtils.clamp(command.jump, 0, data.length)
        world?.prepareAt(pendingJump); inspector.recenter(pendingJump)
      }
      if (pendingJump !== null && world?.canAdvance(pendingJump)) {
        camera.setZ(pendingJump); world.prepareAt(null); pendingJump = null
        motionSampleZ = camera.z; motionSampleTime = now; measuredSpeed = 0
      }
      if (command.time) time.setPreset(command.time)
      if (command.weather) weather.setOverride(command.weather === 'rain' ? WeatherType.RAIN : WeatherType.CLEAR)
      const inspection = debug.isTopDown, simulationDt = paused || inspection || !worldReady ? 0 : dt
      inspector.setEditing(inspection, camera.z)
      if (!paused && !inspection && worldReady) elapsed += motionDt
      if (data && world && camera.targetSpeed > 0 && data.length - camera.z <= TrainCamera.STATION_STOP_DISTANCE) camera.beginStationApproach(data.length)
      const nextS = camera.z + Math.max(camera.currentSpeed, camera.targetSpeed) * motionDt
      world?.prepareAdvance(worldReady && !inspection ? nextS : null)
      const coverageReady = worldReady && !!world?.canAdvance(nextS, camera.z)
      inspector.setMotionDiagnostic(requestedSpeed, camera.targetSpeed, paused, inspection, worldReady, coverageReady, pendingJump)
      camera.update(motionDt, !paused && !inspection && pendingJump === null && coverageReady)
      if (data && camera.z >= data.length) { camera.setZ(data.length); camera.setTargetSpeed(0); camera.currentSpeed = 0 }
      if (now - motionSampleTime >= 1000) { measuredSpeed = Math.abs(camera.z - motionSampleZ) / ((now - motionSampleTime) / 1000); motionSampleZ = camera.z; motionSampleTime = now }
      debug.updateMotion(camera.z, paused || inspection ? 0 : camera.currentSpeed, measuredSpeed)
      const viewCamera = inspection ? inspector.camera : camera.getCamera(), viewPosition = inspection ? inspector.focus : viewCamera.position
      const pose = data?.pose(camera.z), tunnel = !inspection && pose && data?.engineeringKindAt(pose.x, pose.z) === 'tunnel' ? 1 : 0
      time.update(simulationDt); const state = time.state
      weather.update(simulationDt, viewCamera, 'mountain'); weather.setShelter(tunnel); weather.applyToEnvironment(state)
      sky.update(viewPosition); sky.setSkyColors(state.horizonColor, state.zenithColor); sky.setSun(state.sunDirection, state.sunColor, state.sunSize, state.sunIntensity); sky.setStarOpacity(state.starOpacity)
      ambient.color.copy(state.ambientColor).lerp(new THREE.Color(0xb4cbd9), 0.38); ambient.intensity = state.ambientIntensity * 0.95 * (1 - tunnel * 0.8)
      sun.color.copy(state.dirColor).lerp(new THREE.Color(0xffdfac), 0.28); sun.intensity = state.dirIntensity * 1.05 * (1 - tunnel * 0.92); sun.position.copy(state.dirPosition).add(viewPosition); sun.target.position.copy(viewPosition)
      const fog = scene.scene.fog as THREE.Fog; fog.color.copy(state.fogColor); fog.near = THREE.MathUtils.lerp(state.fogNear * 2, 8, tunnel); fog.far = THREE.MathUtils.lerp(state.fogFar * 3, 130, tunnel)
      if (world) world.update(camera.z, inspection, inspector.focus, inspector.layers, inspector.camera.position)
      if (worldReady && world && !gpuChunkInFlight) {
        const prepared = world.takeGpuChunks()
        if (prepared.length) {
          gpuChunkInFlight = true
          void renderer.preload(scene.scene, camera.getCamera(), prepared)
            .then(() => { if (!disposed) world?.markGpuChunks(prepared) })
            .catch(error => { if (!disposed && world) { worldReady = false; world.presentable = false; reportPreparation('error', error.message); inspector.fail(`区块 GPU 预热失败：${error.message}`) } })
            .finally(() => { gpuChunkInFlight = false })
        }
      }
      inspector.update(camera.z, world)
      inspector.setGpuPreparation(renderer.preparation)
      inspector.setWorldPreparation(preparationPhase, worldReady, preparationMs ?? now - preparationStarted)
      const cabinDarkness = Math.max(state.starOpacity, tunnel); interiorAmbient.intensity = THREE.MathUtils.lerp(0.85, 0.4, cabinDarkness); interiorKey.intensity = THREE.MathUtils.lerp(0.65, 0.2, cabinDarkness)
      windowFrame.update(viewCamera, elapsed, weather.current === WeatherType.RAIN, Math.min(1, camera.currentSpeed / CRUISE_SPEED), tunnel, ambient.intensity)
      const savedFogNear = fog.near, savedFogFar = fog.far
      if (inspection) { fog.near = 5000; fog.far = 15000; scene.scene.background = new THREE.Color(0xcbd7c5) }
      const renderStart = performance.now()
      renderer.render(scene.scene, viewCamera, inspection ? undefined : interiorScene)
      if (inspection) inspector.markMapRendered()
      if (inspection) { fog.near = savedFogNear; fog.far = savedFogFar; scene.scene.background = null }
      perf.update()
      inspector.setPerformance(perf.currentFps, perf.currentFrameTime, performance.now() - renderStart, renderer.renderer.info)
    }
    rafRef.current = requestAnimationFrame(loop)
    const resize = () => { const size = container.getBoundingClientRect(); camera.updateAspect(size.width, size.height); inspector.resize(size.width, size.height); renderer.resize(size.width, size.height) }
    window.addEventListener('resize', resize)
    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize)
      preparationListener.current?.({ phase: 'loading', presentable: false, elapsedMs: 0, startedAtMs: preparationStarted })
      environment.current = null
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', endDrag); canvas.removeEventListener('pointercancel', endDrag); canvas.removeEventListener('dblclick', doubleClick)
      if (controlRef) controlRef.current = null
      world?.dispose(); inspector.dispose(); debug.dispose(); perf.dispose(); weather.dispose(); sky.dispose(); windowFrame.dispose(); renderer.dispose(); scene.dispose(); interiorScene.clear(); canvas.remove()
    }
  }, [controlRef])
  return <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0 }} />
}
