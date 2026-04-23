# Data Model: OpenCode SDK Integration

**Feature**: 006-opencode-sdk-integration
**Date**: 2026-04-23

## Обзор

Данная фича НЕ использует持久化 хранилище (БД, файлы). Все данные — runtime-объекты в памяти:

- Конфигурация: загружается при старте, immutable
- Rule matching: pure function, результат не хранится
- Agent sessions: создаются и уничтожаются в рамках обработки одного сообщения
- Response messages: отправляются в Kafka, не хранятся локально

## Сущности

### 1. PluginConfigV003
**Источник**: `src/schemas/index.ts` (Zod schema)
**Назначение**: Конфигурация плагина, загружается при старте

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| `topics` | `string[]` | Да | Список Kafka топиков для подписки (min 1, max 5) |
| `rules` | `RuleV003[]` | Да | Массив правил маршрутизации |

**Validation**: Zod schema, fail-fast при невалидной конфигурации.

**Пример**:
```json
{
  "topics": ["input-topic"],
  "rules": [
    {
      "name": "vuln-rule",
      "jsonPath": "$.vulnerabilities[*]",
      "promptTemplate": "Analyze: {{$.cve}}"
    }
  ]
}
```

---

### 2. RuleV003
**Источник**: `src/schemas/index.ts` (Zod schema)
**Назначение**: Правило маршрутизации Kafka сообщений

| Поле | Тип | Constraints | Default | Описание |
|------|-----|-------------|---------|----------|
| `name` | `string` | `min(1)` | — | Имя правила (уникальное) |
| `jsonPath` | `string` | `min(1)` | — | JSONPath выражение для matching |
| `promptTemplate` | `string` | `min(1)` | — | Шаблон промпта (`{{$.field}}`) |

**Note**: Поля `agentId`, `responseTopic`, `timeoutSeconds`, `concurrency` будут добавлены в spec 006.

**Validation**: Zod schema.

---

### 3. KafkaEnv
**Источник**: `src/schemas/index.ts` (Zod schema)
**Назначение**: Валидация Kafka environment variables

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| `KAFKA_BROKERS` | `string` | Да | Список брокеров через запятую |
| `KAFKA_CLIENT_ID` | `string` | Да | Client ID для Kafka |
| `KAFKA_GROUP_ID` | `string` | Да | Consumer group ID |
| `KAFKA_SSL` | `boolean` | Нет | SSL включён (default: false) |
| `KAFKA_USERNAME` | `string` | Нет | SASL username |
| `KAFKA_PASSWORD` | `string` | Нет | SASL password |
| `KAFKA_SASL_MECHANISM` | `string` | Нет | SASL механизм |
| `KAFKA_DLQ_TOPIC` | `string` | Нет | DLQ топик |
| `KAFKA_ROUTER_CONFIG` | `string` | Нет | Путь к конфиг файлу |
| `KAFKA_IGNORE_TOMBSTONES` | `boolean` | Нет | Игнорировать tombstone (default: false) |

**Validation**: Zod schema с `.passthrough()` для extra env keys.

---

### 4. DlqEnvelope
**Источник**: `src/kafka/dlq.ts`
**Назначение**: Формат сообщения в Dead Letter Queue

| Поле | Тип | Описание |
|------|-----|----------|
| `originalValue` | `string \| null` | Оригинальное значение сообщения |
| `topic` | `string` | Исходный топик |
| `partition` | `number` | Исходная партиция |
| `offset` | `string` | Исходный offset |
| `errorMessage` | `string` | Описание ошибки |
| `failedAt` | `string` | ISO 8601 timestamp |

**Kafka key**: `${topic}-{partition}-{offset}` (для traceability).

---

### 5. ConsumerState
**Источник**: `src/kafka/consumer.ts`
**Назначение**: Runtime состояние consumer

| Поле | Тип | Описание |
|------|-----|----------|
| `isShuttingDown` | `boolean` | Флаг graceful shutdown |
| `totalMessagesProcessed` | `number` | Счётчик обработанных сообщений |
| `dlqMessagesCount` | `number` | Счётчик DLQ сообщений |
| `lastDlqRateLogTime` | `number` | Время последнего DLQ rate log |

