/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the built app works from any subfolder: GitHub Pages
// project sites (https://user.github.io/repo/), a plain hosting subfolder,
// or the domain root.
export default defineConfig({
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
