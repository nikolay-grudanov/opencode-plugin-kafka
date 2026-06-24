/**
 * Unit tests for src/opencode/tool-handler.ts
 *
 * Covers:
 * - sanitizeRuleName: rule name sanitization
 * - makeToolName: tool name generation
 * - sendToKafkaToolArgsSchema: Zod schema validation
 * - createSendToKafkaTool: tool handler execution paths
 * - buildAllTools: multi-rule aggregation
 *
 * @see specs/009-tool-based-response-delivery/tasks.md T015
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeRuleName,
  makeToolName,
  sendToKafkaToolArgsSchema,
  createSendToKafkaTool,
  buildAllTools,
} from '../../../src/opencode/tool-handler.js';
import { _clearAllSessionWatchersForTesting } from '../../../src/opencode/session-watchers.js';
import type { Producer } from 'kafkajs';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockProducer = { send: mockSend } as unknown as Producer;

describe('sanitizeRuleName', () => {
  it('replaces dashes with underscores', () => {
    expect(sanitizeRuleName('default-prompt-rule')).toBe('default_prompt_rule');
  });

  it('replaces dots with underscores', () => {
    expect(sanitizeRuleName('rule.with.dots')).toBe('rule_with_dots');
  });

  it('replaces spaces with underscores', () => {
    expect(sanitizeRuleName('kafka v2')).toBe('kafka_v2');
  });

  it('preserves alphanumeric and underscore chars', () => {
    expect(sanitizeRuleName('Rule_123')).toBe('Rule_123');
  });

  it('handles empty string', () => {
    expect(sanitizeRuleName('')).toBe('');
  });
});

describe('makeToolName', () => {
  it('prefixes send_to_kafka_', () => {
    expect(makeToolName({ name: 'rule1' })).toBe('send_to_kafka_rule1');
  });

  it('sanitizes the rule name', () => {
    expect(makeToolName({ name: 'my-rule' })).toBe('send_to_kafka_my_rule');
  });
});

describe('sendToKafkaToolArgsSchema', () => {
  it('accepts valid args', () => {
    const result = sendToKafkaToolArgsSchema.safeParse({
      responseTopic: 'topic1',
      response: 'hello world',
      sessionId: 'sess-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts args without responseTopic (optional)', () => {
    const result = sendToKafkaToolArgsSchema.safeParse({
      response: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty response', () => {
    const result = sendToKafkaToolArgsSchema.safeParse({ response: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing response', () => {
    const result = sendToKafkaToolArgsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('createSendToKafkaTool', () => {
  beforeEach(() => {
    mockSend.mockClear();
    _clearAllSessionWatchersForTesting();
  });

  it('publishes to responseTopic when LLM provides it', async () => {
    const tool = createSendToKafkaTool(
      { name: 'rule-a', agentId: 'agent-x', responseTopic: 'default-topic' },
      { producer: mockProducer }
    );

    const result = await tool.execute(
      { responseTopic: 'override-topic', response: 'hello', sessionId: 'sess-1' },
      { sessionID: 'ctx-sess-1', messageID: 'msg-1', agent: 'agent-x', directory: '/', worktree: '/', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'override-topic',
        messages: expect.arrayContaining([
          expect.objectContaining({ value: expect.stringContaining('"response":"hello"') }),
        ]),
      })
    );
    expect(result.metadata).toMatchObject({ topic: 'override-topic' });
  });

  it('uses rule default responseTopic when LLM omits it', async () => {
    const tool = createSendToKafkaTool(
      { name: 'rule-b', agentId: 'agent-y', responseTopic: 'rule-default-topic' },
      { producer: mockProducer }
    );

    await tool.execute(
      { response: 'hello', sessionId: 'sess-2' },
      { sessionID: 'ctx-sess-2', messageID: 'msg-2', agent: 'agent-y', directory: '/', worktree: '/', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'rule-default-topic' })
    );
  });

  it('uses ctx.sessionID when LLM omits sessionId', async () => {
    const tool = createSendToKafkaTool(
      { name: 'rule-c', agentId: 'agent-z', responseTopic: 't' },
      { producer: mockProducer }
    );

    await tool.execute(
      { response: 'hello' },
      { sessionID: 'ctx-session-id', messageID: 'm', agent: 'a', directory: '/', worktree: '/', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ key: 'ctx-session-id' }),
        ]),
      })
    );
  });

  it('returns error when no responseTopic available', async () => {
    const tool = createSendToKafkaTool(
      // responseTopic undefined — fallback scenario
      { name: 'rule-no-rt', agentId: 'agent', responseTopic: undefined as unknown as string },
      { producer: mockProducer }
    );

    const result = await tool.execute(
      { response: 'hello' },
      { sessionID: 's1', messageID: 'm', agent: 'a', directory: '/', worktree: '/', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} }
    );

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({ error: true });
    expect((result as { output: string }).output).toContain('error');
  });
});

describe('buildAllTools', () => {
  beforeEach(() => {
    _clearAllSessionWatchersForTesting();
  });

  it('creates one tool per rule with responseTopic', () => {
    const tools = buildAllTools(
      [
        { name: 'rule-a', agentId: 'a', responseTopic: 't-a' },
        { name: 'rule-b', agentId: 'b', responseTopic: 't-b' },
        { name: 'rule-c', agentId: 'c', responseTopic: undefined },
      ],
      { producer: mockProducer }
    );

    expect(Object.keys(tools).sort()).toEqual([
      'send_to_kafka_rule_a',
      'send_to_kafka_rule_b',
    ]);
  });

  it('returns empty object when no rules have responseTopic', () => {
    const tools = buildAllTools(
      [
        { name: 'rule-x', agentId: 'x', responseTopic: undefined },
        { name: 'rule-y', agentId: 'y', responseTopic: undefined },
      ],
      { producer: mockProducer }
    );

    expect(Object.keys(tools)).toEqual([]);
  });

  it('skips rule with name collision after sanitization', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = buildAllTools(
      [
        { name: 'rule-a', agentId: 'a', responseTopic: 't1' },
        // Different original names, same sanitized → collision
        { name: 'rule.a', agentId: 'b', responseTopic: 't2' },
      ],
      { producer: mockProducer }
    );

    expect(Object.keys(tools)).toEqual(['send_to_kafka_rule_a']);
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});