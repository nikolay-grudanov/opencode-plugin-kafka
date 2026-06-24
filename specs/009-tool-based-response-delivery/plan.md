# Plan: Tool-Based Response Delivery

**Branch**: `feature/spec-009-tool-based-response-delivery` | **Date**: 2026-06-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-tool-based-response-delivery/spec.md`

## Summary

Заменить polling-based response retrieval в `OpenCodeAgentAdapter` на event-driven подход через регистрацию custom tool в OpenCode SDK. Агент вызывает tool когда ответ готов → tool публикует в response topic. Параллельно event hook `session.idle` обеспечивает safety net для случая, когда LLM не вызвал tool. Также исправляем bug #3 (DLQ topic mismatch — `dlq.ts:106`).

## Technical Context

**Language/Version**: TypeScript 6.x, ES2022 target, ESNext modules
**Primary Dependencies**: `kafkajs@^2.2.4`, `zod@^3.23.8`, **`@opencode-ai/plugin@^1.16.2`** (NEW), `jsonpath-plus@^10.4.0`
**Storage**: N/A (Kafka topics are external storage)
**Testing**: `vitest@^2.0.0`, `@testcontainers/redpanda`, real OpenCode 1.17.9 CLI
**Target Platform**: Linux server (Node.js 20+) running as OpenCode plugin
**Project Type**: OpenCode plugin (loaded via `.opencode/plugins/`)
**Performance Goals**: Median end-to-end latency ≤ LLM streaming time + 1s (NFR-1); throughput ×N vs spec-008 (subject to LLM speed)
**Constraints**: No module-level state (Constitution IV); per-session state in closure ≤ `maxSessionMs`
**Scale/Scope**: 1 Kafka consumer group; multiple concurrent sessions bounded by rule `concurrency`

## Constitution Check

*GATE: Must pass before Phase 0. Re-check after Phase 1.*

| Principle | Compliance | Notes |
|---|---|---|
| I. Strict Initialization | ✅ Preserved | New schema fields have defaults; existing configs still pass Zod validation |
| II. Domain Isolation | ✅ Preserved | Routing (`matchRuleV003`) untouched; tool-handler is its own module |
| III. Resiliency | ✅ **Strengthened** | DLQ is now primary error path (was previously hidden by polling) |
| IV. No-State Consumer | ✅ Preserved | `SessionWatcher` is per-session closure-scoped, auto-cleanup on idle |
| V. Test-First Development | ✅ Preserved | Phase 6 mandatory; coverage ≥90% on new code |

**Verdict**: No violations. ADR-009 explicitly addresses the apparent tension with Principle IV (the SessionWatcher Map is ephemeral, not cross-session state).

## Project Structure

### Documentation (this feature)

```
specs/009-tool-based-response-delivery/
├── spec.md              # this spec
├── plan.md              # this file
├── data-model.md        # ToolDefinition, SessionWatcher, PerTestTopics schemas
├── tasks.md             # 31 tasks across 9 phases
├── contracts/           # (optional) OpenAPI/kafkajs protocol contracts
│   └── tool-schema.md
└── checklists/
    └── requirements-quality.md  # unit tests for English
```

### Source Code (real, will be added by tasks)

```
src/opencode/
├── tool-handler.ts           # NEW — createSendToKafkaTool()
├── event-handler.ts          # NEW — handleSessionEvent() with session.idle filter
├── session-watchers.ts       # NEW — Map<sessionId, SessionWatcher>
├── OpenCodeAgentAdapter.ts   # MODIFIED — remove pollForResponse()
└── ...

src/kafka/
├── dlq.ts                    # MODIFIED — accept dlqTopic as parameter (bug #3 fix)
├── consumer.ts               # MODIFIED — pass dlqTopic to sendToDlq
└── ...

src/
├── index.ts                  # MODIFIED — return Hooks = {tool, event, session.error}
└── schemas/index.ts          # MODIFIED — new fields in RuleV003Schema
```

### Tests (will be added by tasks)

```
tests/unit/opencode/
├── tool-handler.test.ts      # NEW — ≥90% coverage
├── event-handler.test.ts     # NEW
├── session-watchers.test.ts  # NEW
└── adapter.test.ts           # MODIFIED — remove polling mocks

tests/e2e/
├── consumer.e2e.test.ts      # REWRITTEN — per-test DLQ topics
└── helpers/
    └── perTestTopics.ts      # NEW — unique topic names per describe block
```

## Phases

Phase 0 (research) — **not needed**: ADR-009 already did the technical research (live debug session 2026-06-24, OpenCode SDK inspection). All technical unknowns resolved.

Phase 1 (Setup, foundation): add `@opencode-ai/plugin` dependency, create `session-watchers.ts` and `tool-handler.ts` modules.

Phase 2 (Schema): extend Zod schemas, fix DLQ topic parameter passing.

Phase 3 (Remove polling): refactor `OpenCodeAgentAdapter.invoke()` to thin shim.

Phase 4 (Event hook + safety net): subscribe to `session.idle` and `message.part.updated`.

Phase 5 (Per-test DLQ topics): test isolation helper.

Phase 6 (Unit tests): ≥90% coverage on new modules.

Phase 7 (E2E tests): real OpenCode + real Kafka integration.

Phase 8 (Polish): docs, CHANGELOG, README update.

Phase 9 (CI & validate): run full e2e suite, measure NFR-1 latency.

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| OpenCode SDK < 1.16 in production | Low | Medium | NFR-3 graceful degradation to polling mode |
| LLM forgets to call tool | Medium | Low | US2 safety net (session.idle → DLQ) |
| `experimental.text.complete` removed in future SDK | Medium | Low | Only used as opt-in fallback (US2) |
| Bug #3 (DLQ topic) regression after fix | Low | Medium | T007 explicitly tests both happy path and DLQ path |
| Performance regression (tool overhead vs polling) | Very Low | Low | NFR-1 measurement in T031 |
| Multi-session race conditions | Medium | Medium | SessionWatcher uses Map + session.idle for cleanup; bounded by rule `concurrency` |

## Validation Strategy

- **Per-task validation**: each task includes its own validation (tests, lint, typecheck).
- **Per-phase checkpoint**: at end of each phase, run `npm run check` (lint + unit).
- **Final validation (Phase 9)**: full e2e suite + NFR-1 latency measurement on real OpenCode 1.17.9 + real Kafka.
- **Acceptance**: all 22 tasks complete, all e2e tests pass (including new T-E2E-009/010/011), CHANGELOG updated, README reflects new architecture.

## Open Questions (deferred to /speckit.clarify if needed)

1. Should `requireToolCall: false` be the default for new rules? Currently `true` for safety.
2. Should there be a built-in `send_to_dlq` tool for LLM to explicitly fail messages? Out of scope per spec §Out of Scope, considered for spec 010.