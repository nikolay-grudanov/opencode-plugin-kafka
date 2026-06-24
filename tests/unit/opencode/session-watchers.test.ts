/**
 * Unit tests for src/opencode/session-watchers.ts
 *
 * Covers:
 * - registerSessionWatcher: Map insertion, overwrite warning
 * - getSessionWatcher: lookup
 * - markToolCalled: state mutation
 * - captureText: fallback text capture
 * - cleanupSessionWatcher: removal + abort
 * - getAllSessionWatchers: iteration
 *
 * @see specs/009-tool-based-response-delivery/tasks.md T017
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerSessionWatcher,
  getSessionWatcher,
  markToolCalled,
  captureText,
  cleanupSessionWatcher,
  getAllSessionWatchers,
  _clearAllSessionWatchersForTesting,
} from '../../../src/opencode/session-watchers.js';
import type { RuleV003 } from '../../../src/schemas/index.js';

const fakeRule: Pick<RuleV003, 'name' | 'agentId' | 'responseTopic'> = {
  name: 'test-rule',
  agentId: 'test-agent',
  responseTopic: 'test-topic',
};

function makeAbortController() {
  return new AbortController();
}

describe('session-watchers', () => {
  beforeEach(() => {
    _clearAllSessionWatchersForTesting();
  });

  describe('registerSessionWatcher', () => {
    it('creates a watcher with correct fields', () => {
      const abortController = makeAbortController();
      const watcher = registerSessionWatcher('sess-1', fakeRule, abortController);

      expect(watcher.sessionId).toBe('sess-1');
      expect(watcher.ruleName).toBe('test-rule');
      expect(watcher.agentId).toBe('test-agent');
      expect(watcher.responseTopic).toBe('test-topic');
      expect(watcher.toolCalled).toBe(false);
      expect(watcher.textCapture).toBeUndefined();
      expect(watcher.abortController).toBe(abortController);
      expect(watcher.startTime).toBeGreaterThan(0);
    });

    it('warns and overwrites when session already registered', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      registerSessionWatcher('sess-dup', fakeRule, makeAbortController());
      const second = registerSessionWatcher('sess-dup', fakeRule, makeAbortController());

      expect(second.sessionId).toBe('sess-dup');
      expect(consoleWarnSpy).toHaveBeenCalled();
      const logArg = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
      expect(logArg.event).toBe('session_watcher_already_exists');

      consoleWarnSpy.mockRestore();
    });

    it('initializes textCapture only when fallbackToTextCapture is true', () => {
      // We don't expose fallbackToTextCapture in the public Pick type
      // (it's a spec-009 rule field that's still in Phase 2). For now,
      // textCapture is always undefined initially.
      const watcher = registerSessionWatcher('sess-2', fakeRule, makeAbortController());
      expect(watcher.textCapture).toBeUndefined();
    });
  });

  describe('getSessionWatcher', () => {
    it('returns undefined for unknown sessionId', () => {
      expect(getSessionWatcher('unknown')).toBeUndefined();
    });

    it('returns the registered watcher', () => {
      const watcher = registerSessionWatcher('sess-3', fakeRule, makeAbortController());
      expect(getSessionWatcher('sess-3')).toBe(watcher);
    });
  });

  describe('markToolCalled', () => {
    it('flips toolCalled to true', () => {
      registerSessionWatcher('sess-4', fakeRule, makeAbortController());
      expect(getSessionWatcher('sess-4')?.toolCalled).toBe(false);

      markToolCalled('sess-4');
      expect(getSessionWatcher('sess-4')?.toolCalled).toBe(true);
    });

    it('does nothing for unknown sessionId', () => {
      // Should not throw
      markToolCalled('unknown-session');
    });
  });

  describe('captureText', () => {
    it('does nothing when textCapture is undefined (fallback disabled)', () => {
      registerSessionWatcher('sess-5', fakeRule, makeAbortController());
      captureText('sess-5', 'hello');
      // textCapture remains undefined since fallback was not enabled
      expect(getSessionWatcher('sess-5')?.textCapture).toBeUndefined();
    });

    it('captures text when fallback is enabled (textCapture = "")', () => {
      // Manually construct watcher with fallback enabled (spec-009 path)
      // by directly registering with textCapture=''
      registerSessionWatcher('sess-6', fakeRule, makeAbortController());
      // Force textCapture to be set (simulating fallback mode)
      const watcher = getSessionWatcher('sess-6')!;
      (watcher as { textCapture?: string }).textCapture = '';

      captureText('sess-6', 'hello world');
      expect(getSessionWatcher('sess-6')?.textCapture).toBe('hello world');
    });
  });

  describe('cleanupSessionWatcher', () => {
    it('removes the watcher from Map', () => {
      registerSessionWatcher('sess-7', fakeRule, makeAbortController());
      expect(getSessionWatcher('sess-7')).toBeDefined();

      cleanupSessionWatcher('sess-7');
      expect(getSessionWatcher('sess-7')).toBeUndefined();
    });

    it('calls abort on the AbortController', () => {
      const ac = makeAbortController();
      const abortSpy = vi.spyOn(ac, 'abort');
      registerSessionWatcher('sess-8', fakeRule, ac);

      cleanupSessionWatcher('sess-8');
      expect(abortSpy).toHaveBeenCalled();
    });

    it('returns undefined for unknown sessionId', () => {
      expect(cleanupSessionWatcher('unknown')).toBeUndefined();
    });

    it('does not throw if abort throws', () => {
      const ac = { abort: () => { throw new Error('boom'); } } as unknown as AbortController;
      registerSessionWatcher('sess-9', fakeRule, ac);
      // Should not throw
      cleanupSessionWatcher('sess-9');
      expect(getSessionWatcher('sess-9')).toBeUndefined();
    });
  });

  describe('getAllSessionWatchers', () => {
    it('returns all registered watchers', () => {
      registerSessionWatcher('sess-a', fakeRule, makeAbortController());
      registerSessionWatcher('sess-b', fakeRule, makeAbortController());
      registerSessionWatcher('sess-c', fakeRule, makeAbortController());

      const all = Array.from(getAllSessionWatchers());
      expect(all).toHaveLength(3);
      const ids = all.map((w) => w.sessionId).sort();
      expect(ids).toEqual(['sess-a', 'sess-b', 'sess-c']);
    });

    it('returns empty iterator when no watchers registered', () => {
      const all = Array.from(getAllSessionWatchers());
      expect(all).toEqual([]);
    });
  });
});