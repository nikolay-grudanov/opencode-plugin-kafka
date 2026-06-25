import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/opencode/adapter.test.ts'],
    exclude: [
      'tests/integration/**',
      'tests/e2e/**',
      'node_modules/**',
      '.opencode/**',
    ],
  },
});