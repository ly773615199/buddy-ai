import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'frontend', 'src/brain/bench/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test*.ts'],
    },
  },
  resolve: {
    alias: {
      '@capacitor/core': path.resolve(__dirname, 'src/__mocks__/@capacitor/core.ts'),
    },
  },
});
