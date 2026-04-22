/**
 * Kafka Router Plugin Entry Point
 *
 * Plugin entry point for OpenCode Kafka Router plugin.
 * Implements FR-025 from spec 003-kafka-consumer.
 *
 * @see https://opencode.ai/docs/plugins/
 * @see spec/003-kafka-consumer/spec.md § FR-025
 */

import type { Plugin } from 'opencode-plugin';
import { parseConfigV003 } from './core/config.js';
import { startConsumer } from './kafka/consumer.js';

/**
 * Plugin entry point for OpenCode Kafka Router plugin.
 *
 * FR-025: reads kafka-router.json from KAFKA_ROUTER_CONFIG env (default: .opencode/kafka-router.json);
 *         calls parseConfigV003() on file contents;
 *         calls startConsumer(config);
 *         exports default async function start(): Promise<void>
 *
 * Функция start() является точкой входа плагина OpenCode.
 * Она:
 * 1. Читает конфигурацию из kafka-router.json (spec 003)
 * 2. Валидирует конфигурацию через Zod schema (PluginConfigV003Schema)
 * 3. Запускает Kafka consumer с graceful shutdown support
 *
 * @param context - Контекст плагина OpenCode (не используется в данном плагине)
 * @returns Plugin hooks object (пустой для этого плагина)
 *
 * @example
 * ```ts
 * // Плагин автоматически загружается OpenCode при старте
 * // OpenCode вызывает функцию start() из этого файла
 * await start();
 * ```
 */
export default function plugin(context: Parameters<Plugin>[0]) {
  // Объявляем функцию start для запуска consumer
  const start = async (): Promise<void> => {
    try {
      // 1. Парсим конфигурацию из kafka-router.json (spec 003)
      const config = parseConfigV003();

      // 2. Запускаем Kafka consumer
      await startConsumer(config);
    } catch (error) {
      // Логируем ошибку и выбрасываем её для fail-fast поведения
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(
        JSON.stringify({
          level: 'error',
          event: 'plugin_start_failed',
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
      );

      throw error;
    }
  };

  // Запускаем плагин автоматически при загрузке
  // OpenCode вызывает plugin(), а мы запускаем start() внутри
  // Это позволяет плагину работать как standalone consumer
  start().catch((error) => {
    // Error уже залогирован в start()
    process.exit(1);
  });

  // Возвращаем пустой объект hooks (нет необходимости подписываться на события)
  // Этот плагин запускается как standalone consumer
  return {};
}
