import { useRef, useEffect, useState } from 'react';
import type { SceneKind, TimeOfDay, Palette, Decor, DecorMaker } from '../../engine/scenery';
import {
  SCENE_KINDS,
  paletteFor,
  mulberry32,
  dTreeRound,
  dTreePine,
  dTreeWillow,
  dTreeBare,
  dTreeCluster,
  dHouse,
  dWindmill,
  dHay,
  dCow,
  dBoat,
  dBush,
  dFlowers,
  dLamp,
  dFarmhouse,
  dChurch,
  dWaterTower,
  dSignalGantry,
  dPowerTower,
  dSheepFlock,
  dSunflower,
  dVineyard,
  dRailHut,
  dVillageCluster,
  dCornfield,
} from '../../engine/scenery';

const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: '清晨',
  day: '白天',
  dusk: '黄昏',
  night: '夜晚',
};

function renderSceneOnCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: SceneKind,
  pal: Palette,
) {
  // 天空
  const hz = h * 0.6;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hz);

  // 日/月
  const sunPositions: Record<TimeOfDay, [number, number]> = {
    morning: [0.78, 0.34], day: [0.55, 0.16], dusk: [0.2, 0.42], night: [0.72, 0.2],
  };
  const [sx, sy] = sunPositions['day']; // use day position for consistency
  const sunR = kind === 'field' ? 34 : 26;
  ctx.fillStyle = pal.sun;
  ctx.beginPath(); ctx.arc(sx * w, sy * h, sunR, 0, Math.PI * 2); ctx.fill();

  // 地面底色
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, hz - 8, w, h - hz + 8);

  // 标签
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(sceneName(kind), w / 2, 19);
}

function sceneName(k: SceneKind) {
  const names: Record<SceneKind, string> = { field: '田野', forest: '森林', mountain: '山地', river: '河流', town: '小镇' };
  return names[k];
}

// 每个素材的渲染器（独立 small canvas 绘制单个 decor）
function renderDecorPreview(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  drawFn: (ctx: CanvasRenderingContext2D, x: number, y: number, pal: Palette) => void,
  pal: Palette,
  label: string,
) {
  // 天空底色
  const hz = ch * 0.55;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, hz);
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, hz - 2, cw, ch - hz + 2);

  // 绘制装饰物（居中底部）
  drawFn(ctx, cw / 2, hz + 6, pal);

  // 标签
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, cw, 20);
  ctx.fillStyle = '#fff';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(label, cw / 2, 14);
}

const DECOR_NAMES: [DecorMaker, string][] = [
  [dTreeRound, '阔叶树'], [dTreePine, '针叶树'], [dTreeWillow, '垂柳'],
  [dTreeBare, '枯枝树'], [dTreeCluster, '树丛'], [dHouse, '房屋'],
  [dWindmill, '风车'], [dHay, '草垛'], [dCow, '牛'], [dBoat, '帆船'],
  [dBush, '灌木丛'], [dFlowers, '花丛'], [dLamp, '路灯'],
  [dFarmhouse, '农舍'], [dChurch, '教堂'], [dWaterTower, '水塔'],
  [dSignalGantry, '信号机'], [dPowerTower, '高压电塔'], [dSheepFlock, '羊群'],
  [dSunflower, '向日葵'], [dVineyard, '葡萄架'], [dRailHut, '道班房'],
  [dVillageCluster, '村落群'], [dCornfield, '玉米地'],
];

export default function SceneDebug() {
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const decorContainerRef = useRef<HTMLDivElement>(null);
  const [tod, setTod] = useState<TimeOfDay>('day');

  // 场景组合概览
  useEffect(() => {
    const c = sceneCanvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const pal = paletteFor(tod);
    const cols = 5;
    const rows = 1;
    const cw = w / cols;
    const ch = h / rows;

    for (let i = 0; i < SCENE_KINDS.length; i++) {
      const kind = SCENE_KINDS[i];
      const sx = (i % cols) * cw;
      const sy = Math.floor(i / cols) * ch;

      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, cw, ch);
      ctx.clip();
      renderSceneOnCanvas(ctx, cw, ch, kind, pal);
      ctx.restore();

      // 边框
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, cw, ch);
    }
  }, [tod]);

  // 装饰物素材画廊
  useEffect(() => {
    const container = decorContainerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const pal = paletteFor(tod);

    for (let i = 0; i < DECOR_NAMES.length; i++) {
      const [maker, name] = DECOR_NAMES[i];
      const rng = mulberry32(i * 137 + 42);

      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.flexDirection = 'column';
      item.style.alignItems = 'center';
      item.style.gap = '4px';

      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 130;
      canvas.style.width = '160px';
      canvas.style.height = '130px';
      canvas.style.borderRadius = '8px';
      canvas.style.border = '1px solid rgba(255,255,255,0.1)';

      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 160, 130);

      try {
        const draw = maker(() => rng(), pal);
        renderDecorPreview(ctx, 160, 130, draw, pal, name);
      } catch {
        ctx.fillStyle = 'red';
        ctx.font = '10px monospace';
        ctx.fillText('Render Error', 30, 40);
      }

      const label = document.createElement('span');
      label.textContent = name;
      label.style.color = 'rgba(255,255,255,0.6)';
      label.style.fontSize = '11px';

      item.appendChild(canvas);
      item.appendChild(label);
      container.appendChild(item);
    }
  }, [tod]);

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white p-6">
      <h1 className="text-2xl font-bold mb-2">🌄 地景 · 素材组合</h1>
      <p className="text-sm text-white/50 mb-6">
        五种场景类型的完整组合预览，包含远景 + 中景 + 随机装饰物分布
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

      {/* 场景组合大图 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-white/80">场景类型一览</h2>
        <canvas ref={sceneCanvasRef} className="w-full rounded-xl border border-white/10" style={{ height: 240 }} />
      </section>

      {/* 装饰物素材库 */}
      <section>
        <h2 className="text-lg font-semibold mb-3 text-white/80">
          装饰物素材库
          <span className="text-sm font-normal text-white/40 ml-2">（从所有场景的装饰物池收集）</span>
        </h2>
        <div
          ref={decorContainerRef}
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        />
      </section>
    </div>
  );
}
