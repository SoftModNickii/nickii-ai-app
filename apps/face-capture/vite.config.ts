import { defineConfig } from 'vite';

// VITE_BASE: the folder the page is served from ('/' locally, '/nickii-ai-app/face/' on GitHub Pages).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  envDir: '../..',
  // localhost counts as a secure origin, which the webcam needs.
  server: { port: 5175 },
  preview: { port: 4175 },
  build: { target: 'es2022', sourcemap: true },
});
