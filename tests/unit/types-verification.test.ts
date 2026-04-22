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
    };

    expect(rule.condition).toBeUndefined();
    expect(rule.command).toBeUndefined();
    // Note: prompt_field default '$' is applied at PARSE time, not at object creation
    // When creating objects directly, prompt_field is undefined unless explicitly set
    expect(rule.prompt_field).toBeUndefined();
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
        { name: 'r1', topic: 'security', agent: 'a1' },
        { name: 'r2', topic: 'audit', agent: 'a2' },
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