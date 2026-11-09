# NetworkWorld 设计与实施记录

全国模式使用一条真实 LineString component 的经纬度折线，按球面段长累计里程、双精度采样位置；不拼接 MultiLineString 的断开分量。铁路平面走向来自该折线，地形、轨面高程、树木、聚落、水面均为固定 seed 的程序化解释，没有 DEM，不是实测景观。

独立类 `app/src/engine/network/NetworkWorld.ts` 按约定提供暂停、速度、跳转、俯瞰、图层与释放接口；默认暂停、60km/h，无任何音频依赖。路线数学放在 `NetworkRoute.ts`，便于不启动浏览器的 CPU 校验。UI、Hudson 与既有 renderer 均不修改。

采用沿线 256m 地块：共享确定性高度函数与边界采样，轨道 ribbon 跟随折线；近景植被使用有限实例批次、分层树冠与树干，聚落用墙体与坡屋顶，山坡采用多尺度连续高度和顶点色。woodland/desert/coast/alpine 使用不同调色板、植被密度与地形轮廓，属于生成景观。地块几何以各自经纬度锚点为局部原点，相机每跨地块重设附近坐标基准，避免全国大坐标进入 GPU。

保留当前周围有限地块并向前预取，地块不按路线总长增长。资源在首次可呈现帧之前就绪；后续边界补块发生在同步 render 前，ready 仅表示真实首帧已提交，不冒用 Hudson 的 DEM/49块/fence 证明。固定晴天暖光，不新增外部纹理下载、反射 framebuffer 或音频。

ResizeObserver 同步布局尺寸，visibilitychange 重置时间基准，隐藏页面不推进旅程。telemetry 约250ms更新，含里程/经纬度/速度/暂停/ready/tiles/绘制数/三角数/RAF间隔。正向行驶到component终点停止；seek 拒绝非有限数并限制到端点，速度限制到合理范围。dispose 取消RAF、解绑监听/observer、释放实例缓冲、私有几何、共享几何材质与renderer，不破坏其他页面资源。

验证范围：本任务不启动浏览器、GPU、音频或部署。先对 CPU 路线数学做有限输入、端点、重复点、反经线测试；实现后做范围内 TypeScript 校验，浏览器视觉、交互、实际性能与 GPU 释放由主代理后续验收。本文件末尾会追加实际结果。

## 实施与交付

已实现 `NetworkWorld.ts`、`NetworkRoute.ts` 及两份 Network 前缀 CPU 测试，未修改 Home、App、UI 或 Hudson 文件。

- `NetworkWorld(container, coordinates, profile, onTelemetry)`，公开方法与分工接口一致；额外导出 `NetworkProfile`、`NetworkTelemetry`，后者可选 `error` 表示渲染/上下文故障。默认暂停、60km/h；speed 输入限制0–180，seek拒绝非有限值并限制端点。
- 路线保留全部原始折线顶点，再加16m采样，不以稀疏规则采样跨过源拐点；累计里程为球面段长，经纬度沿源段插值。每次只接受一个component。
- 每块256m，左右各1400m生成走廊；缓存根据宽屏FOV保留前后各6–8块，硬上限17块，仅近景有实例树冠、树干、岩石与少量坡屋顶村屋。植被和聚落排除本地前后约1km轨道走廊，远距离回绕的线路仍需后续检查。
- 局部缩放 Mercator 以双精度相减后进入GPU，tile锚点和视点锚点的比例一致，重定位时更新group平移及水平比例；相邻边界共用连续高度和有限差分法线，避免按块独立求法线形成接缝。coast默认朝生成水面一侧看，其他模式朝行进右侧看。
- 植被开关控制树干和树冠；岩石保持可见。building开关控制墙体与屋顶。overview暂时冻结行驶，返回后恢复原暂停状态；telemetry在overview时speedKmh为0。拖动改变侧窗视角、双击复位。
- ready仅在可见布局canvas的首次真实render返回后设置，绝不等同于GPU完成fence。隐藏页面不移动或渲染；上下文丢失/渲染异常暂停并报告ready=false/error，需重新打开路线，未实现上下文自动恢复。
- 单调RAF间隔作为frameMs，不冒充GPU时间；超长间隔的模拟步长封顶250ms，所以低帧率下实际行驶墙钟速度可能低于设定。没有加载外部音频、纹理或真实高程。

实际完成的校验：

```sh
cd app
./node_modules/.bin/vitest run src/engine/network/NetworkRoute.test.ts src/engine/network/NetworkWorld.test.ts --maxWorkers=1
./node_modules/.bin/tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM src/engine/network/NetworkWorld.ts src/engine/network/NetworkRoute.ts
```

8项CPU测试通过：距离/端点、重复点及无效输入、反经线及seek、源拐点与坐标变换可组合性，以及四种profile的有限几何/正向法线/相邻边界一致。相邻边界测试误差要求小于1mm。几何测试绕过类构造函数，只生成CPU BufferGeometry，不创建DOM、WebGL或音频上下文。独立strict类型检查通过；这不是整站构建或浏览器验收。

