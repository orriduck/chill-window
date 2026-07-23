# Chill-Window Three.js 3D 重写计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 将 chill-window 从 2D Canvas 重写为 Three.js 3D 场景，保留车厢内部 UI，窗外改为程序化无限 3D 地形。

**Architecture:** 
- Three.js 渲染 3D 场景（地形、植被、建筑、天空），相机固定侧视
- 车厢内部保持现有 CSS/HTML overlay（窗框、座椅、窗台等）
- 场景类型映射到不同 3D biome（field→草原、forest→森林、mountain→山地、river→河谷、town→小镇）
- 调试页面全部重建为 3D 场景调试

**Tech Stack:** Three.js (r160+), Vite, React 19, TypeScript, Tailwind CSS

---

## 当前代码结构

```
app/src/
  engine/
    scenery.ts          ← 要完全替换（当前 1074 行 2D Canvas 绘制）
  pages/
    Home.tsx            ← 保留 UI overlay，替换 Canvas 为 Three.js canvas
    Setup.tsx           ← 保留（设置流程）
    ExitConfirm.tsx     ← 保留
    debug/
      DebugIndex.tsx    ← 保留导航框架
      SceneDebug.tsx    ← 重写为 3D 场景预览
      FarDebug.tsx      ← 重写为 3D 远景调试
      InteriorDebug.tsx ← 保留（2D 窗内元素不需要改）
```

## 新代码结构

```
app/src/
  engine/
    scenery.ts          ← 删除（或保留兼容层）
    three/
      core/
        Scene3D.ts      ← Three.js 场景管理器（初始化、循环、销毁）
        Camera.ts       ← 固定侧视相机配置
        Renderer.ts     ← WebGLRenderer 配置
      terrain/
        TerrainGen.ts   ← Perlin noise 无限地形生成
        TerrainLOD.ts   ← 分块 LOD 管理
        Biome.ts        ← 5 种 biome 配置
      objects/
        TreeGen.ts      ← 程序化树木生成
        BuildingGen.ts  ← 程序化建筑生成
        DecorManager.ts ← 装饰物放置管理
      atmosphere/
        SkyShader.ts    ← 天空/云层着色器
        Weather.ts      ← 天气效果（雾、雨、雪）
        Lighting.ts     ← 动态光照
      glass/
        WindowGlass.ts  ← 车窗玻璃效果（反射、折射、雨滴）
    types/
      three.ts          ← Three.js 相关类型定义
```

---

## Task 1: Three.js 基础环境搭建

**目标:** 安装依赖、初始化 Three.js 场景、在 Home.tsx 中集成

**Files:**
- Modify: `app/package.json`
- Modify: `app/src/pages/Home.tsx`
- Create: `app/src/engine/three/core/Scene3D.ts`
- Create: `app/src/engine/three/core/Camera.ts`
- Create: `app/src/engine/three/core/Renderer.ts`

### Step 1: 安装 Three.js 依赖

```bash
cd ~/Devs/chill-window/app
npm install three @types/three
```

### Step 2: 创建 Scene3D 管理器

```typescript
// app/src/engine/three/core/Scene3D.ts
import * as THREE from 'three';
import { Camera } from './Camera';
import { Renderer } from './Renderer';

export class Scene3D {
  scene: THREE.Scene;
  camera: Camera;
  renderer: Renderer;
  private animId: number = 0;
  private isRunning = false;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.camera = new Camera();
    this.renderer = new Renderer(container);
    
    // 雾效果 — 大气透视
    this.scene.fog = new THREE.Fog(0x87CEEB, 200, 900);
  }

  start(loop: (delta: number) => void) {
    if (this.isRunning) return;
    this.isRunning = true;
    
    const clock = new THREE.Clock();
    const tick = () => {
      if (!this.isRunning) return;
      const delta = clock.getDelta();
      loop(delta);
      this.renderer.render(this.scene, this.camera.camera);
      this.animId = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this.isRunning = false;
    cancelAnimationFrame(this.animId);
  }

  resize(width: number, height: number) {
    this.camera.resize(width, height);
    this.renderer.resize(width, height);
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    // 清理场景中的所有对象
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
```

### Step 3: 创建固定侧视相机

```typescript
// app/src/engine/three/core/Camera.ts
import * as THREE from 'three';

export class Camera {
  camera: THREE.PerspectiveCamera;
  
  constructor() {
    // FOV 60, 宽高比后续设置, near 1, far 2000
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
    // 相机位置：火车侧面，看向窗外
    // x: 侧向（看风景的方向）
    // y: 高度
    // z: 沿着火车前进方向
    this.camera.position.set(0, 15, 0);
    this.camera.lookAt(50, 12, 200); // 看向侧前方远处
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // 相机随火车轻微晃动
  shake(intensity: number) {
    this.camera.position.y += (Math.random() - 0.5) * intensity;
    this.camera.position.z += (Math.random() - 0.5) * intensity * 0.3;
  }
}
```

