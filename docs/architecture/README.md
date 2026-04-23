# Architecture Documentation — OpenCode Kafka Plugin

Обзор архитектуры интеграции Kafka-плагина с OpenCode SDK через PluginContext.

## 📋 Содержание

- [Обзор](#обзор)
- [ADR Documents](#adr-documents)
- [Ключевые архитектурные решения](#ключевые-архитектурные-решения)
- [Диаграммы](#диаграммы)
- [Конституция проекта](#конституция-проекта)
- [Файловая структура](#файловая-структура)
- [Следующие шаги](#следующие-шаги)

## Обзор

**opencode-plugin-kafka** — плагин для OpenCode, который:
1. Читает сообщения из Kafka топиков
2. Извлекает промпт через JSONPath matching
3. Вызывает OpenCode агента для выполнения задачи
4. Возвращает результат обратно в Kafka (опционально)

### Архитектурные принципы

- **Simplicity First**: Минимальная сложность, без избыточных абстракций
- **Testability**: 90%+ coverage через mockable зависимости
- **Reliability**: At-least-once processing с commit offset после ответа
- **Resiliency**: Timeout handling, DLQ для всех ошибок, graceful shutdown
- **Constitution compliance**: Все 5 принципов соблюдены

## ADR Documents

Все архитектурные решения задокументированы в формате ADR (Architecture Decision Record).

### ADR-001: Интеграция с OpenCode SDK
📄 [ADR-001-opencode-sdk-integration.md](./ADR-001-opencode-sdk-integration.md)

**Ключевое решение**: Integration layer с mockable интерфейсом и синхронный blocking вызов агента.

**Alternatives**:
- Прямое использование SDK client без абстракции
- Асинхронная обработка с fire-and-forget
- Асинхронная обработка с callback через hooks

### ADR-002: Типы и схемы для интеграции с OpenCode SDK
📄 [ADR-002-types-and-schemas.md](./ADR-002-types-and-schemas.md)

**Ключевое решение**: Минимальные типы только для используемых методов SDK.

**Содержание**:
- PluginContext и PluginHooks
- OpenCode SDK interfaces (SDKClient, SessionsAPI, Session, Message)
- Расширенные схемы RuleV003Schema (agentId, responseTopic, timeoutSeconds)

### ADR-003: OpenCode Integration Layer — IOpenCodeAgent Interface
📄 [ADR-003-integration-layer.md](./ADR-003-integration-layer.md)

**Ключевое решение**: Mockable интерфейс IOpenCodeAgent с двумя реализациями.

**Содержание**:
- Интерфейс IOpenCodeAgent
- OpenCodeAgentAdapter (реализация с real SDK client)
- MockOpenCodeAgent (для unit tests)
- Timeout handling через Promise.race()

### ADR-004: Интеграция в Consumer, Response Producer и Graceful Shutdown
📄 [ADR-004-consumer-integration.md](./ADR-004-consumer-integration.md)

**Ключевые решения**:
- Commit offset после получения ответа (at-least-once semantics)
- Response producer optional (только если responseTopic указан)
- Graceful shutdown с abort sessions → disconnect consumer → disconnect producers

**Содержание**:
- Обновлённый eachMessageHandler flow
- Обновлённый performGracefulShutdown
- Обновлённый startConsumer с agent и responseProducer

### ADR-005: Event Hooks — Не используем (Simplicity First)
📄 [ADR-005-event-hooks.md](./ADR-005-event-hooks.md)

**Ключевое решение**: НЕ возвращать hooks в plugin().

**Обоснование**:
- Simplicity: Минимальная сложность
- No-State Consumer: Hooks подразумевают state tracking
- DLQ is sufficient: Ошибки уже обрабатываются через DLQ

### ADR-006: Архитектурная диаграмма и Final Tradeoffs
📄 [ADR-006-architecture-diagram.md](./ADR-006-architecture-diagram.md)

**Содержание**:
- 3 архитектурные диаграммы (High-Level, Message Flow, Shutdown Flow)
- Final tradeoffs summary для 7 ключевых решений
- File structure (updated)
- Implementation priority (4 фазы)
- Migration guide

### ADR-007: Валидация архитектуры — Соответствие требованиям
📄 [ADR-007-validation.md](./ADR-007-validation.md)

**Содержание**:
- Валидация по критериям успеха
- Проверка конституции проекта (5 принципов)
- Тестируемость (90%+ coverage achievable)
- Проверка на Simplicity First
- Backward compatibility analysis
- Финальная оценка архитектуры

## Ключевые архитектурные решения

### 1. Синхронный blocking вызов агента

**Решение**: eachMessageHandler вызывает invokeAgent() и ожидает ответ.

**Почему**:
- ✅ Testability: Easy to write unit tests с predictable flow
- ✅ Reliability: At-least-once processing (commit offset только после ответа)
- ✅ Simplicity: Простой flow, без state management
- ✅ Constitution compliance: "No-State Consumer"
- ❌ Lower throughput: Блокирует консумер на время выполнения агента

### 2. Commit offset после ответа

**Решение**: Commit offset только после успешного ответа или ошибки (DLQ).

**Почему**:
- ✅ At-least-once semantics: Гарантия обработки
- ✅ No data loss: Даже при краше после отправки промпта
- ✅ Constitution compliance: "Resiliency"
- ❌ Potential duplicates: Possible duplicate processing
- *Mitigation*: Агенты должны быть idempotent

### 3. Mockable Interface (IOpenCodeAgent)

**Решение**: Создать интерфейс IOpenCodeAgent с двумя реализациями:
- OpenCodeAgentAdapter — использует real SDK client
- MockOpenCodeAgent — для unit tests

**Почему**:
- ✅ High testability: 90%+ coverage achievable
- ✅ Loose coupling: Consumer logic не зависит от SDK
- ✅ Flexibility: Easy to swap implementations
- ✅ Centralized timeout handling
- ❌ Additional code layer: ~150-200 lines of code

### 4. Response Producer (Optional)

**Решение**: Отдельный Kafka producer для ответов, используется только если responseTopic указан.

**Почему**:
- ✅ Simplicity: Для многих use cases достаточно логов
- ✅ Flexibility: Пользователь выбирает: логи vs Kafka ответ
- ✅ Backward compatibility: Существующие конфиги работают
- ❌ Optional complexity: Ещё один producer если нужен

### 5. Event Hooks: НЕ используем

**Решение**: Плагин не возвращает hooks (пустой объект).

**Почему**:
- ✅ Simplicity: Минимальная сложность
- ✅ Testability: Easy to test без моков hooks
- ✅ Constitution compliance: "No-State Consumer"
- ✅ Consistency: Все ошибки через DLQ
- ❌ No event visibility: Не видим события OpenCode напрямую

### 6. Graceful Shutdown

**Решение**: Abort sessions → disconnect consumer → disconnect producers (15s timeout).

**Почему**:
- ✅ Clean shutdown: Прерывание активных сессий
- ✅ Cost control: Не оставляем мёртвые сессии
- ✅ Graceful: Даем агентам шанс завершить работу
- ❌ Timeout complexity: Additional logic
- ❌ Orphan sessions: Если timeout, могут оставаться orphan сессии

### 7. Timeout Handling

**Решение**: Promise.race() с TimeoutError.

**Почему**:
- ✅ Non-blocking: Не блокирует поток исполнения
- ✅ Clean error handling: TimeoutError отделён от других ошибок
- ✅ Standard pattern: Common pattern для async timeout
- ❌ Orphan sessions: Timeout оставляет активную сессию
- *Mitigation*: Background task для orphan cleanup (future work)

## Диаграммы

### High-Level Architecture

Общая архитектура системы:

```mermaid
graph TB
    subgraph "OpenCode Runtime"
        OC[OpenCode Runtime]
        PluginContext[PluginContext<br/>client, project, directory, worktree, $]
        SDK[SDK Client<br/>session.create, session.prompt, session.abort]
    end

    subgraph "Kafka Plugin"
        Entry[plugin()<br/>Entry Point]
        Config[parseConfigV003()<br/>RuleV003Schema validation]
        AgentAdapter[OpenCodeAgentAdapter<br/>implements IOpenCodeAgent]
    end

    subgraph "Kafka Infrastructure"
        Topics[Kafka Topics<br/>input-topic, output-topic, dlq-topic]
        Consumer[Kafka Consumer<br/>eachMessageHandler]
        DLQ[DLQ Producer]
        Response[Response Producer]
    end

    subgraph "OpenCode AI"
        Agents[OpenCode Agents<br/>security-analyzer, code-reviewer, ...]
    end

    OC --> PluginContext
    PluginContext --> SDK

    Entry --> Config
    Entry --> AgentAdapter

    SDK --> AgentAdapter

    Config --> Consumer
    AgentAdapter --> Consumer

    Topics --> Consumer
    Consumer --> DLQ
    Consumer --> Response

    Consumer -->|invokeAgent| AgentAdapter
    AgentAdapter -->|session.create + prompt| SDK
    SDK --> Agents

    Response --> Topics
    DLQ --> Topics

    style PluginContext fill:#e1f5e1
    style AgentAdapter fill:#e1f5e1
    style Consumer fill:#fff4e1
    style Agents fill:#ffe1e1
```

Полные диаграммы см. в [ADR-006](./ADR-006-architecture-diagram.md).

## Конституция проекта

### 1. Strict Initialization
✅ **Соответствие**: Невалидная конфигурация падает при старте (Zod validation)

### 2. Domain Isolation
✅ **Соответствие**: matchRuleV003, buildPromptV003 — pure functions; IOpenCodeAgent изолирует consumer logic

### 3. Resiliency
✅ **Соответствие**: try-catch в eachMessageHandler, DLQ для всех ошибок, timeout handling

### 4. No-State Consumer
✅ **Соответствие**: Никакого session state между сообщениями, sequential processing

### 5. Test-First Development
✅ **Соответствие**: Mockable интерфейс IOpenCodeAgent, 90%+ coverage achievable

Подробнее см. в [ADR-007](./ADR-007-validation.md).

## Файловая структура

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

## Следующие шаги

### Phase 1: Foundation (2-3 дня)
1. Создать типы и схемы (ADR-002)
2. Создать IOpenCodeAgent interface (ADR-003)
3. Создать OpenCodeAgentAdapter (ADR-003)
4. Создать MockOpenCodeAgent (ADR-003)

### Phase 2: Integration (1-2 дня)
5. Обновить eachMessageHandler (ADR-004)
6. Обновить performGracefulShutdown (ADR-004)
7. Обновить startConsumer (ADR-004)
8. Обновить plugin() entry point (ADR-004)

### Phase 3: Testing (2-3 дня)
9. Unit tests для routing, prompt (отсутствуют!)
10. Unit tests для IOpenCodeAgent, OpenCodeAgentAdapter, MockOpenCodeAgent
11. Unit tests для consumer (с mock agent)
12. Integration tests для consumer (Redpanda + mock agent)

### Phase 4: Documentation (0.5 дня)
13. Migration guide для существующих конфигов
14. User documentation с примерами
15. README updates

**Total estimated time**: 5.5-8.5 дней (1-2 недели работы)

## Migration Guide

### Старый формат (spec 003 без OpenCode)

```json
{
  "topics": ["input-topic"],
  "rules": [
    {
      "name": "vuln-rule",
      "jsonPath": "$.vulnerabilities[?(@.severity==\"CRITICAL\")]",
      "promptTemplate": "Analyze: ${$}"
    }
  ]
}
```

### Новый формат (с OpenCode integration)

```json
{
  "topics": ["input-topic"],
  "rules": [
    {
      "name": "vuln-rule",
      "jsonPath": "$.vulnerabilities[?(@.severity==\"CRITICAL\")]",
      "promptTemplate": "Analyze: ${$}",
      "agentId": "security-analyzer",        // ← ОБЯЗАТЕЛЬНОЕ ПОЛЕ
      "responseTopic": "output-topic",        // ← опциональное
      "timeoutSeconds": 120                   // ← опциональное (default: 120)
    }
  ]
}
```

## Заключение

✅ **Архитектура соответствует всем требованиям**:
- 5 принципов конституции соблюдены
- 90%+ coverage достижимо
- Минимальная сложность (Simplicity First)
- Обратная совместимость (один понятный breaking change)
- Все tradeoffs задокументированы
- Риски идентифицированы и mitigations предложены

**Готовность к реализации**: ✅ HIGH

**Рекомендация**: ПРИНЯТЬ И РЕАЛИЗОВАТЬ архитектуру как описано в ADR-001...ADR-007

## Связанные документы

- [ADR-001: Интеграция с OpenCode SDK](./ADR-001-opencode-sdk-integration.md)
- [ADR-002: Типы и схемы](./ADR-002-types-and-schemas.md)
- [ADR-003: Integration Layer](./ADR-003-integration-layer.md)
- [ADR-004: Consumer Integration](./ADR-004-consumer-integration.md)
- [ADR-005: Event Hooks](./ADR-005-event-hooks.md)
- [ADR-006: Architecture Diagram](./ADR-006-architecture-diagram.md)
- [ADR-007: Validation](./ADR-007-validation.md)
