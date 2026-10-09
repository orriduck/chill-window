import { routeBeatForSegment, routeInspectionZ, type RoutePlan } from '../terrain/RouteFeatures'
import { VISIBLE_CHUNK_COUNT } from '../terrain/TerrainFootprint'
import { PATCH_SCENES, type PatchScene } from '../terrain/TerrainEdits'
import type { TerrainEditor, PatchSelection } from './TerrainEditor'

export type LandscapeLayer = 'ground' | 'vegetation' | 'settlements' | 'water' | 'farmland' | 'hills'
export interface TerrainCommand { z?: number; inspectZ?: number; speed?: number; aerial?: boolean; recenter?: boolean; mask?: boolean; weather?: 'clear' | 'rain'; time?: 'day' | 'night' }

/** The map is the interface. Settings appear only for the selected tile. */
export class TerrainInspector {
  readonly layers: Record<LandscapeLayer, boolean> = { ground: true, vegetation: true, settlements: true, water: true, farmland: true, hills: true }
  visible = false
  private toolbar = document.createElement('section')
  private panel = document.createElement('section')
  private title = document.createElement('strong')
  private readout = document.createElement('output')
  private status = document.createElement('output')
  private sceneSelect = document.createElement('select')
  private relief = document.createElement('input')
  private reliefReadout = document.createElement('output')
  private viewButton: HTMLButtonElement
  private heading = document.createElement('strong')
  private help = document.createElement('span')
  private recenter: HTMLButtonElement
  private routeSelect = document.createElement('select')
  private pending: TerrainCommand = {}
  private editing = true
  private geographic = false
  private editor: TerrainEditor | null = null
  private selected: PatchSelection | null = null

