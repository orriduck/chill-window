export type LonLat = [number, number]
export interface RailRoute {
  id: string
  name: string
  bounds: [number, number, number, number]
  lengthMetres: number
  componentCount: number
  file: string
  preview: LonLat[][]
}
export interface RailCatalog {
  schemaVersion: number
  source: { url: string; retrievedAt: string; license: string }
  routes: RailRoute[]
}
export interface RailGeometry { id: string; name: string; components: LonLat[][]; source: unknown }
export type LandscapeProfile = 'woodland' | 'desert' | 'coast' | 'alpine'
export function landscapeProfile(name: string): LandscapeProfile {
  if (/zephyr|empire builder/i.test(name)) return 'alpine'
  if (/chief|sunset|texas|heartland/i.test(name)) return 'desert'
  if (/coast|surfliner|cascades/i.test(name)) return 'coast'
  return 'woodland'
}
export const HUDSON_ID = 'hudson-detailed'
