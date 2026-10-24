import { defineConfig } from 'vite';

export default defineConfig({
  // One .env at the repository root for all apps.
  envDir: '../..',
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', sourcemap: true },
});
