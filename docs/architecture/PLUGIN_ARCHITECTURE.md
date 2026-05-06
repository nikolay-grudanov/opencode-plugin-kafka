# Архитектура Kafka Router Plugin

## 1. Обзор

Kafka Router Plugin — это плагин для OpenCode, который обеспечивает интеграцию с Apache Kafka. Плагин подписывается на указанные Kafka-топики, выполняет маршрутизацию входящих сообщений на основе правил JSONPath, генерирует промпты для OpenCode агентов и отправляет результаты обратно в Kafka.

### Ключевые возможности

- **Потребление сообщений** из Kafka-топиков с последовательной обработкой (one message at a time)
- **Маршрутизация на основе JSONPath** — правила определяют, какие сообщения обрабатывать и какой промпт генерировать
- **Вызов OpenCode агентов** через SDK с настраиваемым таймаутом
- **Dead Letter Queue (DLQ)** — обработка проблемных сообщений без остановки consumer
- **Graceful shutdown** — корректное завершение при SIGTERM/SIGINT с принудительным выходом через 15 секунд

---

## 2. Архитектурная схема

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Kafka Router Plugin Flow                              │
└──────────────────────────────────────────────────────────────────────────── ╲ ╱ ╲ ╱ ╲ ╱ ╲ ╱ ╲ ╱ ┘

                                    ┌─────────────┐
  ┌──────────┐                       │  Kafka    │   ┌──────────┐
  │ Kafka   │═══════════════════════════▶│          │═════════▶│          │
  │ Topic   │    consume()             │ Consumer  │  eachMsg │ Routing │  Prompt  │
  └──────────┘                       └──────────┘         └──────────┘
                                                                    │
                                                                    ▼
                                  ┌──────────┐              ┌──────────┐
                                  │ Match    │─────────────▶│  Build  │
                                  │ Rule    │   JSONPath   │ Prompt  │
                                  └──────────┘              └──────────┘
                                                                │
                                                                ▼
                              ┌──────────┐         ┌─────────────────┐
  ┌──────────┐               │  OpenCode │────────▶│ Agent           │
  │ Response │◀───────────│  Agent   │  invoke │ Adapter         │
  │ Topic    │  sendResponse│ Adapter  │         │ (SDK client)    │
  └──────────┘               └──────────┘         └─────────────────┘
         ▲                                              ┌─────────────────┐
         │                                              │                │
         │                          ┌──────────┐       │ OpenCode Agent  │
         └─────────────────────────▶│   DLQ   │──────▶│ (e2e-responder│
                                   │ Producer │ sendToDlq│ etc.)       │
                                   └──────────┘       └─────────────────┘


═════════════════════════════════════════════════════════════════════════════════════════════════════════════
                                    Component Details
═══════════════════════════════════════════════════════════════════════

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   src/index.ts    │────▶│ src/core/config │────▶│ startConsumer() │
│ Plugin Entry     │     │ parseConfigV003 │     │ (consumer.ts) │
└──────────────────┘     └────────┬───────┘     └────────┬────────┘
                                   │                 │
                                   ▼                 ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ PluginContext   │     │ validateTopic  │     │ eachMessage    │
│ client: SDK   │     │ Coverage()    │     │ Handler()     │
└──────────────────┘     └──────────────┬──┘     └───────┬────────┘
                                        │               │
                                        ▼               ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ FR-017 check   │     │ matchRuleV003()│     │ AbortController│
│ responseTopic │     │ (pure func)  │     │ for cancel   │
└──────────────┬──┘     └──────────────┘     └──────┬────────┘
                                         │                │
                                         ▼                ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Fail-fast on   │     │ buildPrompt   │     │ sendResponse │
│ invalid      │     │ V003()       │     │ / sendToDlq │
│ config       │     │ (pure func)  │     │            │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Схема последовательности обр��ботки сообщения

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│              Message Processing Sequence                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                       │
                    ┌────────────────┴────────────────┐
                    │ Kafka Message Received        │
                    │ (topic, partition, offset) │
                    └────────────┬───────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 1: Validate message value                              │
