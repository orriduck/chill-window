import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronRight, Search, VolumeX, X } from 'lucide-react'
import { HUDSON_ID, type RailCatalog, type RailRoute } from './types'
import './rail.css'

interface Props { onBoard: (route: RailRoute | null) => void; onClose?: () => void }
const project = ([lon, lat]: number[]) => [(lon + 126) / 60 * 1000, (51 - lat) / 27 * 500]
const pathOf = (lines: number[][][]) => lines.map(line => line.filter(p => p[0] > -128 && p[0] < -65 && p[1] > 22 && p[1] < 52).map((p, i) => `${i ? 'L' : 'M'}${project(p).map(v => v.toFixed(1)).join(',')}`).join(' ')).join(' ')

export default function RailAtlas({ onBoard, onClose }: Props) {
  const [catalog, setCatalog] = useState<RailCatalog | null>(null)
  const [land, setLand] = useState<number[][][]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(HUDSON_ID)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}rail/catalog.json`, { signal: abort.signal }).then(async r => {
      if (!r.ok) throw new Error(`路线目录暂不可用（${r.status}）`)
      const data = await r.json() as RailCatalog
      if (!Array.isArray(data.routes) || !data.routes.length) throw new Error('路线目录为空')
      setCatalog(data); setError('')
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    void fetch(`${import.meta.env.BASE_URL}rail/land.json`, { signal: abort.signal }).then(r => r.ok ? r.json() : []).then(setLand).catch(() => {})
    return () => abort.abort()
  }, [retry])
  const routes = useMemo(() => (catalog?.routes ?? []).filter(r => r.name.toLowerCase().includes(query.toLowerCase())), [catalog, query])
  const route = catalog?.routes.find(r => r.id === selected)
  const detail = selected === HUDSON_ID
  return <section className="rail-atlas" aria-label="美国铁路旅行图册">
    <header className="atlas-header"><a className="atlas-brand" href="#" onClick={e => { e.preventDefault(); setSelected(HUDSON_ID) }}>WINDOW SEAT <span>慢一点，去远方。</span></a><div className="atlas-header-right"><span><VolumeX size={13} /> 默认静音</span>{onClose && <button onClick={onClose} aria-label="返回乘车"><X size={20} /></button>}</div></header>
    <div className="atlas-intro"><div><span className="rail-eyebrow">THE AMERICAN RAIL ATLAS / VOL. 01</span><h1>下一扇窗，<br />你想看向哪里？</h1></div><p>沿真实铁路出发，<br />把一段时间，留给窗外。</p></div>
    <div className="atlas-layout">
      <div className="atlas-map-column"><div className="atlas-map" aria-label="Amtrak 路线示意图">
        <svg viewBox="0 0 1000 500" role="img" aria-label="美国本土铁路路线图"><defs><pattern id="atlas-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#657c6b" strokeOpacity=".12" strokeWidth=".7" /></pattern></defs><rect width="1000" height="500" fill="url(#atlas-grid)" />
          {land.map((ring, i) => <path key={`land-${i}`} d={`${pathOf([ring])}Z`} fill="#d2d9b9" fillOpacity=".09" stroke="#a1af8c" strokeWidth="1.2" strokeOpacity=".35" />)}
          {(catalog?.routes ?? []).map(r => <path key={r.id} d={pathOf(r.preview)} fill="none" stroke={selected === r.id ? '#e6c989' : '#b4c6a5'} strokeOpacity={selected === r.id ? 1 : .33} strokeWidth={selected === r.id ? 3 : 1.3} className="atlas-route-line" />)}
          {(catalog?.routes ?? []).map(r => <path key={`hit-${r.id}`} d={pathOf(r.preview)} fill="none" stroke="transparent" strokeWidth="12" className="atlas-route-hit" onClick={() => setSelected(r.id)}><title>{r.name}</title></path>)}
          {selected === HUDSON_ID && <circle cx={project([-73.96, 41.36])[0]} cy={project([-73.96, 41.36])[1]} r="6" fill="#e6c989" stroke="#284739" strokeWidth="3" />}
          {[["PACIFIC",-122,32],["ROCKIES",-111,45],["GREAT PLAINS",-102,39],["GREAT LAKES",-89,45],["ATLANTIC",-74,31]].map(([name,lon,lat]) => <text key={name} x={project([Number(lon),Number(lat)])[0]} y={project([Number(lon),Number(lat)])[1]} fill="#b1bea0" opacity=".5" fontSize="11" letterSpacing="2" textAnchor="middle">{name}</text>)}
          <g transform={`translate(${project([-74,40.7]).join(',')})`}><circle r="2.5" fill="#e8d7ab" /><text x="10" y="-8" className="atlas-city">NEW YORK</text></g><g transform={`translate(${project([-87.63,41.88]).join(',')})`}><circle r="2.5" fill="#e8d7ab" /><text x="9" y="-7" className="atlas-city">CHICAGO</text></g><g transform={`translate(${project([-118.24,34.05]).join(',')})`}><circle r="2.5" fill="#e8d7ab" /><text x="9" y="-7" className="atlas-city">LOS ANGELES</text></g>
        </svg><div className="atlas-map-key"><span><i />真实路线几何</span><span><i className="selected" />当前选择</span><span>示意投影 · 非实时运行图</span></div>
      </div><div className="atlas-selection"><div><span className="rail-eyebrow">{detail ? 'DETAILED GEOGRAPHY / HUDSON' : 'REAL RAIL · GENERATED SCENERY'}</span><h2>{detail ? 'Hudson Highlands' : route?.name ?? '选择一条铁路'}</h2><p>{detail ? '沿哈德逊河南行。真实高程、河道与沿线建筑锚点，配合风格化游戏美术。' : '顺着官方线路曲线乘车。地形、树木与村落为生成景观，尚未制作这条线路的详细实景。'}</p></div><button className="rail-primary" disabled={!detail && !route} onClick={() => onBoard(detail ? null : route!)}>选个靠窗位 <ArrowUpRight size={18} /></button></div>
      <div className="atlas-footnote">{catalog ? `${catalog.routes.length} 条官方路线 · FRA / BTS NTAD 快照` : '正在读取官方路线目录…'}<span>全国扩展从 Amtrak 开始；不包含全部通勤与货运网络。</span></div></div>
      <aside className="atlas-routes"><div className="atlas-list-heading"><span>旅行目录</span><small>{catalog?.routes.length ?? '—'} ROUTES</small></div><label className="atlas-search"><Search size={15} /><input aria-label="搜索铁路路线" placeholder="搜索路线，例如 Zephyr" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="atlas-route-list">{!query && <button className={`atlas-route ${detail ? 'active' : ''}`} onClick={() => setSelected(HUDSON_ID)}><span><strong>Hudson Highlands</strong><small>Empire Service · 精细窗景 · 22.8 km</small></span><ChevronRight size={16} /></button>}{routes.map(r => <button key={r.id} className={`atlas-route ${selected === r.id ? 'active' : ''}`} onClick={() => setSelected(r.id)}><span><strong>{r.name}</strong><small>{Math.round(r.lengthMetres / 1000).toLocaleString()} km · {r.componentCount} 个连续片段</small></span><ChevronRight size={16} /></button>)}{catalog && !routes.length && <p className="atlas-empty">没有找到这条路线，试试其他名称。</p>}{error && <div className="atlas-empty" role="alert">{error}<button onClick={() => setRetry(n => n + 1)}>重新加载</button></div>}</div>
      </aside>
    </div><footer className="atlas-footer"><span>WINDOW SEAT · 一段安静的铁路旅行</span><a href="https://geodata.bts.gov/" target="_blank" rel="noreferrer">FRA/BTS 路线数据</a><span>底图 © Natural Earth · Public domain</span></footer>
  </section>
}
