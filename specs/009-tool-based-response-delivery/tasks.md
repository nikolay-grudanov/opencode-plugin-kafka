# Tasks: Tool-Based Response Delivery

**Input**: Design documents from `/specs/009-tool-based-response-delivery/`
**Prerequisites**: spec.md ✅, data-model.md ✅, ADR-009 ✅

**Tests**: This feature is refactor + new functionality; tests are mandatory (Constitution Principle V).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3, US4
- All paths from repo root

---

## Phase 1: Setup (parallel-safe foundation)

- [ ] T001 [P] Add `@opencode-ai/plugin@^1.16.2` to `dependencies` in `package.json`
- [ ] T002 [P] Update `tsconfig.json` to ensure `moduleResolution: bundler` resolves `@opencode-ai/plugin` subpath exports
- [ ] T003 [P] Create `src/opencode/session-watchers.ts` — Map<sessionId, SessionWatcher> with `register()`, `markToolCalled()`, `cleanup()` methods (NFR-4: closure-scoped ephemeral state)
- [ ] T004 [P] Create `src/opencode/tool-handler.ts` — `createSendToKafkaTool(rule, producer, dlqProducer)` returning `ToolDefinition`; uses `tool()` helper from `@opencode-ai/plugin` and Zod for args schema (FR-1, FR-2, FR-3)

## Phase 2: Schema update

- [ ] T005 Add `requireToolCall`, `fallbackToTextCapture`, `safetyNetTimeoutMs`, `maxSessionMs` to `RuleV003Schema` in `src/schemas/index.ts` (FR-6)
- [ ] T006 Add `toolCallObserved`, `fallbackUsed`, `sessionDurationMs` optional fields to `DlqEnvelope` type in `src/kafka/dlq.ts` (data-model §3)
- [ ] T007 Fix bug #3 — change `src/kafka/dlq.ts:106` from `process.env.KAFKA_DLQ_TOPIC || \`${topic}-dlq\`` to take `dlqTopic` as parameter from caller; update `eachMessageHandler` signature in `src/kafka/consumer.ts` to pass `config.dlqTopic`

## Phase 3: Remove polling (US1, US2)

- [ ] T008 Refactor `OpenCodeAgentAdapter.invoke()` in `src/opencode/OpenCodeAgentAdapter.ts` — remove `pollForResponse()`, `MAX_POLL_ATTEMPTS`, `POLL_INTERVAL_MS`; `invoke()` becomes thin shim that creates session, registers watcher, calls `session.prompt()`, returns immediately (FR-7)
- [ ] T009 Update `src/index.ts` to return `Hooks = { tool: { send_to_kafka_<rule>: createSendToKafkaTool(...) }, event: handleSessionEvent, 'session.error': handleSessionError }` (US3)

## Phase 4: Event hook + safety net (US2)

- [ ] T010 Implement `handleSessionEvent(input, allRules)` in `src/opencode/event-handler.ts` — filters `event.type === 'session.idle'` and `event.type === 'message.part.updated'`, looks up `SessionWatcher`, enforces `requireToolCall` and `fallbackToTextCapture` (FR-4, FR-5)
- [ ] T011 Wire `SessionWatcher.markToolCalled()` from tool-handler back to event-handler (cross-module wiring — tool fires "called", event hook checks on idle)
- [ ] T012 Add `maxSessionMs` wall-clock guard in event-handler — if session startTime + maxSessionMs elapsed before `session.idle`, send DLQ with `errorMessage: "session exceeded maxSessionMs without idle event"`

## Phase 5: Per-test DLQ topics (US4)

- [ ] T013 Create `tests/e2e/helpers/perTestTopics.ts` — `createPerTestTopics(testName)` creates uniquely-named input/response/dlq topics, returns `PerTestTopics`; `cleanupPerTestTopics(topics)` deletes them in `afterAll` (FR-8)
- [ ] T014 Update `tests/e2e/consumer.e2e.test.ts` — replace shared topic names with per-`describe` topic creation via `perTestTopics` helper

## Phase 6: Tests (mandatory, Constitution V)

