# Демонстрация opencode-plugin-kafka — Инструкция для руководства

## Обзор демонстрации

Демонстрация показывает интеграцию OpenCode агентов с Apache Kafka для автоматической обработки сообщений. Плагин читает сообщения из Kafka топиков, применяет JSONPath правила для маршрутизации и вызывает соответствующих агентов.

---

## Скриншоты Kafka UI

### 1. Dashboard — Обзор кластера

![Kafka Dashboard](screenshots/kafka-dashboard.png)

**Описание:** Главная страница Kafka UI показывает:
- **Кластер:** local (версия 3.8-IV0)
- **Брокеры:** 1 активный брокер
- **Партиции:** 77 total partitions
- **Топики:** 18 топиков
- **Production/Consumption:** 0 Bytes (демо режим)

### 2. Topics List — Список demo.* топиков

![Kafka Topics](screenshots/kafka-topics.png)

**Описание:** Список всех созданных топиков:

| Topic | Partitions | Messages | Size |
|-------|----------|---------|------|
| demo.agent-tasks | 3 | 8 | 1 KB |
| demo.audit-log | 3 | 0 | 0 Bytes |
| demo.events | 3 | 2 | 371 Bytes |
| demo.notifications | 3 | 0 | 0 Bytes |
| demo.orders | 3 | 6 | 800 Bytes |
| demo.rules-dlq | 1 | 0 | 0 Bytes |
| demo.rules-input | 1 | 0 | 0 Bytes |
| demo.rules-output | 1 | 0 | 0 Bytes |

### 3. demo.orders — Сообщения с заказами

![demo.orders messages](screenshots/demo-orders-messages.png)

**Описание:** 6 сообщений в топике demo.orders:

| # | orderId | amount | customer |
|---|--------|--------|---------|
| 1 | ORD-1 | 100 | Customer 1 |
| 2 | ORD-2 | 200 | Customer 2 |
| 3 | ORD-3 | 300 | Customer 3 |
| 4 | ORD-4 | 400 | Customer 4 |
| 5 | ORD-5 | 500 | Customer 5 |
| 6 | ORD-22363 | 999.99 | (payment event) |

**Пример сообщения:**
```json
{"orderId":"ORD-1","amount":100,"customer":"Customer 1"}
```

**Обработка:** Сообщения с orders могут маршрутизироваться на агента для обработки заказов через правило `$.orderId`.

### 4. demo.agent-tasks — Алёрты безопасности

![demo.agent-tasks messages](screenshots/demo-agent-tasks-messages.png)

**Описание:** 8 сообщений — задачи агентам и алёрты:

| # | taskId/alertId | agent/severity | status/message |
|---|------------|-------------|------------|
| 1 | TSK-1 | agent-1 | pending |
| 2 | TSK-2 | agent-2 | pending |
| 3 | TSK-3 | agent-3 | pending |
| 4 | ALERT-1 | CRITICAL | SQL Injection on /api/users |
| 5 | ALERT-2 | CRITICAL | SQL Injection on /api/users |
| 6 | ALERT-3 | CRITICAL | SQL Injection on /api/users |
| 7 | ALERT-4 | HIGH | XSS vulnerability /api/posts |
| 8 | ALERT-5 | LOW | Minor info leak |

**Примеры CRITICAL алёртов:**
```json
{"alertId":"ALERT-1","severity":"CRITICAL","message":"SQL Injection detected on /api/users","source":"WAF","timestamp":1779221068000}
```

**Обработка:** JSONPath правило `$.alerts[?(@.severity==CRITICAL || @.severity==HIGH)]` перехватывает только CRITICAL/HIGH алёрты и маршрутизирует на sec-agent.

---

## Скриншоты OpenCode Web

### 5. OpenCode Web UI

![OpenCode Web](screenshots/opencode-web.png)

**Описание:** OpenCode Web интерфейс (localhost:8787):
- Список недавних проектов
- Быстрый доступ к ~/workspase/projects/opencode-plugin-kafka
- Навигация по проектам и сессиям

---

## Вывод демо-скриптов

### Демо 1: JSONPath Rule Matching

```
📡 JSONPath Rule Matching — Демонстрация
════════════════════════════════════════════════════════════

🅰️ СЛУЧАЙ 1: Сообщение НЕ отрабатывает (no match)
────────────────────────────────────────────────────────────
📥 Input: {"type":"security-check","alerts":[{"severity":"LOW","msg":"Minor issue detected"}]}
📋 Правило: jsonPath: "$.alerts[?(@.severity==CRITICAL || @.severity==HIGH)]"
✅ РЕЗУЛЬТАТ: NO MATCH → Сообщение в DLQ

🅱️ СЛУЧАЙ 2: Только промт (дефолтный агент)
────────────────────────────────────────────────────────────
📥 Input: {"type":"info","message":"User logged in","user":"john@example.com"}
📋 Правило: jsonPath: "$" (match всех сообщений)
✅ РЕЗУЛЬТАТ: MATCHED → Agent: default-agent
📝 Prompt: Process message: User logged in
✅ Ответ: [Mock] Processed by default-agent

🅾️ СЛУЧАЙ 3: Все поля заполнены (полный флоу)
────────────────────────────────────────────────────────────
📥 Input: {"type":"security-check","alerts":[{"severity":"CRITICAL","msg":"SQL Injection!"}]}
📋 Правило: jsonPath: "$.alerts[?(@.severity==CRITICAL|| @.severity==HIGH)]"
✅ РЕЗУЛЬТАТ: MATCHED → Agent: sec-agent → responseTopic: opencode.responses
📝 Prompt: 🚨 CRITICAL ALERT: [{"severity":"CRITICAL","msg":"SQL Injection!"}]
✅ Ответ: [Mock] Processed by sec-agent
📤 Ответ отправлен в Kafka: topic=opencode.responses
```

