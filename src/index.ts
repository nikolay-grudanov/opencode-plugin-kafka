/**
 * Kafka Router Plugin Entry Point
 *
 * Plugin entry point for OpenCode Kafka Router plugin.
 * Implements FR-025 from spec 003-kafka-consumer.
 *
 * @see https://opencode.ai/docs/plugins/
 * @see spec/003-kafka-consumer/spec.md § FR-025
 */

import type { PluginContext, PluginHooks } from './types/opencode-plugin.d.ts';
import { parseConfigV003 } from './core/config.js';
import { startConsumer } from './kafka/consumer.js';
import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';

/**
 * Plugin entry point for OpenCode Kafka Router plugin.
 *
 * FR-025: reads kafka-router.json from KAFKA_ROUTER_CONFIG env (default: .opencode/kafka-router.json);
 *         calls parseConfigV003() on file contents;
 *         calls startConsumer(config);
 *         exports default async function plugin(): Promise<PluginHooks>
 *
 * Функция plugin() является точкой входа плагина OpenCode.
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
 * // OpenCode вызывает функцию plugin() из этого файла
 * await plugin(context);
 * ```
 */
export default async function plugin(context: PluginContext): Promise<PluginHooks> {
  try {
    // 1. Парсим конфигурацию из kafka-router.json (spec 003)
    const config = parseConfigV003();

    // 2. Создаём адаптер для OpenCode агентов из SDK клиента
    const agent = new OpenCodeAgentAdapter(context.client);

    // 3. Запускаем Kafka consumer (возвращает после init, не после shutdown)
    await startConsumer(config, agent);

    // Возвращаем пустой объект hooks (нет необходимости подписываться на события)
    // Этот плагин запускается как standalone consumer
    return {};
  } catch (error) {
    // Логируем ошибку для fail-fast поведения
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
}
