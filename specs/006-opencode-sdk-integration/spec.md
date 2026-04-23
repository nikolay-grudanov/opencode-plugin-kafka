# Feature Specification: OpenCode SDK Integration

**Feature Branch**: `006-opencode-sdk-integration`
**Created**: 2026-04-23
**Status**: Draft
**Input**: Интеграция Kafka consumer с OpenCode SDK для вызова агентов по сообщениям из Kafka топиков

---

## Архитектурный контекст

Спецификация основана на архитектурных решениях, задокументированных в ADR:

| ADR | Описание |
|-----|----------|
| [ADR-001](../../docs/architecture/ADR-001-opencode-sdk-integration.md) | Выбор подхода интеграции с OpenCode SDK |
| [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md) | Типы и схемы (PluginContext, RuleV003Schema) |
| [ADR-003](../../docs/architecture/ADR-003-integration-layer.md) | Integration Layer (IOpenCodeAgent, Adapter, Mock) |
| [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md) | Consumer integration, response producer, graceful shutdown |
| [ADR-005](../../docs/architecture/ADR-005-event-hooks.md) | Event hooks (session.error) |
| [ADR-006](../../docs/architecture/ADR-006-architecture-diagram.md) | Архитектурные диаграммы |
| [ADR-007](../../docs/architecture/ADR-007-validation.md) | Валидация конституции и coverage |

---

## 1. User Scenarios & Testing

### User Story 1 — Автоматический запуск OpenCode агента по Kafka сообщению (Priority: P1)

Внешняя система отправляет сообщение в Kafka топик → плагин маршрутизирует сообщение по JSONPath правилу → извлекает промпт из promptTemplate → вызывает OpenCode агента → возвращает результат в optional response топик.

**Why this priority**: Core functionality — без этого плагин бесполезен. Это основная ценность интеграции.

**Independent Test**: Можно протестировать end-to-end: отправить сообщение в Kafka топик → проверить что OpenCode агент был вызван с правильным промптом → проверить ответ в response топике (если настроен).

**Acceptance Scenarios**:

1. **Given** Kafka топик содержит сообщение с полем `{"vulnerabilities": [{"severity": "CRITICAL", "cve": "CVE-2024-1234"}]}`, **When** JSONPath правило `$.vulnerabilities[?(@.severity=="CRITICAL")]` совпадает, **Then** OpenCode агент вызывается с промптом "Analyze critical vulnerabilities: [извлечённые данные]" и `agentId` из конфига

2. **Given** OpenCode агент вернул ответ "Vulnerability found in libfoo.so", **When** правило содержит `responseTopic: "output-topic"`, **Then** ответ отправляется в Kafka топик "output-topic" с форматом `{sessionId, ruleName, agentId, messageKey, response, status, executionTimeMs, timestamp}`

3. **Given** OpenCode агент timed out (120s по умолчанию), **When** timeout истёк, **Then** best-effort abort сессии → сообщение уходит в DLQ с ошибкой "Agent timeout after 120s"

4. **Given** Конфигурация содержит невалидный `agentId: ""`, **When** плагин стартует, **Then** ошибка валидации "Agent ID is required" падает immediately (fail-fast)

---

### User Story 2 — Обработка ошибок через DLQ (Priority: P2)

Все ошибки обработки сообщений (парсинг, таймауты, ошибки агента) отправляются в DLQ топик для повторной обработки или анализа.

**Why this priority**: Constitution Principle III: Resiliency — ошибки не должны крашить consumer. DLQ обеспечивает visibility и возможность retry.

**Independent Test**: Отправить malformed JSON в Kafka → проверить что сообщение попало в DLQ топик с оригинальным value и ошибкой парсинга.

**Acceptance Scenarios**:

1. **Given** Сообщение содержит невалидный JSON `"{invalid: }"`, **When** парсинг JSON выбрасывает ошибку, **Then** сообщение отправляется в DLQ топик с оригинальным value, топиком, partition, offset и error message

2. **Given** OpenCode агент вернул `status: "error"` (agent execution failed), **When** agentResult.status === 'error', **Then** сообщение отправляется в DLQ топик с error message

3. **Given** Размер сообщения 2MB, **When** валидация размера превышает 1MB, **Then** сообщение отправляется в DLQ топик с ошибкой "Message size exceeds maximum"

4. **Given** DLQ топик недоступен, **When** отправка в DLQ падает, **Then** логируется error, commit offset НЕ делается (сообщение будет повторено)

---

### User Story 3 — Graceful shutdown (Priority: P3)

