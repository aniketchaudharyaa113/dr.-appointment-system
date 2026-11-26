import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./test/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 180000,
  },
});
