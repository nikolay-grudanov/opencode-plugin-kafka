# Конфигурация Kafka Router Plugin

Документация по настройке и конфигурации плагина маршрутизации сообщений Kafka.

---

## 1. Обзор

Плагин настраивается через два механизма:

1. **Файл конфигурации** `kafka-router.json` — содержит правила маршрутизации и вызова агентов
2. **Переменные окружения** — параметры подключения к Kafka (брокеры, группа потребителей, SSL/SASL)

Оба механизма используются совместно. Файл конфигурации определяет логику обработки сообщений, а переменные окружения — параметры подключения к кластеру Kafka.

---

## 2. Файл конфигурации: kafka-router.json

### 2.1 Расположение

Плагин ищет файл конфигурации в следующих местах (в порядке приоритета):

| Приоритет | Расположение | Описание |
|-----------|--------------|----------|
| 1 | Значение переменной `KAFKA_ROUTER_CONFIG` | Явно указанный путь |
| 2 | `.opencode/kafka-router.json` | Стандартное расположение в рабочей директории |

Если файл не найден ни в одном из этих мест, плагин завершается с ошибкой конфигурации.

### 2.2 Формат (spec 003)

Конфигурация использует формат spec 003. Полная структура файла:

```json
{
  "topics": ["topic-1", "topic-2"],
  "rules": [
    {
      "name": "rule-name",
      "jsonPath": "$.field",
      "promptTemplate": "Шаблон: ${$.field}",
      "agentId": "agent-name",
      "responseTopic": "response-topic",
      "timeoutMs": 120000,
      "concurrency": 1
    }
  ]
}
```

---

### 2.3 Поле `topics`

Массив входных Kafka-топиков для подписки. Плагин будет получать сообщения из всех указанных топиков.

```json
"topics": ["alerts", "tasks", "questions"]
```

| Характеристика | Ограничение |
|--------------|-------------|
| Минимум элементов | 1 топик |
| Максимум элементов | 5 топиков |
| Тип элементов | `string` |
| Тип массива | `string[]` |

**Примеры:**

```json
{
  "topics": ["my-topic"]
}
```

```json
{
  "topics": ["alerts", "tasks", "questions", "logs", "metrics"]
}
```

---

### 2.4 Массив `rules`

Массив правил маршрутизации. Каждое входящее сообщение проверяется по порядку against всех правил. **Первое совпадающее правило выигрывает** — остальные правила не проверяются.

| Характеристика | Ограничение |
|--------------|-------------|
| Минимум элементов | 1 правило |
| Максимум элементов | Нет лимита |
| Тип элементов | `RuleV003` |

**Алгоритм проверки правил:**

1. Берём первое правило из массива
2. Применяем `jsonPath` к payload сообщения
3. Если результат не пустой массив — правило совпадает, обрабатываем сообщение
4. Если результат пустой — переходим к следующему правилу
5. Если ни одно правило не совпало — сообщение игнорируется (ack без обработки)

---

### 2.5 Поля правила (RuleV003)

Каждое правило содержит следующие поля:

#### 2.5.1 `name` (обязательно)

Уникальное имя правила. Используется для:

- Логирования при обработке сообщений
- Поле `ruleName` в ответе агента
- Идентификации правила в случае ошибки

```json
"name": "critical-alerts"
```

| Характеристика | Значение |
|--------------|----------|
| Тип | `string` |
| Обязательно | Да |
| Уникальность | Рекомендуется |

#### 2.5.2 `jsonPath` (обязательно)

JSONPath-выражение для проверки сообщения. Использует библиотеку `jsonpath-plus`. Если выражение возвращает непустой массив — правило совпадает.

```json
"jsonPath": "$.task"
```

| Характеристика | Значение |
|--------------|----------|
| Тип | `string` |
| Обязательно | Да |
| Библиотека | `jsonpath-plus` |

**Логика совпадения:**

