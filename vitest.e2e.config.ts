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
    include: ['tests/e2e/**/*.e2e.test.ts'],
    // Увеличенные таймауты для реального Kafka + LLM + контейнер
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Последовательное выполнение — один fork для изоляции state между тестами
    pool: 'forks',
    singleFork: true,
    // Подробный вывод для диагностики E2E
    reporters: ['verbose'],
  },
});