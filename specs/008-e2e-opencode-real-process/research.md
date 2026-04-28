# Research: E2E-тесты с реальным OpenCode-процессом

**Date**: 2026-04-28 | **Feature**: 008-e2e-opencode-real-process

## R1: Integration tests используют MOCK Redpanda

**Контекст**: Существующий `tests/integration/setup.ts` содержит `MockStartedTestContainer` — возвращает `localhost:9092` без запуска контейнера.

**Decision**: Создать отдельный хелпер `tests/e2e/helpers/redpandaContainer.ts` с РЕАЛЬНЫМ Redpanda через `@testcontainers/redpanda`.

**Rationale**: E2E-тесты проверяют полный конвейер Kafka→Plugin→Agent→LLM. Mock Redpanda не позволяет проверить producer/consumer поведение.

**Alternatives considered**:
- Реиспользовать mock — отвергнуто: не тестирует реальный Kafka protocol
- Использовать внешний Redpanda cluster — отвергнуто: непереносимо, сложно в CI

## R2: SDKClient для подключения к opencode serve

**Контекст**: `OpenCodeAgentAdapter` принимает `SDKClient = { session: SessionsAPI }`. SDKClient — интерфейс с методами create/prompt/abort/delete/messages. Для продакшена SDK клиент инжектируется через PluginContext.

**Decision**: Создать HTTP-обёртку `createSDKClient({ baseURL })`, реализующую SessionsAPI через fetch к `opencode serve` HTTP API.

**Rationale**: 
- `opencode serve` expose HTTP API на заданном порту
- SDKClient интерфейс известен (из `src/types/opencode-sdk.d.ts`)
- HTTP-обёртка даёт полный контроль над base URL и error handling
- Не зависит от внутренних деталей `opencode` npm-пакета

**Alternatives considered**:
- Использовать `opencode` SDK с baseURL — нет гарантий, что SDK поддерживает custom URL
- Мокать SDKClient — отвергнуто: цель E2E — протестировать реальный путь

## R3: Consumer lifecycle management

**Контекст**: `startConsumer(config: PluginConfigV003, agent: IOpenCodeAgent): Promise<void>` запускает consumer. Читает env через `createKafkaClient(process.env)`. Consumer работает бесконечно до shutdown.

**Decision**: PluginRunner устанавливает `process.env` из переданного `env` объекта, вызывает `startConsumer(config, agent)`. Для shutdown — исследовать и использовать `performGracefulShutdown` или механизм shutdown signal из consumer.ts.

**Rationale**: 
- `startConsumer` уже читает из `process.env` — просто подменяем env
- Consumer запускается в async контексте — можно запустить и держать handle
- Shutdown — критически важен для предотвращения zombie consumers

**Alternatives considered**:
- Spawn отдельный Node.js процесс для consumer — слишком сложно, сложно отлаживать
- Mock consumer — отвергнуто: цель E2E — реальный consumer

## R4: Витест конфигурация для E2E

**Контекст**: Проект имеет 2 Vitest конфига: `vitest.config.ts` (unit) и `vitest.integration.config.ts` (integration). E2E нужен третий.

**Decision**: Создать `vitest.e2e.config.ts` с:
- `include: ['tests/e2e/**/*.e2e.test.ts']`
- `timeout: 120_000` (2 минуты — LLM ��ожет быть медленным)
- `hookTimeout: 60_000` (1 минута — для Redpanda startup)
- `pool: 'forks', singleFork: true` (sequential, один процесс)
- `env:` с дефолтными значениями Kafka env vars

**Rationale**: E2E тесты требуют:
- Большие таймауты (LLM inference)
- Sequential execution (один opencode serve процесс)
- Изоляция от unit/integration тестов
- Преднастроенные env vars

**Alternatives considered**:
- Добавить E2E в integration config — отвергнуто: разные таймауты и предусловия
- Использовать отдельный test runner — отвергнуто: vitest единообразен

## R5: e2e-responder agent конфигурация

**Контекст**: Проектный `.opencode/opencode.json` содержит 7 агентов. E2E нужен специализированный тестовый агент.

**Decision**: Добавить `e2e-responder` в секцию `agent` конфига:
- `mode: "subagent"` — вызывается как subagent через opencode serve
- `model: "lemonade/extra.Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF"` — использует Lemonade
- `temperature: 0.1` — максимально предсказуемые ответы
- `permission: deny all` — агент не должен иметь доступ к файлам/командам

**Rationale**:
- Низкий temperature + deny all permissions = предсказуемые, безопасные ответы
- Lemonade — единственный локальный LLM, настроенный в глобальном конфиге
- Subagent mode — корректный способ вызова через opencode serve API

**Alternatives considered**:
- Использовать general agent — отвергнуто: непредсказуемый, может использовать инструменты
- Создать отдельный конфиг для E2E — отвергнуто: opencode serve читает из `.opencode/`

## R6: opencode serve health check

**Контекст**: `opencode serve` запускается через `spawn('opencode', ['serve', '--port', '3001'])`. Нужно определить момент готовности.

**Decision**: Polling `GET /health` с интервалом 500ms и таймаутом 30s.

**Rationale**:
- `/health` — стандартный endpoint для health checks
- 30s достаточно для cold start с Lemonade
- 500ms polling interval — баланс между скоростью и нагрузкой

**Alternatives considered**:
- Wait for stdout log — хрупко, зависит от формата логов
- Fixed delay — ненадёжно, может быть мало или избыточно