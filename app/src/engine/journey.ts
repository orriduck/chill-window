// 旅程规划：站点、区间、停靠
import type { TimeOfDay } from './time';

export type Mode = 'free' | 'pomodoro';

export interface JourneyPlan {
  segments: { name: string; focusSec: number }[]; // 每段骑行（专注时间）
  dwellSec: number; // 每次经停休息时长
  terminal: string;
  totalFocusSec: number;
}

export interface JourneyBannerState {
  paused: boolean;
  dwelling: boolean;
  approaching: boolean;
  stationName: string;
}

/**
 * Keeps the short departure beat at the origin station owned by the active
 * journey. Cancelling also invalidates an already-queued callback, so ending
 * a journey cannot later restart the train from stale UI state.
 */
export class DepartureScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  schedule(onDeparture: () => void, delayMs: number) {
    this.cancel();
    const version = ++this.version;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (version === this.version) onDeparture();
    }, delayMs);
  }

  cancel() {
    this.version += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

const STATION_NAMES = [
  'Cedar Bay', 'Misty Ridge', 'Fernwood', 'Heron Point', 'Pine Creek', 'Moonvale',
  'Cloud Rest', 'Southport', 'Willow Bend', 'Lakeview', 'Deerfield', 'Starfield',
  'Frost Hill', 'Hillside', 'Birch Run', 'Highgate', 'Stonebridge', 'Orchard',
  'Meadowbrook', 'Maplewood', 'Rivergate', 'Linden', 'Fairhaven', 'Sunset Ridge',
  'Clearwater', 'Wildflower', 'Northpeak', 'Snowfield', 'Rainford', 'Far Harbor',
  'Sandmere',
];

export function pickStations(n: number, rng: () => number = Math.random): string[] {
  const pool = [...STATION_NAMES];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function buildFreeJourney(focusMin: number, stops: number): JourneyPlan {
  const totalFocusSec = focusMin * 60;
  const nSeg = stops + 1;
  const names = pickStations(nSeg);
  // 区间时长随机切分（不完全均等，更像真实线路）
  const weights = Array.from({ length: nSeg }, () => 0.7 + Math.random() * 0.6);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const segments = weights.map((w, i) => ({
    name: names[i],
    focusSec: Math.round((w / wSum) * totalFocusSec),
  }));
  // 修正取整误差
  const diff = totalFocusSec - segments.reduce((a, s) => a + s.focusSec, 0);
  segments[segments.length - 1].focusSec += diff;
  return { segments, dwellSec: 40, terminal: names[nSeg - 1], totalFocusSec };
}

export function buildPomodoroJourney(rounds: number): JourneyPlan {
  const names = pickStations(rounds);
  const segments = names.map((name) => ({ name, focusSec: 25 * 60 }));
  return { segments, dwellSec: 5 * 60, terminal: names[rounds - 1], totalFocusSec: rounds * 25 * 60 };
}

export function suggestStops(focusMin: number): number {
  if (focusMin <= 30) return 0;
  if (focusMin <= 60) return 1;
  if (focusMin <= 90) return 2;
  return 3;
}

/** Passenger copy mirrors the actual motion lifecycle, rather than predicting
 * a timetable that this focused journey does not simulate. */
export function journeyBannerText({
  paused,
  dwelling,
  approaching,
  stationName,
}: JourneyBannerState): string {
  if (paused) return 'Journey paused';
  if (dwelling) return 'At station';
  if (approaching) return `Approaching ${stationName}`;
  return `Towards ${stationName}`;
}

export const TIME_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: 'morning', label: 'Dawn' },
  { value: 'day', label: 'Daylight' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
];

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
