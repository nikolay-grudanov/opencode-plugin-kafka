/**
 * Public API exports for Kafka Router Plugin Core
 *
 * Phase 2: Foundational types and schemas
 * @see plan.md § Project Structure
 */

// Re-export types from schemas (derived from z.infer<>)
export type { RuleV003, PluginConfigV003, Payload, KafkaMessage, ProcessingResult } from '../schemas/index.js';

// Re-export schemas for convenience
export { RuleV003Schema, PluginConfigV003Schema } from '../schemas/index.js';

// Prompt building functions (spec 003 only)
export { buildPromptV003 } from './prompt.js';

// Re-export routing functions (spec 003 only)
export { matchRuleV003 } from './routing.js';

// Export configuration parser
export { parseConfig, parseConfigV003 } from './config.js';
