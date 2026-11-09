# 全国铁路扩展前置评审

核查日期：2026-11-09。已只读检查当前 `Home.tsx`、`engine/audio.ts`、完整 `ThreeCanvas.tsx`、`RealWorld.ts`，并追踪 Renderer、GeoInspector、DebugMode、背景覆盖材质。未启动浏览器、GPU 或音频，未运行构建、部署；本次仅新增本文。以下为源码事实和实施建议，不是新实现验收通过的声明。

## 1. 首要条件：测试零音频上下文，产品默认静音

**当前版本不满足。** `Home.tsx` 的 `soundRef` 与 `sound` 初始值均为 true，`startJourney()` 点击 Board train 后会创建 `TrainAudio` 并调用 `start()`；设置页没有可在上车前操作的静音按钮。`toggleSound()` 是第二条创建路径。静态导入类本身不创建音频上下文。

`audio.ts: start()` 立即 `new AudioContext()`、创建并启动音源、调用 `resume()`，master 在 1.1 秒内升至 0.46。暂停或地图检查只 `setMotion({speedRatio:0,...})`，而静止 rollingGain 仍为 0.015；`stop()` 是渐出并延迟 900ms 关闭上下文。因此暂停、事后静音、master 初始为零、浏览器自动播放限制都不是“零上下文/绝不出声”的保障。

实施顺序建议：

1. 产品的 React 状态与 ref 同时默认 false；进入页面、开始行驶、恢复行驶、换路线、再次上车、GPU ready 回调都不能隐式开启声音。只由明确 Enable sound 手势启用。HUD 图标必须与真实状态一致。
2. 在 `TrainAudio.start()` 创建上下文之前加统一 hard-mute 开关；自动化模式始终返回，不能先构造再 suspend/设 gain。测试 URL（如拟新增 `silent=1`）必须真正传入音频策略，当前源码没有此参数，不能只往 URL 拼参数就宣称静音。测试锁存在时即使误点 Enable sound 也不能创建上下文。
3. 用同一音频工厂覆盖两条创建路径，避免 React state updater 内创建/启动音频等副作用。组件卸载、路线切换和结束均释放旧音频；本版卸载 effect 只取消 departure scheduler，缺少统一音频清理。
4. 在浏览器导航前安装测试守卫：替换 `AudioContext`、`webkitAudioContext`、`OfflineAudioContext`（含存在的别名）为记录 attempt 后抛错的构造器，绝不调用原构造器；守卫持久计数并在每个检查点断言零。拦截 `HTMLMediaElement.play()` 并记录尝试，避免未来媒体音频绕过 Web Audio。不要只监听 `console` 或只统计成功创建次数。
5. 独立浏览器进程加 `--mute-audio` 作为第二层保险，不能代替构造守卫或作为零上下文证据。禁止音频试听、测试提示音及系统音量操作。所有页面/弹出页在导航前安装守卫；不复用可能已经有声音的旧页。

静音验收矩阵：首次 setup → Board train → 等 ready → 行驶 → 暂停/恢复 → F5/地图/返回 → 结束/再上车 → 路线切换 → 重载，全部 attempt=0；hard-mute 模式下也覆盖音量按钮。检查出构造或播放尝试即判失败，不能吞异常后记为成功。浏览器本身静音与应用默认静音分别留证。本评审没有执行这些步骤。

## 2. 现有准备门控与调试验收入口

### 已有机制（源码事实）

