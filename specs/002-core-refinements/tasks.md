# Tasks: 002-core-refinements — Type System & Primitive Handling

**Input**: Design documents from `/specs/002-core-refinements/`
**Prerequisites**: plan.md, spec.md, data-model.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Project Verification)

**Purpose**: Verify current state before modifications

- [X] T001 Verify current project structure and test baseline in src/schemas/index.ts, src/core/types.ts
- [X] T002 [P] Run existing test suite: `npm test` to establish baseline
- [X] T003 [P] Verify TypeScript compilation: `npx tsc --noEmit`

---

## Phase 2: User Story 1 — Единый источник истины для типов (Priority: P0) 🎯 MVP

**Goal**: Типы Rule, PluginConfig, Payload экспортируются из schemas/index.ts через z.infer<>, types.ts удалён

**Independent Test**: Удалить types.ts, запустить tsc --noEmit — ошибок быть не должно

### Implementation for User Story 1

- [ ] T004 [US1] Add type exports to src/schemas/index.ts: `export type Rule = z.infer<typeof RuleSchema>`
- [ ] T005 [US1] Add type exports to src/schemas/index.ts: `export type PluginConfig = z.infer<typeof PluginConfigSchema>`
- [ ] T006 [US1] Add type exports to src/schemas/index.ts: `export type Payload = unknown`
- [ ] T007 [US1] Remove re-export from types.ts in src/schemas/index.ts
- [ ] T008 [P] [US1] Add TypeScript-comparison test to verify z.infer<> types are identical to manual types using ExpectType from @tsd (SC-008)
- [ ] T009 [P] [US1] Update imports in src/core/config.ts: `from './types.js'` → `from '../schemas/index.js'`
- [ ] T010 [P] [US1] Update imports in src/core/prompt.ts: `from './types.js'` → `from '../schemas/index.js'`
- [ ] T011 [P] [US1] Update imports in src/core/routing.ts (find all type imports)
- [ ] T012 [P] [US1] Update imports in src/index.ts (find all type imports)
- [ ] T013 [P] [US1] Update imports in tests/ (find all imports from '../core/types' or '../../core/types')
- [ ] T014 [US1] Verify TypeScript compilation: `npx tsc --noEmit` — должны пройти без ошибок
- [ ] T015 [US1] Run tests to verify no regressions: `npm test`
- [ ] T016 [US1] Delete src/core/types.ts (FR-012)

**Checkpoint**: US1 complete — types.ts удалён, все типы из schemas, tsc проходит, тесты проходят

---

## Phase 3: User Story 2 — Корректная обработка примитивов в buildPrompt (Priority: P1)

**Goal**: buildPrompt возвращает строковое представление для number, boolean, bigint

**Independent Test**: `buildPrompt({ count: 0 }, rule)` возвращает `"0"`, не fallback

### Implementation for User Story 2

- [ ] T017 [P] [US2] Add unit tests for buildPrompt primitives in tests/unit/prompt.test.ts
  - Test: number 42 → "42"
  - Test: number 0 → "0"
  - Test: boolean true → "true"
  - Test: boolean false → "false"
  - Test: BigInt → "42"
  - Test: empty string "" → ""
  - Test: null → fallback
- [ ] T018 [US2] Fix src/core/prompt.ts: change primitive handling from fallback to String(extracted)
  - Lines 59-62: replace `return FALLBACK_PROMPT` with string conversion for number/boolean/bigint
- [ ] T019 [US2] Run unit tests: `npm test -- tests/unit/prompt.test.ts` — verify all pass
- [ ] T020 [US2] Run full test suite: `npm test` — verify no regressions

**Checkpoint**: US2 complete — buildPrompt корректно обрабатывает примитивы, все тесты проходят

---

## Phase 4: User Story 3 — Валидация согласованности топиков (Priority: P2)

**Goal**: parseConfig проверяет покрытие топиков правилами при старте

**Independent Test**: parseConfig с topics: ["a", "b"] и правилами только для "a" выбрасывает Error "Topics without rules: b"

### Implementation for User Story 3

