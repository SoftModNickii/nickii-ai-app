import { defineConfig } from 'vite';

// VITE_BASE: the folder the app is served from ('/' on its own domain, '/nickii-ai-app/' on GitHub Pages).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  // One .env at the repository root for all apps.
  envDir: '../..',
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', sourcemap: true },
});
