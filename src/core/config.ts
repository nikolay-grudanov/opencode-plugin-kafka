/**
 * Configuration parser for Kafka Router Plugin
 * Uses Zod for runtime validation of configuration JSON
 */

import { PluginConfigSchema } from '../schemas';
import type { PluginConfig } from '../schemas/index.js';

/**
 * Parse and validate raw JSON configuration
 * @param rawJson - Raw JSON object (unknown type)
 * @returns Validated PluginConfig object
 * @throws {ZodError} If configuration is invalid
 * @throws {Error} If some topics have no rules
 */
export function parseConfig(rawJson: unknown): PluginConfig {
  // Используем Zod schema для валидации конфигурации
  // Zod выбросит ZodError если конфигурация невалидна
  const config = PluginConfigSchema.parse(rawJson);
  
  // Проверяем, что все topics имеют хотя бы одно правило
  const coveredTopics = new Set(config.rules.map(r => r.topic));
  const uncovered = config.topics.filter(t => !coveredTopics.has(t));
  if (uncovered.length > 0) {
    throw new Error(`Topics without rules: ${uncovered.join(', ')}`);
  }
  
  return config;
}
