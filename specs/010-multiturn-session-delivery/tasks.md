# Tasks: Multi-Turn Session Delivery

**Input**: Design documents from `/specs/010-multiturn-session-delivery/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅

**Tests**: This feature is additive; tests mandatory per Constitution V.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US6 (multi-turn resume), US7 (mixed multi-turn)
- All paths from repo root

---

## Phase 1: Schema (US6)

- [ ] T001 [P] Add `resumeFromPayloadField: z.string().nullish().transform(v => v === null || v === '' ? null : v).default('sessionId')` to `RuleV003Schema` in `src/schemas/index.ts`. Transform null/empty to actual null for downstream code.
- [ ] T002 [P] Add `resumed?: boolean` to `ResponseMessage` in `src/kafka/response-producer.ts` (FR-6). Add `resumeAttempted?: boolean` and `attemptedSessionId?: string` to `DlqEnvelope` in `src/kafka/dlq.ts`.

## Phase 2: Resume helpers (US6)

- [ ] T003 Create `src/session-resume.ts` with `extractSessionId(payload, rule)` — pure function. Returns `string | null`. Uses `jsonpath-plus` to extract from rule.resumeFromPayloadField. Returns null if field is missing, empty, or not a string. Logs warning for non-string values.
- [ ] T004 Add `verifySessionExists(client, sessionId)` to `src/session-resume.ts`. Returns `SessionLookupResult`. Calls `client.session.get({path: {id: sessionId}})`. Catches errors, returns `{ok: false, reason: 'lookup-error', details}` for non-404 errors and `{ok: false, reason: 'not-found'}` for 404/empty result.
- [ ] T005 Add `decideResume(client, existingSessionId, logger)` to `src/session-resume.ts`. Returns `ResumeDecision`. Combines T003 (extract) and T004 (verify). Logs `session_resume_attempted`, `session_resume_succeeded`, or `session_resume_failed reason=...`.

## Phase 3: Adapter resume branch (US6)

- [ ] T006 Modify `src/opencode/OpenCodeAgentAdapter.ts`: add `existingSessionId?: string` to `InvokeOptions`. In `invokeToolBased`, when `existingSessionId` provided, skip `session.create()`, register watcher with the provided ID, call `session.prompt({path: {id: existingSessionId}, body: {...}})`. Update JSDoc.
- [ ] T007 Modify `OpenCodeAgentAdapter.invoke()` to accept `existingSessionId` in options, call `decideResume()` first, dispatch to new `invokeResumedSession()` or fall through to existing `invokeToolBased()` / `invokePolling()`. `invokeResumedSession()` shares logic with `invokeToolBased()` but reuses existing sessionId.

## Phase 4: Consumer propagation (US6)

- [ ] T008 Modify `src/kafka/consumer.ts`: `eachMessageHandler()` calls `extractSessionId(payload, rule)` after matchRuleV003, passes `existingSessionId` to `agent.invoke(prompt, agentId, {timeoutMs, signal, existingSessionId})`. Emit `session_resumed` or `session_created` lifecycle event.
- [ ] T009 Modify `src/kafka/response-producer.ts`: `sendResponse()` accepts optional `resumed: boolean` flag, sets `resumed` field in envelope. `consumer.ts` passes `resumed` based on `ResumeDecision`.

## Phase 5: Tests (US6, US7)

- [ ] T010 [P] Create `tests/unit/session-resume.test.ts`. Tests: extractSessionId with various paths (`sessionId` top-level, `$.meta.session` nested, missing field → null, number → null+warning), verifySessionExists success/404/network-error, decideResume all three kinds.
- [ ] T011 [P] Modify `tests/unit/opencode/adapter.test.ts`: add 3 tests for resume branch — (a) verifySessionExists returns ok → adapter uses existing sessionId, skips session.create; (b) verifySessionExists returns not-found → adapter creates new; (c) verifySessionExists throws → adapter creates new.
- [ ] T012 [P] Modify `tests/unit/kafka/consumer.test.ts`: add 2 tests — payload with sessionId → adapter called with existingSessionId; payload without → adapter called without. Verify lifecycle event log.
- [ ] T013 [P] Modify `tests/unit/response-producer.test.ts`: add 1 test — `sendResponse()` with `resumed=true` produces envelope with `resumed: true`.

## Phase 6: Docs + live debug (US6, US7)

- [ ] T014 Add CHANGELOG 0.5.0 entry describing spec-010 multi-turn session delivery. Add ADR-010 to `docs/architecture/`. Live debug: produce msg1, observe sessionId in response, produce msg2 with that sessionId, observe continued session in OpenCode logs (same sessionID, history grew).

## Dependencies & Execution Order

```
Phase 1 (T001-T002): parallel
   ↓
Phase 2 (T003-T005): T003 first (pure), then T004 (uses client), then T005 (uses T003+T004)
   ↓
Phase 3 (T006-T007): T006 first (tool-based path), then T007 (dispatch)
   ↓
Phase 4 (T008-T009): T008 first (consumer), then T009 (producer — depends on T008)
   ↓
Phase 5 (T010-T013): parallel where marked
   ↓
Phase 6 (T014): sequential — final validation
```

## Story Independence

- **US6 (P1)**: Phases 1-5 + T014. MVP. Independent vertical slice.
- **US7 (P2)**: Validated by live debug interleaved messages (part of T014).

## Within Each Story

- Helper modules (Phase 2) → consumer propagation (Phase 4) → adapter (Phase 3) → tests (Phase 5)
- Tests run after the code they test exists (Constitution V: TDD)
- Phase 6 documentation after all tests green
