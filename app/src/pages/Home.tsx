import { useEffect, useRef, useState, useCallback } from 'react';
import { SceneryEngine, type TimeOfDay } from '@/engine/scenery';
import { TrainAudio } from '@/engine/audio';
import { PencilRenderer } from '@/engine/pencil';
import {
  buildFreeJourney, buildPomodoroJourney, suggestStops,
  TIME_OPTIONS, formatTime, pickStations, type JourneyPlan, type Mode,
} from '@/engine/journey';
import { TrainFront, Volume2, VolumeX, Maximize, Minimize, Flag, Play, Coffee, Palette, Pencil, Settings2 } from 'lucide-react';
import ThreeCanvas, { type TrainControl } from '@/engine/three/ThreeCanvas';

type Phase = 'setup' | 'ride' | 'dwell' | 'done' | 'abort';

// 根据真实时间自动选择出发时段
function detectTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 9 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'dusk';
  return 'night';
}

interface HudState {
  phase: Phase;
  focusLeft: number;
  dwellLeft: number;
  segIdx: number;
  segCount: number;
  nextStation: string;
  speed: number;
  distance: number;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SceneryEngine | null>(null);
  const trainControlRef = useRef<TrainControl | null>(null);
  const pencilRef = useRef<PencilRenderer | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const styleRef = useRef<'color' | 'pencil'>('pencil');
  const audioRef = useRef<TrainAudio | null>(null);
  const planRef = useRef<JourneyPlan | null>(null);
  const originRef = useRef<string>('');
  const phaseRef = useRef<Phase>('setup');
  const segIdxRef = useRef(0);
  const segElapsedRef = useRef(0);
  const focusDoneRef = useRef(0);
  const dwellLeftRef = useRef(0);
  const arrivingRef = useRef(false);
  const distanceRef = useRef(0);
  const soundRef = useRef(true);
  const hudTimerRef = useRef(0);

