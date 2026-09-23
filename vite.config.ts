import solid from '@solidjs/vite-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // start mode: the plugin owns the entries and the document shell, serves
  // the app in development, and emits a static client build. `ssr` is left off
  // because there is nothing to render ahead of time here; the game is a
  // canvas behind a join screen.
  plugins: [solid({ start: true })],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 3000 },
  preview: { port: 3000 },
});
