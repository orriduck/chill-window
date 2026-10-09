# 同世界自由切换调试模式

**Goal:** 普通网址下按钮、F5、F2 地形入口均进入九区块自由镜头，Esc 或返回列车立即退出；全程不导航、不重建世界，保留地形编辑和旅程状态。

**Architecture:** `DebugMode.setTerrainEditing(active)` 统一切换状态并通知 `Home`。`ThreeCanvas` 始终创建同一连续路线，调试只切相机及流式邻域；`Home` 暂停旅程计时和隐藏乘客操作层，保留用户自己的暂停选择。

**Tech Stack:** React / TypeScript / Three.js / OrbitControls。

本轮同会话执行，不创建另一个 checkout，不整体提交已有混合改动。界面与材质沿用现有研究；仅调整模式入口和状态切换。

- [x] `core/DebugMode.ts`：新增 `onTerrainEditingChange` 回调与公共 `setTerrainEditing(active)`；F5 切换，Esc 退出；F2 编辑入口调用方法，删除 `location.assign`。进入时保证外景可见、流式加载开启，并收起车厢检查面板。
- [x] `core/TerrainInspector.ts`：普通模式只显示「调试模式 · F5」，进入后显示九块工具栏与「返回列车 · Esc」。旧 query 只设置启动镜头/位置，不再停止速度或强制时段天气。
- [x] `ThreeCanvas.tsx`：路线固定 `createContinuousRoutePlan(seed)`；使用独立编辑相机，删除按路线类型分支的旧 top-down 相机替换。所有物理/时间更新采用 `paused || debugMode.isTopDown`，运动遥测也为零。切换回调稳定传入 React，不加入会导致重新挂载的模式依赖。
- [x] `core/TerrainEditor.ts`：每次从列车进入时重定位到列车附近；退出隐藏九块与编辑控件，编辑数据仍在 `TerrainLOD.edits`。
- [x] `pages/Home.tsx`：`terrainEditingRef` 同步真实状态，计时用 `pausedRef.current || terrainEditingRef.current`；启动页、乘客按钮、结束弹窗仅在普通模式可见。手动暂停保持独立，恢复后仍暂停。
- [x] 构建检查；Chrome 从 `/` 实际验证按钮与 F5/Esc 无导航，编辑后往返保持，旅程计时与位置冻结再恢复、手动暂停保持。保存最终截图与验收范围；检查端口 3000 持续可用。


## 验收 · 2026-10-09

Chrome 桌面 1595×1018，本地普通网址 `http://127.0.0.1:3000/`。按钮、F2 入口、F5 和 Esc 都实际操作；全程同一网址，无导航或页面重建。编辑区块后多次往返，选中状态仍为「已本地调整」，城市仍可见；普通模式只保留右上角入口，启动设置和乘客控件在调试中隐藏，退出恢复。

行驶中进入时读数为 133.2 m，间隔操作后仍为 133.2 m、实测 0.0 m/s；退出继续到 450.6 m、87 km/h。手动暂停后再次切换，返回仍显示「Resume journey」与「Journey paused」。计时前后画面为 44:11 / 44:09，包含截图和退出后正常行驶的约两秒，调试操作期间不计入旅程。地形滑块聚焦时 F5 同样能退出。

最终构建、定向 ESLint、12 项已有相机/旅程回归检查通过。控制台没有 error，有既有启动纹理警告 `Texture marked for update but no image data found`；大 bundle 构建提示保留。端口 3000 由后台进程维持。

截图存于本机 `/Users/ruyyi/.codex/visualizations/2026/10/09/01a11ed2-069d-7460-8739-a3fe2f67fe05/mode-switch/`：`06-normal-mode.jpg` 为返回列车，`07-debug-mode.jpg` 为同一旅程的编辑模式，`04-before-debug-clock.jpg` / `05-after-debug-clock.jpg` 为计时对照。01 为较早操作的即时截图，工具栏捕获不完整；最终画面以 06、07 为准。

当前修改仍为页面会话内保存；没有验证移动触屏、刷新持久化或长时间 GPU 稳定性。自由镜头继续使用上一轮九区块俯视导航；本次没有实现下车步行或 GTA 式人物控制。未提交、未推送项目修改，保留工作区原有无关改动。
