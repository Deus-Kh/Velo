import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Route tests start an in-memory MongoDB in beforeAll; the first run may
    // also download the mongod binary.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
