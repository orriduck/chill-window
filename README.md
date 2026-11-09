# Window Seat · National Rail Preview

继续构建的代码基线是 `codex/hudson-game-style` 的 `931aa751b4baf0428d730e374326697955349bf9`，不是较旧的 main。原本主工作区的未提交工作未被覆盖。

## 当前组合

- React + Three.js：全国真实线路乘车与现有完整 Hudson 车厢模式。
- FRA / BTS NTAD：49条Amtrak来源记录、564个原始路径；目录约171KiB，选择后只加载对应路线。不是全美货运/通勤网络或实时运营图。
- Slop New York启发的地理/外观/有限细节分层：局部坐标、有限地块、共享几何与实例批次、确定性植被与聚落。
- Hudson：真实高程、河道、道路、站台与建筑锚点；已有奇幻风格资产；共享双尺度水面normal动画，不改变源轮廓。
- 全国其他线路：真实平面中心线，生成地形、轨面高度、植被与村落；无DEM，不能作为实景模拟或工程测量。每个连续路径单独乘坐，到端点停，不跨分叉猜测车次。
- 67.js保留为另一个独立创作实验，不作为第二套生产渲染器加载。

## 运行与静音

```sh
cd app
npm ci --no-audit --no-fund
npm run build:preview
npm run preview -- --host 127.0.0.1 --port 4180 --strictPort
node scripts/verify-national.mjs
```

`build:preview` 读取已跟踪的 `.env.preview`，`VITE_SILENT_PREVIEW=1` 在 AudioContext 创建前锁住音频；既有模式也默认关闭音效。验证脚本使用临时 headless Chrome、`--mute-audio`、拦截 AudioContext 和媒体 play 并计数，结束后关闭浏览器；不会发声。

首次页面为全国图册。选路线→选个靠窗位→出发；默认暂停。全国模式支持自由旅行/25/45/60分钟静音专注、暂停、速度、连续片段选择、反向、俯瞰、风格和图层。改变片段、方向或风格会结束当前场景并回到暂停起点。返回图册会结束当前旅程。Hudson保留已有专注/番茄钟与车厢交互。

## 验证与范围

路线数学和CPU几何测试：

```sh
cd app
npx vitest run src/rail/routeMath.test.ts src/engine/network/NetworkRoute.test.ts src/engine/network/NetworkWorld.test.ts --maxWorkers=1
```

数据整理脚本与拓扑校验：`scripts/national-rail/`。脚本输出其所在目录，原始获取工作区的快照、页数、哈希和检查摘要见 `docs/RAIL-DATA.md`、`docs/national-source-manifest.json` 与运行目录的 `rail/validation.json`。

基线全量测试在本次功能实现前已存在6项失败：WindowFrame旧布局断言5项、TimeOfDay旧日间光照断言1项；另有GeoWorldPreparation测试在Node环境导入纹理时的相对URL fetch错误。未通过修改视觉参数或删除断言掩盖这些基线问题。新增定向测试和浏览器验证另列，不宣称整个历史测试套件全绿。

已知边界：路线元数据不等于当前可订票服务；生成走廊急弯可能自交、同步补块存在尖峰、所有路线尚未逐一全程目视/长时验收；RAF间隔不是GPU耗时。全国模式为新独立场景，尚未复用Hudson的完整3D车厢和GPU fence准备门控。正式替换前需要进一步美术和硬件测试。

## 发布

独立Cloudflare静态Worker配置在 `app/wrangler.jsonc`，仅发布 `dist`，不需要运行时API凭据、数据库或自定义域。使用已配置的会话凭据执行 `wrangler deploy --dry-run --config wrangler.jsonc` 后，再执行 `wrangler deploy --config wrangler.jsonc`。不覆盖现有生产站点。

数据许可、源URL、版本及详细评审见 `REFERENCES.md`、`docs/` 与 `app/public/app-version.json`。
