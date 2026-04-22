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
 * Разбирает и валидирует конфигурацию spec 003 из файла kafka-router.json
 *
 * Функция читает файл конфигурации, путь к которому задан через:
 * 1. Переменную окружения KAFKA_ROUTER_CONFIG
 * 2. Или использует путь по умолчанию: .opencode/kafka-router.json
 *
 * @note FR-017 topic coverage validation НЕ применяется для spec 003
 *       потому что RuleV003Schema не имеет поля 'topic'.
 *       Spec 003 использует JSONPath-based routing без явного topic-rule mapping.
 *
 * @returns Валидированный объект PluginConfigV003
 * @throws {Error} Если файл не найден или не может быть прочитан
 * @throws {ZodError} Если конфигурация невалидна
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
  // Примечание: FR-017 topic coverage validation НЕ применяется для spec 003
  // потому что RuleV003Schema не имеет поля 'topic'
  const config = PluginConfigV003Schema.parse(rawJson);

  return config;
}