- [ ] T015 [P] Unit test `src/opencode/tool-handler.test.ts` — covers all 5 args combinations, empty-response rejection, Kafka publish failure path (NFR-5: ≥90% coverage)
- [ ] T016 [P] Unit test `src/opencode/event-handler.test.ts` — covers session.idle with/without tool called, message.part.updated text capture, maxSessionMs timeout
- [ ] T017 [P] Unit test `src/opencode/session-watchers.test.ts` — covers register/markToolCalled/cleanup, map size stays bounded
- [ ] T018 [P] Update `tests/unit/opencode/adapter.test.ts` — remove polling-related tests; update mock for `invoke()` to return immediately without waiting for LLM stream
- [ ] T019 Update `tests/unit/index.test.ts` — plugin returns `Hooks` with `tool`, `event`, `'session.error'`; verify schema
- [ ] T020 Update `tests/unit/client.test.ts` if any change to createKafkaClient signature (depends on T007)

## Phase 7: E2E tests (real OpenCode + real Kafka)

- [ ] T021 Rewrite `tests/e2e/consumer.e2e.test.ts` — replace polling-based assertions with tool-call assertions; use per-test DLQ topics (US4 acceptance scenarios)
- [ ] T022 Add `T-E2E-009: tool-based response` test — produce message, observe LLM calling send_to_kafka tool exactly once, assert response topic has the LLM's final text
- [ ] T023 Add `T-E2E-010: safety net on missing tool call` test — configure agent with system prompt that forbids tool calls, observe DLQ envelope with `errorMessage: "session idle without tool call"`
- [ ] T024 Add `T-E2E-011: fallbackToTextCapture` test — opt-in fallback mode, observe response topic has captured text with `fallbackUsed: true`

## Phase 8: Polish

- [ ] T025 Update `src/opencode/OpenCodeAgentAdapter.ts` JSDoc — remove polling-related comments, document new "tool fires async" semantics
- [ ] T026 Update `AGENTS.md` — replace spec-008 polling explanation with tool-based architecture; remove `pollForResponse` references
- [ ] T027 Update `CHANGELOG.md` — add `## [0.4.0] — 2026-06-XX` with migration note: "Polling removed; custom tool + event hooks replace it. Existing kafka-router.json configs work unchanged (defaults applied)."
- [ ] T028 Update `README.md` — section "Architecture" → "How it works now" with tool flow diagram

## Phase 9: CI & validate

- [ ] T029 Update `.github/workflows/e2e.yml` if needed — add test names T-E2E-009/010/011 to the dispatch allowlist
- [ ] T030 Run full e2e suite on real Kafka + OpenCode — all 11 e2e tests (T-E2E-001..008 + T-E2E-009..011) must pass
- [ ] T031 Verify NFR-1 — measure median latency from Kafka produce → response consume; assert ≤ LLM streaming time + 1s

## Dependencies & Execution Order

```
Phase 1 (T001-T004): parallel
   ↓
Phase 2 (T005-T007): parallel, but T007 affects consumer.ts (Phase 3 dependency)
   ↓
Phase 3 (T008-T009): sequential, T008 then T009 (uses T008's adapter signature)
   ↓
Phase 4 (T010-T012): parallel, but T011 depends on T010 and T004
   ↓
Phase 5 (T013-T014): sequential, T013 then T014 (helper first)
   ↓
Phase 6 (T015-T020): parallel where marked
   ↓
Phase 7 (T021-T024): sequential T021 → T022/T023/T024 parallel
   ↓
Phase 8 (T025-T028): parallel
   ↓
Phase 9 (T029-T031): sequential, T030/T031 validate everything
```

## Story Independence

- **US1 (P1)**: Phases 1-4 + part of 6 (T015, T018) — independent vertical slice.
- **US2 (P1)**: Phase 4 + part of 6 (T016) — depends on US1 foundation (SessionWatcher).
- **US3 (P2)**: Part of Phase 3 (T009 only, multiple tools) + part of 6 (T019) — depends on US1 foundation.
- **US4 (P2)**: Phase 5 + part of 7 (T021) — fully independent of US1/US2/US3 mechanics.

US1 is the MVP. US2/US3/US4 can ship in same release or follow-up.