# OpenCode Kafka Router Plugin

Плагин для маршрутизации сообщений из Kafka топиков к OpenCode агентам. Реализует интеграцию с OpenCode SDK (spec 006).

## Возможности

- **JSONPath маршрутизация** — правила на основе JSONPath выражений для фильтрации сообщений
- **OpenCode SDK интеграция** — вызов агентов через `agent.invoke()` с поддержкой AbortController
- **Dead Letter Queue** — автоматическая отправка ошибок в DLQ топик
- **Response producer** — отправка ответов агентов в отдельный топик
- **Graceful shutdown** — корректное завершение при SIGTERM/SIGINT с отменой активных сессий
- **Sequential processing** — гарантированная последовательная обработка сообщений
- **Structured logging** — JSON логирование для мониторинга

## Установка

```bash
npm install
```

### Зависимости

- `kafkajs` — Kafka клиент
- `zod` — runtime валидация конфигурации
- `jsonpath-plus` — JSONPath запросы для маршрутизации

## Конфигурация

Создай `.opencode/kafka-router.json`:

```json
{
  "topics": ["incoming-tasks"],
  "rules": [
    {
      "name": "ibs-plan-rule",
      "jsonPath": "$.plan.opencode",
      "promptTemplate": "Execute: ${$.plan.opencode}",
      "agentId": "code-executor",
      "responseTopic": "outgoing-responses",
      "timeoutMs": 120000,
      "concurrency": 1
    }
  ]
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `name` | `string` | Да | Уникальное имя правила |
| `jsonPath` | `string` | Да | JSONPath выражение для фильтрации |
| `promptTemplate` | `string` | Да | Шаблон промпта с `${$.path}` placeholders |
| `agentId` | `string` | Да | ID агента для вызова |
| `responseTopic` | `string` | Нет | Топик для ответов |
| `timeoutMs` | `number` | Нет | Таймаут (по умолчанию: 120000) |
| `concurrency` | `number` | Нет | Параллельность (по умолчанию: 1) |

## Environment Variables

| Переменная | Обязательно | Описание |
|-----------|-------------|----------|
| `KAFKA_BROKERS` | Да | Список брокеров через запятую |
| `KAFKA_CLIENT_ID` | Да | ID клиента |
| `KAFKA_GROUP_ID` | Да | Группа consumer |
| `KAFKA_DLQ_TOPIC` | Нет | DLQ топик |
| `KAFKA_SSL` | Нет | `true` для SSL |
| `KAFKA_SASL_MECHANISM` | Нет | SASL механизм |
| `KAFKA_SASL_USERNAME` | Нет | SASL username |
| `KAFKA_SASL_PASSWORD` | Нет | SASL password |
| `KAFKA_ROUTER_CONFIG` | Нет | Путь к конфигурации |

## Использование

### Парсинг конфигурации

```typescript
import { parseConfigV003 } from './core/config.js';

const config = parseConfigV003();
// config: PluginConfigV003 { topics: [...], rules: [...] }
```

### Подбор правила (V003)

```typescript
import { matchRuleV003 } from './core/routing.js';
import type { RuleV003, Payload } from './schemas/index.js';

const payload: Payload = { plan: { opencode: 'analyze code' } };
const rules: RuleV003[] = [
  {
    name: 'ibs-plan-rule',
    jsonPath: '$.plan.opencode',
promptTemplate: 'Execute: ${$.plan.opencode}',
    agentId: 'code-executor',
    timeoutMs: 120000,
    concurrency: 1
  }
];

const matched = matchRuleV003(payload, rules);
// matched: RuleV003 или null
```

### Построение промпта (V003)

```typescript
import { buildPromptV003 } from './core/prompt.js';
import type { RuleV003 } from './schemas/index.js';

const rule: RuleV003 = {
  name: 'ibs-plan-rule',
  jsonPath: '$.plan.opencode',
  promptTemplate: 'Execute: ${$.plan.opencode}',
  agentId: 'code-executor',
  timeoutMs: 120000,
  concurrency: 1
};

const payload = { plan: { opencode: 'analyze code' } };
const prompt = buildPromptV003(rule, payload);
// prompt: 'Execute: analyze code'
```

### Запуск consumer

```typescript
import { startConsumer } from './kafka/consumer.js';
import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';
import type { PluginConfigV003 } from './schemas/index.js';

const config: PluginConfigV003 = parseConfigV003();
const agent = new OpenCodeAgentAdapter(client);

await startConsumer(config, agent);
// Consumer запущен, обработка сообщений начата
```

### Data Flow

```
Kafka Topic
    ↓
1. eachMessageHandler: parse JSON
2. matchRuleV003: подбор правила по jsonPath
3. buildPromptV003: построение промпта
4. agent.invoke(): вызов агента
    ↓
    ├── success → responseTopic → commit offset
    ├── error → dlqTopic → commit offset
    └── timeout → dlqTopic → commit offset
