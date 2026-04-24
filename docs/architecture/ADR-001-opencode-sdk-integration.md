# ADR-001: Интеграция Kafka-плагина с OpenCode SDK через PluginContext

## Контекст

**opencode-plugin-kafka** — плагин для OpenCode, который читает сообщения из Kafka, извлекает промпт через JSONPath matching, вызывает OpenCode агента и возвращает результат.

**Текущее состояние**:
- Consumer читает из Kafka, выполняет JSONPath matching, строит промпт
- Промпт только логируется (console.log) — нет вызова OpenCode API
- PluginContext не используется (параметр `_context` игнорируется)

**Проблема**: Необходимо интегрировать плагин с OpenCode SDK для:
1. Создания сессий (session.create)
2. Вызова агентов (session.prompt)
3. Получения ответов от агентов
4. Отправки ответов в Kafka (опционально)

## Рассмотренные альтернативы

### Вариант 1: Прямое использование SDK client без абстракции
**Описание**: Использовать `context.client` напрямую в eachMessageHandler

**Плюсы**:
- Минимальный код, простая реализация
- Меньше абстракций

**Минусы**:
- Сложно тестировать unit tests (90%+ coverage невозможно без моков)
- Tight coupling к OpenCode SDK
- Трудно mock для интеграционных тестов

### Вариант 2: Integration layer с mockable интерфейсом (ВЫБРАНО)
**Описание**: Создать абстрактный интерфейс `IOpenCodeAgent` с двумя реализациями:
- `OpenCodeAgentAdapter` — использует real SDK client
- `MockOpenCodeAgent` — для unit/integration tests

**Плюсы**:
- Высокая тестируемость (90%+ coverage достижимо)
- Loose coupling к OpenCode SDK
- Timeout handling в одном месте
- Easy to mock для тестов
- Следует Dependency Inversion Principle

**Минусы**:
- Больше кода (дополнительный слой абстракции)
- Дополнительный интерфейс для поддержки

### Вариант 3: Асинхронная обработка с fire-and-forget
**Описание**: Отправлять промпт в агент, сразу commit offset, ответ отправлять асинхронно в другой topic

**Плюсы**:
- Higher throughput
- Меньшее время обработки сообщения

**Минусы**:
- Потенциальная потеря ответов при краше
- Сложнее отслеживать успешность выполнения
- Нарушает принцип at-least-once processing
- Более сложная координация graceful shutdown

### Вариант 4: Асинхронная обработка с callback через hooks
**Описание**: Использовать event hooks (`session.idle`) для получения ответов асинхронно

**Плюсы**:
- Event-driven architecture
- Better throughput

**Минусы**:
- Очень сложная координация состояния
- Сохранение mapping между сообщениями Kafka и сессиями OpenCode
- Нарушает "No-State Consumer" принцип
- Сложно тестируемо

## Принятое решение

Выбран **Вариант 2**: Integration layer с mockable интерфейсом и **синхронный blocking** вызов агента.

### Ключевые решения

1. **Синхронный blocking вызов агента**:
   - eachMessageHandler вызывает invokeAgent() и ожидает ответ
   - Commit offset только после получения ответа
   - Простая и предсказуемая error handling

2. **Mockable интерфейс IOpenCodeAgent**:
   - Изолирует OpenCode SDK от consumer logic
   - Позволяет легко тестировать без реального SDK
   - Timeout handling инкапсулирован в адаптере

3. **Расширенная RuleV003Schema**:
   - Добавить `agentId: string` (required) — какой агент запускать
   - Добавить `responseTopic?: string` (optional) — куда отправлять ответ
   - Добавить `timeoutSeconds?: number` (optional, default: 120)
   - Добавить `concurrency?: number` (optional, default: 1) — parallel processing (для future)

4. **Response Producer (опционально)**:
   - Отдельный Kafka producer для ответов
   - Используется только если `responseTopic` указан в правиле
   - Формат ответа включает `messageKey` (optional, из Kafka message key)
   - Поля: `{ sessionId, ruleName, agentId, messageKey, response, status, executionTimeMs, timestamp }`

5. **Graceful Shutdown с abort sessions**:
   - При SIGTERM/SIGINT: прервать активные сессии → disconnect consumer → disconnect producers
   - Timeout 15 секунд (SC-008) для всего shutdown
   - Active sessions aborted через `client.session.abort()`

6. **Event Hooks: только `session.error`**:
   - Используется только `session.error` hook (минимум)
   - Все ошибки (timeout, agent error, parse error) → DLQ
   - Retry logic отсутствует — fail-fast с отправкой в DLQ

7. **extractResponseText: Text only, join via \n\n**:
   - Извлекает только text части из AssistantMessage.parts
   - Конкатенирует через `\n\n` (между абзацами)
   - Игнорирует code, image, file части

8. **agentId validation: Syntax-only при startup**:
   - Zod schema: `z.string().min(1)` — только наличие, не existence
   - Runtime validation: SDK вернёт ошибку если агент не существует

## Обоснование (Rationale)

### Почему синхронный blocking?
1. **Testability**: Easy to write unit tests с predictable flow
2. **Reliability**: At-least-once processing гарантируется (commit offset только после ответа)
3. **Simplicity**: Простой flow, без state management между сообщениями
4. **Constitution compliance**: Соответствует "No-State Consumer" принципу

### Почему mockable интерфейс?
1. **Testability**: 90%+ coverage достижимо без реального SDK
2. **Isolation**: Consumer logic не зависит от OpenCode SDK
3. **Flexibility**: Easy to swap implementations (mock, stub, real)
4. **Timeout handling**: Централизованный timeout management

### Почему commit offset после ответа?
1. **Reliability**: No data loss even if consumer crashes after sending prompt
2. **Idempotency**: При повторной обработке сообщения агент должен быть idempotent (задача конфигурации агента)
3. **Tradeoff**: Возможны дубликаты, но это лучше потери данных

### Почему НЕ использовать event hooks?
1. **Simplicity**: Hooks добавляют сложность без явной пользы для этого сценария
2. **No-State Consumer**: Hooks подразумевают state tracking (mapping sessions to Kafka messages)
3. **DLQ is sufficient**: Errors уже обрабатываются через DLQ mechanism

### Почему response topic optional?
1. **Simplicity**: Для многих use cases достаточно логов
2. **Flexibility**: Пользователь выбирает: логи vs Kafka ответ
3. **Backward compatibility**: Существующие конфиги без responseTopic продолжают работать

## Последствия

### Положительные

1. **High testability**: 90%+ coverage достижимо через mock interface
2. **Constitution compliance**: Все 5 принципов соблюдены
3. **Reliability**: At-least-once processing с commit offset после ответа
4. **Simplicity**: Минимальная сложность, нет state между сообщениями
5. **Resiliency**: Timeout handling, DLQ для всех ошибок, graceful shutdown
6. **Flexibility**: Optional response topic для разных use cases

### Отрицательные

1. **Lower throughput**: Синхронный blocking вызов ограничивает пропускную способность
   - *Mitigation*: Это ожидаемый tradeoff для reliability. Если нужен higher throughput, можно рассмотреть отдельный плагин с async обработкой.

2. **Potential duplicates**: At-least-once processing может создавать дубликаты
   - *Mitigation*: Агенты должны быть idempotent (задача конфигурации агента, а не плагина)

3. **Additional code layer**: Integration layer добавляет ~200-300 строк кода
   - *Mitigation*: Это разумная цена за тестируемость и изоляцию зависимостей

4. **OpenCode SDK dependency**: Плагин теперь зависит от OpenCode SDK types
   - *Mitigation*: Mockable interface изолирует реализацию, можно использовать minimal types

## Следующие шаги

1. Определить типы PluginContext и PluginHooks
2. Расширить RuleV003Schema с agentId, responseTopic, timeoutSeconds
3. Создать интерфейс IOpenCodeAgent
4. Реализовать OpenCodeAgentAdapter
5. Интегрировать invokeAgent в eachMessageHandler
6. Реализовать response producer (если responseTopic указан)
7. Обновить graceful shutdown для abort sessions
8. Написать unit tests для всех новых модулей (90%+ coverage)
9. Написать integration tests с real OpenCode SDK (если возможно)

## Open вопросы

1. **Timeout default**: 120 секунд разумно? Или нужно меньше/больше?
2. **Response format**: Какой формат ответа для responseTopic? (JSON с полями: sessionId, ruleName, response, status, timestamp)
3. **Error responses**: Как отправлять ошибки в responseTopic? (status: "error", errorMessage: string)
4. **Concurrent sessions**: Нужно ли ограничивать количество активных сессий? (max concurrent sessions)
5. **Rate limiting**: Нужно ли ограничивать частоту вызовов агента? (max requests per second)