При получении SIGTERM/SIGINT плагин корректно завершает работу: прерывает активные сессии → disconnect consumer → disconnect producers.

**Why this priority**: Clean shutdown предотвращает orphan сессии в OpenCode и корректно завершает Kafka connections.

**Independent Test**: Запустить consumer → отправить SIGTERM → проверить что все соединения закрыты и логируется graceful shutdown completed.

**Acceptance Scenarios**:

1. **Given** Consumer обрабатывает сообщение, **When** получен SIGTERM, **Then** текущее сообщение дообрабатывается → abort активных сессий → disconnect consumer → disconnect producers

2. **Given** Graceful shutdown занимает больше 15s, **When** timeout истёк, **Then** force exit с кодом 1

3. **Given** Multiple producers (DLQ + response), **When** shutdown, **Then** все producersdisconnect последовательно

---

### Edge Cases

- **Tombstone message (null value)**: По умолчанию отправляется в DLQ. Если `KAFKA_IGNORE_TOMBSTONES=true` → commit без обработки.
- **Message exceeds MAX_MESSAGE_SIZE (1MB)**: Отправляется в DLQ с ошибкой размера.
- **No matching rule**: Логируется "no rule matched" → commit offset → continue.
- **Response send failure**: Логируется error → commit offset делается (ответ не critical для обработки Kafka сообщения).
- **JSON parse error**: Отправляется в DLQ с оригинальным value и error message.
- **Empty responseTopic**: Ответ не отправляется в Kafka (достаточно логов).

---

## 2. Requirements

### 2.1 Functional Requirements

| FR # | Файл | Описание | Детали |
|------|------|----------|--------|
| FR-001 | `src/index.ts` | Plugin Entry Point | plugin function создаёт OpenCodeAgentAdapter, вызывает startConsumer, возвращает session.error hook, try-catch wrapper |
| FR-002 | `src/core/config.ts` | Configuration Parsing | parseConfigV003 читает KAFKA_ROUTER_CONFIG, валидирует через Zod, fail-fast при ошибках |
| FR-003 | `src/schemas/index.ts` | RuleV003Schema | `name`, `jsonPath`, `promptTemplate`, `agentId` (required), `responseTopic` (optional), `timeoutSeconds` (default 120), `concurrency` (default 1) |
| FR-004 | `src/types/opencode-sdk.d.ts` | SDK Type Declarations | `SDKClient`, `SessionsAPI`, `Session`, `AssistantMessage`, `MessagePart` — минимальные типы только для используемых методов |
| FR-005 | `src/types/opencode-plugin.d.ts` | PluginContext Type | `{client, project, directory, worktree, $}` — структура контекста от OpenCode |
| FR-006 | `src/opencode/IOpenCodeAgent.ts` | IOpenCodeAgent Interface | `invoke(prompt, agentId, options)` + `abort(sessionId)` — mockable интерфейс |
| FR-007 | `src/opencode/OpenCodeAgentAdapter.ts` | OpenCodeAgentAdapter | create session → prompt → race с timeout → extractResponseText → delete session. Best-effort abort на timeout |
| FR-008 | `src/opencode/MockOpenCodeAgent.ts` | MockOpenCodeAgent | MockConfig: `{responses, delayMs, shouldFail, shouldTimeout}` — для unit tests |
| FR-009 | `src/opencode/AgentError.ts` | AgentError Classes | `TimeoutError`, `AgentError` — кастомные классы ошибок |
| FR-010 | `src/kafka/client.ts` | Kafka Client | `createKafkaClient`, `createConsumer`, `createDlqProducer`, `createResponseProducer` — factory functions |
| FR-011 | `src/core/routing.ts` | Message Routing | matchRuleV003 — pure function, возвращает первое совпавшее Rule или null |
| FR-012 | `src/core/prompt.ts` | Prompt Building | buildPromptV003 — pure function, подставляет `{{$.field.path}}` из payload |
| FR-013 | `src/kafka/consumer.ts` | eachMessageHandler | 10-step flow: tombstone → size → parse → match → build → invoke → response/DLQ → commit |
| FR-014 | `src/kafka/response-producer.ts` | Response Producer | sendResponse — отправляет `{messageKey, sessionId, ruleName, agentId, response, status, executionTimeMs, timestamp}` |
| FR-015 | `src/kafka/dlq.ts` | DLQ | sendToDlq — envelope format с оригинальным value, topic, partition, offset, error |
| FR-016 | `src/kafka/consumer.ts` | Graceful Shutdown | abort sessions → disconnect consumer → disconnect producers. 15s timeout |
| FR-017 | `src/core/config.ts` | Topic Coverage Validation | responseTopic ≠ input topics — валидация при старте (если responseTopic указан) |
| FR-018 | `src/kafka/consumer.ts` | ConsumerState | `{isShuttingDown, totalMessagesProcessed, dlqMessagesCount, lastDlqRateLogTime}` |
| FR-019 | `src/kafka/consumer.ts` | Structured Logging | JSON.stringify для всех логов — `{level, event, timestamp, ...}` |
| FR-020 | `src/kafka/consumer.ts` | MAX_MESSAGE_SIZE | 1_048_576 bytes (1MB) — валидация размера сообщения |

