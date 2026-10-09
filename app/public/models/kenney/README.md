# Local scenery catalogue

16 selected GLB files from official Kenney packs, checked 2026-10-09:

- Nature Kit: https://kenney.nl/assets/nature-kit
- City Kit (Suburban): https://kenney.nl/assets/city-kit-suburban
- City Kit (Commercial): https://kenney.nl/assets/city-kit-commercial

Each pack's original `License.txt` is retained in its directory (CC0). External palette textures retain the GLB-relative `Textures/` path. `manifest.json` records selected model sizes and SHA-256 checksums. No third-party runtime code is included.

`SceneryAssets.ts` normalizes the original models to unit height, recolours nature materials to the landscape palette, and caches geometry/materials for instancing. `PatchScenery.ts` assigns metre-based height and checks each foundation/parcel before placement. No claim that these models reproduce a particular Chinese region.
