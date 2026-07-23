// 程序化火车侧窗风景引擎
// 分层视差：天空 / 远山 / 中景 / 近景地面 / 前景（电线杆、草叶残影）
// 场景：田野、森林、山地、河流、小镇，随机过渡衔接 + 随机装饰物 + 随机隧道

export type TimeOfDay = 'morning' | 'day' | 'dusk' | 'night';
export type SceneKind = 'field' | 'forest' | 'mountain' | 'river' | 'town';

const SCENE_KINDS: SceneKind[] = ['field', 'forest', 'mountain', 'river', 'town'];

// ---------- 工具 ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// 整数倍谐波叠加 → 完美循环的起伏曲线
function harmonicHeights(rng: () => number, n: number, base: number, amp: number, harmonics = 3): number[] {
  const comps: { k: number; a: number; p: number }[] = [];
  for (let i = 0; i < harmonics; i++) {
    comps.push({ k: i + 1, a: amp / (i + 1), p: rng() * Math.PI * 2 });
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let y = base;
    for (const c of comps) y += c.a * Math.sin((i / n) * Math.PI * 2 * c.k + c.p);
    out[i] = y;
  }
  return out;
}

// ---------- 调色板 ----------
export interface Palette {
  skyTop: string; skyBot: string;
  sun: string; sunGlow: string;
  cloud: string; cloudShadow: string;
  stars: number; // 星星透明度 0-1
  far: string; farBack: string; snow: string;
  midBase: string; ground: string; groundDark: string;
  water: string; waterLight: string;
  building: string; buildingDark: string; winLit: string;
  fg: string; tint: string; tintA: number; night: boolean;
}

export function paletteFor(time: TimeOfDay): Palette {
  switch (time) {
    case 'morning':
      return {
        skyTop: '#a8cbe8', skyBot: '#f8ecd2', sun: '#fff3d6', sunGlow: 'rgba(255,236,190,0.55)',
        cloud: '#fdf6ea', cloudShadow: '#e3d4c2', stars: 0,
        far: '#a99cb8', farBack: '#c2b6cc', snow: '#f2eef4',
        midBase: '#7fae6a', ground: '#5d9250', groundDark: '#4c7a42',
        water: '#8fb6c9', waterLight: '#cfe4ec',
        building: '#9a8fa0', buildingDark: '#7d7386', winLit: '#ffd98a',
        fg: '#33502e', tint: 'rgba(255,205,130,1)', tintA: 0.07, night: false,
      };
    case 'day':
      return {
        skyTop: '#7ec3ee', skyBot: '#e2f3fb', sun: '#fffbe8', sunGlow: 'rgba(255,250,220,0.5)',
        cloud: '#ffffff', cloudShadow: '#d9e6ee', stars: 0,
        far: '#8ba6bd', farBack: '#aac0d2', snow: '#ffffff',
        midBase: '#6fb45c', ground: '#579a4b', groundDark: '#46803d',
        water: '#5fa8d3', waterLight: '#bfe0f2',
        building: '#8e9aa8', buildingDark: '#6f7c8c', winLit: '#ffe9a8',
        fg: '#2e5230', tint: 'rgba(255,255,255,1)', tintA: 0, night: false,
      };
    case 'dusk':
      return {
        skyTop: '#40477e', skyBot: '#f0955c', sun: '#ffca7a', sunGlow: 'rgba(255,150,80,0.6)',
        cloud: '#e8a078', cloudShadow: '#b06a58', stars: 0.25,
        far: '#6c5a80', farBack: '#86719a', snow: '#d9c8d8',
        midBase: '#4f7a48', ground: '#3f6539', groundDark: '#33512f',
        water: '#7a6a94', waterLight: '#e8a878',
        building: '#5c5468', buildingDark: '#463f52', winLit: '#ffbf6a',
        fg: '#22331f', tint: 'rgba(255,110,50,1)', tintA: 0.1, night: false,
      };
    case 'night':
      return {
        skyTop: '#070c20', skyBot: '#1c2a4a', sun: '#f2f0e2', sunGlow: 'rgba(230,230,255,0.25)',
        cloud: '#2a3a5c', cloudShadow: '#1a2540', stars: 1,
        far: '#232c48', farBack: '#2e3a5c', snow: '#8a94b8',
        midBase: '#1d3323', ground: '#16281b', groundDark: '#101f13',
        water: '#14203c', waterLight: '#5a76a8',
        building: '#1a2033', buildingDark: '#121828', winLit: '#ffc46a',
        fg: '#0a1409', tint: 'rgba(8,10,40,1)', tintA: 0.18, night: true,
      };
  }
}

// ---------- 静态条带（远山 / 中景），按场景类型离线渲染并缓存 ----------
const BAND_W = 2048;

