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
  // TDD: This is a stub that will fail tests
  throw new Error('Not implemented yet');
}
