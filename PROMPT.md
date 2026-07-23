You are working on the chill-window project: a train-window view app using Three.js to render beautiful scenery passing by.

## CURRENT STATE (already implemented)
- Three.js scene with train camera moving forward at 15 units/sec along +Z
- Infinite terrain with Perlin noise, chunked LOD (5 biomes: field, forest, mountain, river, town)
- Decorations: simple trees (cone + trunk) and rocks (dodecahedron) per biome density
- Sky blue background (0x87CEEB) + distance fog (200-900)
- Basic ambient + directional lighting
- React component ThreeCanvas.tsx at app/src/engine/three/ThreeCanvas.tsx
- Camera at (0, 2, z), looking at (0, 1.5, z+50)

## CODE STRUCTURE
app/src/engine/three/
  ThreeCanvas.tsx    — main React component, scene setup, animation loop
  core/
    Camera.ts        — TrainCamera class (update(dt) moves camera forward)
    Renderer.ts      — WebGLRenderer wrapper
    Scene3D.ts       — Scene wrapper (minimal, no grid)
  terrain/
    TerrainGen.ts    — Perlin noise height generation
    TerrainLOD.ts    — Chunked LOD terrain with decorations
    Biome.ts         — Biome configs (5 types with colors, height params, decor density)

## REMAINING TASKS (complete ALL in order)

### TASK 1: Sky and Atmosphere System
Create app/src/engine/three/sky/SkyDome.ts:

- Sky dome: large SphereGeometry(radius=1000, 32, 32), inside-out (scale.y = -1)
- Use ShaderMaterial with vertex/fragment shaders for gradient sky
- Gradient: horizon = warm orange/pink (0xFFDAB9), zenith = deep blue (0x1E3A5F)
- Add sun: bright circle on the dome that moves across sky
- Sun color: 0xFFF5E1, size varies by height (larger near horizon)
- The dome should follow camera position (always centered on camera)
- Fog should blend with sky color at horizon

Modify ThreeCanvas.tsx:
- Instantiate SkyDome, pass camera position each frame
- Update fog color to match sky dome horizon color

### TASK 2: Day/Night Cycle
Create app/src/engine/three/sky/TimeOfDay.ts:

- Enum: DAWN, DAY, DUSK, NIGHT
- Cycle progresses automatically over time (full cycle = 5 minutes real time)
- Each phase affects:
  - Sky gradient colors
  - Sun position and intensity
  - Ambient light intensity and color
  - Directional light intensity, color, position
  - Fog color and density
- DAWN: warm orange sky, low sun, soft pink light, fog warm
- DAY: bright blue sky, high sun, white light, fog light blue
- DUSK: purple/orange sky, setting sun, orange light, fog purple
- NIGHT: dark blue/black sky, no sun, moon light (cool blue), stars visible, dense dark fog

Stars: add small white points on sky dome during NIGHT phase (use Points + BufferGeometry)

Modify ThreeCanvas.tsx:
- Instantiate TimeOfDay
- Pass delta time each frame to update cycle
- Apply lighting changes to ambient + directional lights
- SkyDome should receive time-of-day colors from TimeOfDay

### TASK 3: Weather Effects
Create app/src/engine/three/weather/WeatherSystem.ts:

- Types: CLEAR, CLOUDY, RAIN, SNOW, FOGGY
- Weather changes randomly every 2-3 minutes, or can be set manually
- CLOUDY: add cloud layers (simple white fluffy spheres/boxes at various heights, slow drift)
- RAIN: particle system falling downward, splash on ground, darker lighting
- SNOW: particle system falling slowly with drift, white fog, softer lighting
- FOGGY: denser fog (near=50, far=400), muted colors, no sun visible
- CLEAR: normal state

Clouds: use simple IcosahedronGeometry or SphereGeometry, white material (opacity 0.6-0.8), drift slowly across sky. 20-50 clouds depending on weather. Dispose when switching weather.

Modify ThreeCanvas.tsx:
- Instantiate WeatherSystem
- Pass time-of-day info and camera position each frame
- Weather affects lighting and fog

### TASK 4: Train Interior (Window Frame)
Create app/src/engine/three/interior/WindowFrame.ts:

- Train window frame that sits in front of the camera
- Left/right vertical pillars, top horizontal bar, bottom window sill
- Materials: dark wood (0x3d2817) for frame, metal (0x444444) for details
- Window glass: semi-transparent plane with slight reflection hint
- The frame should be positioned relative to camera but NOT move with it (fixed in view)
- Use orthographic-like positioning or always position at camera front

Better approach: render interior on a separate overlay layer or use HUD-like positioning. For simplicity:
- Create the frame as a group of meshes
- Each frame, position the group at camera.position + camera direction * 2
- Rotate to face camera look direction
- This creates a "looking through a window" effect

Also add:
- Window sill with small objects (optional): a cup, a book, a plant pot
- Keep it minimal but cozy

### TASK 5: Performance Polish
- Enable renderer shadow map (SoftShadowMap)
- Enable directional light shadows (shadow camera bounds: 50x50, near=0.5, far=200)
- Add frustum culling check before rendering chunks
- Limit max chunks to 12 (3x4 grid)
- Reduce decoration count for distant chunks (half decorations for LOD 32, quarter for LOD 16)
- Use object pooling for weather particles instead of creating/destroying
- Add delta time clamp (max 0.1s) to prevent spiral of death on lag

### TASK 6: Smooth Biome Transitions
Modify TerrainLOD.ts:
- Instead of hard biome switch, blend between two biome height/color params
- When moving far enough (every 2000 units), pick next biome and blend over 500 units
- Blending: linear interpolation of height params and vertex colors during transition
- Show a subtle text overlay indicating current location type (optional, can skip)

## TECHNICAL CONSTRAINTS
- TypeScript with strict types
- Import THREE from "three" (already in package.json)
- Do NOT add new npm packages
- Follow existing code patterns (class-based, file-per-concern)
- Keep files under 300 lines when possible
- Use THREE.Clock for time, not Date.now()
- Dispose all geometries/materials/textures in dispose() methods
- Run "npx tsc --noEmit" after each task to verify no TS errors

## IMPORTANT RULES
1. Read existing files before modifying them
2. Create new files in appropriate subdirectories
3. Update ThreeCanvas.tsx to wire up each new system
4. Verify compilation after each major change
5. Keep the "train window" feel: camera is fixed inside a train, looking out at passing scenery
6. Performance target: 60fps on modern laptop

After completing all tasks, run the dev server with "npm run dev" and verify it compiles and runs.