- Выражение применяется к JSON payload сообщения
- Если результат — непустой массив → правило совпадает
- Если результат — пустой массив `[]` → правило НЕ совпадает, пробуем следующее

**Основные примеры JSONPath-выражений:**

| Выражение | Описание | Пример совпадающего сообщения |
|-----------|----------|------------------------------|
| `$.task` | Поле task существует | `{ "task": "что-то" }` |
| `$` | Catch-all (всегда совпадает) | Любое сообщение |
| `$.severity` | Поле severity существует | `{ "severity": "CRITICAL" }` |
| `$.data.query` | Вложенное поле | `{ "data": { "query": "..." } }` |
| `$.items[0]` | Первый элемент массива | `{ "items": ["first"] }` |
| `$.messages[?(@.type=='question')]` | Filter по полю массива | `{ "messages": [{ "type": "question" }] }` |
| `$.vulns[?(@.severity=="CRITICAL")]` | Filter с проверкой значения | `{ "vulns": [{ "severity": "CRITICAL" }] }` |

**Важные замечания по JSONPath:**

> **JSONPath filter expressions** (например, `$[?(@.field=="value")]`) работают **только с массивами**. Для объектов (non-array) используйте простое выражение `$.field` — оно проверит существование поля.

| Выражение | Тип payload | Работает? |
|-----------|-------------|----------|
| `$.field` | Объект | Да — проверяет существование |
| `$.field` | Массив | Да — проверяет первый элемент |
| `$[?(@.field=="x")]` | Массив | Да — filter по значению |
| `$[?(@.field=="x")]` | Объект | Нет — нужен массив |

**Примеры поведения:**

```json
// Сообщение: { "task": "hello" }
// jsonPath: "$.task"
// Результат: ["hello"]
// Правило: СОВПАДАЕТ ✓
```

```json
// Сообщение: { "other": "data" }
// jsonPath: "$.task"
// Результат: []
// Правило: НЕ СОВПАДАЕТ ✗
```

```json
// Сообщение: { "items": [{ "type": "a" }, { "type": "b" }] }
// jsonPath: "$[?(@.type=='a')]"
// Результат: [{ "type": "a" }]
// Правило: СОВПАДАЕТ ✓
```

#### 2.5.3 `promptTemplate` (обязательно)

Шаблон промпта для передачи агенту. Поддерживает подстановку значений из payload сообщения.

```json
"promptTemplate": "Проанализируй: ${$.data.message}"
```

| Характеристика | Значение |
| -------------- | -------- |
| Тип | `string` |
| Обязательно | Да |
| Синтаксис подстановки | `${jsonPathExpression}` |

**Синтаксис плейсхолдеров:**

| Синтаксис | Описание | Пример подстановки |
|----------|----------|-------------------|
| `${$.field}` | Подставить поле | `{ "msg": "Привет" }` → `${$.msg}` → "Привет" |
| `${$.data.query}` | Подставить вложенное поле | `{ "data": { "query": "..." } }` → подставится значение |
| `${$.items[0].name}` | Подставить первый элемент массива | `{ "items": [{ "name": "A" }] }` → "A" |
| `${$}` | Подставить весь payload как JSON | `{ "a": 1 }` → "{ \"a\": 1 }" |

**Без плейсхолдеров:**

Если плейсхолдеры не используются, шаблон передаётся агенту как есть:

```json
"promptTemplate": "Обработай это сообщение"
```

**Fallback при отсутствии поля:**

Если указанное в плейсхолдере поле не найдено в payload, используется fallback-значение `"Process this payload"`:

```json
// Сообщение: { "other": "data" }
// promptTemplate: "Task: ${$.task}"
// Результат: "Task: Process this payload"
```

#### 2.5.4 `agentId` (обязательно)

Идентификатор OpenCode агента для вызова. Агент должен быть определён в `.opencode/opencode.json` в секции `agents`.

```json
"agentId": "e2e-responder"
```