### 2.2 Non-Functional Requirements

| NFR # | Требование | Детали |
|------|------------|--------|
| NFR-001 | Test Coverage | 90%+ coverage (lines, branches, functions, statements) |
| NFR-002 | Test Files | 6 specific test files: agent-adapter, mock-agent, extract-response, response-producer, consumer, integration |
| NFR-003 | Test Scenarios | 8 mandatory scenarios (см. раздел 6.2) |
| NFR-004 | No Retry Logic | Никаких retry — fail-fast с отправкой в DLQ |
| NFR-005 | Sequential Processing | Следующее сообщение начинается после завершения текущего (no parallelism) |
| NFR-006 | Breaking Change Notice | agentId required — clear migration guide |

### 2.3 Constraints

- **No new npm dependencies** (except testcontainers в devDependencies)
- **No `any` types** в production коде
- **No raw console.log strings** — только JSON.stringify
- **`allowAutoTopicCreation: false`** на всех producers
- **`autoCommit: false`** на consumer (manual commitOffsets)

### 2.4 Key Entities

```typescript
// RuleV003 — расширенная схема правила
interface RuleV003 {
  name: string;                    // Уникальное имя правила
  jsonPath: string;                // JSONPath выражение
  promptTemplate: string;         // Шаблон промпта с {{$.field.path}}
  agentId: string;                 // ID агента OpenCode (REQUIRED)
  responseTopic?: string;         // Топик для ответа (optional)
  timeoutSeconds?: number;        // Timeout в секундах (default: 120)
  concurrency?: number;          // Параллельные сообщения (default: 1, v1 only)
}

// AgentResult — результат вызова агента
interface AgentResult {
  status: 'success' | 'error' | 'timeout';
  response?: string;             // Текст ответа (если success)
  sessionId: string;             // ID сессии
  errorMessage?: string;        // Сообщение ошибки (если error/timeout)
  executionTimeMs: number;       // Время выполнения
  timestamp: string;             // ISO timestamp завершения
}

// ResponseMessage — формат ответа для Kafka
interface ResponseMessage {
  messageKey: string;           // Key исходного сообщения
  sessionId: string;             // ID сессии OpenCode
  ruleName: string;              // Имя совпавшего правила
  agentId: string;              // ID вызванного агента
  response: string;             // Текст ответа
  status: 'success';            // Статус выполнения
  executionTimeMs: number;      // Время выполнения
  timestamp: string;            // ISO timestamp
}

// ConsumerState — состояние consumer
interface ConsumerState {
  isShuttingDown: boolean;      // Флаг shutdown
  totalMessagesProcessed: number;// Обработано сообщений
  dlqMessagesCount: number;    // Отправлено в DLQ
  lastDlqRateLogTime: number;   // Последнее время логирования DLQ rate
}

// PluginContext — контекст от OpenCode
interface PluginContext {
  client: SDKClient;            // OpenCode SDK client
  project: Project;              // Метаданные проекта
  directory: string;            // Рабочая директория
  worktree: string;             // Git root директория
  $: BunShell;                 // Shell API
}

// IOpenCodeAgent — интерфейс агента
interface IOpenCodeAgent {
  invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult>;
  abort(sessionId: string): Promise<boolean>;
}
```

---

## 3. Success Criteria

### Measurable Outcomes

| SC # | Критерий | Целевое значение |
|------|----------|-----------------|
| SC-001 | Test Coverage | ≥ 90% (lines, branches, functions, statements) |
| SC-002 | Zero Data Loss | Каждое сообщение либо обработано, либо в DLQ |
| SC-003 | Sequential Processing | Обратное давление на Kafka consumer |
| SC-004 | Fail-fast | Невалидная конфигурация падает при старте |
| SC-005 | Structured JSON Logging | Все логи в формате `{level, event, timestamp, ...}` |
| SC-006 | Timeout | Агент не выполняется дольше 120s по умолчанию |
| SC-007 | Graceful Shutdown | shutdown за 15s |

