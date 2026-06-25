# Tasks: E2E-тесты с реальным OpenCode-процессом

**Input**: Design documents from `/specs/008-e2e-opencode-real-process/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/helpers.md ✅, quickstart.md ✅

**Tests**: Этот feature ЦЕЛИКОМ состоит из E2E-тестов — каждая задача-реализация является тестом.

**Organization**: Задачи сгруппированы по User Story для независимой реализации и валидации каждой истории.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Можно выполнять параллельно (разные файлы, нет зависимостей)
- **[Story]**: Принадлежность к User Story (US1–US8)
- Все пути указаны от корня репозитория

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Конфигурация Vitest для E2E, скрипты запуска, тестовый агент OpenCode

- [x] T001 Create E2E Vitest config in vitest.e2e.config.ts — timeout: 120_000, hookTimeout: 60_000, pool: 'forks', singleFork: true, include: ['tests/e2e/**/*.e2e.test.ts'], env defaults for KAFKA_BROKERS/KAFKA_CLIENT_ID/KAFKA_GROUP_ID
- [x] T002 [P] Add "test:e2e" script to package.json — `"test:e2e": "vitest run --config vitest.e2e.config.ts"`
- [x] T003 [P] Create e2e-responder agent system prompt in .opencode/agents/e2e-responder.md — instructions: answer briefly, no tools, respond with minimal text
- [x] T004 [P] Add e2e-responder agent entry to .opencode/opencode.json — mode: subagent, model: lemonade, temperature: 0.1, permission: deny all, prompt: {file:agents/e2e-responder.md}
- [x] T004a [P] Update quickstart.md with E2E test run instructions — document prerequisites (Lemonade, Docker), commands (`npm run test:e2e`), expected output, troubleshooting tips

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Все helper-модули, необходимые для E2E-тестов. ДОЛЖНЫ быть готовы ДО начала User Story.

**⚠️ CRITICAL**: Ни один E2E-тест не может быть написан до завершения этой фазы

- [x] T005 Implement startRedpanda/stopRedpanda in tests/e2e/helpers/redpandaContainer.ts — REAL Redpanda через @testcontainers/redpanda, вернуть brokers array, cleanup через container.stop()
- [x] T006 [P] Implement spawnOpenCodeServe/OpenCodeProcessHandle in tests/e2e/helpers/opencodeProcess.ts — spawn child process, port pre-check (error if busy), health polling GET /health every 500ms, 30s startup timeout, kill() method: SIGTERM → 5s → SIGKILL
- [x] T007 [P] Implement createTopics/produceMessage/consumeOneMessage in tests/e2e/helpers/kafkaUtils.ts — admin client for topics, producer, consumer with fromBeginning: false and unique group ID per call, timeout-based consume
- [x] T008 [P] Implement createSDKClient in tests/e2e/helpers/sdkClient.ts — создать SDK клиент через `@opencode-ai/sdk` с custom baseURL, адаптировать к SDKClient интерфейсу
- [x] T008a [P] Add @opencode-ai/sdk to dependencies in package.json — verify or add `"@opencode-ai/sdk": "^1.14.28"`
- [x] T008b [P] Implement timing helper in tests/e2e/helpers/timing.ts — startTimer(label) returns stop function, logs elapsed ms to stdout with [e2e-timing] prefix, used in beforeAll/afterAll for infrastructure timing and in tests for execution timing
- [x] T009 Implement runPlugin/PluginRunnerHandle in tests/e2e/helpers/pluginRunner.ts — set process.env from params, call startConsumer(config, agent), return handle with stop() calling performGracefulShutdown, 10s shutdown timeout, swallow errors on cleanup

**Checkpoint**: Все helper-модули готовы → можно писать E2E-тесты

---

## Phase 3: User Story 1 — Happy Path: полный конвейер (Priority: P1) 🎯 MVP

**Goal**: Валидное Kafka-сообщение проходит через весь конвейер (Kafka → routing → агент → LLM → responseTopic) и возвращает осмысленный ответ

**Independent Test**: Отправить сообщение в input-топик, проверить responseTopic — status: success, непустой response, заполненные sessionId и ruleName

- [x] T010 [US1] Create tests/e2e/consumer.e2e.test.ts with beforeAll/afterAll skeleton and T-E2E-001 happy path test — beforeAll: start Redpanda, spawn opencode serve, create topics, snapshot hash of ~/.config/opencode/opencode.json; afterAll: cleanup; test: produce { task: "What is 2+2?" }, consume responseTopic, assert status=success, response non-empty, sessionId set, ruleName=e2e-echo-rule; in afterAll: snapshot hash of ~/.config/opencode/opencode.json before/after — assert unchanged (FR-009)

**Checkpoint**: Happy Path работает — минимальный жизнеспособный E2E-тест пройден

---

## Phase 4: User Story 2 — Routing: JSONPath-фильтрация (Priority: P1)

**Goal**: Routing-правила корректно фильтруют: совпадающие обрабатываются агентом, несовпадающие — тихо пропускаются

**Independent Test**: Отправить 2 сообщения (matching и non-matching), проверить что только matching вызвало ответ в responseTopic

- [x] T011 [US2] Add T-E2E-002 routing match/skip test to tests/e2e/consumer.e2e.test.ts — test: send { type: "notification", content: "hello" } → no response in responseTopic (skip); send { type: "question", content: "What color is the sky?" } → response with status=success

**Checkpoint**: Routing подтверждён в реальном окружении — Domain Isolation проверен E2E

---

## Phase 5: User Story 4 — Agent timeout → DLQ (Priority: P1)

**Goal**: При превышении timeoutMs сообщение попадает в DLQ, consumer продолжает работу (Resiliency)

**Independent Test**: Установить timeoutMs: 100, отправить сообщение, проверить DLQ с ошибкой timeout

- [x] T012 [US4] Add T-E2E-004 timeout→DLQ test to tests/e2e/consumer.e2e.test.ts — test: produce message with rule timeoutMs: 100 (too low for LLM), consume DLQ topic, assert originalTopic=e2e-input, error contains "timeout"; verify consumer continues

**Checkpoint**: Resiliency подтверждён E2E — timeout handling работает в реальном окружении

---

## Phase 6: User Story 3 — JSONPath field extraction: вложенные поля (Priority: P2)

**Goal**: JSONPath корректно извлекает вложенные поля и подставляет в promptTemplate

**Independent Test**: Отправить сообщение с вложенной структурой, проверить что ответ содержит релевантные ключевые слова

- [x] T013 [US3] Add T-E2E-003 field extraction test to tests/e2e/consumer.e2e.test.ts — test: send { data: { query: "What is TypeScript?", context: "Programming languages" } }, consume response, assert response contains relevant keywords

**Checkpoint**: Prompt assembly через buildPromptV003 подтверждён в реальных условиях

---

## Phase 7: User Story 5 — Минимальный ответ: не DLQ (Priority: P2)

**Goal**: Пустой или короткий ответ LLM считается успешным — попадает в responseTopic, не в DLQ

**Independent Test**: Отправить промпт "Reply with the single word ok", проверить success + пустой DLQ

- [x] T014 [US5] Add T-E2E-005 minimal response test to tests/e2e/consumer.e2e.test.ts — test: produce message with prompt "Reply with the single word ok", consume responseTopic assert status=success, response non-empty string; consume DLQ assert null (no false positives)

**Checkpoint**: Короткие ответы корректно обрабатываются — нет ложных DLQ

---

## Phase 8: User Story 6 — Fire-and-forget: нет responseTopic (Priority: P2)

**Goal**: Правило без responseTopic вызывает агента, но не отправляет ответ ни в какой топик

**Independent Test**: Настроить правило без responseTopic, проверить что response topic и DLQ пусты

- [x] T015 [US6] Add T-E2E-006 fire-and-forget test to tests/e2e/consumer.e2e.test.ts — test: produce message to fire-forget input topic (rule without responseTopic), wait, assert responseTopic empty, assert DLQ empty

**Checkpoint**: Optional responseTopic подтверждён — fire-and-forget работает без побочных эффектов

---

## Phase 8a: User Story 7 — Invalid Kafka message: consumer не крашится (Priority: P1)

**Goal**: Malformed JSON в Kafka-сообщении не крашит consumer, а корректно отправляется в DLQ

**Independent Test**: Отправить невалидный JSON, проверить DLQ и что consumer продолжает работу

- [x] T016a [US7] Add T-E2E-007 invalid JSON→DLQ test to tests/e2e/consumer.e2e.test.ts — test: produce "not a json" (raw string) to input topic, consume DLQ, assert error contains "parse" or "JSON"; produce valid message after, assert success — consumer continues

**Checkpoint**: Resiliency подтверждён для невалидных данных — consumer не падает на malformed JSON

---

## Phase 8b: User Story 8 — Consumer recovery после ошибки (Priority: P2)

**Goal**: Consumer корректно обрабатывает серию ошибок и продолжает работу — не теряет offset

**Independent Test**: Отправить invalid→valid→invalid→valid, проверить что все валидные обработаны, все невалидные в DLQ

- [x] T016b [US8] Add T-E2E-008 consumer recovery test to tests/e2e/consumer.e2e.test.ts — test: send series of 4 messages (invalid→valid→invalid→valid), verify 2 valid processed with success, 2 invalid in DLQ, consumer alive

**Checkpoint**: No-State Consumer + Resiliency подтверждены — consumer не накапливает состояние при ошибках

---

## Phase 10: CI & Polish

**Purpose**: CI-интеграция и финальная валидация

- [x] T016 [P] Create GitHub Actions E2E workflow in .github/workflows/e2e.yml — trigger: workflow_dispatch only, self-hosted runner, steps: checkout → setup node 20 → npm ci → npm run test:e2e
- [x] T017 [P] Verify npm run check does NOT include E2E tests — run npm run check, confirm no e2e tests executed
- [x] T018 Run full E2E suite via `npm run test:e2e` and validate against quickstart.md — confirm all 8 tests pass, no zombie processes, cleanup works

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (config + agent ready) — BLOCKS all user stories
  - Phase 1: T002, T003, T004, T004a can run in parallel (different files)
- **Foundational (Phase 2)**: Depends on Phase 1 (config + agent ready) — BLOCKS all user stories
- **User Stories (Phase 3–8, 8a, 8b)**: All depend on Phase 2 completion
  - US1 (Phase 3) must be first — creates test file skeleton
  - US2, US4 (Phase 4–5) can proceed after US1 (same file, sequential adds)
  - US3, US5, US6 (Phase 6–8) follow in priority order
  - US7 (Phase 8a) after US6 — needs consumer resilience
  - US8 (Phase 8b) after US7 — needs consumer alive
- **Polish (Phase 10)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — creates consumer.e2e.test.ts with beforeAll/afterAll
- **US2 (P1)**: After US1 — adds test to existing file, needs file skeleton
- **US4 (P1)**: After US1 — adds test to existing file, needs file skeleton
- **US3 (P2)**: After US1 — adds test to existing file
- **US5 (P2)**: After US1 — adds test to existing file
- **US6 (P2)**: After US1 — adds test to existing file
- **US7 (P1)**: After US6 — adds invalid JSON test, needs resilience
- **US8 (P2)**: After US7 — adds recovery test, needs consumer alive

### Within Each User Story

- Helper modules → test file creation (US1) → individual tests (US2–US8)
- All tests in same file → sequential, NOT parallel

### Parallel Opportunities

- Phase 1: T002, T003, T004 can run in parallel (different files)
- Phase 2: T006, T007, T008 can run in parallel after T005 (different files)
- Phase 10: T016, T017 can run in parallel (different files)

---

## Parallel Example: Phase 2 (Foundational)

```text
# After T005 completes:
Task: "Implement spawnOpenCodeServe in tests/e2e/helpers/opencodeProcess.ts"
Task: "Implement kafkaUtils in tests/e2e/helpers/kafkaUtils.ts"
Task: "Implement createSDKClient in tests/e2e/helpers/sdkClient.ts"
# Then T009 (pluginRunner) depends on understanding startConsumer shutdown
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundational (T005–T009)
3. Complete Phase 3: User Story 1 (T010)
4. **STOP and VALIDATE**: Run `npx vitest run --config vitest.e2e.config.ts -t "T-E2E-001"`
5. If passes → MVP confirmed, continue with remaining stories