| Характеристика | Значение |
| -------------- | -------- |
| Тип | `string` |
| Обязательно | Да |
| Привязка | Должен существовать в `agents` секции |

**Требования к агенту:**

- Агент должен быть определён в `.opencode/opencode.json`
- Агент должен иметь валидную модель и провайдер
- Агент должен иметь разрешения для выполнения задач

#### 2.5.5 `responseTopic` (опционально)

Kafka-топик для отправки ответа агента. Если не указан, ответ не отправляется (fire-and-forget).

```json
"responseTopic": "my-response-topic"
```

| Характеристика | Значение |
| -------------- | -------- |
| Тип | `string` |
| Обязательно | Нет |
| Default | Не отправлять |

**Ограничение FR-017 (anti-loop):**

> `responseTopic` **НЕ может** совпадать с любым топиком из массива `topics`. Это п��ед��твращает зацикливание сообщений.

| Нарушение | Результат |
|-----------|----------|
| `responseTopic` ∈ `topics` | Ошибка валидации config, плагин не стартует |

#### 2.5.6 `timeoutMs` (опционально)

Таймаут ожидания ответа от агента в миллисекундах.

```json
"timeoutMs": 60000
```

| Характеристика | Значение |
| -------------- | -------- |
| Тип | `number` |
| Обязательно | Нет |
| Default | 120000 (2 минуты) |
| Минимум | 1000 |
| Максимум | 600000 |

**Поведение при таймауте:**

1. Вызов агента отменяется (abort)
2. Исходное сообщение отправляется в DLQ
3. В DLQ-сообщение записывается ошибка `"Agent timeout"`

**Примеры:**

```json
{
  "timeoutMs": 30000
}
```

```json
{
  "timeoutMs": 180000
}
```

#### 2.5.7 `concurrency` (опционально)

Максимальное количество параллельных вызовов агента для этого правила.

```json
"concurrency": 1
```

| Характеристика | Значение |
| -------------- | -------- |
| Тип | `number` |
| Обязательно | Нет |
| Default | 1 |
| Минимум | 1 |
| Максимум | 10 |

**Текущие ограничения:**

> В текущей версии плагина параллельная обработка не реализована. Параметр зарезервирован для будущих версий. Всегда используется значение `1` (последовательная обработка).

---

## 3. Переменные окружения

### 3.1 Обязательные переменные

Следующие переменные **должны быть установлены** для работы плагина:

| Переменная | Описание | Пример значения |
|------------|----------|-----------------|
| `KAFKA_BROKERS` | Список Kafka-брокеров через запятую | `localhost:9092,localhost:9093` |
| `KAFKA_CLIENT_ID` | Идентификатор Kafka-клиента | `my-plugin-client` |
| `KAFKA_GROUP_ID` | Consumer group ID | `my-consumer-group` |

**Пример настройки:**

```bash
export KAFKA_BROKERS="localhost:9092"
export KAFKA_CLIENT_ID="kafka-router-client"
export KAFKA_GROUP_ID="kafka-router-group"
```

### 3.2 Опциональные переменные

| Переменная | Описание | Default | Пример |
|-----------|----------|---------|--------|
| `KAFKA_ROUTER_CONFIG` | Путь к конфиг-файлу | `.opencode/kafka-router.json` | `/etc/kafka-router.json` |
| `KAFKA_DLQ_TOPIC` | Топик для DLQ | `{input-topic}-dlq` | `my-dlq-topic` |
| `KAFKA_SSL` | Включить SSL | `false` | `true` |
| `KAFKA_USERNAME` | SASL username | — | `admin` |
| `KAFKA_PASSWORD` | SASL password | — | `secret` |
| `KAFKA_SASL_MECHANISM` | SASL механизм | `plain` | `scram-sha-512` |
| `KAFKA_IGNORE_TOMBSTONES` | Игнорировать tombstone-сообщения | `false` | `true` |

### 3.3 Настройка SSL/TLS

Для подключения к Kafka с SSL:

```bash
export KAFKA_SSL="true"
```