  constructor(plan: RoutePlan) {
    const font = 'font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;'
    this.toolbar.setAttribute('aria-label', '地形调试工具栏')
    this.toolbar.style.cssText = `position:fixed;top:18px;left:18px;right:18px;z-index:10002;display:none;align-items:center;gap:8px;flex-wrap:wrap;pointer-events:none;${font}`
    const heading = this.heading
    heading.textContent = '地形编辑'
    heading.style.cssText = 'color:#f5f1e3;text-shadow:0 1px 5px #17221e;margin-right:10px;font-size:15px;'
    this.viewButton = this.button('调试模式 · F5', () => { this.pending.aerial = !this.editing })
    const recenter = this.recenter = this.button('回到列车附近', () => { this.pending.recenter = true; this.routeSelect.value = '' })
    this.status.setAttribute('aria-label', '区块加载状态')
    this.status.style.cssText = 'color:#ede9d8;background:#243829df;padding:7px 10px;border-radius:6px;font-size:11px;'
    this.toolbar.append(heading, this.viewButton, recenter, this.status)
    this.routeSelect.setAttribute('aria-label', '查看路线场景')
    this.routeSelect.style.cssText = 'padding:7px 10px;background:#f1efe4;color:#32442f;border:1px solid #d8dccb;border-radius:6px;font:inherit;pointer-events:auto;'
    const placeholder = document.createElement('option')
    placeholder.value = ''; placeholder.textContent = '查看路线场景'
    this.routeSelect.append(placeholder)
    for (const [id, label] of [['plain', '平地'], ['open-country', '农田'], ['village', '村庄'], ['regional-town', '小城市'], ['city-core', '大城市'], ['woodland', '树林'], ['foothills', '山麓过渡'], ['mountain-pass', '山地'], ['river-valley', '山谷']]) {
      for (let i = 0; i < 40; i++) if (routeBeatForSegment(i, plan).id === id) {
        const option = document.createElement('option')
        option.value = String(routeInspectionZ(i, plan)); option.textContent = label
        this.routeSelect.append(option); break
      }
    }
    this.routeSelect.onchange = () => {
      if (!this.routeSelect.value) return
      this.editor?.clearSelection()
      this.pending.inspectZ = Number(this.routeSelect.value)
    }
    this.toolbar.append(this.routeSelect)
    const help = this.help
    help.textContent = '拖动平移 · 滚轮缩放 · 右键旋转 · 点击区块编辑'
    help.style.cssText = 'margin-left:auto;color:#f4f0e4;text-shadow:0 1px 5px #17221e;font-size:11px;'
    this.toolbar.append(help)
    this.panel.setAttribute('aria-label', '区块编辑')
    this.panel.style.cssText = `position:fixed;right:18px;top:78px;z-index:10002;width:248px;max-width:calc(100vw - 36px);padding:18px;background:#f1efe4f5;color:#2b3a2e;border:1px solid #d8d7c5;border-radius:9px;box-shadow:0 10px 36px #13281930;display:none;${font}`
    const header = document.createElement('div')
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;'
    this.title.style.fontSize = '15px'
    const close = this.button('×', () => this.editor?.clearSelection())
    close.setAttribute('aria-label', '取消区块选择')
    header.append(this.title, close)
    this.readout.setAttribute('aria-label', '选中区块状态')
    this.readout.style.cssText = 'display:block;margin:5px 0 16px;color:#697566;font-size:11px;'
    this.panel.append(header, this.readout)
    const sceneLabel = document.createElement('label')
    sceneLabel.textContent = '场景'
    sceneLabel.style.cssText = 'display:block;font-size:12px;margin-bottom:12px;'
    this.sceneSelect.setAttribute('aria-label', '区块场景')
    this.sceneSelect.style.cssText = 'display:block;width:100%;margin-top:5px;padding:8px;background:#fbfaf4;color:#2b3a2e;border:1px solid #d4d6c7;border-radius:5px;font:inherit;'
    for (const [id, scene] of Object.entries(PATCH_SCENES)) {
      const option = document.createElement('option')
      option.value = id; option.textContent = scene.label
      this.sceneSelect.append(option)
    }
    this.sceneSelect.onchange = () => {
      const value = PATCH_SCENES[this.sceneSelect.value as PatchScene].relief
      this.relief.value = String(value)
      this.reliefReadout.textContent = `${value.toFixed(1)} m`
    }
    sceneLabel.append(this.sceneSelect)
    const reliefLabel = document.createElement('label')
    reliefLabel.textContent = '地形起伏 '
    reliefLabel.style.cssText = 'display:block;font-size:12px;margin-bottom:16px;'
    this.relief.type = 'range'; this.relief.min = '0'; this.relief.max = '100'; this.relief.step = '0.1'
    this.relief.setAttribute('aria-label', '区块地形起伏')
    this.relief.style.cssText = 'display:block;width:100%;margin-top:8px;accent-color:#536d4f;'
    this.relief.oninput = () => { this.reliefReadout.textContent = `${Number(this.relief.value).toFixed(1)} m` }
    reliefLabel.append(this.reliefReadout, this.relief)
    const regenerate = this.button('重新生成这个区块', () => {
      if (!this.selected) return
      this.editor?.regenerate({ scene: this.sceneSelect.value as PatchScene, relief: Number(this.relief.value), seed: (this.selected.settings.seed + 1) >>> 0 })
    })
    regenerate.style.cssText += 'width:100%;background:#4d684a;color:#f5f1e3;border-color:#4d684a;padding:10px;'
    const reset = this.button('恢复原始区块', () => this.editor?.regenerate(null))
    reset.style.cssText += 'width:100%;margin-top:7px;background:transparent;color:#66745e;border-color:transparent;font-size:11px;'
    this.panel.append(sceneLabel, reliefLabel, regenerate, reset)
    document.body.append(this.toolbar, this.panel)
    this.visible = true
    this.toolbar.style.display = 'flex'
    this.setEditing(false)
    if (new URLSearchParams(location.search).has('debugTerrain')) {
      const z = Number(new URLSearchParams(location.search).get('worldZ') ?? 650)
      this.pending = { z: Number.isFinite(z) ? z : 650, aerial: true }
    }
    this.status.textContent = `世界 ${plan.seed}`
  }
  private button(label: string, action: () => void) {
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = label; button.onclick = action
    button.style.cssText = 'border:1px solid #d8dccb;border-radius:6px;background:#f1efe4;color:#32442f;font:inherit;padding:7px 12px;cursor:pointer;pointer-events:auto;'
    return button
  }
  attachEditor(editor: TerrainEditor) {
    this.editor = editor
    editor.onSelection = selection => {
      this.selected = selection
      this.panel.style.display = selection && this.editing && !this.geographic ? 'block' : 'none'
      if (!selection) return
      this.title.textContent = `区块 ${selection.x}, ${selection.z}`
      this.readout.textContent = `256 × 256 m · ${selection.edited ? '已本地调整' : '原始地形'}`
      this.sceneSelect.value = selection.settings.scene
      this.relief.value = String(selection.settings.relief)
      this.reliefReadout.textContent = `${selection.settings.relief.toFixed(1)} m`
    }
  }
  setGeographic(value: boolean) {
    this.geographic = value
    this.toolbar.style.display = value ? 'none' : 'flex'
    this.panel.style.display = !value && this.editing && this.selected ? 'block' : 'none'
    if (!value) this.toolbar.style.left = '230px'
  }
  setEditing(value: boolean) {
    if (value === this.editing) return
    this.editing = value
    if (value) this.routeSelect.value = ''
    this.viewButton.textContent = value ? '返回列车 · Esc' : '调试模式 · F5'
    this.viewButton.style.marginLeft = value ? '0' : 'auto'
    for (const element of [this.heading, this.recenter, this.status, this.help, this.routeSelect]) element.style.display = value ? '' : 'none'
    this.panel.style.display = value && this.selected && !this.geographic ? 'block' : 'none'
  }
  consume(): TerrainCommand { const result = this.pending; this.pending = {}; return result }
  update(_z: number, _speed: number, chunks: number, queue: number, assets = '') {
    if (this.visible) this.status.textContent = this.editing ? `${chunks}/${VISIBLE_CHUNK_COUNT} 区块${queue > 0 ? ' · 正在生成' : ''}${assets ? ` · ${assets}` : ''}` : '列车窗景'
  }
  dispose() { this.toolbar.remove(); this.panel.remove() }
}