function fillHeights(ctx: CanvasRenderingContext2D, hs: number[], w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const step = w / (hs.length - 1);
  for (let i = 0; i < hs.length; i++) ctx.lineTo(i * step, hs[i]);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function buildFarBand(kind: SceneKind, pal: Palette, seed: number): HTMLCanvasElement {
  const H = 340;
  const c = makeCanvas(BAND_W, H);
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(seed);
  if (kind === 'mountain') {
    const back = harmonicHeights(rng, 256, H * 0.5, H * 0.12, 3);
    fillHeights(ctx, back, BAND_W, H, pal.farBack);
    const front = harmonicHeights(rng, 256, H * 0.62, H * 0.15, 3);
    fillHeights(ctx, front, BAND_W, H, pal.far);
    // 雪顶：沿山脊线给高处覆雪（贴合山形）
    const step = BAND_W / 255;
    ctx.fillStyle = pal.snow;
    for (let i = 0; i < 256; i++) {
      if (front[i] < H * 0.56) {
        const x = i * step, y = front[i];
        const depth = (H * 0.56 - y) * 0.55 + 6;
        ctx.fillRect(x - step, y - 1, step * 2, depth);
      }
    }
  } else if (kind === 'town') {
    // 远处朦胧的城市天际线
    const hs = harmonicHeights(rng, 256, H * 0.7, H * 0.06, 2);
    fillHeights(ctx, hs, BAND_W, H, pal.farBack);
    ctx.fillStyle = pal.far;
    let x = 0;
    while (x < BAND_W) {
      const bw = 30 + rng() * 70;
      const bh = 30 + rng() * 90;
      ctx.fillRect(x, H * 0.72 - bh, bw, bh + H * 0.3);
      x += bw + 4 + rng() * 20;
    }
  } else {
    const amp = kind === 'field' ? H * 0.08 : H * 0.14;
    const back = harmonicHeights(rng, 256, H * 0.62, amp, 3);
    fillHeights(ctx, back, BAND_W, H, pal.farBack);
    const front = harmonicHeights(rng, 256, H * 0.72, amp * 0.9, 3);
    fillHeights(ctx, front, BAND_W, H, pal.far);
    if (kind === 'forest') {
      // 山上树线
      ctx.fillStyle = shade(pal.far, 0.85);
      const step = BAND_W / 255;
      for (let i = 0; i < 256; i += 2) {
        const x = i * step;
        const th = 8 + rng() * 14;
        ctx.beginPath();
        ctx.moveTo(x, front[i] - th);
        ctx.lineTo(x - 6, front[i] + 4);
        ctx.lineTo(x + 6, front[i] + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  return c;
}

function buildMidBand(kind: SceneKind, pal: Palette, seed: number): HTMLCanvasElement {
  const H = 300;
  const c = makeCanvas(BAND_W, H);
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(seed + 999);

  if (kind === 'river') {
    // 河岸 + 水面
    const bank = harmonicHeights(rng, 256, H * 0.3, H * 0.1, 3);
    fillHeights(ctx, bank, BAND_W, H, shade(pal.midBase, 0.9));
    const step = BAND_W / 255;
    ctx.fillStyle = pal.water;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) ctx.lineTo(i * step, bank[i] + 26);
    ctx.lineTo(BAND_W, H);
    ctx.closePath();
    ctx.fill();
    // 波光
    ctx.strokeStyle = pal.waterLight;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 90; i++) {
      const x = rng() * BAND_W;
      const bi = Math.min(255, Math.floor((x / BAND_W) * 255));
      const y = bank[bi] + 34 + rng() * (H - bank[bi] - 50);
      const len = 12 + rng() * 46;
      ctx.lineWidth = 1.5 + rng() * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return c;
  }

  if (kind === 'town') {
    const hs = harmonicHeights(rng, 256, H * 0.35, H * 0.06, 2);
    fillHeights(ctx, hs, BAND_W, H, shade(pal.midBase, 0.85));
    let x = 0;
    while (x < BAND_W) {
      const bw = 44 + rng() * 90;
      const bh = 50 + rng() * 150;
      const col = rng() > 0.5 ? pal.building : pal.buildingDark;
      ctx.fillStyle = col;
      ctx.fillRect(x, H * 0.55 - bh, bw, bh + H * 0.5);
      // 窗户
      const cols = Math.floor(bw / 16);
      const rows = Math.floor(bh / 20);
      for (let r = 0; r < rows; r++) {
        for (let cc = 0; cc < cols; cc++) {
          const lit = rng() > (pal.night ? 0.45 : 0.85);
          ctx.fillStyle = lit ? pal.winLit : shade(col, 0.7);
          ctx.fillRect(x + 6 + cc * 16, H * 0.55 - bh + 8 + r * 20, 8, 11);
        }
      }
      x += bw + 6 + rng() * 26;
    }
    return c;
  }

  if (kind === 'forest') {
    const back = harmonicHeights(rng, 256, H * 0.4, H * 0.1, 3);
    fillHeights(ctx, back, BAND_W, H, shade(pal.midBase, 0.75));
    // 大片树木
    for (let i = 0; i < 240; i++) {
      const x = rng() * BAND_W;
      const y = H * 0.35 + rng() * H * 0.5;
      const s = 14 + rng() * 30;
      ctx.fillStyle = shade(pal.midBase, 0.55 + rng() * 0.4);
      if (rng() > 0.4) {
        ctx.beginPath();
        ctx.moveTo(x, y - s * 1.6);
        ctx.lineTo(x - s * 0.6, y);
        ctx.lineTo(x + s * 0.6, y);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, y - s * 0.5, s * 0.55, 0, Math.PI * 2); ctx.fill();
      }
    }
    return c;
  }

  if (kind === 'mountain') {
    const hs = harmonicHeights(rng, 256, H * 0.4, H * 0.12, 3);
    fillHeights(ctx, hs, BAND_W, H, shade(pal.far, 0.9));
    // 山脚松林
    for (let i = 0; i < 180; i++) {
      const x = rng() * BAND_W;
      const y = H * 0.45 + rng() * H * 0.45;
      const s = 12 + rng() * 24;
      ctx.fillStyle = shade(pal.midBase, 0.5 + rng() * 0.35);
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.7);
      ctx.lineTo(x - s * 0.55, y);
      ctx.lineTo(x + s * 0.55, y);
      ctx.closePath(); ctx.fill();
    }
    return c;
  }

  // field：拼块农田
  const base = harmonicHeights(rng, 256, H * 0.4, H * 0.1, 3);
  fillHeights(ctx, base, BAND_W, H, pal.midBase);
  const fieldCols = ['#8fc16a', '#a8c96e', '#d9c76a', '#6fae5a', '#c2b45f', '#98bf62']
    .map((col) => mix(col, pal.midBase, pal.night ? 0.55 : 0.12));
  const step = BAND_W / 255;
  for (let i = 0; i < 14; i++) {
    const x0 = rng() * BAND_W;
    const w = 120 + rng() * 320;
    ctx.fillStyle = fieldCols[Math.floor(rng() * fieldCols.length)];
    ctx.beginPath();
    const i0 = Math.floor((x0 / BAND_W) * 255);
    ctx.moveTo(x0, H);
    for (let k = 0; k <= 24; k++) {
      const ii = (i0 + Math.floor((k / 24) * (w / step))) % 256;
      ctx.lineTo(x0 + (k / 24) * w, base[ii] + 6 + rng() * 4);
    }
    ctx.lineTo(x0 + w, H);
    ctx.closePath(); ctx.fill();
  }
  // 田埂树线
  ctx.fillStyle = shade(pal.midBase, 0.7);
  for (let i = 0; i < 60; i++) {
    const x = rng() * BAND_W;
    const ii = Math.floor((x / BAND_W) * 255);
    const y = base[ii] + 8 + rng() * H * 0.35;
    ctx.beginPath(); ctx.arc(x, y, 4 + rng() * 8, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

// ---------- 随机装饰物（中景 / 近景层的世界锚定对象） ----------
export interface Decor {
  x: number; // 世界坐标
  layer: 'mid' | 'near';
  kind: SceneKind; // 属于哪个场景（过渡替换用）
  draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, pal: Palette) => void;
}

type DecorMaker = (rng: () => number, pal: Palette) => Decor['draw'];

// ===== 树木：4 种形态（阔叶分层 / 针叶塔形 / 垂枝 / 枯枝） =====
const dTreeRound: DecorMaker = (rng, pal) => {
  const s = 26 + rng() * 34;
  const f = 0.7 + rng() * 0.5;
  const leaf = shade(pal.midBase, f);
  const leaf2 = shade(pal.midBase, f * 1.18);
  const leafDark = shade(pal.midBase, f * 0.72);
  const trunk = pal.night ? '#0d0a08' : '#5b4232';
  // 随机树冠团（5-9 个，大小错落，更自然）
  const puffs: { dx: number; dy: number; r: number }[] = [];
  const n = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    puffs.push({
      dx: (rng() - 0.5) * s * 0.9,
      dy: -s * 0.5 - rng() * s * 0.75,
      r: s * (0.22 + rng() * 0.24),
    });
  }
  return (ctx, x, y) => {
    // 树干带分叉
    ctx.strokeStyle = trunk;
    ctx.lineWidth = s * 0.09;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s * 0.03, y - s * 0.55); ctx.stroke();
    ctx.lineWidth = s * 0.045;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.02, y - s * 0.4); ctx.lineTo(x - s * 0.22, y - s * 0.62);
    ctx.moveTo(x - s * 0.02, y - s * 0.45); ctx.lineTo(x + s * 0.18, y - s * 0.68);
    ctx.stroke();
    // 底层暗色叶团
    ctx.fillStyle = leafDark;
    for (const p of puffs) {
      ctx.beginPath(); ctx.arc(x + p.dx * 0.85, y + p.dy * 0.92 + s * 0.08, p.r * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // 主叶团
    ctx.fillStyle = leaf;
    for (const p of puffs) {
      ctx.beginPath(); ctx.arc(x + p.dx, y + p.dy, p.r, 0, Math.PI * 2); ctx.fill();
    }
    // 顶部高光叶团
    ctx.fillStyle = leaf2;
    for (const p of puffs) {
      if (p.dy < -s * 0.85) {
        ctx.beginPath(); ctx.arc(x + p.dx - p.r * 0.15, y + p.dy - p.r * 0.2, p.r * 0.55, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
};

const dTreePine: DecorMaker = (rng, pal) => {
  const s = 30 + rng() * 40;
  const col = shade(pal.midBase, 0.5 + rng() * 0.3);
  const colDark = shade(pal.midBase, 0.38);
  const trunk = pal.night ? '#0d0a08' : '#4a3527';
  const layers = 4 + Math.floor(rng() * 3); // 4-6 层
  return (ctx, x, y) => {
    ctx.fillStyle = trunk;
    ctx.fillRect(x - s * 0.05, y - s * 0.3, s * 0.1, s * 0.3);
    // 针叶层：底层暗、顶层窄，每层带裙边锯齿
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const yy = y - s * 0.22 - i * (s * 0.34);
      const w = s * (0.62 - t * 0.5);
      const hh = s * (0.5 - t * 0.12);
      ctx.fillStyle = i % 2 === 0 ? col : colDark;
      ctx.beginPath();
      ctx.moveTo(x, yy - hh);
      // 裙边：左右各 3 段折线，更自然
      for (let k = 0; k <= 3; k++) {
        ctx.lineTo(x - (w * k) / 3 - (k === 3 ? 0 : w * 0.1), yy - hh + (hh * (k + 0.4)) / 3);
      }
      ctx.lineTo(x - w, yy + s * 0.14);
      ctx.lineTo(x + w, yy + s * 0.14);
      for (let k = 3; k >= 0; k--) {
        ctx.lineTo(x + (w * k) / 3 + (k === 3 ? 0 : w * 0.1), yy - hh + (hh * (k + 0.4)) / 3);
      }
      ctx.closePath(); ctx.fill();
    }
  };
};

// 垂枝树（柳树感）
const dTreeWillow: DecorMaker = (rng, pal) => {
  const s = 30 + rng() * 26;
  const leaf = shade(pal.midBase, 0.75 + rng() * 0.35);
  const trunk = pal.night ? '#0d0a08' : '#4a3a2c';
  const strands = 7 + Math.floor(rng() * 5);
  return (ctx, x, y) => {
    ctx.strokeStyle = trunk;
    ctx.lineWidth = s * 0.08;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * 0.04, y - s * 0.8); ctx.stroke();
    // 垂下的枝条弧线
    ctx.strokeStyle = leaf;
    for (let i = 0; i < strands; i++) {
      const t = (i / (strands - 1)) * 2 - 1; // -1..1
      ctx.lineWidth = 2 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.04, y - s * 0.85);
      ctx.quadraticCurveTo(
        x + t * s * 0.7, y - s * 0.55,
        x + t * s * 0.85, y - s * (0.12 + rng() * 0.2),
      );
      ctx.stroke();
    }
    // 顶部叶冠
    ctx.fillStyle = leaf;
    ctx.beginPath(); ctx.ellipse(x + s * 0.04, y - s * 0.85, s * 0.4, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  };
};

// 枯枝树
const dTreeBare: DecorMaker = (rng, pal) => {
  const s = 28 + rng() * 22;
  const col = pal.night ? '#0d0a08' : '#4a3c30';
  const branches: { a1: number; len: number; w: number }[] = [];
  const n = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    branches.push({ a1: -Math.PI / 2 + (rng() - 0.5) * 1.8, len: s * (0.3 + rng() * 0.5), w: 2.5 + rng() * 2 });
  }
  return (ctx, x, y) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = s * 0.09;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.55); ctx.stroke();
    for (const b of branches) {
      const sx = x, sy = y - s * (0.35 + rng() * 0.25);
      const ex = sx + Math.cos(b.a1) * b.len;
      const ey = sy + Math.sin(b.a1) * b.len;
      ctx.lineWidth = b.w;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      // 小分叉
      ctx.lineWidth = b.w * 0.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(b.a1 - 0.5) * b.len * 0.45, ey + Math.sin(b.a1 - 0.5) * b.len * 0.45);
      ctx.stroke();
    }
  };
};

// 树丛（密集排布，可遮挡后方景物）
const dTreeCluster: DecorMaker = (rng, _pal) => {
  const trees: { dx: number; s: number; kind: number; f: number }[] = [];
  const n = 4 + Math.floor(rng() * 4);
  const span = 60 + n * 34;
  for (let i = 0; i < n; i++) {
    trees.push({
      dx: (i / (n - 1) - 0.5) * span + (rng() - 0.5) * 20,
      s: 30 + rng() * 34,
      kind: Math.floor(rng() * 2), // 0 阔叶 1 针叶
      f: 0.55 + rng() * 0.5,
    });
  }
  // 按尺寸排序，大的画后面（远的），小的画前面（近的）——形成遮挡层次
  trees.sort((a, b) => a.s - b.s);
  return (ctx, x, y, p) => {
    for (const t of trees) {
      const tx = x + t.dx;
      const s = t.s;
      const col = shade(p.midBase, t.f);
      const colDark = shade(p.midBase, t.f * 0.7);
      const trunk = p.night ? '#0d0a08' : '#4a3527';
      if (t.kind === 1) {
        ctx.fillStyle = trunk;
        ctx.fillRect(tx - s * 0.05, y - s * 0.28, s * 0.1, s * 0.28);
        for (let i = 0; i < 4; i++) {
          const tt = i / 4;
          ctx.fillStyle = i % 2 ? col : colDark;
          const w = s * (0.6 - tt * 0.46);
          ctx.beginPath();
          ctx.moveTo(tx, y - s * 0.28 - i * s * 0.33 - s * 0.5);
          ctx.lineTo(tx - w, y - s * 0.28 - i * s * 0.33 + s * 0.12);
          ctx.lineTo(tx + w, y - s * 0.28 - i * s * 0.33 + s * 0.12);
          ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = trunk;
        ctx.fillRect(tx - s * 0.06, y - s * 0.5, s * 0.12, s * 0.5);
        ctx.fillStyle = colDark;
        ctx.beginPath(); ctx.arc(tx + s * 0.1, y - s * 0.68, s * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(tx - s * 0.16, y - s * 0.78, s * 0.34, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(tx + s * 0.05, y - s * 0.95, s * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
};

const dHouse: DecorMaker = (rng, pal) => {
  const w = 46 + rng() * 30;
  const h = 30 + rng() * 16;
  const wall = pal.night ? '#241d18' : ['#e8dcc8', '#dcc9b0', '#d8e0e0'][Math.floor(rng() * 3)];
  const roof = pal.night ? '#14100d' : ['#a8503c', '#7a5a48', '#50607a'][Math.floor(rng() * 3)];
  const lit = rng() > 0.3;
  const chimney = rng() > 0.4;
  return (ctx, x, y) => {
    ctx.fillStyle = wall;
    ctx.fillRect(x - w / 2, y - h, w, h);
    // 屋顶：带屋檐和屋脊厚度
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 8, y - h);
    ctx.lineTo(x, y - h - w * 0.38);
    ctx.lineTo(x + w / 2 + 8, y - h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(roof, 0.75);
    ctx.fillRect(x - w / 2 - 8, y - h, w + 16, 4);
    // 烟囱
    if (chimney) {
      ctx.fillStyle = shade(wall, 0.8);
      ctx.fillRect(x + w * 0.22, y - h - w * 0.32, 8, w * 0.26);
    }
    // 门
    ctx.fillStyle = pal.night ? '#12100c' : '#6a4a34';
    ctx.fillRect(x - 6, y - h * 0.55, 12, h * 0.55);
    // 窗户带窗框
    for (const wx of [-w * 0.32, w * 0.16]) {
      ctx.fillStyle = lit && pal.night ? pal.winLit : shade(wall, 0.55);
      ctx.fillRect(x + wx, y - h * 0.75, 11, 12);
      ctx.strokeStyle = shade(wall, 0.75);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + wx, y - h * 0.75, 11, 12);
      ctx.beginPath(); ctx.moveTo(x + wx + 5.5, y - h * 0.75); ctx.lineTo(x + wx + 5.5, y - h * 0.75 + 12); ctx.stroke();
    }
  };
};

const dWindmill: DecorMaker = (rng, pal) => {
  const s = 60 + rng() * 20;
  const body = pal.night ? '#1c1814' : '#e2d8c4';
  const blade = pal.night ? '#100d0a' : '#8a7a64';
  return (ctx, x, y, _p) => {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.18, y);
    ctx.lineTo(x - s * 0.1, y - s);
    ctx.lineTo(x + s * 0.1, y - s);
    ctx.lineTo(x + s * 0.18, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = blade;
    ctx.lineWidth = 3;
    const ang = (x * 0.002) % (Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const a = ang + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + Math.cos(a) * s * 0.55, y - s + Math.sin(a) * s * 0.55);
      ctx.stroke();
    }
  };
};

const dHay: DecorMaker = (rng, pal) => {
  const s = 12 + rng() * 10;
  const col = pal.night ? '#3a3018' : '#d9b85c';
  return (ctx, x, y) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - s * 0.6, s * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade(col, 0.75);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - s * 0.6, s * 0.4, 0, Math.PI * 2); ctx.stroke();
  };
};

const dCow: DecorMaker = (rng, pal) => {
  const s = 20 + rng() * 8;
  const body = pal.night ? '#2a2622' : rng() > 0.5 ? '#8a6a4c' : '#e8e2d4';
  const spot = pal.night ? '#141210' : '#4a3a2c';
  const spots = 2 + Math.floor(rng() * 3);
  return (ctx, x, y) => {
    ctx.fillStyle = body;
    ctx.fillRect(x - s * 0.55, y - s * 0.42, s * 0.13, s * 0.42);
    ctx.fillRect(x + s * 0.38, y - s * 0.42, s * 0.13, s * 0.42);
    ctx.beginPath(); ctx.ellipse(x, y - s * 0.72, s * 0.78, s * 0.44, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = spot;
    for (let i = 0; i < spots; i++) {
      ctx.beginPath();
      ctx.ellipse(x - s * 0.4 + rng() * s * 0.8, y - s * 0.85 + rng() * s * 0.25, s * 0.18, s * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x + s * 0.8, y - s * 0.92, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = spot;
    ctx.beginPath(); ctx.arc(x + s * 0.95, y - s * 0.85, s * 0.12, 0, Math.PI * 2); ctx.fill();
  };
};

const dBoat: DecorMaker = (rng, pal) => {
  const s = 22 + rng() * 14;
  const hull = pal.night ? '#1a1410' : '#8a4a34';
  const sail = pal.night ? '#3a3630' : '#f0e8d8';
  return (ctx, x, y) => {
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.8, y - s * 0.3);
    ctx.lineTo(x + s * 0.8, y - s * 0.3);
    ctx.lineTo(x + s * 0.5, y);
    ctx.lineTo(x - s * 0.5, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = sail;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.4);
    ctx.lineTo(x, y - s * 1.5);
    ctx.lineTo(x + s * 0.7, y - s * 0.4);
    ctx.closePath(); ctx.fill();
  };
};

const dBush: DecorMaker = (rng, pal) => {
  const s = 10 + rng() * 16;
  const col = shade(pal.ground, 0.7 + rng() * 0.5);
  return (ctx, x, y) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y - s * 0.4, s * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s * 0.5, y - s * 0.25, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - s * 0.5, y - s * 0.22, s * 0.38, 0, Math.PI * 2); ctx.fill();
  };
};

const dFlowers: DecorMaker = (rng, pal) => {
  const cols = pal.night ? ['#3a3040'] : ['#e86a8a', '#f2d24a', '#ffffff', '#c97ae8'];
  const n = 5 + Math.floor(rng() * 6);
  const pts: { dx: number; c: string }[] = [];
  for (let i = 0; i < n; i++) pts.push({ dx: (rng() - 0.5) * 50, c: cols[Math.floor(rng() * cols.length)] });
  return (ctx, x, y) => {
    for (const p of pts) {
      ctx.fillStyle = shade(pal.ground, 0.75);
      ctx.fillRect(x + p.dx, y - 8, 2, 8);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(x + p.dx + 1, y - 10, 3, 0, Math.PI * 2); ctx.fill();
    }
  };
};

const dLamp: DecorMaker = (_rng, pal) => {
  return (ctx, x, y) => {
    ctx.fillStyle = pal.night ? '#0a0a0a' : '#3a3f46';
    ctx.fillRect(x - 1.5, y - 46, 3, 46);
    ctx.beginPath(); ctx.arc(x, y - 48, 4, 0, Math.PI * 2); ctx.fill();
    if (pal.night) {
      ctx.fillStyle = pal.winLit;
      ctx.beginPath(); ctx.arc(x, y - 48, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  };
};

// ===== 精细化素材：农舍、教堂、水塔、信号机、高压电塔、畜群、向日葵、葡萄架、道班房、桥 =====

const dFarmhouse: DecorMaker = (rng, pal) => {
  const w = 60 + rng() * 26;
  const hh = 38 + rng() * 14;
  const wall = pal.night ? '#262019' : ['#e5d8c2', '#d9cdb6', '#e8ddc8'][Math.floor(rng() * 3)];
  const roof = pal.night ? '#171310' : ['#9c4636', '#7a5240', '#8a3f30'][Math.floor(rng() * 3)];
  const barn = rng() > 0.5;
  return (ctx, x, y) => {
    // 主屋
    ctx.fillStyle = wall;
    ctx.fillRect(x - w / 2, y - hh, w, hh);
    // 人字形屋顶带屋脊和烟囱
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 7, y - hh);
    ctx.lineTo(x, y - hh - w * 0.34);
    ctx.lineTo(x + w / 2 + 7, y - hh);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x + w * 0.18, y - hh - w * 0.3, 8, w * 0.22);
    if (pal.night && rng() > 0.5) { // 烟囱炊烟
      ctx.strokeStyle = 'rgba(160,160,170,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.22, y - hh - w * 0.32);
      ctx.quadraticCurveTo(x + w * 0.3, y - hh - w * 0.55, x + w * 0.22, y - hh - w * 0.75);
      ctx.stroke();
    }
    // 门
    ctx.fillStyle = pal.night ? '#12100c' : '#6a4a34';
    ctx.fillRect(x - 7, y - hh * 0.62, 14, hh * 0.62);
    // 窗户（带窗框）
    for (const wx of [-w * 0.32, w * 0.18]) {
      ctx.fillStyle = pal.night && rng() > 0.35 ? pal.winLit : shade(wall, 0.55);
      ctx.fillRect(x + wx, y - hh * 0.78, 12, 13);
      ctx.strokeStyle = shade(wall, 0.75);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + wx, y - hh * 0.78, 12, 13);
      ctx.beginPath(); ctx.moveTo(x + wx + 6, y - hh * 0.78); ctx.lineTo(x + wx + 6, y - hh * 0.78 + 13); ctx.stroke();
    }
    // 谷仓
    if (barn) {
      ctx.fillStyle = pal.night ? '#2a1410' : '#8a3f30';
      ctx.fillRect(x + w / 2 + 8, y - hh * 0.72, w * 0.5, hh * 0.72);
      ctx.fillStyle = pal.night ? '#1a0d0a' : '#6e3126';
      ctx.beginPath();
      ctx.moveTo(x + w / 2 + 2, y - hh * 0.72);
      ctx.lineTo(x + w / 2 + 8 + w * 0.25, y - hh * 0.72 - w * 0.18);
      ctx.lineTo(x + w / 2 + 14 + w * 0.5, y - hh * 0.72);
      ctx.closePath(); ctx.fill();
    }
  };
};

const dChurch: DecorMaker = (rng, pal) => {
  const s = 66 + rng() * 20;
  const wall = pal.night ? '#211d18' : '#ddd2bc';
  const roof = pal.night ? '#16120e' : '#5a6672';
  return (ctx, x, y) => {
    // 中殿
    ctx.fillStyle = wall;
    ctx.fillRect(x - s * 0.55, y - s * 0.55, s * 1.1, s * 0.55);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.62, y - s * 0.55);
    ctx.lineTo(x, y - s * 0.85);
    ctx.lineTo(x + s * 0.62, y - s * 0.55);
    ctx.closePath(); ctx.fill();
    // 钟楼
    ctx.fillStyle = wall;
    ctx.fillRect(x - s * 0.14, y - s * 1.15, s * 0.28, s * 1.15);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.19, y - s * 1.15);
    ctx.lineTo(x, y - s * 1.62);
    ctx.lineTo(x + s * 0.19, y - s * 1.15);
    ctx.closePath(); ctx.fill();
    // 尖顶十字
    ctx.strokeStyle = pal.night ? '#0c0a08' : '#4a4038';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.62); ctx.lineTo(x, y - s * 1.78);
    ctx.moveTo(x - s * 0.05, y - s * 1.7); ctx.lineTo(x + s * 0.05, y - s * 1.7);
    ctx.stroke();
    // 拱窗
    ctx.fillStyle = pal.night ? pal.winLit : '#7a8a9c';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - s * 0.75);
    ctx.lineTo(x - 6, y - s * 0.95);
    ctx.arc(x, y - s * 0.95, 6, Math.PI, 0);
    ctx.lineTo(x + 6, y - s * 0.75);
    ctx.closePath(); ctx.fill();
  };
};