```

## Доступные функции

### Core

| Функция | Сигнатура | Описание |
|--------|-----------|----------|
| `parseConfigV003` | `() => PluginConfigV003` | Парсинг и валидация конфигурации |
| `matchRuleV003` | `(payload: Payload, rules: RuleV003[]) => RuleV003 \| null` | Подбор первого совпадающего правила |
| `buildPromptV003` | `(rule: RuleV003, payload: unknown) => string` | Построение промпта с подстановкой placeholders |

### Kafka

| Функция | Сигнатура | Описание |
|--------|-----------|----------|
| `startConsumer` | `(config: PluginConfigV003, agent: IOpenCodeAgent) => Promise<void>` | Запуск consumer |
| `eachMessageHandler` | `(payload, config, dlqProducer, commitOffsets, state, agent, responseProducer, activeSessions) => Promise<void>` | Обработка одного сообщения (10-step pipeline) |
| `performGracefulShutdown` | `(consumer, dlqProducer, responseProducer, activeSessions, state) => Promise<void>` | Graceful shutdown |
| `createKafkaClient` | `(config: PluginConfigV003) => Kafka` | Создание Kafka клиента |
| `createConsumer` | `(client: Kafka, config: PluginConfigV003) => Consumer` | Создание consumer |
| `createDlqProducer` | `(client: Kafka) => Producer` | Создание DLQ producer |
| `createResponseProducer` | `(client: Kafka) => Producer` | Создание response producer |

### DLQ & Response

| Функция | Сигнатура | Описание |
|--------|-----------|----------|
| `sendToDlq` | `(producer, topic, message, rule, error) => Promise<void>` | Отправка в DLQ |
| `sendResponse` | `(producer, topic, sessionId, result) => Promise<void>` | Отправка ответа |

### OpenCode Agent

| Функция | Сигнатура | Описание |
|--------|-----------|----------|
| `IOpenCodeAgent.invoke` | `(options: InvokeOptions) => Promise<AgentResult>` | Вызов агента |
| `OpenCodeAgentAdapter` | `(client: SDKClient)` | Адаптер для OpenCode SDK |
| `MockOpenCodeAgent` | тестовый мок | Мок для unit тестов |

## Тестирование

```bash
# Unit тесты
npm run test

# Coverage (90%+ threshold)
npm run test:coverage

# Integration тесты (требуется Docker/Podman + Redpanda)
npm run test:integration
```

### Тесты

- `tests/unit/config.test.ts` — валидация конфигурации
- `tests/unit/routing.test.ts` — matchRuleV003 логика
- `tests/unit/prompt.test.ts` — buildPromptV003 логика
- `tests/unit/types-verification.test.ts` — проверка типов

## Структура проекта

```
src/
├── index.ts                        # Plugin entry point (export default plugin)
├── opencode/
│   ├── IOpenCodeAgent.ts         # Interface: AgentResult, InvokeOptions
│   ├── OpenCodeAgentAdapter.ts   # Production adapter (SDK)
│   ├── MockOpenCodeAgent.ts    # Test mock
│   └── AgentError.ts           # TimeoutError, AgentError
├── kafka/
│   ├── client.ts               # createKafkaClient, createConsumer, createDlqProducer
│   ├── consumer.ts           # eachMessageHandler, startConsumer, performGracefulShutdown
│   ├── dlq.ts                # sendToDlq, DlqEnvelope
│   └── response-producer.ts  # sendResponse, ResponseMessage
├── core/
│   ├── config.ts             # parseConfigV003, validateTopicCoverage
│   ├── routing.ts           # matchRuleV003 (pure function)
│   ├── prompt.ts            # buildPromptV003
│   └── index.ts             # Public API re-exports
├── schemas/
│   └── index.ts            # Zod schemas + types via z.infer<>
└── types/
    ├── opencode-plugin.d.ts # PluginContext, PluginHooks
    └── opencode-sdk.d.ts     # SDKClient, SessionsAPI
```

## Архитектура

### Domain Isolation

Маршрутизация реализована как pure function без side effects. `matchRuleV003` принимает payload и rules, возвращает первое совпадающее правило или null.

### Resiliency

Каждое сообщение обрабатывается в try-catch блоке. Ошибки не крашат consumer — они отправляются в DLQ.

### No-State Consumer

Consumer не хранит состояние между сообщениями. Метрики (totalMessagesProcessed, dlqMessagesCount) — единственное состояние.

### Strict Initialization

Конфигурация валидируется через Zod при старте. Невалидная конфигурация выбрасывает ошибку (fail-fast).

### FR-017 Topic Coverage

Проверяется, что responseTopic не совпадает с input topics (предотвращение зацикливания).

## Edge Cases

| Сценарий | Поведение |
|----------|-----------|
| Invalid JSON в сообщении | Отправка в DLQ |
| Нет совпадающего правила | Пропуск сообщения, commit offset |
| Agent timeout | Отправка в DLQ, AbortController.cancel() |
| Agent error | Отправка в DLQ с error.message |
| DLQ send failure | Логирование ошибки, commit offset |
| Oversized message (>1MB) | Отправка в DLQ |
| Null value (tombstone) | Пропуск, commit offset если KAFKA_IGNORE_TOMBSTONES=true |

## Конституция (5 NON-NEGOTIABLE принципов)

1. **Strict Initialization** — невалидная конфигурация падает при старте (fail-fast), включая FR-017 topic coverage validation
2. **Domain Isolation** — routing logic как pure function без side effects
3. **Resiliency** — try-catch в eachMessage handler, ошибки не крашат consumer
4. **No-State Consumer** — никакого session state между сообщениями
5. **Test-First Development** — unit tests писать до имплементации, 90%+ coverage

## Лицензия

MIT