---

## 4. File-by-File Implementation Plan

### 4.1 src/types/opencode-sdk.d.ts

**Путь**: `src/types/opencode-sdk.d.ts`

**Экспорты**: Type declarations (no runtime code)

> **ADR**: [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md) — определение типов SDK (SDKClient, SessionsAPI, Session, Message, MessagePart)

**Сигнатуры**:

```typescript
// SDK Client
interface SDKClient {
  session: SessionsAPI;
}

// Sessions API
interface SessionsAPI {
  create(params: { body: { title: string } }): Promise<Session>;
  prompt(params: { path: { id: string }; body: PromptParams }): Promise<AssistantMessage>;
  abort(params: { path: { id: string } }): Promise<boolean>;
  messages(params: { path: { id: string } }): Promise<Message[]>;
  delete(params: { path: { id: string } }): Promise<boolean>;
}

// Session
interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

// Message
interface Message {
  id: string;
  type: 'text' | 'code' | 'image' | 'file';
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  createdAt: string;
}

// AssistantMessage (extends Message)
interface AssistantMessage extends Message {
  role: 'assistant';
  metadata?: Record<string, unknown>;
}

// MessagePart
interface MessagePart {
  type: 'text' | 'code' | 'image' | 'file';
  text?: string;
  code?: string;
  language?: string;
  filePath?: string;
  [key: string]: unknown;
}

// PromptParams
interface PromptParams {
  agent?: string;
  noReply?: boolean;
  parts: MessagePart[];
}
```

**Логика**: Минимальные типы только для используемых методов SDK. Следует ADR-002 Wahl #2.

---

### 4.2 src/types/opencode-plugin.d.ts

**Путь**: `src/types/opencode-plugin.d.ts`

**Экспорты**: Type declarations

**Сигнатуры**:

```typescript
// Plugin context from OpenCode
interface PluginContext {
  client: SDKClient;
  project: Project;
  directory: string;
  worktree: string;
  $: BunShell;
}

// Project metadata
interface Project {
  id: string;
  name: string;
  path: string;
  repository?: {
    provider: 'github' | 'gitlab' | 'bitbucket';
    owner: string;
    repo: string;
    branch: string;
  };
}

// BunShell API
interface BunShell {
  $: (command: string) => Promise<string>;
}

// Plugin hooks (minimal)
interface PluginHooks {
  "session.error"?: (params: { sessionId: string; error: unknown }) => Promise<void>;
}
```

**Логика**: Определяем типы PluginContext и PluginHooks. Следует ADR-002.

> **ADR**: [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md) — типы PluginContext и PluginHooks

---

### 4.3 src/schemas/index.ts (Изменения)

**Путь**: `src/schemas/index.ts`

**Изменения**: Обновить RuleV003Schema с новыми полями

**Сигнатуры**:

```typescript
// Updated RuleV003Schema
export const RuleV003Schema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  jsonPath: z.string().min(1, 'JSONPath expression is required'),
  promptTemplate: z.string().min(1, 'Prompt template is required'),
  // OpenCode integration fields
  agentId: z.string().min(1, 'Agent ID is required'),
  responseTopic: z.string().optional(),
  timeoutSeconds: z.number().int().min(10).max(3600).default(120),
  concurrency: z.number().int().min(1).max(10).default(1),
});

// TypeScript type
export type RuleV003 = z.infer<typeof RuleV003Schema>;
```

**FR**: FR-003 (RuleV003Schema)

> **ADR**: [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md) — схема RuleV003Schema с полями agentId, responseTopic, timeoutSeconds, concurrency

---

### 4.4 src/core/config.ts (Изменения)

**Путь**: `src/core/config.ts`

**Изменения**: Добавить FR-017 topic coverage validation

**Сигнатуры**:

```typescript
// parseConfig (изменённая)
export function parseConfigV003(): PluginConfigV003 {
  // 1. Читаем конфиг из KAFKA_ROUTER_CONFIG
  // 2. Валидируем через Zod
  // 3. FR-017: responseTopic ≠ input topics
  // 4. Возвращаем валидный конфиг или бросаем ошибку
}

// validateTopicCoverage (новая функция)
function validateTopicCoverage(config: PluginConfigV003): void {
  // Для каждого правила с responseTopic:
  // responseTopic НЕ должен совпадать с input topics из config.topics
  // Если совпадает → throw Error("responseTopic cannot be one of input topics")
}
```

