# 视觉参考

| 来源 | 借鉴内容 | 关联实现 |
| --- | --- | --- |
| [Slow Roads](https://slowroads.io/) | 低频斑驳草地色彩、路旁木栅栏与自然植被的层次感。 | `app/src/engine/three/terrain/TerrainLOD.ts`、`app/src/engine/three/track/LinesideProps.ts` |
| [Cortiz Dev: stylized-components](https://github.com/cortiz2894/stylized-components)；[配套草地视频](https://www.youtube.com/watch?v=Pqyu7-DDmOM) | 借鉴可迁移的实例化草地思路：贴地覆盖须避开轨道、道路、水体与聚落等工程净空；草叶根部固定，以 GPU 顶点风摆动；保留远近 LOD。没有引入 React Three Fiber、GLB 依赖、逐草阴影或新运行时贴图。决策记录见 [#163](https://github.com/orriduck/chill-window/issues/163)。 | `app/src/engine/three/terrain/TerrainLOD.ts`、`app/src/engine/three/terrain/VegetationWind.ts` |
| [City Tour](https://github.com/jstrait/city-tour) | Three.js 中将程序化世界蓝图转成可视城镇的组织方式；借鉴世界生成与渲染的职责划分，不照搬其城市题材或相机交互。 | 后续场景与城镇生成工作。 |
| [VVVFSimulator](https://github.com/datacrystals/VVVFSimulator) | 以速度、加速度和制动状态驱动牵引/制动音色的配置模型；用于深化列车运行声音。 | `app/src/engine/audio.ts` |

新增图片、卫星图或视频时，补充原始 URL、视频时间戳（如适用）、可观察的具体细节，以及落地的文件路径。