**State transitions**:
```
init → (running) → isShuttingDown: true → shutdown complete
```

---

### 6. InvokeOptions
**Источник**: `src/opencode/IOpenCodeAgent.ts` (spec 006)
**Назначение**: Параметры вызова OpenCode агента

| Поле | Тип | Описание |
|------|-----|----------|
| `timeoutMs` | `number` | Timeout в миллисекундах |

---

### 7. AgentResult
**Источник**: `src/opencode/IOpenCodeAgent.ts` (spec 006)
**Назначение**: Результат вызова OpenCode агента

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `'success' \| 'error' \| 'timeout'` | Статус выполнения |
| `response` | `string?` | Текст ответа (text parts, join через \n\n) |
| `sessionId` | `string` | ID созданной сессии |
| `errorMessage` | `string?` | Ошибка (при status='error' или 'timeout') |
| `executionTimeMs` | `number` | Время выполнения в мс |
| `timestamp` | `string` | ISO 8601 timestamp |

**State transitions**:
```
invoke() → success (response present)
invoke() → timeout (errorMessage present, best-effort abort attempted)
invoke() → error (errorMessage present)
```

---

### 8. ResponseMessage
**Источник**: `src/kafka/response-producer.ts` (spec 006)
**Назначение**: Формат ответа, отправляемого в responseTopic

| Поле | Тип | Описание |
|------|-----|----------|
| `messageKey` | `string` | Key исходного Kafka сообщения (корреляция) |
| `sessionId` | `string` | ID OpenCode сессии |
| `ruleName` | `string` | Имя сработавшего правила |
| `agentId` | `string` | ID вызванного агента |
| `response` | `string` | Текст ответа агента |
| `status` | `'success'` | Всегда success (errors → DLQ) |
| `executionTimeMs` | `number` | Время выполнения в мс |
| `timestamp` | `string` | ISO 8601 |

**Kafka key**: `sessionId` (для partition affinity).

---

### 9. PluginContext (stub)
**Источник**: `src/types/opencode-plugin.d.ts`
**Назначение**: Контекст, передаваемый плагину от OpenCode

| Поле | Тип | Описание |
|------|-----|----------|
| `client` | `unknown` | OpenCode SDK клиент (typified в spec 006) |
| `project` | `unknown` | Метаданные проекта |
| `directory` | `string` | Рабочая директория (cwd) |
| `worktree` | `string` | Git root |
| `$` | `unknown` | Bun shell API |

**Note**: В текущей версии `PluginContext = unknown`. Будет типизирован в spec 006.

---

### 10. SDKClient (type declarations)
**Источник**: `src/types/opencode-sdk.d.ts` (spec 006)
**Назначение**: Типы для OpenCode SDK (declare, не implement)

| API | Возвращает | Описание |
|-----|-----------|----------|
| `session.create(params)` | `Promise<Session>` | Со��дать сессию |
| `session.prompt(params)` | `Promise<AssistantMessage>` | Отправить промпт |
| `session.abort(params)` | `Promise<boolean>` | Прервать сессию |
| `session.delete(params)` | `Promise<boolean>` | Удалить сессию |
| `session.messages(params)` | `Promise<Message[]>` | Получить сообщения |

---

### 11. IOpenCodeAgent Interface
**Источник**: `src/opencode/IOpenCodeAgent.ts` (spec 006)
**Назначение**: Mockable интерфейс для вызова агентов

| Метод | Возвращает | Описание |
|-------|-----------|----------|
| `invoke(prompt, agentId, options)` | `Promise<AgentResult>` | Вызвать агента |
| `abort(sessionId)` | `Promise<boolean>` | Прервать сессию |

---

## Relationships

```
PluginConfigV003
  └── rules: RuleV003[]
       └── jsonPath → matchRuleV003(payload, rules) → RuleV003?
       └── promptTemplate → buildPromptV003(rule, payload) → string

eachMessageHandler
  ├── reads: PluginConfigV003
  ├── calls: matchRuleV003(payload, rules) → RuleV003?
  ├── calls: buildPromptV003(rule, payload) → string
  ├── on success: log message_processed
  └── on error: DlqEnvelope → dlqTopic

ConsumerState ← mutated by eachMessageHandler
```

