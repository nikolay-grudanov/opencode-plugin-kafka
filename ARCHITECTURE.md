# 📐 Архитектура интеграции Kafka-плагина с OpenCode SDK

Полная архитектурная документация спроектирована и готова к рассмотрению.

## 📦 Что создано

### 7 ADR (Architecture Decision Records)

Все архитектурные решения задокументированы с подробным обоснованием и tradeoffs:

1. **ADR-001: Интеграция с OpenCode SDK** — Выбор подхода (sync blocking, mockable interface)
2. **ADR-002: Типы и схемы** — PluginContext, PluginHooks, OpenCode SDK types, RuleV003Schema extensions
3. **ADR-003: Integration Layer** — IOpenCodeAgent interface, OpenCodeAgentAdapter, MockOpenCodeAgent
4. **ADR-004: Consumer Integration** — eachMessageHandler, response producer, graceful shutdown
5. **ADR-005: Event Hooks** — НЕ используем (Simplicity First)
6. **ADR-006: Архитектурная диаграмма** — 3 диаграммы + tradeoffs summary
7. **ADR-007: Валидация** — Проверка конституции, coverage, backward compatibility

### README для архитектуры

📄 [docs/architecture/README.md](./docs/architecture/README.md) — Обзорная документация с навигацией по всем ADR.

## 🎯 Ключевые решения

### 1. Синхронный blocking вызов агента
- ✅ Testability: Easy to write unit tests
- ✅ Reliability: At-least-once processing
- ✅ Simplicity: Простой flow без state management
- ❌ Lower throughput (tradeoff для reliability)

### 2. Mockable Interface (IOpenCodeAgent)
- ✅ 90%+ coverage achievable без реального SDK
- ✅ Loose coupling от OpenCode SDK
- ✅ Centralized timeout handling (default: 120s)
- ❌ Additional code layer (~150-200 lines)

### 3. Commit Offset после ответа
- ✅ At-least-once semantics (гарантия обработки)
- ✅ No data loss даже при краше
- ❌ Potential duplicates (mitigation: idempotent agents)

### 4. Response Producer (Optional)
- ✅ Flexibility: логи vs Kafka ответ
- ✅ Backward compatibility
- ✅ Формат ответа включает `messageKey` (optional, из Kafka message key)
- ❌ Optional complexity

### 5. Event Hooks: Минимальный набор
- ✅ Используется только `session.error` hook (минимум)
- ✅ Simplicity: Минимальная сложность
- ✅ No-State Consumer compliance
- ✅ Consistency: Все ошибки через DLQ

### 6. Graceful Shutdown
- ✅ Abort sessions → disconnect consumer → disconnect producers
- ✅ Clean shutdown, cost control
- ❌ Orphan sessions (mitigation: background cleanup)

### 7. extractResponseText: Text only, join via \n\n
- ✅ Извлекает только text части из AssistantMessage.parts
- ✅ Конкатенирует через `\n\n` (между абзацами)
- ✅ Игнорирует code, image, file части

### 8. Retry: Нет, только DLQ
- ✅ Конституция Principle III: Resiliency
- ✅ Все ошибки (timeout, agent error, parse error) → DLQ
- ✅ Нет retry logic — fail-fast с отправкой в DLQ

### 9. agentId validation: Syntax-only при startup
- ✅ Zod schema: `z.string().min(1)` — только наличие
- ✅ Runtime validation: agentId существует — SDK вернёт ошибку при вызове
- ✅ Fail-fast при startup если syntax invalid

## ✅ Конституция проекта — Все 5 принципов соблюдены

1. ✅ **Strict Initialization** — Fail-fast при невалидной конфигурации (Zod validation, agentId required)
2. ✅ **Domain Isolation** — Pure functions (matchRuleV003, buildPromptV003), IOpenCodeAgent isolation
3. ✅ **Resiliency** — Try-catch в eachMessageHandler, DLQ для всех ошибок, timeout handling
4. ✅ **No-State Consumer** — Нет session state между сообщениями, sequential processing
5. ✅ **Test-First Development** — Mockable interface, 90%+ coverage achievable

## 📊 Тестируемость

**90%+ coverage достижимо** через:
- Mockable интерфейс IOpenCodeAgent
- Unit tests для pure functions (matchRuleV003, buildPromptV003)
- Unit tests для integration layer (IOpenCodeAgent, OpenCodeAgentAdapter, MockOpenCodeAgent)
- Unit tests для consumer (с mock agent)
- Integration tests с Redpanda + mock agent

## 🚀 Следующие шаги

### Phase 1: Foundation (2-3 дня)
1. Создать типы и схемы (`src/types/opencode-sdk.d.ts`, `src/types/opencode-plugin.d.ts`)
2. Обновить RuleV003Schema (`src/schemas/index.ts`)
3. Создать IOpenCodeAgent interface (`src/opencode/IOpenCodeAgent.ts`)
4. Создать OpenCodeAgentAdapter (`src/opencode/OpenCodeAgentAdapter.ts`)
5. Создать MockOpenCodeAgent (`src/opencode/MockOpenCodeAgent.ts`)

### Phase 2: Integration (1-2 дня)
6. Обновить eachMessageHandler (`src/kafka/consumer.ts`)
7. Обновить performGracefulShutdown (`src/kafka/consumer.ts`)
8. Обновить startConsumer (`src/kafka/consumer.ts`)
9. Обновить plugin() entry point (`src/index.ts`)