### Incremental Delivery

1. Setup + Foundational → Infrastructure ready
2. Add US1 (Happy Path) → Run → MVP! ✅
3. Add US2 (Routing) → Run → Routing confirmed ✅
4. Add US4 (Timeout DLQ) → Run → Resiliency confirmed ✅
5. Add US3 (Field extraction) → Run → Prompt assembly confirmed ✅
6. Add US5 (Minimal response) → Run → Edge case confirmed ✅
7. Add US6 (Fire-and-forget) → Run → Optional response confirmed ✅
8. Add US7 (Invalid JSON) → Run → Malformed data resilience confirmed ✅
9. Add US8 (Recovery) → Run → No-state consumer confirmed ✅
10. Phase 10 (CI + Polish) → Production-ready ✅

### Execution Order for Single Developer

```
T001 → T002|T003|T004|T004a (parallel) → T005 → T006|T007|T008 (parallel) → T008a|T008b → T009
→ T010 → T011 → T012 → T013 → T014 → T015 → T016a → T016b → T016|T017 (parallel) → T018
```

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [USx] label maps task to specific user story for traceability
- All E2E tests in single file (consumer.e2e.test.ts) — sequential writes
- Each test independently testable via `npx vitest run --config vitest.e2e.config.ts -t "T-E2E-NNN"`
- Commit after each task or logical group
- Lemonade LLM prerequisite: must be running before any test execution
- Docker/Podman prerequisite: must be available for Redpanda containers