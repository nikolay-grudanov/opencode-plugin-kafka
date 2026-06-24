/**
 * Per-session ephemeral state for spec-009 tool-based response delivery.
 *
 * Tracks the lifecycle of each OpenCode session the plugin creates (one per
 * Kafka message). Lives in a module-level Map but the entries are bounded:
 * one entry per session, removed on session.idle or wall-clock timeout.
 *
 * Constitution Principle IV (No-State Consumer): this Map is *scoped ephemeral*
 * state, not cross-session state. Each entry's lifetime is bounded by
 * `maxSessionMs` (default 300s). After cleanup, no trace remains of the session.
 *
 * @see specs/009-tool-based-response-delivery/data-model.md §2 SessionWatcher
 * @see docs/architecture/ADR-009-tool-based-response-delivery.md
 */

import type { RuleV003 } from '../schemas/index.js';

export interface SessionWatcher {
  /** OpenCode session ID (ctx.sessionID from tool context). */
  sessionId: string;
  /** Matched rule name (used for DLQ envelopes and observability). */
  ruleName: string;
  /** Matched rule's agentId (informational; for DLQ envelope). */
  agentId: string;
  /** Rule's responseTopic (may be undefined for fire-and-forget rules). */
  responseTopic: string | undefined;
  /** Epoch ms when session was created. Used for maxSessionMs guard. */
  startTime: number;
  /** Becomes true when send_to_kafka_<rule> tool fires for this session. */
  toolCalled: boolean;
  /** Last captured assistant text (only populated if fallbackToTextCapture). */
  textCapture: string | undefined;
  /** AbortController for cleanup on shutdown. */
  abortController: AbortController;
}

/**
 * Module-level Map of active sessions. Bounded by Kafka partition concurrency.
 *
 * NOT exported — all access goes through the typed helpers below, which
 * enforce the contract (cleanup on idle, bounded lifetime).
 */
const watchers = new Map<string, SessionWatcher>();

/**
 * Register a new session watcher. Idempotent: if a watcher already exists
 * for the sessionId (which would be a bug — same sessionID reused), the
 * existing one is overwritten and a console.warn is logged.
 */
export function registerSessionWatcher(
  sessionId: string,
  matchedRule: Pick<RuleV003, 'name' | 'agentId' | 'responseTopic'>,
  abortController: AbortController
): SessionWatcher {
  if (watchers.has(sessionId)) {
    // Should never happen — OpenCode session IDs are unique. Log and overwrite.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'session_watcher_already_exists',
        sessionId,
        timestamp: new Date().toISOString(),
      })
    );
  }

  const watcher: SessionWatcher = {
    sessionId,
    ruleName: matchedRule.name,
    agentId: matchedRule.agentId,
    responseTopic: matchedRule.responseTopic,
    startTime: Date.now(),
    toolCalled: false,
    textCapture: undefined,
    abortController,
  };

  watchers.set(sessionId, watcher);
  return watcher;
}

/**
 * Get the watcher for a sessionId. Returns undefined if no such session exists
 * (e.g., the session was created by another plugin or by user TUI directly).
 */
export function getSessionWatcher(sessionId: string): SessionWatcher | undefined {
  return watchers.get(sessionId);
}

/**
 * Mark that the send_to_kafka tool was called for this session. Called from
 * the tool-handler when execute() fires.
 */
export function markToolCalled(sessionId: string): void {
  const watcher = watchers.get(sessionId);
  if (watcher) {
    watcher.toolCalled = true;
  }
}

/**
 * Capture the latest assistant text part for fallback mode. Called from the
 * event handler when message.part.updated fires with type=text.
 */
export function captureText(sessionId: string, text: string): void {
  const watcher = watchers.get(sessionId);
  if (watcher && watcher.textCapture !== undefined) {
    watcher.textCapture = text;
  }
}

/**
 * Remove the watcher and abort any in-flight work. Called on session.idle or
 * wall-clock timeout.
 */
export function cleanupSessionWatcher(sessionId: string): SessionWatcher | undefined {
  const watcher = watchers.get(sessionId);
  if (!watcher) return undefined;

  watchers.delete(sessionId);
  try {
    watcher.abortController.abort();
  } catch {
    // Best-effort cleanup; ignore errors
  }
  return watcher;
}

/**
 * Iterate all active watchers. Used by the wall-clock timeout guard to find
 * sessions that exceeded maxSessionMs without firing session.idle.
 */
export function getAllSessionWatchers(): IterableIterator<SessionWatcher> {
  return watchers.values();
}

/**
 * Test-only: clear all watchers. Used in unit tests for isolation.
 * Not exported from index.ts to prevent production misuse.
 */
export function _clearAllSessionWatchersForTesting(): void {
  watchers.clear();
}