export type BiomeType = 'field' | 'forest' | 'mountain' | 'river' | 'town'

export interface HeightParams {
  baseHeight: number
  amplitude: number
  frequency: number
  octaves: number
  persistence: number
}

export interface BiomeColors {
  ground: number
  groundDark: number
  mid: number
  far: number
  rock: number
  sand: number
  snow: number
}

export interface BiomeConfig {
  heightParams: HeightParams
  colors: BiomeColors
  decorDensity: number
}

export const BIOMES: Record<BiomeType, BiomeConfig> = {
  field: {
    heightParams: {
      baseHeight: 0,
      amplitude: 3,
      frequency: 0.015,
      octaves: 4,
      persistence: 0.5,
    },
    colors: {
      ground: 0x579a4b,
      groundDark: 0x46803d,
      mid: 0x6fb45c,
      far: 0x8ba6bd,
      rock: 0x7a7a7a,
      sand: 0xc2b280,
      snow: 0xffffff,
    },
    decorDensity: 0.4,
  },
  forest: {
    heightParams: {
      baseHeight: 0.5,
      amplitude: 5,
      frequency: 0.02,
      octaves: 5,
      persistence: 0.45,
    },
    colors: {
      ground: 0x3f6539,
      groundDark: 0x33512f,
      mid: 0x4f7a48,
      far: 0x6c8a5a,
      rock: 0x6a6a6a,
      sand: 0xb0a070,
      snow: 0xf0f0f0,
    },
    decorDensity: 0.7,
  },
  mountain: {
    heightParams: {
      baseHeight: 2,
      amplitude: 25,
      frequency: 0.008,
      octaves: 6,
      persistence: 0.55,
    },
    colors: {
      ground: 0x5a6b5a,
      groundDark: 0x3d4a3d,
      mid: 0x7a8a7a,
      far: 0x9aab9a,
      rock: 0x888888,
      sand: 0xa09070,
      snow: 0xf2eef4,
    },
    decorDensity: 0.2,
  },
  river: {
    heightParams: {
      baseHeight: -1,
      amplitude: 2,
      frequency: 0.012,
      octaves: 3,
      persistence: 0.4,
    },
    colors: {
      ground: 0x5d9250,
      groundDark: 0x4c7a42,
      mid: 0x6fb45c,
      far: 0x8ba6bd,
      rock: 0x7a7a7a,
      sand: 0xc8b890,
      snow: 0xffffff,
    },
    decorDensity: 0.3,
  },
  town: {
    heightParams: {
      baseHeight: 0,
      amplitude: 1.5,
      frequency: 0.01,
      octaves: 2,
      persistence: 0.3,
    },
    colors: {
      ground: 0x7d8a7a,
      groundDark: 0x6a7568,
      mid: 0x8e9a8a,
      far: 0x9aab9a,
      rock: 0x777777,
      sand: 0xb8a880,
      snow: 0xf0f0f0,
    },
    decorDensity: 0.6,
  },
}

export function getBiomeConfig(type: BiomeType): BiomeConfig {
  return BIOMES[type]
}
