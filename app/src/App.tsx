import { lazy, Suspense, useState } from 'react'
import { Map } from 'lucide-react'
import RailAtlas from './rail/RailAtlas'
import type { RailRoute } from './rail/types'

const Home = lazy(() => import('./pages/Home'))
const NetworkRide = lazy(() => import('./rail/NetworkRide'))

export default function App() {
  const [atlas, setAtlas] = useState(true)
  const [route, setRoute] = useState<RailRoute | null>(null)
  const board = (route: RailRoute | null) => { setRoute(route); setAtlas(false) }
  return (
    <>{atlas ? <RailAtlas onBoard={board} /> : <Suspense fallback={<div className="network-loading" role="status">正在准备窗景…</div>}>
      {route ? <NetworkRide key={route.id} route={route} onAtlas={() => setAtlas(true)} /> : <Home />}
      {!route && <button className="route-launcher" onClick={() => setAtlas(true)}><Map size={14} />结束并换路线</button>}
    </Suspense>}</>
  )
}
