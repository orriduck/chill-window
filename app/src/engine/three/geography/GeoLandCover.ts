export const LAND_COVER = new Map<number, { label: string; color: [number, number, number] }>([
  [11, { label: '水域', color: [70, 107, 159] }], [12, { label: '冰雪', color: [209, 222, 248] }],
  [21, { label: '开发区 / 开放空间', color: [222, 197, 197] }], [22, { label: '低强度开发区', color: [217, 146, 130] }],
  [23, { label: '中强度开发区', color: [235, 0, 0] }], [24, { label: '高强度开发区', color: [171, 0, 0] }],
  [31, { label: '裸地', color: [179, 172, 159] }], [41, { label: '落叶林', color: [104, 171, 95] }],
  [42, { label: '常绿林', color: [28, 95, 44] }], [43, { label: '混交林', color: [181, 197, 143] }],
  [52, { label: '灌木', color: [204, 184, 121] }], [71, { label: '草地', color: [223, 223, 194] }],
  [81, { label: '牧草地', color: [220, 217, 57] }], [82, { label: '耕作地', color: [171, 108, 40] }],
  [90, { label: '木本湿地', color: [184, 217, 235] }], [95, { label: '草本湿地', color: [108, 159, 184] }],
])
export interface LandCoverSnapshot {
  baseWorldSha256: string; width: number; height: number; bounds: [number, number, number, number]
  rowOrder: 'north-to-south'; file: string; sha256: string; year: number; collection: string; noData: number
  sourceResolutionMetres: number; method: string; source: { url: string; retrievedAt: string }
  classCounts: Record<string, number>
}
export class GeoLandCover {
  readonly snapshot: LandCoverSnapshot
  readonly classes: Uint8Array
  constructor(snapshot: LandCoverSnapshot, classes: Uint8Array) {
    this.snapshot = snapshot; this.classes = classes
    if (!Number.isInteger(snapshot.width) || !Number.isInteger(snapshot.height) || snapshot.width < 2 || snapshot.height < 2
      || classes.length !== snapshot.width * snapshot.height || snapshot.rowOrder !== 'north-to-south'
      || !Array.isArray(snapshot.bounds) || snapshot.bounds.length !== 4 || !snapshot.bounds.every(Number.isFinite)
      || snapshot.bounds[0] >= snapshot.bounds[2] || snapshot.bounds[1] >= snapshot.bounds[3]
      || classes.some(code => code !== snapshot.noData && !LAND_COVER.has(code))) throw new Error('NLCD 分类网格无效')
  }
  sample(x: number, z: number) {
    const { bounds: [minX, minZ, maxX, maxZ], width, height, noData } = this.snapshot
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < minX || x > maxX || z < minZ || z > maxZ) return null
    const col = Math.min(width - 1, Math.floor((x - minX) / (maxX - minX) * width))
    const row = Math.min(height - 1, Math.floor((maxZ - z) / (maxZ - minZ) * height))
    const code = this.classes[row * width + col]
    return code === noData ? null : code
  }
}
export async function loadLandCover(base: string, worldHash: string, bounds: number[], signal?: AbortSignal) {
  const response = await fetch(`${base}landcover.json`, { signal })
  if (!response.ok) throw new Error(`土地覆盖元数据 HTTP ${response.status}`)
  const snapshot = await response.json() as LandCoverSnapshot
  if (snapshot.baseWorldSha256 !== worldHash || !Array.isArray(snapshot.bounds) || snapshot.bounds.length !== 4
    || snapshot.bounds.some((v, i) => !Number.isFinite(v) || Math.abs(v - bounds[i]) > 1e-6)) throw new Error('土地覆盖与路线范围校验失败')
  if (snapshot.file !== 'landcover.u8') throw new Error('土地覆盖文件路径无效')
  const raster = await fetch(`${base}${snapshot.file}`, { signal })
  if (!raster.ok) throw new Error(`土地覆盖数据 HTTP ${raster.status}`)
  const buffer = await raster.arrayBuffer()
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('')
  if (hash !== snapshot.sha256) throw new Error('土地覆盖分类校验失败')
  return new GeoLandCover(snapshot, new Uint8Array(buffer))
}
