import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'client/**/*'],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../client/src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
