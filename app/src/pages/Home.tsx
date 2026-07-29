import { useEffect, useRef, useState, useCallback } from 'react';
import type { TimeOfDay } from '@/engine/time';
import { TrainAudio } from '@/engine/audio';
import {
  buildFreeJourney, buildPomodoroJourney, suggestStops,
  TIME_OPTIONS, formatTime, pickStations, type JourneyPlan, type Mode,
} from '@/engine/journey';
import { TrainFront, Volume2, VolumeX, Maximize, Minimize, Flag, Play, Pause, Coffee, RotateCcw, Settings2 } from 'lucide-react';
import { CabinOverlay } from '@/components/CabinOverlay';
import ThreeCanvas, { type TrainControl, type WeatherPreset } from '@/engine/three/ThreeCanvas';

type Phase = 'setup' | 'ride' | 'dwell' | 'done' | 'abort';

const WEATHER_OPTIONS: { value: WeatherPreset; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'clear', label: '晴' },
  { value: 'cloudy', label: '阴' },
  { value: 'rain', label: '雨' },
  { value: 'snow', label: '雪' },
  { value: 'foggy', label: '雾' },
]

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
  speedKmh: number;
  distance: number;
  grade: number;
}

export default function Home() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trainControlRef = useRef<TrainControl | null>(null);
  const audioRef = useRef<TrainAudio | null>(null);
  const planRef = useRef<JourneyPlan | null>(null);
  const originRef = useRef<string>('');
  const phaseRef = useRef<Phase>('setup');
  const segIdxRef = useRef(0);
  const segElapsedRef = useRef(0);
  const focusDoneRef = useRef(0);
  const dwellLeftRef = useRef(0);
  const arrivingRef = useRef(false);
  const stationPreparedRef = useRef(false);
  const distanceRef = useRef(0);
  const soundRef = useRef(true);
  const hudTimerRef = useRef(0);
  const pausedRef = useRef(false);

  // 设置项
  const [mode, setMode] = useState<Mode>('free');
  const [focusMin, setFocusMin] = useState(45);
  const [stops, setStops] = useState(1);
  const [rounds, setRounds] = useState(4);
  const [tod, setTod] = useState<TimeOfDay>(detectTimeOfDay);
  const [weatherPreset, setWeatherPreset] = useState<WeatherPreset>('auto');
  const [sound, setSound] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [plan, setPlan] = useState<JourneyPlan | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const [hud, setHud] = useState<HudState>({
    phase: 'setup', focusLeft: 0, dwellLeft: 0, segIdx: 0, segCount: 0, nextStation: '', speedKmh: 0, distance: 0, grade: 0,
  });

  // 主循环
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const paused = pausedRef.current;

      const plan = planRef.current;
      const phase = phaseRef.current;
      const trainControl = trainControlRef.current;
      const motion = typeof trainControl?.getMotion === 'function' ? trainControl.getMotion() : undefined;
      const speedKmh = motion?.speedKmh ?? 0;
      if (plan && (phase === 'ride' || phase === 'dwell')) {
        audioRef.current?.setSpeed(motion?.speedRatio ?? 0);

        if (!paused && phase === 'ride') {
          distanceRef.current += speedKmh * dt / 3600;
          const seg = plan.segments[segIdxRef.current];
          segElapsedRef.current += dt;
          focusDoneRef.current += dt;
          const left = seg.focusSec - segElapsedRef.current;
          if (!stationPreparedRef.current && left <= 32 && trainControlRef.current) {
            stationPreparedRef.current = true;
            trainControlRef.current.prepareStation(seg.name);
          }
          if (!arrivingRef.current && left <= 16) {
            arrivingRef.current = true;
            trainControlRef.current?.approachStation(seg.name);
            if (audioRef.current?.isRunning) audioRef.current.chime();
          }
          if (left <= 0 && speedKmh < 0.2) {
            const isLast = segIdxRef.current >= plan.segments.length - 1;
            if (isLast) {
              phaseRef.current = 'done';
              setHud((p) => ({ ...p, phase: 'done' }));
              audioRef.current?.stop();
            } else {
              phaseRef.current = 'dwell';
              dwellLeftRef.current = plan.dwellSec;
              trainControlRef.current?.setSpeed(0);
            }
          }
        } else if (!paused && phase === 'dwell') {
          dwellLeftRef.current -= dt;
          if (dwellLeftRef.current <= 0) {
            segIdxRef.current += 1;
            segElapsedRef.current = 0;
            arrivingRef.current = false;
            stationPreparedRef.current = false;
            phaseRef.current = 'ride';
            trainControlRef.current?.departStation();
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
          speedKmh: paused ? 0 : speedKmh,
          distance: distanceRef.current,
          grade: typeof trainControl?.getGrade === 'function' ? trainControl.getGrade() : 0,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startJourney = useCallback(() => {
    const plan = mode === 'free' ? buildFreeJourney(focusMin, stops) : buildPomodoroJourney(rounds);
    planRef.current = plan;
    setPlan(plan);
    originRef.current = pickStations(1)[0];
    segIdxRef.current = 0;
    segElapsedRef.current = 0;
    focusDoneRef.current = 0;
    distanceRef.current = 0;
    arrivingRef.current = false;
    stationPreparedRef.current = false;
    pausedRef.current = false;
    setIsPaused(false);
    trainControlRef.current?.setPaused(false);
    // The Three.js station manager owns the visible dwell/departure sequence.
    const camZ = trainControlRef.current?.getZ() ?? 0;
    trainControlRef.current?.showStation(originRef.current, camZ);
    window.setTimeout(() => {
      trainControlRef.current?.departStation();
      // The station is hidden by StationManager only after it has left view.
    }, 2600);
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
    pausedRef.current = false;
    setIsPaused(false);
    trainControlRef.current?.setPaused(false);
    audioRef.current?.stop();
    // 渐变减速到静止，在原地显示一个车站
    trainControlRef.current?.setSpeed(0);
    const camZ = trainControlRef.current?.getZ() ?? 0;
    trainControlRef.current?.showStation('临时停车', camZ);
    setHud((p) => ({ ...p, phase: 'abort' }));
  }, []);

  const backToSetup = useCallback(() => {
    planRef.current = null;
    setPlan(null);
    phaseRef.current = 'setup';
    pausedRef.current = false;
    setIsPaused(false);
    audioRef.current?.stop();
    audioRef.current = null;
    // Return to stopped-at-station state
    trainControlRef.current?.setPaused(false);
    trainControlRef.current?.setSpeed(0);
    const camZ = trainControlRef.current?.getZ() ?? 0;
    trainControlRef.current?.showStation(pickStations(1)[0], camZ);
    setHud((p) => ({ ...p, phase: 'setup' }));
  }, []);

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

  const togglePause = useCallback(() => {
    const nextPaused = !pausedRef.current;
    pausedRef.current = nextPaused;
    trainControlRef.current?.setPaused(nextPaused);
    if (nextPaused) {
      audioRef.current?.setSpeed(0);
    } else {
      const motion = trainControlRef.current?.getMotion();
      audioRef.current?.setSpeed(motion?.speedRatio ?? 0);
    }
    setIsPaused(nextPaused);
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
  const focusDone = plan ? plan.totalFocusSec - hud.focusLeft : 0;
  const gradePercent = Math.abs(hud.grade * 100);
  const gradeLabel = gradePercent < 0.05 ? '平坡' : hud.grade > 0 ? '上坡' : '下坡';

  return (
    <div ref={wrapRef} className="relative h-screen w-screen overflow-hidden bg-black select-none">
      <ThreeCanvas
        className="absolute inset-0"
        controlRef={trainControlRef}
        timePreset={tod}
        weatherPreset={weatherPreset}
      />

      <CabinOverlay />

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
                <div>
                  <div className="mb-1 text-xs text-white/50">出发天气</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {WEATHER_OPTIONS.map((option) => (
                      <button key={option.value} onClick={() => setWeatherPreset(option.value)}
                        className={`rounded-md border py-1 text-[11px] transition ${weatherPreset === option.value ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/10 text-white/40 hover:text-white/70'}`}>
                        {option.label}
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
              {isPaused ? '行程已暂停' : hud.phase === 'dwell' ? '列车经停中' : `开往 ${hud.nextStation}站`}
            </div>
          </div>

          <div className="absolute right-8 top-8 z-20 flex gap-2">
            <button onClick={togglePause} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title={isPaused ? '继续行程' : '暂停行程'} aria-label={isPaused ? '继续行程' : '暂停行程'}>
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button onClick={() => {
              const control = trainControlRef.current;
              if (typeof control?.resetView === 'function') control.resetView();
            }} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title="复位观察方向" aria-label="复位观察方向">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={toggleSound} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title={sound ? '关闭声音' : '开启声音'} aria-label={sound ? '关闭声音' : '开启声音'}>
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button onClick={toggleFullscreen} className="rounded-full bg-black/45 p-2.5 text-white/85 backdrop-blur transition hover:bg-black/65" title={isFullscreen ? '退出全屏' : '进入全屏'} aria-label={isFullscreen ? '退出全屏' : '进入全屏'}>
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
                style={{ width: `${plan ? (focusDone / plan.totalFocusSec) * 100 : 0}%` }} />
              {plan?.segments.map((s, i) => {
                const acc = plan.segments.slice(0, i + 1).reduce((a, x) => a + x.focusSec, 0);
                const pct = (acc / plan.totalFocusSec) * 100;
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
              <span>{Math.round(hud.speedKmh)} km/h · {gradeLabel} {gradePercent.toFixed(1)}% · 已行驶 {hud.distance.toFixed(1)} km</span>
            </div>
          </div>
        </>
      )}

      {/* ================= 到达终点 ================= */}
      {hud.phase === 'done' && (
        <EndCard
          title={`列车已到达 ${plan?.terminal ?? ''}站`}
          lines={[
            `本次旅程专注 ${Math.round((plan?.totalFocusSec ?? 0) / 60)} 分钟`,
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
