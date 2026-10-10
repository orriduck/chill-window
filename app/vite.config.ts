import path from "path"
import { cp, mkdir } from "node:fs/promises"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  // Historical originals remain in public for audit, but only today's runtime
  // data and fantasy assets are copied into a release. No legacy asset packs.
  publicDir: command === 'build' ? false : 'public',
  plugins: [
    {
      name: 'hudson-runtime-assets',
      async writeBundle() {
        for (const file of ['favicon-32.png', 'apple-touch-icon.png', 'icons', 'models/fantasy', 'textures/fantasy',
          'geodata/hudson/world.json', 'geodata/hudson/elevation.f32', 'geodata/hudson/stations.json',
          'geodata/hudson/buildings.json.gz', 'geodata/hudson/landcover.json', 'geodata/hudson/landcover.u8']) {
          const destination = path.resolve(__dirname, 'dist', file)
          await mkdir(path.dirname(destination), { recursive: true })
          await cp(path.resolve(__dirname, 'public', file), destination, { recursive: true })
        }
      },
    },
    inspectAttr(),
    react(),
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon-32.png',
        'apple-touch-icon.png',
        'icons/window-seat-192.png',
        'icons/window-seat-512.png',
      ],
      manifest: {
        id: '/',
        name: 'Window Seat',
        short_name: 'Window Seat',
        description: 'A calm train-window focus journey.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a1215',
        theme_color: '#0b161b',
        orientation: 'any',
        icons: [
          {
            src: '/icons/window-seat-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/window-seat-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}', 'models/fantasy/**/*.{glb,json,txt}', 'textures/fantasy/*.{json,txt}',
          'geodata/hudson/*.{json,f32,u8,gz}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
