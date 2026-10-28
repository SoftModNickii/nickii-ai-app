import { defineConfig } from 'vite';

// VITE_BASE: the folder the app is served from ('/' on its own domain, '/nickii-ai-app/' on GitHub Pages).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  envDir: '../..',
  server: { port: 5174 },
  preview: { port: 4174 },
  build: { target: 'es2022', sourcemap: true },
});