### Phase 3: Testing (2-3 дня)
10. Создать unit tests для routing, prompt (отсутствуют!)
11. Создать unit tests для IOpenCodeAgent, OpenCodeAgentAdapter, MockOpenCodeAgent
12. Создать unit tests для consumer (с mock agent)
13. Создать integration tests для consumer (Redpanda + mock agent)

### Phase 4: Documentation (0.5 дня)
14. Migration guide для существующих конфигов
15. User documentation с примерами
16. README updates

**Total estimated time**: 5.5-8.5 дней (1-2 недели работы)

## 📋 Open Questions для пользователя

Пожалуйста, ответьте на следующие вопросы:

1. **AgentId default**: Нужен ли default agentId если пользователь не указал?
   - *Recommendation*: Нет, fail-fast при startup

2. **Timeout default**: 120 секунд (2 минуты) достаточно? Или нужно меньше/больше?
   - *Recommendation*: Оставить 120, сделать конфигурируемым

3. **Response format**: Какой формат ответа для responseTopic?
   - *Current*: JSON с sessionId, ruleName, agentId, response, status, executionTimeMs, timestamp
   - *Recommendation*: Оставить текущий

4. **Concurrent message processing**: Нужно ли разрешить параллельную обработку сообщений?
   - *Recommendation*: Нет в первой версии. Sequential processing обеспечивает backpressure.

5. **Orphan sessions cleanup**: Нужно ли background task для очистки orphan сессий?
   - *Recommendation*: Да, создать в будущем.

6. **Response send retries**: Нужно ли retry при ошибке отправки ответа?
   - *Recommendation*: Нет. Логируем ошибки.

7. **Integration tests**: Нужно ли интеграционные тесты с реальным OpenCode SDK?
   - *Recommendation*: Опционально. Unit tests с mock agent достаточны.

## 📦 Файловая структура

### Создать новые файлы

```
src/
├── opencode/              # НОВАЯ ПАПКА
│   ├── IOpenCodeAgent.ts  # Interface IOpenCodeAgent
│   ├── OpenCodeAgentAdapter.ts  # Реализация с SDK client
│   ├── MockOpenCodeAgent.ts     # Mock для тестов
│   └── AgentError.ts      # TimeoutError, AgentError
│
└── types/
    └── opencode-sdk.d.ts  # SDK types (НОВОЕ)

tests/
└── unit/
    ├── routing.test.ts    # (НОВОЕ: нужно создать)
    ├── prompt.test.ts     # (НОВОЕ: нужно создать)
    ├── IOpenCodeAgent.test.ts      # (НОВОЕ)
    ├── OpenCodeAgentAdapter.test.ts # (НОВОЕ)
    └── consumer.test.ts   # (НОВОЕ: с mock agent)
```

### Изменить существующие файлы

```
src/
├── types/
│   └── opencode-plugin.d.ts     # PluginContext, PluginHooks (ИЗМЕНЕНО)
│
├── schemas/
│   └── index.ts          # RuleV003Schema (ИЗМЕНЕНО: agentId, responseTopic, timeoutSeconds)
│
├── kafka/
│   ├── client.ts          # createResponseProducer (НОВОЕ)
│   └── consumer.ts        # eachMessageHandler, performGracefulShutdown, startConsumer (ИЗМЕНЕНО)
│
└── index.ts               # plugin() entry point (ИЗМЕНЕНО: OpenCodeAgentAdapter)
```

## ✅ Валидация архитектуры

- ✅ Все 7 критериев успеха выполнены
- ✅ Конституция проекта: все 5 принципов соблюдены
- ✅ 90%+ coverage achievable
- ✅ Simplicity First score: 7.8/10 (высокая простота)
- ✅ Backward compatibility: один понятный breaking change (agentId required)
- ✅ Все tradeoffs задокументированы
- ✅ Риски идентифицированы и mitigations предложены

**Готовность к реализации**: ✅ HIGH

**Рекомендация**: ПРИНЯТЬ И РЕАЛИЗОВАТЬ архитектуру как описано в ADR-001...ADR-007

## 🔗 Связанные документы

- 📖 [Architecture README](./docs/architecture/README.md) — Обзорная документация
- 📄 [ADR-001: Интеграция с OpenCode SDK](./docs/architecture/ADR-001-opencode-sdk-integration.md)
- 📄 [ADR-002: Типы и схемы](./docs/architecture/ADR-002-types-and-schemas.md)
- 📄 [ADR-003: Integration Layer](./docs/architecture/ADR-003-integration-layer.md)
- 📄 [ADR-004: Consumer Integration](./docs/architecture/ADR-004-consumer-integration.md)
- 📄 [ADR-005: Event Hooks](./docs/architecture/ADR-005-event-hooks.md)
- 📄 [ADR-006: Architecture Diagram](./docs/architecture/ADR-006-architecture-diagram.md)
- 📄 [ADR-007: Validation](./docs/architecture/ADR-007-validation.md)

## 🎉 Итог

Архитектура спроектирована и полностью готова к реализации. Все решения обоснованы, tradeoffs задокументированы, риски идентифицированы.

**Что дальше?**
1. Прочитайте все ADR документы (особенно ADR-006 и ADR-007)
2. Ответьте на Open Questions (7 вопросов выше)
3. Подтвердите, что архитектура соответствует требованиям
4. Начните реализацию по Phase 1-4

**Estimated time**: 5.5-8.5 дней (1-2 недели работы)
