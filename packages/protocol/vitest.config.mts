import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 5_000, // a hanging ratchet (S12) must fail, not stall the runner
  },
});