│ - Check null (tombstone) → sendToDlq                    │
│ - Check size > 1MB → sendToDlq                        │
└───────────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 2: Parse JSON                                      │
│ - JSON.parse(message.value) → catch → sendToDlq           │
└───────────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 3: Route matching                                 │
│ - matchRuleV003(payload, rules) → null → skip (commit)   │
│ - Returns first matching RuleV003                       │
└───────────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 4: Build prompt                                  │
│ - buildPromptV003(rule, payload)                      │
│ - Replace ${$.path} placeholders                     │
└───────────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 5: Invoke agent (C2: AbortController)                        │
│ - Create session: POST /session                                  │
│ - Send prompt: POST /session/{id}/message                       │
│ - Promise.race([prompt, timeout, abort])                          │
│ - result: success | error | timeout                             │
└───────────────────────────┬──────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
           ▼                         ▼
┌─────────────────────┐   ┌─────────────────────────────┐
│ Status: success     │   │ Status: error | timeout  │
│ → sendResponse()   │   │ → sendToDlq()          │
└────────────┬────────┘   └────────────┬────────────┘
           │                         │
           └────────┬────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────���┐
│ Step 6: Commit offset                                     │
│ - commitOffsets([{topic, partition, offset}])              │
│ - autoCommit: false (manual commit)                    │
└──────────────────────────────────────────────────────┘
```

---

## 3. Компоненты

### 3.1 Plugin Entry Point (`src/index.ts`)

Точка входа плагина, вызываемая OpenCode runtime при загрузке.

```typescript
export default async function plugin(context: PluginContext): Promise<PluginHooks> {
  // 1. Парсим конфигурацию из kafka-router.json (spec 003)
  const config = parseConfigV003();

  // 2. Создаём адаптер для OpenCode агентов из SDK клиента
  const agent = new OpenCodeAgentAdapter(context.client);

  // 3. Запускаем Kafka consumer
  await startConsumer(config, agent);

  // Возвращаем пустой объект hooks (плагин не использует хуки)
  return {};
}
```

**Ответственность:**
- Чтение и парсинг конфигурации (`parseConfigV003()`)
- Создание экземпляра `OpenCodeAgentAdapter` с переданным SDK клиентом
- Запуск Kafka consumer
- Fail-fast при любой ошибке инициализации

**PluginHooks:** `{}` — плагин не использует хуки событий, так как работает как standalone consumer.

### 3.2 Конфигурация (`src/core/config.ts`)

Парсинг и валидация конфигурации из файла `kafka-router.json`.

```typescript
export function parseConfigV003(): PluginConfigV003 {
  const configPath = process.env.KAFKA_ROUTER_CONFIG || '.opencode/kafka-router.json';
  const fileContent = readFileSync(configPath, 'utf-8');
  const rawJson = JSON.parse(fileContent);
  
  // Валидация через Zod schema
  const config = PluginConfigV003Schema.parse(rawJson);
  
  // FR-017: validateTopicCoverage — responseTopic ≠ input topics
  validateTopicCoverage(config);
  
  return config;
}
```

**validateTopicCoverage():**
Проверяет, что `responseTopic` в правилах НЕ совпадает с input topics. Это предотвращает зацикливание:
- Сообщение поступает в input topic
- Обрабатывается агентом
- Отправляется в response topic
- Если response topic = input topic → бесконечный цикл

**Переменные окружения:**

| Переменная | Обязательно | Описание |
|-----------|------------|---------|
| `KAFKA_BROKERS` | Да | Список брокеров через запятую |
| `KAFKA_CLIENT_ID` | Да | ID клиента для Kafka |
| `KAFKA_GROUP_ID` | Да | Consumer group ID |
| `KAFKA_SSL` | Нет | `'true'` или `'false'` |
| `KAFKA_USERNAME` | Нет | SASL username |
| `KAFKA_PASSWORD` | Нет | SASL password |
| `KAFKA_DLQ_TOPIC` | Нет | Кастомный DLQ топик |
| `KAFKA_ROUTER_CONFIG` | Нет | Путь к конфигурации |
| `KAFKA_IGNORE_TOMBSTONES` | Нет | Игнорировать tombstones |

### 3.3 Маршрутизация (`src/core/routing.ts`)

Pure function для сопоставления сообщений с правилами через JSONPath.

```typescript
export function matchRuleV003(payload: Payload, rules: RuleV003[]): RuleV003 | null {
  // Проверка каждого правила в порядке
  for (const rule of rules) {
    const results = JSONPath({ path: rule.jsonPath, json: payload });
    
    // Если results не пустой — правило совпало
    if (results && results.length > 0) {
      return rule;
    }
  }
  
  // Ни одно правило не совпало
  return null;
}
```

**Особенности:**
- Pure function — нет side effects
- Использует `jsonpath-plus` для JSONPath запросов
- Возвращает первое совпавшее правило
- Если ни одно правило не совпало → `null` (сообщение пропускается, не DLQ)

**Примеры:**

```typescript
// Правило для критических уязвимостей
const rule1 = {
  name: 'critical-vuln',
  jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
  promptTemplate: 'Analyze: ${$.vulnerabilities}'
};

