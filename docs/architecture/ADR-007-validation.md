# ADR-007: Валидация архитектуры — Соответствие требованиям

## Требования к результату

Для каждого альтернативного решения — анализ tradeoffs:
- ✅ Создана архитектурная диаграмма (ADR-006)
- ✅ Обновлённая структура файлов (ADR-006)
- ✅ Интерфейсы и типы (ADR-002, ADR-003)
- ✅ Ключевые решения с объяснением WHY и tradeoffs (ADR-001, ADR-006)
- ✅ Вопросы/риски — что требует уточнения у пользователя (ADR-006)

## Критерии успеха

### 1. Архитектурное решение обосновано с учётом всех ограничений
✅ **Создан ADR с чётким описанием контекста, решений и последствий**
- ADR-001: Интеграция с OpenCode SDK
- ADR-002: Типы и схемы
- ADR-003: Integration layer
- ADR-004: Consumer integration
- ADR-005: Event hooks
- ADR-006: Архитектурная диаграмма и tradeoffs

### 2. Создан ADR с чётким описанием контекста, решений и последствий
✅ **Все ADR содержат**:
- Контекст (проблема/требования)
- Рассмотренные альтернативы
- Принятое решение
- Обоснование (Rationale)
- Последствия (Positive/Negative)

### 3. Tradeoffs между альтернативами задокументированы
✅ **ADR-006: Final Tradeoffs Summary** содержит анализ 7 ключевых решений:
1. Синхронный vs Асинхронный вызов агента
2. Commit Offset Timing
3. Mockable Interface vs Прямое использование SDK
4. Response Producer
5. Event Hooks
6. Graceful Shutdown
7. Timeout Handling

### 4. Диаграммы наглядно отражают структуру и потоки
✅ **ADR-006 содержит 3 диаграммы**:
1. High-Level Architecture (общая структура)
2. Message Processing Flow (последовательность обработки сообщения)
3. Graceful Shutdown Flow (процесс graceful shutdown)

### 5. Риски и mitigations идентифицированы
✅ **ADR-006: Open Questions for User** содержит 7 вопросов:
1. AgentId default
2. Timeout default
3. Response format
4. Concurrent message processing
5. Orphan sessions cleanup
6. Response send retries
7. Integration tests

## Конституция проекта (5 NON-NEGOTIABLE принципов)

### 1. Strict Initialization
✅ **Соответствие**:
- Невалидная конфигурация падает при старте (Zod validation в parseConfigV003)
- FR-017 topic coverage validation (для spec 002, НЕ для spec 003)
- AgentId обязательное поле в RuleV003Schema (fail-fast при startup)

**Доказательство**:
```typescript
export const RuleV003Schema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  jsonPath: z.string().min(1, 'JSONPath expression is required'),
  promptTemplate: z.string().min(1, 'Prompt template is required'),
  agentId: z.string().min(1, 'Agent ID is required'), // ← FAIL-FAST
  responseTopic: z.string().optional(),
  timeoutSeconds: z.number().int().positive().default(120),
});
```

### 2. Domain Isolation
✅ **Соответствие**:
- matchRuleV003 — pure function без side effects (существующий код)
- buildPromptV003 — pure function без side effects (существующий код)
- IOpenCodeAgent — изолирует consumer logic от OpenCode SDK

**Доказательство**:
```typescript
// Pure function — не зависит от внешнего состояния
export function matchRuleV003(payload: Payload, rules: RuleV003[]): RuleV003 | null {
  // ... чистая функция, нет side effects
}

// Pure function — не зависит от внешнего состояния
export function buildPromptV003(rule: RuleV003, payload: unknown): string {
  // ... чистая функция, нет side effects
}

// Interface для изоляции зависимостей
export interface IOpenCodeAgent {
  invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult>;
  abort(sessionId: string): Promise<boolean>;
}
```

### 3. Resiliency
✅ **Соответствие**:
- try-catch в eachMessage handler (существующий код)
- Ошибки не крашат consumer (отправка в DLQ)
- Timeout handling через Promise.race()
- Commit offset только после ответа (at-least-once semantics)

