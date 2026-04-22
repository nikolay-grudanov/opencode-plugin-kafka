# Implementation Plan: 003-kafka-consumer

**Branch**: `003-kafka-consumer` | **Date**: 2026-04-22 | **Spec**: [spec.md](../003-kafka-consumer/spec.md)
**Input**: Feature specification from `/specs/003-kafka-consumer/spec.md` — KafkaJS Consumer with DLQ для OpenCode агента

## Summary

Создание KafkaJS consumer плагина для OpenCode с DLQ (Dead Letter Queue). Потребитель читает сообщения из Kafka топиков, маршрутизирует через JSONPath правила, формирует промпты для OpenCode агента. При ошибках обработки (invalid JSON, rule match failure, prompt build failure) сообщения отправляются в DLQ. Реализована sequential processing с backpressure для защиты OpenCode агента от перегрузки.

**Technical Approach**: TypeScript + KafkaJS + Zod валидация + jsonpath-plus маршрутизация. Интеграция через OpenCode plugin hooks. Тестирование через vitest (unit) и testcontainers-node + Redpanda (integration).

## Technical Context

**Language/Version**: TypeScript 6.x (ES2022 target, ESNext modules, `moduleResolution: bundler`)
**Primary Dependencies**: `kafkajs` (Kafka client), `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing), `testcontainers-node` + `Redpanda` (integration tests)
**Storage**: N/A (Kafka-based message queue, no local persistence)
**Testing**: `vitest` (unit tests), `testcontainers-node` + `Redpanda` (integration tests)
**Target Platform**: Node.js/Bun/Deno (JavaScript runtime)
**Performance Goals**: Medium throughput (100-1000 msg/sec), ≤5s latency acceptable
**Constraints**: No message loss, crash isolation, graceful shutdown ≤10s, max 10 partitions/consumer, max 5 topics
**Scale/Scope**: Horizontal scaling via multiple plugin instances with manual partition assignment; sequential processing as backpressure mechanism

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — Strict Initialization ✓ PASS

- **FR-019**: `createKafkaClient()` читает env vars (`KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`), валидирует через Zod schema в strict mode, throw Error с именем поля при отсутствии
- **FR-025**: `src/index.ts` читает `kafka-router.json` из `KAFKA_ROUTER_CONFIG` env, вызывает `parseConfig()` — fail-fast при невалидном config
- Конфиг файл `.opencode/kafka-router.json` валидируется через Zod с clear error messages

**GATE RESULT**: ✅ PASS — no violations

### Principle II — Domain Isolation ✓ PASS

- `matchRule()` — pure function: `(payload, rules) => matchedRule | null`
- `buildPrompt()` — pure function: `(rule, payload) => string`
- Routing logic реализован как отдельный модуль `src/core/routing.ts` без side effects
- No dependencies on OpenCode APIs в routing модуле

**GATE RESULT**: ✅ PASS — no violations

### Principle III — Resiliency ✓ PASS

- `eachMessageHandler()` оборачивает все операции в try-catch
- JSON.parse errors → DLQ
- `matchRule()` throws → DLQ
- `buildPrompt()` throws → DLQ
- DLQ producer failure логируется, но НЕ крашит consumer
- FR-022: `sendToDlq()` wraps in try/catch, logs on failure, never throws

**GATE RESULT**: ✅ PASS — no violations

### Principle IV — No-State Consumer ✓ PASS

- Каждое сообщение создаёт новый `client.sessions.create()` call
- Нет глобального state между сообщениями
- Consumer не хранит session context в памяти

**GATE RESULT**: ✅ PASS — no violations

### Principle V — Test-First Development ✓ PASS

- Unit tests для `matchRule()`, `buildPrompt()`, `parseConfig()`
- Integration tests с testcontainers-node + Redpanda
- 90%+ coverage требуется для `src/core/*.ts`

**GATE RESULT**: ✅ PASS — no violations

### Gate Summary

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict Initialization | ✅ PASS | Zod validation, fail-fast |
| II. Domain Isolation | ✅ PASS | Pure functions, clear boundaries |
| III. Resiliency | ✅ PASS | try-catch everywhere, DLQ on errors |
| IV. No-State Consumer | ✅ PASS | Stateless processing |
| V. Test-First Development | ✅ PASS | vitest + testcontainers |

**OVERALL**: ✅ ALL GATES PASS — proceed to Phase 0

### Source Code (repository root)

```text
src/
├── kafka/
│   ├── client.ts      # createKafkaClient(), createConsumer(), createDlqProducer()
│   ├── consumer.ts    # startConsumer(), eachMessageHandler()
│   └── dlq.ts         # sendToDlq(), DlqEnvelope type
├── core/
│   ├── config.ts      # parseConfig() — Zod validation + FR-017 topic coverage
│   ├── routing.ts     # matchRule() — pure function
│   ├── prompt.ts      # buildPrompt() — pure function
│   └── index.ts       # Public API (re-exports)
├── schemas/
│   └── index.ts       # Zod schemas + types (z.infer<>)
└── index.ts           # Plugin entry point — start()

tests/
├── unit/              # Pure function tests (vitest)
│   ├── config.test.ts
│   ├── routing.test.ts
│   ├── prompt.test.ts
│   └── client.test.ts
└── integration/       # testcontainers + Redpanda
    ├── consumer.test.ts
    └── dlq.test.ts
```

**Structure Decision**: TypeScript plugin для OpenCode с модульной структурой. `src/kafka/` — Kafka integration (client, consumer, DLQ). `src/core/` — routing/prompt logic (pure functions, domain isolated). `src/schemas/` — Zod schemas. Plugin entry через `src/index.ts → start()`.

## Phase 0 — Research ✅ COMPLETE

**Output**: `research.md` — all NEEDS CLARIFICATION resolved

All technical decisions documented with rationale and alternatives considered. No additional research required.

## Phase 1 — Design & Contracts ✅ COMPLETE

**Outputs**:
- `data-model.md` — entity definitions, validation rules, state transitions
- `contracts/opencode-plugin-hook.md` — plugin entry point contract
- `contracts/kafka-message.md` — Kafka message format contract
- `quickstart.md` — developer guide

Agent context updated via `.specify/scripts/bash/update-agent-context.sh opencode`.

## Phase 2 — Implementation Tasks

[TO BE GENERATED: tasks.md via /speckit.tasks command]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | No violations | N/A |
