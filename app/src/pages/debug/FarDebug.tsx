import { useRef, useEffect, useState } from 'react';
import type { SceneKind, TimeOfDay } from '../../engine/scenery';
import {
  SCENE_KINDS,
  paletteFor,
  buildFarBand,
  buildMidBand,
} from '../../engine/scenery';

const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: '清晨', day: '白天', dusk: '黄昏', night: '夜晚',
};
const SCENE_NAMES: Record<SceneKind, string> = {
  field: '田野', forest: '森林', mountain: '山地', river: '河流', town: '小镇',
};

function renderGrid(
  container: HTMLDivElement,
  kind: SceneKind,
  pal: ReturnType<typeof paletteFor>,
  timeName: string,
) {
  const item = document.createElement('div');
  item.style.display = 'flex';
  item.style.flexDirection = 'column';
  item.style.alignItems = 'center';
  item.style.gap = '6px';

  const label = document.createElement('span');
  label.textContent = `${timeName}`;
  label.style.fontSize = '11px';
  label.style.color = 'rgba(255,255,255,0.5)';

  // 远景
  const farCanvas = document.createElement('canvas');
  farCanvas.width = 340;
  farCanvas.height = 150;
  farCanvas.style.width = '340px';
  farCanvas.style.height = '150px';
  farCanvas.style.borderRadius = '8px';
  farCanvas.style.border = '1px solid rgba(255,255,255,0.1)';
  const farCtx = farCanvas.getContext('2d')!;

  // 天空背景
  const sky = farCtx.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(0.55, pal.skyBot);
  farCtx.fillStyle = sky;
  farCtx.fillRect(0, 0, 340, 150);

  // 绘制 far band
  try {
    const far = buildFarBand(kind, pal, 12345);
    farCtx.drawImage(far, 0, 30, 340, 120);
  } catch {
    farCtx.fillStyle = 'red';
    farCtx.fillText('Error', 10, 40);
  }

  const farLabel = document.createElement('span');
  farLabel.textContent = '远景层';
  farLabel.style.fontSize = '10px';
  farLabel.style.color = 'rgba(255,255,255,0.35)';

  // 中景
  const midCanvas = document.createElement('canvas');
  midCanvas.width = 340;
  midCanvas.height = 150;
  midCanvas.style.width = '340px';
  midCanvas.style.height = '150px';
  midCanvas.style.borderRadius = '8px';
  midCanvas.style.border = '1px solid rgba(255,255,255,0.1)';
  const midCtx = midCanvas.getContext('2d')!;

  midCtx.fillStyle = 'rgba(0,0,0,0.02)';
  midCtx.fillRect(0, 0, 340, 150);

  try {
    const mid = buildMidBand(kind, pal, 12352);
    midCtx.drawImage(mid, 0, 30, 340, 120);
  } catch {
    midCtx.fillStyle = 'red';
    midCtx.fillText('Error', 10, 40);
  }

  const midLabel = document.createElement('span');
  midLabel.textContent = '中景层';
  midLabel.style.fontSize = '10px';
  midLabel.style.color = 'rgba(255,255,255,0.35)';

  item.appendChild(label);
  item.appendChild(farCanvas);
  item.appendChild(farLabel);
  item.appendChild(midCanvas);
  item.appendChild(midLabel);
  container.appendChild(item);
}

export default function FarDebug() {
  const farGridRef = useRef<HTMLDivElement>(null);
  const [tod, setTod] = useState<TimeOfDay>('day');

  useEffect(() => {
    const container = farGridRef.current;
    if (!container) return;
    container.innerHTML = '';

    const pal = paletteFor(tod);
    const timeName = TIME_LABELS[tod];

    // 远景 + 中景，按场景类型横排
    const section = document.createElement('div');
    section.style.display = 'flex';
    section.style.flexWrap = 'wrap';
    section.style.gap = '24px';

    for (const kind of SCENE_KINDS) {
      // 每个场景类型一个列
      const col = document.createElement('div');
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.gap = '16px';
      col.style.alignItems = 'center';
      col.style.flex = '1';
      col.style.minWidth = '300px';

      const header = document.createElement('h3');
      header.textContent = SCENE_NAMES[kind];
      header.style.fontSize = '16px';
      header.style.fontWeight = '600';
      header.style.color = 'rgba(255,255,255,0.85)';
      col.appendChild(header);

      renderGrid(col, kind, pal, timeName);
      section.appendChild(col);
    }

    container.appendChild(section);
  }, [tod]);

  // 时段网格视图 — 所有 5 场景 × 4 时段
  useEffect(() => {
    // We'll use a separate ref for the time grid
    // This is handled in the main grid render above
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white p-6">
      <h1 className="text-2xl font-bold mb-2">🏔️ 远景素材</h1>
      <p className="text-sm text-white/50 mb-6">
        五种场景类型在不同时段下的远景层（far band）+ 中景层（mid band）
      </p>

      {/* 时段切换 */}
      <div className="flex gap-2 mb-6">
        {(Object.entries(TIME_LABELS) as [TimeOfDay, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTod(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              tod === t ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* 当前时段下的所有场景 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-white/80">
          {TIME_LABELS[tod]} · 场景条带
        </h2>
        <div ref={farGridRef} />
      </section>
    </div>
  );
}
