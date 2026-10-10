import * as THREE from 'three'
import type { MappedFeature } from './GeoData'

export interface BuildingAppearance {
  facadeColor: string
  roofColor: string
  facadeMaterial: string | null
  roofMaterial: string | null
  roofShape: string | null
  facadeColorSource: string | null
  roofColorSource: string | null
}

const materialColors: Record<string, string> = {
  brick: '#9b7666', stone: '#aaa394', concrete: '#aaa99f', wood: '#92775c',
  metal: '#858b8d', steel: '#858b8d', glass: '#829a9b', tar_paper: '#666b70',
  slate: '#68717a', tiles: '#9a6654', thatch: '#a58c56', asphalt: '#686a68',
  copper: '#66877b', zinc: '#8a9090', roof_tiles: '#9a6654',
}

const sourceColor = (value: unknown) => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  // Three.Color warns and retains white for an unknown CSS name instead of
  // throwing. That must not turn a missing/invalid source into a white facade.
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized) && !Object.hasOwn(THREE.Color.NAMES, normalized)) return null
  try {
    const color = new THREE.Color(normalized)
    return `#${color.getHexString()}`
  } catch { return null }
}

/** Keep source colors when present. Material palettes are a documented visual
 * mapping of source material labels, not sampled facade/roof colors. */
export function buildingAppearance(feature: Pick<MappedFeature, 'tags'> & Partial<Pick<MappedFeature, 'overtureProperties'>>): BuildingAppearance {
  const properties = feature.overtureProperties ?? {}
  const facadeMaterial = stringValue(properties.facade_material) ?? feature.tags['building:material'] ?? null
  const roofMaterial = stringValue(properties.roof_material) ?? feature.tags['roof:material'] ?? null
  const facadeColorSource = sourceColor(properties.facade_color) ?? sourceColor(feature.tags['building:colour'] ?? feature.tags['building:color'])
  const roofColorSource = sourceColor(properties.roof_color) ?? sourceColor(feature.tags['roof:colour'] ?? feature.tags['roof:color'])
  return {
    facadeColor: facadeColorSource ?? materialColors[(facadeMaterial ?? '').toLowerCase()] ?? '#aaa69b',
    roofColor: roofColorSource ?? materialColors[(roofMaterial ?? '').toLowerCase()] ?? '#72756f',
    facadeMaterial,
    roofMaterial,
    roofShape: stringValue(properties.roof_shape) ?? feature.tags['roof:shape'] ?? feature.tags['building:roof:shape'] ?? null,
    facadeColorSource: facadeColorSource ? 'source color' : facadeMaterial ? 'material palette' : null,
    roofColorSource: roofColorSource ? 'source color' : roofMaterial ? 'material palette' : null,
  }
}

function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null }

/** ExtrudeGeometry groups use material 0 for caps and 1 for walls. The caller
 * retains that [roof, wall] order while merging, so color each original group. */
export function applyBuildingAppearance(geometry: THREE.BufferGeometry, appearance: BuildingAppearance) {
  const wall = new THREE.Color(appearance.facadeColor), roof = new THREE.Color(appearance.roofColor)
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  for (const group of geometry.groups) {
    const color = group.materialIndex === 0 ? roof : wall
    for (let index = group.start; index < group.start + group.count; index++) {
      const vertex = geometry.index?.getX(index) ?? index
      colors[vertex * 3] = color.r; colors[vertex * 3 + 1] = color.g; colors[vertex * 3 + 2] = color.b
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

export function sourceRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap(source => source && typeof source === 'object' && 'record_id' in source && typeof source.record_id === 'string' ? [source.record_id] : []))]
}
