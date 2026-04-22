# Feature Specification: Core Refinements — Type System & Primitive Handling

**Feature Branch**: `002-core-refinements`
**Created**: 2026-04-22
**Status**: Draft
**Predecessor**: [specs/001-kafka-router](../001-kafka-router/spec.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Единый источник истины для типов (Priority: P0)

Разработчик, расширяющий плагин, добавляет новое поле в `RuleSchema` и ожидает, что TypeScript-тип `Rule` автоматически обновится без ручных правок.

**Why this priority**: Устранение дублирования источников истины — фундаментальная проблема архитектуры. Два независимых места для одних данных приводят к рассинхронизации при любом изменении.

**Independent Test**: Можно полностью протестировать, удалив `types.ts` и проверив что `tsc` не выдает ошибок, а все типы берутся из Zod-схем.

**Acceptance Scenarios**:

1. **Given** поле `priority?: number` добавлено в `RuleSchema`, **When** разработчик импортирует `type Rule`, **Then** тип содержит `priority?: number` без изменений в `types.ts`
2. **Given** `types.ts` удалён, **When** проект собирается через `tsc`, **Then** компиляция проходит без ошибок — все типы берутся из `z.infer<>`
3. **Given** старый импорт `from '../core/types'`, **When** он заменяется на `from '../schemas'`, **Then** поведение идентично

---

### User Story 2 — Корректная обработка примитивов в `buildPrompt` (Priority: P1)

Оператор настраивает правило с `prompt_field: "$.task_id"`, где значение — число `42`. Агент должен получить промпт `"42"`, а не бессмысленный fallback.

**Why this priority**: Исправление дефекта в поведении, нарушающего принцип наименьшего удивления. Пользователи ожидают что числовые и булевы значения будут преобразованы в строковое представление.

**Independent Test**: Можно протестировать отдельно вызов `buildPrompt` с различными типами примитивов и проверить возвращаемое значение.

**Acceptance Scenarios**:

1. **Given** `payload = { task_id: 42 }` и `prompt_field: "$.task_id"`, **When** вызывается `buildPrompt`, **Then** возвращается `"42"`
2. **Given** `payload = { active: true }` и `prompt_field: "$.active"`, **When** вызывается `buildPrompt`, **Then** возвращается `"true"`
3. **Given** `payload = { active: false }` и `prompt_field: "$.active"`, **When** вызывается `buildPrompt`, **Then** возвращается `"false"` (не fallback!)
4. **Given** `rule.command = "check"` и примитив `42`, **When** вызывается `buildPrompt`, **Then** возвращается `"/check 42"`
5. **Given** `payload = { value: null }`, **When** вызывается `buildPrompt`, **Then** по-прежнему возвращается fallback `"Process this payload"` (null и undefined не считаются примитивными значениями)

---

### User Story 3 — Валидация согласованности топиков (Priority: P2)

Администратор случайно опечатался: написал `"securiti"` в `topics`, а правило привязал к `"security"`. Плагин должен поймать это при старте.

**Why this priority**: Предотвращение конфигурационных ошибок, которые сложно отладить в production. Опечатка в имени топика приводит к тому, что мониторинг не работает, а ошибка обнаруживается слишком поздно.

**Independent Test**: Можно протестировать отдельно функцию `parseConfig` с намеренно нарушенным конфигом и проверить выбрасываемую ошибку.

**Acceptance Scenarios**:

1. **Given** `topics: ["security"]` и `rules[0].topic = "security"`, **When** вызывается `parseConfig`, **Then** конфиг принимается
2. **Given** `topics: ["security", "audit"]` и все правила для `"security"`, **When** вызывается `parseConfig`, **Then** выбрасывается ошибка с сообщением о том, что топик `"audit"` не покрыт ни одним правилом
3. **Given** `topics: ["security"]` и правило для `"other-topic"`, **When** вызывается `parseConfig`, **Then** ошибка указывает на `"security"`

---

### Edge Cases

- `buildPrompt` с `BigInt` — не поддерживается `JSON.stringify`, должен конвертироваться через `String()`
- `buildPrompt` с `0` (number zero) — `"0"`, не fallback
- `buildPrompt` с пустой строкой `""` — пустая строка возвращается как есть (не fallback)
- `parseConfig` с топиком в `rules`, которого нет в `topics` — **не** является ошибкой. Проверяется только `topics → rules` (каждый топик из `topics` должен быть покрыт правилом). Правило для несуществующего в `topics` топика — допустимо (ignorable rule).

## Requirements *(mandatory)*

### Functional Requirements

**Рефакторинг типов:**

- **FR-012**: Файл `src/core/types.ts` должен быть удалён
- **FR-013**: Типы `Rule`, `PluginConfig`, `Payload` должны быть получены через `z.infer<typeof RuleSchema>` и `z.infer<typeof PluginConfigSchema>` и экспортироваться из `src/schemas/index.ts`
- **FR-014**: Все импорты типов в `src/core/`, `src/schemas/`, `src/index.ts`, `tests/` должны быть обновлены на `from '../schemas/index.js'` (или эквивалентный путь)

**Исправление `buildPrompt`:**

- **FR-015**: Значения типа `number`, `boolean`, `bigint` должны конвертироваться в строку через `String(extracted)` и возвращаться как результат (с префиксом команды если задан)
- **FR-016**: Пустая строка `""` возвращается как есть (не заменяется на fallback). Fallback применяется только при `null`, `undefined` и отсутствии поля в payload.

**Валидация согласованности:**

- **FR-017**: `parseConfig` после Zod-валидации должна выполнять дополнительную проверку: каждый топик из `config.topics` должен встречаться хотя бы в одном правиле `config.rules[i].topic`
- **FR-018**: При нарушении FR-017 выбрасывается `Error` (не `ZodError`) с сообщением вида: `"Topics without rules: audit, metrics"` — перечислением непокрытых топиков

### Non-Functional Requirements

- **NFR-001**: Количество строк в `src/schemas/index.ts` увеличивается (типы переезжают туда), но логика остаётся сфокусированной — только схемы и производные типы
- **NFR-002**: Все существующие тесты продолжают проходить без изменений

### Key Entities

- **Rule**: Правило маршрутизации сообщений. Содержит `name`, `topic`, `agent`, `condition`, `command`, `prompt_field`. Определяется через `RuleSchema`.
- **PluginConfig**: Корневая конфигурация плагина. Содержит `topics` (список мониторимых топиков) и `rules` (список правил маршрутизации). Определяется через `PluginConfigSchema`.
- **Payload**: JSON-объект сообщения из Kafka. Тип — произвольный объект.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-008**: `z.infer<typeof RuleSchema>` и ручной интерфейс `Rule` дают идентичные типы (проверяется через ts-expect-error или ExpectType из @tsd)
- **SC-009**: `buildPrompt({ count: 0 }, rule)` возвращает `"0"`, не fallback (проверяется unit-тестом)
- **SC-010**: `parseConfig` с `topics: ["a", "b"]` и правилами только для `"a"` выбрасывает ошибку `"Topics without rules: b"` (проверяется unit-тестом)
- **SC-011**: `npm test` показывает ≥ 90% coverage по итогам всех изменений (проверяется через coverage report)

## Assumptions

- Существующие тесты покрывают базовое поведение `buildPrompt` и `parseConfig`
- Zod-схемы в `src/schemas/index.ts` полностью описывают структуру данных
- Удаление `types.ts` не нарушит работу других частей системы, если все импорты обновлены
