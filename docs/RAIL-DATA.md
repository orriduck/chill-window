# 全国 Amtrak 路线目录数据包

本目录是独立数据工作区，未修改主 app。来源为官方 FRA / BTS 的 [NTAD Amtrak Routes 图层](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0)，字段说明参考图层指向的 [官方数据字典 DOI](https://doi.org/10.21949/1529009)。核查与获取日期为 2026-11-09；下载的原始元数据与响应均保留，可离线重建。

## 结果与范围

- 49 条来源路线记录，5 页（10 + 10 + 10 + 10 + 9），564 条原始 path。
- 703,831 个顶点，703,267 条相邻顶点线段；未增加任何跨 path 连接线。
- `catalog.json`（schemaVersion=2，含分段预览）为 174,877 字节，49 个乘坐 JSON 共 16,303,038 字节，最大单文件 1,338,610 字节；原始 GeoJSON 合计 16,254,683 字节（均未压缩）。这是完整路线几何，不应在首屏一次性加载全部。
- 覆盖 **该 NTAD 快照中的 Amtrak 客运路线**，不是美国所有货运、通勤、区域或城市铁路，也不是可运行的全美铁路调度网络。
- 图层描述中的“covers all 50 states and DC”不能解释为 Amtrak 在每个州都有列车。实际图层范围约为经度 -123.20 至 -69.96、纬度 25.85 至 49.27，且有加拿大路线段；本数据包没有按美国边界裁切。
- 不含时刻表、实时运营状态、站点停靠序列、列车班次、速度、海拔或 DEM。来源名称可能有旧服务名称或拼写问题，本包原样保留，不擅自按当前运营状况修订。

## 来源时间与许可

图层描述称数据于 **2026-05-12** 更新；ArcGIS `dataLastEditDate` 对应 **2026-05-14T17:20:05.669Z**，两者分别保留，不混为同一时间。获取开始时间、完成时间、每个请求 URL 与 SHA-256 在 `raw/manifest.json` 中，来源时间与版权同时写入 catalog。

图层原文版权声明：

> This NTAD dataset is a work of the United States government as defined in 17 U.S.C. § 101 and as such are not protected by any U.S. copyrights. This work is available for unrestricted public use.

完整版权字符串（含来源原始空白字符）保存在 catalog 和 raw layer 元数据。请在产品数据说明中保留 FRA / USDOT / BTS NTAD 来源，不把本目录代码的整理工作误称为原始测绘。

## 文件与接入

```text
build_routes.py       下载、整理及完整性校验脚本（仅 Python 标准库）
test_routes.py        断点、坐标、分页 ID、WGS84、端点拼接/分叉/环测试
catalog.json         紧凑路线索引与共用 provenance
rides/*.json         app 乘坐契约，逐路线 components / 默认最长段 / 各段长度
routes/*.geojson     每条来源记录一个原始 GeoJSON Feature / MultiLineString
raw/layer*.json      下载前后图层元数据
raw/count-*.json     下载前后记录总数
raw/ids-*.json       下载前后完整对象 ID 清单
raw/page-*.json      未更改的分页响应，保留完整坐标精度
raw/manifest.json    所有原始请求、分页信息与原始响应 SHA-256
validation.json     结果统计、catalog SHA-256 与通过的校验项
```

app 先加载 catalog（schemaVersion=2）展示名称、包围盒和分段 preview；选中后只加载对应 `file`（rides JSON）。`geojsonFile` 是审计原始 GeoJSON 的附加入口。乘坐 JSON 的 `components` 为 `[component][vertex][longitude,latitude]`；地图 preview 也逐段独立，不可 flat 连线。

```js
// catalog.json
{ schemaVersion: 2, source: { url, retrievedAt, license, /* provenance */ },
  routes: [{ id, name, bounds, lengthMetres, componentCount, file,
             preview, defaultComponentIndex, geojsonFile, /* audit fields */ }] }
// rides/<id>.json
{ id, name, components: [[[lon,lat], /* ... */], /* ... */], source,
  componentLengthsMetres: [/* 与 components 顺序一致 */], defaultComponentIndex }
```

乘坐段为原始路径图的最大非分叉 trail：只在**原始坐标完全相同、端点度数为 2**时拼接，必要时反向，不在分叉处猜测方向，也不吸附微小缺口。闭环单独保留，重复边保留。内部顶点交叉但端点图未连接时保持独立。该快照实际端点度数只有 1、3、4，没有 2，所以拼接规则没有改变此次 564 条 source paths；没有为了凑成长路线而跨越分叉。默认索引选择最长乘坐段，app 必须提供其他段选择，不能据此声称已获得完整端到端车次行程。

preview 使用逐段 RDP（0.01°容差，仅用于小地图预览），与乘坐文件的高精度完整几何分开。`lengthMetres` 是全路线各段之和，单段进度/时间应使用 `componentLengthsMetres[selectedIndex]`。默认段为 `components[defaultComponentIndex]`。

原始 GeoJSON 仍始终为 MultiLineString，所有 source path、顶点及其顺序保持不变。其 `coordinates` 不能 flat 当作连续折线。

`routeId` 为 `ntad-amtrak-{OBJECTID}`，源图层 OBJECTID 不保证在提供方重发布后永久稳定；不要仅按名称做外键或去重，不同服务会共享轨道。`routeUrl` 保留源 `ROUTE_URL`，未额外请求或验证这些链接的当前可用性。

## 字段语义与拓扑约定

| 字段 | 含义 |
| --- | --- |
| id / routeId / name | 来源层对象 ID 派生标识 / 原始路线名称 |
| bounds | 输出坐标的 `[west,south,east,north]`，EPSG:4326 |
| geodesicLengthM | WGS84 椭球 Vincenty inverse；仅对每个 path 内相邻点求和，单位米 |
| componentCount | 可选择乘坐的非分叉 trail 数，与 rides JSON components 对齐 |
| connectedGroupCount / components | 按完全相等原始顶点计算的连通组数；旧字段 components 在 catalog 中仅为数字审计值，勿与乘坐 JSON 的坐标数组混淆 |
| sourcePaths | 原始 ArcGIS paths 数，原始 GeoJSON 逐条保留，不拼接、排序或反向 |
| segments | 各 path 的 `顶点数 - 1` 总和，不是 path 数 |
| vertices | 原始顶点数，输出不简化、不删点 |
| sourceObjectId / routeUrl | 官方 OBJECTID 与 ROUTE_URL |
| file / sha256 / bytes | 相对于目录根的文件路径、SHA-256 与字节数 |

输出坐标保留小数点后 6 位（纬向约 0.11 米），符合原数据标称 1:24,000 或更好的地图用途；这只是编码精度，不是定位精度保证。没有 RDP 简化，没有断点强连。连通组在取整前计算，极小间隙不会因取整相同而被统计成连接；原始坐标保存在 raw。几何交叉但没有完全相同顶点时不视为连通；该计数是可复现的保守几何连通统计，不是经过铁路运营拓扑修复的网络。

长度基于输出坐标计算，Vincenty 使用 WGS84 长半轴 6378137 米与扁率 1/298.257223563；算法不收敛会直接报错，不静默回退。长度包括来源所有分支/复用几何，不是某趟列车的单一端到端行程里程；不同路线之间重复轨道也分别计入，不能相加当作全国独有轨道总长。

## 运行与验证

```sh
# 在线刷新，默认小页主动覆盖分页逻辑；仅请求这一个路线图层
python3 chill-national-data/build_routes.py

# 不联网，验证 raw SHA 并从保留响应重建全部输出
python3 chill-national-data/build_routes.py --offline

# 单元验证
python3 -m unittest discover -s chill-national-data -p 'test_routes.py'
```

单页上限为 2,000，服务声明 `supportsPagination=true`，脚本采用 `OBJECTID ASC` + `resultOffset` / `resultRecordCount`。默认 10 条一页，是为了实际检验跨页完整性，而不是依赖单页刚好装得下。下载前取 count + 全部 IDs；每页核查预期大小；合并后核查数量、ID 唯一性、ID 集合完全相等；再取 count + IDs + layer，拒绝下载期间修改时间或记录集合变化。ArcGIS 不是事务快照，该策略检测可观察变化，不能保证服务存在未反映在编辑时间中的内部变化。

落盘后重新读取逐路线文件，比较每一个 path、顶点、顺序与原始坐标取整结果完全相等；检查 WGS84 有限坐标、所有 catalog 引用文件存在、原始与产物 SHA-256 相符。单元测试还用两个相距很远的 path 证明长度没有计入中间缺口，检查相接 path 保持两条几何但属于一个连通组，拒绝 NaN/越界坐标，拒绝缺页/重复/多余 IDs，并用赤道 1° 的 WGS84 参考距离验证长度计算。

乘坐文件另用无向边多重集合与原始 paths 比较，保留每条边的出现次数，检查无新增缺口边、无丢边；测试覆盖端点反向拼接、分叉不拼、微小缺口不拼、闭环。

本次在线下载、离线重建与 8 项单元测试均实际执行通过；完整输出见 validation.json。未下载 DEM 或全国其他大型数据，未启动浏览器、GPU、音频，也未发布 app。

## 路线清单

下表由实际 catalog 生成。公里数为 path 内累计几何长度，不是车次运营里程。

| id | 来源名称 | 乘坐段 | 连通组 | 公里 |
| --- | --- | ---: | ---: | ---: |
| [ntad-amtrak-1](rides/ntad-amtrak-1.json) | Acela | 18 | 2 | 746.0 |
| [ntad-amtrak-2](rides/ntad-amtrak-2.json) | Adirondack | 1 | 1 | 613.6 |
| [ntad-amtrak-3](rides/ntad-amtrak-3.json) | Auto Train | 13 | 2 | 1447.3 |
| [ntad-amtrak-4](rides/ntad-amtrak-4.json) | Blue Water | 1 | 1 | 511.7 |
| [ntad-amtrak-5](rides/ntad-amtrak-5.json) | Borealis | 2 | 2 | 660.5 |
| [ntad-amtrak-6](rides/ntad-amtrak-6.json) | California Zephyr | 31 | 4 | 3917.0 |
| [ntad-amtrak-7](rides/ntad-amtrak-7.json) | Capitol Corridor | 4 | 1 | 277.2 |
| [ntad-amtrak-8](rides/ntad-amtrak-8.json) | Capitol Limited | 12 | 1 | 1264.2 |
| [ntad-amtrak-9](rides/ntad-amtrak-9.json) | Cardinal | 12 | 1 | 1846.7 |
| [ntad-amtrak-10](rides/ntad-amtrak-10.json) | Carl Sandburg | 4 | 2 | 421.6 |
| [ntad-amtrak-11](rides/ntad-amtrak-11.json) | Carolinian | 16 | 5 | 1158.0 |
| [ntad-amtrak-12](rides/ntad-amtrak-12.json) | Amtrak Cascades | 13 | 1 | 755.3 |
| [ntad-amtrak-13](rides/ntad-amtrak-13.json) | City Of New Orleans | 6 | 1 | 1506.2 |
| [ntad-amtrak-14](rides/ntad-amtrak-14.json) | Coast Starlight | 17 | 2 | 2227.2 |
| [ntad-amtrak-15](rides/ntad-amtrak-15.json) | Crescent | 30 | 3 | 2236.7 |
| [ntad-amtrak-16](rides/ntad-amtrak-16.json) | Downeaster | 3 | 1 | 231.2 |
| [ntad-amtrak-17](rides/ntad-amtrak-17.json) | Empire Builder | 14 | 2 | 4150.4 |
| [ntad-amtrak-18](rides/ntad-amtrak-18.json) | Ethan Allen Express | 6 | 1 | 498.2 |
| [ntad-amtrak-19](rides/ntad-amtrak-19.json) | Gold Runner | 3 | 1 | 586.4 |
| [ntad-amtrak-20](rides/ntad-amtrak-20.json) | Amtrak Hartford Line | 1 | 1 | 100.1 |
| [ntad-amtrak-21](rides/ntad-amtrak-21.json) | Heartland Flyer | 3 | 1 | 329.9 |
| [ntad-amtrak-22](rides/ntad-amtrak-22.json) | Hiawatha Service | 1 | 1 | 137.4 |
| [ntad-amtrak-23](rides/ntad-amtrak-23.json) | Illini | 5 | 1 | 503.3 |
| [ntad-amtrak-24](rides/ntad-amtrak-24.json) | Illinois Zephyr | 4 | 2 | 421.2 |
| [ntad-amtrak-25](rides/ntad-amtrak-25.json) | Keystone Service | 23 | 1 | 323.9 |
| [ntad-amtrak-26](rides/ntad-amtrak-26.json) | Lake Shore Limited | 12 | 2 | 1864.7 |
| [ntad-amtrak-27](rides/ntad-amtrak-27.json) | Lincol Service Missouri River Runner | 1 | 1 | 900.8 |
| [ntad-amtrak-28](rides/ntad-amtrak-28.json) | Lincoln Service | 2 | 2 | 451.9 |
| [ntad-amtrak-29](rides/ntad-amtrak-29.json) | Maple Leaf | 4 | 2 | 881.4 |
| [ntad-amtrak-30](rides/ntad-amtrak-30.json) | Amtrak Mardi Gras Service | 1 | 1 | 230.7 |
| [ntad-amtrak-31](rides/ntad-amtrak-31.json) | Missouri River Runner | 4 | 1 | 450.2 |
| [ntad-amtrak-32](rides/ntad-amtrak-32.json) | Northeast Regional | 31 | 2 | 1658.1 |
| [ntad-amtrak-33](rides/ntad-amtrak-33.json) | Pacific Surfliner | 7 | 2 | 561.4 |
| [ntad-amtrak-34](rides/ntad-amtrak-34.json) | Palmetto | 25 | 4 | 1416.0 |
| [ntad-amtrak-35](rides/ntad-amtrak-35.json) | Pennsylvanian | 25 | 1 | 714.0 |
| [ntad-amtrak-36](rides/ntad-amtrak-36.json) | Pere Marquette | 1 | 1 | 284.7 |
| [ntad-amtrak-37](rides/ntad-amtrak-37.json) | Piedmont | 6 | 1 | 287.6 |
| [ntad-amtrak-38](rides/ntad-amtrak-38.json) | Saluki | 3 | 1 | 502.5 |
| [ntad-amtrak-39](rides/ntad-amtrak-39.json) | Silver Meteor | 27 | 3 | 2321.3 |
| [ntad-amtrak-40](rides/ntad-amtrak-40.json) | Silver Star | 24 | 6 | 2389.7 |
| [ntad-amtrak-41](rides/ntad-amtrak-41.json) | Southwest Chief | 36 | 5 | 3609.9 |
| [ntad-amtrak-42](rides/ntad-amtrak-42.json) | Sunset Limited | 27 | 2 | 3243.3 |
| [ntad-amtrak-43](rides/ntad-amtrak-43.json) | Texas Eagle | 37 | 5 | 4462.6 |
| [ntad-amtrak-44](rides/ntad-amtrak-44.json) | Valley Flyer | 7 | 2 | 158.8 |
| [ntad-amtrak-45](rides/ntad-amtrak-45.json) | Vermonter | 15 | 3 | 974.9 |
| [ntad-amtrak-46](rides/ntad-amtrak-46.json) | Wolverine | 1 | 1 | 490.0 |
| [ntad-amtrak-47](rides/ntad-amtrak-47.json) | Winter Park Express | 1 | 1 | 101.0 |
| [ntad-amtrak-48](rides/ntad-amtrak-48.json) | Empire Service | 1 | 1 | 747.3 |
| [ntad-amtrak-49](rides/ntad-amtrak-49.json) | Floridian | 23 | 3 | 3292.8 |

本次 catalog SHA-256：`00cccde2e53876015d5d9a4bb31a3d576a2f844bcadb9080ba09b709c23ae257`。
