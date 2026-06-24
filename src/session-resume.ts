/**
 * Multi-turn session resume helpers (spec-010).
 *
 * Three pure-ish helpers that determine whether a Kafka message should
 * resume an existing OpenCode session or create a new one:
 *
 *   extractSessionId(payload, rule)      → string | null
 *   verifySessionExists(client, sessionId) → SessionLookupResult
 *   decideResume(client, sessionId)       → ResumeDecision
 *
 * Constitution Principle IV (No-State Consumer): these helpers perform
 * no module-level state mutation. Session lookup is always fresh from
 * OpenCode SDK.
 *
 * @see specs/010-multiturn-session-delivery/spec.md
 */

import { JSONPath } from 'jsonpath-plus';
import type { RuleV003 } from './schemas/index.js';

/**
 * Reason why a sessionId from payload could not be used for resume.
 *
 * - not-found: payload had a sessionId, but OpenCode says the
 *   session does not exist (404 or empty result)
 * - lookup-error: payload had a sessionId, but session.get() threw
 *   (network error, SDK error, etc.)
 * - invalid-id: payload had sessionId but it was not a string
 *   (number, object, array, etc.)
 * - rule-disabled: rule has resumeFromPayloadField=null, so we
 *   intentionally ignore the payload sessionId
 * - absent: payload had no sessionId at the configured JSONPath
 */
export type ResumeSkipReason =
  | 'not-found'
  | 'lookup-error'
  | 'invalid-id'
  | 'rule-disabled'
  | 'absent';

/**
 * Result of attempting to resume an existing OpenCode session.
 *
 * `new` — fall through to spec-009 behavior (create new session).
 * `resume-existing` — session exists, use it (skip session.create()).
 * `resume-fallback-new` — resume attempted but failed; log warning and
 *   create new session instead. `reason` explains the failure.
 */
export type ResumeDecision =
  | { kind: 'new'; reason: ResumeSkipReason }
  | { kind: 'resume-existing'; sessionId: string }
  | {
      kind: 'resume-fallback-new';
      attemptedSessionId: string;
      reason: Exclude<ResumeSkipReason, 'absent' | 'rule-disabled'>;
      details?: string;
    };

/**
 * Result of session.get() lookup.
 */
export type SessionLookupResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      reason: 'not-found' | 'lookup-error';
      details?: string;
    };

/**
 * Extract sessionId from Kafka payload using rule's
 * resumeFromPayloadField JSONPath.
 *
 * Returns:
 * - non-empty string when payload has a usable sessionId
 * - null when rule has resumeFromPayloadField=null (resume disabled)
 * - null when payload has no value at the JSONPath (resume skipped)
 * - null + console.warn when value exists but is not a non-empty string
 *   (e.g., number, null, object, empty string)
 *
 * @param payload - Parsed JSON payload from Kafka message
 * @param rule - Matched rule with optional resumeFromPayloadField
 * @returns sessionId string or null
 */
export function extractSessionId(
  payload: unknown,
  rule: Pick<RuleV003, 'resumeFromPayloadField'>
): string | null {
  // Rule-level opt-out
  if (rule.resumeFromPayloadField === null || rule.resumeFromPayloadField === undefined) {
    return null;
  }

  // Defensive: payload must be object for JSONPath to make sense
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const path = rule.resumeFromPayloadField;

  let values: unknown[];
  try {
    values = JSONPath({ path, json: payload as object });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'session_id_extraction_failed',
        jsonPath: path,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }

  if (!values || values.length === 0) {
    // Field absent — silent (not a warning, just absent)
    return null;
  }

  const value = values[0];

  if (typeof value !== 'string') {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'session_id_not_string',
        jsonPath: path,
        valueType: value === null ? 'null' : typeof value,
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }

  if (value.trim() === '') {
    // Empty string — treat as absent
    return null;
  }

  return value;
}

/**
 * Verify that a session exists in OpenCode via SDK session.get().
 *
 * Returns:
 * - {ok: true, sessionId} — session exists, resume is safe
 * - {ok: false, reason: 'not-found'} — session doesn't exist (404 / null result)
 * - {ok: false, reason: 'lookup-error', details} — SDK error (network, etc.)
 */
export async function verifySessionExists(
  client: { session: { get: (opts: { path: { id: string } }) => Promise<{ data?: unknown } | null> } },
  sessionId: string
): Promise<SessionLookupResult> {
  try {
    const result = await client.session.get({ path: { id: sessionId } });
    // OpenCode SDK returns {data: SessionInfo} on success, null/empty on miss
    if (result === null || result === undefined) {
      return { ok: false, reason: 'not-found' };
    }
    if (!result.data) {
      return { ok: false, reason: 'not-found' };
    }
    return { ok: true, sessionId };
  } catch (err) {
    return {
      ok: false,
      reason: 'lookup-error',
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Decide whether to resume an existing session or create a new one.
 *
 * Combines extractSessionId + verifySessionExists. Logs structured
 * events for observability (FR-3, NFR-3).
 */
export async function decideResume(
  client: {
    session: { get: (opts: { path: { id: string } }) => Promise<{ data?: unknown } | null> };
  },
  existingSessionId: string | null,
  rule: Pick<RuleV003, 'resumeFromPayloadField'>
): Promise<ResumeDecision> {
  // Step 1: extract from payload
  const sessionId = existingSessionId ?? extractSessionId(null, rule);
  // Note: caller may pre-extract sessionId from payload. If null passed here,
  // we don't re-extract. This signature supports both call patterns.

  if (sessionId === null) {
    // Either no sessionId in payload, or rule disabled, or value invalid
    const reason: ResumeSkipReason = rule.resumeFromPayloadField === null
      ? 'rule-disabled'
      : 'absent';
    return { kind: 'new', reason };
  }

  // Step 2: verify it exists in OpenCode
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'session_resume_attempted',
      sessionId,
      timestamp: new Date().toISOString(),
    })
  );

  const lookup = await verifySessionExists(client, sessionId);

  if (lookup.ok) {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'session_resume_succeeded',
        sessionId,
        timestamp: new Date().toISOString(),
      })
    );
    return { kind: 'resume-existing', sessionId };
  }

  // Step 3: fallback to new session on lookup failure
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'session_resume_failed',
      sessionId,
      reason: lookup.reason,
      details: lookup.details,
      fallback: 'new_session',
      timestamp: new Date().toISOString(),
    })
  );
  return {
    kind: 'resume-fallback-new',
    attemptedSessionId: sessionId,
    reason: lookup.reason,
    details: lookup.details,
  };
}

// Re-export for convenience
export type { RuleV003 };
