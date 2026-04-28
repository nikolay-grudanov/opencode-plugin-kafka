# Implementation Plan: E2E-тесты с реальным OpenCode-процессом

**Branch**: `008-e2e-opencode-real-process` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-e2e-opencode-real-process/spec.md`

## Summary

Добавить E2E-тесты (6 сценариев), проверяющие полный конвейер: Kafka message → plugin (eachMessageHandler) → OpenCodeAgentAdapter → opencode serve :3001 → Lemonade LLM → responseTopic / DLQ. Тесты используют реальный Redpanda через testcontainers, реальный opencode serve процесс и локальный Lemonade LLM.

## Technical Context

**Language/Version**: TypeScript 6.x (ES2022, ESNext modules, moduleResolution: bundler)
**Primary Dependencies**: kafkajs, vitest, testcontainers-node, @testcontainers/redpanda, node:child_process
**Storage**: N/A (messaging — Kafka/Redpanda)
**Testing**: vitest (E2E config — vitest.e2e.config.ts)
**Target Platform**: Node.js 20+ (local dev / self-hosted GitHub Actions runner)
**Project Type**: library (OpenCode plugin — E2E test layer)
**Performance Goals**: Каждый тест ≤90s, timeout-тест ≤60s, full suite ≤10min
**Constraints**: Sequential execution (single fork), реальный LLM (non-deterministic), Lemonade prerequisite
**Scale/Scope**: 6 E2E test scenarios, 4 helper modules, 1 Vitest config, 1 GitHub Actions workflow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Статус | E2E-покрытие |
|---------|--------|-------------|
| I. Strict Initialization | ✅ PASS | pluginRunner валидирует config через startConsumer |
| II. Domain Isolation | ✅ PASS | T-E2E-002, T-E2E-003 проверяют routing через полный конвейер |
| III. Resiliency | ✅ PASS | T-E2E-004: timeout → DLQ, consumer не крашится |
| IV. No-State Consumer | ✅ PASS | Каждый тест — уникальный group ID, изолированная сессия |
| V. Test-First Development | ✅ PASS | E2E — верхний уровень тестовой пирамиды (Level C) |

**Re-check post-design**: Все gates проходят. E2E-тесты дополняют (не заменяют) unit/integration тесты.

## Project Structure

### Documentation (this feature)

```text
specs/008-e2e-opencode-real-process/
├── plan.md              # This file
├── research.md          # Phase 0: research findings
├── data-model.md        # Phase 1: data entities
├── quickstart.md        # Phase 1: how to run E2E
├── contracts/           # Phase 1: interface contracts
│   └── helpers.md       # Helper interfaces
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
.opencode/
  opencode.json                           ← добавить agent e2e-responder
  agents/
    e2e-responder.md                      ← новый — системный промпт

tests/
  e2e/
    consumer.e2e.test.ts                  ← 6 тестов: T-E2E-001..006
    helpers/
      opencodeProcess.ts                  ← spawnOpenCodeServe
      redpandaContainer.ts                ← REAL Redpanda через testcontainers
      kafkaUtils.ts                       ← createTopics, produce, consume
      pluginRunner.ts                     ← runPlugin (startConsumer wrapper)

vitest.e2e.config.ts                      ← отдельный Vitest конфиг
package.json                              ← добавить "test:e2e" script

.github/workflows/
  e2e.yml                                 ← workflow_dispatch only
```

**Structure Decision**: E2E-тесты — новая директория `tests/e2e/` на уровне существующих `tests/unit/` и `tests/integration/`. Отдельный Vitest-конфиг для изоляции от unit/integration тестов.

## Implementation Phases

### Phase 1: Infrastructure (helpers + config)

**Цель**: Создать всю тестовую инфраструктуру до написания тестов.

1. **`vitest.e2e.config.ts`** — конфигурация E2E Vitest
   - timeout: 120_000, hookTimeout: 60_000
   - pool: forks, singleFork: true
   - env: KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID, KAFKA_DLQ_TOPIC, OPENCODE_E2E_PORT

2. **`tests/e2e/helpers/redpandaContainer.ts`** — REAL Redpanda
   - `startRedpanda(): Promise<StartedRedpandaContainer>` — @testcontainers/redpanda
   - `stopRedpanda(container): Promise<void>` — cleanup
   - ВНИМАНИЕ: Не mock! Реальный контейнер через testcontainers

3. **`tests/e2e/helpers/opencodeProcess.ts`** — управление opencode serve
   - `spawnOpenCodeServe(opts): Promise<OpenCodeProcessHandle>` — spawn + health check
   - Port pre-check, health polling, SIGTERM→SIGKILL kill strategy

4. **`tests/e2e/helpers/kafkaUtils.ts`** — Kafka utilities
   - `createTopics(brokers, topics)` — admin client, create topics
   - `produceMessage(brokers, topic, message, key?)` — producer
   - `consumeOneMessage(brokers, topic, timeoutMs)` — consumer, fromBeginning: false

5. **`tests/e2e/helpers/pluginRunner.ts`** — plugin lifecycle
   - `runPlugin(config, agent, env): Promise<PluginRunnerHandle>`
   - Устанавливает process.env → вызывает startConsumer → возвращает handle
   - `stop()` — performGracefulShutdown или state.isShuttingDown

6. **`.opencode/opencode.json`** — добавить agent e2e-responder
7. **`.opencode/agents/e2e-responder.md`** — системный промпт
8. **`package.json`** — добавить `"test:e2e": "vitest run --config vitest.e2e.config.ts"`

### Phase 2: E2E Tests (6 сценариев)

**Цель**: Реализовать все 6 тестов из спецификации.

1. **T-E2E-001**: Happy path — success + responseTopic
2. **T-E2E-002**: Routing — JSONPath match/skip
3. **T-E2E-003**: JSONPath field extraction — nested fields
4. **T-E2E-004**: Agent timeout → DLQ
5. **T-E2E-005**: Empty/minimal response → success, not DLQ
6. **T-E2E-006**: Fire-and-forget — no responseTopic

### Phase 3: CI + Documentation

1. **`.github/workflows/e2e.yml`** — workflow_dispatch, self-hosted runner
2. Проверить, что `npm run check` не затрагивает E2E тесты

## Key Technical Decisions

### D1: SDKClient для E2E

**Проблема**: OpenCodeAgentAdapter принимает `SDKClient` с `session: SessionsAPI`. Для E2E нужен клиент, подключённый к `http://localhost:3001`.

**Варианты**:
- A) Использовать `opencode` SDK npm-пакет с baseURL конфигурацией
- B) Создать HTTP-обёртку, реализующую SessionsAPI через fetch к opencode serve

**Рекомендация**: Начать с варианта A (исследовать `opencode` SDK API при реализации). Если SDK не поддерживает custom baseURL — fallback на B.

### D2: Plugin shutdown

**Проблема**: `startConsumer` не возвращает handle для shutdown.

**Подход**: Исследовать `performGracefulShutdown` в consumer.ts. Возможные стратегии:
- Вызвать `performGracefulShutdown()` напрямую если экспортируется
- Установить `state.isShuttingDown = true` если state доступен
- Использовать process signal (SIGINT) если consumer обрабатывает

### D3: Redpanda vs Mock

**Решение**: E2E использует REAL Redpanda через `@testcontainers/redpanda`. Существующий `MockStartedTestContainer` из integration-тестов не подходит — E2E проверяет полный конвейер.

## Complexity Tracking

Нет нарушений конституции. Все gates проходят без обоснований.