**FR**: FR-002 (parseConfig), FR-017 (topic coverage validation)

**Логика**: fail-fast при невалидной конфигурации. Следует Constitution Principle I.

> **ADR**: [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md) — парсинг конфига через Zod; [ADR-007](../../docs/architecture/ADR-007-validation.md) — FR-017 topic coverage validation

---

### 4.5 src/core/routing.ts

**Путь**: `src/core/routing.ts`

**Экспорты**: `matchRuleV003`

**Сигнатуры**:

```typescript
export function matchRuleV003(
  payload: unknown,
  rules: RuleV003[]
): RuleV003 | null {
  // Pure function — нет side effects
  // Для каждого правила evaluate jsonPath
  // Возвращает первое совпавшее Rule или null
}
```

**FR**: FR-011 (Message Routing)

**Логика**: Pure function, легко тестируется. Следует Constitution Principle II.

> **ADR**: [ADR-007](../../docs/architecture/ADR-007-validation.md) — Domain Isolation (pure function без side effects)

---

### 4.6 src/core/prompt.ts

**Путь**: `src/core/prompt.ts`

**Экспорты**: `buildPromptV003`

**Сигнатуры**:

```typescript
export function buildPromptV003(
  rule: RuleV003,
  payload: unknown
): string {
  // Pure function — нет side effects
  // Находит все {{$.field.path}} в promptTemplate
  // Заменяет на значения из payload
  // Возвращает готовый промпт
  // Если поле не найдено → fallback или оригинальный текст
}
```

**FR**: FR-012 (Prompt Building)

**Логика**: Pure function, String() для примитивов. Следует Constitution Principle II.

> **ADR**: [ADR-007](../../docs/architecture/ADR-007-validation.md) — Domain Isolation (pure function без side effects)

---

### 4.7 src/opencode/IOpenCodeAgent.ts

**Путь**: `src/opencode/IOpenCodeAgent.ts`

**Экспорты**: `IOpenCodeAgent`, `InvokeOptions`, `AgentResult`

**Сигнатуры**:

```typescript
export interface IOpenCodeAgent {
  invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions
  ): Promise<AgentResult>;
  
  abort(sessionId: string): Promise<boolean>;
}

export interface InvokeOptions {
  timeoutSeconds?: number;  // default: 120
  metadata?: Record<string, unknown>;
}

export interface AgentResult {
  status: 'success' | 'error' | 'timeout';
  response?: string;
  sessionId: string;
  errorMessage?: string;
  executionTimeMs: number;
  timestamp: string;
}
```

**FR**: FR-006 (IOpenCodeAgent Interface)

**Логика**: Mockable интерфейс для изоляции зависимостей. Следует ADR-003 Wahl #2.

> **ADR**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md) — IOpenCodeAgent interface (mockable abstraction)

---

### 4.8 src/opencode/OpenCodeAgentAdapter.ts

**Путь**: `src/opencode/OpenCodeAgentAdapter.ts`

**Экспорты**: `OpenCodeAgentAdapter`

**Сигнатуры**:

```typescript
export class OpenCodeAgentAdapter implements IOpenCodeAgent {
  constructor(private readonly sdkClient: SDKClient) {}
  
  async invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions = {}
  ): Promise<AgentResult> {
    // 1. Создаём сессию: client.session.create()
    // 2. Создаём timeout promise
    // 3. Prompt + race с timeout: client.session.prompt()
    // 4. Извлекаем текст: client.session.messages()
    // 5. Удаляем сессию: client.session.delete()
    // 6. Возвращаем AgentResult
    // При timeout: best-effort abort, return status: 'timeout'
    // При error: return status: 'error'
  }
  
  async abort(sessionId: string): Promise<boolean> {
    // client.session.abort() с error handling
  }
  
  private extractResponseText(messages: Message[]): string {
    // Фильтруем только type: 'text'
    // join через '\n\n'
  }
}
```

**FR**: FR-007 (OpenCodeAgentAdapter)

**Логика**: Реализует IOpenCodeAgent через real SDK. Timeout handling через Promise.race(). Best-effort abort.

> **ADR**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md) — OpenCodeAgentAdapter (SDK integration, timeout, response extraction)

---

### 4.9 src/opencode/MockOpenCodeAgent.ts

**Путь**: `src/opencode/MockOpenCodeAgent.ts`

**Экспорты**: `MockOpenCodeAgent`, `MockConfig`

**Сигнатуры**:

