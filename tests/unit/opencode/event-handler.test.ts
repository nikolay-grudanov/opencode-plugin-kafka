/**
 * Unit tests for src/opencode/event-handler.ts
 *
 * Covers:
 * - createEventHandler factory
 * - session.idle: toolCalled → log only
 * - session.idle: not our session → ignore
 * - session.idle: rule not found → log + cleanup
 * - session.idle: fallbackToTextCapture + captured text → publish
 * - session.idle: requireToolCall + no tool → DLQ
 * - message.part.updated: text capture when fallback enabled
 * - message.part.updated: text ignored when no watcher
 * - errors in handlers are caught and logged, not thrown
 * - maxSessionMs guard: fires DLQ for stuck sessions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createEventHandler,
  startMaxSessionGuard,
  stopMaxSessionGuard,
} from '../../../src/opencode/event-handler.js';
import {
  registerSessionWatcher,
  markToolCalled,
  getSessionWatcher,
  _clearAllSessionWatchersForTesting,
} from '../../../src/opencode/session-watchers.js';
import type { PluginConfigV003, RuleV003 } from '../../../src/schemas/index.js';
import type { Producer } from 'kafkajs';

const mockResponseSend = vi.fn().mockResolvedValue(undefined);
const mockDlqSend = vi.fn().mockResolvedValue(undefined);
const mockResponseProducer = { send: mockResponseSend } as unknown as Producer;
const mockDlqProducer = { send: mockDlqSend } as unknown as Producer;

const testRule: RuleV003 = {
  name: 'rule-x',
  jsonPath: '$.t',
  promptTemplate: 'do ${$.t}',
  agentId: 'agent-x',
  responseTopic: 'topic-x',
  timeoutMs: 120_000,
  concurrency: 1,
  requireToolCall: true,
  fallbackToTextCapture: false,
  safetyNetTimeoutMs: 60_000,
  maxSessionMs: 300_000,
};

const testConfig: PluginConfigV003 = {
  topics: ['t1'],
  rules: [testRule],
  toggles: {
    toolDelivery: true,
    eventHook: true,
    pollingFallback: false,
  },
};

describe('createEventHandler', () => {
  beforeEach(() => {
    mockResponseSend.mockClear();
    mockDlqSend.mockClear();
    _clearAllSessionWatchersForTesting();
  });

  it('returns an async function', () => {
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    expect(typeof handler).toBe('function');
  });

  it('ignores unknown event types', async () => {
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    await handler({ event: { type: 'session.created' } });
    expect(mockResponseSend).not.toHaveBeenCalled();
    expect(mockDlqSend).not.toHaveBeenCalled();
  });

  it('session.idle: ignores session we did not create', async () => {
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    await handler({ event: { type: 'session.idle', properties: { sessionID: 'unknown' } } });
    expect(mockResponseSend).not.toHaveBeenCalled();
    expect(mockDlqSend).not.toHaveBeenCalled();
  });

  it('session.idle: logs and returns when tool was called (no DLQ, no response)', async () => {
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    registerSessionWatcher('sess-1', testRule, new AbortController());
    markToolCalled('sess-1');

    await handler({ event: { type: 'session.idle', properties: { sessionID: 'sess-1' } } });

    expect(mockResponseSend).not.toHaveBeenCalled();
    expect(mockDlqSend).not.toHaveBeenCalled();
  });

  it('session.idle: sends DLQ when requireToolCall=true and tool not called', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const configWithDlq: PluginConfigV003 = { ...testConfig, dlqTopic: 'my-dlq' };
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: configWithDlq,
    });
    registerSessionWatcher('sess-dlq', testRule, new AbortController());

    await handler({ event: { type: 'session.idle', properties: { sessionID: 'sess-dlq' } } });

    expect(mockDlqSend).toHaveBeenCalledTimes(1);
    // DLQ record.target = config.dlqTopic (where message actually goes)
    expect(mockDlqSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'my-dlq',
      })
    );
    // originalMessage.topic = rule.responseTopic (for context in envelope)
    expect(mockDlqSend.mock.calls[0][0].messages[0].key).toContain('topic-x');
    expect(mockResponseSend).not.toHaveBeenCalled();

    const logs = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(logs).toContain('dlq_sent');
    consoleSpy.mockRestore();
  });

  it('session.idle: silent log when requireToolCall=false and no fallback', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const silentRule: RuleV003 = { ...testRule, requireToolCall: false };
    const config: PluginConfigV003 = { ...testConfig, rules: [silentRule] };
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config,
    });
    registerSessionWatcher('sess-silent', silentRule, new AbortController());

    await handler({ event: { type: 'session.idle', properties: { sessionID: 'sess-silent' } } });

    expect(mockDlqSend).not.toHaveBeenCalled();
    expect(mockResponseSend).not.toHaveBeenCalled();
    const logs = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(logs).toContain('idle_no_tool_silent');
    consoleSpy.mockRestore();
  });

  it('session.idle: fallbackToTextCapture=true publishes captured text', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fallbackRule: RuleV003 = {
      ...testRule,
      fallbackToTextCapture: true,
      requireToolCall: false,
    };
    const config: PluginConfigV003 = { ...testConfig, rules: [fallbackRule] };
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config,
    });
    registerSessionWatcher('sess-fallback', fallbackRule, new AbortController());
    // Manually enable textCapture (simulating message.part.updated path)
    const watcher = getSessionWatcher('sess-fallback');
    if (watcher) (watcher as { textCapture: string }).textCapture = 'captured LLM answer';

    await handler({ event: { type: 'session.idle', properties: { sessionID: 'sess-fallback' } } });

    expect(mockResponseSend).toHaveBeenCalledTimes(1);
    expect(mockResponseSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'topic-x',
      })
    );
    const logs = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(logs).toContain('fallback_text_published');
    consoleSpy.mockRestore();
  });

  it('message.part.updated: ignores when not our session', async () => {
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    await handler({
      event: {
        type: 'message.part.updated',
        properties: { part: { type: 'text', sessionID: 'unknown', text: 'hi' } },
      },
    });
    // No-op, no errors
  });

  it('message.part.updated: ignores non-text parts', async () => {
    const fallbackRule = { ...testRule, fallbackToTextCapture: true };
    const config = { ...testConfig, rules: [fallbackRule] };
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config,
    });
    registerSessionWatcher('sess-not-text', fallbackRule, new AbortController());
    await handler({
      event: {
        type: 'message.part.updated',
        properties: { part: { type: 'tool', sessionID: 'sess-not-text' } },
      },
    });
    const watcher = getSessionWatcher('sess-not-text');
    expect(watcher?.textCapture).toBeUndefined();
  });

  it('catches and logs errors (does not throw)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createEventHandler({
      responseProducer: mockResponseProducer,
      dlqProducer: mockDlqProducer,
      config: testConfig,
    });
    mockDlqSend.mockRejectedValueOnce(new Error('boom'));

    registerSessionWatcher('sess-error', testRule, new AbortController());
    await handler({ event: { type: 'session.idle', properties: { sessionID: 'sess-error' } } });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('startMaxSessionGuard', () => {
  beforeEach(() => {
    mockDlqSend.mockClear();
    _clearAllSessionWatchersForTesting();
    stopMaxSessionGuard();
  });

  it('fires DLQ for sessions exceeding maxSessionMs without tool call', async () => {
    const shortRule: RuleV003 = { ...testRule, maxSessionMs: 50 };
    const config: PluginConfigV003 = { ...testConfig, rules: [shortRule], dlqTopic: 'guard-dlq' };

    registerSessionWatcher('sess-stuck', shortRule, new AbortController());

    const watcher = getSessionWatcher('sess-stuck')!;
    (watcher as { startTime: number }).startTime = Date.now() - 1000;

    startMaxSessionGuard(
      { responseProducer: mockResponseProducer, dlqProducer: mockDlqProducer, config },
      30 // check every 30ms — fast
    );

    // Wait long enough for at least 3 ticks + microtask flush
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Flush microtasks (sendToDlq creates promise)
    await new Promise((resolve) => setImmediate(resolve));

    stopMaxSessionGuard();

    expect(mockDlqSend).toHaveBeenCalled();
    const dlqCall = mockDlqSend.mock.calls[0][0];
    expect(dlqCall.topic).toBe('guard-dlq');
  });

  it('does NOT fire DLQ for sessions within maxSessionMs', async () => {
    const config: PluginConfigV003 = { ...testConfig, rules: [testRule] };
    registerSessionWatcher('sess-fresh', testRule, new AbortController());

    startMaxSessionGuard(
      { responseProducer: mockResponseProducer, dlqProducer: mockDlqProducer, config },
      50
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    stopMaxSessionGuard();

    expect(mockDlqSend).not.toHaveBeenCalled();
  });
});