### Step 4: 创建渲染器

```typescript
// app/src/engine/three/core/Renderer.ts
import * as THREE from 'three';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true, // 透明背景，让 CSS overlay 显示
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.render(scene, camera);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
```

### Step 5: 修改 Home.tsx 集成 Three.js

Home.tsx 中当前使用 `<canvas ref={canvasRef} />` 作为风景画布。需要改为创建一个 div 容器，Three.js 在其中渲染，然后 CSS overlay 窗框等仍然在上面。

关键修改点：
- 找到风景 canvas 的创建位置
- 替换为 Three.js Scene3D
- 保留所有 CSS overlay（窗框、窗台、座椅等）

```typescript
// 在 Home.tsx 的 useEffect 中
import { Scene3D } from '../engine/three/core/Scene3D';

// 创建场景容器 div
const sceneContainer = document.createElement('div');
sceneContainer.style.position = 'absolute';
sceneContainer.style.inset = '0';
sceneContainer.style.zIndex = '0';
container.appendChild(sceneContainer);

const scene3D = new Scene3D(sceneContainer);

// 在主循环中
scene3D.start((delta) => {
  // 更新地形位置（模拟火车前进）
  terrainManager.update(speed * delta);
  // 相机轻微晃动
  scene3D.camera.shake(0.02 * speed);
});

// 清理时
return () => {
  scene3D.dispose();
};
```

### Step 6: 提交

```bash
git add -A
git commit -m "feat(3d): Three.js base setup - Scene3D, Camera, Renderer"
```

---

## Task 2: 无限地形生成

**目标:** 实现 Perlin noise 无限地形 + LOD 分块管理

**Files:**
- Create: `app/src/engine/three/terrain/TerrainGen.ts`
- Create: `app/src/engine/three/terrain/TerrainLOD.ts`
- Create: `app/src/engine/three/terrain/Biome.ts`

### Step 1: 创建 Perlin Noise 地形生成器

使用简单噪声函数（不引入额外库，自己实现或用小函数）：

```typescript
// app/src/engine/three/terrain/TerrainGen.ts
import * as THREE from 'three';

// 简单 Perlin-like noise
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
}

class SimpleNoise {
  perm: number[];
  constructor(seed = Math.random()) {
    const p = new Array(256).fill(0).map((_, i) => i);
    // Shuffle with seed
    let s = seed * 12345;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = [...p, ...p];
  }
  
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
  }
  
  // FBM (Fractal Brownian Motion) — 多层噪声叠加
  fbm2D(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return total / maxValue;
  }
}

export interface TerrainConfig {
  seed: number;
  chunkSize: number;      // 每块地形大小
  chunkResolution: number; // 每块分辨率（顶点数）
  maxChunks: number;       // 最大同时存在的块数
  heightScale: number;     // 高度缩放
  noiseScale: number;      // 噪声频率
}

export class TerrainGen {
  noise: SimpleNoise;
  config: TerrainConfig;
  
  constructor(config: Partial<TerrainConfig> = {}) {
    this.config = {
      seed: Math.random() * 10000,
      chunkSize: 200,
      chunkResolution: 64,
      maxChunks: 12,
      heightScale: 40,
      noiseScale: 0.005,
      ...config,
    };
    this.noise = new SimpleNoise(this.config.seed);
  }
  
  // 获取某位置的高度
  getHeight(x: number, z: number): number {
    const { noiseScale, heightScale } = this.config;
    const n = this.noise.fbm2D(x * noiseScale, z * noiseScale, 6, 0.5, 2);
    // 映射到 0-1 然后缩放
    return ((n + 1) / 2) * heightScale;
  }
  
  // 生成一个地形块的几何体
  generateChunk(chunkX: number, chunkZ: number): THREE.PlaneGeometry {
    const { chunkSize, chunkResolution } = this.config;
    const geometry = new THREE.PlaneGeometry(
      chunkSize, chunkSize,
      chunkResolution, chunkResolution
    );
    
    const positions = geometry.attributes.position;
    const worldOffsetX = chunkX * chunkSize;
    const worldOffsetZ = chunkZ * chunkSize;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) + worldOffsetX;
      const z = positions.getY(i) + worldOffsetZ; // PlaneGeometry 默认在 XY 平面
      const y = this.getHeight(x, z);
      positions.setZ(i, y); // 设置高度到 Z
    }
    
    geometry.computeVertexNormals();
    return geometry;
  }
}
```

### Step 2: 创建 LOD 分块管理器

