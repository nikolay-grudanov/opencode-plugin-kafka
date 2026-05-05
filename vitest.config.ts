import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    globals: true,
    environment: 'node',
    exclude: [
      'tests/integration/**',
      'tests/e2e/**',
      '**/*.integration.test.ts',
      'node_modules/**',
      '.opencode/**',
      'dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/core/index.ts',
        'src/opencode/IOpenCodeAgent.ts',
        'src/types/**',
        'src/schemas/index.ts',
        'src/kafka/consumer.ts',
        'tests/**',
        'dist/**',
        'node_modules/**',
        '**/parse-cov.cjs',
        'vitest*.config.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 88,
        statements: 90,
      },
    },
  },
});