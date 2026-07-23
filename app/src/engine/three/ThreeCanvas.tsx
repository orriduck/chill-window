import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Scene3D } from './core/Scene3D'
import { TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'
import { TerrainLOD } from './terrain/TerrainLOD'

interface ThreeCanvasProps {
  className?: string
}

export default function ThreeCanvas({ className }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene3D | null>(null)
  const cameraRef = useRef<TrainCamera | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const terrainRef = useRef<TerrainLOD | null>(null)
  const clockRef = useRef<THREE.Clock>(new THREE.Clock())
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new Scene3D()
    const camera = new TrainCamera()
    const renderer = new WebGLRenderer()
    const terrain = new TerrainLOD(scene.scene, 'field')

    // Sky and atmosphere
    scene.scene.background = new THREE.Color(0x87CEEB)
    scene.scene.fog = new THREE.Fog(0x87CEEB, 200, 900)

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
    scene.add(dirLight)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    terrainRef.current = terrain

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      if (cameraRef.current && sceneRef.current && rendererRef.current && terrainRef.current) {
        const dt = clockRef.current.getDelta()
        cameraRef.current.update(dt)
        const camPos = cameraRef.current.getCamera().position
        terrainRef.current.update(camPos)
        rendererRef.current.render(
          sceneRef.current.scene,
          cameraRef.current.getCamera()
        )
      }
    }
    rafRef.current = requestAnimationFrame(loop)

    const onResize = () => {
      if (!container) return
      const r = container.getBoundingClientRect()
      cameraRef.current?.updateAspect(r.width, r.height)
      rendererRef.current?.resize(r.width, r.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      terrainRef.current?.dispose()
      rendererRef.current?.dispose()
      sceneRef.current?.dispose()
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
