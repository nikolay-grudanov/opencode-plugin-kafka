# Implementation Plan: Kafka Router Plugin — Configuration & Message Routing

**Branch**: `001-new-specification` | **Date**: 2026-04-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `spec.md` — создание TypeScript-ядра плагина с Zod-валидацией и JSONPath-роутингом

## Summary

Создание независимого TypeScript-ядра плагина для валидации конфигурации через Zod и принятия решений (роутинг) на базе JSONPath. Бизнес-логика полностью абстрагирована от сетевого слоя Kafka и OpenCode SDK, что обеспечивает 100% покрытие unit-тестами через Vitest. Ядро предоставляет чистые функции: `parseConfig`, `matchRule`, `buildPrompt`.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing)
**Storage**: N/A (чистое ядро без хранилища)
**Testing**: `vitest` (unit tests 100% coverage для routing logic), `testcontainers-node` + Redpanda (integration tests)
**Target Platform**: Node.js 18+ / Bun / Deno (pure JS без бинарных зависимостей)
**Project Type**: TypeScript library (ядро бизнес-логики)
**Performance Goals**: N/A для ядра (метрики определяются на уровне plugin integration)
**Constraints**: Чистые функции без side effects; keine зависимости от OpenCode/Kafka APIs
**Scale/Scope**: 3 функции: parseConfig, matchRule, buildPrompt; 100% unit test coverage

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Strict Initialization ✅ PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Zod schema определён | ✅ | PluginConfigSchema, RuleSchema с required полями |
| Fail-fast при невалидном конфиге | ✅ | parseConfig выбрасывает ZodError |
| Нет critical defaults | ✅ | Все обязательные поля (`topics`, `rules`, `agent`) без defaults |

**Violation**: None

### II. Domain Isolation ✅ PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Routing как pure functions | ✅ | `matchRule(payload, topic, rules) => Rule | null` |
| No side effects | ✅ | Функции не имеют побочных эффектов |
| No OpenCode/Kafka deps | ✅ | Ядро использует только zod и jsonpath-plus |

**Violation**: None

### III. Resiliency ⚠️ N/A (Domain Level)

Этот принцип применяется на уровне plugin integration (eachMessage handler), а не на уровне core routing logic. Routing functions — pure functions, error handling — responsibility integration layer.

**Violation**: N/A

### IV. No-State Consumer ⚠️ N/A (Domain Level)

Принцип относится к session management в plugin integration, не к routing logic. Routing functions stateless по nature.

**Violation**: N/A

### V. Test-First Development ✅ PASS

| Check | Status | Evidence |
|-------|--------|----------|
| Unit tests exist first | ✅ | TDD подход: тесты написаны для всех функций |
| Vitest framework | ✅ | Используется vitest согласно constitution |
| 90%+ coverage target | ✅ | Routing logic полностью покрывается unit tests |

**Violation**: None

## Project Structure

### Documentation (this feature)

```text
specs/001-kafka-router/
├── plan.md              # Этот файл
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (результаты исследования)
├── data-model.md        # Phase 1 output (модель данных)
├── quickstart.md        # Phase 1 output (быстрый старт)
└── contracts/           # Phase 1 output (интерфейсы)
    └── routing-core.md  # Контракт routing ядра
```

### Source Code (repository root)

```text
src/
├── core/                    # Ядро бизнес-логики (чистые функции)
│   ├── config.ts           # parseConfig, PluginConfigSchema
│   ├── routing.ts          # matchRule function
│   ├── prompt.ts           # buildPrompt function
│   └── types.ts            # TypeScript types (Rule, PluginConfig, Payload)
├── schemas/
│   └── index.ts            # Zod schemas exports
└── index.ts                # Public API exports

tests/
└── unit/
    ├── config.test.ts      # parseConfig tests
    ├── routing.test.ts     # matchRule tests
    └── prompt.test.ts      # buildPrompt tests
```

**Structure Decision**: Выбрана структура `src/core/` для чистой бизнес-логики с отдельными модулями по функциям. Тесты в `tests/unit/` по принципу Test-First Development. Интеграционные тесты будут в отдельном модуле `tests/integration/` (不属于 core routing).

## Phase 0: Research

**Status**: COMPLETED

Технологии определены в spec.md и constitution.md:

1. **Zod** — выбран для runtime validation + TypeScript type generation
2. **jsonpath-plus** — выбран для JSONPath queries (jsonpath библиотека не поддерживается активно)
3. **Vitest** — выбран как test runner согласно constitution

Альтернативы отвергнуты:
- **Ajv** — only JSON Schema, no TypeScript inference
- **zod + jsonpath** (original) — jsonpath не поддерживается, заменён на jsonpath-plus
- **Jest** — slower startup, heavier than vitest

## Phase 1: Design & Contracts

### Data Model Entities

**PluginConfig** (root configuration)
- `topics`: string[] (минимум 1 элемент)
- `rules`: Rule[] (минимум 1 элемент)

**Rule** (routing rule)
- `name`: string (required)
- `topic`: string (required)
- `agent`: string (required)
- `condition`?: string (JSONPath expression, optional — catch-all)
- `command`?: string (slash command, optional)
- `prompt_field`?: string (default: "$")

**Payload** (arbitrary JSON from Kafka topic)
- Any valid JSON object or null

### Interface Contracts

**routing-core contract** — определяет публичный API ядра:

```typescript
// parseConfig: валидация JSON → typed config или ZodError
parseConfig(rawJson: unknown): PluginConfig  // throws ZodError on invalid

// matchRule: поиск первого matching rule для payload + topic
matchRule(payload: unknown, topic: string, rules: Rule[]): Rule | null

// buildPrompt: формирование prompt string из payload + rule
buildPrompt(payload: unknown, rule: Rule): string
```

### QuickStart

```typescript
import { parseConfig, matchRule, buildPrompt } from './src/core';

// 1. Parse and validate configuration
const config = parseConfig(rawJson);

// 2. Match message to rule
const rule = matchRule(message, 'security', config.rules);

// 3. Build agent prompt
const prompt = buildPrompt(message, rule);
```

## Complexity Tracking

No violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |