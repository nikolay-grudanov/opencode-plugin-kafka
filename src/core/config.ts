/**
 * Configuration parser for Kafka Router Plugin
 * Uses Zod for runtime validation of configuration JSON
 */

import { readFileSync } from 'fs';
import { PluginConfigSchema, PluginConfigV003Schema } from '../schemas/index.js';
import type { PluginConfig, PluginConfigV003 } from '../schemas/index.js';

/**
 * Путь к конфигурационному файлу по умолчанию
 */
const DEFAULT_CONFIG_PATH = '.opencode/kafka-router.json';

/**
 * FR-017: Валидирует topic coverage для конфигурации spec 003
 *
 * Проверяет, что responseTopic в правилах НЕ совпадает с input topics.
 * Это предотвращает зацикливание (message producers → message consumers → producers).
 *
 * @param config - Валидированный объект PluginConfigV003
 * @throws {Error} Если любой responseTopic совпадает с input topic
 */
export function validateTopicCoverage(config: PluginConfigV003): void {
  const inputTopics = new Set(config.topics);

  for (const rule of config.rules) {
    if (rule.responseTopic !== undefined && rule.responseTopic !== null && rule.responseTopic !== '') {
      if (inputTopics.has(rule.responseTopic)) {
        throw new Error(
          `FR-017 topic coverage violation: responseTopic "${rule.responseTopic}" ` +
          `cannot be one of the input topics: ${config.topics.join(', ')}`
        );
      }
    }
  }
}

/**
 * Разбирает и валидирует конфигурацию из файла kafka-router.json
 *
 * Функция читает файл конфигурации, путь к которому задан через:
 * 1. Переменную окружения KAFKA_ROUTER_CONFIG
 * 2. Или использует путь по умолчанию: .opencode/kafka-router.json
 *
 * @returns Валидированный объект PluginConfig
 * @throws {Error} Если файл не найден или не может быть прочитан
 * @throws {ZodError} Если конфигурация невалидна
 * @throws {Error} Если некоторые topics не имеют правил (FR-017)
 *
 * @example
 * ```ts
 * // Если KAFKA_ROUTER_CONFIG=/path/to/config.json
 * const config = parseConfig();
 * // config: PluginConfig { topics: [...], rules: [...] }
 * ```
 */
export function parseConfig(): PluginConfig {
  // Определяем путь к файлу конфигурации
  const configPath = process.env.KAFKA_ROUTER_CONFIG || DEFAULT_CONFIG_PATH;

  // Читаем файл конфигурации
  let rawJson: unknown;
  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    rawJson = JSON.parse(fileContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in config file ${configPath}: ${error.message}`
      );
    }
    // Ошибка файловой системы
    throw new Error(
      `Failed to read config file ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Валидируем конфигурацию через Zod schema
  // Zod выбросит ZodError если конфигурация невалидна
  const config = PluginConfigSchema.parse(rawJson);

  // FR-017: Проверяем, что все topics имеют хотя бы одно правило
  const coveredTopics = new Set(config.rules.map((r) => r.topic));
  const uncovered = config.topics.filter((t) => !coveredTopics.has(t));
  if (uncovered.length > 0) {
    throw new Error(`Topics without rules: ${uncovered.join(', ')}`);
  }

  return config;
}

/**
 * Validates spec-009 plugin-level toggles (FR-T2).
 *
 * Refuses to allow the plugin to boot when all three toggles are false,
 * because that combination violates Constitution Principle III (Resiliency):
 * no delivery mechanism means every Kafka message would go to DLQ.
 *
 * @throws {Error} When toolDelivery, eventHook, and pollingFallback are all false
 */
export function validateToggles(config: PluginConfigV003): void {
  const t = config.toggles;
  if (t.toolDelivery === false && t.eventHook === false && t.pollingFallback === false) {
    throw new Error(
      'Invalid plugin toggles: toolDelivery=false, eventHook=false, pollingFallback=false. ' +
      'No delivery mechanism is active — this would send every Kafka message to DLQ. ' +
      'Set pollingFallback=true (or toolDelivery=true / eventHook=true) to enable at least one delivery path.'
    );
  }
}

/**
 * Разбирает и валидирует конфигурацию spec 003 из файла kafka-router.json
 *
 * Функция читает файл конфигурации, путь к которому задан через:
 * 1. Переменную окружения KAFKA_ROUTER_CONFIG
 * 2. Или использует путь по умолчанию: .opencode/kafka-router.json
 *
 * @note FR-017 topic coverage validation ПРИМЕНЯЕТСЯ для spec 003
 *       Проверяется, что responseTopic не совпадает с input topics.
 *
 * @returns Валидированный объект PluginConfigV003
 * @throws {Error} Если файл не найден или не может быть прочитан
 * @throws {ZodError} Если конфигурация невалидна
 * @throws {Error} Если responseTopic совпадает с input topic (FR-017)
 *
 * @example
 * ```ts
 * // Если KAFKA_ROUTER_CONFIG=/path/to/config.json
 * const config = parseConfigV003();
 * // config: PluginConfigV003 { topics: [...], rules: [...] }
 * ```
 */
export function parseConfigV003(): PluginConfigV003 {
  // Определяем путь к файлу конфигурации
  const configPath = process.env.KAFKA_ROUTER_CONFIG || DEFAULT_CONFIG_PATH;

  // Читаем файл конфигурации
  let rawJson: unknown;
  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    rawJson = JSON.parse(fileContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in config file ${configPath}: ${error.message}`
      );
    }
    // Ошибка файловой системы
    throw new Error(
      `Failed to read config file ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Валидируем конфигурацию через Zod schema для spec 003
  // Zod выбросит ZodError если конфигурация невалидна
  const config = PluginConfigV003Schema.parse(rawJson);

  // FR-017: Проверяем, что responseTopic не совпадает с input topics
  validateTopicCoverage(config);

  // FR-T2 (spec-009): Проверяем, что хотя бы один toggle включён
  validateToggles(config);

  return config;
}