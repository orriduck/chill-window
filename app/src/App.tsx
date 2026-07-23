import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import DebugIndex from './pages/debug/DebugIndex'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/debug/*" element={<DebugIndex />} />
    </Routes>
  )
}