### 3.4 Настройка SASL-аутентификации

Для подключения с SASL-аутентификацией:

```bash
export KAFKA_USERNAME="admin"
export KAFKA_PASSWORD="secret"
export KAFKA_SASL_MECHANISM="plain"
# или
export KAFKA_SASL_MECHANISM="scram-sha-512"
```

---

## 4. Конфигурация OpenCode агента

### 4.1 Определение агентов

Агенты определяются в `.opencode/opencode.json` в секции `agents`:

```json
{
  "agents": {
    "e2e-responder": {
      "description": "Тестовый агент для E2E",
      "mode": "subagent",
      "model": "lemonade/extra.Qwen3.5-9B-GGUF",
      "prompt": "Отвечай кратко, без инструментов.",
      "temperature": 0.1,
      "permission": { "*": "deny" }
    }
  }
}
```

**Поля агента:**

| Поле | Тип | Описание |
|------|-----|----------|
| `description` | `string` | Описание агента для документации |
| `mode` | `string` | Режим работы: `"subagent"` — не отображается в UI |
| `model` | `string` | Провайдер/модель в формате `provider/model` |
| `prompt` | `string` | Системный промпт агента |
| `temperature` | `number` | Температура генерации (0-1) |
| `permission` | `object` | Разрешения (`{ "*": "deny" }` — запретить всё) |

### 4.2 Определение провайдеров

Провайдеры LLM определяются в том же файле `.opencode/opencode.json` или в глобальном `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "lemonade": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "lemonade",
      "options": {
        "baseURL": "http://localhost:13305/api/v1/"
      },
      "models": {
        "extra.Qwen3.5-9B-GGUF": {
          "name": "Qwen3.5-9B",
          "tools": true,
          "attachment": true,
          "limit": { "context": 128000, "output": 72900 }
        }
      }
    }
  }
}
```

**Поля провайдера:**

| Поле | Тип | Описание |
|------|-----|----------|
| `npm` | `string` | NPM-пакет для SDK |
| `name` | `string` | Отображаемое имя |
| `options.baseURL` | `string` | Base URL API |
| `models` | `object` | Доступные модели |

---

## 5. Формат сообщений

### 5.1 Входящее сообщение (Kafka → Plugin)

Входящее сообщение ожидается в формате JSON в поле `message.value`:

```json
{
  "task": "Что такое 2+2?",
  "correlationId": "unique-id-123",
  "priority": "high"
}
```

**Структура:**

- Поля payload произвольные — используются через JSONPath в правилах
- Рекомендуемые поля:
  - `task` или `message` — текст задачи для агента
  - `correlationId` — ID для трассировки запрос-ответ
  - Любые другие поля для маршрутизации

**Примеры входящих сообщений:**

```json
{
  "task": "Проанализируй логи",
  "correlationId": "req-001",
  "source": "api-gateway"
}
```

```json
{
  "message": {
    "text": "Срочная задача",
    "metadata": {
      "priority": "critical",
      "timestamp": "2026-05-05T10:00:00Z"
    }
  },
  "correlationId": "req-002"
}
```

### 5.2 Ответное сообщение (Plugin → responseTopic)

После обработки агентом плагин отправляет ответ в `responseTopic` (если указан):

```json
{
  "correlationId": "unique-id-123",
  "messageKey": "ses_xxx",
  "sessionId": "ses_xxx",
  "ruleName": "test-rule",
  "agentId": "e2e-responder",
  "response": "4",
  "status": "success",
  "executionTimeMs": 2463,
  "timestamp": "2026-05-05T12:00:00.000Z"
}
```

**Поля ответа:**

| Поле | Тип | Описание |
|------|-----|----------|
| `correlationId` | `string` | ID из исходного сообщения |
| `messageKey` | `string` | Ключ сессии агента |
| `sessionId` | `string` | ID сессии |
| `ruleName` | `string` | Имя правила, по которому обработано |
| `agentId` | `string` | ID вызванного агента |
| `response` | `string` | Ответ от агента |
| `status` | `string` | Статус: `success`, `timeout`, `error` |
| `executionTimeMs` | `number` | Время выполнения в мс |
| `timestamp` | `string` | Timestamp ответа (ISO 8601) |

