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
| [Overture building schema](https://docs.overturemaps.org/schema/reference/buildings/building/)、[building guide](https://docs.overturemaps.org/guides/buildings/)、[Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/) | schema提供height、num_floors、roof_shape/height/direction、facade属性及sources，字段可为空；building_part可表述复杂建筑。优先OSM几何、合并匹配高度；官方匹配IoU>0.5。STAC实际读到latest=2026-09-23.1；尚未查询Hudson区域数量/高度覆盖。 | 云端建筑扩充与来源标注 |
| [Microsoft GlobalMLBuildingFootprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | 影像提取轮廓与模型估计高度，缺失高度为-1。可作数据候选，不能把预测高度称作测量值。NYS LiDAR可进一步研究，但本轮未取得建筑级点云高度。 | 真实建筑覆盖候选 |

直接案例 [YusufEminoglu/osm_3d_model](https://github.com/YusufEminoglu/osm_3d_model) 也可研究，其README明确包含procedural建筑/树木等细节；与“全部真实数据”的目标需要区分实际OSM几何和生成的细节，不能整体照搬并宣称真实。

## 2026-10-09：真实 Hudson 车站数据

| 来源 | 具体借鉴或核查 | 受影响的文件 |
| --- | --- | --- |
| [MTA Hudson Line 官方站点/时刻表](https://www.mta.info/schedules/metro-north/hudson) | 实际读取到生效日期 October 4, 2026 的 PDF；核对 Cold Spring、Garrison、Manitou、Peekskill 的名称与北南顺序。站台触感警示条、坡道等图例仅作后续实景研究线索，不作为已取得具体站台模型的证据。 | `app/scripts/prepare-hudson-stations.py`、`app/public/geodata/hudson/stations.json` |
| [Amtrak Empire Service 官方时刻表](https://content.amtrak.com/content/timetable/Empire%20Service.pdf) | 本日读取到 October 9, 2026 的 PDF；Croton-Harmon 与 Poughkeepsie 为这一段两端外的 Amtrak 停靠站，以上四个中间 Metro-North 站应表示经过而非 Empire Service 停靠。未导入班次时间。 | 同上，站点服务元数据 |
| [OSM Overpass API](https://overpass-api.de/api/interpreter)、[OSM 署名/许可](https://www.openstreetmap.org/copyright) | 实际取得区域内 31 条原始 OSM 对象；完整站台点/线/面几何与 stop_area 成员保留。派生保留 26 个地理对象、5 个站点，其中 4 个位于当前 FRA 路段，关联 8 条站台几何；Breakneck Ridge 距北端 1125m，在当前路段外。Manitou 的两个站台尚未成为 stop_area 成员，按75m内最近站点关联，明确标为几何推断。 | `sources/overpass-stations.ql`、`.json.gz`、`.request.json` 与 `stations.json` |

精确请求、OSM 数据时间、SHA-256、原始标签和平台关联依据已留档。站台 height 标签含 `4'`、`4` 和缺失值，不能统一当4米使用；Garrison另有带 disused 标签的轮廓，不能当作活跃站台。当前仅完成可复现的数据接续，尚未接入渲染或通过车站画面验收；站棚/立面/材质需要另查实景，不能从站点坐标编造。
