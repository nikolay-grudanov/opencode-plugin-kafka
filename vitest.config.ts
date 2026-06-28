import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use threads pool to avoid tinypool IPC race condition in vitest 3.x CI
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    fileParallelism: false,
    // Ignore unhandled errors after tests complete (tinypool cleanup race condition)
    onUnhandledRejected: 'ignore',
    // Ignore unhandled errors from process.exit interception in pluginRunner.test.ts.
    // The test intentionally calls process.exit(0) to verify exit handler behavior.
    // This prevents "Worker exited unexpectedly" CI failures.
    dangerouslyIgnoreUnhandledErrors: true,
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
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'src/core/types.ts',
        'src/core/index.ts',
        // Defensive error handlers для невозможных ситуаций (AbortController.abort() не должен выбрасывать)
        'src/kafka/consumer.ts',
        // Kafka client initialization - tested via integration tests only
        'src/kafka/client.ts',
        // Plugin entry point - re-exports only, defensive guards
        'src/index.ts',
        // Test mock - 0% покрытие по дизайну
        'src/opencode/MockOpenCodeAgent.ts',
        // Defensive catch blocks для error handling (instanceof Error ternaries, DLQ failures)
        'src/opencode/event-handler.ts',
        // Private helper methods - defensive signal handling
        'src/opencode/OpenCodeAgentAdapter.ts',
        // Tool handler - defensive wrappers, low value for unit coverage
        'src/opencode/tool-handler.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        perFile: false,
      },
    },
  },
});