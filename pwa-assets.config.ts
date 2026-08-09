import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the PWA icon set (transparent 64/192/512, maskable 512, apple
// touch 180, favicon.ico) from the existing hand-drawn favicon.svg, so there
// is one source of truth for the app's icon artwork. Run via `npm run
// generate-pwa-assets` whenever that SVG changes; the output PNGs are
// committed like any other static asset, not regenerated on every build.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // Default padding fills the margin with white, which shows as a white
    // ring once Android crops this to its own circle/squircle mask. Brand
    // green instead, so the cropped shape still reads as the app's icon.
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { fit: 'contain', background: '#14532d' },
    },
    // iOS applies its own rounded-corner mask on top of this icon, so it
    // should be full-bleed with no padding of its own - the default 30%
    // white padding just left a visible border under iOS's rounding.
    apple: {
      ...minimal2023Preset.apple,
      padding: 0,
      resizeOptions: { fit: 'contain', background: '#14532d' },
    },
  },
  images: ['public/favicon.svg'],
});
