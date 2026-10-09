# Continuous Landscape Implementation Plan

**Goal:** 调试模式下生成包含城乡、农田与山谷山地的可复现连续世界。
**Architecture:** RouteFeatures 作为共用世界蓝图，Landscape 采样地形与用地；现有分块和各系统消费同一不可变计划。
**Tech Stack:** TypeScript, Three.js, simplex-noise, React/Vite。

- [x] 1. `core/TerrainInspector.ts` 增加独立面板，`DebugMode.ts` 增加入口，`ThreeCanvas.tsx` 接线。种子刷新通过 URL 重建世界；先实现调试入口再检查视觉。
- [x] 2. `RouteFeatures.ts` 增加连续模式、合法区域程序、场景标签、基于绝对段号的随机选择。保留 createRoutePlan 的原有调用行为。
- [x] 3. 新建 `terrain/Landscape.ts`，扩展 `Biome.ts` 高度描述；`TerrainGen.ts` 对两个自然高度进行插值，铁路/道路/农田/水体掩码最后处理，种子控制噪声。
- [x] 4. `TerrainLOD.ts` 消费统一采样、共享边界法线、种子化摆放和对象隔离；`SettlementProfile.ts` / `TownGenerator.ts` 加村庄与城市核心，城市楼宇实例化。
- [x] 5. `WaterSystem.ts` 每行采样水体权重，`FieldPlots.ts` 每个田块采样权重，`DistantHills.ts` 接收地貌权重；调试开关在系统更新后作用。
- [x] 6. `REFERENCES.md` 留代码、素材许可、实景与卫星研究的具体来源及采用点。
- [x] 7. 在 app 执行 `npm run build`，检查生成规则和边界的连续性；运行本地 Vite 并用浏览器逐场景、过渡、连续行驶与重生成检查。保存截图和真实验收记录。

不提交或覆盖已有无关改动，不新增常规视觉测试。直接在当前用户工作区执行，保留上一轮场景状态。

验收结果与限制：见 `docs/visual-checks/2026-10-09-continuous-landscape/README.md`。