**Future (spec 006)**:
```
RuleV003
  └── agentId → IOpenCodeAgent.invoke(agentId, ...)
  └── responseTopic? → ResponseMessage

IOpenCodeAgent (interface)
  ├── OpenCodeAgentAdapter (real: uses SDKClient)
  └── MockOpenCodeAgent (test: simulated)

eachMessageHandler (spec 006)
  ├── reads: PluginConfigV003
  ├── calls: matchRuleV003(payload, rules) → RuleV003?
  ├── calls: buildPromptV003(rule, payload) → string
  ├── calls: agent.invoke(prompt, agentId, options) → AgentResult
  ├── on success: ResponseMessage → responseTopic
  └── on error: DlqEnvelope → dlqTopic
```

---

## Data Flow

```
Kafka Message → parse JSON → matchRuleV003 → buildPromptV003
    → log message_processed (no agent call in current spec)
        → commitOffset

(Future spec 006):
Kafka Message → parse JSON → matchRuleV003 → buildPromptV003
    → agent.invoke() → AgentResult
        ├── success → ResponseMessage → Kafka responseTopic
        └── error/timeout → DlqEnvelope → Kafka dlqTopic
    → commitOffset (always)
```

---

## Validation Rules

1. **FR-017** (spec 006): `responseTopic` ≠ any input `kafka.topics` (infinite loop prevention)
2. **FR-003**: `agentId` required in every rule (Zod validation at startup) — spec 006
3. **FR-020**: `message.value.length` ≤ 1_048_576 bytes (1MB)
4. **Constitution I**: Fail-fast на невалидную конфигурацию (Zod → throw)
5. **Constitution IV**: Нет cross-message state (каждый invoke — isolated session) — spec 006

---

## Constants

| Constant | Value |-description|
|----------|-------|----------|
| `MAX_MESSAGE_SIZE_BYTES` | 1_048_576 | 1MB (FR-020) |
| `SHUTDOWN_TIMEOUT_MS` | 15_000 | 15 seconds (SC-008) |
| `MAX_THROTTLE_RETRIES` | 3 | Broker throttle retry |
| `THROTTLE_RETRY_DELAY_MS` | 1000 | 1 second between retries |
| `DLQ_RATE_LOG_INTERVAL` | 100 | Log DLQ rate every N messages |
| `DEFAULT_TIMEOUT_SECONDS` | 120 | Default agent timeout (spec 006) |

---

## Coverage по FR

| FR | Сущность | Статус |
|-----|----------|--------|
| FR-001 | Plugin Entry Point | ✅ `src/index.ts` |
| FR-002 | Configuration Parsing | ✅ `src/core/config.ts` |
| FR-003 | RuleV003Schema | ✅ `src/schemas/index.ts` |
| FR-004 | SDK Type Declarations | 🔲 (stub в spec 006) |
| FR-005 | PluginContext Type | 🔲 (stub в spec 006) |
| FR-006 | IOpenCodeAgent Interface | 🔲 (spec 006) |
| FR-007 | OpenCodeAgentAdapter | 🔲 (spec 006) |
| FR-008 | MockOpenCodeAgent | 🔲 (spec 006) |
| FR-009 | AgentError Classes | 🔲 (spec 006) |
| FR-010 | Kafka Client | ✅ `src/kafka/client.ts` |
| FR-011 | Message Routing | ✅ `src/core/routing.ts` |
| FR-012 | Prompt Building | ✅ `src/core/prompt.ts` |
| FR-013 | eachMessageHandler | ✅ `src/kafka/consumer.ts` |
| FR-014 | Response Producer | 🔲 (spec 006) |
| FR-015 | DLQ | ✅ `src/kafka/dlq.ts` |
| FR-016 | Graceful Shutdown | ✅ `src/kafka/consumer.ts` |
| FR-017 | Topic Coverage | 🔲 (spec 006) |
| FR-018 | ConsumerState | ✅ `src/kafka/consumer.ts` |
| FR-019 | Structured Logging | ✅ `src/kafka/consumer.ts` |
| FR-020 | MAX_MESSAGE_SIZE | ✅ `src/kafka/consumer.ts` |

✅ = Реализовано  
🔲 = Запланировано в spec 006