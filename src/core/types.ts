/**
 * Чистые TypeScript интерфейсы для Kafka Router Plugin.
 *
 * Эти типы используются для статической типизации без зависимости от Zod.
 * Для runtime валидации используйте схемы из src/schemas/index.ts.
 */

/**
 * Правило маршрутизации для сообщений из Kafka topic.
 */
export interface Rule {
  /** Уникальное имя правила (обязательно) */
  name: string;
  /** Kafka topic для применения правила (обязательно) */
  topic: string;
  /** Agent ID для обработки сообщений (обязательно) */
  agent: string;
  /** JSONPath expression для фильтрации (опционально — catch-all) */
  condition?: string;
  /** Slash command для агента (опционально) */
  command?: string;
  /** JSONPath field для извлечения текста (по умолчанию "$") */
  prompt_field?: string;
}

/**
 * Корневой объект конфигурации плагина.
 */
export interface PluginConfig {
  /** Kafka topics для мониторинга (минимум 1) */
  topics: string[];
  /** Routing rules (минимум 1) */
  rules: Rule[];
}

/**
 * Произвольный JSON-объект сообщения из Kafka topic.
 */
export type Payload = unknown;
