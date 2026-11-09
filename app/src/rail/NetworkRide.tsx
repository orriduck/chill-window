import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, VolumeX } from 'lucide-react'
import { NetworkWorld, type NetworkTelemetry } from '@/engine/network/NetworkWorld'
import { componentLength, longestComponent, validateGeometry } from './routeMath'
import { landscapeProfile, type LandscapeProfile, type LonLat, type RailRoute } from './types'

type Telemetry = NetworkTelemetry
const empty: Telemetry = { distanceMetres: 0, lengthMetres: 0, longitude: 0, latitude: 0, speedKmh: 60, paused: true, ready: false, tiles: 0, drawCalls: 0, triangles: 0, frameMs: 0 }
export default function NetworkRide({ route, onAtlas }: { route: RailRoute; onAtlas: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const world = useRef<NetworkWorld | null>(null)
  const [parts, setParts] = useState<LonLat[][]>([])
  const lengths = useMemo(() => parts.map(componentLength), [parts])
  const [component, setComponent] = useState(0)
  const [state, setState] = useState<Telemetry>(empty)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<LandscapeProfile>(() => landscapeProfile(route.name))
  const [retry, setRetry] = useState(0)
  const [overview, setOverview] = useState(false)
  const [trees, setTrees] = useState(true)
  const [buildings, setBuildings] = useState(true)
  const [reverse, setReverse] = useState(false)
  const [speed, setSpeed] = useState(60)
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [remaining, setRemaining] = useState(25 * 60)
  const focusDuration = useRef(focusMinutes)
  focusDuration.current = focusMinutes
  useEffect(() => {
    if (state.paused || !state.ready || overview || !focusMinutes) return
    let last = performance.now()
    const visibility = () => { last = performance.now() }
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(() => {
      const now = performance.now(), delta = (now - last) / 1000; last = now
      if (!document.hidden) setRemaining(value => Math.max(0, value - delta))
    }, 250)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [state.paused, state.ready, overview, focusMinutes])
  useEffect(() => { if (remaining <= 0 && focusMinutes) world.current?.setPaused(true) }, [remaining, focusMinutes])
  useEffect(() => {
    const abort = new AbortController()
    setError(''); setParts([]); setState(empty)
    // File names come from the bundled catalog, never from a caller-supplied URL.
    void fetch(`${import.meta.env.BASE_URL}rail/${route.file}`, { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error(`路线片段加载失败（${r.status}）`)
      const geometry = await r.json(), parts = validateGeometry(geometry)
      if (abort.signal.aborted) return
      setParts(parts); setComponent(Number.isInteger(geometry.defaultComponentIndex) && geometry.defaultComponentIndex >= 0 && geometry.defaultComponentIndex < parts.length ? geometry.defaultComponentIndex : longestComponent(parts))
    }).catch(e => { if (e.name !== 'AbortError') setError(e instanceof SyntaxError ? '路线文件格式异常，请返回图册重试。' : e.message) })
    return () => abort.abort()
  }, [route.file, retry])
  useEffect(() => {
    const part = parts[component]
    if (!container.current || !part) return
    let active = true
    setState(empty); setError(''); setOverview(false); setTrees(true); setBuildings(true); setSpeed(60); setRemaining(focusDuration.current * 60)
    try {
      let wasReady = false
      const view = new NetworkWorld(container.current, reverse ? [...part].reverse() : part, profile, next => {
        if (!active) return
        if (next.error) setError(next.error)
        else if (wasReady && !next.ready) setError('图形上下文已中断，请重新加载这段旅程。')
        wasReady ||= next.ready
        setState(next)
      })
      world.current = view
      return () => { active = false; view.dispose(); if (world.current === view) world.current = null }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }, [parts, component, profile, reverse])
  useEffect(() => {
    Object.assign(window, { __railRide: { routeId: route.id, component, snapshot: () => ({ ...state, focusRemainingSeconds: remaining }) } })
    return () => { delete (window as Window & { __railRide?: unknown }).__railRide }
  }, [state, route.id, component, remaining])
  return <main className="network-ride" aria-label={`${route.name} 铁路窗景`}><div ref={container} className="network-stage" /><div className="network-shell" aria-hidden="true" /><div className="network-caption"><span className="rail-eyebrow">A WINDOW ALONG THE RAILWAY</span><h1>{route.name}</h1><p>真实线路 · 生成景观 · 连续片段 {component + 1} / {parts.length || '—'}</p></div><div className="network-quiet"><VolumeX size={13} /> 安静旅行</div>
    <section className="network-controls" aria-label="乘车控制"><div className="network-controls-top"><p>{(state.distanceMetres / 1000).toFixed(2)} / {(state.lengthMetres / 1000).toFixed(1)} km <span aria-hidden="true"> · </span>{state.distanceMetres >= state.lengthMetres && state.ready ? '本片段已到达' : remaining <= 0 && focusMinutes ? '本段专注已完成' : focusMinutes ? `专注 ${Math.floor(remaining / 60).toString().padStart(2, '0')}:${Math.floor(remaining % 60).toString().padStart(2, '0')}` : '自由旅行'}</p><button className="rail-primary" onClick={() => { if (remaining <= 0 && focusMinutes) setRemaining(focusMinutes * 60); world.current?.setPaused(!state.paused) }} disabled={!state.ready}>{state.paused ? <Play size={14} /> : <Pause size={14} />}{state.paused ? '出发' : '暂停'}</button></div>
    <input aria-label="路线里程" type="range" min={0} max={Math.max(1, state.lengthMetres)} step="any" value={state.distanceMetres} disabled={!state.ready} onChange={e => { world.current?.setPaused(true); world.current?.seek(Number(e.target.value)) }} />
    <div className="network-settings"><label>片段<select aria-label="选择连续路线片段" value={component} onChange={e => setComponent(Number(e.target.value))}>{lengths.map((length, i) => <option key={i} value={i}>{i + 1} · {(length / 1000).toFixed(1)} km</option>)}</select></label><label>风景<select aria-label="生成景观风格" value={profile} onChange={e => setProfile(e.target.value as LandscapeProfile)}><option value="woodland">林间</option><option value="alpine">山地</option><option value="desert">旷野</option><option value="coast">海岸意象</option></select></label><label>速度<select aria-label="列车速度" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); world.current?.setSpeed(value) }}>{[30, 60, 90, 120].map(v => <option key={v} value={v}>{v} km/h</option>)}</select></label><label>专注<select aria-label="专注时长" value={focusMinutes} onChange={e => { const minutes = Number(e.target.value); setFocusMinutes(minutes); setRemaining(minutes * 60) }}><option value={0}>自由旅行</option>{[25, 45, 60].map(v => <option key={v} value={v}>{v} 分钟</option>)}</select></label><button onClick={() => { setOverview(v => !v); world.current?.setOverview(!overview) }}>{overview ? '回到车窗' : '俯瞰路线'}</button><button onClick={() => setReverse(v => !v)}>反向乘坐</button><button onClick={onAtlas}>结束并换路线</button></div>
    <details className="network-debug"><summary>路线与场景说明</summary><p>线路中心线来自 FRA/BTS。此模式无 DEM；地形、轨面高程、水面、植被和村落均为生成景观，不代表沿途实测；精细 GIS 窗景目前仅覆盖 Hudson。路线断点分开乘坐，到片段终点停下。</p><div className="network-settings"><label><input type="checkbox" checked={trees} onChange={e => { setTrees(e.target.checked); world.current?.setLayers({ trees: e.target.checked, buildings }) }} />植被</label><label><input type="checkbox" checked={buildings} onChange={e => { setBuildings(e.target.checked); world.current?.setLayers({ trees, buildings: e.target.checked }) }} />村落</label></div><pre>{`坐标 ${state.longitude.toFixed(5)}, ${state.latitude.toFixed(5)} · ${state.tiles} 地块\n${state.drawCalls} draws · ${state.triangles.toLocaleString()} triangles · ${state.frameMs.toFixed(1)} ms RAF\n默认静音 · 无实时班次或到站时间承诺`}</pre></details></section>
    {(!state.ready || error) && <div className="network-loading" role={error ? 'alert' : 'status'}><h2>{error ? '这段旅程暂未准备好' : '为你留一个靠窗位…'}</h2><p>{error || '正在读取真实路线，准备沿途风景。'}</p>{error && <><button onClick={() => setRetry(n => n + 1)}>重新加载</button><button onClick={onAtlas}>返回旅行图册</button></>}</div>}
  </main>
}
