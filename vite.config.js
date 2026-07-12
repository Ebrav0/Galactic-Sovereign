import { defineConfig } from 'vite';

const GAME_ENTRY_RE = /\s*<!-- GAME_ENTRY_START -->[\s\S]*?<!-- GAME_ENTRY_END -->\s*/;

export default defineConfig({
  root: 'src',
  // Relative base so the built renderer loads from file:// inside Electron.
  base: './',
  plugins: [{
    name: 'galactic-sovereign-production-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (context.server) return html;
        return html.replace(GAME_ENTRY_RE, '\n  <script type="module" src="./js/main.js"></script>\n');
      },
    },
  }],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