```typescript
// app/src/engine/three/terrain/TerrainLOD.ts
import * as THREE from 'three';
import { TerrainGen } from './TerrainGen';

interface Chunk {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  distance: number;
}

export class TerrainLOD {
  private chunks = new Map<string, Chunk>();
  private terrainGen: TerrainGen;
  private scene: THREE.Scene;
  private material: THREE.MeshStandardMaterial;
  private chunkPool: THREE.PlaneGeometry[] = []; // 几何体池，复用
  
  constructor(scene: THREE.Scene, terrainGen: TerrainGen) {
    this.scene = scene;
    this.terrainGen = terrainGen;
    this.material = new THREE.MeshStandardMaterial({
      color: 0x5a8a3a,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true, // 低多边形风格
    });
  }
  
  // 根据相机位置更新可见块
  update(cameraPosition: THREE.Vector3, speed: number) {
    const chunkSize = this.terrainGen.config.chunkSize;
    const maxChunks = this.terrainGen.config.maxChunks;
    
    // 计算相机所在的 chunk
    const camChunkX = Math.floor(cameraPosition.x / chunkSize);
    const camChunkZ = Math.floor(cameraPosition.z / chunkSize);
    
    // 需要显示的 chunks（按距离排序）
    const needed: Array<{ x: number; z: number; dist: number }> = [];
    const range = Math.ceil(maxChunks / 2);
    
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const x = camChunkX + dx;
        const z = camChunkZ + dz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        needed.push({ x, z, dist });
      }
    }
    
    needed.sort((a, b) => a.dist - b.dist);
    const toShow = needed.slice(0, maxChunks);
    const showKeys = new Set(toShow.map(n => `${n.x},${n.z}`));
    
    // 移除不需要的 chunks
    for (const [key, chunk] of this.chunks) {
      if (!showKeys.has(key)) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    
    // 添加新的 chunks
    for (const { x, z } of toShow) {
      const key = `${x},${z}`;
      if (!this.chunks.has(key)) {
        this.createChunk(x, z);
      }
    }
  }
  
  private createChunk(x: number, z: number) {
    const geometry = this.terrainGen.generateChunk(x, z);
    // 旋转平面到水平（XZ 平面）
    geometry.rotateX(-Math.PI / 2);
    
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
    
    const chunk: Chunk = { mesh, x, z, distance: 0 };
    this.chunks.set(`${x},${z}`, chunk);
  }
  
  dispose() {
    for (const chunk of this.chunks.values()) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.material.dispose();
  }
}
```

### Step 3: 创建 Biome 配置

```typescript
// app/src/engine/three/terrain/Biome.ts
import * as THREE from 'three';
import type { SceneKind } from '../../engine/scenery';

export interface BiomeConfig {
  name: string;
  groundColor: number;
  groundColor2: number;
  heightScale: number;
  noiseScale: number;
  treeDensity: number;
  treeTypes: string[];
  buildingDensity: number;
  waterLevel: number;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
}

export const BIOMES: Record<SceneKind, BiomeConfig> = {
  field: {
    name: '草原',
    groundColor: 0x7a9a4a,
    groundColor2: 0x8aaa5a,
    heightScale: 15,
    noiseScale: 0.003,
    treeDensity: 0.02,
    treeTypes: ['round', 'willow'],
    buildingDensity: 0.005,
    waterLevel: -10,
    skyColor: 0x87CEEB,
    fogColor: 0xaaccdd,
    fogDensity: 0.002,
  },
  forest: {
    name: '森林',
    groundColor: 0x3a6a2a,
    groundColor2: 0x4a7a3a,
    heightScale: 20,
    noiseScale: 0.004,
    treeDensity: 0.25,
    treeTypes: ['pine', 'round', 'cluster'],
    buildingDensity: 0.001,
    waterLevel: -10,
    skyColor: 0x7ab8c4,
    fogColor: 0x88aa99,
    fogDensity: 0.004,
  },
  mountain: {
    name: '山地',
    groundColor: 0x6a6a5a,
    groundColor2: 0x8a8a6a,
    heightScale: 80,
    noiseScale: 0.002,
    treeDensity: 0.05,
    treeTypes: ['pine', 'bare'],
    buildingDensity: 0.001,
    waterLevel: 5,
    skyColor: 0x6699cc,
    fogColor: 0x8899aa,
    fogDensity: 0.003,
  },
  river: {
    name: '河谷',
    groundColor: 0x5a8a4a,
    groundColor2: 0x6a9a5a,
    heightScale: 10,
    noiseScale: 0.003,
    treeDensity: 0.08,
    treeTypes: ['willow', 'round'],
    buildingDensity: 0.003,
    waterLevel: 3,
    skyColor: 0x7ab8e0,
    fogColor: 0x99bbcc,
    fogDensity: 0.002,
  },
  town: {
    name: '小镇',
    groundColor: 0x7a8a5a,
    groundColor2: 0x8a9a6a,
    heightScale: 8,
    noiseScale: 0.005,
    treeDensity: 0.03,
    treeTypes: ['round'],
    buildingDensity: 0.08,
    waterLevel: -10,
    skyColor: 0x99aabb,
    fogColor: 0xaabbcc,
    fogDensity: 0.004,
  },
};
```

