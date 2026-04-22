# opencode-plugin-kafka

## Tech Stack

- **TypeScript 6.x** (ES2022 target, ESNext modules, `moduleResolution: bundler`)
- **zod** — runtime config validation via Zod schemas
- **jsonpath-plus** — JSONPath queries для фильтрации сообщений
- **vitest** — unit + integration testing
- **testcontainers-node + Redpanda** — integration tests (не Apache Kafka)

## Команды

```bash
npm run check        # lint + test (порядок важен)
npm run lint         # eslint src/**/*.ts
npx vitest run         # vitest
npm run test:coverage # vitest --coverage
npx vitest tests/unit/routing.test.ts  # конкретный файл
```


## Coverage Threshold

**90%** для lines, branches, functions, statements.

**Важно**: Из coverage исключены type-only файлы:
- `src/core/types.ts`
- `src/core/index.ts`

Эти файлы содержат только интерфейсы и re-exports — они не имеют runtime кода.

## Структура

```
src/
├── core/
│   ├── config.ts    # parseConfig (Zod validation + FR-017 topic coverage)
│   ├── routing.ts   # matchRule — pure function
│   ├── prompt.ts    # buildPrompt (String() для примитивов)
│   └── index.ts     # Public API (re-exports из schemas)
├── schemas/
│   └── index.ts     # Zod schemas + types (z.infer<>)
└── index.ts         # Plugin entry point

tests/
├── unit/            # pure function tests (vitest)
│   ├── config.test.ts
│   ├── routing.test.ts
│   ├── prompt.test.ts
│   └── types-verification.test.ts
└── integration/     # testcontainers + Redpanda
```

## Типы (spec 002)

**Важно**: `src/core/types.ts` УДАЛЁН. Типы `Rule`, `PluginConfig`, `Payload` экспортируются из `src/schemas/index.ts` через `z.infer<>`:

```typescript
// Правильный импорт
import type { Rule } from '../schemas/index.js';

// Неправильно (types.ts удалён)
import type { Rule } from '../core/types'; // ← НЕ СУЩЕСТВУЕТ
```

## Конституция (5 NON-NEGOTIABLE принципов)

После любого изменения кода запускай `kafka-constitution-compliance` agent для проверки:

1. **Strict Initialization** — невалидная конфигурация падает при старте (fail-fast), включая FR-017 topic coverage validation
2. **Domain Isolation** — routing logic как pure function без side effects
3. **Resiliency** — try-catch в eachMessage handler, ошибки не крашат consumer
4. **No-State Consumer** — никакого session state между сообщениями
5. **Test-First Development** — unit tests писать до имплементации, 90%+ coverage

## Integration Tests

**Только Redpanda** (не Apache Kafka). Причина: 10-100x быстрее запуск в CI/CD.

## OpenCode Config

Агент читает инструкции из `.opencode/rules/*.md` (behavioral-guidelines, planning-workflow, language-safety).

## Active Technologies
- TypeScript 6.x (ES2022 target, ESNext modules, `moduleResolution: bundler`) + `kafkajs` (Kafka client), `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing), `testcontainers-node` + `Redpanda` (integration tests) (003-kafka-consumer)
- N/A (Kafka-based message queue, no local persistence) (003-kafka-consumer)

## Recent Changes
- 003-kafka-consumer: Added TypeScript 6.x (ES2022 target, ESNext modules, `moduleResolution: bundler`) + `kafkajs` (Kafka client), `zod` (runtime validation), `jsonpath-plus` (JSONPath queries), `vitest` (testing), `testcontainers-node` + `Redpanda` (integration tests)

## Known Issues & Technical Debt

### Coverage 57.37% — требуются integration tests с real Redpanda

**Проблема**: `src/kafka/consumer.ts` имеет покрытие 39.82% из-за сложной логики с Kafka API.

**Текущее состояние**:
- Unit tests для pure functions (routing, prompt, dlq) — 100% coverage ✅
- `consumer.ts` требует integration tests с реальным Redpanda контейнером
- Unit tests для consumer.ts невозможны без моков Kafka API

**Требуется**:
1. Integration tests с real Redpanda для `consumer.ts` (eachMessageHandler, graceful shutdown)
2. CI/CD environment с Docker/Podman для запуска Redpanda
3. Или исключение `consumer.ts` из coverage threshold

**Файлы требующие coverage**:
- `src/kafka/consumer.ts` — 39.82% (каждая строка требует integration test)
- `src/core/config.ts` — 59.18% (parseConfigV003 FR-017 validation)
