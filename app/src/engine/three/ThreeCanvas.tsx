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
export interface TrainControl {
  setSpeed: (speed: number) => void
  setPaused: (paused: boolean) => void
  getZ: () => number
  getGrade: () => number
  getRouteContext: () => { currentLabel: string; nextLabel: string }
  getMotion: () => TrainMotionTelemetry
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
interface ThreeCanvasProps { className?: string; controlRef?: RefObject<TrainControl | null>; timePreset?: TimeOfDayPreset; weatherPreset?: WeatherPreset; onTerrainEditingChange?: (active: boolean) => void }

/** The exterior is always built from the bundled Hudson GIS/USGS snapshot.
 * There is no procedural-world initializer or alternate route mode here. */
export default function ThreeCanvas({ className, controlRef, timePreset = 'day', weatherPreset = 'auto', onTerrainEditingChange }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const onInspectionChange = useRef(onTerrainEditingChange)
  const environment = useRef<((time: TimeOfDayPreset, weather: WeatherPreset) => void) | null>(null)
  const settings = useRef({ timePreset, weatherPreset })
  useEffect(() => {
    settings.current = { timePreset, weatherPreset }
    environment.current?.(timePreset, weatherPreset)
  }, [timePreset, weatherPreset])
  useEffect(() => { onInspectionChange.current = onTerrainEditingChange }, [onTerrainEditingChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scene = new Scene3D()
    const interiorScene = new THREE.Scene()
    const exteriorGroup = new THREE.Group(); exteriorGroup.name = 'real-hudson-exterior'; scene.add(exteriorGroup)
    const interiorAmbient = new THREE.AmbientLight(0xf4f8f7, 0.85); interiorScene.add(interiorAmbient)
    const interiorKey = new THREE.DirectionalLight(0xffe5c5, 0.65); interiorKey.position.set(-2, 3, 2); interiorScene.add(interiorKey)
    const camera = new TrainCamera()
    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer() }
    catch { if (controlRef) controlRef.current = null; container.dataset.webgl = 'unavailable'; scene.dispose(); interiorScene.clear(); return }
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
    scene.scene.fog = new THREE.Fog(0xbfe3f2, 1100, 6000)
    let world: RealWorld | null = null
    let data: GeoData | null = null
    let disposed = false, paused = false, elapsed = 0, requestedSpeed = 0, worldReady = false
    let pendingJump: number | null = null
    let motionSampleTime = performance.now(), motionSampleZ = camera.z, measuredSpeed = 0, previousTime = motionSampleTime
    const abort = new AbortController()
    const motionSpeed = () => paused || debug.isTopDown || !world ? 0 : (camera.currentSpeed / CRUISE_SPEED) * CRUISE_SPEED_KMH
    if (controlRef) controlRef.current = {
      setSpeed: speed => { requestedSpeed = speed; if (worldReady) camera.setTargetSpeed(speed) }, setPaused: value => { paused = value }, getZ: () => camera.z, getGrade: () => camera.grade,
      getRouteContext: () => ({ currentLabel: camera.z < 11420 ? 'Hudson Highlands · 真实路线' : 'Empire Service · Hudson Valley', nextLabel: 'Empire Service · 南行' }),
      getMotion: () => ({ speedKmh: motionSpeed(), speedRatio: motionSpeed() / CRUISE_SPEED_KMH, acceleration: paused || debug.isTopDown || !world ? 0 : camera.acceleration }),
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
      departStation: () => camera.departStation(CRUISE_SPEED), resetView: () => camera.resetView(), hideStation: () => {},
    }
    const canvas = renderer.getDomElement()
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none'; container.appendChild(canvas)
    void loadHudsonData(abort.signal).then(route => {
      if (disposed) return
      const query = new URLSearchParams(window.location.search)
      const startS = THREE.MathUtils.clamp(Number(query.get('routeMetres') ?? route.checkpoints[0].s), 0, route.length)
      data = route; world = new RealWorld(route, startS); exteriorGroup.add(world.group)
      camera.setZ(startS)
      camera.setRailProfile({ height: s => route.railHeight(s), grade: s => route.railGrade(s) }); inspector.setData(route)
      void world.ready
        .then(() => renderer.warmup(scene.scene, camera.getCamera()))
        .then(() => { if (!disposed && world) { world.presentable = true; worldReady = true; camera.setTargetSpeed(requestedSpeed) } })
        .catch(error => { if (!disposed) inspector.fail(`场景预热失败：${error.message}`) })
    }).catch(error => { if (!disposed && error.name !== 'AbortError') inspector.fail(error.message) })

    let pointer: number | null = null, lastX = 0, lastY = 0
    const endDrag = (event: PointerEvent) => { if (pointer !== event.pointerId) return; pointer = null; canvas.style.cursor = 'grab'; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId) }
    const down = (event: PointerEvent) => { if (event.button !== 0 || debug.isTopDown) return; pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing' }
    const move = (event: PointerEvent) => { if (pointer !== event.pointerId || debug.isTopDown) return; camera.panBy(event.clientX - lastX, event.clientY - lastY); lastX = event.clientX; lastY = event.clientY }
    const doubleClick = () => { if (!debug.isTopDown) camera.resetView() }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('dblclick', doubleClick)
    const rect = container.getBoundingClientRect(); camera.updateAspect(rect.width, rect.height); inspector.resize(rect.width, rect.height); renderer.resize(rect.width, rect.height)
    const ambient = new THREE.AmbientLight(0xffffff, 0.8); scene.add(ambient)
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
      const inspection = debug.isTopDown, simulationDt = paused || inspection || !world ? 0 : dt
      if (!paused && !inspection && world) elapsed += motionDt
      if (data && world && camera.targetSpeed > 0 && data.length - camera.z <= TrainCamera.STATION_STOP_DISTANCE) camera.beginStationApproach(data.length)
      const nextS = camera.z + Math.max(camera.currentSpeed, camera.targetSpeed) * motionDt
      const coverageReady = worldReady && !!world?.canAdvance(nextS)
      camera.update(motionDt, !paused && !inspection && pendingJump === null && coverageReady)
      if (data && camera.z >= data.length) { camera.setZ(data.length); camera.setTargetSpeed(0); camera.currentSpeed = 0 }
      if (now - motionSampleTime >= 1000) { measuredSpeed = Math.abs(camera.z - motionSampleZ) / ((now - motionSampleTime) / 1000); motionSampleZ = camera.z; motionSampleTime = now }
      debug.updateMotion(camera.z, paused || inspection ? 0 : camera.currentSpeed, measuredSpeed)
      const viewCamera = inspection ? inspector.camera : camera.getCamera(), viewPosition = inspection ? inspector.focus : viewCamera.position
      const pose = data?.pose(camera.z), tunnel = !inspection && pose && data?.engineeringKindAt(pose.x, pose.z) === 'tunnel' ? 1 : 0
      time.update(simulationDt); const state = time.state
      weather.update(simulationDt, viewCamera, 'mountain'); weather.setShelter(tunnel); weather.applyToEnvironment(state)
      sky.update(viewPosition); sky.setSkyColors(state.horizonColor, state.zenithColor); sky.setSun(state.sunDirection, state.sunColor, state.sunSize, state.sunIntensity); sky.setStarOpacity(state.starOpacity)
      ambient.color.copy(state.ambientColor); ambient.intensity = state.ambientIntensity * (1 - tunnel * 0.8)
      sun.color.copy(state.dirColor); sun.intensity = state.dirIntensity * (1 - tunnel * 0.92); sun.position.copy(state.dirPosition).add(viewPosition); sun.target.position.copy(viewPosition)
      const fog = scene.scene.fog as THREE.Fog; fog.color.copy(state.fogColor); fog.near = THREE.MathUtils.lerp(1100, 8, tunnel); fog.far = THREE.MathUtils.lerp(6000, 130, tunnel)
      if (world) world.update(camera.z, inspection, inspector.focus, inspector.layers)
      inspector.setEditing(inspection, camera.z); inspector.update(camera.z, world)
      const cabinDarkness = Math.max(state.starOpacity, tunnel); interiorAmbient.intensity = THREE.MathUtils.lerp(0.85, 0.4, cabinDarkness); interiorKey.intensity = THREE.MathUtils.lerp(0.65, 0.2, cabinDarkness)
      windowFrame.update(viewCamera, elapsed, weather.current === WeatherType.RAIN, Math.min(1, camera.currentSpeed / CRUISE_SPEED), tunnel, ambient.intensity)
      const savedFogNear = fog.near, savedFogFar = fog.far
      if (inspection) { fog.near = 5000; fog.far = 15000; scene.scene.background = new THREE.Color(0xcbd7c5) }
      renderer.render(scene.scene, viewCamera, inspection ? undefined : interiorScene)
      if (inspection) { fog.near = savedFogNear; fog.far = savedFogFar; scene.scene.background = null }
      perf.update()
    }
    rafRef.current = requestAnimationFrame(loop)
    const resize = () => { const size = container.getBoundingClientRect(); camera.updateAspect(size.width, size.height); inspector.resize(size.width, size.height); renderer.resize(size.width, size.height) }
    window.addEventListener('resize', resize)
    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize)
      environment.current = null
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', endDrag); canvas.removeEventListener('pointercancel', endDrag); canvas.removeEventListener('dblclick', doubleClick)
      if (controlRef) controlRef.current = null
      world?.dispose(); inspector.dispose(); debug.dispose(); perf.dispose(); weather.dispose(); sky.dispose(); windowFrame.dispose(); renderer.dispose(); scene.dispose(); interiorScene.clear(); canvas.remove()
    }
  }, [controlRef])
  return <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0 }} />
}