### Step 4: 提交

```bash
git add -A
git commit -m "feat(3d): infinite terrain generation with Perlin noise + LOD"
```

---

## Task 3: 程序化植被与建筑

**目标:** 生成树木、房屋等装饰物

**Files:**
- Create: `app/src/engine/three/objects/TreeGen.ts`
- Create: `app/src/engine/three/objects/BuildingGen.ts`
- Create: `app/src/engine/three/objects/DecorManager.ts`

### Step 1: 程序化树木

```typescript
// app/src/engine/three/objects/TreeGen.ts
import * as THREE from 'three';

export interface TreeParams {
  type: 'pine' | 'round' | 'willow' | 'bare' | 'cluster';
  height: number;
  radius: number;
  color: number;
}

export class TreeGen {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  
  getTree(type: string, seed: number): THREE.Group {
    const rng = this.mulberry32(seed);
    const group = new THREE.Group();
    
    switch (type) {
      case 'pine':
        this.buildPine(group, rng);
        break;
      case 'round':
        this.buildRound(group, rng);
        break;
      case 'willow':
        this.buildWillow(group, rng);
        break;
      case 'bare':
        this.buildBare(group, rng);
        break;
      case 'cluster':
        this.buildCluster(group, rng);
        break;
    }
    
    return group;
  }
  
  private buildPine(group: THREE.Group, rng: () => number) {
    const h = 8 + rng() * 6;
    const r = 1.5 + rng() * 1;
    
    // 树干
    const trunkGeo = new THREE.CylinderGeometry(r * 0.2, r * 0.3, h * 0.3, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = h * 0.15;
    group.add(trunk);
    
    // 三层圆锥
    for (let i = 0; i < 3; i++) {
      const layerH = h * 0.25;
      const layerR = r * (1 - i * 0.25);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(layerR, layerH, 7),
        new THREE.MeshStandardMaterial({ color: 0x2a5a2a, roughness: 0.9, flatShading: true })
      );
      cone.position.y = h * 0.3 + i * layerH * 0.7;
      group.add(cone);
    }
  }
  
  private buildRound(group: THREE.Group, rng: () => number) {
    const h = 6 + rng() * 4;
    const r = 2 + rng() * 2;
    
    // 树干
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.15, r * 0.2, h * 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 })
    );
    trunk.position.y = h * 0.2;
    group.add(trunk);
    
    // 球形树冠
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 1),
      new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.9, flatShading: true })
    );
    crown.position.y = h * 0.6;
    group.add(crown);
  }
  
  private buildWillow(group: THREE.Group, rng: () => number) {
    const h = 7 + rng() * 3;
    const r = 3 + rng() * 2;
    
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, h * 0.5, 5),
      new THREE.MeshStandardMaterial({ color: 0x5a4a3a })
    );
    trunk.position.y = h * 0.25;
    group.add(trunk);
    
    // 垂柳枝条 — 多个细长圆锥
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const branch = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, h * 0.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.9 })
      );
      branch.position.set(
        Math.cos(angle) * r * 0.3,
        h * 0.5,
        Math.sin(angle) * r * 0.3
      );
      branch.rotation.x = Math.PI * 0.7;
      branch.rotation.y = angle;
      group.add(branch);
    }
  }
  
  private buildBare(group: THREE.Group, rng: () => number) {
    const h = 5 + rng() * 3;
    
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.4, h, 5),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
    );
    trunk.position.y = h * 0.5;
    group.add(trunk);
    
    // 几根枯枝
    for (let i = 0; i < 5; i++) {
      const angle = rng() * Math.PI * 2;
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.1, h * 0.3, 3),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
      );
      branch.position.set(
        Math.cos(angle) * 0.5,
        h * (0.5 + rng() * 0.4),
        Math.sin(angle) * 0.5
      );
      branch.rotation.z = (rng() - 0.5) * Math.PI * 0.5;
      branch.rotation.y = angle;
      group.add(branch);
    }
  }
  
  private buildCluster(group: THREE.Group, rng: () => number) {
    // 多棵树挤在一起
    const count = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const subTree = this.buildRound(new THREE.Group(), rng);
      subTree.scale.setScalar(0.5 + rng() * 0.5);
      subTree.position.set(
        (rng() - 0.5) * 4,
        0,
        (rng() - 0.5) * 4
      );
      group.add(subTree);
    }
  }
  
  private mulberry32(seed: number) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
```

### Step 2: 程序化建筑