```typescript
export interface MockConfig {
  responses: Record<string, string>;  // agentId → response
  delayMs?: number;                 // Имитация задержки
  shouldFail?: boolean;             // Имитация ошибки агента
  shouldTimeout?: boolean;           // Имитация timeout
}

export class MockOpenCodeAgent implements IOpenCodeAgent {
  constructor(private readonly config: MockConfig) {}
  
  async invoke(...): Promise<AgentResult> {
    // Возвращает мок ответ на основе config
    // Поддерживает delayMs, shouldFail, shouldTimeout
  }
  
  async abort(sessionId: string): Promise<boolean> {
    // Удаляет sessionId из activeSessions
  }
  
  getActiveSessionCount(): number {
    // Для тестов
  }
}
```

**FR**: FR-008 (MockOpenCodeAgent)

**Логика**: Mock для unit tests. Позволяет достичь 90%+ coverage.

> **ADR**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md) — MockOpenCodeAgent (mockable interface для тестирования)

---

### 4.10 src/opencode/AgentError.ts

**Путь**: `src/opencode/AgentError.ts`

**Экспорты**: `TimeoutError`, `AgentError`

**Сигнатуры**:

```typescript
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AgentError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'AgentError';
  }
}
```

**FR**: FR-009 (AgentError Classes)

**Логика**: Кастомные классы ошибок для区分 timeout и agent errors.

> **ADR**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md) — TimeoutError, AgentError (кастомные ошибки)

---

### 4.11 src/kafka/client.ts (Изменения)

**Путь**: `src/kafka/client.ts`

**Изменения**: Добавить `createResponseProducer`

**Сигнатуры**:

```typescript
export function createKafkaClient(env: NodeJS.ProcessEnv): {
  kafka: Kafka;
  validatedEnv: KafkaEnv;
}

export function createConsumer(kafka: Kafka, groupId: string): Consumer {
  // kafka.consumer({ groupId, autoCommit: false })
}

export function createDlqProducer(kafka: Kafka): Producer {
  // kafka.producer({ allowAutoTopicCreation: false })
}

// NEW: Response producer
export function createResponseProducer(kafka: Kafka): Producer {
  // kafka.producer({ allowAutoTopicCreation: false })
}
```

**FR**: FR-010 (Kafka Client)

**Логика**: Factory functions для Kafka компонентов. ensure `allowAutoTopicCreation: false`.

> **ADR**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md) — createResponseProducer factory

---

### 4.12 src/kafka/consumer.ts (Изменения)

**Путь**: `src/kafka/consumer.ts`

**Изменения**: Обновить eachMessageHandler, performGracefulShutdown, startConsumer

**Сигнатуры**:

```typescript
// Updated signature — добавляем agent и responseProducer
export async function eachMessageHandler(
  payload: EachMessagePayload,
  config: PluginConfigV003,
  dlqProducer: Producer,
  responseProducer: Producer,  // NEW
  commitOffsets: CommitOffsetsFn,
  agent: IOpenCodeAgent,      // NEW
  state: ConsumerState,
): Promise<void> {
  // 1. Проверка shutdown
  // 2. Tombstone check
  // 3. Size validation (MAX_MESSAGE_SIZE)
  // 4. JSON parse
  // 5. matchRuleV003
  // 6. buildPromptV003
  // 7. INVOKE AGENT (NEW)
  // 8. Send response if responseTopic (NEW)
  // 9. Send to DLQ if error/timeout (NEW)
  // 10. Commit offset
}

// Updated graceful shutdown
export async function performGracefulShutdown(
  consumer: Consumer,
  dlqProducer: Producer,
  responseProducer: Producer,  // NEW
  signal: string,
  state: ConsumerState,
  exitFn?: (code: number) => never,
): Promise<void> {
  // 1. Abort active sessions (NEW)
  // 2. Disconnect consumer
  // 3. Disconnect dlqProducer
  // 4. Disconnect responseProducer (NEW)
  // 5. Timeout 15s
}

// Updated startConsumer
export async function startConsumer(
  config: PluginConfigV003,
  agent: IOpenCodeAgent,  // NEW
): Promise<void> {
  // 1. createKafkaClient
  // 2. createConsumer
  // 3. createDlqProducer
  // 4. createResponseProducer (NEW)
  // 5. state with metrics
  // 6. connect consumer + producers
  // 7. subscribe to topics
  // 8. register SIGTERM/SIGINT handlers
  // 9. consumer.run with agent
}
```

**FR**: FR-013 (eachMessageHandler), FR-016 (Graceful Shutdown), FR-018 (ConsumerState), FR-019 (Structured Logging), FR-020 (MAX_MESSAGE_SIZE)

