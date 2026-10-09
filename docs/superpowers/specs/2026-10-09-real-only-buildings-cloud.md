# 真实世界建筑数据与云端交接

用户最新方向：移除程序生成世界，全部使用真实地理数据，转向取得更多建筑数据；调查可复用的 OSM 开源地景项目。在云端继续开发并给出可直接在浏览器查看的成品，不操作用户电脑上的浏览器。

本次交接基础：已验证的 Empire Service Hudson Highlands 22.84km Three.js 车窗，USGS DEM 与 OSM 地物快照在 public/geodata/hudson，前次来源/验收见 REFERENCES.md 和 docs/visual-checks/2026-10-09-real-hudson/README.md。当前先锁定真实数据入口（旧 world=procedural 不再启用），完整程序引擎移除与建筑数据升级在云端继续。

接续目标：ThreeCanvas 只初始化真实世界；移除程序模式入口、编辑UI、随机城镇/水域和生成器运行时依赖。保留 F5/Esc 独立地理相机、列车运动与计时暂停语义。数据缺失显示错误。

建筑数据方案：先在现有 DEM 覆盖范围内实测 Overture 2026-09-23.1 building/building_part 的数量、height/num_floors/roof属性覆盖；与现有 OSM footprint 按稳定源ID或 IoU>0.5 合并。优先保留最新 OSM 手工轮廓/标注，补充不重复的真实检测轮廓与带来源的高度。未知高度明确标缺失，不统一编造6.2m；Microsoft/Overture ML 高度标为来源估计，不声称实测。保留精确请求、release、source record IDs、原始区域快照与 SHA256，分阶段验证发布，失败保留有效数据。地形 DEM 不等于建筑表面高度。

开源复用：OSM2World（MIT、专门OSM→三维场景、Web模块、glTF/3D Tiles能力）优先评估离线转换并接 Three.js；Blosm（GPL Blender插件）适合离线资产管线；Three-geo-play（MIT Three.js矢量瓦片）为浏览器流式方案候选。不要因为 converter 给出了默认高度/立面就把它当真实数据；不要未经实测就整套替换当前引擎。

调试先行：建筑数量、带height数量、缺失数量、来源估计数量、roof信息覆盖、逐栋来源查询；按高度来源着色。扩大真实建筑加载范围到两岸/城镇，避免新增数据仍只显示六块内少数建筑。视觉检查在云端浏览器进行，截图放仓库外；Vercel preview 构建实际数据文件可用，返回URL。用户明确授权云端交接和浏览器可见预览，未授权 merge/main 改写。

交接约束：新交接分支保存现有相关场景进度，保留本机原工作区；不搬运凭据或 .vercel 配置。本机 localhost 服务保持运行。后续可从公开 GitHub 分支获取全部代码与公开 GIS 数据。云端缺工具/部署凭据时清楚报告限制，不伪装成功。
