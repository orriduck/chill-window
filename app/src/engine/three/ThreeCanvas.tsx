import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { Scene3D } from './core/Scene3D'
import { TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { TerrainLOD } from './terrain/TerrainLOD'
import { SkyDome } from './sky/SkyDome'
import { TimeOfDay } from './sky/TimeOfDay'
import { WeatherSystem } from './weather/WeatherSystem'
import { WindowFrame } from './interior/WindowFrame'
import { TrackSystem } from './track/TrackSystem'
import { LinesideProps } from './track/LinesideProps'
import { StationManager } from './track/Station'
import { PerfMonitor } from './core/PerfMonitor'
import { DebugMode } from './core/DebugMode'

const MAX_DT = 0.1 // clamp delta time to avoid spiral of death on lag

/** Methods exposed to the parent for controlling the 3D train. */
export interface TrainControl {
  /** Set target speed (0 = stop at station, 15 = cruise). */
  setSpeed: (speed: number) => void
  /** Current camera Z position. */
  getZ: () => number
  /** Show a station ahead of the camera. */
  showStation: (name: string, zCenter: number) => void
  /** Remove the current station. */
  hideStation: () => void
}

interface ThreeCanvasProps {
  className?: string
  /** Parent passes a ref; we fill it with train control methods. */
  controlRef?: RefObject<TrainControl | null>
}

export default function ThreeCanvas({ className, controlRef }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<THREE.Clock>(new THREE.Clock())
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ---- Scene ----
    const scene = new Scene3D()

    // ---- Exterior group: everything outside the window frame ----
    // DebugMode F6 toggles this group's visibility to hide the outside world.
    const exteriorGroup = new THREE.Group()
    exteriorGroup.name = 'exterior'
    scene.add(exteriorGroup)

    // ---- Core systems ----
    const camera = new TrainCamera()
    const renderer = new WebGLRenderer()
    const terrain = new TerrainLOD(exteriorGroup, 'field')
    const skyDome = new SkyDome()
    const timeOfDay = new TimeOfDay()
    const weather = new WeatherSystem()
    const windowFrame = new WindowFrame()
    const trackSystem = new TrackSystem()
    const lineside = new LinesideProps((x, z) => terrain.sampleHeight(x, z))
    const stations = new StationManager()
    const perfMonitor = new PerfMonitor(renderer.renderer)
    const debugMode = new DebugMode()

    // Add exterior objects to the exteriorGroup
    exteriorGroup.add(skyDome.mesh)
    exteriorGroup.add(weather.group)
    exteriorGroup.add(trackSystem.group)
    exteriorGroup.add(lineside.group)
    exteriorGroup.add(stations.group)

    // Window frame is NOT in exteriorGroup — it stays visible in scene-hidden mode
    scene.add(windowFrame.group)

    scene.scene.fog = new THREE.Fog(0xbfe3f2, 200, 900)

    // Wire debug mode
    debugMode.init(scene.scene, exteriorGroup)
    debugMode.perfMonitor = perfMonitor

    // Show the origin station at the camera's starting position
    stations.showStation('始发站', camera.z)

    // Expose speed control to parent
    if (controlRef) {
      controlRef.current = {
        setSpeed: (s: number) => camera.setTargetSpeed(s),
        getZ: () => camera.z,
        showStation: (name: string, zCenter: number) => stations.showStation(name, zCenter),
        hideStation: () => stations.hideStation(),
      }
    }

    const canvas = renderer.getDomElement()
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

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

    // ---- Top-down state tracking ----
    let wasTopDown = false

    // ---- Biome boundary update throttle ----
    let lastSegmentZ = terrain.zSegmentStart
    let boundaryFrameCounter = 0

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)

      const dt = Math.min(clockRef.current.getDelta(), MAX_DT)

      // ---- Top-down camera toggle ----
      if (debugMode.isTopDown !== wasTopDown) {
        if (debugMode.isTopDown) {
          debugMode.enterTopDown(camera.camera)
        } else {
          debugMode.exitTopDown(camera.camera)
        }
        wasTopDown = debugMode.isTopDown
      }

      // Always run camera physics so Z advances (top-down only overrides view)
      camera.update(dt)

      if (debugMode.isTopDown) {
        // Override position/orientation for top-down aerial view
        debugMode.applyTopDown(camera.camera)
      }

      const cam = camera.getCamera()
      const camPos = cam.position

      // Time of day drives sky, sun and lighting; weather modulates on top
      timeOfDay.update(dt)
      const state = timeOfDay.state
      weather.update(dt, camPos)
      weather.applyToEnvironment(state)

      skyDome.update(camPos)
      skyDome.setSkyColors(state.horizonColor, state.zenithColor)
      skyDome.setSun(state.sunDirection, state.sunColor, state.sunSize, state.sunIntensity)
      skyDome.setStarOpacity(state.starOpacity)

      ambient.color.copy(state.ambientColor)
      ambient.intensity = state.ambientIntensity
      dirLight.color.copy(state.dirColor)
      dirLight.intensity = state.dirIntensity
      dirLight.position.copy(state.dirPosition).add(camPos)
      dirLight.target.position.copy(camPos)

      const fog = scene.scene.fog as THREE.Fog
      fog.color.copy(state.fogColor)
      fog.near = state.fogNear
      fog.far = state.fogFar

      terrain.update(camPos)
      terrain.applyFrustumCulling(cam)
      trackSystem.update(camPos.z)
      lineside.update(camPos.z)
      stations.update(camPos.z, dt)
      windowFrame.update(cam, clockRef.current.elapsedTime)

      renderer.render(scene.scene, cam)
      perfMonitor.update() // F3 perf overlay

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
      if (controlRef) controlRef.current = null
      debugMode.dispose()
      terrain.dispose()
      skyDome.dispose()
      weather.dispose()
      windowFrame.dispose()
      trackSystem.dispose()
      lineside.dispose()
      stations.dispose()
      perfMonitor.dispose()
      renderer.dispose()
      scene.dispose()
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'absolute', inset: 0, zIndex: 0 }}
    />
  )
}