### 5.3 DLQ-сообщение

Если при обработке возникает ошибка (таймаут, ошибка вызова агента), сообщение отправляется в DLQ-топик:

```json
{
  "originalValue": "{\"task\":\"...\"}",
  "failedMessage": "{\"task\":\"...\"}",
  "topic": "my-input",
  "partition": 0,
  "offset": "42",
  "errorMessage": "Agent invoke failed: Agent timeout (status: timeout)",
  "failedAt": "2026-05-05T12:00:00.000Z",
  "originalKey": "test-key"
}
```

**Поля DLQ:**

| Поле | Тип | Описание |
|------|-----|----------|
| `originalValue` | `string` | Оригинальное сообщение (JSON-строка) |
| `failedMessage` | `string` | Сообщение, которое не удалось обработать |
| `topic` | `string` | Исходный топик |
| `partition` | `number` | partition |
| `offset` | `string` | offset |
| `errorMessage` | `string` | Сообщение об ошибке |
| `failedAt` | `string` | Timestamp ошибки (ISO 8601) |
| `originalKey` | `string` | Оригинальный ключ сообщения |

---

## 6. Примеры конфигураций

### 6.1 Минимальная конфигурация

Самая простая конфигурация с одним топиком и одним правилом:

```json
{
  "topics": ["my-tasks"],
  "rules": [
    {
      "name": "process-all",
      "jsonPath": "$",
      "promptTemplate": "Обработай: ${$}",
      "agentId": "e2e-responder"
    }
  ]
}
```

**Особенности:**

- Все сообщения из `my-tasks` обрабатываются одним правилом
- Используется `$` (catch-all) — совпадает с любым сообщением
- Ответ не отправляется (responseTopic не указан)

### 6.2 Маршрутизация по типу сообщения

Конфигурация с несколькими правилами для разных типов сообщений:

```json
{
  "topics": ["events"],
  "rules": [
    {
      "name": "critical-alerts",
      "jsonPath": "$.severity",
      "promptTemplate": "Критическая тревога: ${$.message}. Действия: ${$.action}",
      "agentId": "alert-handler",
      "responseTopic": "alert-responses",
      "timeoutMs": 60000
    },
    {
      "name": "info-events",
      "jsonPath": "$.type",
      "promptTemplate": "Информационное событие: ${$.message}",
      "agentId": "logger-agent",
      "responseTopic": "log-responses"
    }
  ]
}
```

**Особенности:**

- Сообщения с полем `severity` обрабатываются как критические тревоги
- Сообщения с полем `type` (без severity) — как информационные собычения
- Разные агенты и разные responseTopic

### 6.3 С вложенными полями

Конфигурация для сообщений с вложенной структурой:

```json
{
  "topics": ["api-requests"],
  "rules": [
    {
      "name": "api-handler",
      "jsonPath": "$.request.endpoint",
      "promptTemplate": "API запрос к ${$.request.endpoint} с параметрами ${$.request.params}",
      "agentId": "api-agent",
      "responseTopic": "api-responses",
      "timeoutMs": 30000
    }
  ]
}
```

**Пример сообщения:**

```json
{
  "request": {
    "endpoint": "/users",
    "method": "GET",
    "params": { "limit": 10 }
  },
  "correlationId": "req-api-001"
}
```

**Особенности:**

- JSONPath обращается к вложенному полю `request.endpoint`
- Плейсхолдеры подставляют вложенные значения

### 6.4 Fire-and-forget (без ответа)

Конфигурация для обработки без отправки ответа:

```json
{
  "topics": ["notifications"],
  "rules": [
    {
      "name": "notification-handler",
      "jsonPath": "$.notification",
      "promptTemplate": "Отправь уведомление: ${$.notification}",
      "agentId": "notification-agent"
    }
  ]
}
```

