/**
 * Public API exports for Kafka Router Plugin Core
 *
 * Phase 2: Foundational types and schemas
 * @see plan.md § Project Structure
 */

export type { Rule, PluginConfig, Payload } from './types.js';

// Re-export schemas for convenience
export { RuleSchema, PluginConfigSchema } from '../schemas/index.js';

// Prompt building functions
export { buildPrompt } from './prompt.js';

// Re-export routing functions
export { matchRule } from './routing.js';

// Export configuration parser
export { parseConfig } from './config.js';