### Демо 2: Agent Cases

```
╔══════════════════════════════════════════════════════════════╗
║       Kafka Plugin — Демонстрация обработки сообщений      ║
╚══════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════╗
║  КЕЙС 1: Агент вызван, ответ НЕ отправляется            ║
╚══════════════════════════════════════════════════════════════╝
📥 Input: {"action":"LOG","message":"User logged in"}
✅ Matched: log-rule
   agentId: logger-agent
   responseTopic: null → ответ только в логах
📝 Prompt: Log: User logged in
✅ Agent finished: success
⚠️  responseTopic = null → Ответ НЕ отправляется в Kafka
📊 Flow: Message → Agent → (logs only) → commit

╔══════════════���═��═════════════════════════════════════════════╗
║  КЕЙС 2: Агент вызван, ответ → responseTopic            ║
╚══════════════════════════════════════════════════════════════╝
📥 Input: {"type":"process","data":{"orderId":"ORD-123","amount":999.99}}
✅ Matched: process-rule
   agentId: processor-agent
   responseTopic: demo.responses → ЕСТЬ!
📝 Prompt: Process: {"orderId":"ORD-123","amount":999.99}
✅ Agent finished: success
📤 → Kafka topic: demo.responses
✅ Response sent to Kafka!
📊 Flow: Message → Agent → Response → Kafka → commit

╔══════════════════════════════════════════════════════════════╗
║  КЕЙС 3: Агент ошибся → отправляется в DLQ               ║
╚══════════════════════════════════════════════════════════════╝
📥 Input: {"type":"process","data":{"orderId":"ORD-456","amount":1234.56}}
✅ Matched: process-rule
   agentId: error-agent → СИМУЛЯЦИЯ ОШИБКИ!
⏳ Invoking agent...
❌ Agent finished: timeout → Connection timeout after 30s
📤 → DLQ (demo.dlq)
   Error: Agent invoke failed: Connection timeout after 30s
✅ Error sent to DLQ!
📊 Flow: Message → Agent → (error) → DLQ → commit
```

---

## Архитектура обработки

### Data Flow

```
1. Kafka Topic Message
          ↓
2. Parse JSON from message.value
          ↓
3. matchRuleV003(payload, rules)
   - Apply jsonPath expression to payload
   - Return first matching rule or null
          ↓
4. buildPromptV003(rule, payload)
   - Replace ${$.path} placeholders
   - Return final prompt string
          ↓
5. agent.invoke(options)
   - Call OpenCode agent with prompt
   - Apply AbortController timeout
          ↓
   ┌─────────────────────────────────────────────┐
   │ SUCCESS                                    │
   │ → Optional: sendResponse() to responseTopic│
   │ → commit offset                           │
   ├─────────────────────────────────────────────┤
   │ ERROR / TIMEOUT                           │
   │ → sendToDlq() with error                  │
   │ → commit offset                          │
   └─────────────────────────────────────────────┘
```

### Конфигурация правил (пример)

```json
{
  "topics": ["demo.orders", "demo.agent-tasks"],
  "rules": [
    {
      "name": "critical-alerts",
      "jsonPath": "$.alerts[?(@.severity==CRITICAL || @.severity==HIGH)]",
      "promptTemplate": "🚨 CRITICAL ALERT: ${$.alerts}",
      "agentId": "sec-agent",
      "responseTopic": "opencode.responses",
      "timeoutMs": 60000,
      "concurrency": 2
    },
    {
      "name": "orders-processing",
      "jsonPath": "$.orderId",
      "promptTemplate": "Process order: ${$.orderId}, amount: ${$.amount}",
      "agentId": "orders-agent",
      "responseTopic": "demo.responses"
    }
  ]
}
```

---

## ��лючевые возможности

| Возможность | Описание |
|-----------|---------|
| **JSONPath routing** | Маршрутизация по условиям в payload |
| **Template prompts** | Шаблоны с подстановкой ${$.field} |
| **Multiple agents** | Вызов разных агентов для разных типов сообщений |
| **Response topics** | Опциональная отправка ответов в Kafka |
| **DLQ** | Ошибки/таймауты → Dead Letter Queue |
| **Timeout** | Настраиваемый timeout для каждого правила |
| **Concurrency** | Параллельная обработка сообщений |

---

## Запуск демо

```bash
# Kafka UI
open http://localhost:8090

# OpenCode Web
open http://localhost:8787

# Запуск демо-скриптов
cd ~/workspase/projects/opencode-plugin-kafka
node scripts/demo-jsonpath-rules.mjs
node scripts/demo-agent-cases.mjs
```

---

*Демонстрация подготовлена для руководства — opencode-plugin-kafka v0.3.0*