```typescript
// app/src/engine/three/objects/BuildingGen.ts
import * as THREE from 'three';

export class BuildingGen {
  getHouse(seed: number): THREE.Group {
    const rng = this.mulberry32(seed);
    const group = new THREE.Group();
    
    const w = 4 + rng() * 3;
    const d = 4 + rng() * 3;
    const h = 3 + rng() * 2;
    
    // 主体
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.9 })
    );
    body.position.y = h / 2;
    group.add(body);
    
    // 屋顶
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2, 4),
      new THREE.MeshStandardMaterial({ color: 0x6a3a2a, roughness: 0.9 })
    );
    roof.position.y = h + 1;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    
    return group;
  }
  
  getChurch(seed: number): THREE.Group {
    const rng = this.mulberry32(seed);
    const group = new THREE.Group();
    
    // 教堂主体更高
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(6, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x9a8a7a })
    );
    body.position.y = 4;
    group.add(body);
    
    // 尖顶
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(3, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x5a4a3a })
    );
    spire.position.y = 11;
    spire.rotation.y = Math.PI / 4;
    group.add(spire);
    
    return group;
  }
  
  private mulberry32(seed: number) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
```

### Step 3: 装饰物管理器

```typescript
// app/src/engine/three/objects/DecorManager.ts
import * as THREE from 'three';
import { TreeGen } from './TreeGen';
import { BuildingGen } from './BuildingGen';
import type { TerrainGen } from '../terrain/TerrainGen';
import type { BiomeConfig } from '../terrain/Biome';

export class DecorManager {
  private treeGen = new TreeGen();
  private buildingGen = new BuildingGen();
  private objects = new THREE.Group();
  private placed = new Set<string>();
  
  constructor(scene: THREE.Scene) {
    scene.add(this.objects);
  }
  
  update(cameraPos: THREE.Vector3, terrainGen: TerrainGen, biome: BiomeConfig, speed: number) {
    const chunkSize = terrainGen.config.chunkSize;
    const range = 3; // 更新范围
    
    const cx = Math.floor(cameraPos.x / chunkSize);
    const cz = Math.floor(cameraPos.z / chunkSize);
    
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        this.populateChunk(cx + dx, cz + dz, terrainGen, biome);
      }
    }
    
    // 移除太远的对象
    this.cleanup(cameraPos, chunkSize * range * 2);
  }
  
  private populateChunk(cx: number, cz: number, terrainGen: TerrainGen, biome: BiomeConfig) {
    const key = `${cx},${cz}`;
    if (this.placed.has(key)) return;
    this.placed.add(key);
    
    const chunkSize = terrainGen.config.chunkSize;
    const seed = cx * 73856093 + cz * 19349663;
    const rng = this.mulberry32(seed);
    
    // 放置树木
    const treeCount = Math.floor(chunkSize * chunkSize * biome.treeDensity * 0.001);
    for (let i = 0; i < treeCount; i++) {
      const x = (cx + rng()) * chunkSize;
      const z = (cz + rng()) * chunkSize;
      const y = terrainGen.getHeight(x, z);
      
      if (y < biome.waterLevel + 2) continue; // 不在水里
      
      const type = biome.treeTypes[Math.floor(rng() * biome.treeTypes.length)];
      const tree = this.treeGen.getTree(type, seed + i);
      tree.position.set(x, y, z);
      
      // 随机缩放和旋转
      const s = 0.7 + rng() * 0.6;
      tree.scale.setScalar(s);
      tree.rotation.y = rng() * Math.PI * 2;
      
      this.objects.add(tree);
    }
    
    // 放置建筑
    if (rng() < biome.buildingDensity) {
      const x = (cx + rng()) * chunkSize;
      const z = (cz + rng()) * chunkSize;
      const y = terrainGen.getHeight(x, z);
      
      const building = rng() > 0.3 
        ? this.buildingGen.getHouse(seed + 1000)
        : this.buildingGen.getChurch(seed + 2000);
      building.position.set(x, y, z);
      this.objects.add(building);
    }
  }
  
  private cleanup(cameraPos: THREE.Vector3, maxDist: number) {
    const toRemove: THREE.Object3D[] = [];
    this.objects.children.forEach(obj => {
      const dist = obj.position.distanceTo(cameraPos);
      if (dist > maxDist) {
        toRemove.push(obj);
      }
    });
    
    toRemove.forEach(obj => {
      this.objects.remove(obj);
      // 清理几何体和材质
      obj.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
  }
  
  private mulberry32(seed: number) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  
  dispose() {
    this.objects.clear();
    this.placed.clear();
  }
}
```

### Step 4: 提交

```bash
git add -A
git commit -m "feat(3d): procedural trees, buildings, decor placement"
```

---

## Task 4: 天空、光照与天气

**目标:** 天空着色器、动态光照、天气效果

