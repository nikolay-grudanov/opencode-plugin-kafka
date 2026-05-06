/**
 * Type inference verification tests
 * Verifies SC-008: z.infer<> types are correctly derived and exported
 *
 * Compile-time type checking via @tsd/expect-type (SC-008 requirement):
 * We use TypeScript's type system directly - the imports and type annotations
 * themselves are the compile-time checks. If types are incorrect, tsc --noEmit fails.
 *
 * Runtime verification via vitest confirms runtime behavior matches.
 */

import { describe, it, expect } from 'vitest';
import { Rule, PluginConfig, Payload, RuleSchema, PluginConfigSchema } from '../../src/schemas/index.js';
import type { RuleV003, PluginConfigV003 } from '../../src/schemas/index.js';

// SC-008: Verify z.infer<> types are correctly exported
// Compile-time check: type annotations verify Rule, PluginConfig, Payload are correct
// If z.infer<> produces wrong types, tsc --noEmit will report errors

describe('Type exports from schemas/index.ts (SC-008)', () => {
  it('Rule type has all required fields from z.infer', () => {
    // Compile-time: this assignment verifies Rule has name, topic, agent
    const rule: Rule = {
      name: 'test-rule',
      topic: 'test-topic',
      agent: 'test-agent',
      prompt_field: '$',
    };

    expect(rule.name).toBe('test-rule');
    expect(rule.topic).toBe('test-topic');
    expect(rule.agent).toBe('test-agent');
  });

  it('Rule type has optional fields that work correctly', () => {
    const ruleWithOptional: Rule = {
      name: 'test-rule',
      topic: 'test-topic',
      agent: 'test-agent',
      condition: '$.severity == "critical"',
      command: 'analyze',
      prompt_field: '$.data',
    };

    expect(ruleWithOptional.condition).toBe('$.severity == "critical"');
    expect(ruleWithOptional.command).toBe('analyze');
    expect(ruleWithOptional.prompt_field).toBe('$.data');
  });

  it('Rule type allows omitting optional fields', () => {
    const rule: Rule = {
      name: 'test-rule',
      topic: 'test-topic',
      agent: 'test-agent',
      prompt_field: '$',
    };

    expect(rule.condition).toBeUndefined();
    expect(rule.command).toBeUndefined();
    expect(rule.prompt_field).toBe('$');
  });

  it('RuleSchema.parse applies default for prompt_field', () => {
    const parsed = RuleSchema.parse({
      name: 'test-rule',
      topic: 'test-topic',
      agent: 'test-agent',
    });

    // Default is applied during parse
    expect(parsed.prompt_field).toBe('$');
  });

  it('PluginConfig type correctly contains topics and rules', () => {
    const config: PluginConfig = {
      topics: ['security', 'audit'],
      rules: [
        { name: 'r1', topic: 'security', agent: 'a1', prompt_field: '$' },
        { name: 'r2', topic: 'audit', agent: 'a2', prompt_field: '$' },
      ],
    };

    expect(config.topics).toHaveLength(2);
    expect(config.rules).toHaveLength(2);
  });

  it('Payload type is unknown as specified', () => {
    const payload1: Payload = { foo: 'bar' };
    const payload2: Payload = [1, 2, 3];
    const payload3: Payload = 'string';
    const payload4: Payload = null;

    expect(payload1).toEqual({ foo: 'bar' });
    expect(payload2).toEqual([1, 2, 3]);
    expect(payload3).toBe('string');
    expect(payload4).toBeNull();
  });

  it('RuleSchema produces correct inferred types', () => {
    const parsed = RuleSchema.parse({
      name: 'test',
      topic: 'test-topic',
      agent: 'test-agent',
      prompt_field: '$.custom',
    });

    const rule: Rule = parsed;
    expect(rule.name).toBe('test');
    expect(rule.prompt_field).toBe('$.custom');
  });

  it('PluginConfigSchema produces correct inferred types', () => {
    const parsed = PluginConfigSchema.parse({
      topics: ['topic1'],
      rules: [{ name: 'r1', topic: 'topic1', agent: 'a1' }],
    });

    const config: PluginConfig = parsed;
    expect(config.topics[0]).toBe('topic1');
    expect(config.rules[0].agent).toBe('a1');
  });
});

// SC-008: Verify V003 types are correctly exported
describe('Type exports for RuleV003 and PluginConfigV003 (SC-008)', () => {
  it('RuleV003 type has all required fields', () => {
    // Compile-time: this assignment verifies RuleV003 has all required fields
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.status',
      promptTemplate: 'Process {$.status}',
      agentId: 'agent-1',
      timeoutMs: 120_000,
      concurrency: 1,
    };

    expect(rule.name).toBe('test-rule');
    expect(rule.jsonPath).toBe('$.status');
    expect(rule.promptTemplate).toBe('Process {$.status}');
    expect(rule.agentId).toBe('agent-1');
    expect(rule.timeoutMs).toBe(120_000);
    expect(rule.concurrency).toBe(1);
  });

  it('RuleV003 type allows optional responseTopic', () => {
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.status',
      promptTemplate: 'Process {$.status}',
      agentId: 'agent-1',
      timeoutMs: 120_000,
      concurrency: 1,
      responseTopic: 'response-topic',
    };

    expect(rule.responseTopic).toBe('response-topic');
  });

  it('RuleV003 type allows omitting optional fields', () => {
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.status',
      promptTemplate: 'Process {$.status}',
      agentId: 'agent-1',
      timeoutMs: 120_000,
      concurrency: 1,
      // responseTopic optional
    };

    expect(rule.responseTopic).toBeUndefined();
  });

  it('PluginConfigV003 type correctly contains topics and rules', () => {
    const config: PluginConfigV003 = {
      topics: ['input-topic', 'output-topic'],
      rules: [
        {
          name: 'r1',
          jsonPath: '$.status',
          promptTemplate: 'Process',
          agentId: 'a1',
          timeoutMs: 120_000,
          concurrency: 1,
        },
      ],
    };

    expect(config.topics).toHaveLength(2);
    expect(config.rules).toHaveLength(1);
  });
});