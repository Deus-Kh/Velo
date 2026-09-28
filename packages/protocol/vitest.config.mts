import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 5_000, // a hanging ratchet (S12) must fail, not stall the runner
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      // T4.7 coverage gate (measured 2026-09-28: lines 95.2, branches 83.9, functions 97.4).
      // A drop below these fails `npm run test:coverage`, and therefore CI.
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 90 },
    },
  },
});
