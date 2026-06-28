/**
 * Хелпер для создания тестовых конфигов с правильными типами.
 * Использует type assertion для обхода проверки полей при typecheck.
 */
import type { PluginConfigV003, RuleV003 } from '../../../src/schemas/index.js';

/**
 * Создать базовый RuleV003 с полями по умолчанию.
 */
export function createTestRule(partial: Partial<RuleV003> = {}): RuleV003 {
  return {
    name: 'test-rule',
    jsonPath: '$.test',
    promptTemplate: 'Test: ${$}',
    agentId: 'test-agent',
    timeoutMs: 30000,
    concurrency: 1,
    requireToolCall: true,
    fallbackToTextCapture: false,
    safetyNetTimeoutMs: 60000,
    maxSessionMs: 300000,
    ...partial,
  } as RuleV003;
}

/**
 * Создать базовый PluginConfigV003 с полями по умолчанию.
 */
export function createTestConfig(partial: Partial<PluginConfigV003> = {}): PluginConfigV003 {
  return {
    topics: ['test-topic'],
    rules: [createTestRule()],
    toggles: { toolDelivery: true, eventHook: true, pollingFallback: false },
    ...partial,
  } as PluginConfigV003;
}
