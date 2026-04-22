# Tasks: 003-kafka-consumer

**Input**: Design documents from `/specs/003-kafka-consumer/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks included for P1 user stories (US1, US2, US3, US5). P2 story (US4) has no tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths below assume single project structure per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

**Independent Test Criteria**: `npm run check` passes (lint + test)

- [X] T001 Create project directory structure per plan.md
  - `src/kafka/` — Kafka integration modules
  - `src/core/` — routing and prompt logic (pure functions)
  - `src/schemas/` — Zod schemas and types
  - `tests/unit/` — unit tests
  - `tests/integration/` — integration tests with Redpanda

- [X] T002 Verify package.json contains all required dependencies
  - `kafkajs` — Kafka client
  - `zod` — runtime validation
  - `jsonpath-plus` — JSONPath queries
  - `vitest` — testing framework
  - `testcontainers-node` — integration testing
  - Dev: `@types/node`, `typescript`, `eslint`

- [X] T003 [P] Create tsconfig.json per TypeScript 6.x spec (ES2022 target, ESNext modules, moduleResolution: bundler) in tsconfig.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

**Independent Test Criteria**: All `src/core/*.ts` files have 90%+ coverage

### 2.1 Schemas & Types

- [ ] T004 [P] Define Zod schemas for KafkaEnv in src/schemas/index.ts
  - `kafkaEnvSchema` — validates KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID (required)
  - Optional: KAFKA_SSL, KAFKA_USERNAME, KAFKA_PASSWORD, KAFKA_SASL_MECHANISM, KAFKA_DLQ_TOPIC, KAFKA_ROUTER_CONFIG
  - Strict mode: no defaults for required fields

- [ ] T005 [P] Define Zod schemas for PluginConfig and Rule in src/schemas/index.ts
  - `ruleSchema` — name (string), jsonPath (string), promptTemplate (string)
  - `pluginConfigSchema` — topics (array, max 5), rules (array)
  - FR-017 topic coverage validation

- [ ] T006 [P] Export types via z.infer<> in src/schemas/index.ts
  - `KafkaEnv` from kafkaEnvSchema
  - `PluginConfig` from pluginConfigSchema
  - `Rule` from ruleSchema

### 2.2 Core Modules

- [ ] T007 [P] Implement parseConfig() in src/core/config.ts
  - Reads kafka-router.json from KAFKA_ROUTER_CONFIG env (default: .opencode/kafka-router.json)
  - Validates via pluginConfigSchema (Zod strict mode)
  - Throws descriptive Error on validation failure
  - FR-017 topic coverage validation

- [ ] T008 [P] Implement matchRule() in src/core/routing.ts
  - Pure function: (payload: unknown, rules: Rule[]) => Rule | null
  - Uses jsonpath-plus to evaluate jsonPath against payload
  - Returns null if no rule matches (not an error)
  - No side effects, no OpenCode API dependencies

- [ ] T009 [P] Implement buildPrompt() in src/core/prompt.ts
  - Pure function: (rule: Rule, payload: unknown) => string
  - Template substitution: replaces ${context.path} placeholders
  - Uses String() for primitive types

- [ ] T010 [P] Create src/core/index.ts re-exports
  - Export parseConfig from config.ts
  - Export matchRule from routing.ts
  - Export buildPrompt from prompt.ts

### 2.3 Foundational Tests

- [ ] T011 [P] Write unit tests for parseConfig() in tests/unit/config.test.ts
  - Valid config passes
  - Missing required fields throws with field name
  - Topics array > 5 items throws
  - Invalid JSON in config file throws

- [ ] T012 [P] Write unit tests for matchRule() in tests/unit/routing.test.ts
  - Match returns rule
  - No match returns null
  - Invalid jsonPath handled gracefully

- [ ] T013 [P] Write unit tests for buildPrompt() in tests/unit/prompt.test.ts
  - Template substitution works
  - Missing placeholders handled
  - Non-object payloads handled

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Environment-based Kafka Initialization (Priority: P1) 🎯 MVP

**Goal**: Kafka client initializes from env vars with fail-fast validation

**Independent Test**: Unit tests pass + integration test creates Kafka client from env vars

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T014 [P] [US1] Write unit tests for createKafkaClient() in tests/unit/client.test.ts
  - Missing KAFKA_BROKERS throws descriptive error
  - Missing KAFKA_CLIENT_ID throws descriptive error
  - Missing KAFKA_GROUP_ID throws descriptive error
  - SSL enabled when KAFKA_SSL=true
  - SASL configured when username+password set

### Implementation for User Story 1

- [ ] T015 [US1] Implement createKafkaClient(env: NodeJS.ProcessEnv): Kafka in src/kafka/client.ts
  - FR-019: reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID
  - Validates via kafkaEnvSchema (Zod strict mode)
  - Throws Error with field name if required var missing
  - Trims trailing spaces from KAFKA_BROKERS
  - Configures SSL if KAFKA_SSL=true
  - Configures SASL if KAFKA_USERNAME + KAFKA_PASSWORD set (mechanism from KAFKA_SASL_MECHANISM, default: plain)

- [ ] T016 [US1] Implement createConsumer(kafka: Kafka): Consumer in src/kafka/client.ts
  - FR-020: sessionTimeout: 300000, heartbeatInterval: 30000
  - groupId from KAFKA_GROUP_ID env
  - autoCommit: false (for sequential processing control)

- [ ] T017 [US1] Implement createDlqProducer(kafka: Kafka): Producer in src/kafka/client.ts
  - FR-021: dedicated producer for DLQ sends
  - Separate instance from main-flow producer

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Sequential Message Processing with Backpressure (Priority: P1)

**Goal**: Messages processed strictly one-at-a-time as natural backpressure

**Independent Test**: Timing assertion: total time ≈ N × single message time

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T018 [P] [US2] Write unit tests for eachMessageHandler in tests/unit/consumer.test.ts
  - Valid JSON passes parsing
  - Invalid JSON throws → DLQ
  - Oversized message (>1MB) → DLQ
  - matchRule() throws → DLQ
  - buildPrompt() throws → DLQ
  - No global state between invocations

### Implementation for User Story 2

- [ ] T019 [US2] Implement eachMessageHandler(payload, config, dlqProducer): Promise<void> in src/kafka/consumer.ts
  - FR-023: parses message.value as JSON (throws → DLQ)
  - Validates message size (max 1MB, oversized → DLQ)
  - Calls matchRule() (throws → DLQ)
  - Calls buildPrompt() (throws → DLQ)
  - Logs matched rule name and prompt
  - Commits offset on success
  - autoCommit: false — manual commitOffsets() after each message

- [ ] T020 [US2] Ensure sequential processing in eachMessageHandler in src/kafka/consumer.ts
  - No parallelism: await each operation before starting next
  - next message starts only after current await resolves
  - timing measurement: total time ≈ N × single message time (verifiable)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Dead Letter Queue on Processing Failure (Priority: P1)

**Goal**: Failed messages routed to DLQ, no message loss

**Independent Test**: Invalid JSON → DLQ topic contains correct envelope

### Tests for User Story 3 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T021 [P] [US3] Write unit tests for sendToDlq() in tests/unit/dlq.test.ts
  - DLQ envelope contains all required fields
  - DLQ topic defaults to {original-topic}-dlq
  - Custom KAFKA_DLQ_TOPIC used when set
  - sendToDlq never throws (error caught and logged)

- [ ] T022 [P] [US3] Write integration tests for DLQ flow in tests/integration/dlq.test.ts
  - Invalid JSON message lands in DLQ topic
  - DLQ envelope has correct structure
  - DLQ send failure does NOT crash consumer

### Implementation for User Story 3

- [ ] T023 [US3] Implement DlqEnvelope type and sendToDlq() in src/kafka/dlq.ts
  - FR-022: constructs DLQ payload with originalValue, topic, partition, offset, errorMessage, failedAt (ISO timestamp)
  - Target topic from KAFKA_DLQ_TOPIC env or ${topic}-dlq
  - try/catch wrapper: logs on failure, never throws
  - DLQ send failure is non-fatal

- [ ] T024 [US3] Integrate DLQ into eachMessageHandler in src/kafka/consumer.ts
  - JSON parse error → sendToDlq() → commitOffsets()
  - matchRule() throws → sendToDlq() → commitOffsets()
  - buildPrompt() throws → sendToDlq() → commitOffsets()
  - DLQ send succeeds → commitOffsets() (message NOT retried)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - Graceful Shutdown (Priority: P2)

**Goal**: Consumer disconnects cleanly on SIGTERM/SIGINT within 10s

**Independent Test**: Shutdown completes within 10 seconds

**Note**: P2 priority - no test tasks required

### Implementation for User Story 4

- [ ] T025 [US4] Implement startConsumer(config: PluginConfig): Promise<void> in src/kafka/consumer.ts
  - FR-024: wires FR-019..FR-023 together
  - Subscribes to all config.topics
  - Registers SIGTERM/SIGINT handlers
  - Orchestrates createKafkaClient → createConsumer → createDlqProducer → eachMessageHandler

- [ ] T026 [US4] Implement graceful shutdown in src/kafka/consumer.ts
  - SIGTERM/SIGINT → consumer.disconnect() → producer.disconnect()
  - Shutdown timeout: 10 seconds (force-kill after timeout)
  - SIGTERM during DLQ send: complete it, then disconnect
  - Sequence logged

**Checkpoint**: At this point, User Stories 1-4 should all work independently

---

## Phase 7: User Story 5 - Real Kafka Producer Integration Test (Priority: P1)

**Goal**: Integration test verifies full consumer→routing→DLQ flow with Redpanda

**Independent Test**: Integration test with real KafkaJS producer to Redpanda passes

### Tests for User Story 5 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T027 [P] [US5] Set up testcontainers-node + Redpanda in tests/integration/consumer.test.ts
  - Redpanda testcontainer starts before tests
  - Container cleanup after tests
  - Creates topics for testing

- [ ] T028 [P] [US5] Implement integration test: send messages via KafkaJS producer to Redpanda in tests/integration/consumer.test.ts
  - Send 3 messages: one matching rule, one non-matching, one invalid JSON
  - All messages received by consumer
  - Matching message: matchRule() + buildPrompt() called correctly
  - Invalid JSON message lands in DLQ topic

- [ ] T029 [US5] Verify sequential processing in integration test in tests/integration/consumer.test.ts
  - Multiple messages processed
  - Total time ≈ N × single message time (sequential, no parallelism)
  - Timing assertion passes

**Checkpoint**: At this point, all user stories (US1-US5) should be independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T030 Implement src/index.ts plugin entry point
  - FR-025: reads kafka-router.json from KAFKA_ROUTER_CONFIG env (default: .opencode/kafka-router.json)
  - Calls parseConfig() on file contents
  - Calls startConsumer(config)
  - Exports default async function start(): Promise<void>

- [ ] T031 [P] Implement structured JSON logging (NFR-010) in src/kafka/consumer.ts
  - Message processing time logged
  - DLQ rate logged
  - Consumer lag metrics logged

- [ ] T032 Handle edge cases per spec.md in src/kafka/consumer.ts
  - KAFKA_BROKERS trailing spaces → trim each broker
  - message.value is null (tombstone) → treat as invalid JSON → DLQ
  - matchRule() returns null → log "no rule matched", then commit (NOT an error)
  - DLQ topic send fails → log error, still commit (non-fatal)
  - message.value exceeds 1MB → send to DLQ
  - Kafka broker throttle → pause 1s, retry up to 3 times, then DLQ

- [ ] T033 [P] Run kafka-constitution-compliance agent to verify code adheres to 5 NON-NEGOTIABLE principles

- [ ] T034 Run npm run check (lint + test) and ensure all pass

- [ ] T035 Verify code coverage ≥ 90% on src/kafka/*.ts and src/core/*.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
    - US1 (P1) - Environment-based Kafka Initialization
    - US2 (P1) - Sequential Message Processing
    - US3 (P1) - Dead Letter Queue
    - US5 (P1) - Real Kafka Producer Integration Test
    - US4 (P2) - Graceful Shutdown
  - **Note**: US5 integration test depends on US1-US3 implementation complete
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 for Kafka client
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Depends on US1 (DLQ producer) and US2 (handler integration)
- **User Story 4 (P2)**: Can start after US2 complete - Requires eachMessageHandler for orchestration
- **User Story 5 (P1)**: Can start after US1-US3 complete - Tests the full consumer→routing→DLQ flow

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members (after US1 provides Kafka client)

---

## Parallel Example: User Story 1

```bash
# Launch test for User Story 1:
Task: "Write unit tests for createKafkaClient() in tests/unit/client.test.ts"

# Then implement in order:
Task: "Implement createKafkaClient(env: NodeJS.ProcessEnv): Kafka in src/kafka/client.ts"
Task: "Implement createConsumer(kafka: Kafka): Consumer in src/kafka/client.ts"
Task: "Implement createDlqProducer(kafka: Kafka): Producer in src/kafka/client.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Add User Story 5 → Test independently → Deploy/Demo
6. Add User Story 4 → Test independently → Deploy/Demo
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Kafka client - provides foundation for others)
   - Developer B: User Story 2 (Sequential processing - depends on US1)
   - Developer C: User Story 3 (DLQ - depends on US1 and US2)
   - Developer D: User Story 5 (Integration test - depends on US1-US3)
3. User Story 4 (Graceful shutdown) can be done after US2 complete

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- **Constitution**: After implementation phases, run kafka-constitution-compliance agent to verify adherence to 5 NON-NEGOTIABLE principles
- **Coverage**: 90%+ coverage required for src/core/*.ts and src/kafka/*.ts
- **Types**: src/core/types.ts is deleted - types exported from src/schemas/index.ts via z.infer<>
