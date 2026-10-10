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

## 2026-09-04 座椅比例、塘田地景与真实速度

| 来源与核查 | 可观察的内容及采用范围 | 关联代码 |
| --- | --- | --- |
| [FAO 湖州桑基鱼塘系统](https://www.fao.org/giahs/giahs-around-the-world/china-zhejiang-huzhou-system/en)，[页面原始航拍照片](https://www.fao.org/media/images/giahslibraries/giahs-sites/zhejiang-huzhou-mulberry-dyke---banner.jpg?sfvrsn=1a466b98_11)；本日读取说明并下载查看照片 | 水面低于塘埂；池塘由狭窄堤岸、树列与小路分隔；白墙灰屋顶的小院聚集在可达道路边。采用塘田、水渠、堤岸植被、小院的空间关系；当前仍为规则化程序地景，不是测绘重建，不声称列车经过这一遗产地。照片仅供研究，未作为运行时纹理。 | `FieldLayout.ts`、`FieldPlots.ts`、`WetlandDetails.ts`、`TerrainGen.ts`、`TerrainLOD.ts`、`DistantHills.ts` |
| [TravelChinaGuide 软座原图](https://www.travelchinaguide.com/images/photogallery/2013/soft-seats.jpg)；本日重新下载查看 | 坐垫具有完整可坐深度，座椅之间有可辨识扶手；椅背不应像窗墙上的窄竖板。结合用户截图加宽、加深坐垫，下调靠背高宽比，外移窗边座椅，露出窗侧扶手和独立底座；具体比例是设计校准，未称为真实车型测量值。 | `SoftSeatCoach.ts`、`WindowFrame.ts`、`PassengerView.ts` |

运动采用一场景单位一米，160 km/h = 44.444 m/s；原来 15 单位/秒仅相当于 54 km/h。沿线既有 50 米杆距可作通过频率标尺。F2 增加 0/54/80/160 比较与按浏览器实际时间、坐标差计算的读数；修正长旅程车站搜索范围及起停时间预算。这些是代码内物理换算，不是从视频猜测速度。

## 2026-10-09：连续地形、地理顺序与聚落尺度

本轮核查于 2026-10-09。技术参考查看官方文档与作者仓库；下面区分已采用机制和仅供后续选择的素材。不声称复刻真实路线。

| 来源 / 具体定位 | 观察与采用内容 | 关联实现 |
| --- | --- | --- |
| [City Tour 的世界生成源码](https://github.com/jstrait/city-tour/blob/master/src/generators/world_generator.js)，`generate` 中 terrain → neighborhoods → roadNetwork → zonedBlocks → buildings 的调用顺序 | 先生成统一世界数据，再依赖地形与道路安排街区和建筑。借鉴依赖顺序，未复制代码。城市核心用街网与地块组织，城区外围作为路线中的独立用地。 | `RouteFeatures.ts`、`Landscape.ts`、`CityDistrict.ts`、`TownGenerator.ts` |
| [THREE.Terrain 作者仓库](https://github.com/IceCreamYou/THREE.Terrain)，README 的 Dynamic Terrain Materials、ScatterMeshes / ScatterGrass 和 seeded randomness；[滤波源码](https://github.com/IceCreamYou/THREE.Terrain/blob/gh-pages/src/filters.js) | 借鉴按高度、坡度和空间权重混合材质，地表覆盖与坡度/用地共用约束。继续使用现有 simplex-noise 与地形网格；没有引入整个库。当前过渡直接混合两个地形的计算结果，而非改变噪声频率。 | `Landscape.ts`、`TerrainGen.ts`、`TerrainLOD.ts` |
| [Three.js InstancedMesh 官方文档](https://threejs.org/docs/pages/InstancedMesh.html)，setMatrixAt、setColorAt、computeBoundingSphere | 重复建筑共享几何与材质，通过实例矩阵、颜色表达位置与高度梯度。屋顶采用独立材质；避免每栋楼创建完整模型与独立贴图。 | `CityDistrict.ts` |
| [Slow Roads 作者案例（web.dev）](https://web.dev/case-studies/slow-roads)，程序化景观与几何细节章节；[原体验](https://slowroads.io/) | 借鉴行进中持续生成、远近景分工与克制的几何复杂度。原体验 URL 可达，网页没有提供可直接读出的引擎源码；不将第三方镜像当作者源码。 | `TerrainLOD.ts`、`DistantHills.ts`、`TerrainInspector.ts` |
| [NASA：成都城市扩展](https://science.nasa.gov/earth/earth-observatory/urban-growth-in-sichuan-china-4039/)，[Landsat 1990–2000 对比原图](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/4000/4039/chengdu_etm_1990-2000_lrg.jpg) | 本轮在浏览器查看图像：黄色城市核心与橙色外围扩展区并存，外围沿道路延伸，周边用地形成连续斑块。采用“乡村→小城→外围→核心→外围”的组织；卫星图不能证明单栋建筑立面或高度，因此立面仍为程序化占位。 | `RouteFeatures.ts`、`CityDistrict.ts` |
| [NASA MODIS：阿尔卑斯与波河平原，2019-06-07](https://modis.gsfc.nasa.gov/gallery/individual.php?db_date=2019-06-07) | 本轮核查页面文字说明：山脉环抱低地平原。采用山地经山麓过渡到低地的地理规则；未据此测量坡度或恢复 DEM。 | `RouteFeatures.ts`、`TerrainGen.ts` |
| 上文已留档的[藻蝦 7000 公里中国窗景](https://www.youtube.com/watch?v=tu-So4CfDoc&t=402s)，06:42 农田、30:44 草原、1:06:06 草甸与山体 | 沿用已有画面研究中“近景铁路/植被、中景成片用地、远景轮廓”的尺度划分，本轮没有重新逐帧观看，不新增视频观察结论。 | `TerrainLOD.ts`、`FieldPlots.ts`、`DistantHills.ts` |
| [Kenney City Kit (Suburban)](https://kenney.nl/assets/city-kit-suburban)，[Poly Haven 许可](https://polyhaven.com/license) | 素材调研候选，页面注明 CC0。可供下一轮房屋模块、地面 PBR 素材选择；本轮未下载、导入或声称已经应用。现有房屋仍含此前欧洲式工厂，需要继续做地域风格校准。 | 后续 `TownGenerator.ts` 与材质资产工作 |

上述代码路径均相对于 `app/src/engine/three/`（调试面板在 `core/`，其余在 `terrain/`）。本轮设计与实现顺序见 `docs/superpowers/specs/2026-10-09-continuous-landscape-design.md`、`docs/superpowers/plans/2026-10-09-continuous-landscape.md`。

## 2026-10-09：九区块俯视编辑

| 来源 / 核查 | 具体采用范围 | 关联实现 |
| --- | --- | --- |
| [Three.js OrbitControls 官方文档](https://threejs.org/docs/pages/OrbitControls.html)，本日读取 `target`、`mouseButtons`、缩放距离与俯仰限制、damping 的说明 | 独立地图相机，左键平移、滚轮缩放、右键旋转；限制距离和俯仰，回到列车时清除惯性。地图平移不改变列车坐标。 | `core/TerrainEditor.ts`、`ThreeCanvas.tsx` |
| [Cities: Skylines II 官方介绍](https://www.paradoxinteractive.com/games/cities-skylines-ii/about)，本日读取官方页面 | 用户明确提出城市天际线式俯视交互；采用俯视地表、直接选地块、选中后再显示设置的操作模型。没有逐帧研究游戏界面或复制其资产、尺寸及游戏机制。 | `core/TerrainInspector.ts`、`core/TerrainEditor.ts` |

地形与聚落素材继续沿用上节研究和现有模型。每块 256 米，编辑只作用于选中块；48 米边缘权重回到原地形。建筑与农田落在中央区域，避免占用过渡坡。当前调试改动保留在本次页面会话内，刷新恢复种子原始世界；不是 GIS 或完整城市规划模拟器。视觉记录见 [九区块编辑验收](docs/visual-checks/2026-10-09-chunk-editor/README.md)。

### 同世界切换（后续用户反馈）

用户提出 GTA 式自由切换的感觉，落实为游戏内模式切换：普通网址下按钮或 F5 进入独立九区块镜头，Esc 返回原列车，全程不导航。沿用上述 OrbitControls 与现有场景研究，没有增加或复制 GTA 游戏资产。`debugTerrain` 参数只用于初始模式；普通与调试共用同一个连续路线种子、地形编辑存储及列车状态。调试期间列车物理、旅程计时和环境时间暂停，用户原先手动暂停保持独立。

关联实现：`core/DebugMode.ts`、`core/TerrainInspector.ts`、`core/TerrainEditor.ts`、`ThreeCanvas.tsx`、`pages/Home.tsx`。计划及验收见 [模式切换记录](docs/superpowers/plans/2026-10-09-live-debug-switch.md)。

## 2026-10-09：单侧六区块、共享模型与更平滑的生成

这一节更新上文九区块/48 米边缘带的实现状态。现为单侧两列、前中后三排，共六个带模型的详细地块；自然编辑采用径向 C2 权重，地形与模型在地图和车窗共用。

| 一手来源与本轮定位 | 学到的机制 / 实际采用范围 | 关联代码 |
| --- | --- | --- |
| [Slow Roads 作者案例](https://web.dev/case-studies/slow-roads)，程序化几何、提前加载与细节分配章节 | 将详细生成限于移动走廊，外面保留低细节背景。采用六个详细地块和无模型的外围地形环；没有取得或复制 Slow Roads 引擎源码。 | `TerrainFootprint.ts`、`TerrainLOD.ts` |
| [ZyFou/ProceduralTerrains](https://github.com/ZyFou/ProceduralTerrains/tree/7452c2ce5dc598be020a44735d78e444ae0ed255)，本轮读取 `src/engine/terrain/terrainGLSL.js` 与 `surface/terrainSurfaceTextureGLSL.js` | 多尺度噪声、坐标扰动、缓和的 ridge、世界坐标三向材质投影。采用自有 CPU 地形、圆润山脊/径向编辑、世界坐标岩石三向投影，避免斜坡纹理拉长；没有移植其整套 GLSL 地形引擎。 | `TerrainGen.ts`、`TerrainEdits.ts`、`Landscape.ts`、`TerrainLOD.ts` |
| [dgreenheck/simcity-threejs-clone](https://github.com/dgreenheck/simcity-threejs-clone/tree/9116cf680f677c3476f8159d5bbc7a4cfda00654)，本轮读取 `src/scripts/assets/assetManager.js` 与 `sim/buildings/modules/roadAccess.js` | GLTF 目录一次加载、复用模型；建筑需要可达道路。采用本地模型缓存、实例绘制和朝街道布置的地块/入口，加地基坡度与干地约束。没有复制其城市模拟系统、界面或资产。 | `SceneryAssets.ts`、`PatchScenery.ts` |
| [jstrait/city-tour](https://github.com/jstrait/city-tour/tree/b1fa4701b424c3b1b47757c29c2e3df7b5709964)，本轮读取 `src/generators/terrain/terrain_generator.js` | terrain → erosion → river → normalize 分阶段整理地形。本项目借鉴“地形先行，模型依赖地形”的顺序；本轮没有实现其水力侵蚀或 diamond-square。 | `TerrainGen.ts`、`PatchScenery.ts` |
| [Kenney Nature Kit](https://kenney.nl/assets/nature-kit)、[Suburban](https://kenney.nl/assets/city-kit-suburban)、[Commercial](https://kenney.nl/assets/city-kit-commercial)，官方 ZIP 与原始许可 | 官方页面/包内许可为 CC0。本轮查看 Nature、Suburban 的 `Preview.png`：树种与岩石轮廓不同，住宅带屋顶、窗户和附属细节。导入共 16 个 GLB，保留各包许可、调色板路径与 SHA-256 清单；Commercial 的模型通过本地实际渲染检查。属于简化游戏素材，不声称为地方建筑复刻。 | `app/public/models/kenney/`、`SceneryAssets.ts`、`PatchScenery.ts` |
| 上文已留档的 [FAO 湖州塘田系统](https://www.fao.org/giahs/giahs-around-the-world/china-zhejiang-huzhou-system/en) 和铁路视频 | 沿用已归档的低地田块/水渠/道路及近中远景观察。本轮重新读取 FAO 文字；原始照片请求返回 403，因此不声称本轮重新查看照片或视频。农田采用成片分格、田垄与近景作物，具体尺寸为程序设计值。 | `PatchScenery.ts` |

代码路径除明确标注者外位于 `app/src/engine/three/terrain/`。调试先增加六区块范围、场景快捷入口与加载状态，随后才做模型/地形视觉检查。计划见 [六区块计划](docs/superpowers/plans/2026-10-09-six-chunks-and-scenery.md)，结果见 [实际视觉检查](docs/visual-checks/2026-10-09-six-chunks/README.md)。

## 2026-10-09：OSM + Amtrak + 高程数据的真实地图可行性

本节为数据可行性研究，尚未接入真实地图或真实车窗世界。核查于 2026-10-09。

| 一手来源 | 核查结果与拟采用范围 | 接入位置（拟） |
| --- | --- | --- |
| [Amtrak 官方路线目录](https://www.amtrak.com/train-routes) 与 [USDOT/FRA Amtrak Routes GIS](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0) | GIS 端点描述数据更新于 2026-05-12，支持 GeoJSON、坐标系 EPSG:4326、无 Z 高程。匿名实际查询返回 49 条路线；Empire Service 几何查询返回 288280 bytes、1 个 LineString，证明数据可以读取，不是从示意地图描线。目录/旧 XML 写着 2025-09-30，比实时服务元数据旧，接入时以实际抓取来源及日期留档。服务状态需另外核对官方站序/路线，不能把 GIS 快照当实时列车或时刻表。 | 新 GeoRoute 数据层；替换当前直线里程定位的来源 |
| [OSM 铁路文档](https://wiki.openstreetmap.org/wiki/Railways)、[Map Features](https://wiki.openstreetmap.org/wiki/Map_features)、[ele 说明](https://wiki.openstreetmap.org/wiki/Key:ele) | OSM 提供铁路、桥隧、道路、水域、建筑和用地等几何/标签；覆盖程度因地域和对象不同。ele 是部分地物的点高程，OSM 明确不作为完整高程数据库。拟用于真实地物范围与铁路工程标签，缺失的建筑高度/立面/植被细节仍程序补足。 | 地物布局、桥隧判定、模型布置 |
| [USGS 3DEP 产品说明](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) | 美国境内约 10m 的 1/3 arc-second 无缝 DEM 可提供山体/河谷地形骨架；地面采样间距不是垂直精度承诺。拟先裁剪小段铁路走廊、统一坐标/高程基准，再采样网格；桥面和隧道线路不能直接跟随裸地高程。尚未下载/验证某段 DEM。 | `TerrainGen.ts` 的真实高程 provider |
| [MapLibre 3D Terrain 官方示例](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/) | 官方示例通过 raster-dem 与 terrain.source 渲染地形，适合先做可缩放的真实路线俯视预览；本次只读示例，没有导入依赖、运行地图或验证第三方瓦片服务。 | 可选独立真实地图预览 |
| [OSM 许可与署名](https://www.openstreetmap.org/copyright) | OSM 数据按 ODbL 提供，地图须保留贡献者署名并按具体数据发布形式落实许可要求。原型也应保留来源，不把 OSM 栅格底图当可无限批量下载的数据服务。 | 地图归属信息、数据包 provenance |

接入顺序建议：真实路线折线/站序 → DEM 地形预览 → OSM 走廊地物 → Three.js 车窗。当前代码铁路为 x=0、沿 Z 行进，高程来自 `RouteProfile.ts` 正弦函数；真实路线需要按沿线累计里程求地理位置与方向，地图与车窗共用该位置。现有六区块可作为局部详细渲染预算，需调整世界坐标与选区，不能仅替换地形噪声。第一段可选择 Empire Service 的纽约—Albany 走廊中的小范围，具体路线/预览或直接车窗接入待用户选择。

## 2026-10-09：真实 Hudson 车窗样板（已接入）

本节更新上节的可行性状态：已将 Empire Service 北纬 41.44–41.27 的约 22.84 km 南行样板直接接入 Three.js，地图与车窗共用真实数据。原程序世界另可切换。核查日期 2026-10-09。

| 一手来源 / 本次查看内容 | 具体采用范围 | 关联实现 |
| --- | --- | --- |
| [FRA/BTS NTAD Amtrak Routes](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0)，实时端点元数据及 Empire Service GeoJSON 原始响应 | 使用服务折线的 443 个点，北向南裁剪后累计 22,837.38 m；按里程插值位置和切线。不是从路线宣传图描线，也不表示实时运营或时刻表。 | `app/scripts/prepare-hudson.py`、`geography/GeoData.ts`、`ThreeCanvas.tsx` |
| [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)，F32 exportImage 实际 TIFF、元数据及全像素对比 | 本地 961 × 1169 高程网格，约 20m 地面采样；详细和远处网格均使用该 DEM。20m 是重采样间距，不是原始传感器分辨率或垂直精度。裸地不等于轨面；桥隧以相邻非工程锚点估计高程，限制纵坡。 | `GeoData.ts`、`RealWorld.ts`；原始 TIFF、导出请求和校验记录在 `app/public/geodata/hudson/` |
| [OSM Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)、[Map Features](https://wiki.openstreetmap.org/wiki/Map_features) 与本次实际要素响应 | 河岸、水域、岛屿、林地、农田、道路、建筑 footprint、铁路桥隧标签。水域保留 47 个内环；用 OSM mask 避免低细节山体三角形穿过真实水面。树种/树高/建筑缺失高度、桥面/隧壁、水位均是明示的可视化近似。 | `GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts` |
| [NYS Parks Hudson Highlands 北区步道地图](https://parks.ny.gov/sites/default/files/HudsonHighlandsTrailMapNorth.pdf)，本日下载并渲染查看单页，图注制作日期 2025-09-11；[公园说明](https://parks.ny.gov/visit/state-parks/hudson-highlands-state-park-preserve) | 地图可见 Cold Spring / Beacon 河岸狭长低地、紧邻的密集山体等高线、城镇道路和大片高地保护区。用作区域地形/用地关系核对；北区地图并不覆盖整个样板南段，没有把步道路线当铁路数据。 | `RealWorld.ts` 真实高程与土地分类、`GeoData.ts` 样板选段 |
| [NPS：11_13 Train view.jpg](https://www.nps.gov/media/photo/gallery-item.htm?gid=BE181FF0-E399-4D9A-9242-0C7623C3ABEF&id=27d155cd-5c99-47ce-a1dc-930e7443cd44)，署名 NPS/Elizabeth LaRochelle；本日在 Chrome 查看原画面 | 宽阔水面位于车窗近中景，对岸丘陵构成较低地平线，窗框形成边缘遮挡；雨后玻璃有水滴。只借鉴沿河列车构图，不声称此照片拍摄于样板某一里程，不作为运行时纹理。 | `RealWorld.ts` 河岸与远景、`ThreeCanvas.tsx` 侧窗朝西 |
| [OpenStreetMap 许可/署名](https://www.openstreetmap.org/copyright) | 真实世界常驻 OSM 贡献者署名，检查面板附 FRA/USGS/OSM 链接。本地包保留许可、原始来源与时间、原始响应、SHA-256、精确请求及派生处理说明。 | `GeoInspector.ts`、`app/public/geodata/hudson/README.md`、`manifest.json` |

代码 `GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts` 位于 `app/src/engine/three/geography/`。数据包按阶段验证后发布，失败保留上一份有效快照；缓存要求请求身份和 checksum 一致，允许合法 fallback 来源完整离线重放。当前低细节林冠、建筑体块与桥隧工程是简化表达，未重建真实立面、车站、信号设备或完整 Amtrak 全国路线。

## 2026-10-09：真实建筑数据与开源转换器调查（云端接续）

核查日期 2026-10-09。下列是已读取官方文档/作者仓库的候选，尚未集成其代码或模型。

| 来源 | 核查与用途 | 接续位置 |
| --- | --- | --- |
| [OSM2World 源码](https://github.com/tordanik/OSM2World)、[官方 Web library](https://osm2world.org/docs/library-web/) | 专用 OSM→3D converter，仓库 MIT；Web模块输出位置、法线、索引、材质网格，可接 Three.js。官方提示客户端转换适合较小数据集，样式资源建议自己托管。优先评估离线区域转换/按块GLB，而非重写整套道路和屋顶逻辑。 | geography 数据与模型管线 |
| [Blosm 文档/源码](https://github.com/vvoovv/blosm/wiki/Documentation) | Blender 插件支持 OSM 建筑part、楼高/层数、多种屋顶、水域、道路/铁路与真实地形；文档注明缺失墙/屋顶材料使用默认材料，不能当真实立面数据。GPL 插件适合离线转换评估。 | 离线模型资产管线候选 |
| [Three-geo-play](https://github.com/lorenzoMezza/Three-geo-play)、[Geo-three](https://github.com/tentone/geo-three) | 前者是 Three.js 矢量瓦片几何方案候选，仓库 MIT；后者强调真实高程瓦片/地图provider与LOD，并不自行补齐真实建筑属性。当前没有导入依赖或验证样板效果。 | 真实瓦片流式加载候选 |
| [Overture building schema](https://docs.overturemaps.org/schema/reference/buildings/building/)、[building guide](https://docs.overturemaps.org/guides/buildings/)、[Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/) | schema提供height、num_floors、roof_shape/height/direction、facade属性及sources，字段可为空；building_part可表述复杂建筑。优先OSM几何、合并匹配高度；官方匹配IoU>0.5。STAC实际读到latest=2026-09-23.1；后续实际下载与去重结果见下面的建筑数据节。 | 云端建筑扩充与来源标注 |
| [Microsoft GlobalMLBuildingFootprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | 影像提取轮廓与模型估计高度，缺失高度为-1。可作数据候选，不能把预测高度称作测量值。NYS LiDAR可进一步研究，但本轮未取得建筑级点云高度。 | 真实建筑覆盖候选 |

直接案例 [YusufEminoglu/osm_3d_model](https://github.com/YusufEminoglu/osm_3d_model) 也可研究，其README明确包含procedural建筑/树木等细节；与“全部真实数据”的目标需要区分实际OSM几何和生成的细节，不能整体照搬并宣称真实。

### 补充：OSM 真实地景开源项目与代码核查

核查日期 2026-10-09；本次读取作者仓库、官方文档和以下源码，没有运行这些项目或将其代码接入当前场景。

| 一手来源 | 具体机制与适用边界 | 关联代码（待评估） |
| --- | --- | --- |
| [Streets GL](https://github.com/StrandedKitty/streets-gl)、[建筑标签解析](https://github.com/StrandedKitty/streets-gl/blob/HEAD/src/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getBuildingParamsFromOSMTags.ts)、[双坡屋顶构造](https://github.com/StrandedKitty/streets-gl/blob/HEAD/src/lib/tile-processing/tile3d/builders/roofs/GabledRoofBuilder.ts) | TypeScript / 自有 WebGL2 渲染器；OSM 矢量瓦片和 Esri 高程分开输入，运行时建立建筑、道路等网格并使用地形 LOD。源码包含屋顶直骨架处理、UV 和墙/屋顶材质解析，适合研究建筑几何。高度缺失时会采用默认一层、每层4m等推断，不能在本项目中把这些默认值作为真实高度直接导入。 | `geography/RealWorld.ts` 建筑几何、未来按块预加载；保留现有 Three.js 渲染器 |
| [OSM2World 官方 Web 模块](https://osm2world.org/docs/library-web/)、[BuildingDefaults.java](https://github.com/tordanik/OSM2World/blob/HEAD/core/src/main/java/org/osm2world/world/modules/building/BuildingDefaults.java) | 官方 Web 接口直接返回位置、索引、法线、UV 和材质，可适配 Three.js；官方提示客户端转换适合较小数据集。类型默认值明确区分 roof/carport 的无墙结构，但同样含默认楼层、层高和材质，需保留来源属性并限制缺失数据的推断。沿线区域离线转换、模型分块是本项目拟评估的接入方法，尚未验证输出。 | 模型转换管线、`GeoData.ts` 来源属性、`RealWorld.ts` 模型加载 |
| [Map3D](https://github.com/cartesiancs/map3d) | React Three Fiber / Three.js，使用 OSM 创建建筑和道路并导出 GLB。README 当前把建筑纹理、材质和 heightmap 列为未完成，适合小区域导出原型，不能视为现成完整地景引擎。 | 离线区域 GLB 导出候选 |
| [Blosm 官方文档](https://github.com/vvoovv/blosm/wiki/Documentation) | Blender 离线导入 OSM 建筑 part、高度、多类屋顶、道路/铁路和约30m地形，建筑可贴合高程。这里研究的是 OSM 导入；Google 3D 城市是另一个数据来源，不能把它与开放 OSM 重建混称。 | 离线转换对比候选 |

本次判断：优先评估 OSM2World 的转换结果，参考 Streets GL 的建筑/屋顶算法与地形细节分配。OSM 地图要素与独立 DEM 能约束布局和地形；转换器生成的默认立面、窗户、树木和缺失高度并不因此成为当地实测数据。

2026-10-09 补充核查：读取 [iTowns 作者仓库](https://github.com/iTowns/itowns) README，其基于 Three.js，支持高程、影像、MVT、GeoJSON 与 3D Tiles；适合作为地理数据加载框架候选，不能替代建筑转换器或提供缺失的当地立面。读取 [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) README，确认支持 Three.js，并提供区域预加载与 LOD 渐变示例；后续关联 `RealWorld.ts` 的沿线模型流式加载评估。两者本次均未安装、运行或接入。当前优先级仍为 OSM2World 小区域转换对比、Streets GL 建筑几何参考，再评估独立瓦片加载器。

## 2026-10-09：真实 Hudson 车站数据

| 来源 | 具体借鉴或核查 | 受影响的文件 |
| --- | --- | --- |
| [MTA Hudson Line 官方站点/时刻表](https://www.mta.info/schedules/metro-north/hudson) | 实际读取到生效日期 October 4, 2026 的 PDF；核对 Cold Spring、Garrison、Manitou、Peekskill 的名称与北南顺序。站台触感警示条、坡道等图例仅作后续实景研究线索，不作为已取得具体站台模型的证据。 | `app/scripts/prepare-hudson-stations.py`、`app/public/geodata/hudson/stations.json` |
| [Amtrak Empire Service 官方时刻表](https://content.amtrak.com/content/timetable/Empire%20Service.pdf) | 本日读取到 October 9, 2026 的 PDF；Croton-Harmon 与 Poughkeepsie 为这一段两端外的 Amtrak 停靠站，以上四个中间 Metro-North 站应表示经过而非 Empire Service 停靠。未导入班次时间。 | 同上，站点服务元数据 |
| [OSM Overpass API](https://overpass-api.de/api/interpreter)、[OSM 署名/许可](https://www.openstreetmap.org/copyright) | 实际取得区域内 31 条原始 OSM 对象；完整站台点/线/面几何与 stop_area 成员保留。派生保留 26 个地理对象、5 个站点，其中 4 个位于当前 FRA 路段，关联 8 条站台几何；Breakneck Ridge 距北端 1125m，在当前路段外。Manitou 的两个站台尚未成为 stop_area 成员，按75m内最近站点关联，明确标为几何推断。 | `sources/overpass-stations.ql`、`.json.gz`、`.request.json` 与 `stations.json` |

精确请求、OSM 数据时间、SHA-256、原始标签和平台关联依据已留档。站台 height 标签含 `4'`、`4` 和缺失值，不能统一当4米使用；Garrison另有带 disused 标签的轮廓，不能当作活跃站台。当前仅完成可复现的数据接续，尚未接入渲染或通过车站画面验收；站棚/立面/材质需要另查实景，不能从站点坐标编造。

## 2026-10-09：Overture 建筑实际下载与去重

| 来源 | 实际核查与处理 | 受影响的文件 |
| --- | --- | --- |
| [Overture 官方 Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/)、[建筑指南](https://docs.overturemaps.org/guides/buildings/)、[2026-09-23.1 STAC 索引](https://stac.overturemaps.org/2026-09-23.1/collections.parquet) | 官方客户端1.0.2查询 bbox `[-74.08,41.25,-73.85,41.46]`，取得34,330个building和3个building_part。29,939栋带height，33栋带num_floors，5栋带roof_shape。保留完整空间筛选导出、客户端查询、确切S3分区路径、release/date、原始来源record IDs与SHA-256；不是完整全球Parquet文件副本。 | `app/scripts/prepare-hudson-buildings.py`、`sources/overture-building{,_part}.geojson.gz` 与 `.request.json` |
| [Overture 去重/合并说明](https://docs.overturemaps.org/guides/buildings/) | 保留现有6,302个最新OSM轮廓和原始标签，全部匹配IoU>0.5；补齐1,790栋原来未解析到高度的属性。增加28,016栋区域建筑（28,024个多边形分量），其中524个新增分量与原1200m沿线走廊相交，9,129个与3000m走廊相交。9个水域中心检测和3个模糊相交记录被排除并留原因。合并结果34,326分量及3个part。 | `app/public/geodata/hudson/buildings.json`，原`world.json`保持不变 |
| [Microsoft GlobalMLBuildingFootprints](https://github.com/microsoft/GlobalMLBuildingFootprints)、[Overture 建筑字段](https://docs.overturemaps.org/schema/reference/buildings/building/)、[署名](https://docs.overturemaps.org/attribution/) | 按逐属性source记录分类：合并结果12,079个高度为来源模型估计，17,850个是上游/OSM标签，4,387个缺失、10个仅有楼层数。OSM标签也没有经过本项目独立测量；楼层数保留为楼层数，不在数据层凭空换算楼高。缺失屋顶/立面属性保持缺失。所有区域源和构件数据按ODbL署名，原始JSON属性为空的字段仅在派生包省略。 | `buildingHeight`、`overtureProperties.sources`、逐栋geometry/height来源；云端需在调试UI和署名中接入 |

已检查源校验、所有原有轮廓/洞/标签完整保留、所有派生多边形有效、ID唯一、估计高度来源标注、构件父对象引用和新增轮廓不与当前OSM重叠。可离线复现，当前只提供建筑叠加数据，不自动替换运行时；3D接入与画面验收继续在云端进行，不能把下载/数据检查等同于建筑画面完成。

## 2026-10-09：云端画面检查与树木候选评估

| 来源 | 核查与使用范围 | 受影响的位置 |
| --- | --- | --- |
| [Playwright 官方 CI 指引](https://playwright.dev/docs/ci)、[GitHub Actions 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) | 使用GitHub云端Ubuntu runner构建真实应用，并由Chromium拍摄车窗、F5俯视、站点里程跳转前后与移动视口。截图、视频、日志和临时脚本均在runner临时目录，作为artifact提供，不把报告/图片写入仓库。软件WebGL不代表用户GPU性能；自动运行健康检查不能代替人工画面检查，也不代表五项目标完成。 | `.github/workflows/cloud-visual-review.yml` |
| [Poly Haven Tree Small 02](https://polyhaven.com/a/tree_small_02)、[官方文件清单](https://api.polyhaven.com/files/tree_small_02)、[许可](https://polyhaven.com/license)、[作者导出说明](https://blog.polyhaven.com/dev-log-20/) | 实际读到CC0、4.6m高、约5M三角形，1k glTF依赖约95MB几何buffer；网站标签为Burkea africana，不能直接作为哈德逊河本地成熟树种。尚未下载模型或接入，作为被排除的直接替换候选；保留现有枝叶图集作LOD方案研究，具体树高/单株位置未由该素材提供。 | 云端`RealWorld`树木表现评估；不作为运行时新模型 |


## 2026-10-09：真实数据渲染接入与完整初始范围预加载

| 来源与本次核查 | 采用范围与边界 | 受影响代码 |
| --- | --- | --- |
| 上文实际取得的 FRA/USGS/OSM、MTA 站点与 Overture 2026-09-23.1 快照 | 运行时校验叠加层绑定的 world.json SHA-256，接入四个沿线 Metro-North 站及八条站台几何、34,326 个区域建筑组件及三个建筑 part。保留上游高度估计和缺失高度的状态。此段 Empire Service 经过这些 Metro-North 站，不把它们标为 Amtrak 停靠站。 | `geography/GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts`、`ThreeCanvas.tsx` |
| [OSM way/1307801003](https://www.openstreetmap.org/way/1307801003) 的 amenity=shelter / shelter_type=public_transport 与实际匹配 Overture class=shelter | Peekskill 遮棚按开放结构表达；保留真实 footprint，估算支柱和缺失时的3.6m棚高均标为可视化估值。不能由 building=yes 覆盖更具体的遮棚标签并填入实墙。 | `GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts` |
| 仓库已有 `trees_summer_near_04*.png` 图集；本次直接查看现有图像，不新增下载或声称其是 Hudson 当地单株照片 | 以带枝叶轮廓、纹理和 alpha 的交叉面实例替换 Kenney 树模型/低模球冠。近景和远景使用距离过渡，远景整段数据范围一次准备，按1024m区域分批以利剔除；落在OSM林地内并避开水体与建筑。单株位置/高度仍是明确的视觉采样，不是树木调查。排除已确认的 Burkea africana / Tree Small 02，不引入该模型。 | 新 `geography/GeoForest.ts`、`RealWorld.ts`、`textures.ts` |
| [Three.js InstancedBufferAttribute](https://threejs.org/docs/pages/InstancedBufferAttribute.html)、[WebGLRenderer compileAsync](https://threejs.org/docs/pages/WebGLRenderer.html) 与当前已安装 Three.js API | 每株树用实例属性选择图集单元，一块最多两个森林批次；等待纹理、整个初始7×7可视范围及同宽1536m前方缓冲，再编译材质。缓存最多256块，尚未备妥的目标区域不会推进列车；跳转先准备目标块。时段/天气修改不重新创建地理世界。只有云端运动检查才能证明连续运行状态，不把这些代码机制或构建成功视为完整验收。 | `GeoForest.ts`、`RealWorld.ts`、`ThreeCanvas.tsx`、`core/Renderer.ts`、云端截图 workflow |

本次没有运行或集成 OSM2World/Blosm，也没有获得当地建筑逐栋立面纹理。正常车窗用中性墙面，调试模式才用源高度/模型估计分色；建筑 roof/wall 合并成每类两组，建筑 part 同样保留材质组，防止构件不绘制及逐栋 draw call 膨胀。此段描述是实现状态，新版视觉检查结果待云端 artifact 核对后另行报告。

### 源材质与 Peekskill 建筑案例接入

本次重新核对 retained 的 `buildings.json`、原始 Overpass OSM gzip 和官方/作者源码。它们提供的是地图标签和模型高度，不是现场材质测量：

| 来源 | 核对结果与实现边界 | 受影响文件 |
| --- | --- | --- |
| [OSM way/962993799](https://www.openstreetmap.org/way/962993799)、包内 `sources/osm-buildings.json.gz` | Mount Lebanon Baptist Church，648 Harrison Avenue。源标签为 `building:material=wood`、`building:colour=white`、`roof:material=tar_paper`、`roof:colour=grey`、`roof:shape=pyramidal`、`building:levels=2`；原样保留。Overture 字段把颜色细化为 facade `#FFFFFF` / roof `#778899`，材料分别仍为 `wood` / `tar_paper`。这里将 tar_paper 表达为深灰屋面调色，不称其为金属卷材。高度 `3.877643585...m` 的属性来源是 Microsoft ML Buildings，仍标“模型估计”；两层标签不用于覆写或反推。没有 roof_height，因此场景保留 pyramidal 源标签与屋顶颜色，但不凭空指定屋顶升高值。 | `GeoBuilding.ts`、`GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts` |
| [Overture building schema](https://docs.overturemaps.org/schema/reference/buildings/building/)、[building guide](https://docs.overturemaps.org/guides/buildings/) 与包内 release `2026-09-23.1` | 每个 wall/roof 使用各自的 source color；缺显式颜色但有 `facade_material` / `roof_material` 时，以代码内材质调色板表达类别，UI 明示这不是本地采样色或实测立面。`building_part` 保留父级 GERS、来源记录、`height`、`min_height`、facade/roof 属性并独立着色；缺高度仍不挤出。 | `GeoBuilding.ts`、`GeoData.ts`、`RealWorld.ts` |
| [OSM2World PyramidalRoof.java](https://github.com/tordanik/OSM2World/blob/HEAD/core/src/main/java/org/osm2world/world/modules/building/roof/PyramidalRoof.java)、[BuildingDefaults.java](https://github.com/tordanik/OSM2World/blob/HEAD/core/src/main/java/org/osm2world/world/modules/building/BuildingDefaults.java)、[Streets GL roof tag parser](https://github.com/StrandedKitty/streets-gl/blob/HEAD/src/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getRoofParamsFromTags.ts)、[OSM material resolver](https://github.com/StrandedKitty/streets-gl/blob/HEAD/src/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getRoofMaterialFromOSMMaterial.ts) | 源码确认这些项目能解析 OSM roof shape/material/color；OSM2World默认建筑参数与 Streets GL 缺高规则会补默认层数/高度。当前仅复用“材料标签决定视觉材质类别、显式来源颜色优先”的机制，没有导入其生成默认值；未部署或运行转换器。足迹凹形、无来源 roof_height 的屋顶不使用可能越界的质心扇面，也不捏造坡高。 | `GeoBuilding.ts`、`RealWorld.ts` |
| [Mount Lebanon Baptist Church 官方站点](https://mountlebanonbc.info/)、[官方 History 页面](https://mountlebanonbc.info/?page_id=50)、[官方 Media Ministry 页面](https://mountlebanonbc.info/?page_id=82) | 官方搜索索引将该会址对应到 648 Harrison Avenue，但访问时首页显示主机暂不可用，媒体页未能读取到可核验的现场外观照片。搜索到的同名 Wikimedia 图片标注国家注册号 `80001703` 且位于路易斯安那州，明确不是 Peekskill 这栋，已排除。故本案例用 OSM/Overture 原始 footprint 和属性验证数据接入，不宣称完成照片外观比对，也不以错配照片覆盖 `tar_paper` 标签。 | `GeoInspector.ts` 案例定位/来源查询；外观照片仍待核验 |

调试面板增加建筑独立显隐、GERS 源查询以及“定位 Peekskill 源建筑案例”快捷入口；可隔离查看墙/屋顶颜色与来源字段。选中案例的材料来源显示为 OSM 标签；因现场照片不可核验，没有将标签表述为现场实测。立面贴图和窗户仍缺少此建筑的可靠逐栋数据。

### 站台高度基准与性能诊断修正

2026-10-09 核查 [OSM railway=platform_edge 文档](https://wiki.openstreetmap.org/wiki/Tag:railway%3Dplatform_edge) 中 height above the rails 的定义。渲染站台升高改以当前平滑轨面为基准，不叠加平均DEM地面。Cold Spring `way/1131682757` 的原 height=4 原样保留，2.5m 的显示合理性上限是项目的异常值保护规则，不是测量或通用铁路规范；本对象显示时参考同站 `way/97522334` 明确的4英尺标签，并标为同站估计（1.2192m），不把4默默解释为英尺。Manitou 缺失高度的0.35m是画面估值。逐站台显示原值、使用值与估计说明，关联 `GeoData.ts`、`RealWorld.ts`、`GeoInspector.ts`。

云端 run37993781339 在首次桌面截图超30秒失败，无请求失败或shader错误，KHR_parallel_shader_compile不支持为警告。已从录制视频查看60秒/150秒原始帧：初始预热仍逐帧进行，完成后有顶棚和纹理树，但连续运动及画面质量尚未验收。新诊断保留截图前的DOM与帧性能（FPS/帧间隔/CPU提交/全场景绘制量），后续截图使用1280×720桌面和390×844移动视口，明确软件渲染条件。

地表着色和森林采样复用4096² OSM 土地覆盖掩码，减少重复遍历复杂林地/水域多边形；这是和GPU掩码一致的显示栅格，未改原始几何。预测队列同时加入实际下一步位置，避免256m预测采样之间的弯道角块未进入队列而导致列车等待。

### 成熟林冠尺度、屋顶及失败路径复核

2026-10-09 读取 [NYSDEC 学校苗木项目](https://dec.ny.gov/nature/forests-trees/saratoga-tree-nursery/school-seedling-program) 对当地红橡成熟60–80英尺的说明。结合已有NPS沿河照片与本轮云端帧中稀疏小树的差距，通用成熟林木显示高度选18–24m、远景采样24m（先前48m）；这些是视觉范围/密度，不是Hudson逐株测量。继续使用已有纹理轮廓，采用漫反射叶材质而不是无意义的金属/高光项。关联 `GeoForest.ts`、`RealWorld.ts`，密度/材质的实际运动性能与截图仍需验证。

源数据 Perkins Memorial Tower 为 Overture `e82919a0-184c-47e2-bfe1-584ff22fb02a`，匹配OSM `w459098921@6`，源 height=12m、roof_shape=pyramidal、roof_height=3m。新增 `GeoRoof.ts` 为有内部可见顶点的足迹建三角面屋顶，避免仅在边界三角化而把金字塔画平。直接投影实际足迹验证生成15顶点、屋檐相对0m、顶点3m；总楼高保持来源12m。顶点位置由足迹几何推导，不是屋顶实测；不支持的形状/带洞轮廓保留源属性及完整楼高，不擅自压低建筑。

源码审查另确认纹理失败会使ready永久等待；已让预热Promise reject并在真实数据已加载后仍显示失败状态。F5切换先定位检查镜头再更新世界；源站点加入路线快速选段。详细数据/加载/帧性能诊断默认折叠，保留主要导航控件；运动门控同时记录请求/目标速度、暂停、俯视、预热和下一步覆盖。

### 实际土地覆盖补充 OSM 林地记录空白

2026-10-09 读取 [USGS Annual NLCD 数据入口](https://www.usgs.gov/centers/eros/science/annual-nlcd-data-access)、[MRLC 官方服务目录](https://www.mrlc.gov/data-services-page)、[USGS 分类定义](https://www.usgs.gov/centers/eros/science/annual-nlcd-land-cover-classification) 与 [Science User Guide v1.2](https://www.usgs.gov/centers/eros/science/annual-nlcd-science-user-product-guide) PDF第10页（Table 2-2）。NLCD是30m卫星分类；41/42/43为落叶/常绿/混交林，52灌木与90木本湿地不直接当成成熟森林。

官方WMS capabilities明列2025时间切片。WCS下载两种时间subset均返回startTime空值服务错误，1.0请求不受支持；没有将错误响应当作GeoTIFF。取得WMS 2025分类PNG，像素全部精确匹配官方色表、没有混合颜色/缺值；对四个均质位置分别用GetFeatureInfo独立核对41、11、21、22源编号。保留PNG、capabilities、查询响应、完整请求与SHA-256，导出640×779 UInt8（498,560字节）及绑定原world快照的metadata。此派生物是约30m的WMS分类采样，不能称为原生COG。关联 `prepare-hudson-landcover.py`、`GeoLandCover.ts`、`GeoData.ts` 与 geodata README。

NLCD林地填入4096²显示掩码底层，再保留OSM土地/水域几何与holes的优先级，避免把未标注区域一律画成草地。仅森林类补充成熟树；依据本次实际查看的既有两张树木图集，落叶林选阔叶轮廓，常绿林选针叶轮廓，非逐种植物识别。远景批次在整个范围一次建好；距离超过4500m的完整批次只剔除绘制、不删除重建。关联 `RealWorld.ts`。调试模式先加入“NLCD 分类对照”与中心分类/数据年份读数，可关林木检查原分类；切换仅改shader uniform，不重建世界。云端新画面与成本尚待检查。

已查看 run37995594034 的车窗、四站、俯视和移动端截图：遮棚没有原来的实墙，但远山林木仍稀疏、许多建筑无立面细节，因此没有将任务标为视觉完成。该运行实际跨920m，六次采样missing/late均0；这是有限区间运行证据，不是全22.84km验收。SwiftShader仅0–2FPS，帧间隔466–6261ms，不能据此声称硬件性能通过。

同一实际64m DEM背景网格按1024m固定片区预先建好，以Three.js正常frustum culling减少原来单个大网格每帧提交整个区域；没有降低DEM采样、修改地形或随行驶重建背景。参考本机已安装Three.js `Object3D.frustumCulled` / InstancedMesh.boundingSphere。已查看两张现有512×256 atlas的原图，增加半像素内缩避免线性过滤跨单元采样；天空边缘叶片是否消除仍待新截图确认。关联 `RealWorld.ts`、`GeoForest.ts`。

run37997465057 实际行驶710m、六次missing/late均0；已查看截图确认树冠更密、诊断折叠后主导航可见，沿河仍有覆盖空白。该版运动读数请求0/目标44.4揭示“上车”直接修改camera却没有保留requestedSpeed；若预热随后完成会将目标改回0。改为在加载时保留待出发意图，完成预热再采用原有缓加速出发。新增云端情景先阻止必要的landcover.u8响应，上车后才释放，核对请求/目标44.4并实际移动。为让响应拦截确定可重复，该QA情景禁用service worker；不验收PWA/offline。关联 `ThreeCanvas.tsx`、云端workflow；新情景待运行。

俯视自由平移时，required缓存同时保护实际列车位置的49块；不会因为查看远处多个区段而逐出返回时立刻可见的建筑/地面。新增情景连续查看Manitou/Peekskill但不应用列车跳转，然后Esc返回即查missing/late=0，再执行原来的Garrison跳转检查。此项是新的缓存交互验证，待云端运行；不把静态源码规则本身视为通过。

2026-10-09 云端交互复核：[run 38000427779](https://github.com/orriduck/chill-window/actions/runs/38000427779)，对应 `bbf32c5`。已读取 health.json 并查看返回车窗与 Peekskill 图片：加载前点击 Board 的排队发车、远处 Manitou/Peekskill 俯视后立即 Esc 返回均通过；连续实际推进 810m 的六次抽查缺块/迟到帧均为0。软件 SwiftShader 的帧率不代表硬件表现，未验证整段22.84km。图片仍可辨认近景交叉树贴片，树木质感目标未完成。此结果不包含本次建筑材质新代码的视觉验收。


## 2026-10-09：整段远景建筑与 GPU 提前准备

核查依据仍是上文实际 OSM/Overture 建筑和 USGS DEM，不增加随机建筑。新 `GeoDistantBuildings.ts` 在启动时一次准备全数据范围，按1024m区域、来源高度状态与结构类型合批。保留外环/内洞、已知高度、min_height、墙/屋顶颜色与已支持的源 pyramidal 屋顶；无高度建筑保持平面，开放遮棚沿用明确标注的3.6m画面估算，不增加实墙。近/远景都用同一来源中心在650–740m过渡；互补屏幕像素裁切避免两个独立alpha测试留下空洞。远景在3–4.5km淡出，分区始终保留而不随移动重建。

当前整段真实数据 Node 核验：34,326组件，29,818挤出建筑、4,362平面足迹、28开放遮棚；115个中心缺DEM、3个源高度/min_height组合无有效体积而省略，另有1个有效part。337区域644合批、556,963三角形、48,487,934几何缓冲字节；一次准备约339ms。该数字是CPU/几何测量，不是浏览器帧率或视觉验收。核验全部索引范围、顶点/中心坐标有限；单独验证院落孔洞的屋面面积和法线、源抬高范围、开放结构与无高度处理。代码：`GeoDistantBuildings.data.test.ts`、`GeoDistantBuildings.test.ts`。

已读本地安装 Three.js `WebGLRenderer.js` 的 compile/compileAsync 实现并对照[官方 renderer 文档](https://threejs.org/docs/pages/WebGLRenderer.html)：编译遍历隐藏对象的材质，不能据此说几何已上传。`core/Renderer.ts` 增加16×16离屏提交，用原对象/实例缓冲、保留灯光和父坐标；同步pass结束立即恢复显隐和渲染目标，然后通过[WebGL2 fenceSync](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/fenceSync)及非阻塞clientWaitSync等待GPU完成，不调用gl.finish。初始全世界及后续新近景区块均先提交；后续只绘制被准备区块，避免额外整世界提交。`RealWorld.canAdvance`现在要求下一位置49块的gpuReady，`ThreeCanvas.tsx`完成后才标记，调试诊断展示待上传队列。该新路径待云端实际运行、着色器编译与图片核验；硬件平滑度和全路线连续性仍未证明。

树模型候选再次核查：[Poly Haven Pine Tree 01](https://polyhaven.com/a/pine_tree_01)、[官方 files API](https://api.polyhaven.com/files/pine_tree_01)、[许可](https://polyhaven.com/license)。实际读取1k glTF（MD5 9bc0153071011411957a74e473d24858）只含3个LOD0，共17,182,252三角形，bin948,849,556bytes；1k表示纹理档，不代表低几何LOD，未把该大包接入场景。[LOLIPOP Maple 作者页](https://sketchfab.com/3d-models/maple-trees-pack-lowpoly-game-ready-lods-b5d2833c258f4054a01ee2b4ef85adf0)提供成熟17–20m及LOD2约2825–5321tri的CC Attribution候选；下载认证尚未解决，不使用viewer提取绕过下载。Poly Haven Tree Small02源种为Burkea africana，继续排除。独立云端任务正处理其他合法公开温带静态模型，尚未进入本次运行代码。


2026-10-09 建筑材质云端复核：[run38002543420](https://github.com/orriduck/chill-window/actions/runs/38002543420)，8e67aa5，读取health并实际查看03e/03f图片。白色木材标签立面、#778899屋顶、源模型估计3.9m和缺失roof_height说明均存在；建筑关闭后画面中的建筑消失。连续740m六次抽查missing/late为0，无请求失败或运行错误。截图同时暴露 ready() 在定位后的新视野更新前读到了旧49/49：03e实际只有2/49，03f只有10/49，不能把这组视图当作完整就绪验收。修正方案是等待新的场景更新帧，再检查当前49/49；新等待方案尚未跑云端。

接续 `GeoDetailCoverage.ts`：用7×7可用性小纹理记录当前视野细节区块的真实gpuReady，建筑与森林均在匹配区块未上传时保持已准备远景。此前纯距离淡化会在俯视快速定位后把近中心的远景裁掉，而细节仍在准备，产生临时空白。这里不新增地理要素，只调整已有来源模型的显示覆盖；数据坐标仍为地理米、按原256m中心区块判定。当前仅生产构建和定向lint核查，新着色器与快速定位备用画面仍待云端验收。

## 2026-10-09：OSM 开源地景管线比较

响应用户关于 GitHub 现成地景项目的询问，重新读取下列作者仓库与官方文档；本节为研究结果，未运行其转换器、未接入新引擎、未验证线上 demo 的实际可用性。

| 项目与主要来源 | 可借鉴能力及边界 | 对当前代码的适用点 |
| --- | --- | --- |
| [Streets GL](https://github.com/StrandedKitty/streets-gl) | TypeScript / 自研 WebGL2，OSM复杂建筑、道路、树木，地形LOD、PBR与大气；数据来自改版Planetiler矢量瓦片和Esri高程。不是直接可替换的Three.js组件。仓库仍注明早期开发；不能从README的demo链接推断当前服务可用。 | `GeoRoof.ts`、`GeoBuilding.ts`、`GeoForest.ts`、`core/Renderer.ts`的屋顶解析、材质和分级显示参考；目前仅部分屋顶/材质机制参考，未导入渲染器。 |
| [OSM2World](https://github.com/tordanik/OSM2World)、[官方功能页](https://osm2world.org/)、[Web library](https://osm2world.org/docs/library-web/) | 输出glTF/GLB、PBR材质、LOD；新ES模块返回带材质的三角网格，可供Three.js使用，官方建议客户端只处理较小数据集。候选方案为云端预转换路线片区，再加载静态模型；尚未实现。 | 潜在替代部分`RealWorld.ts`建筑/沿线设施自建网格的离线准备步骤，须先对同一Peekskill片区做来源字段、坐标、高度和显示成本对照。 |
| [Blosm](https://github.com/vvoovv/blosm) | 代码在release分支。免费基础版导入OSM建筑/屋顶、约30m真实地形、道路/铁路与植被多边形；贴图/UV、三维森林和单树列在Pro功能中，不将其误写为全套免费功能。 | 可选Blender离线资产制作路线，尚未安装、购买或导出；不替换当前USGS DEM。 |
| [three-geo](https://github.com/w3reality/three-geo) | Three.js地形网格，Mapbox Terrain-RGB DEM与卫星纹理，需要Mapbox token；主要提供地表，不提供完整OSM建筑街景管线。 | `RealWorld.ts`地理投影与地形贴图研究参考，当前仍使用已获取的USGS数据。 |
| [osm2city官方仓库](https://gitlab.com/osm2city/osm2city)、[算法说明](https://osm2city.readthedocs.io/en/latest/how_it_works.html) | 主仓库在GitLab，面向FlightGear。根据OSM生成建筑、道路、电力线、码头、站台等；文档明确使用启发式和随机性形成合理外观，不能当作当地完整实测复原。 | 沿线设施和批次/LOD实现参考；没有接入其生成资产。 |

[OSM2World 2026地形路线图](https://osm2world.org/blog/2026/06/03/ptf-roadmap-2026-osm-3d-terrain/)明确OSM不包含连续地形高程，需额外数据；建筑、道路、桥隧与地形贴合、瓦片边界连续性仍属于专门工作。当前判断：优先评估OSM2World的云端片区转换，并借鉴Streets GL的运行显示机制；保留真实DEM和来源审计。通用材质/默认窗户不能表述为当地逐栋照片纹理，默认补高也不能覆盖来源缺失状态。

### f89bc93 云端运行失败及队列修正

实际核对 [run38004369924](https://github.com/orriduck/chill-window/actions/runs/38004369924) 的health与02b/03e图片。初始GPU离屏预热完成（SwiftShader约12.1秒），整段远景建筑初始化完成，加载前上车意图保留、实际连续780m六次抽查missing/late均0；其后进入调试已有1次行驶缺块计数，因此不能把整次运行描述为无迟到。Peekskill源案例截图为0/49并实际显示空白地表；旧ready状态误读仍存在。后续远处定位等待180秒失败，最终0/49、171块待GPU上传；没有请求失败或shader错误。初始准备成功不代表后续地图切换成功，远景建筑的视觉/显隐情景尚未完成。

当前修正关联`RealWorld.ts`、`core/Renderer.ts`、`ThreeCanvas.tsx`：CPU/GPU均优先当前视野，其次列车位置/跳转/下一步覆盖，再处理缓冲；GPU每批最多12块，同一离屏提交与fence，保留原对象/父变换，不在准备过程中驱逐该批。CPU每帧按8ms预算推进，单块仍可能超过预算，不把该预算说成硬上限。移动门控与准备范围覆盖起终点及中间原路线顶点的包围区块，避免只验证预测终点却漏掉弯道中途；该保护并非已经证明上述1次缺块的确切原因。新帧确认、远景可用性备用显示和这些队列改动均待下一次云端运行；本地构建/定向lint和26项既有数据/几何/相机检查通过，既有检查不直接验收新异步GPU队列。

云端已处理两种静态三维树候选，root取回`GeoCloseTrees.ts`、准备脚本与来源metadata完整源码；GLB转交尚待完成，模型尚未接入本次发布。成熟Scots pine候选与8.6m橡树街树样本不能替代所有落叶林，当前图片中的交叉贴片仍清晰可辨，树木视觉目标继续未完成。

## 2026-10-09：静态三维树资源接入与隔离对照

核查[Innerscene成熟Scots pine作者页](https://www.innerscene.com/tools/library/3d-parts/mature-scots-pine-tree-280307e1)及[橡树街树详细叶片作者页](https://www.innerscene.com/tools/library/3d-parts/oak-street-tree-detailed-leaves-a273fef9)：两者为作者CC0模型，松树名义18m，橡树约8.6m；不是当地实测树种/树高，橡树为原始程序制作的建筑场景模型。许可证和可再分发不等于照片级视觉质量。此次独立[资源重建run38005959794](https://github.com/orriduck/chill-window/actions/runs/38005959794)实际成功取得公开原始文件、以固定@gltf-transform/cli4.5.1重建并校验SHA，root下载artifact后重新核查产物。松树537,348bytes/6,588tri/2材质/2张64²内嵌纹理；橡树708,996bytes/10,668tri/4材质/无外部贴图。源GLB、重建脚本、全部许可/源URL/SHA/参数/bbox及delivery-report随代码保留，不再依赖行驶时的第三方下载。两个资产检查直接读取实际二进制，验证本地buffers/images、节点变换后的米制包围盒、索引范围、三角形数与完整checksum。

`GeoCloseTrees.ts`使用作者网格实例，保留原尺度与材质、加入近景阴影和80–115m距离过渡。`RealWorld.ts`仅在NLCD42常绿林、实际DEM可用、无建筑/轨道冲突的现有16m显示采样位置准备整段松树；位置不是树木调查。当前松树不得替换NLCD41/43的落叶/混交林。橡树只在调试对照显示。两种模型及内嵌纹理准备完成后才开始初始GPU提交、允许世界呈现；移动中只改变固定实例格的显隐。原松树贴片与模型过渡使用同一16m采样位置；远景原24m采样仍为低成本显示，不声称已验证过渡无跳变。

先扩展`GeoInspector.ts`折叠诊断：独立常绿林近景模型开关、来源尺度对照开关、定位按钮、资源准备/距离筛选量读数；对照使用两个实际林地显示采样位置，18m松树和约8.6m橡树均不缩放。`cloud-visual-review.yml`新增模型隔离及关闭截图。专门的near-tree-visual-review分支仅运行初始准备和树模型对照，明确不包含连续路线/四站验收；主评估分支仍保留完整情景。静态资源校验、构建/lint不能证明画面自然，待云端截图实际检查。

已核查安装的Three.js `WebGLObjects.js`对整份instanceMatrix/instanceColor attributes.update的调用及`WebGLRenderer.js`以object.count作renderInstances的实现。`core/Renderer.ts`仅在同步离屏提交中将每个实例批次draw count暂设为最多1，仍提交完整原属性缓冲，结束立即恢复原count/显隐/渲染目标，然后等待fence；减少整段实例森林预热的额外绘制。是否实际减少软件GPU耗时仍待该版本云端运行，不以源码推断称性能通过。

OSM2World云端实验已完成转换：官方0.4.0、18个building way与209个引用节点、输出约3.28MB/630tri，但把3个缺高站房/遮棚补为7.5m体块，输入没有DEM且通用默认贴图不是本地立面照片。root已取得完整准备脚本的可检索记录，实际输入/manifest文本转交中；GLB尚未接入。该实验支持先隔离对比的决定，不覆盖当前缺高状态与开放结构规则。

### 2026-10-09：当前 GPU 队列和树模型云端画面核查

`6fd400c` 的 [云端运行](https://github.com/orriduck/chill-window/actions/runs/38005612742) 连续行驶880m、六次采样缺块/迟到均为0；实际查看 Peekskill 远城建筑、关闭远景和源教堂三张截图，定位与返回均49/49，修复了旧版可视区上传排在队尾导致空白的问题。远景仍主要是源足迹体块，不能写成真实逐栋立面完成。

`503222f` 的 [完整云端运行](https://github.com/orriduck/chill-window/actions/runs/38006740292) 连续1040m、六次采样缺块/迟到均0，初次GPU预热7881ms；源树模型及显隐、远景地图返回、Cold Spring/Garrison/Manitou/Peekskill采样通过。实际查看 `02b-continuous-ride.png` 和 `03i-tree-source-models.png`：大部分林地仍呈交叉树卡，18m松树对照树冠过疏，阔叶/混合林尚未改成三维模型，不能作为“树木不动漫化”验收。源码尺度与准备成功不等于视觉合格。SwiftShader软件渲染检查不证明用户硬件帧率；全22.84km连续覆盖尚未验收。

### 2026-10-09：OSM2World 建筑输出接入

主要来源：[OSM2World](https://github.com/tordanik/OSM2World)、[默认样式/材质](https://github.com/tordanik/OSM2World-default-style)、[MetricMapProjection](https://github.com/tordanik/OSM2World/blob/master/core/src/main/java/org/osm2world/math/geo/MetricMapProjection.java)、[MercatorProjection](https://github.com/tordanik/OSM2World/blob/master/core/src/main/java/org/osm2world/math/geo/MercatorProjection.java)。投影公式从作者源码核对，实际binary投影后地面顶点与现有OSM源足迹最大偏差0.0006442m。

已取得 [Actions诊断运行](https://github.com/orriduck/chill-window/actions/runs/38008413794) 的实际GLB；该运行因跨环境原始SHA不同而失败，输出保留用于核对。历史原始SHA和交付SHA均保存在provenance，不宣称字节重建一致。当前导入15个有源height的建筑/586tri，排除3个默认补高对象。模型逐栋加当前DEM中心点地面高度并翻转Z及三角绕序，合并为两组PBR材质；同时预建原始体块作为对照，Debug Mode可定位和显隐。材质为CC0通用Plaster002/RoofingTiles010，没有取得当地立面照片，默认屋顶不标成实测。受影响代码：`GeoConvertedBuildings.ts`、`GeoConvertedBuildingRecords.ts`、`RealWorld.ts`、`GeoDistantBuildings.ts`、`GeoInspector.ts`；素材与具体SHA在 `public/models/osm2world/peekskill/provenance.json`。新版实际画面核查待云端artifact。

`d7c7b2a` 的 [建筑隔离检查](https://github.com/orriduck/chill-window/actions/runs/38009285847) 已通过。已实际看PBR/原体块/返回列车截图；模型15/15、2合批、586tri，浏览器Float32坐标最大足迹误差0.0009m；全部图片49/49、缺块/迟到0，无请求或运行错误。初始GPU预热14960ms；此运行只覆盖初始准备及隔离建筑/返回，不包含完整连续路线。PBR图默认红瓦明显过饱和，未有当地颜色标签支持；因此后续材质保留既有源/中性颜色，仅从通用贴图提取低对比明度与减弱法线细节。此画面结论不表示真实逐栋立面完成。

原始云端与Actions的18 source对象/36 primitive，独立按source ID与primitive整理accessor实际元素bytes（位置、法线、UV、索引）和材质名称，均得到SHA `a04a18fad2b7eaee14659d71bffaafde3f24ccbb00e5aca0b8d92db3ccdd2bb3` / 22,109B；6张内嵌纹理SHA也一致。JSON规范化及BIN原始chunk SHA仍不同，不宣称raw bytes可重现。新增明确的mesh/hash检查，并固定已观察Actions raw SHA，[591c3c1重建](https://github.com/orriduck/chill-window/actions/runs/38010556265)通过。保留两个不同的原始SHA和早期失败，不将调整验证口径写成初次检查已通过。

树木候选补充：[Poly Haven Pine Tree 01](https://polyhaven.com/a/pine_tree_01)官方CC0，云端实际下载并打开Blender源文件；作者A树LOD2有416,451tri（叶片345,915tri），约20.4m高，有专用叶片alpha和真实纹理PBR。已保存完整重建脚本至 `scripts/experiments/polyhaven-pine/`，等待固定source manifest及Blender bootstrap后再在Actions生成可下载模型。它尚未接入或检查实际浏览器；不能用高面数或作者预览证明自然林目标已达成。早期25k整体简化没有被作为通过标准，后续应保留叶冠并作原生/减轻版本实际对比。Tree Small 02是4.6m Burkea africana；Jacaranda也未当成Hudson本地成熟树种。主要阔叶林模型仍缺，当前goal仍未完成。

### 2026-10-09：全样板线路连续行驶与颜色修正版

[150f076全线运行38009493345](https://github.com/orriduck/chill-window/actions/runs/38009493345)已通过并读取完整health：基于d7c7b2a，仅增加精确里程诊断和独立工作流，640×360 SwiftShader、正常速度、不跳转，从0实际推进到22837.381661575448m（恰好源线路终点）。95次采样缺块和累计迟到均0，初始GPU预热8352ms，终点49/49且待上传0，没有请求或运行错误。已实际看21.135km、终点及四站套件Peekskill图。此证据覆盖当前整条22.84km样板线路的连续准备，不等于完整Empire Service、硬件帧率、高分辨率所有视角或离线验收。终点树卡的轮廓与悬空感仍明显，树木目标未达成。

[d7c7b2a完整交互运行38009280167](https://github.com/orriduck/chill-window/actions/runs/38009280167)已通过：另有700m连续六次缺块/迟到0，建筑原/PBR/隐藏、树模型、远地图返回、四站和移动视图保留，无请求失败。已读取health并看Peekskill图；站台/遮棚视觉仍需进一步完善，绿色地表和基础体块不能视为全部视觉完成。

[b97483f颜色修正版38010134905](https://github.com/orriduck/chill-window/actions/runs/38010134905)已通过，实际查看PBR及原体块图：默认红色被移除，源/中性颜色保留，通用表面细节仍可见；15栋/586tri/2合批、足迹误差0.0009m，定位/显隐/返回均49/49且缺块/迟到0，无请求或运行错误。初始GPU预热14292ms。此运行只覆盖初次准备和隔离建筑/返回，不包含全线连续行驶；全线证据是上述150f076基于d7c7b2a的运行。[b97483f预览](https://chill-window-pokr0r9f4-orriduck.vercel.app/?world=hudson)已READY并核对提交与HTTP200。真正的立面/窗口、主要阔叶林与整段建筑视觉升级仍需继续。

### 2026-10-10：原生纹理松树配方与阔叶候选实际文件

原生松树 Actions 配方保留实际源 .blend 与18张贴图的 SHA/大小，固定官方下载 Blender4.4.3 的363,316,148B归档及SHA。原生416,451tri与只减枝干的381,180tri版本保持叶片accessor hash `0ae502cc8ceb0ff51013367cfe9b983aaece6e0b9a073bd8850a7bf64f0aedd6`，待实际输出校验完成；此内容尚未成为默认运行模型。首次[38014145361](https://github.com/orriduck/chill-window/actions/runs/38014145361)下载Blender遇到403；标准curl下载后已成功验证归档并导出两版。第二次[38014301825](https://github.com/orriduck/chill-window/actions/runs/38014301825)因验证器要求显式alphaCutoff而失败，实际glTF允许省略该属性，默认0.5；按[Khronos glTF2.0规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#_material_alphacutoff)修正，并按源名称比较纹理，未改变叶片hash要求。

核对[Innerscene Mature silver birch](https://www.innerscene.com/tools/library/3d-parts/mature-silver-birch-tree-8e297753)作者页及其公开Download GLB链接，root实际取得4,902,236B文件，SHA `d1832a237f9e5d3728c7c6dc6e8e8243ac2984e51abe102cdf12bb996ca3dcc7`。源文件103mesh、52,476tri、5材质/5张64×64内嵌PNG，实际顶点及节点变换后的尺度8.185×14.000×7.791m，CC0 original_design。作者页的textured标记不能写成真实摄影纹理；尚未检查应用内树冠自然程度、未接入或替换主要阔叶林。下载临时原件为 `/tmp/chill-silver-birch-source.glb`，尚无运行代码引用。

后续[c647543 / 38014443841](https://github.com/orriduck/chill-window/actions/runs/38014443841)已成功，实际取回原生24,328,860B及枝干版23,313,556B产物，root重新计算SHA分别为 `5b3b8c30cf28937e5e5193602e76e48878a24f81b58377dbbf3d2587d60a3ee8` 和 `6d6dbf39b0f2d0099df6cb12bea32e0d4f43de19a76bbce9b0188eeb2d5bf6db`，与之前云端相同；两版完整叶片hash一致、内嵌图像逐源名称hash相同。保留实际报告至 `scripts/experiments/polyhaven-pine/cloud-delivery-report.json`。此资源重建成功尚不表示浏览器自然外观通过，也尚未铺到运行世界。

将上述实际GLB接入`GeoCloseTrees.ts`和`RealWorld.ts`的来源尺度对照，在同一现有林地显示采样点保留20.4m作者尺度/方向/地面位置；暂不覆盖主要森林。`GeoInspector.ts`折叠诊断增加版本选择，现有松树/新原生/仅减枝干版本使用同一机位，沿线林木在来源对照时隔离、退出调试恢复。所有版本初次加载验证真实字节SHA并随整世界GPU准备，选择只改显隐。两版各约23–24MB，不把它们称为已适合整片森林或PWA离线可用；本次原生416k与381k画面待云端检查。主要借鉴点为真实针叶RGB/alpha、树皮normal/roughness和作者枝叶结构；出处[Poly Haven原作者页](https://polyhaven.com/a/pine_tree_01)及上述固定源码/纹理清单。

[0b2a1d5树模型运行38015041430](https://github.com/orriduck/chill-window/actions/runs/38015041430)通过，已读完整health并实际查看旧松树/原生/仅减枝干/隐藏/返回车窗五图。初次GPU预热14686ms，所有对照和返回49/49、缺块/迟到0，无请求或运行错误；此套件不含全线连续或四站。原生与减枝干图的轮廓一致，但地图相机minDistance=100把申请的近距离机位推远，树冠仍显细小/偏疏；不能以这几图判定主要森林自然目标达成。后续756e6a3放开12m最小距离、允许近水平观察，机位高于实际地面，并在来源对照时隔离区块线/路线帮助图形；待新图进一步判断针叶与树皮。桦树来源元数据不能证明摄影纹理，但用户目标是自然外观，所以增加同机位实际对照再判断，不因元数据预先当作合格或不合格。

[4b5fa34完整运行38014046719](https://github.com/orriduck/chill-window/actions/runs/38014046719)失败：实际620m/六次缺块与迟到0，树显隐、建筑PBR/原体块/隐藏、远地图返回及Garrison跳转已记录为49/49；在随后Manitou重新载入世界时到达原1500秒执行时限，浏览器被终止。health明确runtimePassed=false，不能说完整四站通过；此前d7完整四站证据仍保留。已读取完整health与失败日志，此次将完整套件时限改为2400秒/45分钟job，覆盖余下世界重新准备和新增树对照；测试要求不减少。

建筑补充研究：[USGS LiDAR Explorer](https://www.usgs.gov/tools/lidarexplorer)、[点云来源说明](https://www.usgs.gov/faqs/what-lidar-data-and-where-can-i-download-it)、[实际2022片区记录](https://www.sciencebase.gov/catalog/item/66f3a453d34e791ae5dfa5a0)、[laspy分类/分块读示例](https://laspy.readthedocs.io/en/latest/examples.html)。实际查询和OSM源足迹保存在`scripts/experiments/peekskill-lidar/source-selection.json`。云端[ef7c17b首次扫描](https://github.com/orriduck/chill-window/actions/runs/38015443417)与[0d5e05e未分类点扫描](https://github.com/orriduck/chill-window/actions/runs/38016007012)均成功，读取实际报告：10,808,037B LAZ、1,740,009点，SHA `47b0fedc079e8c41fe65256058deb1d9cbc45b4bb417cb02d35f5c844f4e78cc`；2022项目、2024-09-23发布，WKT为NAD83(2011)/UTM18N加NAVD88/GEOID18、三轴米。源数据没有分类6，三栋足迹中分类1样本分别26,925/1,996/943；不能称其为已分类屋顶，可能包含树木。暂只保留真实观察用于后续屋顶归属/形状判断，没有改运行高度或造出新屋顶。

另查[Westchester官方DSM服务](https://giswww.westchestergov.com/arcgis/rest/services/DigitalSurfaceModel/MapServer)、[2023航片服务](https://giswww.westchestergov.com/arcgis/rest/services/MappingWestchesterCounty_AerialPhoto2023/MapServer)。DSM服务目录没有提供本次可直接用的屋顶三维网格；航片元数据为2023-03-20、6英寸自然色正射，不能提供建筑立面。服务注明禁止exportTiles；本轮仅读取服务元数据，没有抓取瓦片、接入图片或宣称开放再分发许可。
