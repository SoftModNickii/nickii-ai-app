import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '../..',
  server: { port: 5174 },
  preview: { port: 4174 },
  build: { target: 'es2022', sourcemap: true },
});