已知限制：没有真实DEM、建筑/水域GIS、车厢双pass、纹理叶卡、反射或GPU预热门控。近景地块同步生成，首帧及seek可能产生CPU尖峰，实际视觉和硬件性能未测；走廊转急弯可能自交，空间上相近但沿线超过本地排除窗口的回绕轨道仍可能被生成物靠近。细节与美术质量应由主代理在静音守卫下检查；不能据源码和CPU测试宣称画面明显优于某旧版本。

## 最终交接与 NetworkRide 只读检查

**实现已停止改动，可验收。** `NetworkRoute.samples()` 现已在源码中完整实现；此前构建读到测试先落盘、方法尚未落盘的中间态。当前两份实现及两份测试一起执行独立 strict/noEmit TypeScript 检查通过，不再存在该方法缺失错误。最新定向 CPU 结果为2个测试文件、8项通过；未运行全套旧测试，也不把其他既有失败归因于本次实现。主代理可重新执行整站 build 和静音浏览器验收。

已只读检查 `app/src/rail/NetworkRide.tsx` 与 `App.tsx`：App 按 route.id 设置 key，返回 atlas 会卸载旅程；NetworkRide 在分量、风格、方向变化时清理旧 World，再创建新 World，cleanup 调用 dispose 并仅清理匹配的 ref。路线 fetch 使用 AbortController，加载与构造同步异常有可见错误和重试入口。组件重建会回到默认暂停/60km/h及开启图层，属于当前实际行为，不是无缝保留里程。

请主代理处理的集成风险（本次不修改 UI）：

1. **P1，首帧失败可能永久显示加载中。** NetworkRide 自定义 Telemetry 未声明可选 `error`，回调只在 `wasReady && !next.ready` 时显示错误。若第一帧 render 就失败，World 会发布 `{ready:false,error:...}`，但 wasReady 仍 false，UI 吞掉该错误，无法显示重试。应采用导出的 `NetworkTelemetry`，优先处理 `next.error`；已准备后丢上下文仍可保留通用回退文案。
2. **P2，异步旧结果/回调隔离。** fetch abort 后，若已经进入 JSON 解码/后处理，当前 then 没有检查 `abort.signal.aborted` 或 generation；建议在 setParts/setComponent 前及 telemetry 回调中检查当前 generation，避免快速重试或卸载边缘状态产生旧结果覆盖。正常 dispose 后 World 不继续报告，当前主体路径已有保护；这里是竞态防护建议，尚未故障注入。
3. **数据声明与静音验收。** 页面已说明“真实线路、生成景观、无实时班次承诺”；建议明确加入“无DEM，水面/轨面高程也是生成解释”。Home 现在 state/ref默认false，`silent.ts` 的 build flag 在 `TrainAudio.start()` 构造前返回，且 toggleSound也被锁住，源码已满足测试硬静音入口设计；实际仍需主代理以 `VITE_SILENT_PREVIEW=1` 构建并在导航前安装零上下文守卫，不以图标代替证据。

其余既有边界保持：NetworkWorld ready是首帧提交而非GPU fence，frameMs是RAF而非GPU耗时；急弯走廊自交、有限走廊末缘、生成物避让范围与同步补块尖峰需要浏览器检查。本次没有查看或认可主代理浏览器结果，未启动音频、GPU、浏览器或部署。

## 端点视觉缺口修复交接

已查看主代理提供的 `02-zephyr-window.png` 与 `07-coast-window.png`，确认起点地面沿画面中线中断。这是本次实际查看的失败截图，不代表修复后视觉已验收；此前“未查看浏览器结果”的范围声明以此更新。

最终实现只扩展生成景观：首块terrain沿起点切线延伸到 -5120m，末块terrain延伸到 length+5120m，距离为4800m雾远界外再留缓冲并按256m取整；不会修改真实路线长度、经纬度telemetry、seek或行驶终点。道床、两根钢轨、轨枕、聚落均仍限制在真实 `[0,length]`。地形延伸直接属于首末块外侧，不增加与近景重叠的大平面。近端512m保持16m采样，更远用128m行距。coast海面同样纵向延伸，横向6000m，以进入雾化地平线。

宽屏视野按 `HALF_WIDTH * tan(horizontalFov/2) + 256m` 估算需要的纵向覆盖，前后各保留6–8块，上限17块，与路线总长无关；1440/1000的窗口不再仅有后3块/768m。resize时即使暂停，也重算覆盖。极宽比例达到硬上限、任意大角度转头及急弯仍需主代理实景复核，不承诺无限地形。

修复后既有8项CPU测试通过；补充内存中CPU检查16种端点组合（四profile×正反方向×起终点），验证生成geometry/normal有限、terrain/water确实外延而轨道surface仍在真实界内。另以1.44/2.4/3.55宽高比、多里程与远跳检查缓存，观测最大17块。测试未创建renderer/DOM/Audio。strict TypeScript检查通过。

**端点修复实现已停止改动，可重新build和浏览器验收。** 请检查0m、真实终点、反向0m、近端跨tile及coast地平线；本次未启动浏览器/GPU，没有宣称修复后截图通过。