**Осособенности:**

- `responseTopic` НЕ указан — ответ не отправляется
- Агент выполняет работу (отправка уведомления), результат не пишется в Kafka

### 6.5 Полная конфигурация

Конфигурация со всеми опциональными полями:

```json
{
  "topics": ["alerts", "tasks", "questions"],
  "rules": [
    {
      "name": "critical-alerts",
      "jsonPath": "$.severity",
      "promptTemplate": "CRITICAL: ${$.message}. Action required: ${$.action}",
      "agentId": "alert-agent",
      "responseTopic": "alert-responses",
      "timeoutMs": 60000,
      "concurrency": 1
    },
    {
      "name": "task-processor",
      "jsonPath": "$.task",
      "promptTemplate": "Execute task: ${$.task}",
      "agentId": "task-agent",
      "responseTopic": "task-responses",
      "timeoutMs": 120000,
      "concurrency": 1
    },
    {
      "name": "default-handler",
      "jsonPath": "$",
      "promptTemplate": "Process message: ${$}",
      "agentId": "default-agent",
      "responseTopic": "default-responses",
      "timeoutMs": 180000,
      "concurrency": 1
    }
  ]
}
```

---

## 7. Валидация конфигурации

### 7.1 Проверка при старте

При запуске плагин выполняет валидацию конфигурации:

1. **Topics**: проверяется непустой массив, максимум 5 топиков
2. **Rules**: проверяется минимум 1 правило
3. **Agent existence**: каждый `agentId` должен существовать в OpenCode config
4. **FR-017 Anti-loop**: `responseTopic` не должен совпадать с `topics`
5. **Topic coverage**: все топики из `topics` должны быть перечислены в правилах

### 7.2 Ошибки валидации

| Ошибка | Причина |
|-------|---------|
| `Invalid topics array` | Пустой массив или >5 элементов |
| `Invalid rules array` | Пустой массив |
| `Agent not found: {agentId}` | Агент не определён в OpenCode config |
| `FR-017 violation: responseTopic matches input topic` | responseTopic совпадает с input topic |

При ошибке валидации плагин **не стартует** (fail-fast).

---

## 8. Переменные окружения для Docker/Kubernetes

### 8.1 Docker Compose пример

```yaml
version: '3.8'
services:
  kafka-router:
    image: kafka-router:latest
    environment:
      - KAFKA_BROKERS=kafka:9092
      - KAFKA_CLIENT_ID=kafka-router
      - KAFKA_GROUP_ID=kafka-router-group
      - KAFKA_ROUTER_CONFIG=/app/config/kafka-router.json
      - KAFKA_USERNAME=${KAFKA_USERNAME}
      - KAFKA_PASSWORD=${KAFKA_PASSWORD}
      - KAFKA_SASL_MECHANISM=scram-sha-512
    volumes:
      - ./kafka-router.json:/app/config/kafka-router.json:ro
```

### 8.2 Kubernetes Secret пример

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kafka-router-config
type: Opaque
stringData:
  KAFKA_USERNAME: admin
  KAFKA_PASSWORD: <password>
```

---

## 9. Troubleshooting

### 9.1 Частые проблемы

| Проблема | Решение |
|----------|---------|
| Плагин не стартует | Проверьте наличие всех обязательных env vars |
| Сообщения не обрабатываются | Проверьте jsonPath — должно возвращать непустой массив |
| Agent not found | Проверьте определение агента в `.opencode/opencode.json` |
| Ответы не приходят | Проверьте `responseTopic` — должен быть указан |
| FR-017 violation | Проверьте что `responseTopic` не совпадает с input topics |

### 9.2 Отладка

Для отладки используйте:

```bash
# Проверить загруженную конфигурацию
export DEBUG=*

# Проверить подключение к Kafka
kafkacat -b localhost:9092 -L
```