**Доказательство**:
```typescript
try {
  const agentResult = await invokeAgent(agent, prompt, matchedRule.agentId, ...);

  if (agentResult.status === 'error' || agentResult.status === 'timeout') {
    await sendToDlq(dlqProducer, payload, new Error(`Agent ${agentResult.status}`));
    state.dlqMessagesCount++;
  }
} catch (error) {
  // Любая неожиданная ошибка → DLQ + commit
  await sendToDlq(dlqProducer, payload, error);
}
```

### 4. No-State Consumer
✅ **Соответствие**:
- Никакого session state между сообщениями
- Каждое сообщение обрабатывается независимо
- НЕ используем event hooks (ADR-005: НЕ использовать hooks для simplicity)
- Sequential processing (нет параллелизма)

**Доказательство**:
```typescript
export interface ConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
  // activeSessions: Set<string> — НЕ используется (каждое сообщение независимо)
}

// Синхронный blocking вызов — следующее сообщение начинается после завершения текущего
const agentResult = await invokeAgent(agent, prompt, agentId, timeoutSeconds);
```

### 5. Test-First Development
✅ **Соответствие**:
- Mockable интерфейс IOpenCodeAgent для unit tests
- 90%+ coverage достижимо без реального SDK
- Unit tests для pure functions (matchRuleV003, buildPromptV003)
- Integration tests с Redpanda + mock agent

**Доказательство**:
```typescript
// Mock для unit tests
export class MockOpenCodeAgent implements IOpenCodeAgent {
  async invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult> {
    return {
      status: 'success',
      response: `Mock response for agent ${agentId}`,
      sessionId: 'mock-session-123',
      executionTimeMs: 100,
      timestamp: new Date().toISOString(),
    };
  }
}
```

## Тестируемость (90%+ coverage)

### Achievable?
✅ **ДА, 90%+ coverage достижимо**

**Почему**:
1. **Mockable interface**: IOpenCodeAgent позволяет тестировать consumer logic без реального SDK
2. **Pure functions**: matchRuleV003, buildPromptV003 — легко тестируемые
3. **Unit tests для integration layer**: IOpenCodeAgent, OpenCodeAgentAdapter, MockOpenCodeAgent
4. **Unit tests для consumer**: С mock agent тестируем весь flow
5. **Integration tests**: С Redpanda + mock agent тестируем Kafka integration

**Coverage plan**:
- `src/core/routing.ts` → 100% (pure function, легко)
- `src/core/prompt.ts` → 100% (pure function, легко)
- `src/opencode/OpenCodeAgentAdapter.ts` → 95%+ (с mock SDK)
- `src/opencode/MockOpenCodeAgent.ts` → 100% (mock implementation)
- `src/kafka/consumer.ts` → 95%+ (с mock agent)
- `src/kafka/client.ts` → 90%+ (с mock KafkaJS)
- `src/index.ts` → 100% (entry point)

**Исключения из coverage** (существующее поведение):
- `src/types/opencode-plugin.d.ts` — type definitions
- `src/types/opencode-sdk.d.ts` — type definitions

## Минимальная сложность (Simplicity First)

### Проверка на Simplicity First
✅ **Соответствие**:
- Минимум абстракций (только IOpenCodeAgent — необходим для тестируемости)
- НЕ используем event hooks (ADR-005: НЕ использовать hooks для simplicity)
- Синхронный blocking вызов (простой flow)
- Sequential processing (без параллелизма)
- Optional response topic (не всем пользователям нужна)

**Simplicity score** (1-10, где 10 — максимально просто):
- Архитектура: 8/10
- Integration layer: 7/10 (нужен для тестируемости)
- Consumer flow: 9/10 (последовательная обработка)
- Error handling: 8/10 (DLQ для всех ошибок)
- Graceful shutdown: 7/10 (abort sessions → disconnect)

**Средняя сложность**: 7.8/10 — высокая простота для интеграции с внешней системой

## Обратная совместимость (Backward Compatibility)