**Логика**: 10-step flow. Try-catch для resilience. Следует Constitution Principle III.

> **ADR**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md) — eachMessageHandler, response producer, graceful shutdown, DLQ handling

---

### 4.13 src/kafka/response-producer.ts (Новый файл)

**П��ть**: `src/kafka/response-producer.ts`

**Экспорты**: `sendResponse`

**Сигнатуры**:

```typescript
export interface ResponseMessage {
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
  response: ResponseMessage,
): Promise<void> {
  // producer.send({
  //   topic,
  //   messages: [{ value: JSON.stringify(response), key: response.sessionId }]
  // })
  // On error: логируем error, НЕ бросаем exception
  // Commit offset делается в eachMessageHandler
}
```

**FR**: FR-014 (Response Producer)

**Логика**: Optional — только если responseTopic указан. Error handling без DLQ.

> **ADR**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md) — response producer для отправки ответов в Kafka

---

### 4.14 src/kafka/dlq.ts

**Путь**: `src/kafka/dlq.ts`

**Экспорты**: `sendToDlq`

**Сигнатуры**:

```typescript
export interface DlqEnvelope {
  originalValue: string | null;  // Оригинальное значение сообщения
  topic: string;               // Топик источник
  partition: number;          // Partition
  offset: string;           // Offset
  error: string;             // Error message
  timestamp: string;        // Timestamp
}

export async function sendToDlq(
  producer: Producer,
  envelope: DlqEnvelope,
): Promise<void> {
  // producer.send({
  //   topic: dlqTopic,
  //   messages: [{ value: JSON.stringify(envelope) }]
  // })
}
```

**FR**: FR-015 (DLQ)

**Логика**: Envelope format для traceability.

> **ADR**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md) — DLQ handling для ошибок обработки

---

### 4.15 src/index.ts (Изменения)

**Путь**: `src/index.ts`

**Изменения**: Интегрировать OpenCodeAgentAdapter

**Сигнатуры**:

```typescript
import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';
import type { PluginContext } from './types/opencode-plugin.d.js';

export default async function plugin(context: PluginContext) {
  // 1. parseConfigV003() или бросаем error
  // 2. new OpenCodeAgentAdapter(context.client)
  // 3. startConsumer(config, agent)
  // 4. return { "session.error": hook } (опционально)
  //
  // Try-catch: логируем error → throw
}
```

**FR**: FR-001 (Plugin Entry Point)

**Логика**: Точка входа. Fail-fast при errors. Возвращает hooks.

> **ADR**: [ADR-001](../../docs/architecture/ADR-001-opencode-sdk-integration.md) — точка входа плагина; [ADR-005](../../docs/architecture/ADR-005-event-hooks.md) — session.error hook

---

## 5. Dependency Graph

```
src/index.ts
  ← src/opencode/OpenCodeAgentAdapter.ts
  ← src/kafka/consumer.ts
  ← src/core/config.ts
  ← src/schemas/index.ts
  ← src/types/opencode-plugin.d.ts

src/kafka/consumer.ts
  ← src/schemas/index.ts (PluginConfigV003)
  ← src/core/routing.ts (matchRuleV003)
  ← src/core/prompt.ts (buildPromptV003)
  ← src/kafka/dlq.ts (sendToDlq)
  ← src/kafka/client.ts (createKafkaClient, createConsumer, createDlqProducer)
  ← src/opencode/IOpenCodeAgent.ts (IOpenCodeAgent)
  ← src/kafka/response-producer.ts (sendResponse)

src/kafka/response-producer.ts
  ← kafkajs (Producer)

src/kafka/dlq.ts
  ← kafkajs (Producer)

src/kafka/client.ts
  ← kafkajs (Kafka, Consumer, Producer)
  ← src/schemas/index.ts (kafkaEnvSchema, KafkaEnv)

src/core/config.ts
  ← src/schemas/index.ts (RuleV003Schema, PluginConfigV003Schema)
  ← fs (читает KAFKA_ROUTER_CONFIG)

src/core/routing.ts
  ← jsonpath-plus (JSONPath)
  ← src/schemas/index.ts (RuleV003)

src/core/prompt.ts
  ← src/schemas/index.ts (RuleV003)

src/opencode/OpenCodeAgentAdapter.ts
  ← src/types/opencode-sdk.d.ts (SDKClient, Session, Message, etc.)
  ← src/opencode/IOpenCodeAgent.ts (IOpenCodeAgent, InvokeOptions, AgentResult)
  ← src/opencode/AgentError.ts (TimeoutError, AgentError)

src/opencode/MockOpenCodeAgent.ts
  ← src/opencode/IOpenCodeAgent.ts (IOpenCodeAgent, InvokeOptions, AgentResult)

src/types/opencode-sdk.d.ts
  ← (type declarations only)

src/types/opencode-plugin.d.ts
  ← src/types/opencode-sdk.d.ts (SDKClient)
```

