# Ручное тестирование Kafka → OpenCode плагина

Данный документ описывает способы ручного тестирования Kafka → OpenCode плагина в различных конфигурациях.

## 1. Предварительные требования

- **Podman** 5.x (или Docker)
- **OpenCode** v1.14+ (`opencode --version`)
- **Node.js** 20+
- **Lemonade LLM** (или другой локальный LLM) на порту 13305
- Модель `extra.Qwen3.5-9B-GGUF` доступна

## 2. Способ 1: Через скрипт manual-test.mjs

Автоматический скрипт, который запускает весь pipeline:

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
npm run build
node scripts/manual-test.mjs
```

Скрипт:

1. Запускает Redpanda (podman)
2. Создаёт топики: test-input, test-response, test-input-dlq
3. Запускает opencode serve (child process)
4. Запускает consumer (startConsumer напрямую)
5. Ждёт 5 сек для consumer readiness
6. Подписывается на response topic
7. Отправляет сообщение: `{ "task": "Что такое 2+2? Ответь коротко." }`
8. Читает ответ

### Ожидаемый результат

```json
{
  "correlationId": "test-001",
  "sessionId": "ses_xxx",
  "ruleName": "manual-test-rule",
  "agentId": "e2e-responder",
  "response": "4",
  "status": "success",
  "executionTimeMs": 2463
}
```

## 3. Способ 2: Через OpenCode runtime (production)

Пошаговая инструкция:

### 3.1 Запустить Kafka (Redpanda)

```bash
podman run -d --name redpanda -p 9092:9092 \
  docker.redpanda.com/redpandadata/redpanda:latest

# Проверить что работает
podman exec redpanda rpk cluster info
```

### 3.2 Создать топики

```bash
podman exec redpanda rpk topic create my-input my-response my-input-dlq
```

### 3.3 Настроить конфигурацию плагина

Создать файл `.opencode/kafka-router.json`:

```json
{
  "topics": ["my-input"],
  "rules": [
    {
      "name": "test-rule",
      "jsonPath": "$.task",
      "promptTemplate": "${$.task}",
      "agentId": "e2e-responder",
      "responseTopic": "my-response",
      "timeoutMs": 120000
    }
  ]
}
```

### 3.4 Установить переменные окружения

```bash
export KAFKA_BROKERS="localhost:9092"
export KAFKA_CLIENT_ID="my-kafka-client"
export KAFKA_GROUP_ID="my-consumer-group"
```

### 3.5 Запустить opencode

```bash
opencode
```

Плагин загрузится автоматически. В логах должно появиться:

```
kafka_consumer_started
consumer_connected
response_producer_connected
```

### 3.6 Отправить сообщение

В другом терминале:

```bash
podman exec -it redpanda rpk topic produce my-input
```

Ввести JSON и нажать Enter:

```json
{"task": "Сколько будет 5 умножить на 3?", "correlationId": "manual-001"}
```

Нажать Ctrl+C для выхода из produce mode.

### 3.7 Прочитать ответ

```bash
podman exec -it redpanda rpk topic consume my-response
```

### 3.8 Проверить DLQ (если есть ошибки)

```bash
podman exec -it redpanda rpk topic consume my-input-dlq
```

## 4. Примеры сообщений для тестирования

### 4.1 Простой вопрос

```json
{"task": "Что такое 2+2?", "correlationId": "test-001"}
```

### 4.2 Задача с вложенными полями

```json
{
  "data": {
    "query": "Какая столица Франции?",
    "context": "география"
  },
  "correlationId": "test-002"
}
```

Для этого нужна конфигурация:

```json
{
  "jsonPath": "$.data.query",
  "promptTemplate": "Контекст: ${$.data.context}. Вопрос: ${$.data.query}",
  "agentId": "e2e-responder",
  "responseTopic": "my-response"
}
```

### 4.3 Маршрутизация по типу

```json
{"messages": [{"type": "question", "value": "Как дела?"}]}
```

Конфигурация:

```json
{
  "jsonPath": "$.messages[?(@.type=='question')]",
  "promptTemplate": "${$.messages[0].value}",
  "agentId": "e2e-responder",
  "responseTopic": "my-response"
}
```

### 4.4 Несколько правил

```json
{
  "topics": ["my-input"],
  "rules": [
    {
      "name": "critical-rule",
      "jsonPath": "$.severity",
      "promptTemplate": "Критическая тревога: ${$.message}",
      "agentId": "e2e-responder",
      "responseTopic": "my-response"
    },
    {
      "name": "catch-all",
      "jsonPath": "$",
      "promptTemplate": "Обработка: ${$}",
      "agentId": "e2e-responder",
      "responseTopic": "my-response"
    }
  ]
}
```

### 4.5 Невалидный JSON (попадёт в DLQ)

```
this is not json{broken
```

### 4.6 Fire-and-forget (без responseTopic)

```json
{
  "topics": ["my-input"],
  "rules": [
    {
      "name": "fire-and-forget",
      "jsonPath": "$.task",
      "promptTemplate": "${$.task}",
      "agentId": "e2e-responder"
    }
  ]
}
```

## 5. Отправка через kafkajs (Node.js скрипт)

```javascript
import { Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'test-producer', brokers: ['localhost:9092'] });
const producer = kafka.producer();
await producer.connect();
await producer.send({
  topic: 'my-input',
  messages: [{
    key: 'test-key',
    value: JSON.stringify({ task: 'Привет!', correlationId: 'script-001' }),
  }],
});
await producer.disconnect();
```

## 6. Диагностика проблем

### Логи consumer

Consumer логирует JSON строки в stdout:

- `kafka_consumer_started` — consumer запущен
- `consumer_connected` — подключён к Kafka
- `message_processed` — сообщение обработано
- `agent_invoke_success` — агент ответил
- `agent_invoke_failed` — ошибка агента
- `dlq_sent` — сообщение отправлено в DLQ

### Проблемы и решения

| Проблема | Причина | Решение |
|----------|---------|---------|
| Нет ответа в response topic | Consumer не успел join group | Подождать 5 сек после запуска |
| "Empty session ID from SDK" | opencode serve не запущен | Проверить что opencode serve работает |
| "Agent timed out" | LLM медленно отвечает | Увеличить timeoutMs |
| Сообщение в DLQ "JSON parse error" | Невалидный JSON в value | Про��ерить формат сообщения |
| responseTopic не получает ответ | Топик не создан | Создать топик перед отправкой |

## 7. Очистка

```bash
# Остановить Redpanda
podman stop redpanda
podman rm redpanda

# Или просто остановить (данные сохранятся)
podman stop redpanda
```