### Breaking Changes
❌ **ОДИН breaking change**:
- RuleV003Schema: Добавлено обязательное поле `agentId`

**Impact**:
- Существующие конфиги без `agentId` не валидны
- Плагин не запустится с невалидной конфигурацией (fail-fast)

**Mitigation**:
- Clear migration guide в документации
- Fail-fast при startup (Constitution Principle I)
- Низкий риск: это новый функционал, существующие конфиги ещё не используют OpenCode

### Non-Breaking Changes
✅ **Все остальные изменения backward compatible**:
- `responseTopic` — optional field
- `timeoutSeconds` — optional field с default
- Consumer logic — расширен, но сохраняет существующий flow
- DLQ — без изменений
- Existing tests — не ломаются (только config.test.ts работает)

## Финальная оценка архитектуры

### Strengths (сильные стороны)
1. ✅ **High testability**: 90%+ coverage достижимо через mock interface
2. ✅ **Constitution compliance**: Все 5 принципов соблюдены
3. ✅ **Reliability**: At-least-once processing с commit offset после ответа
4. ✅ **Simplicity**: Минимальная сложность, нет state между сообщениями
5. ✅ **Resiliency**: Timeout handling, DLQ для всех ошибок, graceful shutdown
6. ✅ **Flexibility**: Optional response topic для разных use cases
7. ✅ **Well-documented**: 7 ADR с подробным обоснованием и tradeoffs
8. ✅ **Visual clarity**: 3 диаграммы (High-Level, Message Flow, Shutdown Flow)

### Weaknesses (слабые стороны)
1. ❌ **Lower throughput**: Синхронный blocking вызов ограничивает пропускную способность
   - *Mitigation*: Это ожидаемый tradeoff для reliability
   - *Future work*: Можно добавить async обработку если нужно

2. ❌ **Breaking change**: RuleV003Schema требует agentId
   - *Mitigation*: Clear migration guide, fail-fast при startup
   - *Impact*: Низкий риск (новый функционал)

3. ❌ **Orphan sessions**: Timeout оставляет активные сессии
   - *Mitigation*: Background task для cleanup (future work)
   - *Impact*: Низкий риск (timeouts редкие)

### Risks (риски)
1. ⚠️ **Orphan sessions accumulation**: При частых timeouts могут накапливаться мёртвые сессии
   - *Mitigation*: Background cleanup task (future work)
   - *Priority*: Medium

2. ⚠️ **Response send failures**: Ошибка при отправке ответа не отправляется в DLQ
   - *Mitigation*: Логируем ошибки, ответ не критичен для обработки
   - *Priority*: Low

3. ⚠️ **AgentId management**: Пользователь должен знать ID агентов в OpenCode
   - *Mitigation*: Документация с примерами
   - *Priority*: Low

4. ⚠️ **Idempotent agents**: Агенты должны быть idempotent (для обработки дубликатов)
   - *Mitigation*: Это задача конфигурации агента, а не плагина
   - *Priority*: Medium

## Рекомендации по внедрению

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

## Заключение

✅ **Архитектура соответствует всем требованиям**:
- 5 принципов конституции соблюдены
- 90%+ coverage достижимо
- Минимальная сложность (Simplicity First)
- Обратная совместимость (один понятный breaking change)
- Все tradeoffs задокументированы
- Риски идентифицированы и mitigations предложены

**Готовность к реализации**: ✅ HIGH

**Рекомендация**: ПРИНЯТЬ И РЕАЛИЗОВАТЬ архитектуру как описано в ADR-001...ADR-006

## Следующие шаги для пользователя

1. **Review ADRs**: Прочитать все 7 ADR и задать вопросы по открытым вопросам (ADR-006)
2. **Approve architecture**: Подтвердить, что архитектура соответствует требованиям
3. **Start implementation**: Следовать Phase 1-4 (Foundation → Integration → Testing → Documentation)
4. **Testing**: Запускать `npm run check` после каждого изменения (lint + test)
5. **Validation**: Проверить 90%+ coverage после реализации
6. **Migration**: Обновить существующие конфиги с добавлением agentId
