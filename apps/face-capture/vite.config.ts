import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '../..',
  // localhost counts as a secure origin, which the webcam needs.
  server: { port: 5175 },
  preview: { port: 4175 },
  build: { target: 'es2022', sourcemap: true },
});
