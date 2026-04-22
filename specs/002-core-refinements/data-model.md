# Data Model: 002-core-refinements

## Overview

Модель данных построена на Zod-схемах как едином источнике истины для типов и валидации.

## Core Entities

### Rule

Правило маршрутизации сообщений из Kafka topic.

```typescript
// Импорт: import type { Rule } from '../schemas/index.js';

export const RuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  topic: z.string().min(1, 'Topic is required'),
  agent: z.string().min(1, 'Agent is required'),
  condition: z.string().optional(),
  command: z.string().optional(),
  prompt_field: z.string().default('$'),
});

export type Rule = z.infer<typeof RuleSchema>;
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Уникальное имя правила |
| `topic` | `string` | ✅ | Kafka topic для применения правила |
| `agent` | `string` | ✅ | Agent ID для обработки сообщений |
| `condition` | `string` | ❌ | JSONPath expression для фильтрации |
| `command` | `string` | ❌ | Slash command для агента (например, `/check`) |
| `prompt_field` | `string` | ❌ | JSONPath field для извлечения текста (по умолчанию `$`) |

**Derived Type**: `Rule` получается через `z.infer<typeof RuleSchema>` — это гарантирует синхронизацию между runtime валидацией и TypeScript типами.

---

### PluginConfig

Корневой объект конфигурации плагина.

```typescript
// Импорт: import type { PluginConfig } from '../schemas/index.js';

export const PluginConfigSchema = z.object({
  topics: z.array(z.string()).min(1, 'At least one topic required'),
  rules: z.array(RuleSchema).min(1, 'At least one rule required'),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;
```

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topics` | `string[]` | ✅ | Kafka topics для мониторинга (минимум 1) |
| `rules` | `Rule[]` | ✅ | Routing rules (минимум 1) |

**Constraint**: FR-017 требует, чтобы каждый топик из `topics` был покрыт хотя бы одним правилом (`config.rules[i].topic === topic`). Это проверяется в `parseConfig` после Zod-валидации.

---

### Payload

Произвольный JSON-объект сообщения из Kafka topic.

```typescript
// Импорт: import type { Payload } from '../schemas/index.js';

export type Payload = unknown;
```

**Design Rationale**: Тип `unknown` используется намеренно, так как структура payload определяется внешними продюсерами и не может быть ограничена схемой. Runtime валидация выполняется через JSONPath queries в `buildPrompt`.

---

## Relationships

```
PluginConfig
├── topics: string[]
└── rules: Rule[]
    ├── topic: string (должен быть в topics)
    ├── agent: string
    └── prompt_field: string (JSONPath)
```

**Validation Rule (FR-017)**:
```typescript
const coveredTopics = new Set(config.rules.map(r => r.topic));
const uncovered = config.topics.filter(t => !coveredTopics.has(t));
if (uncovered.length > 0) {
  throw new Error(`Topics without rules: ${uncovered.join(', ')}`);
}
```

---

## Validation Rules

### RuleSchema
- `name`: непустая строка
- `topic`: непустая строка
- `agent`: непустая строка
- `condition`: опциональная строка
- `command`: опциональная строка
- `prompt_field`: строка, по умолчанию `$`

### PluginConfigSchema
- `topics`: массив строк, минимум 1 элемент
- `rules`: массив Rule, минимум 1 элемент

### Additional (post-Zod validation in parseConfig)
- Каждый топик в `topics` должен быть покрыт хотя бы одним правилом

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| `payload = { count: 0 }`, `prompt_field = "$.count"` | Возвращает `"0"` (String(0)) |
| `payload = { active: true }`, `prompt_field = "$.active"` | Возвращает `"true"` |
| `payload = { active: false }`, `prompt_field = "$.active"` | Возвращает `"false"` |
| `payload = { value: BigInt(42) }`, `prompt_field = "$.value"` | Возвращает `"42"` (String() handles BigInt) |
| `payload = { text: "" }`, `prompt_field = "$.text"` | Возвращает `""` (пустая строка не fallback) |
| `payload = { value: null }`, `prompt_field = "$.value"` | Возвращает fallback `"Process this payload"` |
| `payload = undefined`, `prompt_field = "$.any"` | Возвращает fallback |

---

## Migration Notes

### From Manual Types to z.infer<>

**Before** (types.ts):
```typescript
export interface Rule {
  name: string;
  topic: string;
  agent: string;
  condition?: string;
  command?: string;
  prompt_field?: string;
}
```

**After** (schemas/index.ts):
```typescript
export const RuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  topic: z.string().min(1, 'Topic is required'),
  agent: z.string().min(1, 'Agent is required'),
  condition: z.string().optional(),
  command: z.string().optional(),
  prompt_field: z.string().default('$'),
});

export type Rule = z.infer<typeof RuleSchema>;
```

**Import Changes**:
```typescript
// Old
import type { Rule } from '../core/types.js';

// New
import type { Rule } from '../schemas/index.js';
```