---

description: "Task list for Kafka Router Plugin Core implementation"
---

# Tasks: Kafka Router Plugin — Configuration & Message Routing

**Input**: Design documents from `/specs/001-kafka-router/`
**Feature**: 001-kafka-router | **Branch**: `001-new-specification`
**Tech Stack**: TypeScript 5.x, Zod, jsonpath-plus, Vitest

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Initialize project structure and dependencies

- [ ] T001 Initialize npm project, create package.json with name "opencode-plugin-kafka", version "0.1.0"
- [ ] T002 [P] Install dependencies: zod, jsonpath-plus
- [ ] T003 [P] Install dev dependencies: vitest, @types/node, typescript
- [ ] T004 [P] Create tsconfig.json with ES2022 target, strict mode
- [ ] T005 [P] Create vitest.config.ts with TypeScript support
- [ ] T006 Create project directory structure: src/core/, src/schemas/, tests/unit/

**Checkpoint**: Project initialized with dependencies installed

---

## Phase 2: Foundational (Core Types & Schemas)

**Purpose**: Define TypeScript types and Zod schemas — BLOCKING for all user stories

- [x] T007 [P] Create src/core/types.ts with PluginConfig, Rule, Payload interfaces
- [x] T008 [P] Create src/schemas/index.ts with RuleSchema and PluginConfigSchema using Zod
- [x] T009 Create src/core/index.ts as public API exports

**Checkpoint**: Types and schemas ready — user story implementation can begin

---

## Phase 3: User Story 1 — parseConfig (Priority: P1) 🎯 MVP

**Goal**: Provide parseConfig function that validates JSON configuration via Zod

**Independent Test**: Create valid/invalid JSON configs, verify typed output or ZodError

### Tests for User Story 1 (TDD — write FIRST, ensure FAIL before implementation) ⚠️

- [x] T010 [P] [US1] Write unit tests for parseConfig in tests/unit/config.test.ts covering:
  - Valid config parsing returns PluginConfig
  - Missing required field throws ZodError with field path, expected type, and actual value
  - Null/undefined payload throws ZodError
  - Missing optional prompt_field defaults to "$"
  - Empty topics/rules array throws ZodError

### Implementation for User Story 1

- [x] T011 [US1] Implement parseConfig function in src/core/config.ts using PluginConfigSchema
- [x] T012 [US1] Export parseConfig from src/core/index.ts
- [x] T013 [US1] Run tests: npx vitest tests/unit/config.test.ts — all tests should PASS

**Checkpoint**: parseConfig function validates configs correctly

---

## Phase 4: User Story 2 — matchRule (Priority: P1)

**Goal**: Provide matchRule function that filters rules by topic and applies JSONPath conditions

**Independent Test**: Create test payloads, verify correct rule matching or null return

### Tests for User Story 2 (TDD — write FIRST, ensure FAIL before implementation) ⚠️

- [x] T014 [P] [US2] Write unit tests for matchRule in tests/unit/routing.test.ts covering:
  - Rule with matching condition returns that rule
  - Rule without matching condition returns null
  - Catch-all rule (no condition) always matches
  - First matching rule wins (multiple rules)
  - Null/undefined payload handling

### Implementation for User Story 2

- [x] T015 [US2] Implement matchRule function in src/core/routing.ts using jsonpath-plus
- [x] T016 [US2] Export matchRule from src/core/index.ts
- [x] T017 [US2] Run tests: npx vitest tests/unit/routing.test.ts — all tests should PASS

**Checkpoint**: matchRule function correctly routes messages

---

## Phase 5: User Story 3 — buildPrompt (Priority: P1)

**Goal**: Provide buildPrompt function that extracts text from payload and formats agent prompt

**Independent Test**: Create test payloads and rules, verify prompt string output

### Tests for User Story 3 (TDD — write FIRST, ensure FAIL before implementation) ⚠️

- [x] T018 [P] [US3] Write unit tests for buildPrompt in tests/unit/prompt.test.ts covering:
  - Simple text field extraction with command prefix
  - Nested object field extraction returns JSON string
  - Array field extraction returns JSON string
  - Fallback string when field not found
  - Null/undefined payload handling

### Implementation for User Story 3

- [x] T019 [US3] Implement buildPrompt function in src/core/prompt.ts
- [x] T020 [US3] Export buildPrompt from src/core/index.ts
- [x] T021 [US3] Run tests: npx vitest tests/unit/prompt.test.ts — all tests should PASS

**Checkpoint**: buildPrompt function correctly formats agent prompts

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalization, coverage, linting, documentation

- [x] T022 [P] Run full test suite with coverage: npx vitest --coverage
- [x] T023 Configure ESLint/Prettier for consistent code style
- [x] T024 Update README.md with QuickStart from quickstart.md
- [x] T025 Run quickstart.md validation against implemented functions

---

## Phase 7: Integration Tests (Constitution Requirement V)

**Purpose**: Full end-to-end validation using testcontainers-node with Redpanda

