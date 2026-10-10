import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildingHeight, buildingStructureKind, platformRise, type GeoData, type MappedFeature } from './GeoData'
import { buildingAppearance } from './GeoBuilding'
import type { RealWorld } from './RealWorld'
import { LAND_COVER } from './GeoLandCover'
import type { CloseTreeAssetId } from './GeoCloseTrees'

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
  readonly layers = { ground: true, vegetation: true, settlements: true, buildings: true, farBuildings: true, convertedBuildings: true, closeTrees: true, treeSamples: false, treeImpostors: true, water: true, farmland: true, stations: true, sourceLandCover: false, realImagery: true }
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
  private treeModel = document.createElement('select')
  private forestStats = document.createElement('output')
  private forestCase: HTMLButtonElement
  private forestDistance = document.createElement('select')
  private forestDirection = document.createElement('select')
  private convertedStats = document.createElement('output')
  private convertedCase: HTMLButtonElement
  private aerialStats = document.createElement('output')
  private aerialCase: HTMLButtonElement
  private world: RealWorld | null = null
  private lastPointer: [number, number] = [0, 0]
  private canvas: HTMLCanvasElement
  private ray = new THREE.Raycaster()
  constructor(canvas: HTMLCanvasElement, initiallyReal: boolean) {
    this.canvas = canvas
    this.real = initiallyReal
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false; this.controls.minDistance = 12; this.controls.maxDistance = 7000
    this.controls.minPolarAngle = 0.06; this.controls.maxPolarAngle = Math.PI * 0.49
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
    const aerialLabel = document.createElement('label'), aerialInput = document.createElement('input')
    aerialInput.type = 'checkbox'; aerialInput.checked = true; aerialInput.setAttribute('aria-label', '真实地表影像')
    aerialInput.onchange = () => { this.layers.realImagery = aerialInput.checked }
    aerialLabel.append(aerialInput, document.createTextNode('真实地表影像 · 全线 / Peekskill高清'))
    this.aerialCase = this.button('定位真实航片片区', () => {
      if (!this.world?.aerial.stats.ready) return
      const point = this.world.aerial.focusPoint
      if (this.data) { this.progress.value = String(this.data.nearestRoute(point.x, point.z).s); this.refreshPreview() }
      const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
      this.controls.target.copy(point); this.camera.position.set(point.x + 4, point.y + 650, point.z - 80)
      this.controls.update(); this.controls.enableDamping = damping
    })
    this.aerialCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    this.aerialStats.setAttribute('aria-label', '真实航片准备诊断'); this.aerialStats.style.cssText = this.streamingStats.style.cssText
    const aerialNotice = document.createElement('p')
    aerialNotice.textContent = 'USDA-FSA APFO / NOAA Digital Coast，2022 NAIP。6个原始瓦片覆盖全线两侧1200m，2.4m Mercator采样、JPEG压缩RGB与原覆盖mask打包为3个图集；Peekskill局部0.6m高清覆盖其上。地表、水面及近远建筑朝上的面共享地理配准，不提供立面或逐株树模型。影像含拍摄时的树冠、阴影、屋顶及水面颜色；水位和几何仍沿用已有来源/估值。2022-10-22日期来自文件名。出发前完成校验与GPU准备；切换只改变显示。'
    aerialNotice.style.cssText = notes.style.cssText
    const aerialCredit = document.createElement('a'); aerialCredit.textContent = 'USDA-FSA APFO 航片 · NOAA 来源'; aerialCredit.href = 'https://www.fisheries.noaa.gov/inport/item/71609'; aerialCredit.target = '_blank'; aerialCredit.rel = 'noopener noreferrer'; aerialCredit.style.cssText = 'font-size:11px;color:#506b51;'
    this.treeStats.setAttribute('aria-label', '三维树模型准备诊断'); this.treeStats.style.cssText = this.streamingStats.style.cssText
    const treeLayers = document.createElement('div'); treeLayers.style.cssText = layers.style.cssText
    for (const [key, name] of [['closeTrees', '沿线近景三维森林'], ['treeImpostors', '同源远景树冠'], ['treeSamples', '树模型来源尺度对照']] as const) {
      const label = document.createElement('label'), input = document.createElement('input')
      input.type = 'checkbox'; input.checked = this.layers[key]; input.setAttribute('aria-label', name)
      input.onchange = () => { this.layers[key] = input.checked }
      label.append(input, document.createTextNode(name)); treeLayers.append(label)
    }
    this.forestStats.setAttribute('aria-label', '沿线三维森林准备诊断'); this.forestStats.style.cssText = this.streamingStats.style.cssText
    this.forestCase = this.button('定位沿线森林近景', () => {
      if (!this.world || !this.data) return
      const pose = this.data.pose(Number(this.progress.value))
      // Select an existing woodland sample near the inspected route position;
      // the camera moves, never the train or source tree lattice.
      const candidates: THREE.Vector3[] = []
      for (let dx = -112; dx <= 112; dx += 16) for (let dz = -112; dz <= 112; dz += 16) {
        const x = pose.x + dx, z = pose.z + dz
        const code = this.data.landCover?.sample(x, z)
        if (![41, 43].includes(code ?? 0) && !this.data.landAt(x, z, 'forest')) continue
        if (this.data.landAt(x, z, 'water') || this.data.landAt(x, z, 'building') || this.data.railProximity(x, z).distance < 16) continue
        const y = this.world.terrainHeight(x, z)
        if (y !== null) candidates.push(new THREE.Vector3(x, y, z))
      }
      const routePoint = new THREE.Vector3(pose.x, this.data.railHeight(pose.s), pose.z)
      const point = candidates.sort((a, b) => a.distanceTo(routePoint) - b.distanceTo(routePoint))[0]
      if (!point) return
      this.layers.treeSamples = false
      const input = treeLayers.querySelector<HTMLInputElement>('[aria-label="树模型来源尺度对照"]'); if (input) input.checked = false
      const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
      this.controls.target.copy(point); this.controls.target.y += 10
      const distance = Number(this.forestDistance.value)
      const angle = Number(this.forestDirection.value) * Math.PI / 180
      const x = point.x + distance * Math.cos(angle), z = point.z + distance * Math.sin(angle), ground = this.world.terrainHeight(x, z) ?? point.y
      this.camera.position.set(x, Math.max(point.y + 12, ground + 3), z)
      this.controls.update(); this.controls.enableDamping = damping
    })
    this.forestCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    this.forestDistance.setAttribute('aria-label', '沿线森林观察距离')
    this.forestDistance.style.cssText = this.source.style.cssText + 'width:100%;'
    for (const [value, text] of [['40', '40m · 近景树冠'], ['90', '90m · 模型与轮廓过渡'], ['150', '150m · 远景树冠'], ['650', '650m · 远坡森林']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; this.forestDistance.append(option)
    }
    this.forestDistance.onchange = () => this.forestCase.click()
    this.forestDirection.setAttribute('aria-label', '沿线森林观察方向')
    this.forestDirection.style.cssText = this.forestDistance.style.cssText
    for (const [value, text] of [['0', '东侧'], ['45', '东南侧'], ['90', '南侧'], ['135', '西南侧'], ['180', '西侧'], ['225', '西北侧'], ['270', '北侧'], ['315', '东北侧']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; this.forestDirection.append(option)
    }
    this.forestDirection.value = '45'
    this.forestDirection.onchange = () => this.forestCase.click()
    this.treeCase = this.button('定位树模型对照', () => {
      if (!this.world || this.world.treeComparison.stats.preparedTrees < 2) return
      const mode = this.treeModel.value
      const versions: Record<string, CloseTreeAssetId[]> = { native: ['phototextured-pine-native'], branch50: ['phototextured-pine-branch50'], 'old-pine': ['scots-pine'], birch: ['silver-birch'], 'ash-lod1': ['canopy-ash-lod1'], 'ash-lod2': ['canopy-ash-lod2'], 'oak-lod1': ['canopy-oak-lod1'], 'oak-lod2': ['canopy-oak-lod2'] }
      this.world.treeComparison.setAssetFilter(versions[mode] ?? ['scots-pine', 'oak-street-tree'])
      const point = mode === 'originals' ? this.world.treeComparisonPoint : this.world.treeComparisonTreePoint
      if (this.data) { this.progress.value = String(this.data.nearestRoute(point.x, point.z).s); this.refreshPreview() }
      this.layers.treeSamples = true
      const input = treeLayers.querySelector<HTMLInputElement>('[aria-label="树模型来源尺度对照"]')
      if (input) input.checked = true
      const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
      this.controls.target.copy(point)
      if (mode === 'originals') this.camera.position.set(point.x + 70, point.y + 40, point.z + 70)
      else {
        this.controls.target.y += 10
        const ground = this.world.terrainHeight(point.x + 24, point.z + 28)
        this.camera.position.set(point.x + 24, Math.max(point.y + 11, (ground ?? point.y) + 3), point.z + 28)
      }
      this.controls.update(); this.controls.enableDamping = damping
    })
    this.treeCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    this.treeModel.setAttribute('aria-label', '树模型材质对照版本')
    this.treeModel.style.cssText = this.source.style.cssText + 'width:100%;margin-top:6px;'
    for (const [value, text] of [['originals', '现有松树 / 橡树来源尺度'], ['old-pine', '现有松树 · 同机位'], ['native', '真实纹理松树 · 作者原生 LOD2'], ['branch50', '真实纹理松树 · 保留叶片，减少枝干'], ['birch', '成熟桦树 · 14m作者尺度，外观候选'], ['ash-lod1', '成熟阔叶 Ash · LOD1'], ['ash-lod2', '成熟阔叶 Ash · LOD2'], ['oak-lod1', '成熟阔叶 Oak · LOD1'], ['oak-lod2', '成熟阔叶 Oak · LOD2']] as const) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; this.treeModel.append(option)
    }
    this.treeModel.onchange = () => this.treeCase.click()
    const treeNotice = document.createElement('p')
    treeNotice.textContent = '沿线阔叶林采用固定Ash/Oak模型，近35m用LOD1，35–60m过渡至LOD2，80–115m过渡至同源八角度树冠。整个远景范围一次准备，位置沿用近景16m样本，作者20m为统一展示尺度；旋转/缩放只采样已加载帧，不重建森林。源常绿分类使用Poly Haven照片纹理松树，25–60m过渡，远处仍为旧针叶轮廓。区块缓冲必须实际GPU上传与同步后才可进入视野。地理分类不识别逐株位置或树种。'
    treeNotice.textContent += ' Ash/Oak为EZ-Tree固定预设离线建模，树叶1024px透明贴图，树皮为CC0 PBR；同一骨架的LOD1/2分别约9千/5千三角形。20m为展示比例，实际林冠约19.93–20.40m，不是当地树高或树种测量。运行时只读取静态模型，不重新生成地形或树模型。'
    treeNotice.style.cssText = notes.style.cssText
    this.convertedStats.setAttribute('aria-label', '转换建筑准备诊断'); this.convertedStats.style.cssText = this.streamingStats.style.cssText
    const convertedLabel = document.createElement('label'), convertedInput = document.createElement('input')
    convertedInput.type = 'checkbox'; convertedInput.checked = true; convertedInput.setAttribute('aria-label', 'OSM2World 建筑材质')
    convertedInput.onchange = () => { this.layers.convertedBuildings = convertedInput.checked }
    convertedLabel.append(convertedInput, document.createTextNode('OSM2World 建筑材质'))
    this.convertedCase = this.button('定位转换建筑', () => {
      if (!this.world?.convertedBuildings.stats.ready) return
      const point = this.world.convertedBuildings.focusPoint
      if (this.data) { this.progress.value = String(this.data.nearestRoute(point.x, point.z).s); this.refreshPreview() }
      const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update()
      this.controls.target.copy(point); this.camera.position.set(point.x + 60, point.y + 45, point.z + 65)
      this.controls.update(); this.controls.enableDamping = damping
    })
    this.convertedCase.style.cssText += 'width:100%;margin:4px 0;background:#e5e5d6;'
    const convertedNotice = document.createElement('p')
    convertedNotice.textContent = '铁路两侧1200m范围内5853栋有源高度建筑，OSM2World离线转换并按各区块原点对齐当前DEM。3563栋来自高度标签，2290栋仍为上游估高；4个开放屋顶不补落地墙。勾选对比PBR通用材质，取消显示同批源足迹体块。模型和共享图片在出发前加载一次。墙面、窗面、屋顶厚度与无标签外观为转换器的表现假设，不是当地照片。'
    convertedNotice.style.cssText = notes.style.cssText
    diagnostics.append(summary, aerialLabel, this.aerialCase, this.aerialStats, aerialNotice, aerialCredit, treeLayers, this.forestDistance, this.forestDirection, this.forestCase, this.forestStats, this.treeModel, this.treeCase, this.treeStats, treeNotice, this.buildingStats, convertedLabel, this.convertedCase, this.convertedStats, convertedNotice, this.landCoverReadout, this.streamingStats, this.performanceReadout, this.motionReadout, this.stationReadout, this.buildingQuery, this.buildingCase, this.buildingSource, notes, credits)
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
    const aerial = world.aerial.stats
    this.aerialCase.disabled = !aerial.ready
    this.aerialStats.dataset.enabled = String(aerial.enabled)
    this.aerialStats.dataset.bytes = String(aerial.bytes)
    this.aerialStats.dataset.worldBounds = world.aerial.uniforms.geoAerialBounds.value.toArray().join(',')
    const corridor = world.aerial.corridor.stats
    this.aerialStats.dataset.corridorReady = String(corridor.ready)
    this.aerialStats.dataset.corridorBytes = String(corridor.bytes)
    this.aerialStats.dataset.corridorBlocks = String(corridor.blocks)
    this.aerialStats.textContent = `真实航片 ${aerial.ready ? '已准备' : '加载中'} · ${aerial.enabled ? '显示' : '关闭 / NLCD对照'}\n${aerial.width} × ${aerial.height} 像素 · ${aerial.bytes.toLocaleString()} B · ${(aerial.areaMetresSquared / 1000000).toFixed(3)}km²\n2022 NAIP RGB · 原像素0.6m · 日期${aerial.date}（瓦片文件名）\n地表 / 朝上屋顶共享同一地理配准；图片和来源记录均已校验，参与初始GPU准备。`
    this.aerialStats.textContent += `\n全线 ${corridor.ready ? '已准备' : '加载中'} · ${corridor.blocks} 区块 / ${corridor.atlases} 图集 · ${corridor.bytes.toLocaleString()} B\n覆盖mask约 ${(corridor.areaMetresSquared / 1000000).toFixed(2)}km² · 2.4m Mercator采样；远处缩小与拼接仍需画面检查。`
    const converted = world.convertedBuildings.stats
    this.convertedCase.disabled = !converted.ready
    Object.assign(this.convertedStats.dataset, { ready: String(converted.ready), buildings: String(converted.buildings), total: String(converted.total),
      tiles: String(converted.tiles), totalTiles: String(converted.totalTiles), sourceTags: String(converted.sourceTags), sourceEstimates: String(converted.sourceEstimates),
      openRoofs: String(converted.openRoofs), textures: String(converted.textures), imageSources: String(converted.imageSources), modelBytes: String(converted.modelBytes), textureBytes: String(converted.textureBytes),
      enabled: String(this.layers.convertedBuildings), visible: String(this.layers.buildings && world.presentable) })
    this.convertedStats.textContent = `转换建筑 ${converted.ready ? '已准备' : '加载中'} · ${converted.buildings}/${converted.total} 栋 · ${converted.meshes} 合批 · ${converted.triangles} 三角形\n全线 ${converted.tiles}/${converted.totalTiles} 区块 · 源高度标签 ${converted.sourceTags} · 上游估高 ${converted.sourceEstimates} · 开放屋顶 ${converted.openRoofs}\n共享图片 ${converted.textures} 文件 / ${converted.textureBytes.toLocaleString()} B · 模型 ${converted.modelBytes.toLocaleString()} B\n足迹最大误差 ${converted.maxAlignmentErrorMetres.toFixed(4)}m · 窗面偏移 ${converted.maxWindowOffsetMetres.toFixed(3)}m（转换器外观）\n${converted.rejectedDefaults} 个无源高度对象保留原轮廓；原体块与PBR模型都在初始GPU预热中提交，切换只改变可见性。`
    const trees = world.closeTrees.stats, samples = world.treeComparison.stats
    const canopy = world.canopy.stats
    this.forestCase.disabled = !canopy.ready
    this.forestStats.dataset.gpuPreparedTrees = String(canopy.gpuPreparedTrees)
    this.forestStats.dataset.preparedTrees = String(canopy.preparedTrees)
    this.forestStats.dataset.visibleTrees = String(canopy.visibleTrees)
    this.forestStats.dataset.unpreparedVisibleTrees = String(canopy.unpreparedVisibleTrees)
    this.forestStats.dataset.enabled = String(this.layers.closeTrees && this.layers.vegetation && !this.layers.treeSamples)
    const impostors = world.treeImpostors.stats
    this.forestStats.dataset.impostorsReady = String(impostors.ready)
    this.forestStats.dataset.impostorsBytes = String(impostors.bytes)
    this.forestStats.dataset.impostorsEnabled = String(this.layers.treeImpostors)
    this.forestStats.textContent = `阔叶模型 ${canopy.ready ? '已准备' : '加载中'} · ${canopy.assetBytes.toLocaleString()} B\n缓存 ${canopy.preparedTrees.toLocaleString()} 样本 / ${canopy.preparedChunks} 区块 · GPU已准备 ${canopy.gpuPreparedTrees.toLocaleString()}\n距离筛选 ${canopy.visibleTrees} LOD实例 / ${canopy.visibleDrawCalls} 合批 · ${canopy.visibleTriangles.toLocaleString()} 三角形\n视野未上传样本 ${canopy.unpreparedVisibleTrees} · 位置沿用16m林地样本；LOD统计可能含两级过渡，不是逐株调查。`
    this.forestStats.textContent += `\n同源树冠 ${impostors.ready ? '已准备' : '加载中'} · ${impostors.frames} 帧 / ${impostors.bytes.toLocaleString()} B · ${this.layers.treeImpostors ? '显示' : '旧轮廓对照'}\n两个2048×1024图集；源RGBA逐帧保留，根部和22m镜头范围固定。`
    this.treeCase.disabled = !samples.ready || samples.preparedTrees < 2
    this.treeStats.textContent = `常绿林3D ${trees.ready ? '已准备' : '加载中'} · ${trees.preparedTrees} 位置样本\n局部显示 ${trees.visibleTrees} 株 / ${trees.visibleDrawCalls} 合批 · ${trees.visibleTriangles.toLocaleString()} 三角形\n来源尺度对照 ${samples.ready ? '已准备' : '加载中'} · ${samples.preparedTrees} 实例 · ${samples.processedAssetBytes.toLocaleString()} B\n对照当前显示 ${samples.visibleTrees} 实例 / ${samples.visibleTriangles.toLocaleString()} 三角形 · ${this.treeModel.selectedOptions[0]?.textContent}\n模型在初始GPU离屏预热中提交；当前显示统计是距离筛选上界，不是实际frustum绘制次数。`
    if (this.editing) this.controls.update()
    const pose = this.data.pose(s)
    this.position.dataset.routeMetres = String(pose.s)
    this.position.dataset.routeLengthMetres = String(this.data.length)
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
  setGpuPreparation(stats: { sequence: number; phase: string; groups: number; groupIndex: number; startedAt: number; elapsedMs: number; completed: number }) {
    const elapsed = stats.phase === 'idle' ? stats.elapsedMs : performance.now() - stats.startedAt
    Object.assign(this.streamingStats.dataset, {
      gpuPhase: stats.phase, gpuSequence: String(stats.sequence), gpuGroupIndex: String(stats.groupIndex),
      gpuGroups: String(stats.groups), gpuElapsedMs: String(Math.round(elapsed)), gpuCompleted: String(stats.completed),
    })
    this.streamingStats.textContent += `\nGPU 当前批次 ${stats.sequence} · ${stats.phase} · ${stats.groupIndex + 1}/${stats.groups} · ${elapsed.toFixed(0)}ms · 完成 ${stats.completed}`
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
