// 旅程规划：站点、区间、停靠
import type { TimeOfDay } from './scenery';

export type Mode = 'free' | 'pomodoro';

export interface JourneyPlan {
  segments: { name: string; focusSec: number }[]; // 每段骑行（专注时间）
  dwellSec: number; // 每次经停休息时长
  terminal: string;
  totalFocusSec: number;
}

const STATION_NAMES = [
  '青川', '雾岭', '禾木', '白鹭洲', '松溪', '望舒', '栖云', '南浦', '折柳',
  '听澜', '鹿鸣', '星野', '霜降', '半山', '竹里', '临皋', '石桥', '杏坛',
  '梅坞', '桑梓', '渭城', '兰陵', '未央', '长乐', '栖霞', '漱玉', '枕流',
  '晴川', '芳草', '连山', '归雁', '晓风', '残雪', '疏雨', '远浦', '平沙',
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

export const TIME_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: 'morning', label: '清晨' },
  { value: 'day', label: '白天' },
  { value: 'dusk', label: '黄昏' },
  { value: 'night', label: '夜晚' },
];

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