**Files:**
- Create: `app/src/engine/three/atmosphere/SkyShader.ts`
- Create: `app/src/engine/three/atmosphere/Weather.ts`
- Create: `app/src/engine/three/atmosphere/Lighting.ts`

### Step 1: 天空着色器

使用 Three.js 内置的 Sky 对象或自定义着色器：

```typescript
// app/src/engine/three/atmosphere/SkyShader.ts
import * as THREE from 'three';

export class SkyShader {
  private sky: THREE.Mesh;
  private uniforms: { [key: string]: THREE.Uniform };
  
  constructor(scene: THREE.Scene) {
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;
    
    this.uniforms = {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      offset: { value: 33 },
      exponent: { value: 0.6 },
    };
    
    const skyGeo = new THREE.SphereGeometry(1000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      side: THREE.BackSide,
    });
    
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.sky);
  }
  
  setTimeOfDay(timeOfDay: 'morning' | 'day' | 'dusk' | 'night') {
    const colors = {
      morning: { top: 0x4488cc, bottom: 0xffcc88 },
      day: { top: 0x0077ff, bottom: 0xffffff },
      dusk: { top: 0x224466, bottom: 0xff6644 },
      night: { top: 0x0a0a1a, bottom: 0x1a1a2a },
    };
    
    const c = colors[timeOfDay];
    this.uniforms.topColor.value.setHex(c.top);
    this.uniforms.bottomColor.value.setHex(c.bottom);
  }
}
```

### Step 2: 动态光照

```typescript
// app/src/engine/three/atmosphere/Lighting.ts
import * as THREE from 'three';

export class Lighting {
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemiLight: THREE.HemisphereLight;
  
  constructor(scene: THREE.Scene) {
    // 环境光
    this.ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(this.ambientLight);
    
    // 半球光（模拟天空和地面反射）
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.hemiLight.position.set(0, 200, 0);
    scene.add(this.hemiLight);
    
    // 太阳光（方向光 + 阴影）
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sunLight.position.set(100, 100, 50);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 500;
    this.sunLight.shadow.camera.left = -100;
    this.sunLight.shadow.camera.right = 100;
    this.sunLight.shadow.camera.top = 100;
    this.sunLight.shadow.camera.bottom = -100;
    scene.add(this.sunLight);
  }
  
  setTimeOfDay(timeOfDay: 'morning' | 'day' | 'dusk' | 'night') {
    const configs = {
      morning: { color: 0xffaa66, intensity: 0.8, pos: [100, 30, 100] },
      day: { color: 0xffffff, intensity: 1.2, pos: [100, 100, 50] },
      dusk: { color: 0xff6644, intensity: 0.6, pos: [100, 20, -50] },
      night: { color: 0x4444aa, intensity: 0.2, pos: [50, 80, 50] },
    };
    
    const c = configs[timeOfDay];
    this.sunLight.color.setHex(c.color);
    this.sunLight.intensity = c.intensity;
    this.sunLight.position.set(c.pos[0], c.pos[1], c.pos[2]);
    
    // 调整环境光
    if (timeOfDay === 'night') {
      this.ambientLight.intensity = 0.1;
      this.hemiLight.intensity = 0.2;
    } else {
      this.ambientLight.intensity = 0.5;
      this.hemiLight.intensity = 0.6;
    }
  }
}
```

### Step 3: 天气效果

```typescript
// app/src/engine/three/atmosphere/Weather.ts
import * as THREE from 'three';

export type WeatherType = 'clear' | 'rain' | 'fog' | 'snow';

export class Weather {
  private rainSystem: THREE.Points | null = null;
  private fog: THREE.Fog;
  private currentType: WeatherType = 'clear';
  private scene: THREE.Scene;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.Fog(0x87CEEB, 200, 900);
    scene.fog = this.fog;
  }
  
  setWeather(type: WeatherType, timeOfDay: string) {
    this.currentType = type;
    
    // 清除之前的天气效果
    if (this.rainSystem) {
      this.scene.remove(this.rainSystem);
      this.rainSystem.geometry.dispose();
      (this.rainSystem.material as THREE.Material).dispose();
      this.rainSystem = null;
    }
    
    switch (type) {
      case 'clear':
        this.fog.near = 300;
        this.fog.far = 1000;
        break;
      case 'fog':
        this.fog.near = 50;
        this.fog.far = 300;
        break;
      case 'rain':
        this.fog.near = 100;
        this.fog.far = 500;
        this.createRain();
        break;
      case 'snow':
        this.fog.near = 100;
        this.fog.far = 500;
        this.createSnow();
        break;
    }
  }
  
  private createRain() {
    const count = 5000;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      velocities[i] = 0.5 + Math.random() * 0.5;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
    
    const material = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 0.3,
      transparent: true,
      opacity: 0.6,
    });
    
    this.rainSystem = new THREE.Points(geometry, material);
    this.scene.add(this.rainSystem);
  }
  
  private createSnow() {
    const count = 3000;
    const positions = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.8,
    });
    
    this.rainSystem = new THREE.Points(geometry, material);
    this.scene.add(this.rainSystem);
  }
  
  update(delta: number, cameraPos: THREE.Vector3) {
    if (!this.rainSystem) return;
    
    const positions = this.rainSystem.geometry.attributes.position.array as Float32Array;
    const isRain = this.currentType === 'rain';
    
    for (let i = 0; i < positions.length / 3; i++) {
      if (isRain) {
        // 雨滴下落
        positions[i * 3 + 1] -= (2 + Math.random()) * delta * 20;
      } else {
        // 雪花飘落（带摆动）
        positions[i * 3] += Math.sin(Date.now() * 0.001 + i) * delta;
        positions[i * 3 + 1] -= delta * 2;
      }
      
      // 重置到底部
      if (positions[i * 3 + 1] < 0) {
        positions[i * 3] = cameraPos.x + (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = 50 + Math.random() * 50;
        positions[i * 3 + 2] = cameraPos.z + (Math.random() - 0.5) * 100;
      }
    }
    
    this.rainSystem.geometry.attributes.position.needsUpdate = true;
  }
}
```

