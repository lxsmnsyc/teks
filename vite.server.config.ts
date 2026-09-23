import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Build config for the things that run under Node: the game server and the
 * headless trial scripts.
 *
 * It deliberately leaves the Solid plugin out. None of this code contains JSX,
 * and with start mode enabled that plugin takes over the build to produce the
 * client and its document shell, which is not what these builds are for.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    ssr: true,
    emptyOutDir: false,
  },
});
