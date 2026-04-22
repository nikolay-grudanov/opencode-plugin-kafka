/**
 * Configuration parser for Kafka Router Plugin
 * Uses Zod for runtime validation of configuration JSON
 */

import { PluginConfigSchema } from '../schemas';
import type { PluginConfig } from './types';

/**
 * Parse and validate raw JSON configuration
 * @param rawJson - Raw JSON object (unknown type)
 * @returns Validated PluginConfig object
 * @throws {ZodError} If configuration is invalid
 */
export function parseConfig(rawJson: unknown): PluginConfig {
  // Используем Zod schema для валидации конфигурации
  // Zod выбросит ZodError если конфигурация невалидна
  return PluginConfigSchema.parse(rawJson);
}