- [x] T026 [P] Install testcontainers-node and redpanda dev dependencies
- [x] T027 [P] Create tests/integration/ directory structure
- [x] T028 Create integration test setup with Redpanda container startup/shutdown
- [x] T029 Write integration test for message ingestion → routing → OpenCode session → response flow
- [x] T030 Run integration test suite: npx vitest tests/integration/
- [x] T031 [P] Verify 90%+ coverage is achieved (fail if below threshold)
- [x] T032 Create .specify/docs/podman-setup.md with commands for configuring Podman socket for testcontainers:
   ```bash
   systemctl --user start podman.socket
   systemctl --user enable podman.socket
   export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
   ```
   Include CI/CD environment setup instructions

**Checkpoint**: Integration tests pass, 90%+ coverage verified

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — starts immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3-5 (User Stories)**: Depend on Phase 2 — can run in parallel with each other
- **Phase 6 (Polish)**: Depends on all user stories complete
- **Phase 7 (Integration Tests)**: Depends on Phase 6 complete — Constitution requirement V

### User Story Dependencies

- **US1 (parseConfig)**: Independent — no dependencies on other stories
- **US2 (matchRule)**: Independent — no dependencies on other stories
- **US3 (buildPrompt)**: Independent — no dependencies on other stories

All three user stories are independent and can be implemented in parallel after Phase 2 completes.

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD approach)
- Implementation completes when tests pass
- Story is complete when tests pass

---

## Parallel Execution Examples

### Example 1: All User Stories in Parallel (after Phase 2)

```bash
# Team member 1: US1 - parseConfig
npx vitest tests/unit/config.test.ts --run

# Team member 2: US2 - matchRule
npx vitest tests/unit/routing.test.ts --run

# Team member 3: US3 - buildPrompt
npx vitest tests/unit/prompt.test.ts --run
```

### Example 2: All Type Files in Parallel (Phase 2)

```bash
# Developer 1: Types
Task: "Create src/core/types.ts"

# Developer 2: Schemas
Task: "Create src/schemas/index.ts"
```

### Example 3: Integration Tests (Phase 7)

```bash
# Developer 1: Setup test infrastructure
Task: "Install testcontainers-node"
Task: "Create integration test directory"

# Developer 2: Create Podman setup documentation
Task: "Create podman-setup.md with socket configuration"

# Developer 3: Write e2e test
Task: "Create Redpanda container setup"
Task: "Write end-to-end integration test"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (BLOCKS all stories)
3. Complete Phase 3: User Story 1 (parseConfig)
4. **STOP and VALIDATE**: Test parseConfig independently
5. Deploy/demo if MVP scope is sufficient

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Complete Phase 6 Polish → Coverage, linting, documentation
6. Complete Phase 7 Integration Tests → Full e2e validation, 90%+ coverage verified (Constitution V)
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Phase 1 + Phase 2 together
2. Once Phase 2 is done (types + schemas):
   - Developer A: User Story 1 (parseConfig + tests)
   - Developer B: User Story 2 (matchRule + tests)
   - Developer C: User Story 3 (buildPrompt + tests)
3. Team completes Phase 6 (Polish) together
4. Team completes Phase 7 (Integration Tests) with Redpanda setup
5. Stories complete and integrate independently

---

## Task Summary

| Phase | Task Count | Key Deliverables |
|-------|-----------|------------------|
| Phase 1: Setup | 6 | package.json, dependencies, project structure |
| Phase 2: Foundational | 3 | types.ts, schemas/index.ts, exports |
| Phase 3: US1 | 4 | parseConfig function + tests |
| Phase 4: US2 | 4 | matchRule function + tests |
| Phase 5: US3 | 4 | buildPrompt function + tests |
| Phase 6: Polish | 4 | coverage, linting, documentation |
| Phase 7: Integration Tests | 7 | testcontainers-node, Redpanda, e2e tests, coverage verification, podman setup |
| **Total** | **32** | — |

### Task Count Per User Story

| User Story | Tasks | Description |
|------------|-------|-------------|
| US1 | 4 | parseConfig: tests + implementation |
| US2 | 4 | matchRule: tests + implementation |
| US3 | 4 | buildPrompt: tests + implementation |

### Parallel Opportunities Identified

- Phase 1: T002, T003, T004, T005 can run in parallel
- Phase 2: T007, T008 can run in parallel
- Phase 3-5: All three user stories can run in parallel after Phase 2
- Phase 7: T026, T027, T032 can run in parallel

### Independent Test Criteria

- **US1**: Valid JSON config → typed PluginConfig; Invalid JSON → ZodError
- **US2**: Test payload + rules → matched rule or null
- **US3**: Test payload + rule → prompt string with command prefix

### Suggested MVP Scope

**User Story 1 (parseConfig) only** — provides core validation that other stories depend on indirectly through shared schemas.

---

## Notes

- **[P]** tasks = different files, no dependencies
- **[Story]** label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests are **mandatory** per spec.md — TDD approach required by constitution
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently