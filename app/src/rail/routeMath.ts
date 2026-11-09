import type { LonLat } from './types'

export function componentLength(points: LonLat[]): number {
  const rad = Math.PI / 180
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2
    length += 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
  }
  return length
}
export function longestComponent(parts: LonLat[][]): number {
  let best = 0, length = -1
  parts.forEach((part, i) => { const current = componentLength(part); if (current > length) { best = i; length = current } })
  return best
}
export function validateGeometry(value: unknown): LonLat[][] {
  if (!value || typeof value !== 'object' || !('components' in value) || !Array.isArray(value.components) || !value.components.length) throw new Error('路线没有可乘坐的连续片段')
  const parts = value.components as unknown[]
  for (const part of parts) {
    if (!Array.isArray(part) || part.length < 2) throw new Error('路线片段点数不足')
    for (const point of part) if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('路线坐标无效')
    if (componentLength(part as LonLat[]) < 1) throw new Error('路线片段长度不足')
  }
  return parts as LonLat[][]
}
