/**
 * Unit tests for src/session-resume.ts (spec-010).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractSessionId,
  verifySessionExists,
  decideResume,
} from '../../src/session-resume.js';
import type { RuleV003 } from '../../src/schemas/index.js';

const baseRule: Pick<RuleV003, 'resumeFromPayloadField'> = {
  resumeFromPayloadField: 'sessionId',
};

describe('extractSessionId', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns sessionId string when present at top level', () => {
    expect(extractSessionId({ sessionId: 'ses_abc' }, baseRule)).toBe('ses_abc');
  });

  it('returns null when sessionId field absent', () => {
    expect(extractSessionId({ task: 'no session' }, baseRule)).toBeNull();
  });

  it('returns null when rule has resumeFromPayloadField=null', () => {
    const rule = { ...baseRule, resumeFromPayloadField: null };
    expect(extractSessionId({ sessionId: 'ses_abc' }, rule)).toBeNull();
  });

  it('returns null when value is empty string', () => {
    expect(extractSessionId({ sessionId: '' }, baseRule)).toBeNull();
  });

  it('returns null and warns when value is a number', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extractSessionId({ sessionId: 12345 }, baseRule)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const logArg = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logArg.event).toBe('session_id_not_string');
    expect(logArg.valueType).toBe('number');
  });

  it('returns null and warns when value is null', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extractSessionId({ sessionId: null }, baseRule)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const logArg = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logArg.valueType).toBe('null');
  });

  it('returns null when payload is not an object', () => {
    expect(extractSessionId(null, baseRule)).toBeNull();
    expect(extractSessionId('string-payload', baseRule)).toBeNull();
    expect(extractSessionId(42, baseRule)).toBeNull();
  });

  it('uses nested JSONPath when rule specifies it', () => {
    const rule = { ...baseRule, resumeFromPayloadField: '$.meta.session' };
    expect(
      extractSessionId({ meta: { session: 'ses_nested' } }, rule)
    ).toBe('ses_nested');
    expect(
      extractSessionId({ meta: { session: '' } }, rule)
    ).toBeNull();
    expect(
      extractSessionId({ sessionId: 'ses_top' }, rule)
    ).toBeNull(); // not at $.meta.session, so null
  });
});

describe('verifySessionExists', () => {
  const mockClient = (data: unknown | null, throwErr?: Error) => ({
    session: {
      get: vi.fn().mockImplementation(() => {
        if (throwErr) throw throwErr;
        return Promise.resolve(data);
      }),
    },
  });

  it('returns ok=true when session.get returns data', async () => {
    const client = mockClient({ data: { id: 'ses_xxx' } });
    const result = await verifySessionExists(client as never, 'ses_xxx');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionId).toBe('ses_xxx');
  });

  it('returns ok=false (not-found) when result is null', async () => {
    const client = mockClient(null);
    const result = await verifySessionExists(client as never, 'ses_missing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('returns ok=false (not-found) when result.data is missing', async () => {
    const client = mockClient({});
    const result = await verifySessionExists(client as never, 'ses_empty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('returns ok=false (lookup-error) when session.get throws', async () => {
    const client = mockClient(null, new Error('connection refused'));
    const result = await verifySessionExists(client as never, 'ses_xxx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('lookup-error');
      expect(result.details).toBe('connection refused');
    }
  });
});

describe('decideResume', () => {
  const mockClient = (data: unknown | null) => ({
    session: { get: vi.fn().mockResolvedValue(data) },
  });

  it('returns kind="new" reason="absent" when sessionId is null', async () => {
    const client = mockClient(null);
    const result = await decideResume(client as never, null, baseRule);
    expect(result.kind).toBe('new');
    if (result.kind === 'new') expect(result.reason).toBe('absent');
  });

  it('returns kind="new" reason="rule-disabled" when rule disables', async () => {
    const client = mockClient(null);
    const rule = { ...baseRule, resumeFromPayloadField: null };
    const result = await decideResume(client as never, null, rule);
    expect(result.kind).toBe('new');
    if (result.kind === 'new') expect(result.reason).toBe('rule-disabled');
  });

  it('returns kind="resume-existing" when session.get finds session', async () => {
    const client = mockClient({ data: { id: 'ses_xxx' } });
    const result = await decideResume(client as never, 'ses_xxx', baseRule);
    expect(result.kind).toBe('resume-existing');
    if (result.kind === 'resume-existing') expect(result.sessionId).toBe('ses_xxx');
  });

  it('returns kind="resume-fallback-new" when session.get returns null', async () => {
    const client = mockClient(null);
    const result = await decideResume(client as never, 'ses_missing', baseRule);
    expect(result.kind).toBe('resume-fallback-new');
    if (result.kind === 'resume-fallback-new') {
      expect(result.attemptedSessionId).toBe('ses_missing');
      expect(result.reason).toBe('not-found');
    }
  });

  it('returns kind="resume-fallback-new" when session.get throws', async () => {
    const client = {
      session: { get: vi.fn().mockRejectedValue(new Error('net err')) },
    };
    const result = await decideResume(client as never, 'ses_xxx', baseRule);
    expect(result.kind).toBe('resume-fallback-new');
    if (result.kind === 'resume-fallback-new') {
      expect(result.attemptedSessionId).toBe('ses_xxx');
      expect(result.reason).toBe('lookup-error');
      expect(result.details).toBe('net err');
    }
  });
});
