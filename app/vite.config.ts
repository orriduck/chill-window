import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff2}'],
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
});
