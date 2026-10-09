import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildingHeight, buildingStructureKind, platformRise, type GeoData, type MappedFeature } from './GeoData'
import { buildingAppearance } from './GeoBuilding'
import type { RealWorld } from './RealWorld'
import { LAND_COVER } from './GeoLandCover'

export interface GeoCommand { editing?: boolean; jump?: number; recenter?: boolean; time?: 'day' | 'night'; weather?: 'clear' | 'rain' }
/** Geographic inspection uses the ride's actual data and has no synthetic
 * scene selector. The progress control changes the train only on Apply. */
export class GeoInspector {
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 18000)
  readonly controls: OrbitControls
  private bar = document.createElement('section')
  private panel = document.createElement('section')
  private status = document.createElement('output')
  private position = document.createElement('output')
  private attribution = document.createElement('a')
  private source = document.createElement('span')
  private view: HTMLButtonElement
  private center: HTMLButtonElement
  private progress = document.createElement('input')
  private checkpoint = document.createElement('select')
  private jump: HTMLButtonElement
  private time = document.createElement('select')
  private weather = document.createElement('select')
  readonly layers = { ground: true, vegetation: true, settlements: true, buildings: true, farBuildings: true, closeTrees: true, treeSamples: false, water: true, farmland: true, stations: true, sourceLandCover: false }
  private pending: GeoCommand = {}
  private data: GeoData | null = null
  private real = true
  private editing = false
  private error = ''
  private readout = document.createElement('output')
  private buildingStats = document.createElement('output')
  private streamingStats = document.createElement('output')
  private stationReadout = document.createElement('output')
  private performanceReadout = document.createElement('output')
  private motionReadout = document.createElement('output')
  private landCoverReadout = document.createElement('output')
  private buildingQuery = document.createElement('input')
  private buildingSource = document.createElement('output')
  private buildingCase: HTMLButtonElement
  private treeStats = document.createElement('output')
  private treeCase: HTMLButtonElement
  private world: RealWorld | null = null
  private lastPointer: [number, number] = [0, 0]
  private canvas: HTMLCanvasElement
  private ray = new THREE.Raycaster()
  constructor(canvas: HTMLCanvasElement, initiallyReal: boolean) {
    this.canvas = canvas
    this.real = initiallyReal
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false; this.controls.minDistance = 100; this.controls.maxDistance = 7000
    this.controls.minPolarAngle = 0.06; this.controls.maxPolarAngle = Math.PI * 0.43
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    const font = 'font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;'
    this.bar.style.cssText = `position:fixed;left:18px;top:18px;right:18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:10004;pointer-events:none;${font}`
    this.bar.setAttribute('aria-label', '地理世界工具栏')
    this.source.setAttribute('aria-label', '世界数据来源')
    this.source.style.cssText = 'pointer-events:auto;border:1px solid #d8dccb;border-radius:6px;padding:7px 10px;background:#f1efe4;color:#32442f;font:inherit;'
    this.source.textContent = '真实路线 · 哈德逊河'
    this.view = this.button('俯视调试 · F5', () => { this.pending.editing = !this.editing })
    this.center = this.button('回到列车附近', () => { this.pending.recenter = true })
    this.status.setAttribute('aria-label', '真实地理加载状态')
    this.status.style.cssText = 'background:#243829e8;color:#f3f0e5;border-radius:6px;padding:7px 10px;font-size:11px;'
    this.position.setAttribute('aria-label', '真实列车位置')
    this.position.style.cssText = 'background:#243829e8;color:#f3f0e5;border-radius:6px;padding:7px 10px;font-size:11px;'
    const attribution = this.attribution; attribution.href = 'https://www.openstreetmap.org/copyright'
    attribution.textContent = '© OpenStreetMap contributors'; attribution.target = '_blank'; attribution.rel = 'noopener noreferrer'
    attribution.style.cssText = 'pointer-events:auto;padding:5px 8px;background:#243829c9;color:#f3f0e5;font-size:10px;border-radius:5px;'
    this.bar.append(this.source, this.view, this.center, this.status, this.position, attribution)
    this.panel.setAttribute('aria-label', '真实路线检查')
    this.panel.style.cssText = `position:fixed;right:18px;top:76px;width:270px;max-width:calc(100vw - 36px);max-height:calc(100dvh - 100px);overflow:auto;padding:18px;background:#f1efe4f5;color:#2b3a2e;border:1px solid #d8d7c5;border-radius:9px;box-shadow:0 10px 36px #13281930;z-index:10003;display:none;${font}`
    const title = document.createElement('strong'); title.textContent = 'Empire Service · 南行'
    const description = document.createElement('p'); description.textContent = '同一份真实地理数据 · 拖动平移 / 滚轮缩放 / 右键旋转。点击地面定位最近线路里程。'; description.style.cssText = 'font-size:11px;color:#697566;margin:8px 0 14px;'
    this.checkpoint.setAttribute('aria-label', '真实路线片段'); this.checkpoint.style.cssText = this.source.style.cssText + 'width:100%;'
    this.checkpoint.onchange = () => { this.progress.value = this.checkpoint.value; this.refreshPreview(); if (this.data) this.recenter(Number(this.progress.value)) }
    this.progress.type = 'range'; this.progress.min = '0'; this.progress.max = '1'; this.progress.step = 'any'
    this.progress.setAttribute('aria-label', '真实路线里程'); this.progress.style.cssText = 'display:block;width:100%;accent-color:#536d4f;margin:14px 0 6px;'
    this.progress.oninput = () => { this.refreshPreview() }
    this.readout.setAttribute('aria-label', '选中真实路线位置'); this.readout.style.cssText = 'display:block;font-size:11px;margin:0 0 10px;color:#62715d;'
    this.buildingStats.setAttribute('aria-label', '真实建筑数据统计'); this.buildingStats.style.cssText = 'display:block;padding:8px;background:#e5e5d6;border-radius:6px;font-size:11px;line-height:1.7;margin:10px 0;'
    this.streamingStats.setAttribute('aria-label', '地理区块流式加载诊断'); this.streamingStats.style.cssText = 'display:block;padding:8px;background:#dce6d8;border-radius:6px;font-size:11px;line-height:1.65;margin:8px 0;'
    this.stationReadout.setAttribute('aria-label', 'Metro-North 实际车站'); this.stationReadout.style.cssText = 'display:block;padding:8px;background:#e8e1d2;border-radius:6px;font-size:11px;line-height:1.65;margin:8px 0;'
    this.performanceReadout.setAttribute('aria-label', '地理渲染性能'); this.performanceReadout.style.cssText = this.streamingStats.style.cssText
    this.motionReadout.setAttribute('aria-label', '地理运动门控'); this.motionReadout.style.cssText = this.streamingStats.style.cssText
    this.landCoverReadout.setAttribute('aria-label', '真实土地覆盖来源'); this.landCoverReadout.style.cssText = this.streamingStats.style.cssText
    this.buildingQuery.type = 'search'; this.buildingQuery.placeholder = '查询 OSM ID / GERS ID'; this.buildingQuery.setAttribute('aria-label', '查询建筑源记录 ID 或 GERS ID'); this.buildingQuery.style.cssText = this.checkpoint.style.cssText + 'margin:4px 0;'
    this.buildingQuery.addEventListener('change', () => this.showBuildingById(this.buildingQuery.value))
    this.buildingCase = this.button('定位 Peekskill 源建筑案例', () => this.locateBuildingCase())
    this.buildingCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    this.buildingSource.setAttribute('aria-label', '建筑来源记录详情'); this.buildingSource.style.cssText = 'display:block;min-height:44px;font-size:11px;line-height:1.6;overflow-wrap:anywhere;'
    this.jump = this.button('列车跳到这个位置', () => { this.pending.jump = Number(this.progress.value) })
    this.jump.style.cssText += 'width:100%;background:#4d684a;color:#f5f1e3;'
    for (const [element, label, values] of [[this.time, '地理检查时段', [['day', '白天'], ['night', '夜晚']]], [this.weather, '地理检查天气', [['clear', '晴天'], ['rain', '雨天']]]] as const) {
      element.setAttribute('aria-label', label); element.style.cssText = this.source.style.cssText + 'margin-top:12px;margin-right:8px;'
      for (const [value, text] of values) { const option = document.createElement('option'); option.value = value; option.textContent = text; element.append(option) }
    }
    this.time.onchange = () => { this.pending.time = this.time.value as 'day' | 'night' }
    this.weather.onchange = () => { this.pending.weather = this.weather.value as 'clear' | 'rain' }
    const notes = document.createElement('p'); notes.textContent = '地形：USGS 3DEP，约 20m 采样。轨面/水位为可视化近似。建筑只在来源高度可用时挤出；Microsoft 高度保持模型估计，缺失高度或仅有楼层数时只画 footprint。OSM/Overture 的 shelter 使用开放顶棚与估算支柱，不画实墙。源颜色优先保留；只有材料标签时用调色板表达材质类别，不是实景立面采样。屋顶形状保留源属性，只有 roof_height 有来源值时才生成坡顶。'; notes.style.cssText = 'font-size:11px;color:#697566;margin:14px 0 8px;'
    const credits = document.createElement('div'); credits.style.cssText = 'font-size:11px;display:flex;gap:10px;'
    for (const [name, url] of [['FRA / Amtrak', 'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Amtrak_Routes/FeatureServer/0'], ['USGS', 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'], ['© OSM', 'https://www.openstreetmap.org/copyright'], ['Overture Maps', 'https://docs.overturemaps.org/guides/buildings/']]) {
      const link = document.createElement('a'); link.textContent = name; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.color = '#506b51'; credits.append(link)
    }
    const layers = document.createElement('div'); layers.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin:10px 0;'
    for (const [key, name] of [['ground', '地表'], ['vegetation', '林木'], ['buildings', '建筑'], ['farBuildings', '远景建筑'], ['settlements', '道路'], ['stations', 'Metro-North 站台'], ['water', '水域'], ['sourceLandCover', 'NLCD 分类对照']] as const) {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.layers[key]
      input.setAttribute('aria-label', `真实地理${name}`); input.onchange = () => { this.layers[key] = input.checked }
      label.append(input, document.createTextNode(name)); layers.append(label)
    }
    const diagnostics = document.createElement('details'), summary = document.createElement('summary')
    summary.textContent = '数据来源与加载诊断'; summary.style.cssText = 'cursor:pointer;font-size:12px;margin-top:14px;'
    this.treeStats.setAttribute('aria-label', '三维树模型准备诊断'); this.treeStats.style.cssText = this.streamingStats.style.cssText
    const treeLayers = document.createElement('div'); treeLayers.style.cssText = layers.style.cssText
    for (const [key, name] of [['closeTrees', '常绿林近景三维树'], ['treeSamples', '树模型来源尺度对照']] as const) {
      const label = document.createElement('label'), input = document.createElement('input')
      input.type = 'checkbox'; input.checked = this.layers[key]; input.setAttribute('aria-label', name)
      input.onchange = () => { this.layers[key] = input.checked }
      label.append(input, document.createTextNode(name)); treeLayers.append(label)
    }
    this.treeCase = this.button('定位树模型对照', () => {
      if (!this.world || this.world.treeComparison.stats.preparedTrees < 2) return
      const point = this.world.treeComparisonPoint
      this.layers.treeSamples = true
      const input = treeLayers.querySelector<HTMLInputElement>('[aria-label="树模型来源尺度对照"]')
      if (input) input.checked = true
      const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
      this.controls.target.copy(point)
      this.camera.position.set(point.x + 70, point.y + 40, point.z + 70)
      this.controls.update(); this.controls.enableDamping = damping
    })
    this.treeCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    const treeNotice = document.createElement('p')
    treeNotice.textContent = '来源模型：18m Scots pine / 约8.6m橡树街树，保留作者尺度。近景松树只用于NLCD常绿林的外观样本；地理分类不识别逐株树种。橡树仅在此对照显示。模型和内嵌纹理随应用预加载，不表示当地实测树木。'
    treeNotice.style.cssText = notes.style.cssText
    diagnostics.append(summary, this.buildingStats, this.landCoverReadout, this.streamingStats, this.performanceReadout, this.motionReadout, this.stationReadout, treeLayers, this.treeCase, this.treeStats, treeNotice, this.buildingQuery, this.buildingCase, this.buildingSource, notes, credits)
    this.panel.append(title, description, layers, this.checkpoint, this.progress, this.readout, this.jump, this.time, this.weather, diagnostics)
    document.body.append(this.bar, this.panel)
    canvas.addEventListener('pointerdown', this.onDown); canvas.addEventListener('pointerup', this.onUp)
    this.applyVisibility()
  }
  private button(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = action
    button.style.cssText = 'pointer-events:auto;border:1px solid #d8dccb;border-radius:6px;padding:7px 10px;background:#f1efe4;color:#32442f;font:inherit;cursor:pointer;'
    return button
  }
  setData(data: GeoData) {
    this.data = data
    const stats = data.buildingStats
    this.buildingStats.textContent = `建筑组件 ${stats.total.toLocaleString()} 个（新增 Overture ${stats.added.toLocaleString()}）\n源高度标签 ${stats.sourceTag.toLocaleString()} · Microsoft 模型估计 ${stats.sourceEstimate.toLocaleString()} · 仅楼层数 ${stats.floorsOnly.toLocaleString()} · 高度缺失 ${stats.missing.toLocaleString()}\n屋顶/立面材质 ${stats.roofMaterials}/${stats.facadeMaterials} · 有来源颜色 ${stats.sourceColors} · 屋顶记录 ${stats.roof.toLocaleString()} · 构件 ${stats.parts}\n开放遮棚 ${stats.shelters} · 已记录楼层 ${stats.floorTags.toLocaleString()}\n数据：Overture ${data.buildingOverlay?.release ?? '未加载'} · 原始 OSM footprint ${(stats.total - stats.added).toLocaleString()}`
    this.progress.max = String(data.length); this.progress.value = String(data.checkpoints[0].s)
    for (const point of data.checkpoints) { const option = document.createElement('option'); option.value = String(point.s); option.textContent = point.label; this.checkpoint.append(option) }
    this.refreshPreview(); this.applyVisibility()
  }
  fail(message: string) { this.error = message; this.applyVisibility() }
  setReal(value: boolean) { this.real = value; this.applyVisibility() }
  setEditing(value: boolean, s: number) {
    if (value !== this.editing && value && this.real && this.data) { this.progress.value = String(s); this.recenter(s); this.refreshPreview() }
    this.editing = value; this.controls.enabled = value && this.real && !!this.data; this.applyVisibility()
  }
  private applyVisibility() {
    this.attribution.style.display = this.real ? '' : 'none'
    for (const element of [this.view, this.status, this.position]) element.style.display = this.real ? '' : 'none'
    this.center.style.display = this.real && this.editing ? '' : 'none'
    this.panel.style.display = this.real && this.editing && !!this.data ? '' : 'none'
    this.view.textContent = this.editing ? '返回列车 · Esc' : '俯视调试 · F5'
    this.view.disabled = this.center.disabled = !this.data
    if (this.real && this.error) this.status.textContent = `真实场景加载失败 · ${this.error}`
    else if (this.real && !this.data) this.status.textContent = '正在加载真实路线 / 高程 / 地物…'
  }
  resize(width: number, height: number) { this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix() }
  setPerformance(fps: number, frameMs: number, submitMs: number, info: THREE.WebGLInfo) {
    this.performanceReadout.textContent = `${fps} FPS · 帧间隔 ${frameMs.toFixed(1)}ms · CPU 提交 ${submitMs.toFixed(1)}ms\n绘制 ${info.render.calls} 次 · 三角形 ${Math.round(info.render.triangles).toLocaleString()} · 几何 ${info.memory.geometries} · 纹理 ${info.memory.textures}`
  }
  setMotionDiagnostic(requested: number, target: number, paused: boolean, inspection: boolean, ready: boolean, covered: boolean, jump: number | null) {
    this.motionReadout.textContent = `请求/目标速度 ${requested.toFixed(1)}/${target.toFixed(1)}m/s · 暂停 ${paused} · 俯视 ${inspection}\n预热 ${ready} · 下一步覆盖 ${covered} · 跳转目标 ${jump === null ? '无' : jump.toFixed(1)}`
  }
  recenter(s: number) {
    if (!this.data) return
    this.progress.value = String(s); this.refreshPreview()
    const pose = this.data.pose(s), y = this.data.heightAt(pose.x, pose.z) ?? 0
    const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
    this.controls.target.set(pose.x, y, pose.z); this.camera.position.set(pose.x + pose.dz * 1100, y + 1250, pose.z - pose.dx * 1100 + 850)
    this.controls.update(); this.controls.enableDamping = damping
  }
  update(s: number, world: RealWorld | null) {
    if (!this.real || !this.data || !world) return
    this.world = world
    const trees = world.closeTrees.stats, samples = world.treeComparison.stats
    this.treeCase.disabled = !samples.ready || samples.preparedTrees < 2
    this.treeStats.textContent = `常绿林3D ${trees.ready ? '已准备' : '加载中'} · ${trees.preparedTrees} 位置样本\n局部显示 ${trees.visibleTrees} 株 / ${trees.visibleDrawCalls} 合批 · ${trees.visibleTriangles.toLocaleString()} 三角形\n来源尺度对照 ${samples.ready ? '已准备' : '加载中'} · ${samples.preparedTrees} 株 · ${samples.processedAssetBytes.toLocaleString()} B\n模型在初始GPU离屏预热中提交；当前显示统计是距离筛选上界，不是实际frustum绘制次数。`
    if (this.editing) this.controls.update()
    const pose = this.data.pose(s)
    const focus = this.editing ? this.controls.target : pose
    const cover = this.data.landCover, code = cover?.sample(focus.x, focus.z) ?? null
    this.landCoverReadout.textContent = cover
      ? `USGS Annual NLCD ${cover.snapshot.year} · 原数据30m / WMS分类采样约30m\n当前${this.editing ? '俯视中心' : '列车位置'}：${code === null ? '无覆盖' : `${code} ${LAND_COVER.get(code)?.label ?? ''}`}\n41/42/43林地补充OSM；绿色林地、粉红/红色开发区、蓝色水域。分类与逐株位置不同；原OSM水域/土地几何优先。`
      : '未接入 NLCD 土地覆盖数据。'
    const stream = world.streamingStats
    this.status.dataset.sceneFrame = String(stream.sceneFrame)
    this.status.textContent = this.error ? `真实场景加载失败 · ${this.error}` : `${stream.visible}/49 可视区块 · 缓存 ${stream.cached} · DEM 20m${!stream.ready ? ' · 正在加载周边场景' : stream.pending ? ' · 预建中' : ' · 场景就绪'}`
    this.position.textContent = `${(pose.s / 1000).toFixed(2)} / ${(this.data.length / 1000).toFixed(2)} km · ${pose.latitude.toFixed(5)}, ${pose.longitude.toFixed(5)}${s >= this.data.length - 0.01 ? ' · 样板终点' : ''}`
    this.streamingStats.textContent = `预加载队列 ${stream.prefetchPending} · 前方缓冲 ${stream.preloadMetres}m · 最近未建 ${stream.nearestMissingMetres}m\n缓存 ${stream.cached}（当前视野 ${stream.visible}/49）· 最近/最高建块 ${stream.lastBuildMs.toFixed(1)}/${stream.maxBuildMs.toFixed(1)}ms\n视野缺块 ${stream.visibleMissing} · 行驶缺块帧 ${stream.suddenAppearanceFrames} · ${stream.assets}`
    const distant = stream.distantBuildings
    this.streamingStats.textContent += `\nGPU 离屏预热 ${stream.gpuWarmupMs === null ? '待完成' : `${stream.gpuWarmupMs.toFixed(0)}ms · 已完成`} · 后续待上传 ${stream.pendingGpu}`
    this.streamingStats.textContent += `\n远景建筑 ${distant.components.toLocaleString()} 组件 · ${distant.regions} 区域 / ${distant.meshes} 合批\n一次准备 ${distant.prepareMs.toFixed(0)}ms · 几何 ${(distant.geometryBytes / 1048576).toFixed(1)}MiB · ${distant.triangles.toLocaleString()} 三角形`
    const nearest = this.data.stations.filter(station => station.inCurrentRoute).sort((a, b) => Math.abs(a.sMetres - s) - Math.abs(b.sMetres - s))[0]
    this.stationReadout.textContent = nearest
      ? `${nearest.name} · Metro-North Hudson Line · 经行站（Empire Service 不停靠）\n距样板线路里程 ${Math.round(nearest.sMetres - s)}m · ${nearest.platforms.length} 条 OSM 站台几何\n${nearest.platforms.map(platform => {
        const rise = platformRise(platform.tags, nearest.platforms.filter(peer => peer !== platform).map(peer => peer.tags))
        return `${platform.id} · 轨面上 ${rise.metres.toFixed(2)}m ${rise.status === 'source-tag' ? '源标签' : '画面估值'}${rise.raw ? `（原 height=${rise.raw}${rise.status === 'peer-estimate' ? '，未采用原值；参考同站另一站台' : ''}）` : '（来源缺高）'}`
      }).join('\n')}`
      : '当前真实路线包没有可用 Metro-North 站点记录。'
  }
  private refreshPreview() {
    if (!this.data) return
    const pose = this.data.pose(Number(this.progress.value))
    this.readout.textContent = `${(pose.s / 1000).toFixed(2)} km · ${pose.latitude.toFixed(5)}, ${pose.longitude.toFixed(5)}`
  }
  private onDown = (event: PointerEvent) => { this.lastPointer = [event.clientX, event.clientY] }
  private onUp = (event: PointerEvent) => {
    if (!this.real || !this.editing || !this.data || event.button !== 0 || Math.hypot(event.clientX - this.lastPointer[0], event.clientY - this.lastPointer[1]) > 6) return
    const rect = this.canvas.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera)
    const hit = new THREE.Vector3()
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.controls.target.y), hit)) return
    const building = this.data.buildingAt(hit.x, hit.z)
    if (building) this.showBuilding(building)
    this.progress.value = String(this.data.nearestRoute(hit.x, hit.z).s); this.refreshPreview()
  }
  private showBuilding(feature: MappedFeature) {
    const height = buildingHeight(feature)
    const osm = /^osm\/(way|relation|node)\/(\d+)$/.exec(String(feature.id))
    const provenance = feature.provenance
    const overture = provenance?.geometry.gersId ?? provenance?.overtureMatches[0]?.gersId ?? (String(feature.id).startsWith('overture/') ? String(feature.id).slice('overture/'.length) : null)
    const properties = feature.overtureProperties ?? {}
    const appearance = buildingAppearance(feature)
    const sources = Array.isArray(properties.sources) ? properties.sources as Array<{ dataset?: string; record_id?: string; property?: string; version?: string }> : []
    const sourceNames = [...new Set([...(height.sources ?? []), ...sources.map(source => source.dataset).filter((name): name is string => !!name)])]
    this.buildingSource.replaceChildren()
    const label = document.createElement('span')
    const heightLabel = height.status === 'source-tag' ? `${height.metres?.toFixed(1)}m 源标签` : height.status === 'source-estimate' ? `${height.metres?.toFixed(1)}m 来源模型估计` : height.status === 'tagged' ? `${height.metres?.toFixed(1)}m OSM height=${height.raw}` : height.status === 'estimated-from-levels' ? `${height.metres?.toFixed(1)}m 楼层换算估值` : height.status === 'floors-only' ? '仅有楼层数；未推算高度' : '高度缺失；只显示 footprint'
    const roof = properties.roof_shape ?? feature.tags['roof:shape'] ?? feature.tags['building:roof:shape']
    const shelter = buildingStructureKind(feature) === 'open-shelter'
      ? `开放式遮棚 · ${height.metres === null ? `屋顶高度 ${3.6}m 应用估算，侧墙不绘制` : '依据来源高度'} `
      : ''
    label.textContent = `${feature.id} · ${shelter}${heightLabel}${sourceNames.length ? ` · 来源：${sourceNames.join(' / ')}` : ''}${roof ? ` · roof=${String(roof)}` : ''}${properties.roof_height ? ` · roof rise=${String(properties.roof_height)}m` : roof ? ' · roof_height 缺失，未补造坡高' : ''}${properties.roof_orientation ? ` · orientation=${String(properties.roof_orientation)}` : ''}${appearance.roofMaterial ? ` · roof material=${appearance.roofMaterial}` : ''} ${appearance.roofColorSource ? `· roof color ${appearance.roofColor} (${appearance.roofColorSource})` : ''}${appearance.facadeMaterial ? ` · facade=${appearance.facadeMaterial}` : ''} ${appearance.facadeColorSource ? `· facade color ${appearance.facadeColor} (${appearance.facadeColorSource})` : ''}`
    this.buildingSource.append(label)
    if (osm) {
      const link = document.createElement('a'); link.href = `https://www.openstreetmap.org/${osm[1]}/${osm[2]}`; link.textContent = '打开该建筑源记录'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.cssText = 'display:block;color:#506b51;margin-top:3px;'
      this.buildingSource.append(link)
    }
    if (overture) {
      const source = document.createElement('span'); source.textContent = `GERS ${overture}${provenance?.overtureMatches[0] ? ` · IoU ${provenance.overtureMatches[0].iou.toFixed(3)}` : ''} · Overture ${this.data?.buildingOverlay?.release ?? ''}`; source.style.cssText = 'display:block;margin-top:3px;overflow-wrap:anywhere;'
      this.buildingSource.append(source)
    }
    for (const source of sources.filter(item => item.record_id)) {
      const recordId = source.record_id!
      const osmRecord = source.dataset === 'OpenStreetMap' ? /^([wnr])(\d+)(?:@\d+)?$/.exec(recordId) : null
      const record = document.createElement(osmRecord ? 'a' : 'span')
      if (record instanceof HTMLAnchorElement && osmRecord) {
        const type = { w: 'way', n: 'node', r: 'relation' }[osmRecord[1] as 'w' | 'n' | 'r']
        record.href = `https://www.openstreetmap.org/${type}/${osmRecord[2]}`; record.target = '_blank'; record.rel = 'noopener noreferrer'
      }
      record.textContent = `${source.dataset ?? '数据源'} source record ${recordId} · ${source.property || 'geometry'}`
      record.style.cssText = 'display:block;margin-top:2px;overflow-wrap:anywhere;color:#506b51;'; this.buildingSource.append(record)
    }
    const gers = provenance?.geometry.gersId ?? (String(feature.id).startsWith('overture/') ? String(feature.id).slice('overture/'.length) : null)
    const parts = this.data?.buildingParts.filter(part => part.parentFeatureId === `overture/${gers}`) ?? []
    for (const part of parts) {
      const info = document.createElement('span'); info.textContent = `building_part ${part.id} · ${part.height ?? 'height missing'}m · min_height=${part.minHeight}m · facade=${part.facadeMaterial ?? 'missing'} · sources ${part.sourceRecordIds.join(', ') || 'unavailable'}`; info.style.cssText = 'display:block;margin-top:3px;overflow-wrap:anywhere;'; this.buildingSource.append(info)
    }
  }
  private showBuildingById(query: string, focus = false) {
    if (!this.data) return false
    const normalized = query.trim().toLowerCase()
    const feature = this.data.features.find(item => item.kind === 'building' && String(item.id).toLowerCase() === normalized)
      ?? this.data.features.find(item => item.kind === 'building' && (String(item.id).toLowerCase().endsWith(`/${normalized}`) || item.provenance?.geometry.gersId?.toLowerCase() === normalized || item.provenance?.overtureMatches.some(match => match.gersId.toLowerCase() === normalized)))
    if (feature) {
      this.showBuilding(feature)
      if (focus) this.focusBuilding(feature)
      return true
    }
    this.buildingSource.textContent = '未在当前真实数据包中找到该建筑 ID。'
    return false
  }
  private locateBuildingCase() {
    this.showBuildingById('b00509c4-82e0-47d0-8708-cc9c8465530b', true)
  }
  private focusBuilding(feature: MappedFeature) {
    if (!this.data) return
    const x = (feature.bounds[0] + feature.bounds[2]) / 2, z = (feature.bounds[1] + feature.bounds[3]) / 2
    const y = this.data.heightAt(x, z) ?? 0
    const damping = this.controls.enableDamping; this.controls.enableDamping = false
    this.controls.update()
    this.controls.target.set(x, y, z); this.camera.position.set(x + 70, y + 110, z + 70)
    this.controls.update(); this.controls.enableDamping = damping
  }
  get focus() { return this.controls.target }
  consume() { const result = this.pending; this.pending = {}; return result }
  dispose() { this.controls.dispose(); this.canvas.removeEventListener('pointerdown', this.onDown); this.canvas.removeEventListener('pointerup', this.onUp); this.bar.remove(); this.panel.remove() }
}
