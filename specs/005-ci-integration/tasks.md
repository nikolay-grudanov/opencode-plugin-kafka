---

description: "Task list for CI/CD Pipeline and Integration Tests feature"
---

# Tasks: CI/CD Pipeline and Integration Tests

**Input**: Design documents from `/specs/005-ci-integration/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md

**Tests**: Tests are MANDATORY for this feature - integration tests are the primary deliverable (US2)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create CI/CD and integration test infrastructure

- [x] T001 [P] Create GitHub Actions workflow in .github/workflows/ci.yml
- [x] T002 [P] Create vitest integration test config in vitest.integration.config.ts
- [x] T003 [P] Create testcontainers configuration in .testcontainers.properties

---

## Phase 2: User Story 1 - Automated Code Quality Checks (Priority: P1) 🎯 MVP

**Goal**: All code changes automatically validated through lint → type check → unit tests → build

**Independent Test**: Push to main branch and verify CI pipeline runs and reports pass/fail status

### Implementation for User Story 1

- [x] T004 [US1] Configure CI workflow with sequential steps: lint → type check → tests → build in .github/workflows/ci.yml
- [x] T005 [US1] Add PR validation with clear pass/fail status check in .github/workflows/ci.yml

**Checkpoint**: User Story 1 should be fully functional - code changes trigger automated validation

---

## Phase 3: User Story 2 - Integration Testing with Real Message Broker (Priority: P1) 🎯 MVP

**Goal**: Integration tests run against real Redpanda container automatically

**Independent Test**: Run `npx vitest run --config vitest.integration.config.ts` and verify Redpanda starts and tests execute

### Tests for User Story 2

> **NOTE: Write tests first - ensure they fail before implementation**

- [x] T006 [US2] Create integration test for Redpanda container startup in tests/integration/consumer.integration.test.ts
- [x] T007 [US2] Create integration test for basic message production/consumption in tests/integration/consumer.integration.test.ts
- [x] T008 [US2] Create integration test for container cleanup after tests in tests/integration/consumer.integration.test.ts

**Checkpoint**: User Story 2 should be fully functional - integration tests run with real broker

---

## Phase 4: User Story 3 - Sequential Message Processing Validation (Priority: P2)

**Goal**: Messages processed sequentially and in order

**Independent Test**: Produce 5 messages and verify they are consumed in exact order

### Tests for User Story 3

- [x] T009 [US3] Create integration test for sequential message ordering in tests/integration/consumer.integration.test.ts

**Checkpoint**: User Story 3 should be fully functional - message ordering verified

---

## Phase 5: User Story 4 - Error Handling and Dead Letter Queue (Priority: P2)

**Goal**: Invalid messages sent to DLQ without crashing consumer

**Independent Test**: Produce invalid JSON, oversized message, and unmatched message - verify all handled gracefully

### Tests for User Story 4

- [x] T010 [US4] Create integration test for invalid JSON handling and DLQ routing in tests/integration/consumer.integration.test.ts
- [x] T011 [US4] Create integration test for oversized message handling and DLQ routing in tests/integration/consumer.integration.test.ts
- [x] T012 [US4] Create integration test for unmatched message handling (skip gracefully) in tests/integration/consumer.integration.test.ts

**Checkpoint**: User Story 4 should be fully functional - error handling verified

---

## Phase 6: User Story 5 - Graceful Shutdown Validation (Priority: P3)

**Goal**: Consumer shuts down cleanly within 15 seconds

**Independent Test**: Send shutdown signal and verify clean disconnect with no unhandled errors

### Tests for User Story 5

- [x] T013 [US5] Create integration test for graceful shutdown completion in tests/integration/consumer.integration.test.ts
- [x] T014 [US5] Create integration test for shutdown without unhandled errors in tests/integration/consumer.integration.test.ts

**Checkpoint**: User Story 5 should be fully functional - shutdown verified

---

## Phase 7: Documentation (Polish)

**Purpose**: Developer documentation for running integration tests

- [x] T015 [P] Create or update DEVELOPMENT.md with integration test instructions
- [x] T016 [P] Document test scenarios and acceptance criteria in tests/integration/consumer.integration.test.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **User Stories (Phase 2-6)**: All depend on Setup completion (T001, T002, T003)
  - User stories proceed in priority order (P1 → P2 → P3)

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Setup - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Setup - BLOCKS US3, US4, US5 (depends on container setup)
- **User Story 3 (P2)**: Can start after US2 - Depends on working container integration
- **User Story 4 (P2)**: Can start after US2 - Depends on working container integration
- **User Story 5 (P3)**: Can start after US2 - Depends on working container integration

### Within Each User Story

- Write tests first - ensure they fail before implementation
- Complete each story before moving to next

### Parallel Opportunities

- T001, T002, T003 can run in parallel (different infrastructure files)
- T006, T007, T008 can run in parallel (different test scenarios in same file)
- T010, T011, T012 can run in parallel (different error scenarios in same file)
- T015, T016 can run in parallel (different documentation files)

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (T001, T002, T003)
2. Complete Phase 2: User Story 1 (T004, T005) - CI/CD pipeline
3. Complete Phase 3: User Story 2 (T006, T007, T008) - Integration tests foundation
4. **STOP and VALIDATE**: Verify CI works and integration tests run with real broker

### Incremental Delivery

1. Complete Setup + User Story 1 → CI/CD pipeline working
2. Add User Story 2 → Integration tests foundation (MVP!)
3. Add User Story 3 → Sequential ordering verified
4. Add User Story 4 → Error handling verified
5. Add User Story 5 → Shutdown verified

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Write tests first - verify they fail before implementing
- Commit after each task or logical group
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence