# Data Model: E2E-тесты с реальным OpenCode-процессом

**Date**: 2026-04-28 | **Feature**: 008-e2e-opencode-real-process

## Entities

### OpenCodeProcessHandle

Дескриптор управляемого процесса `opencode serve`.

| Field | Type | Description |
|-------|------|-------------|
| baseURL | `string` | HTTP base URL (e.g., `http://localhost:3001`) |
| kill | `() => Promise<void>` | SIGTERM → SIGKILL fallback shutdown |

**Lifecycle**: Создаётся в `beforeAll`, уничтожается в `afterAll`.

### PluginRunnerHandle

Дескриптор запущенного Kafka consumer в контексте теста.

| Field | Type | Description |
|-------|------|-------------|
| stop | `() => Promise<void>` | Graceful shutdown consumer |

**Lifecycle**: Создаётся в начале каждого теста, уничтожается в `finally`.

### KafkaTestMessage

Сообщение для проверки результатов в тестах.

| Field | Type | Description |
|-------|------|-------------|
| value | `string \| null` | Тело сообщения (JSON string или null) |
| key | `string \| null` | Ключ сообщения |

### E2EResponseMessage

Структура ответа в responseTopic (ожидаемая).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | `'success'` | Да | Статус выполнения |
| response | `string` | Да | Текст ответа агента |
| sessionId | `string` | Да | ID созданной сессии |
| ruleName | `string` | Да | Имя сработавшего правила |
| timestamp | `string` | Нет | ISO 8601 |

### E2EDlqMessage

Структура сообщения в DLQ (ожидаемая).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| originalTopic | `string` | Да | Исходный топик сообщения |
| error | `string` | Да | Описание ошибки |
| originalMessage | `object` | Нет | Исходное сообщение |
| timestamp | `string` | Нет | ISO 8601 |

### E2EResponderAgent

Конфигурация тестового агента в `.opencode/opencode.json`.

| Field | Type | Description |
|-------|------|-------------|
| mode | `'subagent'` | Режим вызова |
| model | `string` | `lemonade/extra.Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF` |
| temperature | `0.1` | Минимальная рандомизация |
| permission | `deny all` | Нет доступа к инструментам |

## Relationships

```
consumer.e2e.test.ts
  ├── uses → redpandaContainer.ts (startRedpanda, stopRedpanda)
  ├── uses → opencodeProcess.ts (spawnOpenCodeServe)
  ├── uses → kafkaUtils.ts (createTopics, produceMessage, consumeOneMessage)
  ├── uses → pluginRunner.ts (runPlugin)
  └── uses → OpenCodeAgentAdapter (с real SDKClient)
       └── uses → SDKClient (HTTP к opencode serve)
            └── calls → opencode serve :3001
                 └── calls → e2e-responder agent
                      └── calls → Lemonade LLM (localhost:13305)
```

## State Transitions

```
[Не запущен] → beforeAll → [Redpanda + opencode serve готовы]
                              ↓
                         Каждый тест:
                         [runPlugin] → [produce message] → [consume response/DLQ] → [plugin.stop()]
                              ↓
                         afterAll → [cleanup: kill opencode + stop Redpanda]
```