const dWaterTower: DecorMaker = (rng, pal) => {
  const s = 52 + rng() * 14;
  const body = pal.night ? '#1e1a15' : '#a85840';
  const leg = pal.night ? '#100d0a' : '#6e4636';
  return (ctx, x, y) => {
    ctx.strokeStyle = leg;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.28, y); ctx.lineTo(x - s * 0.18, y - s * 0.8);
    ctx.moveTo(x + s * 0.28, y); ctx.lineTo(x + s * 0.18, y - s * 0.8);
    ctx.moveTo(x - s * 0.24, y - s * 0.4); ctx.lineTo(x + s * 0.24, y - s * 0.4);
    ctx.stroke();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.95, s * 0.32, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(body, 0.7);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.34, y - s * 1.05);
    ctx.lineTo(x, y - s * 1.3);
    ctx.lineTo(x + s * 0.34, y - s * 1.05);
    ctx.closePath(); ctx.fill();
  };
};

const dSignalGantry: DecorMaker = (_rng, pal) => {
  const col = pal.night ? '#0a0a0a' : '#33383e';
  const lit = Math.random() > 0.5 ? '#e84848' : '#3ad068';
  return (ctx, x, y) => {
    const hh = 120;
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hh); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y - hh); ctx.lineTo(x + 90, y - hh); ctx.stroke();
    // 信号机
    ctx.fillStyle = col;
    ctx.fillRect(x + 78, y - hh - 16, 12, 34);
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(x + 84, y - hh - 8, 4, 0, Math.PI * 2); ctx.fill();
    if (pal.night) {
      const g = ctx.createRadialGradient(x + 84, y - hh - 8, 1, x + 84, y - hh - 8, 22);
      g.addColorStop(0, lit.replace(')', ',0.5)').replace('rgb', 'rgba').replace('#e84848', 'rgba(232,72,72,0.5)').replace('#3ad068', 'rgba(58,208,104,0.5)'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 62, y - hh - 30, 44, 44);
    }
  };
};

