import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // validatie en botritten rekenen veel; onder volle belasting (build/e2e tegelijk) niet op 5 s afkappen
    testTimeout: 30000,
  },
});
