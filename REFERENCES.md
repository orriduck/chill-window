# 视觉参考

| 来源 | 借鉴内容 | 关联实现 |
| --- | --- | --- |
| [Slow Roads](https://slowroads.io/) | 低频斑驳草地色彩、路旁木栅栏与自然植被的层次感。 | `app/src/engine/three/terrain/TerrainLOD.ts`、`app/src/engine/three/track/LinesideProps.ts` |
| [Cortiz Dev: stylized-components](https://github.com/cortiz2894/stylized-components)；[配套草地视频](https://www.youtube.com/watch?v=Pqyu7-DDmOM) | 借鉴可迁移的实例化草地思路：贴地覆盖须避开轨道、道路、水体与聚落等工程净空；草叶根部固定，以 GPU 顶点风摆动；保留远近 LOD。没有引入 React Three Fiber、GLB 依赖、逐草阴影或新运行时贴图。决策记录见 [#163](https://github.com/orriduck/chill-window/issues/163)。 | `app/src/engine/three/terrain/TerrainLOD.ts`、`app/src/engine/three/terrain/VegetationWind.ts` |
| [City Tour](https://github.com/jstrait/city-tour) | Three.js 中将程序化世界蓝图转成可视城镇的组织方式；借鉴世界生成与渲染的职责划分，不照搬其城市题材或相机交互。 | 后续场景与城镇生成工作。 |
| [VVVFSimulator](https://github.com/datacrystals/VVVFSimulator) | 以速度、加速度和制动状态驱动牵引/制动音色的配置模型；用于深化列车运行声音。 | `app/src/engine/audio.ts` |

## 中国列车车厢与窗景：藻蝦 AmanoShrimp

将 [藻蝦 AmanoShrimp](https://www.youtube.com/@Amanoshrimp0212) 的 [Railway Vlogs Made by Shrimp](https://www.youtube.com/playlist?list=PLA1MFSalYFoNJE5nNhspDNL8NGw2eAcTh) 作为中国列车车内、车窗和沿线景观的主要视频参考库。以下观察于 2026-08-22 核查；它们是设计证据，不代表要复刻某一列具体车型或其品牌装饰。

| 来源与时间戳 | 可直接观察的内容 | 设计借鉴 | 关联实现 |
| --- | --- | --- | --- |
| [上海南—武昌 Z27 次 25T 硬卧](https://www.youtube.com/watch?v=6sTTPDwC-k0)：[06:03–08:47](https://www.youtube.com/watch?v=6sTTPDwC-k0&t=363s)、[18:03–18:20](https://www.youtube.com/watch?v=6sTTPDwC-k0&t=1083s) | 普通长途硬卧采用半开放六铺单元：窗口两侧各三层铺，铺位向车厢内延伸；浅灰/米色隔板、酒红铺垫边、白色卧具、浅色金属护栏与攀爬踏板围绕窗下小桌组织。窗侧有铺位灯、开关/插座和传统布帘；视频也直接说明卷帘挂钩可能影响舒适，传统窗帘更合适。 | 第一套车厢以普通长途开放硬卧为原型，不混入豪华动卧包厢：保留六铺节奏、紧凑小窗、实用五金、传统窗帘、浅色车体与克制暖光；固定乘客眼位先验证空间压迫感和窗景取景。 | `app/src/engine/three/interior/WindowFrame.ts` 的六铺、桌面、窗帘、设备与照明；`app/src/engine/three/core/DebugMode.ts`、`app/src/engine/three/ThreeCanvas.tsx` 的车厢隔离检查入口。 |
| [CR400AF-AE 复兴号豪华动卧](https://www.youtube.com/watch?v=bYJ4YAdpTug&t=180s)：[03:00–07:13](https://www.youtube.com/watch?v=bYJ4YAdpTug&t=180s)、[19:36–19:47](https://www.youtube.com/watch?v=bYJ4YAdpTug&t=1176s) | 暖色间接照明、米白与浅棕软包、紧凑包厢窗、宽铺位、大桌面、每铺独立阅读灯/氛围灯/电源，以及完全遮光的窗帘。 | 车厢夜景应由局部照明和浅色大面共同塑形；卧铺应作为独立空间原型，不把普通座席简单拉长当床。 | 计划中的 `interior/layouts/SleeperCompartment`、`interior/lighting/` 与窗帘状态。 |
| [星光燕赵号旅游列车](https://www.youtube.com/watch?v=KfIUlWmXkWw)：[01:23–02:19](https://www.youtube.com/watch?v=KfIUlWmXkWw&t=83s)、[03:54–06:02](https://www.youtube.com/watch?v=KfIUlWmXkWw&t=234s)、[09:32–11:38](https://www.youtube.com/watch?v=KfIUlWmXkWw&t=572s)、[16:42–16:50](https://www.youtube.com/watch?v=KfIUlWmXkWw&t=1002s) | 展望车用车尾大窗、两侧大窗和局部弧形天窗形成连续观景面；座席车同时存在四人卡座和面窗吧台座。内饰以高明度墙顶、暖木地板、蓝/橙皮座椅、窗间壁灯和连续小射灯组织层次，日光可大面积进入车厢。 | 现代中国观景软座作为硬卧之后的独立原型：真实座椅尺度、清楚的窗间柱、可用桌面与电源、明亮墙顶和克制的暖光；展望车仍保留为另一套独立原型。 | 计划中的 `interior/layouts/ObservationSoftSeat`、`CarriageShell`、`WindowModule` 与后续 Debug Mode 车厢选择器。 |
| [西子号一等软座](https://www.youtube.com/watch?v=EVMC407ewY4)：[04:22–05:07](https://www.youtube.com/watch?v=EVMC407ewY4&t=262s) | 传统客车采用厚实浅色窗墙、深色窗胶条、圆角矩形大窗、紫色高背座椅、窗边面对面座席与大桌面；窗上方保留机械风口/灯具和帘轨。 | 普通中国客车的可信感来自窗墙厚度、座椅与窗的对应关系、桌面使用尺度和可见五金，而不是增加装饰物。该视频无可用字幕，这一条仅记录画面观察。 | 后续软座原型的尺度基线、窗台/帘轨/风口细节与材质对照。 |
| [7000 公里横贯中国导演剪辑版](https://www.youtube.com/watch?v=tu-So4CfDoc)：[06:42 东北农田](https://www.youtube.com/watch?v=tu-So4CfDoc&t=402s)、[30:44 锡林郭勒草原](https://www.youtube.com/watch?v=tu-So4CfDoc&t=1844s)、[1:06:06 高原草甸与雪山](https://www.youtube.com/watch?v=tu-So4CfDoc&t=3966s)、[1:15:25 河西走廊灰色荒漠](https://www.youtube.com/watch?v=tu-So4CfDoc&t=4525s)、[1:23:39 南疆防风林与棉田](https://www.youtube.com/watch?v=tu-So4CfDoc&t=5019s) | 窗景并非纯自然背景：近景植被和路基高速掠过，中景农田/牧场/荒漠形成大色块，远景以林带、缓丘或雪山定轮廓；接触网、电线、栅栏、平行线路、道路和防风林持续提供速度与地域尺度。南疆片段还同时显示真实窗框、帘布和玻璃雾化/反射。 | 将路线拆成可辨识的中国窗景切片；每段同时定义地貌、农业/植被、铁路工程、远景轮廓、空气颜色和近中远三层运动频率，避免只换地表颜色。 | `app/src/engine/three/terrain/RouteFeatures.ts`、`TerrainLOD.ts`、`track/LinesideProps.ts`、`interior/WindowFrame.ts` 的后续拆分模块。 |

新增图片、卫星图或视频时，补充原始 URL、视频时间戳（如适用）、可观察的具体细节，以及落地的文件路径。


## 2026-09-04 当前方向：坐席车厢与窗景

本次用户明确选择坐席列车，覆盖 2026-08-22 的硬卧优先决定。前面的卧铺参考保留为研究历史，不再作为当前默认车厢验收标准。

| 来源 / 核查 | 观察与采用内容 | 实现与素材来源 |
| --- | --- | --- |
| [TravelChinaGuide 软座实景照片](https://www.travelchinaguide.com/images/photogallery/2013/soft-seats.jpg)，[原说明页](https://www.travelchinaguide.com/china-trains/hard-seat.htm)；2026-09-04 在浏览器查看原图 | 照片可见双人高背座椅、白色头枕套、扶手、米色窗帘、窗顶连续金属行李架、浅色墙顶；说明页介绍面对面座席与桌面。本实现采用这些结构线索，绿色织物和木色桌面是设计选择，不声称复刻特定车型。 | `interior/SoftSeatCoach.ts`、`interior/WindowFrame.ts`。照片只作参考，未复制进运行时；坐席几何与织物、亚麻、木纹 CanvasTexture 本地生成。 |
| 上表[西子号 04:22–05:07](https://www.youtube.com/watch?v=EVMC407ewY4&t=262s)；沿用 2026-08-22 已归档画面观察，本次未重新播放视频 | 窗墙厚度、圆角胶条窗、面对面座席与桌面对应关系。 | `SoftSeatCoach.ts`、`WindowFrame.ts`；替代六铺、卧具、爬梯。 |
| 上表[横贯中国 06:42 东北农田](https://www.youtube.com/watch?v=tu-So4CfDoc&t=402s)、[1:23:39 防风林与棉田](https://www.youtube.com/watch?v=tu-So4CfDoc&t=5019s)；沿用已归档观察 | 近景路基/栅栏快、中景成片农田、远景山体慢；植物应留在田埂和林地，避免一层随机草木覆盖所有地貌。 | `FieldLayout.ts`、`FieldPlots.ts`、`TerrainLOD.ts`、`DistantHills.ts`、`LinesideProps.ts`。农田 CanvasTexture 和远丘几何本地生成；树冠复用仓库已有树木图集，无新增外部图集下载。 |
| [Longji rice terrace / Unsplash](https://unsplash.com/photos/a-lush-green-field-with-mountains-in-the-background-hig0wfBrfdc)，2026-09-04 检索页说明；未下载或逐图核验 | 辅助检索地块与远山层次。具体实现以以上已归档铁路画面为主要依据；本轮没有实现真实梯田或复制地理路线。 | 检索线索，不作为独立视觉验收证据或运行时资产。 |

本次视觉结果与未检查范围见 [2026-09-04 视觉记录](docs/visual-checks/2026-09-04/README.md)。

### 靠窗眼位调整

本次沿用上述软座实景与西子号已归档观察中的“座椅与窗对应、桌面位于身侧”的空间关系，具体近窗构图由用户当次反馈及本地几何校准，不新增或声称测得真实车型尺寸。实现为 `core/PassengerView.ts`、`Camera.ts` 和 `interior/WindowFrame.ts` 的统一眼位；F2 可对比原走道视角。[同场景对照记录](docs/visual-checks/2026-09-04/README.md)。
