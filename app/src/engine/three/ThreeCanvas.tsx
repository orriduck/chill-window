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

    const scene = new Scene3D()
    const camera = new TrainCamera()
    const renderer = new WebGLRenderer()
    const terrain = new TerrainLOD(scene.scene, 'field')
    const skyDome = new SkyDome()
    const timeOfDay = new TimeOfDay()
    const weather = new WeatherSystem()
    const windowFrame = new WindowFrame()
    const trackSystem = new TrackSystem()
    const lineside = new LinesideProps((x, z) => terrain.sampleHeight(x, z))
    const stations = new StationManager()
    const perfMonitor = new PerfMonitor(renderer.renderer)

    scene.add(skyDome.mesh)
    scene.add(weather.group)
    scene.add(windowFrame.group)
    scene.add(trackSystem.group)
    scene.add(lineside.group)
    scene.add(stations.group)
    scene.scene.fog = new THREE.Fog(0xbfe3f2, 200, 900)

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

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)

      const dt = Math.min(clockRef.current.getDelta(), MAX_DT)
      camera.update(dt)

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
      windowFrame.update(cam, clockRef.current.elapsedTime)

      renderer.render(scene.scene, cam)
      perfMonitor.update()
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
