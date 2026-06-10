import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    rollupOptions: {
      output: {
        // Keep three.js in its own chunk so it caches independently of game code.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
