import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Scene3D } from './core/Scene3D'
import { TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { TerrainLOD } from './terrain/TerrainLOD'
import { SkyDome } from './sky/SkyDome'
import { TimeOfDay } from './sky/TimeOfDay'
import { WeatherSystem } from './weather/WeatherSystem'
import { WindowFrame } from './interior/WindowFrame'

const MAX_DT = 0.1 // clamp delta time to avoid spiral of death on lag

interface ThreeCanvasProps {
  className?: string
}

export default function ThreeCanvas({ className }: ThreeCanvasProps) {
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

    scene.add(skyDome.mesh)
    scene.add(weather.group)
    scene.add(windowFrame.group)
    scene.scene.fog = new THREE.Fog(0xbfe3f2, 200, 900)

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
      windowFrame.update(cam)

      renderer.render(scene.scene, cam)
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
      terrain.dispose()
      skyDome.dispose()
      weather.dispose()
      windowFrame.dispose()
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
