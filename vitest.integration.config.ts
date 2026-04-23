import { defineConfig } from 'vitest/config';

// Отдельная конфигурация для интеграционных тестов с реальным Redpanda
// Запуск: npx vitest run --config vitest.integration.config.ts
export default defineConfig({
  test: {
    globals: true,
    // Только интеграционные тесты
    include: ['tests/integration/**/*.integration.test.ts'],
    // Увеличенные таймауты для container startup/shutdown
    testTimeout: 60000,
    hookTimeout: 60000,
    // Подробный вывод для диагностики
    reporters: ['verbose'],
  },
});