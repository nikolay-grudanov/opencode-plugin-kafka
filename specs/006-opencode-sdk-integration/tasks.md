# Tasks: OpenCode SDK Integration

**Input**: Design documents from `/specs/006-opencode-sdk-integration/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md

**Tests**: Test-First Development — NON-NEGOTIABLE (Constitution V). Tests MUST be written BEFORE implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Создать директорию `src/opencode/` (новый модуль интеграции с OpenCode SDK)
- [ ] T002 [P] Создать файл `src/types/opencode-sdk.d.ts` с type declarations (SDKClient, SessionsAPI, Session, AssistantMessage, MessagePart) — FR-004
- [ ] T003 [P] Обновить `src/types/opencode-plugin.d.ts` — PluginContext с {client, project, directory, worktree, $}, PluginHooks, Plugin type — FR-005

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL: No user story work can begin until this phase is complete**

- [ ] T004 [P] Обновить `src/schemas/index.ts` — расширить RuleV003Schema с agentId (required), responseTopic (optional), timeoutSeconds (default 120), concurrency (default 1) — FR-003
- [ ] T005 [P] Создать `src/opencode/IOpenCodeAgent.ts` — interface IOpenCodeAgent {invoke, abort}, InvokeOptions, AgentResult — FR-006
- [ ] T006 [P] Создать `src/opencode/AgentError.ts` — class TimeoutError extends Error, class AgentError extends Error — FR-009
- [ ] T007 [P] Написать unit tests для IOpenCodeAgent types в `tests/unit/opencode/interfaces.test.ts` — verify interfaces compile and types are correct
- [ ] T008 [P] Написать unit tests для AgentError в `tests/unit/opencode/agent-error.test.ts` — verify error classes (name, message, originalError)

**Checkpoint**: Foundation ready — types, schemas, interfaces defined. Tests pass.

---

## Phase 3: User Story 1 — Автоматический запуск OpenCode агента по Kafka сообщению (Priority: P1) 🎯 MVP

**Goal**: Kafka сообщение → JSONPath routing → OpenCode agent invoke → ответ в responseTopic
**Independent Test**: Отправить сообщение в Kafka топик → проверить что агент вызван и ответ отправлен

**Tests FIRST (Test-First Development):**

- [ ] T009 [P] [US1] Написать unit tests для MockOpenCodeAgent в `tests/unit/opencode/mock-agent.test.ts` — invoke success, invoke timeout, invoke failure, abort, activeSessions tracking — FR-008
- [ ] T010 [P] [US1] Написать unit tests для extractResponseText в `tests/unit/opencode/extract-response.test.ts` — filter type='text', join \n\n, empty parts, non-text parts — FR-007
- [ ] T011 [P] [US1] Написать unit tests для OpenCodeAgentAdapter в `tests/unit/opencode/agent-adapter.test.ts` — mocked SDK, success flow, timeout flow (best-effort abort), error flow — FR-007

**Implementation:**

- [ ] T012 [US1] Создать `src/opencode/MockOpenCodeAgent.ts` — MockConfig {responses, delayMs, shouldFail, shouldTimeout}, activeSessions Set — FR-008
- [ ] T013 [US1] Создать `src/opencode/OpenCodeAgentAdapter.ts` — create session, prompt, Promise.race timeout, extractResponseText (filter text, join \n\n), best-effort abort — FR-007
- [ ] T014 [P] [US1] Написать unit tests для sendResponse в `tests/unit/kafka/response-producer.test.ts` — success send, Kafka message keyed by sessionId, allowAutoTopicCreation: false — FR-014
- [ ] T015 [US1] Создать `src/kafka/response-producer.ts` — sendResponse(producer, topic, ResponseMessage), key by sessionId, never throws — FR-014
- [ ] T016 [US1] Обновить `src/kafka/client.ts` — добавить createResponseProducer(kafka): Producer с allowAutoTopicCreation: false — FR-010
- [ ] T017 [P] [US1] Написать unit tests для eachMessageHandler в `tests/unit/consumer.test.ts` — success invoke → response sent, timeout → DLQ, agent error → DLQ, no match → skip, tombstone → skip, oversized → DLQ, parse error → DLQ, response send failure → log + commit — NFR-003
- [ ] T018 [US1] Обновить `src/kafka/consumer.ts` — eachMessageHandler 10-step pipeline (tombstone → size → parse → match → build → invoke → response/DLQ → commit), add activeSessions parameter, ConsumerState tracking (isShuttingDown, totalMessagesProcessed, dlqMessagesCount, lastDlqRateLogTime), MAX_MESSAGE_SIZE validation (1_048_576 bytes), JSON.stringify structured logging — FR-013, FR-018, FR-019, FR-020
- [ ] T019 [US1] Обновить `src/core/config.ts` — добавить FR-017 topic coverage validation. Создать функцию validateTopicCoverage(config: PluginConfigV003): void, которая проверяет что responseTopic не совпадает ни с одним input topic. Если совпадает — throw Error — FR-002, FR-017
- [ ] T020 [US1] Обновить `src/index.ts` — plugin() entry point: instantiate OpenCodeAgentAdapter(ctx.client), pass to startConsumer, return session.error hook — FR-001

**Checkpoint**: US1 functional — Kafka message → agent → response. All unit tests pass.

---

## Phase 4: User Story 2 — Обработка ошибок через DLQ (Priority: P2)

**Goal**: Все ошибки (parse, timeout, agent) → DLQ. No retry. Commit offset always.
**Independent Test**: Отправить невалидное/timeout сообщение → проверить что оно в DLQ

**Tests FIRST:**

- [ ] T021 [P] [US2] Написать unit tests для DLQ error handling в `tests/unit/consumer.test.ts` (дополнить) — parse error → DLQ envelope correct, timeout → DLQ envelope correct, agent error → DLQ envelope correct, DLQ send failure → log (no throw) — FR-015

**Implementation:**

- [ ] T022 [US2] Верифицировать `src/kafka/dlq.ts` — sendToDlq envelope format {originalTopic, partition, offset, errorMessage, timestamp, originalValue}, never throws — FR-015
- [ ] T023 [US2] Интегрировать DLQ в eachMessageHandler — все error paths ведут в DLQ, commit offset после DLQ send, responseTopic НЕ получает errors — FR-013, NFR-004

**Checkpoint**: US2 functional — все ошибки → DLQ, offset всегда commit.

---

## Phase 5: User Story 3 — Graceful Shutdown (Priority: P3)

**Goal**: SIGTERM → abort all active sessions → disconnect consumer → disconnect producers за 15s
**Independent Test**: Послать SIGTERM во время обработки → проверить что sessions aborted, consumer/producers disconnected

**Tests FIRST:**

- [ ] T024 [P] [US3] Написать unit tests для graceful shutdown в `tests/unit/consumer.test.ts` (дополнить) — shutdown with active sessions → all aborted, shutdown with no sessions → clean, 15s timeout exceeded → log warning — FR-016

**Implementation:**

- [ ] T025 [US3] Обновить performGracefulShutdown в `src/kafka/consumer.ts` — Promise.allSettled(abort activeSessions), disconnect consumer, dlqProducer, responseProducer, 15s total timeout (forced exit with code 1 if exceeded) — FR-016
- [ ] T026 [US3] Обновить startConsumer в `src/kafka/consumer.ts` — передать agent и responseProducer, инициализировать response producer, SIGTERM/SIGINT handlers — FR-013, FR-016

**Checkpoint**: US3 functional — graceful shutdown корректно завершает все ресурсы.

---

## Phase 6: Integration Tests

- [ ] T027 Написать integration test `tests/integration/kafka-opencode.test.ts` — Redpanda + MockOpenCodeAgent: success flow, timeout flow, error flow, tombstone, no match — NFR-002, NFR-003

---

## Phase 7: Validation & Polish

- [ ] T028 Запустить `npm run check` — lint + test все проходят
- [ ] T029 Запустить `npm run test:coverage` — проверить ≥90% coverage
- [ ] T030 [P] Проверить no `any` types в codebase
- [ ] T031 [P] Проверить structured logging (JSON.stringify, FR-019) во всех production paths
- [ ] T032 Запустить kafka-constitution-compliance agent для проверки всех 5 принципов

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies
- **Phase 2**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — MVP
- **Phase 4 (US2)**: Depends on Phase 3
- **Phase 5 (US3)**: Depends on Phase 4
- **Phase 6**: Depends on Phase 5
- **Phase 7**: Depends on Phase 6

---

## Parallel Opportunities

- **T002, T003**: can run in parallel (different files)
- **T004, T005, T006**: can run in parallel (different files)
- **T009, T010, T011**: can run in parallel (different test files)
- **T014**: can run in parallel with T015
- **T021**: can run in parallel with T022
- **T024**: can run in parallel with T025

---

## Implementation Strategy

- **MVP** = Phase 1 + Phase 2 + Phase 3 (US1 only)
- **Incremental**: US1 → US2 → US3 → Integration → Validation
- **Commit after each task**: Small, atomic commits
- **`npm run check` must pass** after each phase

---

## Notes

1. **Test-First Development NON-NEGOTIABLE** — tests BEFORE implementation
2. **[P]** = parallelizable (different files)
3. **Each user story independently testable**
4. **Commit after each task**
5. **Strict checklist format**: `- [ ] TXXX [P?] [Story?] Description with file path`
6. **Total tasks**: 32

---

## Coverage по FR

| FR | Task | Status |
|----|------|--------|
| FR-001 | T020 | Plugin Entry Point |
| FR-002 | T019 | Configuration + FR-017 |
| FR-003 | T004 | RuleV003Schema |
| FR-004 | T002 | SDK Type Declarations |
| FR-005 | T003 | PluginContext Type |
| FR-006 | T005 | IOpenCodeAgent Interface |
| FR-007 | T013, T011 | OpenCodeAgentAdapter |
| FR-008 | T012, T009 | MockOpenCodeAgent |
| FR-009 | T006, T008 | AgentError Classes |
| FR-010 | T016 | Kafka Client |
| FR-011 | — | Already implemented (spec 003) |
| FR-012 | — | Already implemented (spec 003) |
| FR-013 | T018, T023, T025 | eachMessageHandler + DLQ + Shutdown |
| FR-014 | T015, T014 | Response Producer |
| FR-015 | T022, T021 | DLQ handling |
| FR-016 | T025, T026 | Graceful Shutdown |
| FR-017 | T019 | Topic Coverage Validation |
| FR-018 | T018 | ConsumerState |
| FR-019 | T031 | Structured Logging |
| FR-020 | T018 | MAX_MESSAGE_SIZE |

---

## Test Scenarios (NFR-003)

Все 8 mandatory сценариев должны быть протестированы:

| # | Сценарий | Тест | Task |
|---|----------|------|------|
| 1 | Tombstone ignored | `KAFKA_IGNORE_TOMBSTONES=true` | T017 |
| 2 | Tombstone to DLQ | Default behavior | T017 |
| 3 | Oversized message | MAX_MESSAGE_SIZE validation | T017 |
| 4 | JSON parse error | JSON.parse failure | T017 |
| 5 | No matching rule | matchRuleV003 | T017 |
| 6 | Success flow | Full invoke flow | T017 |
| 7 | Timeout flow | Promise.race timeout | T017 |
| 8 | Error flow | Agent error | T017 |