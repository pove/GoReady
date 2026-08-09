/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the built app works from any subfolder: GitHub Pages
// project sites (https://user.github.io/repo/), a plain hosting subfolder,
// or the domain root.
export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      // No runtimeCaching rules: the generated service worker only ever
      // precaches this build's own dist/ output, so intervals.icu requests
      // through the proxy are never intercepted or cached - they always hit
      // the network, and fail through to the app's existing error screen
      // when offline. Serving a cached wellness reading as if it were
      // today's would be wrong, not just stale.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'GoReady',
        short_name: 'GoReady',
        description: 'Daily training readiness from your intervals.icu HRV and resting heart rate.',
        theme_color: '#14532d',
        background_color: '#f3f4f6',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
