# История изменений

Все значимые изменения этого проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru-RU/),
 и проект придерживается [Семантического Версионирования](https://semver.org/lang/ru/).

## [0.4.0] — 2026-06-25

### Changed — spec-009: Tool-Based Response Delivery

ADR-009 (Tool-Based Response Delivery) supersedes parts of ADR-005 and
ADR-006 §5. The plugin no longer relies on `session.messages()` polling
to retrieve assistant responses — a mechanism that was unreliable
because the OpenCode SDK delivers LLM responses via SSE streaming
(`session.prompt()` returns `{data: undefined}`). Live debugging on
2026-06-24 confirmed 5/8 e2e tests were failing for this reason.

**New architecture** (registered via the official `@opencode-ai/plugin`
v1.16+ API):

1. The plugin registers one custom tool per Kafka rule with a
   `responseTopic`: `send_to_kafka_<sanitized_rule_name>`. The LLM
   invokes this tool to publish its final answer to Kafka.
2. The plugin subscribes to `Hooks.event` for `session.idle` and
   `message.part.updated`. The `session.idle` handler is the safety
   net — if the LLM did not call the tool and the rule has
   `fallbackToTextCapture=true`, the captured assistant text is
   published as success; otherwise (when `requireToolCall=true`), a
   DLQ envelope is sent.
3. A periodic wall-clock guard (`startMaxSessionGuard`) force-DLQs
   sessions exceeding `rule.maxSessionMs` without a tool call.
4. A legacy polling mode is preserved behind the
   `pollingFallback: true` toggle for older OpenCode versions or
   graceful rollback.

**Plugin-level toggles** (`kafka-router.json`, sibling of `topics` and
`rules`):
- `toolDelivery` (default `true`): register send_to_kafka_* tools.
- `eventHook` (default `true`): subscribe to `Hooks.event` for safety
  net and fallback text capture.
- `pollingFallback` (default `false`): use legacy spec-008 polling
  in `OpenCodeAgentAdapter.invoke()` instead of the tool-based async
  flow. Setting all three to `false` is rejected at startup
  (Constitution Principle III Resiliency).

**New per-rule fields** (all optional, defaults preserve existing
config compatibility):
- `requireToolCall` (default `true`): DLQ on missing tool call.
- `fallbackToTextCapture` (default `false`): publish captured text
  on session.idle instead of DLQ.
- `safetyNetTimeoutMs` (default `60000`): reserved for future
  per-session timeout enforcement.
- `maxSessionMs` (default `300000`): hard wall-clock guard.

### Fixed

- **Bug #3 (DLQ topic mismatch)**: `sendToDlq()` previously fell
  back to `${topic}-dlq` or `KAFKA_DLQ_TOPIC` env when the config
  had no explicit DLQ topic. The kafka-router.json now accepts an
  optional top-level `dlqTopic` field that takes precedence.
- **Plugin wrapper path bug**: `.opencode/plugins/kafka-router.js`
  imported the plugin entry from the wrong path (`../dist/...` →
  `.opencode/dist/...`). Plugin silently failed to load on every
  OpenCode startup, hiding downstream bugs. Fixed in commit
  `95b4474`.

### Added

- New modules: `src/opencode/tool-handler.ts`,
  `src/opencode/event-handler.ts`, `src/opencode/session-watchers.ts`.
- New e2e helper: `tests/e2e/helpers/perTestTopics.ts` (per-test
  topic isolation).
- `@opencode-ai/plugin` added to `dependencies`.
- `session.error` observability hook (already in 0.3.0,
  now properly exposed in `Hooks`).

### Migration from 0.3.x

Existing `kafka-router.json` configs work without changes:

- `topics`, `rules` (with their old fields) — unchanged.
- New fields have defaults matching the recommended behavior.
- New `toggles` block is optional (defaults applied).
- New `dlqTopic` is optional (falls back to env or computed name).

To enable the legacy polling mode (recommended only for older OpenCode
< 1.16 or as a rollback path):

```json
{
  "topics": [...],
  "rules": [...],
  "dlqTopic": "opencode.dlq",
  "toggles": {
    "toolDelivery": false,
    "eventHook": false,
    "pollingFallback": true
  }
}
```

To disable the safety net (eventHook) while keeping tool delivery
(use only when pollingFallback is enabled):

```json
{
  "toggles": {
    "toolDelivery": true,
    "eventHook": false,
    "pollingFallback": true
  }
}
```

### Test Coverage

- Unit: 760/760 passed (was 693 before spec-009; +67 new tests).
- Typecheck, lint, build: 0 errors.

## [0.3.0] — 2026-04-24

### Added

Новые модули для интеграции с OpenCode SDK:

- `src/opencode/IOpenCodeAgent.ts` — интерфейс агента с типами `AgentResult`, `InvokeOptions`
- `src/opencode/OpenCodeAgentAdapter.ts` — production адаптер с поддержкой timeout, abort, cleanup
- `src/opencode/MockOpenCodeAgent.ts` — mock-реализация для unit-тестов
- `src/opencode/AgentError.ts` — custom ошибки `TimeoutError`, `AgentError`
- `src/kafka/response-producer.ts` — отправка ответов агентов в `responseTopic`
- `src/types/opencode-sdk.d.ts` — TypeScript типы для SDKClient, SessionsAPI
- `src/types/opencode-plugin.d.ts` — типы PluginContext, PluginHooks

Обновления схем:

- `RuleV003Schema` — добавлены поля `agentId`, `responseTopic`, `timeoutMs`, `concurrency`

Новые функции:

- Автоматический вызов OpenCode агентов по Kafka сообщениям (JSONPath routing → buildPrompt → agent.invoke)
- Dead Letter Queue для обработки ошибок (parse, timeout, agent)
- Response producer для отправки ответов агентов в `responseTopic`
- Graceful shutdown (SIGTERM/SIGINT → abort sessions → disconnect, 15s timeout)
- AbortController для отмены операций
- Structured JSON logging
- Broker throttle retry (NFR-012)

### Changed

Обновлённые модули:

- `src/schemas/index.ts` — расширен `RuleV003Schema` новыми полями для agent integration
- `src/kafka/client.ts` — добавлена функция `createResponseProducer`
- `src/kafka/consumer.ts` — 10-step pipeline обработки сообщений, activeSessions с AbortController, graceful shutdown
- `src/core/config.ts` — добавлены `parseConfigV003`, `validateTopicCoverage` (FR-017)
- `src/index.ts` — plugin entry point с injection агента

### Fixed

Исправления из code review PR #5:

- Исправлена утечка памяти в `activeSessions` — очистка через try..finally в `eachMessageHandler`
- Исправлена утечка таймеров и слушателей в `OpenCodeAgentAdapter` — cleanup через finally блок
- Улучшен JSDoc для `createTimeoutPromise`, `createSignalPromise`
- Удалён устаревший JSDoc

## [0.2.0] — 2025-XX-XX

### Added

- Начальная реализация Kafka плагина для OpenCode
- Базовая маршрутизация сообщений через JSONPath
- Dead Letter Queue для обработки ошибок
- Zod валидация конфигурации
- Интеграционные тесты с Redpanda

## [0.1.0] — 2025-XX-XX

### Added

- Инициализация проекта
- Базовая структура плагина
- Конфигурация через environment variables