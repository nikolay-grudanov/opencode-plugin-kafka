# Plan: Multi-Turn Session Delivery (spec-010)

**Branch**: `feature/spec-010-multiturn-session` | **Date**: 2026-06-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification for spec-010 (multi-turn session via payload sessionId)

## Summary

Extend spec-009 tool-based delivery to support **multi-turn sessions**:
when the Kafka payload contains a `sessionId`, the plugin resumes
that OpenCode session instead of creating a new one. This enables
stateful chat-from-Kafka workflows where follow-up messages preserve
LLM context.

The change is architecturally small because OpenCode already handles
message history and tool invocation within a session — we just need
to (a) extract sessionId from payload, (b) verify session exists via
SDK, (c) pass existing sessionId to `session.prompt()` instead of a
fresh one, (d) include `resumed` flag in response envelope.

## Technical Context

**Language/Version**: TypeScript 6.x, ES2022 target, ESNext modules
**Primary Dependencies**: `kafkajs@^2.2.4`, `zod@^3.23.8`, `@opencode-ai/plugin@^1.16.0`, **`@opencode-ai/sdk@^1.16.0`** (already in deps), `jsonpath-plus@^10.4.0`
**Storage**: N/A (Kafka topics are external storage)
**Testing**: `vitest@^2.0.0`, real Kafka via podman-compose for e2e
**Target Platform**: Linux server (Node.js 20+) running as OpenCode plugin
**Project Type**: OpenCode plugin
**Performance Goals**: <5ms added latency per message (single in-process SDK call)
**Constraints**: No module-level state for sessions (Constitution IV); back-compat with spec-009 payloads
**Scale/Scope**: Bounded by Kafka partition concurrency (1-10 per rule)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Compliance | Notes |
|---|---|---|
| I. Strict Initialization | ✅ Preserved | New `resumeFromPayloadField` field has safe default |
| II. Domain Isolation | ✅ Preserved | Resume logic isolated in `session-resume.ts` helper |
| III. Resiliency | ✅ Strengthened | Failed resume → graceful fallback to new session + warning |
| IV. No-State Consumer | ✅ Preserved | Session lookup via OpenCode SDK, not local cache |
| V. Test-First Development | ✅ Preserved | Phase 5 mandatory unit tests for resume paths |

**Verdict**: No violations. Spec-010 strengthens Principle III (Resiliency)
by adding graceful fallback when resume fails.

## Project Structure

### Documentation

```
specs/010-multiturn-session-delivery/
├── spec.md              # this spec
├── plan.md              # this file
├── data-model.md        # ResumeDecision, SessionLookupResult, lifecycle events
├── tasks.md             # 14 tasks across 6 phases
├── contracts/
│   └── session-resume.md  # OpenCode SDK calls + Zod schemas
└── checklists/
    └── requirements-quality.md
```

### Source code (new + modified)

```
src/
├── session-resume.ts            # NEW: extractSessionId() + verifySessionExists()
├── opencode/
│   ├── OpenCodeAgentAdapter.ts  # MODIFIED: invoke() accepts existingSessionId
│   └── session-watchers.ts      # unchanged (still per-session ephemeral Map)
├── kafka/
│   └── consumer.ts               # MODIFIED: eachMessageHandler extracts+passes sessionId
├── response-producer.ts          # MODIFIED: ResponseMessage adds resumed flag
└── dlq.ts                        # MODIFIED: DlqEnvelope adds resumeAttempted

docs/architecture/
└── ADR-010-multiturn-session.md  # NEW: explains why/how resume works
```

### Tests

```
tests/unit/
├── session-resume.test.ts        # NEW: extract+verify logic
├── opencode/
│   └── adapter.test.ts           # MODIFIED: add resume branch tests
├── kafka/
│   └── consumer.test.ts          # MODIFIED: sessionId propagation
└── response-producer.test.ts     # MODIFIED: resumed flag
```

## Phases

**Phase 0 (research) — not needed**: spec-009 already established that
OpenCode SDK `session.prompt({path: {id: existingSessionId}})` works
for any session ID (used internally by OpenCode's own features).

**Phase 1 (Schema)**: add `resumeFromPayloadField` to `RuleV003Schema`,
add `resumed` to `ResponseMessage`, add `resumeAttempted` to `DlqEnvelope`.

**Phase 2 (Adapter)**: add `session-resume.ts` with `extractSessionId()`
+ `verifySessionExists()`. Modify `OpenCodeAgentAdapter.invoke()` to
accept `existingSessionId` in `InvokeOptions`, call verifySessionExists,
and either resume or create new.

**Phase 3 (Consumer)**: `eachMessageHandler` extracts sessionId from
payload using rule's `resumeFromPayloadField` JSONPath, passes it to
adapter.invoke(). Emit `session_resumed` lifecycle phase.

**Phase 4 (Response/DLQ)**: `ResponseMessage` includes `resumed` flag.
`DlqEnvelope` includes `resumeAttempted`. `sendResponse()` signature
updated.

**Phase 5 (Tests)**: unit tests for `session-resume.ts` (extract edge
cases, verify success/error paths), modified adapter tests for resume
branch, modified consumer tests for sessionId propagation, modified
response-producer tests for resumed flag.

**Phase 6 (Docs + live debug)**: CHANGELOG entry 0.5.0, ADR-010, e2e
test T-E2E-013 (multi-turn flow), live debug: produce msg1, observe
sessionId, produce msg2 with sessionId, observe continued session.

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| SessionId from payload is wrong format (e.g., `ses_xxx` vs UUID) | Low | Low | Zod validates; OpenCode returns 404; fall back to new |
| Session was deleted between `get()` and `prompt()` | Low | Low | prompt() returns error → DLQ envelope with resumeAttempted=true |
| Concurrent messages with same sessionId | Medium | Medium | Rule.concurrency serializes; second message waits for first |
| Session grew unbounded (many turns) | Medium | Low | OpenCode has compaction; out of scope |
| LLM uses wrong tool for resumed session | Low | Low | tool name is per-rule (`send_to_kafka_<rule>`), LLM picks correct one |
| session.get() latency spike (>1s) | Low | Low | NFR-2: <5ms expected; documented acceptable threshold |
| Race between kafka message arrival and session watcher cleanup | Low | Low | session-watchers map is per-instance; OpenCode session itself persists |

## Validation Strategy

- **Per-task validation**: each task includes its own validation
  (typecheck, lint, unit test).
- **Per-phase checkpoint**: end of each phase — `npm run check`
  (lint + unit test) must be green.
- **Final validation**: live debug (Phase 6) produces msg1, observes
  sessionId in response, produces msg2 with that sessionId, verifies
  OpenCode log shows same sessionID with history grown.
- **Acceptance**: all 14 tasks complete, all unit tests pass, e2e
  test T-E2E-013 passes manually, CHANGELOG updated.

## Open Questions (deferred to /speckit.clarify if needed)

1. Should `resumeFromPayloadField` support nested JSONPath syntax
   beyond top-level? Currently accepts any JSONPath string, including
   `$.meta.session`, `$.user.id` etc. via `jsonpath-plus`.
2. Should we expose a `list_active_sessions` tool so the LLM can
   resume the right session? Out of scope per spec §Out of Scope.

## Success Metrics

- **Functional**: Multi-turn works (msg2 resumes msg1's session).
- **Performance**: <5ms added latency for session.get() lookup.
- **Reliability**: 100% of malformed sessionIds fall back gracefully
  to new session (no crashes).
- **Compatibility**: 0% regressions in spec-009 test suite.
