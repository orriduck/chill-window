import { useState } from 'react';
import SceneDebug from './SceneDebug';
import FarDebug from './FarDebug';
import InteriorDebug from './InteriorDebug';

const TABS = [
  { id: 'scene', label: '地景素材组合', desc: '5种场景类型 + 全部装饰物' },
  { id: 'far', label: '远景素材', desc: '远景/中景条带，按场景×时段' },
  { id: 'interior', label: '窗内景素材', desc: '车厢内部视觉元素' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DebugIndex() {
  const [tab, setTab] = useState<TabId>('scene');

  return (
    <div className="min-h-screen bg-[#0a0b0e]">
      {/* 顶部导航 */}
      <nav className="sticky top-0 z-50 bg-[#0a0b0e]/95 border-b border-white/10 backdrop-blur-sm px-6 py-3 flex items-center gap-6">
        <span className="text-sm font-mono text-amber-400/70">🛠 DEBUG</span>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === t.id
                  ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <a href="/" className="ml-auto text-xs text-white/40 hover:text-white/70 transition">
          返回主页 →
        </a>
      </nav>

      {/* 内容 */}
      {tab === 'scene' && <SceneDebug />}
      {tab === 'far' && <FarDebug />}
      {tab === 'interior' && <InteriorDebug />}
    </div>
  );
}
