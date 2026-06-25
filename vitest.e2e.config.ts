import { defineConfig } from 'vitest/config';

/**
 * Конфигурация Vitest для E2E-тестов.
 *
 * Запускает реальные процессы:
 * - Redpanda контейнер (testcontainers)
 * - OpenCode serve (spawn)
 * - Lemonade LLM API (HTTP)
 *
 * Основные отличия от integration:
 * - testTimeout: 120_000 (E2E медленнее из-за LLM вызовов)
 * - hookTimeout: 60_000 (запуск контейнеров/процессов)
 * - pool: 'forks', singleFork: true (последовательное выполнение для изоляции state)
 *
 * Запуск: npm run test:e2e
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['default'],
  },
});
