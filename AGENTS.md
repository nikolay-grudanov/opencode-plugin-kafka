# opencode-plugin-kafka Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-22

## Active Technologies

- TypeScript 5.x + `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing) (001-new-specification)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x: Follow standard conventions

## Recent Changes

- 001-new-specification: Added TypeScript 5.x + `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing)

<!-- MANUAL ADDITIONS START -->
## Checklists

- **podman.md** (Phase 7 only): Podman setup requirements для Integration Tests. Игнорировать до Phase 7.

## Phase Execution

- **Phase 1-6**: Выполнять без проверки podman.md
- **Phase 7**: Проверить podman.md перед Integration Tests
<!-- MANUAL ADDITIONS END -->
