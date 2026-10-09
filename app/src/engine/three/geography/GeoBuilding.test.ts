/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { applyBuildingAppearance, buildingAppearance } from './GeoBuilding'
import type { BuildingOverlaySnapshot } from './GeoData'

describe('source building appearance', () => {
  it('keeps the retained church colors/materials and ML height without deriving a roof rise', () => {
    const overlay = JSON.parse(readFileSync(new URL('../../../../public/geodata/hudson/buildings.json', import.meta.url), 'utf8')) as BuildingOverlaySnapshot
    const feature = overlay.features.find(item => item.id === 'overture/b00509c4-82e0-47d0-8708-cc9c8465530b')!
    const original = JSON.stringify(feature)
    expect(buildingAppearance(feature)).toMatchObject({ facadeColor: '#ffffff', roofColor: '#778899', facadeMaterial: 'wood', roofMaterial: 'tar_paper', roofShape: 'pyramidal' })
    expect(feature.buildingHeight).toMatchObject({ status: 'source_estimate', metres: 3.877643585205078 })
    expect(feature.overtureProperties.roof_height).toBeUndefined()
    expect(JSON.stringify(feature)).toBe(original)
  })
  it('uses different source colors for caps and side walls in actual Three.js extrusions', () => {
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(12, 0), new THREE.Vector2(12, 8), new THREE.Vector2(0, 8)])
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false })
    const appearance = buildingAppearance({ tags: { 'building:colour': 'white', 'roof:colour': '#778899' } })
    applyBuildingAppearance(geometry, appearance)
    const colors = geometry.getAttribute('color'), normals = geometry.getAttribute('normal')
    const roof = new THREE.Color(appearance.roofColor), wall = new THREE.Color(appearance.facadeColor)
    let capVertices = 0, wallVertices = 0
    for (let i = 0; i < normals.count; i++) {
      const cap = Math.abs(normals.getZ(i)) > 0.9, expected = cap ? roof : wall
      if (cap) capVertices++; else wallVertices++
      expect(colors.getX(i)).toBeCloseTo(expected.r, 6)
      expect(colors.getY(i)).toBeCloseTo(expected.g, 6)
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 6)
    }
    expect(capVertices).toBeGreaterThan(0); expect(wallVertices).toBeGreaterThan(0)
    geometry.dispose()
  })
  it('does not convert unrecognized source color strings into white', () => {
    const result = buildingAppearance({ tags: { 'building:colour': 'unknown', 'building:material': 'wood' } })
    expect(result.facadeColorSource).toBe('material palette')
    expect(result.facadeColor).not.toBe('#ffffff')
  })
})