- `ThreeCanvas.tsx`：loading → preparing → gpu → ready/error。`world.ready` 表示首批 CPU 地块和资源准备完成；随后 warmup，`markGpuChunks()`，才设置 `worldReady/presentable` 并允许 pending departure。
- `core/Renderer.ts`：`compileAsync` 后对真实对象做 16×16 离屏提交，观察 attribute 上传版本，并以 WebGL2 fence 等待 GPU 完成；不用 `gl.finish()`。初始上传与后续 preload 期间保留上一画面，`render()` 返回 false，不能把这类 RAF 当实际新画面提交。
- `RealWorld.ts`：当前视野 7×7 个 256m tile，向前预建 1536m；CPU 创建按每 RAF 约 8ms 的循环预算，单块本身仍可能超预算。缓存目标 256，required 与 GPU preparing 地块不会被随意逐出，因此不是任何情况下都严格 ≤256。`canAdvance(nextS,currentS)` 检查沿弯曲路线经过的覆盖区域，未 GPU ready 则运动等待。
- 初始 `initialReadyProof` 是 warmup 后、出发前的不可变快照。后续 `pendingGpu>0` 可来自前方预取，不能据此推翻初始 ready，也不能拿“曾经 ready”代替当前覆盖检查。
- Home 发 `chill:preparation` 事件，含实际 focus/segment 时钟；顶层 DOM 有 `data-world-presentable`、`data-focus-elapsed-seconds`、`data-segment-elapsed-seconds`。事件仅是观察证据，不授予 readiness，也不应通过伪造事件推动应用。
- `Renderer.info.autoReset=false`，正常外景与车厢双 pass 前只 reset 一次，可合计调用数；性能诊断区分 submitted/deferred frames、held、lastSubmittedAt。RAF/CPU 提交/等待时间均不是 GPU 帧耗时。

### 无需新增测试后门的驱动步骤

先安装上述静音守卫，再导航 `/?routeMetres=2790` 或 `/?debugTerrain&routeMetres=7393.844`。`routeMetres` 当前通过 Number+clamp 处理，仍应补非有限数回退，避免 NaN。

1. 在导航前注册 `chill:preparation` 记录器，保留 loading/preparing/gpu/ready 时间线；点击 Board train 可验证准备期间时钟不前进。等待真实 `presentable`，不能用固定 sleep 或仅看模型请求结束替代。
2. 从 aria-label 为“地理区块流式加载诊断”的 output 读取 `data-initial-gpu-phase/sequence/completed`、`data-initial-ready-tiles/total-tiles/pending-gpu`、`data-preparation-phase/presentable`。Hudson 初始 proof 应完成 GPU 批次、phase idle 且 readyTiles=totalTiles；要求随后有真实画面提交，不能只停在元数据。
3. F5 或“俯视地图”进入检查；“真实路线地标”选择 2790 / 7393.844 / 21083.216m 后只是 recenter/预览，必须再点“列车跳到这个位置”才改变列车。跳转本身等 canAdvance，不能断言点击后立即到位。
4. 通过“真实地理地表/林木/草灌木/村屋/道路/水域/站台”逐层隔离；“地理检查时段/天气”分别测昼夜、晴雨。F2 检查车厢 shell/seats/fixtures/glass/lighting/hud；F3 显示性能；F6 只隐藏外景，不代表资源释放。
5. 地图原生拖动/滚轮/点击后读取“地图检查位置”的 revision、renderedRevision、camera/quaternion/distance；只有 renderedRevision 追上变化，才证明提交过对应地图画面。随后 Esc 返回车窗，检查列车位置/覆盖/时钟一致。
6. 连续跨多个 tile 验证 `visibleMissing`、`suddenAppearanceFrames`、运动覆盖门控、submitted/deferred 增量、缓存与实例/纹理数量；反向远跳再返回，验证释放和稳定 seed。按固定设备、物理分辨率、速度、时段与天气留截图/JSON，不把快速暂停截图当连续行驶验收。

准备边界：初始 `warmup(scene.scene,...,world.group)` 针对外景，`interiorScene` 没有参加这次预热。因此当前 proof 不能称作“车厢全部 shader/首个最终画面已预热”；以首次真实双 pass 提交与截图补充证据。资源/上传错误应保持不可呈现、时钟停止，错误文案可见。

## 3. 适合从 Slop 借鉴的两个小改进

