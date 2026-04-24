# Research: OpenCode SDK Integration

**Feature**: 006-opencode-sdk-integration
**Date**: 2026-04-23
**Status**: Complete

## Обзор исследований

Все технические решения приняты на основе ADR-001...ADR-007 и пользовательских требований (FR-001...FR-020, NFR-001...NFR-006). Нет нерешённых вопросов.

## Ключевые решения

### 1. Подход интеграции с OpenCode SDK

- **Decision**: Использовать `ctx.client` из PluginContext напрямую через mockable interface IOpenCodeAgent
- **Rationale**: Плагин получает SDK клиент в контексте — нет необходимости создавать его вручную. Mockable interface обеспечивает 90%+ test coverage без реального SDK.
- **Alternatives considered**: CLI подход (`opencode run` через shell), прямое использование SDK без interface
- **Source**: [ADR-001](../../docs/architecture/ADR-001-opencode-sdk-integration.md)

### 2. Типы и схемы

- **Decision**: RuleV003Schema расширена с agentId (required), responseTopic (optional), timeoutSeconds (default 120), concurrency (default 1, игнорируется в v1). SDK типы объявлены в opencode-sdk.d.ts (свои, без зависимости от @opencode-ai/sdk)
- **Rationale**: agentId обязателен для fail-fast. Свои типы — нет runtime зависимости.
- **Alternatives considered**: Установка @opencode-ai/sdk как dependency, optional agentId с default
- **Source**: [ADR-002](../../docs/architecture/ADR-002-types-and-schemas.md)

### 3. Integration Layer

- **Decision**: IOpenCodeAgent interface с OpenCodeAgentAdapter (real) и MockOpenCodeAgent (tests). extractResponseText: фильтрация по type='text', join через \n\n
- **Rationale**: Mockable interface — ключевое решение для testability. Две реализации: production и test.
- **Alternatives considered**: Прямой вызов SDK в consumer, wrapper класс без interface
- **Source**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md)

### 4. Consumer Integration

- **Decision**: eachMessageHandler 10-step flow (tombstone → size → parse → match → build → invoke → response/DLQ → commit). Response producer optional. DLQ для всех ошибок. No retry.
- **Rationale**: Sequential processing обеспечивает backpressure. Commit offset после обработки — at-least-once semantics.
- **Alternatives considered**: Parallel processing, retry с exponential backoff, async prompt
- **Source**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md)

### 5. Event Hooks

- **Decision**: Минимум один hook — session.error для observability. Не влияет на Kafka message processing.
- **Rationale**: Simplicity First — минимальный набор для logging. DLQ остаётся primary error mechanism.
- **Alternatives considered**: Полный набор hooks (session.created, session.idle, message.*), пустые hooks
- **Source**: [ADR-005](../../docs/architecture/ADR-005-event-hooks.md)

### 6. Timeout Handling

- **Decision**: Promise.race() с timeout 120s. Best-effort abort при timeout — пытаемся abort session, ошибки логируются не бросаются.
- **Rationale**: Агент не должен выполняться бесконечно. Best-effort abort — чистый approach без сложного cleanup.
- **Alternatives considered**: Нет timeout (безлимит), aggressive cleanup с guaranteed abort
- **Source**: [ADR-003](../../docs/architecture/ADR-003-integration-layer.md)

### 7. Graceful Shutdown

- **Decision**: SIGTERM → Promise.allSettled(abort all active sessions) → disconnect consumer → disconnect producers. Total timeout 15s.
- **Rationale**: Корректное завершение без потери данных. Active sessions abort — best-effort.
- **Alternatives considered**: Immediate disconnect без abort, дожидаться completion всех sessions
- **Source**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md)

### 8. Response Format

- **Decision**: JSON с { messageKey, sessionId, ruleName, agentId, response, status: 'success', executionTimeMs, timestamp }. Kafka message key = sessionId.
- **Rationale**: messageKey для корреляции запрос-ответ. sessionId как Kafka key для partition affinity.
- **Alternatives considered**: Только sessionId без messageKey, random keys
- **Source**: [ADR-004](../../docs/architecture/ADR-004-consumer-integration.md)

## Лучшая практика: OpenCode Plugin Development

### Из исследования реальных плагинов (plannotator, opencode-scheduler):

1. **PluginContext**: `ctx.client` — типизированный SDK клиент, доступен напрямую. НЕ нужно создавать через `createOpencode()`.
2. **Session creation**: `ctx.client.session.create({ body: { title: "..." } })` → session с id
3. **Prompt**: `ctx.client.session.prompt({ path: { id: sessionId }, body: { parts: [...], agent: "..." } })` → AssistantMessage
4. **Messages**: `ctx.client.session.messages({ path: { id: sessionId } })` → Message[]
5. **Abort**: `ctx.client.session.abort({ path: { id: sessionId } })` → boolean

### Паттерн из plannotator:

```typescript
// Прямое использование ctx.client — без wrapper
await ctx.client.session.prompt({
  path: { id: sessionId },
  body: { agent: targetAgent, parts: [...] }
})
```

### Паттерн из scheduler (CLI, не рекомендуется):

```bash
opencode run --agent code-executor --attach http://localhost:4096 "prompt"
```

CLI подход НЕ используется — мы используем SDK через PluginContext.

## Open Questions

Нет нерешённых вопросов. Все решения утверждены пользователем:

- Timeout: 120s ✅
- Concurrency: sequential (1) в v1 ✅
- Retry: нет, только DLQ ✅
- Error в responseTopic: нет, только DLQ ✅
- SDK типы: свои (не пакет) ✅
- agentId validation: syntax-only при startup ✅
- Orphan sessions: best-effort abort в v1 ✅