- [ ] T021 [P] [US3] Add unit tests for topic coverage validation in tests/unit/config.test.ts
  - Test: topics ["a"] with rule for "a" → no error
  - Test: topics ["a", "b"] with rule only for "a" → Error "Topics without rules: b"
  - Test: topics ["security"] with rule for "other-topic" → Error "Topics without rules: security"
- [ ] T022 [US3] Implement topic coverage check in src/core/config.ts after Zod validation
  - Add Set creation from rules.map(r => r.topic)
  - Filter config.topics for uncovered topics
  - Throw Error with "Topics without rules: ..." message if uncovered exist
- [ ] T023 [US3] Run unit tests: `npm test -- tests/unit/config.test.ts` — verify all pass
- [ ] T024 [US3] Run full test suite: `npm test` — verify no regressions

**Checkpoint**: US3 complete — parseConfig валидирует покрытие топиков, все тесты проходят

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and documentation

- [ ] T025 [P] Run full test suite with coverage: `npm test -- --coverage`
- [ ] T026 [P] Verify ≥ 90% coverage on routing and parsing logic (SC-011)
- [ ] T027 Update quickstart.md if needed for type import changes (not needed — quickstart.md already reflects all changes)
- [ ] T028 Run `npm test` — final verification all tests pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **User Story 1 (Phase 2)**: Depends on Setup — foundational for all subsequent work
- **User Story 2 (Phase 3)**: Depends on US1 completion (types must be in schemas before fixing buildPrompt)
- **User Story 3 (Phase 4)**: Depends on US1 completion (types must be in schemas before adding validation)
- **Polish (Phase 5)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P0)**: Must complete first — types refactoring is foundational
- **US2 (P1)**: Can start after US1 — no dependencies on US3
- **US3 (P2)**: Can start after US1 — no dependencies on US2
- **US2 and US3 are independent** — can run in parallel after US1

### Within Each User Story

- Tests (if included) should be written first and fail before implementation
- US1: Schema changes before deleting types.ts
- US2: Tests → implementation → verify
- US3: Tests → implementation → verify

### Parallel Opportunities

- T002, T003 can run in parallel (Setup)
- T004, T005, T006 can run in parallel (add type exports)
- T008, T009, T010, T011, T012, T013 can run in parallel (add tests and update imports)
- T017, T021 can run in parallel (add tests for US2 and US3)
- US2 and US3 can be implemented in parallel after US1

---

## Parallel Example: US2 + US3

After US1 is complete, these can run in parallel:

```bash
# US2 implementation
Task: T017 - "Add unit tests for buildPrompt primitives"
Task: T018 - "Fix primitive handling in prompt.ts"

# US3 implementation
Task: T021 - "Add unit tests for topic coverage validation"
Task: T022 - "Implement topic coverage check in config.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (verify baseline)
2. Complete Phase 2: US1 (types refactoring)
3. **STOP and VALIDATE**: tsc --noEmit passes, npm test passes
4. Deploy/demo if ready

### Incremental Delivery

1. Complete US1 → Verify types refactored correctly → Deploy/Demo
2. Add US2 → Verify buildPrompt fixes → Deploy/Demo
3. Add US3 → Verify topic validation → Deploy/Demo
4. Polish → Final verification → Release

---

## Summary

| Metric | Value |
|--------|-------|
| **Total Tasks** | 28 |
| **User Story 1 Tasks** | 13 |
| **User Story 2 Tasks** | 4 |
| **User Story 3 Tasks** | 4 |
| **Setup/Polish Tasks** | 7 |
| **Parallelizable Tasks** | 13 |
| **MVP Scope** | US1 only (13 tasks) |

### Independent Test Criteria per Story

- **US1**: tsc --noEmit succeeds after deleting types.ts
- **US2**: buildPrompt({ count: 0 }, rule) returns "0", not fallback
- **US3**: parseConfig({ topics: ["a", "b"], rules: [{ topic: "a", ... }] }) throws Error "Topics without rules: b"

### Format Validation

- [x] All tasks follow checklist format: `- [ ] [ID] [P?] [Story?] Description`
- [x] All task IDs are sequential (T001-T028)
- [x] [P] marker included for parallelizable tasks
- [x] [US1], [US2], [US3] labels included for user story tasks
- [x] All file paths are exact and absolute
- [x] No setup/foundational tasks have story labels (Phase 1, Phase 5)
