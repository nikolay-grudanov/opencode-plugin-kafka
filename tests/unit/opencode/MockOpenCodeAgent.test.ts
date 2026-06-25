/**
 * Unit tests for src/opencode/MockOpenCodeAgent.ts
 *
 * Covers:
 * - MockOpenCodeAgent construction with config map
 * - invoke: success path
 * - invoke: shouldError path
 * - invoke: timeout path (delayMs > timeoutMs)
 * - invoke: signal.aborted before and during
 * - invoke: no config for agentId
 * - abort: removes from active sessions
 * - getActiveSessionCount
 */

import { describe, it, expect } from 'vitest';
import { MockOpenCodeAgent } from '../../../src/opencode/MockOpenCodeAgent.js';

describe('MockOpenCodeAgent', () => {
  describe('invoke', () => {
    it('returns success with predefined response', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'test-agent', response: 'Mock response text' },
      ]);

      const result = await agent.invoke('prompt', 'test-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('success');
      expect(result.response).toBe('Mock response text');
      expect(result.sessionId).toBeDefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('uses default response if not specified', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'default-agent' },
      ]);

      const result = await agent.invoke('prompt', 'default-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('success');
      expect(result.response).toBe('Mock response for default-agent');
    });

    it('returns error when shouldError=true', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'error-agent', shouldError: true, errorMessage: 'Custom error' },
      ]);

      const result = await agent.invoke('prompt', 'error-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBe('Custom error');
    });

    it('returns timeout when delayMs > timeoutMs', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'slow-agent', delayMs: 1000 },
      ]);

      const result = await agent.invoke('prompt', 'slow-agent', { timeoutMs: 500 });

      expect(result.status).toBe('timeout');
      expect(result.errorMessage).toContain('timed out');
    });

    it('returns error for unknown agentId', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'known-agent' },
      ]);

      const result = await agent.invoke('prompt', 'unknown-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('error');
      expect(result.errorMessage).toContain('No mock config');
    });

    it('checks signal.aborted before execution', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'abort-test' },
      ]);

      const abortedSignal = { aborted: true } as AbortSignal;
      const result = await agent.invoke('prompt', 'abort-test', {
        timeoutMs: 5000,
        signal: abortedSignal,
      });

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBe('Operation was aborted');
    });

    it('performs delay and checks abort after', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'delay-agent', delayMs: 50 },
      ]);

      const result = await agent.invoke('prompt', 'delay-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('success');
    });
  });

  describe('abort', () => {
    it('returns false for inactive session', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'test' },
      ]);

      const abortResult = await agent.abort('non-existent-session');

      expect(abortResult).toBe(false);
    });

    it('returns false after invoke completes (session removed in finally)', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'test' },
      ]);

      const result = await agent.invoke('prompt', 'test', { timeoutMs: 5000 });
      // Session is removed in finally block, so abort returns false
      const abortResult = await agent.abort(result.sessionId);

      expect(abortResult).toBe(false);
    });
  });

  describe('getActiveSessionCount', () => {
    it('returns 0 for new agent', () => {
      const agent = new MockOpenCodeAgent([]);

      expect(agent.getActiveSessionCount()).toBe(0);
    });

    it('returns 0 after invoke completes (sessions removed in finally)', async () => {
      const agent = new MockOpenCodeAgent([
        { agentId: 'agent-1' },
        { agentId: 'agent-2' },
      ]);

      await agent.invoke('prompt', 'agent-1', { timeoutMs: 5000 });
      await agent.invoke('prompt', 'agent-2', { timeoutMs: 5000 });

      // Sessions are removed in finally block after invoke completes
      expect(agent.getActiveSessionCount()).toBe(0);
    });
  });
});
