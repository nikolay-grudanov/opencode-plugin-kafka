# Implementation Plan: OpenCode SDK Integration

**Branch**: `006-opencode-sdk-integration` | **Date**: 2026-04-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-opencode-sdk-integration/spec.md`

## Summary

Интеграция Kafka consumer плагина с OpenCode SDK для автоматического вызова OpenCode агентов по сообщениям из Kafka топиков. Подход: mockable IOpenCodeAgent interface, синхронный blocking вызов, sequential processing, DLQ для всех ошибок, 90%+ test coverage через MockOpenCodeAgent.

## Technical Context

**Language/Version**: TypeScript 6.x (ES2022 target, ESNext modules, `moduleResolution: bundler`)
**Primary Dependencies**: `kafkajs` (Kafka client), `zod` (runtime validation), `jsonpath-plus` (JSONPath queries)
**SDK Types**: `@opencode-ai/plugin` (types only, через opencode-plugin.d.ts и opencode-sdk.d.ts)
**Storage**: N/A (Kafka-based, no local persistence)
**Testing**: `vitest` (unit + integration), `testcontainers-node` + Redpanda (integration only)
**Target Platform**: Node.js/Bun runtime (OpenCode plugin)
**Project Type**: Library (OpenCode plugin)
**Performance Goals**: Sequential processing, 120s max per message, 15s graceful shutdown
**Constraints**: 90% coverage, no `any` types, no retry, `allowAutoTopicCreation: false`, `autoCommit: false`, no raw console.log strings
**Scale/Scope**: Single consumer, sequential processing, 1 Kafka topic group

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Strict Initialization** | ✅ PASS | Zod validation в parseConfig, agentId required (fail-fast), FR-017 topic coverage |
| **II. Domain Isolation** | ✅ PASS | matchRuleV003 + buildPromptV003 — pure functions (FR-011, FR-012), IOpenCodeAgent isolates SDK |
| **III. Resiliency** | ✅ PASS | try-catch в eachMessageHandler (FR-013), DLQ для всех ошибок (FR-015), never throws |
| **IV. No-State Consumer** | ✅ PASS | Каждый invoke → isolated session (FR-007), no cross-message state, activeSessions только для shutdown |
| **V. Test-First Development** | ✅ PASS | Mockable IOpenCodeAgent (FR-006, FR-008), 90%+ target (NFR-001), 8 mandatory scenarios (NFR-003) |

**Result**: Все 5 принципов соблюдены. Нет violations. Нет NEEDS CLARIFICATION.

## Project Structure

### Documentation (this feature)

```text
specs/006-opencode-sdk-integration/
├── plan.md              # This file
├── research.md          # Phase 0: ADR-based research
├── data-model.md        # Phase 1: entities and relationships
├── quickstart.md        # Phase 1: developer quickstart
├── contracts/           # Phase 1: interface contracts
│   ├── IOpenCodeAgent.md
│   ├── ResponseMessage.md
│   └── eachMessageHandler.md
└── tasks.md             # Phase 2: NOT created by /speckit.plan
```

### Source Code (repository root)

```text
src/
├── index.ts                    # FR-001: Plugin entry point
├── opencode/
│   ├── IOpenCodeAgent.ts       # FR-006: Interface + types
│   ├── OpenCodeAgentAdapter.ts # FR-007: Real SDK implementation
│   ├── MockOpenCodeAgent.ts    # FR-008: Test mock
│   └── AgentError.ts           # FR-009: TimeoutError, AgentError
├── kafka/
│   ├── client.ts               # FR-010: Kafka factories
│   ├── consumer.ts             # FR-013, FR-016, FR-018: Handler + shutdown + state
│   ├── response-producer.ts    # FR-014: Response sender
│   └── dlq.ts                  # FR-015: Dead Letter Queue
├── core/
│   ├── config.ts               # FR-002, FR-017: Config parsing + topic coverage
│   ├── routing.ts              # FR-011: Rule matching (pure)
│   ├── prompt.ts               # FR-012: Prompt building (pure)
│   └── index.ts                # Public API re-exports
├── schemas/
│   └── index.ts                # FR-003: Zod schemas (RuleV003Schema)
└── types/
    ├── opencode-sdk.d.ts       # FR-004: SDK type declarations
    └── opencode-plugin.d.ts    # FR-005: PluginContext, PluginHooks

tests/
├── unit/
│   ├── config.test.ts
│   ├── routing.test.ts
│   ├── prompt.test.ts
│   ├── opencode/
│   │   ├── agent-adapter.test.ts
│   │   ├── mock-agent.test.ts
│   │   └── extract-response.test.ts
│   └── kafka/
│       └── response-producer.test.ts
└── integration/
    └── kafka-opencode.test.ts
```

**Structure Decision**: Single project (OpenCode plugin). Новые файлы в `src/opencode/` (integration layer) и `src/kafka/response-producer.ts`. Существующие файлы в `src/core/`, `src/schemas/`, `src/kafka/` обновляются.

## Implementation Phases

### Phase 1: Foundation — Типы и схемы
**Files**: `src/types/opencode-sdk.d.ts`, `src/types/opencode-plugin.d.ts`, `src/schemas/index.ts`, `src/opencode/IOpenCodeAgent.ts`, `src/opencode/AgentError.ts`
**Dependencies**: None
**Verify**: `npx tsc --noEmit` passes

### Phase 2: Integration Layer
**Files**: `src/opencode/OpenCodeAgentAdapter.ts`, `src/opencode/MockOpenCodeAgent.ts`
**Dependencies**: Phase 1
**Verify**: Unit tests for MockOpenCodeAgent pass

### Phase 3: Kafka Integration
**Files**: `src/kafka/response-producer.ts`, `src/kafka/client.ts` (update), `src/kafka/consumer.ts` (update)
**Dependencies**: Phase 2
**Verify**: Unit tests for response-producer, consumer tests with MockOpenCodeAgent

### Phase 4: Plugin Entry Point
**Files**: `src/index.ts` (update), `src/core/config.ts` (update for FR-017)
**Dependencies**: Phase 3
**Verify**: Full pipeline test with MockOpenCodeAgent

### Phase 5: Testing
**Files**: All test files (NFR-002)
**Dependencies**: Phase 4
**Verify**: `npm run test:coverage` ≥ 90%

### Phase 6: Validation
**Dependencies**: Phase 5
**Verify**: `npm run check` passes, constitution compliance verified

## Complexity Tracking

No violations — all principles satisfied without justification needed.