# OpenCode Kafka Router Plugin

Плагин OpenCode для маршрутизации сообщений Kafka к агентам на основе правил.

## Описание проекта

Kafka Router Plugin — это ядро системы маршрутизации сообщений из Kafka topics к соответствующим OpenCode агентам. Плагин использует:
- **Zod** для runtime валидации конфигурации
- **JSONPath** для фильтрации сообщений и извлечения данных
- **TypeScript** для типобезопасности

### Основные возможности

- **Конфигурационная маршрутизация**: правила определяют какой агент обрабатывает какие сообщения
- **Условная фильтрация**: JSONPath выражения для сложных условий фильтрации
- **Автоматическое построение промптов**: извлечение релевантных данных из payload
- **TypeScript типы**: полная типизация для разработки
- **Runtime валидация**: Zod схемы для проверки конфигурации

## Установка

```bash
npm install zod jsonpath-plus
npm install --save-dev vitest @types/node
```

## Использование

### 1. Парсинг конфигурации

```typescript
import { parseConfig } from './src/core/config';
import type { PluginConfig } from './src/schemas/index.js';

const rawJson = {
  topics: ['security', 'tasks'],
  rules: [
    {
      name: 'critical-security',
      topic: 'security',
      agent: 'security-agent',
      condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      command: 'analyze',
      prompt_field: '$.vulnerabilities'
    },
    {
      name: 'audit-task',
      topic: 'tasks',
      agent: 'code-agent',
      command: 'audit',
      prompt_field: '$.task_text'
    }
  ]
};

const config: PluginConfig = parseConfig(rawJson);
console.log(config.topics); // ['security', 'tasks']
```

### 2. Подбор правила для сообщения

```typescript
import { matchRule } from './src/core/routing';

const message = {
  vulnerabilities: [
    { severity: 'CRITICAL', id: 'CVE-2024-0001', description: 'Remote code execution' }
  ]
};

const matched = matchRule(message, 'security', config.rules);
if (matched) {
  console.log(`Matched rule: ${matched.name}`);
  console.log(`Agent: ${matched.agent}`);
  // Agent: security-agent
}
```

### 3. Построение промпта для агента

```typescript
import { buildPrompt } from './src/core/prompt';

const prompt = buildPrompt(message, matched!);
console.log(prompt);
// "/analyze [{"severity":"CRITICAL","id":"CVE-2024-0001","description":"Remote code execution"}]"
```

### 4. Полный цикл обработки

```typescript
import { parseConfig, matchRule, buildPrompt } from './src/core';

function processMessage(rawJson: string, message: unknown) {
  const config = parseConfig(JSON.parse(rawJson));
  const topic = determineTopic(message); // Извлекается из Kafka metadata

  const rule = matchRule(message, topic, config.rules);
  if (!rule) {
    console.log('No matching rule found');
    return;
  }

  const prompt = buildPrompt(message, rule);
  console.log(`Prompt for ${rule.agent}: ${prompt}`);

  // Передаём prompt в OpenCode agent session
  // await client.sessions.create({ agentId: rule.agent, prompt });
}
```

## Тестирование

```bash
# Запустить юнит-тесты
npm test

# Запустить с покрытием кода
npm run test:coverage

# Запустить конкретный тестовый файл
npx vitest tests/unit/routing.test.ts

# Запустить тесты в watch-режиме
npx vitest --watch
```

## Структура проекта

```
src/
├── core/
│   ├── config.ts      # parseConfig + Zod валидация + topic coverage проверка
│   ├── routing.ts     # matchRule — pure function
│   ├── prompt.ts      # buildPrompt — обработка примитивов через String()
│   └── index.ts       # Public API exports (re-exports из schemas)
├── schemas/
│   └── index.ts       # Zod схемы + типы (z.infer<>)
└── index.ts           # Plugin entry point (re-exports из core/index)

tests/
├── unit/              # pure function tests (vitest)
│   ├── config.test.ts     # parseConfig, FR-017 topic coverage
│   ├── routing.test.ts    # matchRule
│   ├── prompt.test.ts     # buildPrompt, примитивы
│   └── types-verification.test.ts  # TypeScript type checking
└── integration/       # testcontainers + Redpanda
    └── routing-flow.test.ts  # End-to-end routing flow
```

## Edge Cases

| Сценарий | Вход | Результат |
|----------|------|-----------|
| Нет совпадающего правила | Сообщение без CRITICAL уязвимости | `null` из matchRule |
| Catch-all правило | Правило без condition | Всегда совпадает |
| Отсутствует prompt_field | По умолчанию `"$"` | Полный payload |
| Объект как значение поля | `{ details: { a: 1 } }` | JSON.stringify |
| Пустой payload | `{}` | Fallback: `"Process this payload"` |
| Примитив number | `{ count: 42 }` | `"42"` (String conversion) |
| Примитив boolean | `{ active: true }` | `"true"` |
| Примитив BigInt | `{ big: BigInt(42) }` | `"42"` (String conversion, не JSON.stringify) |
| Число 0 | `{ count: 0 }` | `"0"` (не fallback) |
| Пустая строка | `{ name: "" }` | `""` (не fallback) |
| null/undefined | `{ value: null }` | Fallback: `"Process this payload"` |

## FR-017: Topic Coverage Validation

При старте `parseConfig` проверяет что каждый топик из `topics` покрыт хотя бы одним правилом:

```typescript
// topics: ['security', 'audit'] с правилами только для 'security'
// → Error: "Topics without rules: audit"
```

Непокрытые топики выбрасывают `Error` (не `ZodError`) с перечислением.

## Зависимости

### Production
- **zod** (`^3.23.8`) — Runtime валидация конфигурации
- **jsonpath-plus** (`^9.0.0`) — JSONPath запросы для фильтрации и извлечения данных

### Development
- **vitest** (`^2.0.0`) — Фреймворк для тестирования
- **@vitest/coverage-v8** (`^2.0.0`) — Покрытие кода
- **@types/node** (`^20.0.0`) — TypeScript типы Node.js
- **typescript** (`^6.0.3`) — TypeScript компилятор

## Доступные функции

### `parseConfig(rawJson: unknown): PluginConfig`

Парсит и валидирует JSON конфигурацию. Выбрасывает `ZodError` если конфигурация невалидна.

### `matchRule(payload: Payload, topic: string, rules: Rule[]): Rule | null`

Находит первое правило, которое соответствует payload и topic. Возвращает `null` если ни одно правило не подошло.

### `buildPrompt(payload: unknown, rule: Rule): string`

Строит промпт для агента на основе правила и payload. Включает command prefix если задан в правиле.

## Лицензия

MIT