来源为 [mrdoob/slop-newyork 固定提交](https://github.com/mrdoob/slop-newyork/tree/536a907c605964421563f12f15c5e00d735fc94f)，并核查现有 `/tmp/slop-newyork-review` 副本。参考背景见另一原型的 `docs/SLOP-NEW-YORK.md`。以下只是迁移建议，尚未实施、未测性能；不复制曼哈顿布局、数据或整套 TSL 后端。

### A. 车窗附近的有限细节池

[buildings.js:690](https://github.com/mrdoob/slop-newyork/blob/536a907c605964421563f12f15c5e00d735fc94f/js/buildings.js#L690) 在相机移动超过 18m 后，查邻近建筑、按距离优先填有上限的附件实例池，并只上传 active prefix；这不是全城主体模型流式重建。

建议用于 NetworkRide 的少量岩石、灌木、铁路旁通用细节，而非先迁消防梯/招牌/交通。主体地形与树群保持稳定；新建 2–3 个共享几何/材质的固定容量 `InstancedMesh`，按路线 cell+固定 seed 产生候选，优先车窗可见侧和前方，位移达到阈值才重选；`count` 控制活跃实例，使用 updateRanges 上传实际前缀。池满丢远处细节，不能扩容成无限场景。

候选不得占轨道净空、建筑或真实水域；Hudson 复用 `plantable()`/真实 mask，NetworkRide 没有 GIS 的排除区必须标成程序化规则。清理实例网格但不要逐池误释放共享 geometry/material；修改实例缓冲版本后，现有 `preparedInstanceBufferVersion` 失效，需加入 preload/fence gate 再可见，不能绕过 GPU readiness。

验收：先加细节开关和 capacity/active/更新次数诊断，再查慢速与高速侧窗、跨 cell、远跳返回；总容量不增长、seed不漂移、暂停无重选、近景不突现。先设小容量验证，不照搬 Slop 的 560m 半径或 18m 阈值。

### B. 保持真实轮廓的双尺度轻量水面

[tsl-materials.js:2894](https://github.com/mrdoob/slop-newyork/blob/536a907c605964421563f12f15c5e00d735fc94f/js/tsl-materials.js#L2894) 用不同尺度/方向波纹与 Fresnel 改善水面；原实现为 NodeMaterial/TSL，不能直接粘进本项目经典 WebGLRenderer。当前 `RealWorld.buildWater()` 只为源多边形创建静态标准材质，保留 holes，适合作小范围升级。

先保持原多边形、水高、岸线 mask 与不透明深度语义，只给共享 `MeshStandardMaterial` 加两组不同方向/比例的平移 normal 扰动与轻量边缘反光；使用 `onBeforeCompile` 和固定 program cache key，共享时间/天气 uniforms，不新增镜面反射 framebuffer、不实时折射、不修改世界水域轮廓。动画时间由现有 elapsed 控制，暂停冻结。Hudson 水面仍是 GIS 轮廓；NetworkRide 只有生成水体时必须明确“生成景观”，不能从铁路中心线推断真实河流位置。

验收：同一水岸在昼/暮/夜、晴/雨与玻璃开关下对比；水域关闭后不残留额外 pass；洞内岛屿仍可见，水岸不漂移，draw calls/材质数不随行驶增长。现有背景通过 `GeoDetailCoverage` 在 GPU ready 后逐片替换，64m/8m边缘未做几何吸附；发现岸边/地形裂缝时先修过渡，不能用加深水色或扩水面遮盖。

## 4. 全国模式接入边界

NetworkRide 与 Hudson RealWorld 应保留明确模式边界：全国真实线路中心线负责路线姿态和里程，地形/植被/水面是生成解释、无 DEM；Hudson 继续加载完整 GIS，不能默默退回生成地形。全国数据是否包含连通拓扑、客运属性与许可由数据任务核实，不能把铁路中心线直接称作可订票客运线路或时刻表。

全国经纬度跨度远大于 Hudson，不能复用单个 Hudson 投影原点形成巨大全局 Float32 坐标；按沿线路段使用局部坐标/统一 rebase，routeId+沿线里程决定固定 seed，几何/相机/光照/水波同时变换。路线切换撤销旧异步任务并释放世界资源；新路径自建 GPU preparation proof，不能借 Hudson 的 49 tiles、源 DEM/OSM站台标签充当全国准备证据。

当前 ThreeCanvas 的 HUD、路线标签、站台逻辑与构造均硬编码 Hudson；新增模式需要显式派发，连同来源文案、ready语义和 debug入口一起改。不建议通过 monkey-patch GeoData/伪造 GPU proof 复用。后续实施完成再做独立审查；本文不批准或执行部署。
