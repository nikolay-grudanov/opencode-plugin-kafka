/**
 * LLM provider fixture for e2e tests.
 *
 * The local OpenCode instance uses the omniroute-combo model from
 * ~/.config/opencode/opencode.json. Tests don't need to pick the model
 * explicitly — they just produce messages and let OpenCode's plugin
 * route them via the kafka plugin.
 *
 * This helper exists as a placeholder for future tests that need to
 * override the model (e.g., to use a deterministic mock).
 */

export const DEFAULT_LLM_MODEL = 'minimax-coding-plan/MiniMax-M2';

export function llmProviderEnv(): Record<string, string> {
  // No additional env needed — OpenCode reads ~/.config/opencode/opencode.json
  return {};
}