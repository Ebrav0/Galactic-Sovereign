import { defineConfig } from 'vite';

// Browsers refuse to load the source module graph from file:// pages. This
// build produces the classic-script bundle used by src/index.html only for
// direct ZIP launches; the regular Vite build remains module-based.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/js/main.js',
      formats: ['iife'],
      name: 'GalacticSovereign',
      fileName: () => 'main.standalone.js',
    },
    outDir: 'src/js',
    emptyOutDir: false,
  },
});
