# Data Model: Kafka Router Plugin Core

**Feature**: 001-kafka-router
**Date**: 2026-04-21

## Entity Definitions

### PluginConfig

Корневой объект конфигурации плагина.

```typescript
interface PluginConfig {
  topics: string[];    // Kafka topics для мониторинга (минимум 1)
  rules: Rule[];       // Routing rules (минимум 1)
}
```

**Constraints**:
- `topics`: Минимум 1 элемент (валидация через Zod: `z.array().min(1)`)
- `rules`: Минимум 1 элемент (валидация через Zod: `z.array().min(1)`)

### Rule

Правило маршрутизации для сообщений из Kafka topic.

```typescript
interface Rule {
  name: string;        // Уникальное имя правила (required)
  topic: string;       // Kafka topic для применения правила (required)
  agent: string;       // Agent ID для обработки сообщений (required)
  condition?: string;  // JSONPath expression для фильтрации (optional — catch-all)
  command?: string;    // Slash command для агента (optional)
  prompt_field?: string; // JSONPath field для извлечения текста (default: "$")
}
```

**Constraints**:
- `name`: Non-empty string
- `topic`: Non-empty string, должен быть в списке `topics`
- `agent`: Non-empty string
- `condition`: Валидное JSONPath выражение или undefined
- `command`: Non-empty string, начинается с `/` если присутствует
- `prompt_field`: Валидное JSONPath выражение, default "$"

**State Transitions**: None (immutable configuration object)

### Payload

Произвольный JSON-объект сообщения из Kafka topic.

```typescript
type Payload = unknown; // null | boolean | number | string | object | array
```

**Constraints**: Can be any valid JSON value

## Validation Rules

### From Requirements (spec.md)

| Rule | Field(s) | Validation |
|------|----------|------------|
| FR-003 | Rule | `name`, `topic`, `agent` — required |
| FR-003 | Rule | `condition`, `command`, `prompt_field` — optional |
| FR-004 | PluginConfig | `topics` — min 1 element |
| FR-004 | PluginConfig | `rules` — min 1 element |
| FR-005 | Rule.prompt_field | Default value: `"$"` |
| FR-009 | buildPrompt output | Начинается с `/{command}` если command задан |

## Relationships

```
PluginConfig
├── topics: string[]
└── rules: Rule[]
    ├── topic → references PluginConfig.topics (should be in list)
    └── prompt_field → references Payload field via JSONPath
```

## TypeScript Types

```typescript
// src/core/types.ts

export interface Rule {
  name: string;
  topic: string;
  agent: string;
  condition?: string;
  command?: string;
  prompt_field?: string;
}

export interface PluginConfig {
  topics: string[];
  rules: Rule[];
}

export type Payload = unknown;
```

## Zod Schemas

```typescript
// src/schemas/index.ts

import { z } from 'zod';

export const RuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  topic: z.string().min(1, 'Topic is required'),
  agent: z.string().min(1, 'Agent is required'),
  condition: z.string().optional(),
  command: z.string().optional(),
  prompt_field: z.string().default('$'),
});

export const PluginConfigSchema = z.object({
  topics: z.array(z.string()).min(1, 'At least one topic required'),
  rules: z.array(RuleSchema).min(1, 'At least one rule required'),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type Rule = z.infer<typeof RuleSchema>;
``` 