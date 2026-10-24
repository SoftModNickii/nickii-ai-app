import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'supabase/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'jsdom',
  },
});