### Step 4: 提交

```bash
git add -A
git commit -m "feat(3d): sky shader, dynamic lighting, weather effects"
```

---

## Task 5: 车窗玻璃效果

**目标:** 车窗玻璃的反射、折射、雨滴效果

**Files:**
- Create: `app/src/engine/three/glass/WindowGlass.ts`

```typescript
// app/src/engine/three/glass/WindowGlass.ts
import * as THREE from 'three';

export class WindowGlass {
  private glassMesh: THREE.Mesh;
  private rainDrops: THREE.Group;
  
  constructor(scene: THREE.Scene) {
    // 车窗玻璃 — 一个半透明平面，放在相机前面
    const glassGeo = new THREE.PlaneGeometry(20, 15);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.3, // 透射
      transparent: true,
      opacity: 0.1,
      reflectivity: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    
    this.glassMesh = new THREE.Mesh(glassGeo, glassMat);
    this.glassMesh.position.set(0, 10, 5); // 在相机前方
    scene.add(this.glassMesh);
    
    // 雨滴
    this.rainDrops = new THREE.Group();
    scene.add(this.rainDrops);
  }
  
  addRainDrops(count: number) {
    // 清除旧雨滴
    this.rainDrops.clear();
    
    const dropGeo = new THREE.SphereGeometry(0.05, 4, 4);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0,
      transmission: 0.9,
      transparent: true,
      opacity: 0.7,
    });
    
    for (let i = 0; i < count; i++) {
      const drop = new THREE.Mesh(dropGeo, dropMat);
      drop.position.set(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12 + 10,
        5.2
      );
      drop.scale.y = 1.5; // 拉长像雨滴
      this.rainDrops.add(drop);
    }
  }
  
  clearRainDrops() {
    this.rainDrops.clear();
  }
  
  update(speed: number) {
    // 雨滴随速度移动（模拟风吹）
    this.rainDrops.children.forEach(drop => {
      drop.position.x -= speed * 0.01;
      if (drop.position.x < -10) {
        drop.position.x = 10;
      }
    });
  }
}
```

### 提交

```bash
git add -A
git commit -m "feat(3d): window glass reflection and rain drops"
```

---

## Task 6: 整合到 Home.tsx

**目标:** 将所有 3D 模块整合到 Home.tsx，替换原有 Canvas 2D 绘制

**Files:**
- Modify: `app/src/pages/Home.tsx`

关键修改：
1. 找到风景渲染区域，替换为 Three.js 容器
2. 保留所有 CSS overlay（窗框、窗台、座椅等）
3. 在主循环中调用 3D 场景更新
4. 清理时正确销毁 Three.js 场景

由于 Home.tsx 有 500+ 行，修改需要谨慎。核心改动：

