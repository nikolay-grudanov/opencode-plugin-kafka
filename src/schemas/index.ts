/**
 * Zod schemas for runtime validation of Kafka Router Plugin configuration
 */

import { z } from 'zod';

/**
 * Zod schema for Rule
 */
export const RuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  topic: z.string().min(1, 'Topic is required'),
  agent: z.string().min(1, 'Agent is required'),
  condition: z.string().optional(),
  command: z.string().optional(),
  prompt_field: z.string().default('$'),
});

/**
 * Zod schema for PluginConfig
 */
export const PluginConfigSchema = z.object({
  topics: z.array(z.string()).min(1, 'At least one topic required'),
  rules: z.array(RuleSchema).min(1, 'At least one rule required'),
});

/**
 * TypeScript types for configuration objects.
 * Импортируются из core/types.ts для единого источника истины.
 */
export type { Rule, PluginConfig } from '../core/types.js';
