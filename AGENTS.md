# opencode-plugin-kafka

## Tech Stack

- **TypeScript 6.x** (ES2022 target, ESNext modules, `moduleResolution: bundler`)
- **kafkajs** — Kafka client
- **zod** — runtime config validation
- **jsonpath-plus** — JSONPath queries (routing.ts, prompt.ts)
- **vitest** — unit + integration testing
- **testcontainers-node + Redpanda** — integration tests (НЕ Apache Kafka)
- **npm** — package manager (НЕ yarn/pnpm)
- **Node.js 20** в CI

## Команды

```bash
npm run check              # lint + test (без typecheck и build)
npm run lint               # eslint src/**/*.ts tests/**/*.ts
npm run typecheck          # tsc --noEmit
npm run test               # vitest run (unit tests, integration исключены)
npm run test:coverage      # vitest --coverage
npm run test:integration   # vitest --config vitest.integration.config.ts (нужен Docker/Podman)
npm run build              # tsc
npm run format             # prettier --write "src/**/*.ts"
npx vitest run tests/unit/routing.test.ts  # один тест-файл
```

## CI Pipeline (GitHub Actions)

Порядок: lint → typecheck → test → build
Интеграционные тесты НЕ в CI — требуют container runtime (Docker/Podman)
CI: ubuntu-latest, Node.js 20

## Coverage Threshold

**90%** для lines, branches, functions, statements.

Исключены из coverage:
- `src/core/types.ts` (если существует)
- `src/core/index.ts` (только re-exports)
- `**/*.d.ts` файлы
- Тесты, конфиги, dist

## Структура

```
src/
├── index.ts                    # Plugin entry point (exports default plugin function)
├── core/
│   ├── config.ts               # parseConfig, parseConfigV003, validateTopicCoverage
│   ├── routing.ts              # matchRuleV003 — pure function (Domain Isolation)
│   ├── prompt.ts               # buildPromptV003
│   └── index.ts                # Public API re-exports
├── schemas/
│   └── index.ts                # Zod schemas + types via z.infer<>
│                                # RuleV003Schema, PluginConfigV003Schema, KafkaEnv
│                                # Legacy: RuleSchema, PluginConfigSchema
│                                # Shared: Payload, KafkaMessage, ProcessingResult
├── kafka/
│   ├── client.ts               # createKafkaClient, createConsumer, createDlqProducer, createResponseProducer
│   ├── consumer.ts             # eachMessageHandler, startConsumer, performGracefulShutdown
│   ├── dlq.ts                  # sendToDlq, DlqEnvelope
│   └── response-producer.ts    # sendResponse, ResponseMessage
├── opencode/
│   ├── IOpenCodeAgent.ts       # Interface: AgentResult, InvokeOptions
│   ├── OpenCodeAgentAdapter.ts # Production adapter
│   ├── MockOpenCodeAgent.ts    # Test mock
│   └── AgentError.ts           # TimeoutError, AgentError
└── types/
    ├── opencode-plugin.d.ts    # PluginContext, PluginHooks declarations
    └── opencode-sdk.d.ts       # SDKClient, SessionsAPI declarations

tests/
├── unit/            # pure function tests
│   ├── config.test.ts
│   ├── routing.test.ts
│   ├── prompt.test.ts
│   └── types-verification.test.ts
└── integration/     # testcontainers + Redpanda
```

## Импорт типов — КРИТИЧЕСКОЕ ПРАВИЛО

`src/core/types.ts` УДАЛЁН. Типы экспортируются из `src/schemas/index.ts` через `z.infer<>`:

```typescript
// ✅ Правильно
import type { RuleV003 } from '../schemas/index.js';
import type { PluginConfigV003 } from '../schemas/index.js';

// ❌ Неправильно — файл не существует
import type { Rule } from '../core/types';
```

## Версионированные схемы

Текущая версия API — V003 (spec 003). Legacy-схемы (RuleSchema, PluginConfigSchema) сохранены для обратной совместимости, но активный код использует V003-варианты.

## Конституция (5 NON-NEGOTIABLE принципов)

После любого изменения кода запускай `kafka-constitution-compliance` agent для проверки:

1. **Strict Initialization** — невалидная конфигурация падает при старте (fail-fast), включая FR-017 topic coverage validation
2. **Domain Isolation** — routing logic как pure function без side effects
3. **Resiliency** — try-catch в eachMessage handler, ошибки не крашат consumer
4. **No-State Consumer** — никакого session state между сообщениями
5. **Test-First Development** — unit tests писать до имплементации, 90%+ coverage

## Spec-Driven Development

Feature specs в `specs/` (001–006). Каждый spec содержит: spec.md, plan.md, tasks.md, research.md, contracts/, checklists/.
ADR docs в `docs/architecture/` (ADR-001–ADR-007).

## Integration Tests

**Только Redpanda** (НЕ Apache Kafka). Причина: 10-100x быстрее запуск в CI/CD.
Требуют Docker или Podman локально.
Запуск: `npm run test:integration`

## Два Vitest Config

- `vitest.config.ts` — unit tests, исключает integration, coverage thresholds (90%)
- `vitest.integration.config.ts` — только integration tests, 60s timeout для запуска контейнера

## OpenCode Config

Инструкции агентов в `.opencode/rules/*.md` (behavioral-guidelines, planning-workflow, language-safety).
Кастомные агенты в `.opencode/agents/`.
Skills в `.opencode/skills/`.
Commands в `.opencode/command/`.

## Известные пробелы

- `src/kafka/consumer.ts` (984 строки) — сложная Kafka API логика, тяжело покрыть unit-тестами без моков
- Интеграционные тесты требуют container runtime — недоступны в текущем CI
- Consumer integration tests нуждаются в real Redpanda для осмысленного coverage

## Принцип: Баги решаются сразу

**ВСЕ НАЙДЕННЫЕ БАГИ И ПРОБЛЕМЫ РЕШАЕМ В ТЕКУЩЕЙ ИТЕРАЦИИ.**

Если в ходе работы обнаружена ошибка (typecheck, lint, build, test, security) — она устраняется немедленно, а не выносится в technical debt. Исключение: ошибки в сторонних зависимостях или в коде, который не затрагивается текущей задачей и требует отдельной архитектурной проработки (что должно быть явно согласовано с пользователем).