```typescript
// 1. 导入
import { Scene3D } from '../engine/three/core/Scene3D';
import { TerrainGen } from '../engine/three/terrain/TerrainGen';
import { TerrainLOD } from '../engine/three/terrain/TerrainLOD';
import { DecorManager } from '../engine/three/objects/DecorManager';
import { SkyShader } from '../engine/three/atmosphere/SkyShader';
import { Lighting } from '../engine/three/atmosphere/Lighting';
import { Weather } from '../engine/three/atmosphere/Weather';
import { WindowGlass } from '../engine/three/glass/WindowGlass';
import { BIOMES } from '../engine/three/terrain/Biome';

// 2. 在 Home 组件中
function Home() {
  // ... 现有状态 ...
  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const scene3DRef = useRef<Scene3D | null>(null);
  const terrainLODRef = useRef<TerrainLOD | null>(null);
  const decorManagerRef = useRef<DecorManager | null>(null);
  const cameraPos = useRef(new THREE.Vector3(0, 15, 0));
  
  useEffect(() => {
    const container = sceneContainerRef.current;
    if (!container) return;
    
    // 创建 3D 场景
    const scene3D = new Scene3D(container);
    scene3DRef.current = scene3D;
    
    // 地形
    const biome = BIOMES[sceneKind];
    const terrainGen = new TerrainGen({
      seed: seed || Date.now(),
      heightScale: biome.heightScale,
      noiseScale: biome.noiseScale,
    });
    const terrainLOD = new TerrainLOD(scene3D.scene, terrainGen);
    terrainLODRef.current = terrainLOD;
    
    // 装饰物
    const decorManager = new DecorManager(scene3D.scene);
    decorManagerRef.current = decorManager;
    
    // 天空
    const sky = new SkyShader(scene3D.scene);
    sky.setTimeOfDay(timeOfDay);
    
    // 光照
    const lighting = new Lighting(scene3D.scene);
    lighting.setTimeOfDay(timeOfDay);
    
    // 天气
    const weather = new Weather(scene3D.scene);
    // weather.setWeather('clear', timeOfDay);
    
    // 玻璃
    const glass = new WindowGlass(scene3D.scene);
    
    // 主循环
    scene3D.start((delta) => {
      // 火车前进（相机沿 Z 轴移动）
      cameraPos.current.z += speed * delta * 10;
      
      // 更新地形
      terrainLOD.update(cameraPos.current, speed);
      decorManager.update(cameraPos.current, terrainGen, biome, speed);
      
      // 相机跟随
      scene3D.camera.camera.position.copy(cameraPos.current);
      scene3D.camera.camera.lookAt(
        cameraPos.current.x + 50,
        cameraPos.current.y - 3,
        cameraPos.current.z + 200
      );
      
      // 相机晃动
      scene3D.camera.shake(0.02 * speed);
      
      // 天气更新
      weather.update(delta, cameraPos.current);
      glass.update(speed);
    });
    
    return () => {
      scene3D.dispose();
      terrainLOD.dispose();
      decorManager.dispose();
    };
  }, [sceneKind, timeOfDay, seed, speed]);
  
  return (
    <div className="relative w-full h-screen overflow-hidden bg-black" ref={sceneContainerRef}>
      {/* Three.js canvas 会自动插入到这里 */}
      
      {/* CSS overlay — 窗框、座椅等 */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* 所有现有的 overlay 元素 */}
      </div>
      
      {/* UI 层 */}
      <div className="absolute inset-0 z-20">
        {/* 计时器、退出按钮等 */}
      </div>
    </div>
  );
}
```

### 提交

```bash
git add -A
git commit -m "feat(3d): integrate Three.js scene into Home.tsx"
```

---

## Task 7: 调试页面重建

**目标:** 将 SceneDebug 和 FarDebug 改为 3D 场景调试

**Files:**
- Modify: `app/src/pages/debug/SceneDebug.tsx`
- Modify: `app/src/pages/debug/FarDebug.tsx`
- Create: `app/src/pages/debug/BiomeDebug.tsx`

SceneDebug 改为展示所有 5 种 biome 的 3D 小场景；FarDebug 改为地形条带预览；新增 BiomeDebug 展示植被和建筑。

由于调试页面复杂，建议：
- SceneDebug: 5 个小 Three.js 视口，每个展示一种 biome
- FarDebug: 地形横截面预览（类似现在的条带但用 3D）
- 保留 InteriorDebug（2D 窗内元素不需要改）

### 提交

```bash
git add -A
git commit -m "feat(3d): rebuild debug pages for 3D scene inspection"
```

---

## Task 8: 性能优化与 Polish

**目标:** 确保 60fps，修复 bug

**Files:**
- Modify: 各种文件

检查清单：
- [ ] InstancedMesh 替代单个 Mesh（大量树木时）
- [ ] 纹理压缩
- [ ] 阴影质量调整
- [ ] 移动设备适配
- [ ] 内存泄漏检查

### 提交

```bash
git add -A
git commit -m "perf(3d): instanced meshes, shadow optimization, memory cleanup"
```

---

## 总结

| Task | 内容 | 预估时间 |
|------|------|---------|
| 1 | Three.js 基础环境 | 2h |
| 2 | 无限地形生成 | 4h |
| 3 | 植被与建筑 | 4h |
| 4 | 天空、光照、天气 | 3h |
| 5 | 车窗玻璃 | 2h |
| 6 | Home.tsx 整合 | 3h |
| 7 | 调试页面 | 3h |
| 8 | 性能优化 | 4h |
| **总计** | | **~25h** |
