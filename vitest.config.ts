import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    // Исключаем type-only файлы и конфиги
    exclude: [
      'node_modules/',
      'tests/',
      '**/*.d.ts',
      '**/*.config.*',
      'dist/',
      // Type-only files (interfaces and re-exports)
      'src/core/types.ts',
      'src/core/index.ts',
    ],
    thresholds: {
      lines: 90,
      branches: 90,
      functions: 90,
      statements: 90,
      perFile: false,
    },
  },
});
