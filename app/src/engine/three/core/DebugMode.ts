import * as THREE from 'three'

export type CarriageDebugPart = 'shell' | 'seats' | 'fixtures' | 'glass' | 'lighting' | 'hud'
const PARTS: Array<[CarriageDebugPart, string]> = [['shell', '车厢外壳'], ['seats', '座椅'], ['fixtures', '车厢设施'], ['glass', '玻璃'], ['lighting', '照明'], ['hud', '行程 HUD']]

/** Debug controls shared by the real-world inspection and carriage view. */
export class DebugMode {
  onTerrainEditingChange: (active: boolean) => void = () => {}
  perfMonitor: { show(): void; hide(): void; isVisible: boolean } | null = null
  private topDown = false
  private hudLevel = 0
  private exteriorGroup: THREE.Group | null = null
  private hud = document.createElement('div')
  private carriagePanel = document.createElement('section')
  private carriageVisible = false
  private partController: ((part: CarriageDebugPart, visible: boolean) => void) | null = null
  private partVisibility: Record<CarriageDebugPart, boolean> = { shell: true, seats: true, fixtures: true, glass: true, lighting: true, hud: true }
  private motionReadout = document.createElement('output')

  constructor() {
    this.hud.style.cssText = 'position:fixed;top:40px;left:8px;z-index:10000;background:#000d;color:#b9e2af;font:11px/1.5 monospace;padding:10px 12px;border-radius:6px;pointer-events:none;display:none;white-space:pre;'
    this.carriagePanel.setAttribute('aria-label', '车厢检查')
    this.carriagePanel.style.cssText = 'position:fixed;top:40px;right:12px;z-index:10002;background:#18221eeF;color:#e9eee5;font:12px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;padding:12px 14px;border-radius:8px;display:none;box-shadow:0 8px 28px #0005;'
    const title = document.createElement('strong'); title.textContent = '车厢检查 · F2'; this.carriagePanel.append(title)
    for (const [part, label] of PARTS) {
      const row = document.createElement('label'); row.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;'
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.onchange = () => { this.partVisibility[part] = checkbox.checked; this.partController?.(part, checkbox.checked) }
      row.append(checkbox, document.createTextNode(label)); this.carriagePanel.append(row)
    }
    this.motionReadout.setAttribute('aria-label', '实测行驶'); this.motionReadout.style.cssText = 'display:block;white-space:pre-line;margin-top:10px;font-size:10px;color:#cfdfc3;'; this.carriagePanel.append(this.motionReadout)
    document.body.append(this.hud, this.carriagePanel)
    window.addEventListener('keydown', this.onKey)
  }
  init(_scene: THREE.Scene, exterior: THREE.Group) { this.exteriorGroup = exterior }
  attachCarriageInspector(controller: (part: CarriageDebugPart, visible: boolean) => void) {
    this.partController = controller
    for (const [part, visible] of Object.entries(this.partVisibility)) controller(part as CarriageDebugPart, visible)
  }
  get isTopDown() { return this.topDown }
  setTerrainEditing(active: boolean) {
    if (active === this.topDown) return
    this.topDown = active
    this.carriageVisible = false; this.carriagePanel.style.display = 'none'
    if (this.exteriorGroup) this.exteriorGroup.visible = true
    this.onTerrainEditingChange(active)
    if (!active) { this.hudLevel = 0; this.hud.style.display = 'none'; this.perfMonitor?.hide() }
  }
  updateMotion(z: number, speed: number, measured: number) {
    if (this.carriageVisible) this.motionReadout.textContent = `里程 ${z.toFixed(1)} m · 速度 ${(speed * 3.6).toFixed(0)} km/h\n实测 ${measured.toFixed(1)} m/s · 50 m 杆距 ${speed > 0.1 ? `${(50 / speed).toFixed(2)} s` : '—'}`
  }
  dispose() { window.removeEventListener('keydown', this.onKey); this.hud.remove(); this.carriagePanel.remove() }
  private onKey = (event: KeyboardEvent) => {
    if (event.repeat) return
    if (event.key === 'F5') { event.preventDefault(); this.setTerrainEditing(!this.topDown); return }
    if (event.key === 'Escape' && this.topDown) { event.preventDefault(); this.setTerrainEditing(false); return }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (event.key === 'F2') { event.preventDefault(); this.carriageVisible = !this.carriageVisible; this.carriagePanel.style.display = this.carriageVisible ? 'block' : 'none' }
    if (event.key === 'F3') {
      event.preventDefault(); this.hudLevel = (this.hudLevel + 1) % 2
      if (this.hudLevel) this.perfMonitor?.show(); else this.perfMonitor?.hide()
    }
    if (event.key === 'F6' && this.exteriorGroup) { event.preventDefault(); this.exteriorGroup.visible = !this.exteriorGroup.visible }
  }
}
