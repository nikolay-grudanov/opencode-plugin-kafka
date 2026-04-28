import { defineConfig } from 'vitest/config';

// Конфигурация для интеграционных тестов (реальный Redpanda и mock-based тесты)
// Запуск: npx vitest run --config vitest.integration.config.ts
export default defineConfig({
  test: {
    globals: true,
    // Все тесты из директории tests/integration/
    include: ['tests/integration/**/*.test.ts'],
    // Увеличенные таймауты для container startup/shutdown
    testTimeout: 60000,
    hookTimeout: 60000,
    // Подробный вывод для диагностики
    reporters: ['verbose'],
  },
});