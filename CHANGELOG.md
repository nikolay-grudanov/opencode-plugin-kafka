# История изменений

Все значимые изменения этого проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru-RU/),
 и проект придерживается [Семантического Версионирования](https://semver.org/lang/ru/).

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