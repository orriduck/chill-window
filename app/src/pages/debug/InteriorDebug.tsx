export default function InteriorDebug() {
  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white p-6">
      <h1 className="text-2xl font-bold mb-2">🚂 窗内景 · 素材</h1>
      <p className="text-sm text-white/50 mb-6">
        车厢内部所有视觉元素的独立展示，与 Home.tsx 中使用的样式完全一致
      </p>

      {/* 完整车厢内部组合视图 */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3 text-white/80">完整组合</h2>
        <div className="relative mx-auto rounded-2xl overflow-hidden border border-white/15 bg-black"
          style={{ width: 960, height: 540 }}>
          {/* 模拟窗外景色 — 简单的渐变背景 */}
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, #4a90c4 0%, #7ab8e0 30%, #c8d8a0 55%, #8a9a5a 80%, #5a6a3a 100%)' }} />
          {/* 远山 */}
          <div className="absolute" style={{ bottom: '45%', left: 0, right: 0, height: '15%', background: 'linear-gradient(to top, #7a9a6a, #9ab88a, #7a9a6a)' }}>
            <div style={{ position: 'absolute', top: -60, left: '10%', width: 150, height: 80, background: '#8aaa7a', borderRadius: '50% 50% 0 0' }} />
            <div style={{ position: 'absolute', top: -40, right: '20%', width: 120, height: 60, background: '#7a9a6a', borderRadius: '50% 50% 0 0' }} />
          </div>
          {/* 地面 */}
          <div className="absolute bottom-0 left-0 right-0" style={{ height: '45%', background: 'linear-gradient(to bottom, #8a9a5a, #6a7a3a)' }} />

          {/* ===== 以下代码完全复制自 Home.tsx 的窗内景部分 ===== */}

          {/* 车窗框（橡胶密封条 + 内框 + 车身壁板，加厚） */}
          <div className="absolute inset-0"
            style={{
              boxShadow: 'inset 0 0 0 10px #0a0b0d, inset 0 0 0 16px #1a1c20, inset 0 0 0 26px #2c2f35, inset 0 0 0 30px #141518, inset 0 0 100px 34px rgba(0,0,0,0.42)',
              borderRadius: 34,
            }} />
          {/* 玻璃反光 */}
          <div className="absolute inset-0"
            style={{
              background: 'linear-gradient(115deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 22%, transparent 30%, transparent 70%, rgba(255,255,255,0.04) 82%, transparent 90%)',
              borderRadius: 30,
            }} />
          {/* 窗台（更宽，带小桌板凹槽和杯槽） */}
          <div className="absolute bottom-0 left-0 right-0 h-14"
            style={{ background: 'linear-gradient(to bottom, #42464e, #26292f 55%, #17191d)', borderRadius: '0 0 20px 20px' }}>
            {/* 杯槽 */}
            <div className="absolute right-[16%] top-2 h-6 w-14 rounded-full"
              style={{ background: 'radial-gradient(ellipse at center, #101114 0%, #1e2025 70%, #2c2e34 100%)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)' }} />
            {/* 窗台前沿高光 */}
            <div className="absolute inset-x-8 top-0 h-[2px] rounded" style={{ background: 'rgba(255,255,255,0.10)' }} />
          </div>

          {/* 左侧乘客座椅靠背剪影 */}
          <div className="absolute bottom-6 left-0"
            style={{
              width: '8.5vw', height: '20vh',
              background: 'linear-gradient(to right, #0c0d10 0%, #191a1f 75%, #232529 100%)',
              borderRadius: '0 64px 10px 0',
              boxShadow: 'inset -8px 0 16px rgba(255,255,255,0.05)',
            }} />
          {/* 头枕 */}
          <div className="absolute left-0"
            style={{
              bottom: 'calc(6px + 20vh - 2px)', width: '7vw', height: '5.5vh',
              background: 'linear-gradient(to right, #0b0c0f, #1c1d22)',
              borderRadius: '0 30px 6px 0',
            }} />
          {/* 顶部：车厢内壁（背光剪影）+ 行李架 */}
          <div className="absolute left-0 right-0 top-4 h-[9vh]"
            style={{ background: 'linear-gradient(to bottom, #131417 0%, #1c1e23 55%, rgba(28,30,35,0) 100%)' }} />
          {/* 行李架外沿 */}
          <div className="absolute left-0 right-0"
            style={{
              top: 'calc(4px + 9vh)', height: 10,
              background: 'linear-gradient(to bottom, rgba(40,42,48,0.9), rgba(20,21,25,0))',
            }} />
          {/* 行李架上的行李剪影 */}
          <div className="absolute" style={{ left: '16%', top: 'calc(4px + 3.5vh)' }}>
            <div style={{ width: 120, height: 40, background: '#101114', borderRadius: '10px 10px 4px 4px' }} />
          </div>
          <div className="absolute" style={{ left: '62%', top: 'calc(4px + 4.5vh)' }}>
            <div style={{ width: 84, height: 32, background: '#0e0f12', borderRadius: '14px 14px 4px 4px' }} />
          </div>
          {/* 左右车窗立柱（宽厚的窗间壁，背光剪影） */}
          <div className="absolute left-0 top-4 bottom-10 w-[3.2vw]"
            style={{ background: 'linear-gradient(to right, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '0 10px 10px 0' }} />
          <div className="absolute right-0 top-4 bottom-10 w-[3.2vw]"
            style={{ background: 'linear-gradient(to left, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '10px 0 0 10px' }} />
          {/* 遮光帘（右侧垂下一截，背光） */}
          <div className="absolute right-[3.2vw] top-4 w-[2.6vw] h-[16vh]"
            style={{ background: 'linear-gradient(to left, #17181d, #22242a 60%, #2a2c33)', borderRadius: '0 0 14px 4px' }} />

          {/* 标注线 */}
          <div className="absolute inset-0">
            <Label x={2} y={55} text="车厢内壁" align="left" />
            <Label x={18} y={35} text="行李架 + 行李" align="left" />
            <Label x={5} y={85} text="座椅靠背" align="left" />
            <Label x={97} y={40} text="遮光帘" align="right" />
            <Label x={50} y={90} text="窗台 + 杯槽" align="center" />
            <Label x={2} y={15} text="车窗立柱" align="left" />
            <Label x={50} y={5} text="玻璃反光" align="center" />
          </div>
        </div>
      </section>

      {/* 逐个元素拆解 */}
      <section className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {INTERIOR_ELEMENTS.map((elem) => (
          <div key={elem.name}
            className="rounded-xl border border-white/10 bg-[#111318] p-5">
            <h3 className="text-sm font-semibold text-white/80 mb-2">{elem.name}</h3>
            <div className="relative rounded-lg overflow-hidden border border-white/5 bg-black"
              style={{ width: '100%', height: 160 }}>
              {/* 背景：浅色风景，凸显黑色窗内元素 */}
              <div className="absolute inset-0"
                style={{ background: 'linear-gradient(to bottom, #6a9ec4, #b8d0a0 60%, #7a8a4a 100%)' }} />
              {/* 远山剪影 */}
              <div className="absolute" style={{ bottom: '40%', left: 0, right: 0, height: '25%', background: '#7a9a6a', borderRadius: '50% 40% 0 0' }} />

              {/* 渲染对应的元素 */}
              <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                {elem.render()}
              </div>
            </div>
            <p className="mt-2 text-xs text-white/40 leading-relaxed">{elem.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function Label({ x, y, text, align }: { x: number; y: number; text: string; align: 'left' | 'right' | 'center' }) {
  const posStyle = align === 'right' ? { right: `${100 - x}%`, textAlign: 'right' as const }
    : align === 'center' ? { left: `${x}%`, textAlign: 'center' as const, transform: 'translateX(-50%)' }
    : { left: `${x}%`, textAlign: 'left' as const };

  return (
    <div className="absolute" style={{ top: `${y}%`, ...posStyle }}>
      <div className="flex items-center gap-1">
        <div className="h-px w-4 bg-amber-400/60" />
        <span className="text-[10px] text-amber-400/80 bg-black/40 px-1.5 py-0.5 rounded">{text}</span>
      </div>
    </div>
  );
}

interface InteriorElement {
  name: string;
  desc: string;
  render: () => React.ReactNode;
}

const INTERIOR_ELEMENTS: InteriorElement[] = [
  {
    name: '车窗框（橡胶密封条 + 车身壁板）',
    desc: '四层 boxShadow 叠加模拟车窗橡胶密封条、内框、壁板和暗角，圆角 34px。',
    render: () => (
      <div className="absolute inset-0"
        style={{
          boxShadow: 'inset 0 0 0 10px #0a0b0d, inset 0 0 0 16px #1a1c20, inset 0 0 0 26px #2c2f35, inset 0 0 0 30px #141518, inset 0 0 100px 34px rgba(0,0,0,0.42)',
          borderRadius: 30,
        }} />
    ),
  },
  {
    name: '玻璃反光',
    desc: '对角线渐变模拟车窗玻璃上的反射光，从左上角到右下，透明度 2-9%。',
    render: () => (
      <div className="absolute inset-0"
        style={{
          background: 'linear-gradient(115deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 22%, transparent 30%, transparent 70%, rgba(255,255,255,0.04) 82%, transparent 90%)',
          borderRadius: 24,
        }} />
    ),
  },
  {
    name: '窗台（桌板 + 杯槽）',
    desc: '金属质感渐变（#42464e → #17191d），右侧有一个椭圆杯槽，顶部有高光线。',
    render: () => (
      <div className="absolute bottom-0 left-0 right-0" style={{ height: 42, background: 'linear-gradient(to bottom, #42464e, #26292f 55%, #17191d)', borderRadius: '0 0 16px 16px' }}>
        <div className="absolute right-[16%] top-1.5 h-5 w-12 rounded-full"
          style={{ background: 'radial-gradient(ellipse at center, #101114 0%, #1e2025 70%, #2c2e34 100%)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)' }} />
        <div className="absolute inset-x-6 top-0 h-[2px] rounded" style={{ background: 'rgba(255,255,255,0.10)' }} />
      </div>
    ),
  },
  {
    name: '座椅靠背剪影',
    desc: '深色渐变（#0c0d10 → #232529），圆角右侧，带内阴影模拟靠背弧面。乘客视角看不到自己的座位，只看到对面的。',
    render: () => (
      <div className="absolute bottom-2 left-0"
        style={{
          width: 80, height: '45%',
          background: 'linear-gradient(to right, #0c0d10 0%, #191a1f 75%, #232529 100%)',
          borderRadius: '0 64px 10px 0',
          boxShadow: 'inset -8px 0 16px rgba(255,255,255,0.05)',
        }} />
    ),
  },
  {
    name: '头枕',
    desc: '座椅靠背顶部延伸出来的头枕，#0b0c0f → #1c1d22 渐变，圆角。',
    render: () => (
      <div className="absolute left-0"
        style={{
          bottom: 'calc(2px + 45% - 2px)', width: 65, height: 35,
          background: 'linear-gradient(to right, #0b0c0f, #1c1d22)',
          borderRadius: '0 30px 6px 0',
        }} />
    ),
  },
  {
    name: '车厢内壁（顶部背光剪影）',
    desc: '从顶部的深色渐变向下淡出（#131417 → transparent），模拟车厢顶部内壁的阴影。高度约 9vh。',
    render: () => (
      <div className="absolute left-0 right-0 top-3" style={{ height: 50, background: 'linear-gradient(to bottom, #131417 0%, #1c1e23 55%, rgba(28,30,35,0) 100%)' }} />
    ),
  },
  {
    name: '行李架 + 行李剪影',
    desc: '在车厢顶部内壁下方，有一个行李架外沿（10px 高），上面随机放置深色矩形行李。',
    render: () => (
      <>
        <div className="absolute left-0 right-0" style={{ top: 45, height: 10, background: 'linear-gradient(to bottom, rgba(40,42,48,0.9), rgba(20,21,25,0))' }} />
        <div className="absolute" style={{ left: '16%', top: 22 }}>
          <div style={{ width: 90, height: 30, background: '#101114', borderRadius: '10px 10px 4px 4px' }} />
        </div>
        <div className="absolute" style={{ left: '62%', top: 26 }}>
          <div style={{ width: 64, height: 24, background: '#0e0f12', borderRadius: '14px 14px 4px 4px' }} />
        </div>
      </>
    ),
  },
  {
    name: '车窗立柱（窗间壁）',
    desc: '左右的深色竖条（#0d0e11 → #26282e），模拟车厢壁板之间的立柱分隔。左侧向右渐变，右侧向左渐变。',
    render: () => (
      <>
        <div className="absolute left-0 top-3 bottom-6" style={{ width: 35, background: 'linear-gradient(to right, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '0 10px 10px 0' }} />
        <div className="absolute right-0 top-3 bottom-6" style={{ width: 35, background: 'linear-gradient(to left, #0d0e11, #1e2025 70%, #26282e)', borderRadius: '10px 0 0 10px' }} />
      </>
    ),
  },
  {
    name: '遮光帘',
    desc: '右侧垂下的一截半拉开的布纹窗帘（#17181d → #2a2c33），只出现在窗口右侧。',
    render: () => (
      <div className="absolute right-[3vw] top-3" style={{ width: 30, height: '50%', background: 'linear-gradient(to left, #17181d, #22242a 60%, #2a2c33)', borderRadius: '0 0 14px 4px' }} />
    ),
  },
];