const dPowerTower: DecorMaker = (_rng, pal) => {
  const s = 130 + Math.random() * 40;
  const col = pal.night ? 'rgba(8,8,10,0.9)' : 'rgba(70,76,84,0.9)';
  return (ctx, x, y) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    // 塔身桁架
    ctx.beginPath();
    ctx.moveTo(x - s * 0.22, y); ctx.lineTo(x - s * 0.06, y - s);
    ctx.moveTo(x + s * 0.22, y); ctx.lineTo(x + s * 0.06, y - s);
    for (let i = 1; i <= 4; i++) {
      const yy = y - (i / 4) * s;
      const ww = s * (0.22 - 0.16 * (i / 4));
      ctx.moveTo(x - ww, yy); ctx.lineTo(x + ww, yy);
    }
    ctx.stroke();
    // 横担
    ctx.lineWidth = 4;
    for (const dy of [0.72, 0.86, 1.0]) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.3, y - s * dy);
      ctx.lineTo(x + s * 0.3, y - s * dy);
      ctx.stroke();
    }
  };
};

const dSheepFlock: DecorMaker = (rng, pal) => {
  const n = 4 + Math.floor(rng() * 5);
  const offs: { dx: number; dy: number; s: number }[] = [];
  for (let i = 0; i < n; i++) offs.push({ dx: (rng() - 0.5) * 130, dy: (rng() - 0.5) * 16, s: 9 + rng() * 5 });
  const wool = pal.night ? '#3a3630' : '#f0ece0';
  const head = pal.night ? '#141210' : '#4a4038';
  return (ctx, x, y) => {
    for (const o of offs) {
      const sx = x + o.dx, sy = y + o.dy, s = o.s;
      ctx.fillStyle = wool;
      ctx.beginPath(); ctx.ellipse(sx, sy - s * 0.7, s, s * 0.62, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = head;
      ctx.beginPath(); ctx.arc(sx + s * 0.85, sy - s * 0.75, s * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  };
};

const dSunflower: DecorMaker = (rng, pal) => {
  const n = 7 + Math.floor(rng() * 6);
  const pts: { dx: number; h: number }[] = [];
  for (let i = 0; i < n; i++) pts.push({ dx: (rng() - 0.5) * 90, h: 20 + rng() * 12 });
  const petal = pal.night ? '#5a4a14' : '#f2c230';
  const core = pal.night ? '#241c08' : '#6a4a1a';
  const stem = shade(pal.ground, 0.7);
  return (ctx, x, y) => {
    for (const p of pts) {
      ctx.strokeStyle = stem;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x + p.dx, y); ctx.lineTo(x + p.dx, y - p.h); ctx.stroke();
      ctx.fillStyle = petal;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + p.dx + Math.cos(a) * 5, y - p.h + Math.sin(a) * 5, 3.2, 2, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(x + p.dx, y - p.h, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  };
};

const dVineyard: DecorMaker = (rng, pal) => {
  const rows = 4;
  const cols = 5 + Math.floor(rng() * 4);
  const leaf = shade(pal.midBase, 0.62);
  const post = pal.night ? '#0d0a08' : '#5a4a38';
  return (ctx, x, y) => {
    for (let r = 0; r < rows; r++) {
      const yy = y - r * 12;
      const sc = 1 - r * 0.16;
      for (let cix = 0; cix < cols; cix++) {
        const xx = x + (cix - cols / 2) * 34 * sc;
        ctx.strokeStyle = post;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - 22 * sc); ctx.stroke();
        ctx.fillStyle = leaf;
        ctx.beginPath(); ctx.ellipse(xx, yy - 24 * sc, 9 * sc, 6 * sc, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
};

const dRailHut: DecorMaker = (rng, pal) => {
  const wall = pal.night ? '#1c1814' : '#b8a888';
  const roof = pal.night ? '#12100c' : '#7a4636';
  const lit = rng() > 0.4;
  return (ctx, x, y) => {
    ctx.fillStyle = wall;
    ctx.fillRect(x - 20, y - 26, 40, 26);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - 24, y - 26);
    ctx.lineTo(x, y - 40);
    ctx.lineTo(x + 24, y - 26);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = lit && pal.night ? pal.winLit : shade(wall, 0.5);
    ctx.fillRect(x - 6, y - 18, 12, 18);
    // 信号旗杆
    ctx.strokeStyle = pal.night ? '#0c0a08' : '#4a4440';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 28, y); ctx.lineTo(x + 28, y - 44); ctx.stroke();
    ctx.fillStyle = pal.night ? '#5a1414' : '#d84a3a';
    ctx.fillRect(x + 28, y - 44, 14, 8);
  };
};

const dVillageCluster: DecorMaker = (rng, pal) => {
  const n = 3 + Math.floor(rng() * 4);
  const houses: { dx: number; w: number; hh: number; roof: string; wall: string }[] = [];
  let cx = -((n - 1) * 46) / 2;
  for (let i = 0; i < n; i++) {
    houses.push({
      dx: cx, w: 34 + rng() * 16, hh: 24 + rng() * 12,
      wall: pal.night ? '#241f19' : ['#e0d4bc', '#d4c8b0', '#e6dcc6'][Math.floor(rng() * 3)],
      roof: pal.night ? '#16120e' : ['#9c4636', '#6a5a48', '#4a5a72'][Math.floor(rng() * 3)],
    });
    cx += 46 + rng() * 14;
  }
  return (ctx, x, y) => {
    for (const hs of houses) {
      const hx = x + hs.dx;
      ctx.fillStyle = hs.wall;
      ctx.fillRect(hx - hs.w / 2, y - hs.hh, hs.w, hs.hh);
      ctx.fillStyle = hs.roof;
      ctx.beginPath();
      ctx.moveTo(hx - hs.w / 2 - 4, y - hs.hh);
      ctx.lineTo(hx, y - hs.hh - hs.w * 0.32);
      ctx.lineTo(hx + hs.w / 2 + 4, y - hs.hh);
      ctx.closePath(); ctx.fill();
      if (pal.night && rng() > 0.45) {
        ctx.fillStyle = pal.winLit;
        ctx.fillRect(hx - 4, y - hs.hh * 0.7, 8, 9);
      }
    }
  };
};

const dCornfield: DecorMaker = (rng, pal) => {
  const n = 16 + Math.floor(rng() * 10);
  const pts: { dx: number; h: number }[] = [];
  for (let i = 0; i < n; i++) pts.push({ dx: (rng() - 0.5) * 150, h: 24 + rng() * 14 });
  const col = pal.night ? '#2a3018' : '#7a8a3a';
  return (ctx, x, y) => {
    ctx.strokeStyle = col;
    for (const p of pts) {
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x + p.dx, y); ctx.lineTo(x + p.dx, y - p.h); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + p.dx, y - p.h * 0.55); ctx.lineTo(x + p.dx - 6, y - p.h * 0.75);
      ctx.moveTo(x + p.dx, y - p.h * 0.5); ctx.lineTo(x + p.dx + 6, y - p.h * 0.7);
      ctx.stroke();
    }
  };
};

// 各场景的装饰物池（权重）
const DECOR_POOLS: Record<SceneKind, { mid: [DecorMaker, number][]; near: [DecorMaker, number][] }> = {
  field: {
    mid: [[dTreeRound, 2.2], [dTreeCluster, 1.6], [dTreeWillow, 0.9], [dTreeBare, 0.5], [dFarmhouse, 1.6], [dHouse, 1.2], [dWindmill, 0.5], [dHay, 2.2], [dCow, 1.2], [dSheepFlock, 1.2], [dChurch, 0.35], [dWaterTower, 0.5], [dVillageCluster, 0.7], [dPowerTower, 0.7], [dSignalGantry, 0.5], [dRailHut, 0.6], [dTreePine, 0.8]],
    near: [[dBush, 2.5], [dFlowers, 2], [dHay, 0.8], [dSunflower, 1.6], [dCornfield, 1.4], [dVineyard, 1.2], [dTreeRound, 0.8]],
  },
  forest: {
    mid: [[dTreePine, 4.5], [dTreeCluster, 3.5], [dTreeRound, 2.5], [dTreeBare, 0.8], [dRailHut, 0.5], [dHouse, 0.4], [dSignalGantry, 0.5], [dPowerTower, 0.5]],
    near: [[dBush, 4], [dTreePine, 1.5], [dTreeCluster, 1.2], [dFlowers, 1], [dCornfield, 0.6]],
  },
  mountain: {
    mid: [[dTreePine, 3.5], [dTreeCluster, 2], [dTreeBare, 1.2], [dHouse, 0.8], [dCow, 0.8], [dSheepFlock, 0.9], [dSignalGantry, 0.4], [dRailHut, 0.5], [dVillageCluster, 0.5]],
    near: [[dBush, 3], [dTreePine, 1], [dTreeBare, 0.8], [dFlowers, 1.5]],
  },
  river: {
    mid: [[dBoat, 1.2], [dTreeRound, 2], [dTreeWillow, 1.8], [dTreeCluster, 1.2], [dHouse, 1], [dVillageCluster, 0.8], [dWaterTower, 0.5], [dSignalGantry, 0.5], [dTreePine, 1], [dRailHut, 0.5]],
    near: [[dBush, 3], [dFlowers, 2], [dVineyard, 0.8], [dTreeWillow, 0.8]],
  },
  town: {
    mid: [[dHouse, 3.5], [dVillageCluster, 1.5], [dChurch, 0.6], [dWaterTower, 0.7], [dTreeRound, 1.2], [dTreeCluster, 0.8], [dLamp, 1.8], [dPowerTower, 0.8], [dSignalGantry, 0.6], [dRailHut, 0.5]],
    near: [[dLamp, 2.5], [dBush, 2], [dTreeRound, 1]],
  },
};

function pickWeighted<T>(rng: () => number, pool: [T, number][]): T {
  let total = 0;
  for (const [, w] of pool) total += w;
  let r = rng() * total;
  for (const [v, w] of pool) { r -= w; if (r <= 0) return v; }
  return pool[0][0];
}

// ---------- 场景 ----------
export class Scene {
  kind: SceneKind;
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  seed: number;

  constructor(kind: SceneKind, pal: Palette, seed: number) {
    this.kind = kind;
    this.seed = seed;
    this.far = buildFarBand(kind, pal, seed);
    this.mid = buildMidBand(kind, pal, seed + 7);
  }

  makeDecor(rng: () => number, pal: Palette, x: number, layer: 'mid' | 'near'): Decor {
    const pool = DECOR_POOLS[this.kind][layer];
    const maker = pickWeighted(rng, pool);
    return { x, layer, kind: this.kind, draw: maker(rng, pal) };
  }
}

// 过渡期间装饰物生成的场景代理（不重建条带，只提供 kind）
const TMP_SCENES = Object.fromEntries(
  SCENE_KINDS.map((k) => [k, { kind: k, makeDecor(rng: () => number, pal: Palette, x: number, layer: 'mid' | 'near'): Decor {
    const pool = DECOR_POOLS[k][layer];
    const maker = pickWeighted(rng, pool);
    return { x, layer, kind: k, draw: maker(rng, pal) };
  } } as unknown as Scene]),
) as Record<SceneKind, Scene>;

// ---------- 引擎 ----------
const MAXPX = 430; // speed=1 时前景层像素/秒
const P_FAR = 0.045;
const P_MID = 0.17;
const P_NEAR = 0.5;

interface Cloud { x: number; y: number; s: number; v: number; puffs: { dx: number; dy: number; r: number }[] }
interface Bird { x: number; y: number; vx: number; flap: number }
interface Star { x: number; y: number; r: number; tw: number }

export class SceneryEngine {
  time: TimeOfDay;
  pal: Palette;
  speed = 0;
  targetSpeed = 0;
  worldX = 0;
  t = 0;
  horizon = 0.6;
  lastW = 1920;

  private sceneA: Scene;
  private transition: { kind: SceneKind; far: HTMLCanvasElement; mid: HTMLCanvasElement; farX: number; midX: number } | null = null;
  private spawnKind: SceneKind = 'field';
  private sceneTimer = 24;
  private rng = mulberry32(Math.floor(Math.random() * 1e9));
  private decorRng = mulberry32(Math.floor(Math.random() * 1e9));
  private decors: Decor[] = [];
  private nextDecorMid = 300;
  private nextDecorNear = 120;

  private clouds: Cloud[] = [];
  private birds: Bird[] = [];
  private stars: Star[] = [];
  private birdTimer = 8;

  // 站台（世界坐标锚定，有固定长度，真实站台约 450m）
  platformMode: 'none' | 'in' | 'dwell' | 'out' = 'none';
  private platformSlide = 0;
  private stationName = '';
  private platformSeed = 1;
  private platformWx = 0; // 站台起点世界坐标
  private static PLAT_LEN = 3600; // 世界单位 ≈ 真实 450m 站台

  // 隧道
  private tunnel = 0; // 0-1
  private tunnelState: 'idle' | 'enter' | 'inside' | 'exit' = 'idle';
  private tunnelTimer = 0;
  private tunnelCooldown = 25;

  constructor(time: TimeOfDay) {
    this.time = time;
    this.pal = paletteFor(time);
    this.sceneA = new Scene('field', this.pal, 12345);
    for (let i = 0; i < 7; i++) this.clouds.push(this.makeCloud(Math.random() * 2200));
    for (let i = 0; i < 90; i++) {
      this.stars.push({ x: Math.random(), y: Math.random() * 0.5, r: 0.5 + Math.random() * 1.3, tw: Math.random() * 6 });
    }
  }

  private makeCloud(x: number): Cloud {
    const puffs: Cloud['puffs'] = [];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      puffs.push({ dx: (i - n / 2) * 26 + Math.random() * 14, dy: (Math.random() - 0.5) * 12, r: 16 + Math.random() * 18 });
    }
    return { x, y: 0.06 + Math.random() * 0.24, s: 0.7 + Math.random() * 1.1, v: 2 + Math.random() * 4, puffs };
  }

  arrive(stationName: string) {
    this.stationName = stationName;
    this.platformSeed = Math.floor(Math.random() * 1e9);
    // 站台起点放在当前画面后方一段距离，随后随世界滚动
    this.platformWx = this.worldX - 400;
    this.platformMode = 'in';
    this.targetSpeed = 0;
  }

  depart() {
    this.platformMode = 'out';
    this.targetSpeed = 1;
  }

  setCruising() {
    if (this.platformMode === 'none') this.targetSpeed = 1;
  }

  update(dt: number) {
    this.t += dt;
    // 真实列车加减速：匀加速过程长（起步约 25s 到巡航），减速稍快
    const accel = this.targetSpeed > this.speed ? 0.042 : 0.075;
    const d = this.targetSpeed - this.speed;
    const step = Math.sign(d) * Math.min(Math.abs(d), accel * dt);
    this.speed = Math.max(0, Math.min(1, this.speed + step));
    this.worldX += this.speed * MAXPX * dt;

    // 站台可见性（世界坐标锚定，随车速滑过）
    if (this.platformMode !== 'none') {
      const rel = this.platformWx - this.worldX;
      this.platformSlide = rel > -SceneryEngine.PLAT_LEN && rel < 2600 ? 1 : 0;
      if (this.platformMode === 'in' && this.speed < 0.005) this.platformMode = 'dwell';
      if (this.platformMode === 'out' && rel < -SceneryEngine.PLAT_LEN) {
        this.platformMode = 'none';
        this.platformSlide = 0;
      }
    }

    // 场景过渡（受控滚动切换：新场景从远方进入，覆盖旧场景后驶过）
    if (this.platformMode === 'none' && this.speed > 0.3 && !this.transition) {
      this.sceneTimer -= dt;
      if (this.sceneTimer <= 0) {
        const kinds = SCENE_KINDS.filter((k) => k !== this.sceneA.kind);
        const kind = kinds[Math.floor(this.rng() * kinds.length)];
        this.transition = {
          kind,
          far: buildFarBand(kind, this.pal, Math.floor(this.rng() * 1e9)),
          mid: buildMidBand(kind, this.pal, Math.floor(this.rng() * 1e9) + 7),
          farX: 0,
          midX: -700, // 中景层稍晚进入，制造纵深先后
        };
        this.spawnKind = kind; // 新场景装饰物立即开始在后方生成
      }
    }
    if (this.transition) {
      const tr = this.transition;
      // 各层边界随视差速度向左推进
      tr.farX += this.speed * MAXPX * P_FAR * dt;
      tr.midX += this.speed * MAXPX * P_MID * dt;
      // 当中景边界完全驶出左缘，过渡完成
      if (tr.midX >= this.lastW + BAND_W) {
        this.sceneA = new Scene(tr.kind, this.pal, Math.floor(this.rng() * 1e9));
        this.transition = null;
        this.sceneTimer = 45 + this.rng() * 60;
      }
    } else {
      this.spawnKind = this.sceneA.kind;
    }

    // 随机隧道
    this.tunnelCooldown -= dt;
    if (this.tunnelState === 'idle' && this.tunnelCooldown <= 0 && this.speed > 0.7 && this.platformMode === 'none') {
      if (this.rng() < dt / 30) { // 平均约 30 秒一次判定机会
        this.tunnelState = 'enter';
        this.tunnelTimer = 6 + this.rng() * 9;
      }
    }
    if (this.tunnelState === 'enter') {
      this.tunnel = Math.min(1, this.tunnel + dt / 1.6);
      if (this.tunnel >= 1) this.tunnelState = 'inside';
    } else if (this.tunnelState === 'inside') {
      this.tunnelTimer -= dt;
      if (this.tunnelTimer <= 0) this.tunnelState = 'exit';
    } else if (this.tunnelState === 'exit') {
      this.tunnel = Math.max(0, this.tunnel - dt / 1.8);
      if (this.tunnel <= 0) {
        this.tunnelState = 'idle';
        this.tunnelCooldown = 30 + this.rng() * 40;
      }
    }

    // 云
    for (const cl of this.clouds) cl.x -= (cl.v + this.speed * 8) * dt;
    for (const cl of this.clouds) if (cl.x < -260) Object.assign(cl, this.makeCloud(2300 + Math.random() * 400));

    // 鸟
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && !this.pal.night && this.speed > 0.2) {
      const n = 3 + Math.floor(this.rng() * 4);
      const bx = 2100, by = 0.12 + this.rng() * 0.2;
      for (let i = 0; i < n; i++) {
        this.birds.push({ x: bx + i * 22 + this.rng() * 10, y: by + Math.abs(i - n / 2) * 12, vx: 26 + this.rng() * 14, flap: this.rng() * 6 });
      }
      this.birdTimer = 14 + this.rng() * 20;
    }
    for (const b of this.birds) { b.x -= (b.vx + this.speed * 20) * dt; b.flap += dt * 8; }
    this.birds = this.birds.filter((b) => b.x > -60);

    // 装饰物生成/清理（过渡期间按 spawnKind 生成新场景素材）
    const spawnScene = this.spawnKind === this.sceneA.kind ? this.sceneA : TMP_SCENES[this.spawnKind];
    const aheadMid = this.worldX * P_MID + 2300;
    while (this.nextDecorMid < aheadMid) {
      this.decors.push(spawnScene.makeDecor(this.decorRng, this.pal, this.nextDecorMid / P_MID, 'mid'));
      this.nextDecorMid += (90 + this.decorRng() * 260) * P_MID * 4;
    }
    const aheadNear = this.worldX * P_NEAR + 2300;
    while (this.nextDecorNear < aheadNear) {
      this.decors.push(spawnScene.makeDecor(this.decorRng, this.pal, this.nextDecorNear / P_NEAR, 'near'));
      this.nextDecorNear += (60 + this.decorRng() * 200) * P_NEAR * 2.4;
    }
    this.decors = this.decors.filter((dc) => {
      const p = dc.layer === 'mid' ? P_MID : P_NEAR;
      return dc.x * p - this.worldX * p > -320;
    });
  }

  // ---------- 绘制 ----------
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    this.lastW = w;
    const pal = this.pal;
    const hz = h * this.horizon;

    ctx.save();
    // 行驶震动（轻微）
    const vib = Math.sin(this.t * 23) * 0.7 * this.speed + Math.sin(this.t * 37) * 0.4 * this.speed;
    ctx.translate(0, vib);

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, -8, w, hz + 8);

    // 星
    if (pal.stars > 0) {
      for (const s of this.stars) {
        const a = pal.stars * (0.5 + 0.5 * Math.sin(this.t * 1.5 + s.tw));
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(3)})`;
        ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
      }
    }

    // 日/月
    const sunPos: Record<TimeOfDay, [number, number]> = {
      morning: [0.78, 0.34], day: [0.55, 0.16], dusk: [0.2, 0.42], night: [0.72, 0.2],
    };
    const [sx, sy] = sunPos[this.time];
    const sunR = this.time === 'night' ? 26 : 34;
    const glow = ctx.createRadialGradient(sx * w, sy * h, 4, sx * w, sy * h, sunR * 4);
    glow.addColorStop(0, pal.sunGlow);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx * w - sunR * 4, sy * h - sunR * 4, sunR * 8, sunR * 8);
    ctx.fillStyle = pal.sun;
    ctx.beginPath(); ctx.arc(sx * w, sy * h, sunR, 0, Math.PI * 2); ctx.fill();
    if (this.time === 'night') {
      ctx.fillStyle = 'rgba(180,190,220,0.5)';
      ctx.beginPath(); ctx.arc(sx * w - 8, sy * h - 6, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx * w + 9, sy * h + 8, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // 云
    for (const cl of this.clouds) {
      const cx = ((cl.x % 2600) + 2600) % 2600 - 300;
      const cy = cl.y * h;
      ctx.fillStyle = pal.cloudShadow;
      for (const p of cl.puffs) {
        ctx.beginPath(); ctx.ellipse(cx + p.dx * cl.s, cy + (p.dy + 6) * cl.s, p.r * cl.s, p.r * 0.62 * cl.s, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = pal.cloud;
      for (const p of cl.puffs) {
        ctx.beginPath(); ctx.ellipse(cx + p.dx * cl.s, cy + p.dy * cl.s, p.r * cl.s, p.r * 0.62 * cl.s, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 鸟
    ctx.strokeStyle = pal.night ? 'rgba(20,20,30,0.8)' : 'rgba(50,50,60,0.75)';
    ctx.lineWidth = 2;
    for (const b of this.birds) {
      const f = Math.sin(b.flap) * 4;
      ctx.beginPath();
      ctx.moveTo(b.x - 7, b.y - f);
      ctx.quadraticCurveTo(b.x, b.y + 3, b.x, b.y);
      ctx.quadraticCurveTo(b.x, b.y + 3, b.x + 7, b.y - f);
      ctx.stroke();
    }

    // 地平线基底（防止中景透明处露底）
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, hz - 2, w, h * 0.08);

    // 远山 / 中景（受控滚动切换：新场景作为独立条带从右侧驶入，边界清晰、自然衔接）
    this.drawSceneBands(ctx, this.sceneA, w, h, 1);
    if (this.transition) {
      const tr = this.transition;
      const farH = hz * 0.95;
      const midH = h * 0.24;
      // farX/midX 是切换边界的世界位移；边界在屏幕上的位置 = w - 已推进距离
      const seamFarScreen = w - tr.farX;
      if (seamFarScreen < w + BAND_W) {
        for (let x = seamFarScreen; x < w + BAND_W; x += BAND_W) {
          ctx.drawImage(tr.far, x, hz - farH, BAND_W, farH);
        }
      }
      const seamMidScreen = w - tr.midX;
      if (seamMidScreen < w + BAND_W) {
        for (let x = seamMidScreen; x < w + BAND_W; x += BAND_W) {
          ctx.drawImage(tr.mid, x, hz - midH * 0.35, BAND_W, midH);
        }
      }
    }

    // 中景装饰物
    for (const dc of this.decors) {
      if (dc.layer !== 'mid') continue;
      const sx = dc.x * P_MID - this.worldX * P_MID;
      if (sx < -200 || sx > w + 200) continue;
      dc.draw(ctx, sx, hz + h * 0.062, pal);
    }

    // 近景地面
    const gg = ctx.createLinearGradient(0, hz + h * 0.06, 0, h);
    gg.addColorStop(0, pal.ground);
    gg.addColorStop(1, pal.groundDark);
    ctx.fillStyle = gg;
    ctx.fillRect(0, hz + h * 0.06, w, h - hz);

    // 地面纹理（快速后掠的短线）
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    const texOff = (this.worldX * P_NEAR) % 90;
    for (let x = -90; x < w + 90; x += 90) {
      const sx = x - texOff;
      const yy = hz + h * 0.16 + ((x * 7919) % 100) / 100 * (h - hz - h * 0.2);
      ctx.beginPath(); ctx.moveTo(sx, yy); ctx.lineTo(sx + 26 + this.speed * 30, yy); ctx.stroke();
    }

    // 近景装饰物
    for (const dc of this.decors) {
      if (dc.layer !== 'near') continue;
      const sx = dc.x * P_NEAR - this.worldX * P_NEAR;
      if (sx < -200 || sx > w + 200) continue;
      dc.draw(ctx, sx, h * 0.9, pal);
    }

    // 站台
    if (this.platformSlide > 0.005) this.drawPlatform(ctx, w, h);

    // 邻线铁轨 + 道砟（画面最底部近景，快速后退）
    if (this.platformSlide < 0.4) this.drawTrack(ctx, w, h);

    // 前景：接触网电线杆 + 草叶残影
    if (this.platformSlide < 0.4) this.drawForeground(ctx, w, h);

    // 隧道
    if (this.tunnel > 0.005) this.drawTunnel(ctx, w, h);

    // 时段色调 + 暗角
    if (pal.tintA > 0) {
      ctx.globalAlpha = pal.tintA;
      ctx.fillStyle = pal.tint;
      ctx.fillRect(0, -8, w, h + 16);
      ctx.globalAlpha = 1;
    }
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, pal.night ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, -8, w, h + 16);

    ctx.restore();
  }

  private drawSceneBands(ctx: CanvasRenderingContext2D, sc: Scene, _w: number, h: number, _alpha: number) {
    const hz = h * this.horizon;
    const farH = hz * 0.95;
    const offFar = (this.worldX * P_FAR) % BAND_W;
    ctx.drawImage(sc.far, -offFar, hz - farH, BAND_W, farH);
    ctx.drawImage(sc.far, -offFar + BAND_W, hz - farH, BAND_W, farH);

    const midH = h * 0.24;
    const offMid = (this.worldX * P_MID) % BAND_W;
    ctx.drawImage(sc.mid, -offMid, hz - midH * 0.35, BAND_W, midH);
    ctx.drawImage(sc.mid, -offMid + BAND_W, hz - midH * 0.35, BAND_W, midH);
  }

  private drawTrack(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const pal = this.pal;
    const bed = h * 0.965;
    // 道砟床
    ctx.fillStyle = pal.night ? '#101114' : '#6a675f';
    ctx.fillRect(0, bed, w, h - bed + 10);
    // 道砟碎石
    ctx.fillStyle = pal.night ? '#1a1c20' : '#7d7a70';
    const gOff = (this.worldX * 1.15) % 14;
    for (let x = -14; x < w + 14; x += 14) {
      const sx = x - gOff;
      const yy = bed + 3 + ((x * 37) % 100) / 100 * (h - bed - 6);
      ctx.fillRect(sx, yy, 5, 3.5);
    }
    // 枕木
    ctx.fillStyle = pal.night ? '#0c0a08' : '#4a4038';
    const tOff = (this.worldX * 1.15) % 34;
    for (let x = -34; x < w + 34; x += 34) {
      ctx.fillRect(x - tOff, bed + 2, 20, 7);
    }
    // 钢轨
    ctx.fillStyle = pal.night ? '#2a2c30' : '#8f9296';
    ctx.fillRect(0, bed, w, 3);
    ctx.fillStyle = pal.night ? '#3a3d42' : '#c2c5c9';
    ctx.fillRect(0, bed, w, 1.2);
  }

  private drawForeground(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const pal = this.pal;
    const hz = h * this.horizon;

    // ===== 近景动态层：路基灌木篱墙快速后掠（随车速写线条感）=====
    const hedgeY = h * 0.985;
    ctx.strokeStyle = pal.fg;
    ctx.fillStyle = pal.fg;
    // 低矮灌木篱：连续起伏的暗色块 + 速度拉伸
    ctx.globalAlpha = 0.5;
    const hOff = (this.worldX * 1.15) % 180;
    ctx.beginPath();
    ctx.moveTo(-60, h + 12);
    for (let x = -180; x < w + 180; x += 180) {
      const sx = x - hOff;
      const bump = 14 + ((x * 2654435761) % 100) / 100 * 26;
      ctx.quadraticCurveTo(sx + 90, hedgeY - bump - this.speed * 10, sx + 180, hedgeY - 8);
    }
    ctx.lineTo(w + 60, h + 12);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 草叶/枝条残影：速度越快拉得越长越斜
    ctx.strokeStyle = pal.fg;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    const off = (this.worldX * 1.0) % 38;
    for (let x = -38; x < w + 38; x += 38) {
      const sx = x - off;
      const yy = h - 4 - ((x * 31) % 46);
      const len = 12 + this.speed * 64;
      ctx.beginPath();
      ctx.moveTo(sx, yy);
      ctx.lineTo(sx + len, yy - 6 - ((x * 13) % 16) - this.speed * 12);
      ctx.stroke();
    }
    // 偶发的高草/小灌木剪影（较大、更快、更暗）
    ctx.globalAlpha = 0.6;
    const off2 = (this.worldX * 1.25) % 260;
    for (let x = -260; x < w + 260; x += 260) {
      const sx = x - off2;
      const bh = 22 + ((x * 97) % 30);
      const lean = this.speed * 40;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, h);
      ctx.quadraticCurveTo(sx + lean * 0.4, h - bh * 0.7, sx + lean, h - bh);
      ctx.moveTo(sx + 6, h);
      ctx.quadraticCurveTo(sx + 6 + lean * 0.5, h - bh * 0.5, sx + 6 + lean * 1.2, h - bh * 0.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 接触网电线杆（真实间距约 50 米，折算后拉开）
    const spacing = 780;
    const offP = (this.worldX * 1.0) % spacing;
    ctx.strokeStyle = pal.night ? '#050505' : '#2b2f33';
    ctx.fillStyle = pal.night ? '#050505' : '#2b2f33';
    ctx.lineWidth = 5;
    for (let x = -spacing; x < w + spacing; x += spacing) {
      const sx = x - offP;
      const top = hz - h * 0.28;
      ctx.beginPath(); ctx.moveTo(sx, h + 10); ctx.lineTo(sx, top); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx, top + 10); ctx.lineTo(sx + 52, top + 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, top + 44); ctx.lineTo(sx + 40, top + 56); ctx.stroke();
      // 绝缘子串
      ctx.lineWidth = 2;
      for (const [ix, iy] of [[sx + 50, top + 26], [sx + 38, top + 56]] as const) {
        for (let k = 0; k < 3; k++) {
          ctx.beginPath(); ctx.arc(ix, iy + 4 + k * 5, 2.6, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.lineWidth = 5;
    }
    // 电线（轻微垂弧，横贯画面）
    ctx.strokeStyle = pal.night ? 'rgba(5,5,5,0.8)' : 'rgba(43,47,51,0.8)';
    ctx.lineWidth = 1.6;
    for (const dy of [26, 56]) {
      ctx.beginPath();
      const top = hz - h * 0.28 + dy;
      for (let x = -spacing; x < w + spacing; x += spacing) {
        const sx = x - offP;
        ctx.moveTo(sx, top);
        ctx.quadraticCurveTo(sx + spacing / 2, top + 12, sx + spacing, top);
      }
      ctx.stroke();
    }
  }

  private drawTunnel(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const a = this.tunnel;
    ctx.fillStyle = `rgba(6,6,10,${(a * 0.97).toFixed(3)})`;
    ctx.fillRect(0, -8, w, h + 16);
    // 隧道壁微光
    ctx.fillStyle = `rgba(40,38,46,${(a * 0.5).toFixed(3)})`;
    const wallOff = (this.worldX * 1.1) % 160;
    for (let x = -160; x < w + 160; x += 160) {
      ctx.fillRect(x - wallOff, 0, 60, h);
    }
    // 顶部灯带快速掠过
    const lightOff = (this.worldX * 1.3) % 130;
    for (let x = -130; x < w + 130; x += 130) {
      const sx = x - lightOff;
      const g = ctx.createRadialGradient(sx, h * 0.1, 2, sx, h * 0.1, 46);
      g.addColorStop(0, `rgba(255,230,170,${(a * 0.9).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 46, h * 0.1 - 46, 92, 92);
      ctx.fillStyle = `rgba(255,240,200,${a.toFixed(3)})`;
      ctx.fillRect(sx - 8, h * 0.1 - 3, 16, 6);
    }
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const pal = this.pal;
    const L = SceneryEngine.PLAT_LEN;
    // 站台世界坐标 → 屏幕坐标（近景比例）
    const x0 = this.platformWx - this.worldX;
    const x1 = x0 + L;
    ctx.save();
    // 只画可见部分
    const vx0 = Math.max(x0, -60);
    const vx1 = Math.min(x1, w + 60);

    const platTop = h * 0.68;
    const rng = mulberry32(this.platformSeed);

    // 站台两端斜坡
    ctx.fillStyle = pal.night ? '#1c1f26' : '#848a92';
    ctx.beginPath();
    ctx.moveTo(x0 - 160, h + 20);
    ctx.lineTo(x0, platTop);
    ctx.lineTo(x0, h + 20);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x1 + 160, h + 20);
    ctx.lineTo(x1, platTop);
    ctx.lineTo(x1, h + 20);
    ctx.closePath(); ctx.fill();

    // 站台地面
    ctx.fillStyle = pal.night ? '#22252c' : '#9aa0a8';
    ctx.fillRect(vx0 - 2, platTop, vx1 - vx0 + 4, h - platTop + 20);
    ctx.fillStyle = pal.night ? '#2c3038' : '#b0b6be';
    ctx.fillRect(vx0 - 2, platTop, vx1 - vx0 + 4, 10);
    // 站台边缘白线 + 安全黄线 + 盲道
    ctx.fillStyle = pal.night ? '#555a64' : '#e8eaee';
    ctx.fillRect(vx0, platTop + 12, vx1 - vx0, 3);
    ctx.fillStyle = pal.night ? '#8a7a1a' : '#e8c53a';
    ctx.fillRect(vx0, platTop + 24, vx1 - vx0, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let x = Math.max(vx0, x0); x < vx1; x += 16) ctx.fillRect(x, platTop + 42, 6, 6);

    // 雨棚（站台中段 70%，两端露天，更像真实小站）
    const canopyX0 = x0 + L * 0.15;
    const canopyX1 = x0 + L * 0.85;
    const cv0 = Math.max(canopyX0, vx0);
    const cv1 = Math.min(canopyX1, vx1);
    if (cv1 > cv0) {
      ctx.fillStyle = pal.night ? '#14161c' : '#4a525e';
      ctx.fillRect(cv0, h * 0.1, cv1 - cv0, h * 0.045);
      ctx.fillStyle = pal.night ? '#0e1014' : '#3a414c';
      ctx.fillRect(cv0, h * 0.145, cv1 - cv0, 8);
      // 雨棚下沿灯带
      for (let x = Math.ceil(cv0 / 200) * 200 + 40; x < cv1; x += 200) {
        ctx.fillStyle = pal.night ? '#ffd98a' : 'rgba(255,255,255,0.55)';
        ctx.fillRect(x, h * 0.153, 34, 5);
        if (pal.night) {
          const g = ctx.createRadialGradient(x + 17, h * 0.18, 4, x + 17, h * 0.18, 90);
          g.addColorStop(0, 'rgba(255,215,140,0.4)');
          g.addColorStop(1, 'rgba(255,215,140,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 80, h * 0.16, 200, 160);
        }
      }
      // 雨棚立柱
      ctx.fillStyle = pal.night ? '#191d24' : '#5a6472';
      for (let x = Math.ceil(cv0 / 260) * 260 + 30; x < cv1; x += 260) {
        ctx.fillRect(x, h * 0.145, 14, platTop - h * 0.145);
        // 柱脚
        ctx.fillRect(x - 4, platTop - 8, 22, 8);
      }
    }

    // 站房（雨棚中段后方的小建筑）
    const stX = x0 + L * 0.42;
    if (stX + 420 > vx0 && stX < vx1) {
      ctx.fillStyle = pal.night ? '#181c24' : '#a8aeb8';
      ctx.fillRect(stX, h * 0.3, 420, platTop - h * 0.3);
      ctx.fillStyle = pal.night ? '#12161d' : '#6e3f33';
      ctx.fillRect(stX - 10, h * 0.27, 440, h * 0.035);
      // 门窗
      for (let i = 0; i < 4; i++) {
        const wx = stX + 30 + i * 105;
        const lit = pal.night && rng() > 0.4;
        ctx.fillStyle = lit ? pal.winLit : pal.night ? '#0a0d14' : '#5a6a7c';
        ctx.fillRect(wx, h * 0.38, 56, 64);
        ctx.strokeStyle = pal.night ? '#2a2f3a' : '#f0f2f4';
        ctx.lineWidth = 3;
        ctx.strokeRect(wx, h * 0.38, 56, 64);
      }
      // 出站口牌子
      ctx.fillStyle = pal.night ? '#1a4f9c' : '#1a4f9c';
      ctx.fillRect(stX + 140, h * 0.32, 140, 30);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 17px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('出 站 口', stX + 210, h * 0.32 + 16);
    }

    // 站名牌（雨棚下挂两块）
    for (const signX of [x0 + L * 0.3, x0 + L * 0.62]) {
      if (signX < vx0 - 120 || signX > vx1 + 120) continue;
      // 吊杆
      ctx.strokeStyle = pal.night ? '#2a2f3a' : '#3a414c';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(signX, h * 0.15); ctx.lineTo(signX, h * 0.19); ctx.stroke();
      ctx.fillStyle = '#1a4f9c';
      ctx.fillRect(signX - 100, h * 0.19, 200, 42);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(signX - 100, h * 0.19, 200, 42);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.stationName + '站', signX, h * 0.19 + 22);
    }

    // 长椅（多张）
    ctx.fillStyle = pal.night ? '#101318' : '#6a4a34';
    for (const bx of [x0 + L * 0.22, x0 + L * 0.5, x0 + L * 0.74]) {
      if (bx < vx0 - 100 || bx > vx1 + 100) continue;
      ctx.fillRect(bx, platTop - 26, 90, 6);
      ctx.fillRect(bx + 6, platTop - 20, 6, 20);
      ctx.fillRect(bx + 78, platTop - 20, 6, 20);
      ctx.fillRect(bx, platTop - 44, 6, 20);
    }

    // 垃圾桶
    ctx.fillStyle = pal.night ? '#151a12' : '#3a5a3c';
    for (const tx of [x0 + L * 0.35, x0 + L * 0.68]) {
      if (tx < vx0 || tx > vx1) continue;
      ctx.fillRect(tx, platTop - 30, 20, 30);
      ctx.fillRect(tx - 2, platTop - 34, 24, 5);
    }

    // 候车人（站台全长散布，有的结伴、有的拉行李箱）
    const people = 5 + Math.floor(rng() * 6);
    for (let i = 0; i < people; i++) {
      const px = x0 + 120 + rng() * (L - 240);
      if (px < vx0 - 40 || px > vx1 + 40) continue;
      const ph = 50 + rng() * 16;
      const py = platTop - 2;
      const tone = pal.night ? '#05070c' : ['#23272e', '#2e3440', '#3a3040'][Math.floor(rng() * 3)];
      ctx.fillStyle = tone;
      ctx.beginPath(); ctx.arc(px, py - ph + 8, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - 8.5, py);
      ctx.quadraticCurveTo(px - 10.5, py - ph + 20, px, py - ph + 16);
      ctx.quadraticCurveTo(px + 10.5, py - ph + 20, px + 8.5, py);
      ctx.closePath(); ctx.fill();
      // 行李箱
      if (rng() > 0.55) {
        ctx.fillStyle = pal.night ? '#0c0e14' : ['#5a4a6a', '#7a3a3a', '#3a5a6a'][Math.floor(rng() * 3)];
        ctx.fillRect(px + 12, py - 22, 16, 22);
        ctx.strokeStyle = tone;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 14, py - 22); ctx.lineTo(px + 14, py - 30); ctx.stroke();
      }
    }

    ctx.restore();
  }
}