---

## 6. Test Plan

### 6.1 Test Files

| Файл | Что тестирует | Зависимости |
|------|-------------|------------|
| `tests/unit/opencode/agent-adapter.test.ts` | OpenCodeAgentAdapter | Mocked SDKClient |
| `tests/unit/opencode/mock-agent.test.ts` | MockOpenCodeAgent | Нет |
| `tests/unit/opencode/extract-response.test.ts` | extractResponseText | Нет |
| `tests/unit/kafka/response-producer.test.ts` | sendResponse | Mocked Producer |
| `tests/unit/consumer.test.ts` | eachMessageHandler | MockOpenCodeAgent, Mocked Producer |
| `tests/integration/kafka-opencode.test.ts` | End-to-end | Redpanda + MockOpenCodeAgent |

### 6.2 Mandatory Test Scenarios (NFR-003)

Все 8 сценариев должны быть протестированы:

| # | Сценарий | Что тестируем | Как | Ожидаемый результат |
|---|---------|--------------|-----|-------------------|
| 1 | **Tombstone ignored** | `KAFKA_IGNORE_TOMBSTONES=true` | Отправить null value | Commit offset, нет DLQ |
| 2 | **Tombstone to DLQ** | Default behavior | Отправить null value | DLQ message, commit offset |
| 3 | **Oversized message** | MAX_MESSAGE_SIZE validation | Отправить 2MB message | DLQ message, commit offset |
| 4 | **JSON parse error** | JSON.parse failure | Отправить "{invalid:" | DLQ message, commit offset |
| 5 | **No matching rule** | matchRuleV003 | Отправить невалидный payload | Log "no rule matched", commit |
| 6 | **Success flow** | Full invoke flow | Valid message + matching rule | Response sent, commit offset |
| 7 | **Timeout flow** | Promise.race timeout | Mock timeout | DLQ message, commit offset |
| 8 | **Error flow** | Agent error | Mock agent error | DLQ message, commit offset |

> **ADR**: [ADR-006](../../docs/architecture/ADR-006-architecture-diagram.md) — диаграммы для понимания потоков; [ADR-007](../../docs/architecture/ADR-007-validation.md) — coverage ≥ 90%

---

## 7. Migration Guide

### Breaking Change: agentId required

Старые конфиги без `agentId` не будут валидны. Fail-fast при старте.

**До (v003 без agentId)**:
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

**После (v006 с agentId)**:
```json
{
  "topics": ["input-topic"],
  "rules": [
    {
      "name": "vuln-rule",
      "jsonPath": "$.vulnerabilities[*]",
      "promptTemplate": "Analyze: {{$.cve}}",
      "agentId": "security-analyzer",
      "responseTopic": "output-topic",
      "timeoutSeconds": 120
    }
  ]
}
```

---

## 8. Validation Checklist

- [ ] `npm run check` passes (lint + test)
- [ ] `npm run test:coverage` ≥ 90%
- [ ] No `any` types in codebase
- [ ] No raw `console.log` strings in production paths
- [ ] All producers use `allowAutoTopicCreation: false`
- [ ] Consumer uses `autoCommit: false`
- [ ] All 8 mandatory test scenarios pass

---

## 9. Assumptions

1. **OpenCode SDK**: Предоставляет `client.session.create()`, `client.session.prompt()`, `client.session.abort()`, `client.session.delete()`, `client.session.messages()` — минимальные методы
2. **Kafka**: Используется KafkaJS как client — требования к конфигурации из spec 003
3. **Redpanda**: Integration tests используют Redpanda (не Apache Kafka) — 10-100x быстрее в CI/CD
4. **Timeout default**: 120 секунд достаточно для большинства задач — конфигурируемо
5. **Response topic**: Опциональный — не всем пользователям нужен Kafka ответ, достаточно логов
6. **No retry**: DLQ для всех ошибок — fail-fast behavior
7. **Sequential processing**: Нет параллелизма — backpressure protection
8. **Graceful shutdown**: 15 секунд достаточно для cleanup

> **ADR**: [ADR-007](../../docs/architecture/ADR-007-validation.md) — валидация конституции