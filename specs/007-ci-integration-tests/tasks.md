# Tasks: CI Integration Tests Pipeline

**Input**: Design documents from `/specs/007-ci-integration-tests/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ❌ (нет сущностей), contracts/ ❌ (нет интерфейсов), research.md ❌ (нет неизвестных)

**Tests**: Тесты не требуются — фича добавляет CI pipeline job для запуска СУЩЕСТВУЮЩИХ integration-тестов. Новых тестов не создаётся.

**Organization**: Задачи сгруппированы по user story. US2 и US3 реализуются в рамках US1 (единый YAML-блок job `integration`) — отдельные фазы для них не требуются.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Можно выполнять параллельно (разные файлы, нет зависимостей)
- **[Story]**: User story, к которой относится задача (US1, US2, US3)
- Указаны точные пути к файлам

---

## Phase 1: Setup

**Purpose**: Проверка prerequisites перед реализацией

- [ ] T001 Verify `test:integration` script exists in `package.json` — confirm `"test:integration": "vitest run --config vitest.integration.config.ts"` is present. If missing, add it.

---

## Phase 2: User Story 1 — Integration-тесты запускаются при каждом PR (Priority: P1) 🎯 MVP

**Goal**: Разработчик видит результаты integration-тестов в PR checks автоматически

**Independent Test**: Создать PR и убедиться, что job `integration` запустился, прошёл и отобразился в PR checks

**Note**: User Story 2 (параллельное выполнение) и User Story 3 (таймаут) реализуются в рамках этой же фазы — они являются атрибутами единого YAML-блока job `integration`.

### Implementation for User Story 1 (+ US2, US3)

- [ ] T002 [US1][US2][US3] Add `integration` job to `.github/workflows/ci.yml` after the existing `ci` job with: `runs-on: ubuntu-latest`, `timeout-minutes: 15`, no `needs` dependency (parallel), steps: checkout@`11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2) → setup-node@`49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0) with `node-version: 20` and `cache: 'npm'` → `npm ci` → `npm run test:integration`
- [ ] T003 [US1] Replace obsolete TODO comment (3 lines about container runtime and self-hosted runner) above the `Test` step in the `ci` job in `.github/workflows/ci.yml` with: `# Unit tests only — integration tests run in the separate 'integration' job`

**Checkpoint**: В `ci.yml` два job: `ci` (unit + lint + build) и `integration` (Redpanda testcontainers). Оба запускаются параллельно. Integration job имеет `timeout-minutes: 15`. Pinned SHA совпадают.

---

## Phase 3: Validation & Polish

**Purpose**: Проверка корректности реализации и прогон project checks

- [ ] T004 Validate `.github/workflows/ci.yml` structure: 2 jobs (`ci` + `integration`), same pinned SHA, no `needs` in integration job, `timeout-minutes: 15` present, triggers unchanged, obsolete comment removed
- [ ] T005 Run project validation: `npm run lint`, `npm run typecheck`, `npm run build` — all pass without errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1 MVP)**: Depends on Phase 1 (T001 confirms script exists)
- **Phase 3 (Validation)**: Depends on Phase 2 (T002, T003 must be complete)

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 1 — core implementation
- **US2 (P2)**: Co-implemented with US1 (no `needs` in job = parallel execution) — no separate task
- **US3 (P3)**: Co-implemented with US1 (`timeout-minutes: 15` in job) — no separate task

### Parallel Opportunities

- T002 and T003 modify the same file (`ci.yml`) — execute sequentially
- No parallel opportunities within this feature (single-file change)

---

## Parallel Example: Phase 2

```bash
# Sequential — both modify ci.yml:
Task T002: "Add integration job to .github/workflows/ci.yml"
Task T003: "Replace obsolete comment in ci job in .github/workflows/ci.yml"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Verify `test:integration` script exists (T001)
2. Complete Phase 2: Add integration job + update comment (T002, T003)
3. **STOP and VALIDATE**: Check Phase 3 criteria (T004)
4. Run project checks (T005)
5. Push branch and create PR — verify integration job runs in CI

### Incremental Delivery

This feature is a single atomic change — no incremental delivery needed. All user stories are satisfied by one YAML modification.

### Total Tasks: 5

| Phase | Tasks | User Stories |
|-------|-------|-------------|
| Phase 1: Setup | T001 | — |
| Phase 2: US1 MVP | T002, T003 | US1, US2, US3 |
| Phase 3: Validation | T004, T005 | — |

---

## Notes

- This is a configuration-only change — no source code modifications
- `test:integration` script already exists in `package.json` (confirmed during spec creation)
- `vitest.integration.config.ts` already configured correctly — no changes needed
- Integration tests use `@testcontainers/redpanda` which works automatically on `ubuntu-latest`
- Graceful degradation: if Docker unavailable, tests skip (not fail) — but Docker is always available on `ubuntu-latest`
- Concurrency group already configured in ci.yml — no changes needed