  // 设置项
  const [mode, setMode] = useState<Mode>('free');
  const [focusMin, setFocusMin] = useState(45);
  const [stops, setStops] = useState(1);
  const [rounds, setRounds] = useState(4);
  const [tod, setTod] = useState<TimeOfDay>(detectTimeOfDay);
  const [sound, setSound] = useState(true);
  const [artStyle, setArtStyle] = useState<'color' | 'pencil'>('pencil');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);

  const [hud, setHud] = useState<HudState>({
    phase: 'setup', focusLeft: 0, dwellLeft: 0, segIdx: 0, segCount: 0, nextStation: '', speed: 0, distance: 0,
  });

  // 初始化 / 切换时段时重建引擎：列车停靠在始发站等待发车
  useEffect(() => {
    const eng = new SceneryEngine(tod);
    eng.arrive(pickStations(1)[0]);
    eng.platformMode = 'dwell';
    engineRef.current = eng;
  }, [tod]);

  // 主循环
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const eng = engineRef.current;
      const cv = canvasRef.current;
      if (!eng || !cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
      const pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr));

      eng.update(dt);

      // 2D 画布隐藏时跳过绘制（3D 场景由 ThreeCanvas 渲染），引擎仍驱动旅程状态
      if (cv.style.visibility !== 'hidden') {
      // 场景先绘制到离屏画布
      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      const off = offscreenRef.current;
      if (off.width !== pw || off.height !== ph) { off.width = pw; off.height = ph; }
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      eng.draw(octx, w, h);

      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }

      if (styleRef.current === 'pencil') {
        if (!pencilRef.current) {
          try { pencilRef.current = new PencilRenderer(); } catch { styleRef.current = 'color'; }
        }
        if (pencilRef.current) {
          const night = eng.pal.night;
          pencilRef.current.render(off, cv, {
            paperColor: night ? [0.13, 0.13, 0.15] : [0.925, 0.905, 0.855],
            pencilColor: night ? [0.82, 0.8, 0.74] : [0.16, 0.15, 0.17],
            time: eng.t,
            strength: night ? 0.9 : 0.82,
          });
        }
      } else {
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, 0, 0);
      }
      }

      const plan = planRef.current;
      const phase = phaseRef.current;
      if (plan && (phase === 'ride' || phase === 'dwell')) {
        distanceRef.current += eng.speed * (120 / 3600) * dt;
        audioRef.current?.setSpeed(eng.speed);

        if (phase === 'ride') {
          const seg = plan.segments[segIdxRef.current];
          segElapsedRef.current += dt;
          focusDoneRef.current += dt;
          const left = seg.focusSec - segElapsedRef.current;
          if (!arrivingRef.current && left <= 16) {
            arrivingRef.current = true;
            eng.arrive(seg.name);
            // Show the approaching station ~16s ahead at cruise speed
            const camZ = trainControlRef.current?.getZ() ?? 0;
            trainControlRef.current?.showStation(seg.name, camZ + 16 * 15);
            if (audioRef.current?.isRunning) audioRef.current.chime();
          }
          if (left <= 0 && eng.speed < 0.02) {
            const isLast = segIdxRef.current >= plan.segments.length - 1;
            if (isLast) {
              phaseRef.current = 'done';
              setHud((p) => ({ ...p, phase: 'done' }));
              audioRef.current?.stop();
            } else {
              phaseRef.current = 'dwell';
              dwellLeftRef.current = plan.dwellSec;
              trainControlRef.current?.setSpeed(0); // 到站停车
            }
          }
        } else if (phase === 'dwell') {
          dwellLeftRef.current -= dt;
          if (dwellLeftRef.current <= 0) {
            segIdxRef.current += 1;
            segElapsedRef.current = 0;
            arrivingRef.current = false;
            phaseRef.current = 'ride';
            eng.depart();
            trainControlRef.current?.setSpeed(15); // 离站发车
            trainControlRef.current?.hideStation(); // 收起站台
          }
        }
      }

      // HUD 节流刷新
      hudTimerRef.current += dt;
      if (hudTimerRef.current > 0.2) {
        hudTimerRef.current = 0;
        const p = planRef.current;
        setHud({
          phase: phaseRef.current,
          focusLeft: p ? Math.max(0, p.totalFocusSec - focusDoneRef.current) : 0,
          dwellLeft: Math.max(0, dwellLeftRef.current),
          segIdx: segIdxRef.current,
          segCount: p ? p.segments.length : 0,
          nextStation: p && segIdxRef.current < p.segments.length ? p.segments[segIdxRef.current].name : '',
          speed: eng.speed,
          distance: distanceRef.current,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startJourney = useCallback(() => {
    const plan = mode === 'free' ? buildFreeJourney(focusMin, stops) : buildPomodoroJourney(rounds);
    planRef.current = plan;
    originRef.current = pickStations(1)[0];
    segIdxRef.current = 0;
    segElapsedRef.current = 0;
    focusDoneRef.current = 0;
    distanceRef.current = 0;
    arrivingRef.current = false;
    const eng = engineRef.current;
    if (eng) {
      // 列车已在始发站停稳，检票上车后稍候发车（关门-启动的节奏）
      eng.arrive(originRef.current);
      eng.platformMode = 'dwell';
      // 已经停在站台上了，不需要再 setSpeed(0)
      const camZ = trainControlRef.current?.getZ() ?? 0;
      trainControlRef.current?.showStation(originRef.current, camZ);
      window.setTimeout(() => {
        eng.depart();
        trainControlRef.current?.setSpeed(15); // 缓缓加速开出车站
        // 车站会在完全离开视野后由 StationManager 自动隐藏（0.8s 缓冲）
      }, 2600);
    }
    if (soundRef.current) {
      const au = new TrainAudio();
      audioRef.current = au;
      au.start();
    }
    phaseRef.current = 'ride';
    setHud((p) => ({ ...p, phase: 'ride' }));
  }, [mode, focusMin, stops, rounds]);

  const doAbort = useCallback(() => {
    phaseRef.current = 'abort';
    setConfirmAbort(false);
    audioRef.current?.stop();
    // 渐变减速到静止，在原地显示一个车站
    trainControlRef.current?.setSpeed(0);
    const camZ = trainControlRef.current?.getZ() ?? 0;
    trainControlRef.current?.showStation('临时停车', camZ);
    engineRef.current?.setCruising();
    setHud((p) => ({ ...p, phase: 'abort' }));
  }, []);

  const backToSetup = useCallback(() => {
    planRef.current = null;
    phaseRef.current = 'setup';
    audioRef.current?.stop();
    audioRef.current = null;
    const eng = new SceneryEngine(tod);
    eng.arrive(pickStations(1)[0]);
    eng.platformMode = 'dwell';
    engineRef.current = eng;
    // Return to stopped-at-station state
    trainControlRef.current?.setSpeed(0);
    const camZ = trainControlRef.current?.getZ() ?? 0;
    trainControlRef.current?.showStation(pickStations(1)[0], camZ);
    setHud((p) => ({ ...p, phase: 'setup' }));
  }, [tod]);

  const toggleSound = useCallback(() => {
    setSound((s) => {
      const next = !s;
      soundRef.current = next;
      if (!next) audioRef.current?.stop();
      else if (phaseRef.current === 'ride' || phaseRef.current === 'dwell') {
        if (!audioRef.current?.isRunning) {
          const au = new TrainAudio();
          audioRef.current = au;
          au.start();
        }
      }
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      wrapRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  const riding = hud.phase === 'ride' || hud.phase === 'dwell';
  const focusDone = planRef.current ? planRef.current.totalFocusSec - hud.focusLeft : 0;

  return (
    <div ref={wrapRef} className="relative h-screen w-screen overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ zIndex: 1, visibility: 'hidden' }} />
      <ThreeCanvas className="absolute inset-0" controlRef={trainControlRef} />

      {/* 车窗框（橡胶密封条 + 内框 + 车身壁板，加厚） */}
      <div className="pointer-events-none absolute inset-0 z-10"
        style={{
          boxShadow: 'inset 0 0 0 10px #0a0b0d, inset 0 0 0 16px #1a1c20, inset 0 0 0 26px #2c2f35, inset 0 0 0 30px #141518, inset 0 0 100px 34px rgba(0,0,0,0.42)',
          borderRadius: 34,
        }} />
      {/* 玻璃反光 */}
      <div className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: 'linear-gradient(115deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 22%, transparent 30%, transparent 70%, rgba(255,255,255,0.04) 82%, transparent 90%)',
          borderRadius: 30,
        }} />
      {/* 窗台（更宽，带小桌板凹槽和杯槽） */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-14"
        style={{ background: 'linear-gradient(to bottom, #42464e, #26292f 55%, #17191d)', borderRadius: '0 0 20px 20px' }}>
        {/* 杯槽 */}
        <div className="absolute right-[16%] top-2 h-6 w-14 rounded-full"
          style={{ background: 'radial-gradient(ellipse at center, #101114 0%, #1e2025 70%, #2c2e34 100%)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)' }} />
        {/* 窗台前沿高光 */}
        <div className="absolute inset-x-8 top-0 h-[2px] rounded" style={{ background: 'rgba(255,255,255,0.10)' }} />
      </div>

      {/* ===== 车厢内部景物 ===== */}
      {/* 左侧乘客座椅靠背剪影 */}
      <div className="pointer-events-none absolute bottom-6 left-0 z-[15]"
        style={{
          width: '8.5vw', height: '20vh', minWidth: 90,
          background: 'linear-gradient(to right, #0c0d10 0%, #191a1f 75%, #232529 100%)',
          borderRadius: '0 64px 10px 0',
          boxShadow: 'inset -8px 0 16px rgba(255,255,255,0.05)',
        }} />
      {/* 头枕 */}
      <div className="pointer-events-none absolute left-0 z-[15]"
        style={{
          bottom: 'calc(6px + 20vh - 2px)', width: '7vw', height: '5.5vh', minWidth: 74,
          background: 'linear-gradient(to right, #0b0c0f, #1c1d22)',
          borderRadius: '0 30px 6px 0',
        }} />
      {/* 顶部：车厢内壁（背光剪影）+ 行李架 */}
      <div className="pointer-events-none absolute left-0 right-0 top-4 z-[15] h-[9vh]"
        style={{ background: 'linear-gradient(to bottom, #131417 0%, #1c1e23 55%, rgba(28,30,35,0) 100%)' }} />
      {/* 行李架外沿 */}
      <div className="pointer-events-none absolute left-0 right-0 z-[15]"
        style={{
          top: 'calc(4px + 9vh)', height: 10,
          background: 'linear-gradient(to bottom, rgba(40,42,48,0.9), rgba(20,21,25,0))',
        }} />
      {/* 行李架上的行李剪影 */}
      <div className="pointer-events-none absolute z-[15]" style={{ left: '16%', top: 'calc(4px + 3.5vh)' }}>
        <div style={{ width: 120, height: '5vh', background: '#101114', borderRadius: '10px 10px 4px 4px' }} />
      </div>
      <div className="pointer-events-none absolute z-[15]" style={{ left: '62%', top: 'calc(4px + 4.5vh)' }}>
        <div style={{ width: 84, height: '4vh', background: '#0e0f12', borderRadius: '14px 14px 4px 4px' }} />
      </div>
      {/* 左右车窗立柱（宽厚的窗间壁，背光剪影） */}
      <div className="pointer-events-none absolute left-0 top-4 bottom-10 z-[15] w-[3.2vw] min-w-[34px]"
        style={{ background: 'linear-gradient(to right, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '0 10px 10px 0' }} />
      <div className="pointer-events-none absolute right-0 top-4 bottom-10 z-[15] w-[3.2vw] min-w-[34px]"
        style={{ background: 'linear-gradient(to left, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '10px 0 0 10px' }} />
      {/* 遮光帘（右侧垂下一截，背光） */}
      <div className="pointer-events-none absolute right-[3.2vw] top-4 z-[16] w-[2.6vw] min-w-[30px] h-[16vh]"
        style={{ background: 'linear-gradient(to left, #17181d, #22242a 60%, #2a2c33)', borderRadius: '0 0 14px 4px' }} />

      {/* ================= 设置页 ================= */}
      {hud.phase === 'setup' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/60 p-6 text-white shadow-2xl backdrop-blur-xl">
            {/* 标题 */}
            <div className="mb-1 flex items-center gap-2 text-lg font-bold tracking-wide">
              <TrainFront className="h-5 w-5 text-amber-300" />
              窗景 · 专注列车
            </div>
            <p className="mb-5 text-xs text-white/40">买一张车票，让窗外的风景陪你抵达目的地。</p>

            {/* 模式 */}
            <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-lg bg-white/8 p-1">
              {([['free', '自由旅程'], ['pomodoro', '番茄钟']] as [Mode, string][]).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`rounded-md py-1.5 text-sm font-medium transition ${mode === m ? 'bg-amber-400 text-black' : 'text-white/60 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 核心设置 */}
            {mode === 'free' ? (
              <div className="mb-6">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-white/70">专注时长</span>
                  <span className="font-mono text-amber-300">{focusMin} 分钟</span>
                </div>
                <input type="range" min={10} max={120} step={5} value={focusMin}
                  onChange={(e) => { const v = +e.target.value; setFocusMin(v); setStops(suggestStops(v)); }}
                  className="w-full accent-amber-400" />
                <div className="mt-1 flex justify-between text-[10px] text-white/30">
                  <span>10</span><span>120</span>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-white/70">番茄轮次</span>
                  <span className="font-mono text-amber-300">{rounds} 轮</span>
                </div>
                <input type="range" min={1} max={8} value={rounds} onChange={(e) => setRounds(+e.target.value)}
                  className="w-full accent-amber-400" />
                <div className="mt-1 flex justify-between text-[10px] text-white/30">
                  <span>1</span><span>8</span>
                </div>
                <p className="mt-1 text-[11px] text-white/35">25 分钟专注 / 5 分钟休息</p>
              </div>
            )}

            {/* 检票上车 */}
            <button onClick={startJourney}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-[0.98]">
              <Play className="h-4 w-4" /> 检票上车
            </button>

            {/* 高级设置（折叠） */}
            <details className="mt-4">
              <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-white/35 transition hover:text-white/55">
                <Settings2 className="h-3 w-3" /> 高级设置
              </summary>
              <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
                {/* 经停站 */}
                {mode === 'free' && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-white/50">沿途经停站</span>
                      <span className="font-mono text-amber-300/70">{stops} 站</span>
                    </div>
                    <input type="range" min={0} max={5} value={stops} onChange={(e) => setStops(+e.target.value)}
                      className="w-full accent-amber-400/60" />
                  </div>
                )}
                {/* 出发时段 */}
                <div>
                  <div className="mb-1 text-xs text-white/50">出发时段</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TIME_OPTIONS.map((o) => (
                      <button key={o.value} onClick={() => setTod(o.value)}
                        className={`rounded-md border py-1 text-[11px] transition ${tod === o.value ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/10 text-white/40 hover:text-white/70'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 画面风格 */}
                <div>
                  <div className="mb-1 text-xs text-white/50">画面风格</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['pencil', '铅笔素描'], ['color', '彩色']] as const).map(([v, label]) => (
                      <button key={v} onClick={() => { setArtStyle(v); styleRef.current = v; }}
                        className={`flex items-center justify-center gap-1 rounded-md border py-1 text-[11px] transition ${artStyle === v ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/10 text-white/40 hover:text-white/70'}`}>
                        {v === 'pencil' ? <Pencil className="h-3 w-3" /> : <Palette className="h-3 w-3" />}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* ================= 行驶 HUD ================= */}
      {riding && (
        <>
          <div className="absolute left-1/2 top-8 z-20 -translate-x-1/2 text-center text-white">
            <div className="font-mono text-5xl font-bold tracking-wider drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
              {formatTime(hud.focusLeft)}
            </div>
            <div className="mt-1 text-xs tracking-widest text-white/70 drop-shadow">
              {hud.phase === 'dwell' ? '列车经停中' : `开往 ${hud.nextStation}站`}
            </div>
          </div>

          <div className="absolute right-8 top-8 z-20 flex gap-2">
            <button onClick={() => { const v = artStyle === 'pencil' ? 'color' : 'pencil'; setArtStyle(v); styleRef.current = v; }}
              className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title="切换画风">
              {artStyle === 'pencil' ? <Palette className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
            <button onClick={toggleSound} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65">
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button onClick={toggleFullscreen} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65">
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            <button onClick={() => setConfirmAbort(true)} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title="中途下车">
              <Flag className="h-4 w-4" />
            </button>
          </div>

          {/* 经停休息卡片 */}
          {hud.phase === 'dwell' && (
            <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-black/55 px-8 py-6 text-center text-white backdrop-blur-md">
              <Coffee className="mx-auto mb-2 h-6 w-6 text-amber-300" />
              <div className="text-lg font-semibold">列车经停 {hud.nextStation}站</div>
              <div className="mt-1 text-sm text-white/60">起身活动一下，{formatTime(hud.dwellLeft)} 后发车</div>
            </div>
          )}

          {/* 底部进度 */}
          <div className="absolute bottom-16 left-1/2 z-20 w-[min(620px,80vw)] -translate-x-1/2">
            <div className="relative h-1 rounded bg-white/25">
              <div className="absolute h-1 rounded bg-amber-400 transition-all duration-500"
                style={{ width: `${planRef.current ? (focusDone / planRef.current.totalFocusSec) * 100 : 0}%` }} />
              {planRef.current?.segments.map((s, i) => {
                const acc = planRef.current!.segments.slice(0, i + 1).reduce((a, x) => a + x.focusSec, 0);
                const pct = (acc / planRef.current!.totalFocusSec) * 100;
                return (
                  <div key={i} className="group absolute -top-1" style={{ left: `calc(${pct}% - 5px)` }}>
                    <div className={`h-3 w-3 rounded-full border-2 ${i < hud.segIdx ? 'border-amber-400 bg-amber-400' : 'border-white/60 bg-black/60'}`} />
                    <div className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/70">{s.name}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex justify-between text-[11px] tracking-wider text-white/60">
              <span>第 {Math.min(hud.segIdx + 1, hud.segCount)} / {hud.segCount} 区间</span>
              <span>{Math.round(hud.speed * 120)} km/h · 已行驶 {hud.distance.toFixed(1)} km</span>
            </div>
          </div>
        </>
      )}

      {/* ================= 到达终点 ================= */}
      {hud.phase === 'done' && (
        <EndCard
          title={`列车已到达 ${planRef.current?.terminal ?? ''}站`}
          lines={[
            `本次旅程专注 ${Math.round((planRef.current?.totalFocusSec ?? 0) / 60)} 分钟`,
            `途经 ${hud.segCount} 个区间 · 行驶 ${hud.distance.toFixed(1)} km`,
            '感谢乘坐，愿每一段专注都有风景相伴。',
          ]}
          onAgain={backToSetup}
        />
      )}

      {/* ================= 中途下车 ================= */}
      {hud.phase === 'abort' && (
        <EndCard
          title="你已在途中下车"
          lines={[
            `本次专注了 ${Math.floor(focusDone / 60)} 分 ${Math.round(focusDone % 60)} 秒`,
            `列车仍在前行，期待你再次启程。`,
          ]}
          onAgain={backToSetup}
        />
      )}

      {/* 下车确认 */}
      {confirmAbort && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-neutral-900 p-6 text-white shadow-xl">
            <div className="mb-2 text-lg font-semibold">确定中途下车？</div>
            <p className="mb-5 text-sm text-white/60">本次旅程尚未到达终点，下车后行程将结束。</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAbort(false)} className="flex-1 rounded-lg border border-white/20 py-2 text-sm hover:bg-white/10">继续乘车</button>
              <button onClick={doAbort} className="flex-1 rounded-lg bg-red-500/90 py-2 text-sm font-medium hover:bg-red-500">下车</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EndCard({ title, lines, onAgain }: { title: string; lines: string[]; onAgain: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/60 p-8 text-center text-white shadow-2xl backdrop-blur-md">
        <TrainFront className="mx-auto mb-3 h-8 w-8 text-amber-300" />
        <div className="mb-3 text-xl font-bold">{title}</div>
        {lines.map((l, i) => (
          <p key={i} className={i === lines.length - 1 ? 'mt-3 text-sm text-white/50' : 'text-sm text-white/80'}>{l}</p>
        ))}
        <button onClick={onAgain}
          className="mt-6 w-full rounded-xl bg-amber-400 py-3 font-bold text-black transition hover:bg-amber-300 active:scale-[0.98]">
          再乘一班
        </button>
      </div>
    </div>
  );
}
