import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Scene3D } from './core/Scene3D'
import { TrainCamera } from './core/Camera'
import { WebGLRenderer } from './core/Renderer'

interface ThreeCanvasProps {
  className?: string
}

export default function ThreeCanvas({ className }: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene3D | null>(null)
  const cameraRef = useRef<TrainCamera | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new Scene3D()
    const camera = new TrainCamera()
    const renderer = new WebGLRenderer()

    const canvas = renderer.getDomElement()
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const rect = container.getBoundingClientRect()
    camera.updateAspect(rect.width, rect.height)
    renderer.resize(rect.width, rect.height)

    // ambient + directional light
    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(10, 20, 10)
    scene.add(dirLight)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      if (cameraRef.current && sceneRef.current && rendererRef.current) {
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
