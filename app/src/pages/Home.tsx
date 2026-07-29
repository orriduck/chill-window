import { useEffect, useRef, useState, useCallback } from 'react';
import type { TimeOfDay } from '@/engine/time';
import { TrainAudio } from '@/engine/audio';
import {
  DepartureScheduler, buildFreeJourney, buildPomodoroJourney, journeyBannerText, suggestStops,
  TIME_OPTIONS, formatTime, pickStations, type JourneyPlan, type Mode,
} from '@/engine/journey';
import { TrainFront, Volume2, VolumeX, Maximize, Minimize, Flag, Play, Pause, Coffee, RotateCcw, Settings2 } from 'lucide-react';
import { CabinOverlay } from '@/components/CabinOverlay';
import ThreeCanvas, { type TrainControl, type WeatherPreset } from '@/engine/three/ThreeCanvas';
import type { WindowHudControlAnchor, WindowHudControlHitArea } from '@/engine/three/interior/WindowFrame';

type Phase = 'setup' | 'ride' | 'dwell' | 'done' | 'abort';

const WEATHER_OPTIONS: { value: WeatherPreset; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'clear', label: 'Clear' },
  { value: 'cloudy', label: 'Overcast' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
  { value: 'foggy', label: 'Fog' },
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
  routeLabel: string;
  nextRouteLabel: string;
  approaching: boolean;
  hudAnchor: WindowHudControlAnchor | null;
  hudControlHitAreas: WindowHudControlHitArea[];
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
  const departureSchedulerRef = useRef<DepartureScheduler | null>(null);
  if (departureSchedulerRef.current === null) departureSchedulerRef.current = new DepartureScheduler();

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

  useEffect(() => () => departureSchedulerRef.current?.cancel(), []);

  const [hud, setHud] = useState<HudState>({
    phase: 'setup', focusLeft: 0, dwellLeft: 0, segIdx: 0, segCount: 0, nextStation: '', speedKmh: 0, distance: 0, grade: 0, routeLabel: 'Open fields', nextRouteLabel: 'Woodland', approaching: false, hudAnchor: null, hudControlHitAreas: [],
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
        audioRef.current?.setMotion({
          speedRatio: motion?.speedRatio ?? 0,
          acceleration: motion?.acceleration ?? 0,
        });

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
            const nextSegment = plan.segments[segIdxRef.current];
            trainControlRef.current?.planStation(nextSegment.name, nextSegment.focusSec);
            trainControlRef.current?.departStation();
          }
        }
      }

      // HUD 节流刷新
      hudTimerRef.current += dt;
      if (hudTimerRef.current > 0.2) {
        hudTimerRef.current = 0;
        const p = planRef.current;
        const routeContext = typeof trainControl?.getRouteContext === 'function'
          ? trainControl.getRouteContext()
          : { currentLabel: 'Open fields', nextLabel: 'Woodland' };
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
          routeLabel: routeContext.currentLabel,
          nextRouteLabel: routeContext.nextLabel,
          approaching: arrivingRef.current,
          hudAnchor: typeof trainControl?.getWindowHudAnchor === 'function' ? trainControl.getWindowHudAnchor() : null,
          hudControlHitAreas: typeof trainControl?.getWindowHudControlHitAreas === 'function'
            ? trainControl.getWindowHudControlHitAreas()
            : [],
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startJourney = useCallback(() => {
    departureSchedulerRef.current?.cancel();
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
    trainControlRef.current?.planStation(plan.segments[0].name, plan.segments[0].focusSec);
    departureSchedulerRef.current?.schedule(() => {
      if (phaseRef.current !== 'ride') return;
      trainControlRef.current?.departStation();
      // The station is hidden by StationManager only after it has left view.
    }, 2600);
    if (soundRef.current) {
      const au = new TrainAudio();
      audioRef.current = au;
      au.start();
    }
    phaseRef.current = 'ride';
    setHud((p) => ({ ...p, phase: 'ride', focusLeft: plan.totalFocusSec }));
  }, [mode, focusMin, stops, rounds]);

  const doAbort = useCallback(() => {
    departureSchedulerRef.current?.cancel();
    phaseRef.current = 'abort';
    setConfirmAbort(false);
    pausedRef.current = false;
    setIsPaused(false);
    trainControlRef.current?.setPaused(false);
    audioRef.current?.stop();
    // An early stop can occur between scheduled stations. Keep the visible
    // world continuous instead of spawning a fictional platform at the camera.
    trainControlRef.current?.setSpeed(0);
    setHud((p) => ({ ...p, phase: 'abort' }));
  }, []);

  const backToSetup = useCallback(() => {
    departureSchedulerRef.current?.cancel();
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
      audioRef.current?.setMotion({ speedRatio: 0, acceleration: 0 });
    } else {
      const motion = trainControlRef.current?.getMotion();
      audioRef.current?.setMotion({
        speedRatio: motion?.speedRatio ?? 0,
        acceleration: motion?.acceleration ?? 0,
      });
    }
    setIsPaused(nextPaused);
  }, []);

  const resetView = useCallback(() => {
    trainControlRef.current?.resetView();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      try {
        await wrapRef.current?.requestFullscreen?.();
      } catch {
        // iOS Safari and embedded browsers may reject this request. Keep the
        // icon truthful instead of pretending that the page entered fullscreen.
      }
    } else {
      try {
        await document.exitFullscreen?.();
      } catch {
        // The fullscreenchange listener still owns the confirmed UI state.
      }
    }
    setIsFullscreen(!!document.fullscreenElement);
  }, []);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  const riding = hud.phase === 'ride' || hud.phase === 'dwell';
  const focusDone = plan ? plan.totalFocusSec - hud.focusLeft : 0;
  const gradePercent = Math.abs(hud.grade * 100);
  const gradeLabel = gradePercent < 0.05 ? 'Level' : hud.grade > 0 ? 'Uphill' : 'Downhill';
  const journeyBanner = journeyBannerText({
    paused: isPaused,
    dwelling: hud.phase === 'dwell',
    approaching: hud.approaching,
    stationName: hud.nextStation,
  });

  useEffect(() => {
    trainControlRef.current?.setWindowHud({
      visible: riding,
      time: formatTime(hud.focusLeft),
      journey: journeyBanner,
      progress: plan ? focusDone / plan.totalFocusSec : 0,
      segmentLabel: `Segment ${Math.min(hud.segIdx + 1, hud.segCount)} of ${hud.segCount}`,
      routeLabel: `${hud.routeLabel} · ahead ${hud.nextRouteLabel}`,
      motionLabel: `${Math.round(hud.speedKmh)} km/h · ${gradeLabel} ${gradePercent.toFixed(1)}% · ${hud.distance.toFixed(1)} km travelled`,
      grade: hud.grade,
      stationNames: plan?.segments.map((segment) => segment.name) ?? [],
      currentSegment: hud.segIdx,
      paused: isPaused,
      soundEnabled: sound,
      fullscreen: isFullscreen,
    });
  }, [focusDone, gradeLabel, gradePercent, hud, isFullscreen, isPaused, journeyBanner, plan, riding, sound]);

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
        <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:items-center sm:p-4">
          <div className="max-h-[calc(100svh-1.5rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-white shadow-2xl backdrop-blur-xl sm:p-6">
            {/* 标题 */}
            <div className="mb-1 flex items-center gap-2 text-lg font-bold tracking-wide">
              <TrainFront className="h-5 w-5 text-amber-300" />
              Window Seat · Focus Train
            </div>
            <p className="mb-5 text-xs text-white/40">Board a train and let the view carry you to your destination.</p>

            {/* 模式 */}
            <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-lg bg-white/8 p-1">
              {([['free', 'Free ride'], ['pomodoro', 'Pomodoro']] as [Mode, string][]).map(([m, label]) => (
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
                  <span className="text-white/70">Focus duration</span>
                  <span className="tabular-nums text-amber-300">{focusMin} min</span>
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
                  <span className="text-white/70">Pomodoro rounds</span>
                  <span className="tabular-nums text-amber-300">{rounds} rounds</span>
                </div>
                <input type="range" min={1} max={8} value={rounds} onChange={(e) => setRounds(+e.target.value)}
                  className="w-full accent-amber-400" />
                <div className="mt-1 flex justify-between text-[10px] text-white/30">
                  <span>1</span><span>8</span>
                </div>
                <p className="mt-1 text-[11px] text-white/35">25 minutes focused / 5 minutes resting</p>
              </div>
            )}

            {/* 检票上车 */}
            <button onClick={startJourney}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-[0.98]">
              <Play className="h-4 w-4" /> Board train
            </button>

            {/* 高级设置（折叠） */}
            <details className="mt-4">
              <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-white/35 transition hover:text-white/55">
                <Settings2 className="h-3 w-3" /> Advanced settings
              </summary>
              <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
                {/* 经停站 */}
                {mode === 'free' && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-white/50">Stops en route</span>
                      <span className="tabular-nums text-amber-300/70">{stops} stop{stops === 1 ? '' : 's'}</span>
                    </div>
                    <input type="range" min={0} max={5} value={stops} onChange={(e) => setStops(+e.target.value)}
                      className="w-full accent-amber-400/60" />
                  </div>
                )}
                {/* 出发时段 */}
                <div>
                  <div className="mb-1 text-xs text-white/50">Departure time</div>
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
                  <div className="mb-1 text-xs text-white/50">Weather at departure</div>
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
          <div className="journey-controls pointer-events-none absolute inset-0 z-20">
            {hud.hudControlHitAreas[0] && <button onClick={togglePause} className="journey-control rounded-full" title={isPaused ? 'Resume journey' : 'Pause journey'} aria-label={isPaused ? 'Resume journey' : 'Pause journey'}
              style={{ left: `${hud.hudControlHitAreas[0].x * 100}%`, top: `${hud.hudControlHitAreas[0].y * 100}%`, width: `${hud.hudControlHitAreas[0].width * 100}%`, height: `${hud.hudControlHitAreas[0].height * 100}%` }}>{isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>}
            {hud.hudControlHitAreas[1] && <button onClick={resetView} className="journey-control rounded-full" title="Reset view" aria-label="Reset view"
              style={{ left: `${hud.hudControlHitAreas[1].x * 100}%`, top: `${hud.hudControlHitAreas[1].y * 100}%`, width: `${hud.hudControlHitAreas[1].width * 100}%`, height: `${hud.hudControlHitAreas[1].height * 100}%` }}><RotateCcw className="h-4 w-4" /></button>}
            {hud.hudControlHitAreas[2] && <button onClick={toggleSound} className="journey-control rounded-full" title={sound ? 'Mute sound' : 'Enable sound'} aria-label={sound ? 'Mute sound' : 'Enable sound'}
              style={{ left: `${hud.hudControlHitAreas[2].x * 100}%`, top: `${hud.hudControlHitAreas[2].y * 100}%`, width: `${hud.hudControlHitAreas[2].width * 100}%`, height: `${hud.hudControlHitAreas[2].height * 100}%` }}>{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>}
            {hud.hudControlHitAreas[3] && <button onClick={toggleFullscreen} className="journey-control rounded-full" title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              style={{ left: `${hud.hudControlHitAreas[3].x * 100}%`, top: `${hud.hudControlHitAreas[3].y * 100}%`, width: `${hud.hudControlHitAreas[3].width * 100}%`, height: `${hud.hudControlHitAreas[3].height * 100}%` }}>{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>}
            {hud.hudControlHitAreas[4] && <button onClick={() => setConfirmAbort(true)} className="journey-control rounded-full" title="End journey" aria-label="End journey"
              style={{ left: `${hud.hudControlHitAreas[4].x * 100}%`, top: `${hud.hudControlHitAreas[4].y * 100}%`, width: `${hud.hudControlHitAreas[4].width * 100}%`, height: `${hud.hudControlHitAreas[4].height * 100}%` }}><Flag className="h-4 w-4" /></button>}
          </div>

          {/* 经停休息卡片 */}
          {hud.phase === 'dwell' && (
            <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-black/55 px-8 py-6 text-center text-white backdrop-blur-md">
              <Coffee className="mx-auto mb-2 h-6 w-6 text-amber-300" />
              <div className="text-lg font-semibold">Now calling at {hud.nextStation}</div>
              <div className="mt-1 text-sm text-white/60">Stretch your legs. Departing in {formatTime(hud.dwellLeft)}</div>
            </div>
          )}

        </>
      )}

      {/* ================= 到达终点 ================= */}
      {hud.phase === 'done' && (
        <EndCard
          title={`Arrived at ${plan?.terminal ?? ''}`}
          lines={[
            `${Math.round((plan?.totalFocusSec ?? 0) / 60)} minutes focused`,
            `${hud.segCount} segments · ${hud.distance.toFixed(1)} km travelled`,
            'Thank you for travelling. May every focused stretch have a view.',
          ]}
          onAgain={backToSetup}
        />
      )}

      {/* ================= 中途下车 ================= */}
      {hud.phase === 'abort' && (
        <EndCard
          title="Journey ended early"
          lines={[
            `${Math.floor(focusDone / 60)} min ${Math.round(focusDone % 60)} sec focused`,
            'The train is stopped safely. Ready for your next journey.',
          ]}
          onAgain={backToSetup}
        />
      )}

      {/* 下车确认 */}
      {confirmAbort && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[calc(100svh-2rem)] w-full max-w-xs overflow-y-auto rounded-2xl bg-neutral-900 p-6 text-white shadow-xl">
            <div className="mb-2 text-lg font-semibold">End this journey?</div>
            <p className="mb-5 text-sm text-white/60">You have not reached the terminal. Ending now stops this journey.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAbort(false)} className="flex-1 rounded-lg border border-white/20 py-2 text-sm hover:bg-white/10">Keep riding</button>
              <button onClick={doAbort} className="flex-1 rounded-lg bg-red-500/90 py-2 text-sm font-medium hover:bg-red-500">End journey</button>
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
      <div className="max-h-[calc(100svh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-black/60 p-6 text-center text-white shadow-2xl backdrop-blur-md sm:p-8">
        <TrainFront className="mx-auto mb-3 h-8 w-8 text-amber-300" />
        <div className="mb-3 text-xl font-bold">{title}</div>
        {lines.map((l, i) => (
          <p key={i} className={i === lines.length - 1 ? 'mt-3 text-sm text-white/50' : 'text-sm text-white/80'}>{l}</p>
        ))}
        <button onClick={onAgain}
          className="mt-6 w-full rounded-xl bg-amber-400 py-3 font-bold text-black transition hover:bg-amber-300 active:scale-[0.98]">
          Take another train
        </button>
      </div>
    </div>
  );
}