// Catch-all правило
const rule2 = {
  name: 'catch-all',
  jsonPath: '$',
  promptTemplate: 'Process: ${$}'
};
```

### 3.4 Генератор промптов (`src/core/prompt.ts`)

Pure function для построения промптов на основе правил и payload.

```typescript
export function buildPromptV003(rule: RuleV003, payload: unknown): string {
  const template = rule.promptTemplate;
  const placeholderRegex = /\$\{([^}]+)\}/g;
  
  // Заменяем ${$.path} на результаты JSONPath
  let result = template;
  let match;
  
  while ((match = placeholderRegex.exec(template)) !== null) {
    const [fullMatch, jsonPathExpr] = match;
    const extracted = JSONPath({ path: jsonPathExpr, json: payload });
    
    if (extracted.length === 0) {
      return FALLBACK_PROMPT_V003; // "Process this payload"
    }
    
    const value = extracted[0];
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    result = result.replace(fullMatch, text);
  }
  
  return result;
}
```

**Особенности:**
- Pure function — нет side effects
- Поддерживает плейсхолдеры `${$.jsonPathExpression}`
- Если поле не найдено → fallback "Process this payload"
- Обрабатывает строки, числа, объекты

### 3.5 Kafka Consumer (`src/kafka/consumer.ts`)

Основной orchestrator для обработки сообщений.

#### startConsumer()

```typescript
export async function startConsumer(
  config: PluginConfigV003,
  agent: IOpenCodeAgent
): Promise<void> {
  // 1. Создаём Kafka клиент
  const { kafka, validatedEnv } = createKafkaClient(process.env);
  
  // 2. Создаём consumer, producers
  const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);
  const dlqProducer = createDlqProducer(kafka);
  const responseProducer = createResponseProducer(kafka);
  
  // 3. Состояние consumer (Constitution IV: No-State)
  const state: ConsumerState = {
    isShuttingDown: false,
    totalMessagesProcessed: 0,
    dlqMessagesCount: 0,
    lastDlqRateLogTime: Date.now(),
  };
  
  // 4. Подключаем и подписываемся
  await consumer.connect();
  await consumer.subscribe({ topics: config.topics });
  
  // 5. Регистрируем shutdown handlers
  process.once('SIGTERM', shutdownHandler);
  process.once('SIGINT', shutdownHandler);
  
  // 6. Запускаем consumer loop
  consumer.run({
    autoCommit: false, // Manual commit
    eachMessage: async (payload) => {
      await eachMessageHandler(payload, config, ...);
    },
  });
}
```

#### eachMessageHandler()

Обработка одного сообщения с полной resilience:

```typescript
export async function eachMessageHandler(
  payload: EachMessagePayload,
  config: PluginConfigV003,
  dlqProducer: Producer,
  commitOffsets: CommitOffsetsFn,
  state: ConsumerState,
  agent: IOpenCodeAgent,
  responseProducer: Producer,
  activeSessions: Set<AbortController>
): Promise<void> {
  // 1. Проверка shutdown state
  if (state.isShuttingDown) return;
  
  // 2. Проверка null value (tombstone)
  if (messageValue === null) {
    await sendToDlq(dlqProducer, message, error);
    await commitOffsets(...);
    return;
  }
  
  // 3. Проверка размера (max 1MB)
  if (messageSize > MAX_MESSAGE_SIZE_BYTES) {
    await sendToDlq(dlqProducer, message, error);
    await commitOffsets(...);
    return;
  }
  
  // 4. JSON.parse
  let parsedPayload;
  try {
    parsedPayload = JSON.parse(messageValue.toString('utf-8'));
  } catch {
    await sendToDlq(dlqProducer, message, parseError);
    await commitOffsets(...);
    return;
  }
  
  // 5. matchRuleV003
  const matchedRule = matchRuleV003(parsedPayload, config.rules);
  if (!matchedRule) {
    // No match → skip (не ошибка)
    await commitOffsets(...);
    return;
  }
  
  // 6. buildPromptV003
  const prompt = buildPromptV003(matchedRule, parsedPayload);
  
  // 7. Agent invoke с AbortController
  const abortController = new AbortController();
  activeSessions.add(abortController);
  
  try {
    const result = await agent.invoke(prompt, matchedRule.agentId, {
      timeoutMs: matchedRule.timeoutMs ?? 120_000,
      signal: abortController.signal,
    });
  } finally {
    activeSessions.delete(abortController);
  }
  
  // 8. Обработка результата
  if (result.status === 'success') {
    if (matchedRule.responseTopic) {
      await sendResponse(responseProducer, matchedRule.responseTopic, {...});
    }
  } else {
    await sendToDlq(dlqProducer, message, result.errorMessage);
  }
  
  // 9. Commit offset
  await commitOffsets(...);
}
```

**Особенности:**
- `autoCommit: false` — ручной commit после каждого сообщения
- Try-catch на каждом этапе — ошибки не крашат consumer
- DLQ для проблемных сообщений
- Skip для сообщений без совпадений (не ошибка)

### 3.6 Agent Adapter (`src/opencode/OpenCodeAgentAdapter.ts`)

Адаптер для вызова OpenCode агентов через SDK.

```typescript
export class OpenCodeAgentAdapter implements IOpenCodeAgent {
  async invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions
  ): Promise<AgentResult> {
    const startTime = Date.now();
    let sessionId = '';
    
    try {
      // 1. Создаём сессию
      const session = await this.client.session.create({
        body: { title: `kafka-plugin-${agentId}` },
      });
      sessionId = session.data?.id ?? '';
      
      // 2. Promise.race с timeout и abort
      const timeoutMs = options.timeoutMs ?? 120_000;
      
      const response = await Promise.race([
        this.client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: 'text', text: prompt }], agent: agentId },
        }),
        timeoutPromise(timeoutMs),
        signalPromise(options.signal),
      ]);
      
      // 3. Извлекаем текст
      const parts = response?.data?.parts ?? [];
      const responseText = extractResponseText(parts);
      
      return {
        status: 'success',
        response: responseText,
        sessionId,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      // Best-effort cleanup
      await this.performCleanup(error, sessionId);
      
      return {
        status: error instanceof TimeoutError ? 'timeout' : 'error',
        errorMessage: error.message,
        sessionId,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
```

**Особенности:**
- Promise.race для таймаута
- Best-effort cleanup (abort на timeout, delete на ошибку)
- Никогда не бросает исключения — все через AgentResult

### 3.7 Response Producer (`src/kafka/response-producer.ts`)

Отправка ответов агентов в Kafka.

```typescript
export interface ResponseMessage {
  correlationId?: string;
  messageKey: string;
  sessionId: string;
  ruleName: string;
  agentId: string;
  response: string;
  status: 'success';
  executionTimeMs: number;
  timestamp: string;
}

export async function sendResponse(
  producer: Producer,
  topic: string,
  message: ResponseMessage
): Promise<void> {
  try {
    await producer.send({
      topic,
      acks: -1, // All ISR
      messages: [
        { key: message.sessionId, value: JSON.stringify(message) },
      ],
    });
  } catch (error) {
    // Resilience: логируем, не бросаем
    console.error(...);
  }
}
```

**Особенности:**
- Никогда не бросает исключения (resilience)
- Использует sessionId как key для partition
- `acks: -1` — ждёт всех in-sync реплик

### 3.8 DLQ Producer (`src/kafka/dlq.ts`)

Обработка проблемных сообщений через Dead Letter Queue.

```typescript
export interface DlqEnvelope {
  originalValue: string | null;
  failedMessage: string | null;        // Alias
  topic: string;
  partition: number;
  offset: string;
  errorMessage: string;
  failedAt: string;
  originalKey?: string | null;
}

export async function sendToDlq(
  producer: Producer,
  originalMessage: {
    value: string | null;
    topic: string;
    partition: number;
    offset: string | number;
    originalKey?: string | null;
  },
  error: Error
): Promise<void> {
  const dlqTopic = process.env.KAFKA_DLQ_TOPIC || `${originalMessage.topic}-dlq`;
  
  const envelope: DlqEnvelope = {
    originalValue: originalMessage.value,
    failedMessage: originalMessage.value,
    topic: originalMessage.topic,
    partition: originalMessage.partition,
    offset: String(originalMessage.offset),
    errorMessage: sanitizeErrorMessage(error.message),
    failedAt: new Date().toISOString(),
    originalKey: originalMessage.originalKey ?? null,
  };
  
  //Санитизация: маскируем пароли, токены, ключи
  //Ограничение длины: 1000 символов
  
  try {
    await producer.send({
      topic: dlqTopic,
      messages: [
        {
          key: `${topic}-${partition}-${offset}`,
          value: JSON.stringify(envelope),
        },
      ],
    });
  } catch (sendError) {
    // DLQ send failure → non-fatal
    console.error(...);
  }
}
```

**DLQ trigger conditions:**
- Tombstone message (null value)
- Размер > 1MB
- Invalid JSON
- JSONPath matching error
- Agent timeout
- Agent error

---

## 4. Поток данных

### Пример обработки сообщения

**Входное сообщение в Kafka topic:**
```json
{
  "task": "Что такое 2+2?",
  "correlationId": "test-001"
}
```

**Конфигурация rules:**
```json
{
  "topics": ["test-input"],
  "rules": [
    {
      "name": "math-question",
      "jsonPath": "$.task",
      "promptTemplate": "${$.task}",
      "agentId": "math-agent",
      "responseTopic": "test-output"
    }
  ]
}
```

**Пошаговый flow:**

```
Step 1: Kafka Consumer Received
├── Topic: test-input
├── Partition: 0
├── Offset: 123
└── Value: {"task": "Что такое 2+2?", "correlationId": "test-001"}

Step 2: Validate Message
├── Value is not null ✓
├── Size: 53 bytes < 1MB ✓
└── Valid JSON ✓

Step 3: matchRuleV003
├── Rule: "math-question"
├── JSONPath: "$.task"
├── Result: ["Что такое 2+2?"]
└── Matched: true → RuleV003 { name: "math-question", ... }

Step 4: buildPromptV003
├── Template: "${$.task}"
├── Replace "${$.task}" → "Что такое 2+2?"
└── Prompt: "Что такое 2+2?"

Step 5: agent.invoke()
├── Endpoint: POST /session
├── Request: { title: "kafka-plugin-math-agent" }
├── Response: { id: "ses_abc123" }
│
├── Endpoint: POST /session/ses_abc123/message
├── Request: { parts: [{ type: "text", text: "Что такое 2+2?" }], agent: "math-agent" }
├── Timeout: 120000ms
└── Response: "4"

Step 6: sendResponse()
├── Topic: test-output
├── Key: "ses_abc123"
├── Value: {
│   correlationId: "test-001",
│   sessionId: "ses_abc123",
│   ruleName: "math-question",
│   agentId: "math-agent",
│   response: "4",
│   status: "success",
│   executionTimeMs: 150,
│   timestamp: "2024-01-01T00:00:00.000Z"
│ }

Step 7: commitOffsets
└── Commit offset 123
```

---

## 5. Graceful Shutdown

Обработка SIGTERM/SIGINT с корректным завершением.

```typescript
export async function performGracefulShutdown(
  consumer: Consumer,
  dlqProducer: Producer,
  responseProducer: Producer,
  signal: string,
  state: ConsumerState,
  exitFn: (code: number) => never,
  agent?: IOpenCodeAgent,
  activeSessions?: Set<AbortController>
): Promise<void> {
  state.isShuttingDown = true;
  
  const shutdownPromise = (async () => {
    // 1. Abort all active sessions
    if (activeSessions) {
      for (const controller of activeSessions) {
        controller.abort();
      }
      activeSessions.clear();
    }
    
    // 2. Disconnect consumer
    await consumer.disconnect();
    
    // 3. Disconnect DLQ producer
    await dlqProducer.disconnect();
    
    // 4. Disconnect response producer
    await responseProducer.disconnect();
  })();
  
  // Timeout: 15 секунд
  await Promise.race([
    shutdownPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Graceful shutdown timeout')), 15_000)
    ),
  ]);
  
  exitFn(0);
}
```

**Последовательность:**
1. SIGTERM/SIGINT received
2. `isShuttingDown = true` — новые сообщения игнорируются
3. Abort всех активных сессий (AbortController.abort())
4. Consumer disconnect
5. DLQ producer disconnect
6. Response producer disconnect
7. Timeout 15s → force exit (код 1)

---

## 6. Конституция (5 NON-NEGOTIABLE принципов)

### Принцип 1: Strict Initialization

Невалидная конфигурация падает при старте (fail-fast).

```typescript
// config.ts
const config = parseConfigV003();
// Если конфигурация невалидна → throw ZodError
// Если responseTopic в input topics → throw FR-017 Error
```

### Принцип 2: Domain Isolation

Routing logic как pure function без side effects.

```typescript
// routing.ts — pure function
export function matchRuleV003(payload: Payload, rules: RuleV003[]): RuleV003 | null {
  // Нет side effects
  // Нет внешних зависимостей
  // Результат зависит только от входных данных
  return rules
    .map(rule => ({ rule, result: JSONPath({ path: rule.jsonPath, json: payload }) }))
    .find(({ result }) => result.length > 0)?.rule ?? null;
}
```

### Принцип 3: Resiliency

Try-catch в eachMessage handler, ошибки не крашат consumer.

```typescript
// consumer.ts
try {
  // Обработка сообщения
  await processMessage(...);
} catch (error) {
  // Любая ошибка → DLQ + commit
  await sendToDlq(..., error);
  await commitOffsets(...);
}
```

### Принцип 4: No-State Consumer

Между сообщениями нет session state.

```typescript
// Состояние не сохраняется между сообщениями
const state: ConsumerState = {
  isShuttingDown: false,
  totalMessagesProcessed: 0,
  dlqMessagesCount: 0,
  // Не храним историю сообщений
  // Не храним историю ответов
};
```

### Принцип 5: Test-First Development

Unit tests до имплементации, 90%+ coverage.

```bash
npm run test:coverage  # Проверка coverage
# Тесты для routing, prompt, config → до кода
# Тесты для consumer → с моками
```

---

## 7. Структура файлов

```
src/
├── index.ts                          # Plugin entry point (exports default plugin)
│
├── core/
│   ├── config.ts                   # parseConfigV003, validateTopicCoverage
│   ├── routing.ts                 # matchRuleV003 — pure function
│   ├── prompt.ts                 # buildPromptV003 — pure function
│   └── index.ts                 # Public API re-exports
│
├── schemas/
│   └── index.ts                  # Zod schemas + types via z.infer<>
│                                # RuleV003Schema, PluginConfigV003Schema
│                                # KafkaEnv, Payload, KafkaMessage
│
├── kafka/
│   ├── client.ts                 # createKafkaClient, createConsumer,
│   │                          #   createDlqProducer, createResponseProducer
│   ├── consumer.ts             # eachMessageHandler, startConsumer,
│   │                          #   performGracefulShutdown
│   ├── dlq.ts                # sendToDlq, DlqEnvelope
│   └── response-producer.ts    # sendResponse, ResponseMessage
│
├── opencode/
│   ├── IOpenCodeAgent.ts       # Interface: AgentResult, InvokeOptions
│   ├── OpenCodeAgentAdapter.ts # Production adapter (SDK HTTP)
│   ├── MockOpenCodeAgent.ts   # Test mock
│   ├── AgentError.ts        # TimeoutError, AgentError
│   └── utils.ts            # extractResponseText
│
└── types/
    ├── opencode-plugin.d.ts  # PluginContext, PluginHooks
    └── opencode-sdk.d.ts   # SDKClient, SessionsAPI
```

---

## 8. Зависимости

| Зависимость | Версия | Назначение |
|-------------|--------|------------|
| `kafkajs` | ^3.0.0 | Kafka client |
| `zod` | ^3.0.0 | Runtime validation |
| `jsonpath-plus` | ^10.0.0 | JSONPath queries |
| `@opencode-ai/sdk` | latest | OpenCode SDK |
| `vitest` | ^2.0.0 | Unit tests |
| `testcontainers-node` | ^10.0.0 | Integration tests |

---

## 9. Конфигурация

### Пример kafka-router.json

```json
{
  "topics": ["test-input", "alerts"],
  "rules": [
    {
      "name": "math-question",
      "jsonPath": "$.task",
      "promptTemplate": "Реши задачу: ${$.task}",
      "agentId": "math-agent",
      "responseTopic": "test-output",
      "timeoutMs": 60000
    },
    {
      "name": "critical-alert",
      "jsonPath": "$.severity",
      "promptTemplate": "Analyze critical alert: ${$.title}",
      "agentId": "security-agent",
      "responseTopic": "alerts-response",
      "timeoutMs": 120000
    },
    {
      "name": "catch-all",
      "jsonPath": "$",
      "promptTemplate": "Process this message",
      "agentId": "default-agent"
    }
  ]
}
```

### Переменные окружения

```bash
# Required
export KAFKA_BROKERS="localhost:9092"
export KAFKA_CLIENT_ID="kafka-router-plugin"
export KAFKA_GROUP_ID="kafka-router-consumer"

# Optional
export KAFKA_SSL="false"
export KAFKA_USERNAME=""
export KAFKA_PASSWORD=""
export KAFKA_DLQ_TOPIC=""
export KAFKA_ROUTER_CONFIG=".opencode/kafka-router.json"
export KAFKA_IGNORE_TOMBSTONES="false"
```

---

## 10. Метрики и мониторинг

### Структурированный JSON log

```typescript
console.log(JSON.stringify({
  level: 'info',
  event: 'message_processed',
  topic: 'test-input',
  partition: 0,
  offset: 123,
  matchedRule: 'math-question',
  processingTimeMs: 150,
  timestamp: new Date().toISOString(),
}));
```

### События

| Event | Level | Описание |
|-------|-------|----------|
| `kafka_consumer_starting` | info | Consumer начинает запуск |
| `kafka_consumer_started` | info | Consumer успешно запущен |
| `message_processed` | info | Сообщение обработано |
| `no_rule_matched` | info | Нет совпаде��ий с правилами |
| `dlq_sent` | info | Сообщение отправлено в DLQ |
| `dlq_rate` | info | Процент DLQ каждые 100 сообщений |
| `agent_invoke_success` | info | Agent успешно выполнен |
| `agent_invoke_failed` | error | Agent вернул ошибку |
| `graceful_shutdown_started` | info | Начало shutdown |
| `graceful_shutdown_completed` | info | Завершение shutdown |
| `plugin_start_failed` | error | Ошибка инициализации плагина |

---

## 11. Ограничения

| Ограничение | Значение | Описание |
|------------|----------|---------|
| Max topics | 5 | Максимум топиков для подписки |
| Max message size | 1MB | Лимит размера сообщения |
| Default timeout | 120s | Таймаут по умолчанию |
| Shutdown timeout | 15s | Timeout для graceful shutdown |
| Max concurrency | 1 | Параллельных сообщений (v1) |
| Max DLQ rate | configurable | Лимит DLQ сообщений |

---

## 12. Тестирование

### Unit Tests

```bash
npm run test  # Запуск unit тестов
```

```typescript
// tests/unit/routing.test.ts
describe('matchRuleV003', () => {
  it('matches rule with jsonPath', () => {
    const payload = { task: 'test' };
    const rules = [{ name: 't', jsonPath: '$.task', ... }];
    expect(matchRuleV003(payload, rules)).toEqual(rules[0]);
  });
  
  it('returns null when no match', () => {
    const payload = { foo: 'bar' };
    const rules = [{ name: 't', jsonPath: '$.task', ... }];
    expect(matchRuleV003(payload, rules)).toBeNull();
  });
});
```

### Integration Tests

```bash
npm run test:integration  # Redpanda + testcontainers
```

---

## 13. Troubleshooting

### Ошибки и решения

| Ошибка | Причина | Решение |
|--------|---------|----------|
| `KAFKA_BROKERS is required` | Не задана переменная | Установите KAFKA_BROKERS |
| `FR-017 topic coverage violation` | responseTopic = input topic | Измените responseTopic |
| `Topics without rules` | Топик без правил | Добавьте правило |
| `Message size exceeds maximum` | > 1MB | Уменьшите сообщение |
| `Failed to parse JSON` | Инвалидный JSON | Проверьте формат |
| `Agent timeout` | Timeout > 120s | Увеличьте timeoutMs |
| `Graceful shutdown timeout` | 15s insufficient | Кастомный exit |

---

## 14. Ссылки

- [KafkaJS Documentation](https://kafka.js.org/docs/)
- [JSONPath Plus](https://www.npmjs.com/package/jsonpath-plus)
- [Zod](https://zod.dev/)
- [Spec 003 - Kafka Consumer](https://github.com/opencode-ai/specs/tree/main/003-kafka-consumer)