# Implementation Plan: 002-core-refinements — Type System & Primitive Handling

**Branch**: `002-core-refinements` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)

## Summary

Рефакторинг трёх ключевых компонентов плагина:
1. **Удаление дублирующих типов**: Переход на `z.infer<>` из Zod-схем как единый источник истины
2. **Исправление `buildPrompt`**: Корректная обработка примитивов (number, boolean, bigint) вместо fallback
3. **Валидация конфигурации**: Добавление проверки покрытия топиков правилами при старте

## Technical Context

| Field | Value | Source |
|-------|-------|--------|
| **Language/Version** | TypeScript 5.x | AGENTS.md, конституция |
| **Primary Dependencies** | zod, jsonpath-plus, vitest | AGENTS.md, конституция |
| **Storage** | N/A (JSON config file) | spec.md |
| **Testing** | vitest + testcontainers-node + Redpanda | конституция V |
| **Target Platform** | Node.js / OpenCode agent environment | конституция |
| **Project Type** | OpenCode plugin (библиотека) | spec.md |
| **Performance Goals** | N/A (библиотека для агента) | — |
| **Constraints** | N/A (нет жестких ограничений) | — |
| **Scale/Scope** | N/A (библиотека, не пользовательское приложение) | — |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict Initialization | ✅ PASS | FR-017/FR-018 добавляют валидацию конфигурации при старте |
| II. Domain Isolation | ✅ PASS | buildPrompt — чистая функция парсинга, отделена от OpenCode интеграции |
| III. Resiliency | ✅ PASS | Изменения не затрагивают обработку ошибок в eachMessage |
| IV. No-State Consumer | ✅ PASS | Нет изменений в stateful логику |
| V. Test-First Development | ✅ PASS | FR требует написать unit-тесты для всех изменений |

**Gate Status**: ✅ PASS — можно продолжать

## Project Structure

### Documentation (this feature)

```text
specs/002-core-refinements/
├── plan.md              # Этот файл
├── spec.md              # Feature specification
├── data-model.md        # Phase 1: Модель данных через Zod
└── quickstart.md        # Phase 1: Обновлённая документация
```

### Source Code (repository root)

```text
src/
├── schemas/
│   └── index.ts         # RuleSchema, PluginConfigSchema, типы через z.infer<>
├── core/
│   ├── config.ts        # parseConfig с валидацией покрытия топиков
│   ├── prompt.ts        # buildPrompt с корректной обработкой примитивов
│   └── routing.ts       # routing logic (без изменений)
├── index.ts             # Public exports (обновить импорты)
└── types.ts             # REMOVE (FR-012)

tests/
├── unit/
│   ├── prompt.test.ts   # Обновить тесты buildPrompt
│   └── config.test.ts   # Добавить тесты валидации топиков
└── integration/         # testcontainers + Redpanda

```

**Structure Decision**: Одноэлементный проект (OpenCode plugin library). Структура не меняется, только обновляются импорты и удаляется types.ts.

## Phase 0: Research

**Статус**: Не требуется — технологии определены конституцией (TypeScript 5.x, zod, vitest)

## Phase 1: Design & Contracts

### data-model.md

См. артефакт `data-model.md` в этом каталоге.

### contracts/

Не применимо — плагин не экспортирует внешних API. Единственный публичный интерфейс — функция `parseConfig` которая принимает `unknown` и возвращает `PluginConfig`.

### quickstart.md

Обновлённая документация по использованию типов из schemas.

## Implementation Notes

### FR-012, FR-013, FR-014: Рефакторинг типов

Текущая ситуация:
- `src/core/types.ts` содержит интерфейсы `Rule`, `PluginConfig`, `Payload`
- `src/schemas/index.ts` содержит `RuleSchema`, `PluginConfigSchema` и реэкспортирует типы из `types.ts`

Цель: Типы экспортируются из `schemas/index.ts` через `z.infer<typeof RuleSchema>` и `z.infer<typeof PluginConfigSchema>`.

План:
1. Добавить `export type Rule = z.infer<typeof RuleSchema>` в schemas/index.ts
2. Добавить `export type PluginConfig = z.infer<typeof PluginConfigSchema>` в schemas/index.ts
3. Удалить реэкспорт из types.ts в schemas/index.ts
4. Обновить все импорты: `from '../core/types'` → `from '../schemas'`
5. Удалить src/core/types.ts

### FR-015, FR-016: Исправление buildPrompt

Текущая ситуация (prompt.ts строки 59-62):
```typescript
} else {
  // Примитивные типы (number, boolean, etc) → fallback
  return FALLBACK_PROMPT;
}
```

Требуется:
- number, boolean, bigint → `String(extracted)`
- Пустая строка `""` → возвращается как есть
- null, undefined → fallback

### FR-017, FR-018: Валидация покрытия топиков

После `PluginConfigSchema.parse(rawJson)` добавить:
```typescript
const coveredTopics = new Set(config.rules.map(r => r.topic));
const uncovered = config.topics.filter(t => !coveredTopics.has(t));
if (uncovered.length > 0) {
  throw new Error(`Topics without rules: ${uncovered.join(', ')}`);
}
```

## Complexity Tracking

> Не требуется — отклонений от конституции нет

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
