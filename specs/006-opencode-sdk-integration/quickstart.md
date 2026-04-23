# Quickstart: OpenCode SDK Integration

**Feature**: 006-opencode-sdk-integration

## Предварительные требования

- OpenCode установлен и настроен (`opencode serve` запущен)
- Доступ к Kafka брокеру (или Redpanda для разработки)
- Node.js / Bun runtime

## Быстрый старт

### 1. Конфигурация

Создай `.opencode/kafka-router.json`:

```json
{
  "kafka": {
    "topics": ["incoming-tasks"],
    "groupId": "opencode-plugin-kafka",
    "dlqTopic": "incoming-tasks-dlq"
  },
  "rules": [
    {
      "name": "ibs-plan-rule",
      "jsonPath": "$.plan.opecode",
      "promptTemplate": "{{$.plan.opecode}}",
      "agentId": "code-executor",
      "responseTopic": "outgoing-responses",
      "timeoutSeconds": 120
    }
  ]
}
```

**BREAKING CHANGE**: Поле `agentId` — обязательное. Конфигурации без него вызовут ошибку при старте.

### 2. Environment Variables

```bash
KAFKA_BROKERS=localhost:9092
# KAFKA_SSL=true          # опционально
# KAFKA_SASL_MECHANISM=plain  # опционально
# KAFKA_SASL_USERNAME=...     # опционально
# KAFKA_SASL_PASSWORD=...     # опционально
```

### 3. Запуск

```bash
opencode serve
```

Плагин автоматически:
1. Подключится к Kafka
2. Подпишется на указанные топики
3. Начнёт маршрутизировать сообщения по правилам
4. Вызывать OpenCode агентов
5. Отправлять ответы в responseTopic (если указан)

### 4. Тестирование

```bash
# Unit tests
npx vitest run tests/unit/

# Integration tests (требуется Docker/Podman + Redpanda)
npx vitest run tests/integration/

# Coverage
npm run test:coverage
```

### 5. Мониторинг

Все логи — structured JSON:
```json
{"level":"info","event":"message_processed","ruleName":"ibs-plan-rule","agentId":"code-executor","executionTimeMs":45000,"timestamp":"2026-04-23T14:30:00.000Z"}
```

## Структура проекта

```
src/
├── index.ts                    # Plugin entry point
├── opencode/
│   ├── IOpenCodeAgent.ts       # Interface
│   ├── OpenCodeAgentAdapter.ts # Real SDK
│   ├── MockOpenCodeAgent.ts    # For tests
│   └── AgentError.ts           # Errors
├── kafka/
│   ├── client.ts               # Kafka factories
│   ├── consumer.ts             # Message handler
│   ├── response-producer.ts    # Response sender
│   └── dlq.ts                  # Dead Letter Queue
├── core/
│   ├── config.ts               # Config parsing
│   ├── routing.ts              # Rule matching
│   └── prompt.ts               # Prompt building
├── schemas/index.ts            # Zod schemas
└── types/
    ├── opencode-sdk.d.ts       # SDK types
    └── opencode-plugin.d.ts    # Plugin types
```

## Data Flow

```
Kafka Topic → parse → matchRule → buildPrompt → agent.invoke()
    → success → responseTopic (Kafka)
    → error/timeout → dlqTopic (Kafka)
    → always → commit offset
```