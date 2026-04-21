# Contract: Routing Core API

**Feature**: 001-kafka-router
**Date**: 2026-04-21
**Type**: Public API Contract

## Overview

Routing Core — это чистое TypeScript-ядро, предоставляющее функции для валидации конфигурации и маршрутизации сообщений. Ядро не имеет зависимостей от Kafka или OpenCode SDK.

## Public API

### parseConfig

Валидирует raw JSON и возвращает типизированный `PluginConfig` или выбрасывает `ZodError`.

```typescript
function parseConfig(raw: unknown): PluginConfig
```

**Parameters**:
- `raw` — сырые данные (обычно из JSON.parse(jsonString))

**Returns**: `PluginConfig` — типизированный объект конфигурации

**Throws**: `ZodError` с понятным сообщением при невалидной конфигурации

**Example**:
```typescript
import { parseConfig } from './src/core';

const rawJson = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
const config = parseConfig(rawJson);
// config: PluginConfig { topics: [...], rules: [...] }
```

### matchRule

Находит первое подходящее правило для payload и topic.

```typescript
function matchRule(payload: unknown, topic: string, rules: Rule[]): Rule | null
```

**Parameters**:
- `payload` — JSON-объект сообщения из Kafka
- `topic` — имя Kafka topic
- `rules` — массив правил для проверки

**Returns**:
- `Rule` — первое правило, удовлетворяющее условию
- `null` — если ни одно правило не подошло

**Behavior**:
1. Фильтрует `rules` по `topic`
2. Для каждого правила проверяет `condition` через JSONPath
3. Если `condition` отсутствует — правило считается catch-all
4. Возвращает первое совпавшее правило

**JSONPath Evaluation**:
- `condition: undefined` → всегда matches (catch-all)
- `condition: "$.vulnerabilities[?(@.severity=='CRITICAL')]"` → фильтрует по severity

**Example**:
```typescript
const message = { vulnerabilities: [{ severity: 'CRITICAL', id: 'CVE-2024' }] };
const rules = [
  { name: 'critical-security', topic: 'security', agent: 'security-agent', condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]' },
  { name: 'all-security', topic: 'security', agent: 'general-agent' }
];
const matched = matchRule(message, 'security', rules);
// matched: Rule { name: 'critical-security', ... }
```

### buildPrompt

Формирует текстовый prompt для агента из payload и rule.

```typescript
function buildPrompt(payload: unknown, rule: Rule): string
```

**Parameters**:
- `payload` — JSON-объект сообщения
- `rule` — правило с настройками для формирования prompt

**Returns**: `string` — готовый prompt для агента

**Behavior**:
1. Извлекает значение из `payload` по `prompt_field` (default: "$")
2. Если `command` задан — prepends `/{command}` к результату
3. Если значение — объект/массив — сериализует через `JSON.stringify`
4. Если извлечь не удалось — использует fallback `"Process this payload"`

**Example**:
```typescript
const payload = { task_text: 'Audit the code' };
const rule = { name: 'audit', topic: 'tasks', agent: 'code-agent', command: 'audit', prompt_field: '$.task_text' };
const prompt = buildPrompt(payload, rule);
// prompt: "/audit Audit the code"
```

## Error Handling

| Function | Error Case | Behavior |
|----------|------------|----------|
| parseConfig | Invalid JSON structure | Throws ZodError with field path |
| parseConfig | Missing required field | Throws ZodError with 'required' issue |
| parseConfig | topics array empty | Throws ZodError with min(1) issue |
| matchRule | No rules for topic | Returns null |
| matchRule | No matching condition | Returns null |
| buildPrompt | payload is null/undefined | Returns fallback string |
| buildPrompt | JSONPath returns empty | Returns fallback string |
| buildPrompt | value is number/boolean | Converted to string |

## Edge Cases

| Case | Input | Expected Output |
|------|-------|----------------|
| Empty payload | `{}` | `"Process this payload"` |
| Null payload | `null` | `"Process this payload"` |
| Empty JSONPath result | `{ "field": null }`, path `$.nonexistent` | `"Process this payload"` |
| Object as value | `{ "details": { "a": 1 } }`, path `$.details` | `"{ \"a\": 1 }"` |
| Array as value | `{ "items": [1, 2] }`, path `$.items` | `"[1,2]"` |
| Number as value | `{ "count": 42 }`, path `$.count` | `"42"` |
| Boolean as value | `{ "flag": true }`, path `$.flag` | `"true"` |
| Missing command | any | value without leading slash |
| Root prompt_field | `$` | Full payload serialized if object, else string value |

## Integration Points

Routing Core предназначен для интеграции с:

1. **Kafka Consumer** (plugin integration layer)
   - Получает payload из `eachMessage`
   - Передаёт в `matchRule` для определения правила
   - Передаёт в `buildPrompt` для формирования prompt

2. **OpenCode Agent** (plugin integration layer)
   - Получает prompt string из `buildPrompt`
   - Использует agent name из matched `Rule.agent`
   - Вызывает `client.sessions.create()` с prompt

## Constraints

- Все функции — pure functions (без side effects)
- Нет зависимостей от Kafka или OpenCode APIs
- Работает в Node.js, Bun, Deno environments
- 100% unit test coverage target для routing logic