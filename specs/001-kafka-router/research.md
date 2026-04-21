# Research: Kafka Router Plugin Core

**Feature**: 001-kafka-router
**Date**: 2026-04-21
**Status**: ✅ COMPLETED

## Decisions Made

### 1. Zod vs Ajv vs Yup

**Decision**: Zod

**Rationale**:
- Runtime validation с TypeScript type inference из одного source of truth
- Структурная типизация:infer<typeof Schema> для автоматической генерации типов
- Понятные error messages с path к ошибке
- Компактный API: z.object(), z.string(), z.array()

**Alternatives Considered**:
- **Ajv**: Требует separate JSON Schema + TypeScript types (дублирование)
- **Yup**: No TypeScript inference by default, validation functions не TypeScript-friendly

### 2. JSONPath Library

**Decision**: jsonpath-plus

**Rationale**:
- Активная поддержка (jsonpath последний commit 2019)
- Полная совместимость с JSONPath спецификацией
- TypeScript definitions included
- Tree-shakeable

**Alternatives Considered**:
- **jsonpath** (original): Не поддерживается, last commit 2019, множество issues
- **jsonpath皎**: Зависимость от npm dependencies
- **JSONPath**: Similar issues to original jsonpath

### 3. Test Framework

**Decision**: Vitest

**Rationale**:
- Совместим с Jest API (меньше переписывания при миграции)
- Быстрый startup (esbuild)
- Native ESM support
- TypeScript native support

**Alternatives Considered**:
- **Jest**: Тяжёлый startup, slower than vitest
- **Mocha**: Requires manual setup for TypeScript
- **tap**: Less ergonomic API

## Dependencies Verified

| Package | Version | Purpose | Verified |
|---------|---------|---------|----------|
| zod | ^3.22 | Runtime validation | ✅ |
| jsonpath-plus | ^10 | JSONPath queries | ✅ |
| vitest | ^2 | Testing framework | ✅ |

## Architecture Decisions

### Pure Functions Design

All core functions are pure functions with no side effects:

```typescript
parseConfig(raw: unknown): PluginConfig  // throws on invalid
matchRule(payload: unknown, topic: string, rules: Rule[]): Rule | null
buildPrompt(payload: unknown, rule: Rule): string
```

### No External Dependencies in Core

Core имеет только 2 dependencies: zod, jsonpath-plus. Это позволяет:
- Тестировать без mocking
- 100% code coverage
- Fast test execution

## Open Questions

| Question | Resolution | Status |
|----------|------------|--------|
| Default value for `prompt_field` | "$" (root) согласно spec.md FR-005 | ✅ Resolved |
| JSONPath syntax для условий | Standard JSONPath Plus syntax | ✅ Resolved |
| Multiple rules per topic | First-match wins (spec.md FR-007) | ✅ Resolved |