/**
 * Public API exports for Kafka Router Plugin Core
 *
 * Phase 2: Foundational types and schemas
 * @see plan.md § Project Structure
 */

// Re-export types from schemas (derived from z.infer<>)
export type { Rule, RuleV003, PluginConfig, PluginConfigV003, Payload, KafkaMessage, ProcessingResult } from '../schemas/index.js';

// Re-export schemas for convenience
export { RuleSchema, PluginConfigSchema, RuleV003Schema, PluginConfigV003Schema } from '../schemas/index.js';

// Prompt building functions
export { buildPrompt, buildPromptV003 } from './prompt.js';

// Re-export routing functions
export { matchRule, matchRuleV003 } from './routing.js';

// Export configuration parser
export { parseConfig, parseConfigV003 } from './config.js';
