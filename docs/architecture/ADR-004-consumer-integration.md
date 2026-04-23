# ADR-004: Интеграция в Consumer, Response Producer и Graceful Shutdown

## Контекст

Необходимо интегрировать IOpenCodeAgent в eachMessageHandler и добавить:
1. Вызов агента после buildPrompt
2. Commit offset только после получения ответа
3. Response producer для отправки ответов в Kafka (опционально)
4. Graceful shutdown с abort активных сессий

## Рассмотренные альтернативы

### Вариант 1: Commit offset сразу после отправки промпта
**Описание**: Commit offset после `session.prompt()`, не дожидаясь ответа

**Плюсы**:
- Higher throughput
- Меньшее время обработки сообщения

**Минусы**:
- Потенциальная потеря ответов при краше
- Нет гарантии обработки (at-most-once semantics)
- Нарушает конституцию проекта (Resiliency)

### Вариант 2: Commit offset после получения ответа (ВЫБРАНО)
**Описание**: Commit offset только после успешного ответа или ошибки (DLQ)

**Плюсы**:
- At-least-once semantics (гарантия обработки)
- Соответствует конституции (Resiliency)
- Простой и предсказуемый flow

**Минусы**:
- Lower throughput
- Возможны дубликаты при retry
- *Mitigation*: Агенты должны быть idempotent (задача конфигурации агента)

### Вариант 3: Async response через event hooks
**Описание**: Отправлять промпт сразу, commit offset, ответ получать через `session.idle` hook

**Плюсы**:
- Higher throughput
- Non-blocking

**Минусы**:
- Очень сложная координация состояния
- Сохранение mapping между сообщениями Kafka и сессиями OpenCode
- Нарушает "No-State Consumer" принцип
- Сложно тестируемо

### Вариант 4: Response producer с mandatory responseTopic
**Описание**: Всегда отправлять ответ в Kafka, responseTopic обязателен

**Плюсы**:
- Консистентный output

**Минусы**:
- Жёсткое требование для всех правил
- Меньше гибкости
- *Mitigation*: Сделать responseTopic optional

## Принятое решение

Выбраны:
- **Вариант 2**: Commit offset после получения ответа
- **Response producer optional**: Только если `responseTopic` указан в правиле
- **Graceful shutdown с abort sessions**: Прервать активные сессии → disconnect consumer → disconnect producers

### Обновлённый eachMessageHandler flow

```typescript
/**
 * Обновлённый eachMessageHandler с интеграцией OpenCode
 */
export async function eachMessageHandler(
  payload: EachMessagePayload,
  config: PluginConfigV003,
  dlqProducer: Producer,
  responseProducer: Producer, // Новый параметр
  commitOffsets: CommitOffsetsFn,
  agent: IOpenCodeAgent, // Новый параметр
  state: ConsumerState, // Добавлено activeSessions: Set<string>
): Promise<void> {
  // ... (шаги 1-4 без изменений: tombstone check, size validation, JSON parse, matchRule)

  // 5. Вызываем buildPromptV003
  const prompt = buildPromptV003(matchedRule, parsedPayload);

  // 6. Вызываем OpenCode агента (НОВЫЙ ШАГ)
  const agentResult = await invokeAgent(
    agent,
    prompt,
    matchedRule.agentId,
    matchedRule.timeoutSeconds,
    state,
  );

  // 7. Логируем результат агента
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'agent_invoked',
      ruleName: matchedRule.name,
      agentId: matchedRule.agentId,
      sessionId: agentResult.sessionId,
      status: agentResult.status,
      executionTimeMs: agentResult.executionTimeMs,
      ...(agentResult.response ? { response: agentResult.response.substring(0, 200) + '...' } : {}),
      ...(agentResult.errorMessage ? { errorMessage: agentResult.errorMessage } : {}),
      timestamp: new Date().toISOString(),
    }),
  );

  // 8. Отправляем ответ в responseTopic (если указан)
  if (matchedRule.responseTopic && agentResult.status === 'success') {
    await sendResponse(responseProducer, matchedRule.responseTopic, {
      messageKey: payload.message.key?.toString('utf-8') ?? '',
      sessionId: agentResult.sessionId,
      ruleName: matchedRule.name,
      agentId: matchedRule.agentId,
      response: agentResult.response!,
      status: agentResult.status,
      executionTimeMs: agentResult.executionTimeMs,
      timestamp: agentResult.timestamp,
    });
  }

  // 9. Если ошибка/timeout → отправляем в DLQ ТОЛЬКО (НЕ в responseTopic)
  if (agentResult.status === 'error' || agentResult.status === 'timeout') {
    await sendToDlq(dlqProducer, {
      value: messageValue.toString('utf-8'),
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
    }, new Error(`Agent ${agentResult.status}: ${agentResult.errorMessage}`));
    state.dlqMessagesCount++;
  }

  // 10. Log DLQ rate и commit offset
  logDlqRate(state);
  await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
}

/**
 * Вызывает OpenCode агента с timeout и error handling
 */
async function invokeAgent(
  agent: IOpenCodeAgent,
  prompt: string,
  agentId: string,
  timeoutSeconds: number,
  state: ConsumerState,
): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    // Вызываем агента
    const result = await agent.invoke(prompt, agentId, { timeoutSeconds });

    // Если статус success → добавляем sessionId в active sessions для graceful shutdown
    if (result.status === 'success' && result.sessionId !== 'unknown') {
      // Но тут сессия уже удалена (после получения ответа), так что не добавляем
      // Active sessions нужны только для graceful shutdown активных (в процессе) вызовов
    }

    return result;
  } catch (error) {
    // Любая неожиданная ошибка → status: error
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      status: 'error',
      sessionId: 'unknown',
      errorMessage,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Отправляет ответ в responseTopic
 */
async function sendResponse(
  producer: Producer,
  topic: string,
  response: ResponseMessage,
): Promise<void> {
  try {
    await producer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(response),
          key: response.sessionId, // Используем sessionId как key для partitioning
        },
      ],
    });
  } catch (error) {
    // Логируем ошибку, НЕ бросаем исключение
    // Commit offset делается — сообщение считается обработанным
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'response_send_failed',
        topic,
        sessionId: response.sessionId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    );
    // НЕ отправляем в DLQ (ответ не критичен для обработки Kafka сообщения)
  }
}

/**
 * Формат ответа для Kafka
 */
interface ResponseMessage {
  messageKey: string; // Ключ исходного Kafka-сообщения (для корреляции запрос-ответ)
  sessionId: string;
  ruleName: string;
  agentId: string;
  response: string;
  status: 'success';
  executionTimeMs: number;
  timestamp: string;
}
```

### Обновлённый ConsumerState

```typescript
/**
 * Состояние consumer для отслеживания метрик и активных сессий
 *
 * Добавлено activeSessions для graceful shutdown.
 */
export interface ConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;

  // НОВОЕ: Активные сессии (для graceful shutdown)
  activeSessions: Set<string>;
}
```

### Обновлённый graceful shutdown

```typescript
/**
 * Graceful shutdown с abort активных сессий
 *
 * Порядок:
 * 1. Abort активных сессий OpenCode
 * 2. Disconnect consumer
 * 3. Disconnect DLQ producer
 * 4. Disconnect response producer
 * 5. Timeout: 15 секунд (SC-008)
 */
export async function performGracefulShutdown(
  consumer: Consumer,
  dlqProducer: Producer,
  responseProducer: Producer, // НОВЫЙ параметр
  agent: IOpenCodeAgent, // НОВЫЙ параметр
  signal: string,
  state: ConsumerState,
): Promise<void> {
  // ... (защита от повторных вызовов)

  const startTime = Date.now();

  try {
    // 1. Abort активных сессий OpenCode (НОВЫЙ ШАГ)
    if (state.activeSessions.size > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'aborting_sessions_started',
          activeSessionCount: state.activeSessions.size,
          timestamp: new Date().toISOString(),
        }),
      );

      const abortPromises = Array.from(state.activeSessions).map((sessionId) =>
        agent.abort(sessionId),
      );

      await Promise.allSettled(abortPromises); // Используем allSettled чтобы не крашиться при ошибке

      console.log(
        JSON.stringify({
          level: 'info',
          event: 'aborting_sessions_completed',
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // 2. Disconnect consumer
    // ... (существующий код без изменений)

    // 3. Disconnect DLQ producer
    // ... (существующий код без изменений)

    // 4. Disconnect response producer (НОВЫЙ ШАГ)
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'response_producer_disconnect_started',
        timestamp: new Date().toISOString(),
      }),
    );

    await responseProducer.disconnect();

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'response_producer_disconnect_completed',
        timestamp: new Date().toISOString(),
      }),
    );

    // ... (timeout handling и логирование без изменений)
  } catch (error) {
    // ... (error handling без изменений)
  }
}
```

### Обновлённый startConsumer

```typescript
/**
 * Запускает Kafka consumer с response producer и agent
 */
export async function startConsumer(
  config: PluginConfigV003,
  agent: IOpenCodeAgent, // НОВЫЙ параметр
): Promise<void> {
  // 1. Создаём Kafka клиент (существующий код без изменений)
  const { kafka, validatedEnv } = createKafkaClient(process.env);

  // 2. Создаём consumer (существующий код без изменений)
  const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);

  // 3. Создаём DLQ producer (существующий код без изменений)
  const dlqProducer = createDlqProducer(kafka);

  // 4. Создаём response producer (НОВЫЙ ШАГ)
  const responseProducer = createResponseProducer(kafka);

  // 5. Создаём состояние consumer с activeSessions
  const state: ConsumerState = {
    isShuttingDown: false,
    totalMessagesProcessed: 0,
    dlqMessagesCount: 0,
    lastDlqRateLogTime: Date.now(),
    activeSessions: new Set(), // НОВОЕ
  };

  // ... (подключение consumer и producer без изменений)

  // 6. Обновляем eachMessageHandler с agent и responseProducer
  consumer.run({
    autoCommit: false,
    eachMessage: async (payload: EachMessagePayload) => {
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        responseProducer, // НОВЫЙ параметр
        consumer.commitOffsets.bind(consumer),
        agent, // НОВЫЙ параметр
        state,
      );
    },
  });

  // ... (обработка ошибок и shutdown без изменений)
}

/**
 * Создаёт response producer
 */
export function createResponseProducer(kafka: Kafka): Producer {
  return kafka.producer({
    allowAutoTopicCreation: false, // Не создаём топики автоматически
  });
}
```

### Обновлённый entry point (src/index.ts)

```typescript
import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';
import type { PluginContext } from './types/opencode-plugin.d.js';

export default async function plugin(context: PluginContext) {
  try {
    // 1. Парсим конфигурацию
    const config = parseConfigV003();

    // 2. Создаём OpenCode agent adapter
    const agent = new OpenCodeAgentAdapter(context.client);

    // 3. Запускаем consumer с agent
    await startConsumer(config, agent);

    return {};
  } catch (error) {
    // ... (error handling без изменений)
  }
}
```

## Обоснование (Rationale)

### Почему commit offset после ответа?
1. **Reliability**: No data loss even if consumer crashes after sending prompt
2. **At-least-once semantics**: Гарантия обработки
3. **Constitution compliance**: Соответствует "Resiliency" принципу

### Почему response topic optional?
1. **Simplicity**: Для многих use cases достаточно логов
2. **Flexibility**: Пользователь выбирает: логи vs Kafka ответ
3. **Backward compatibility**: Существующие конфиги без responseTopic продолжают работать

### Почему DLQ для agent errors?
1. **Constitution compliance**: "Resiliency" — ошибки не крашат consumer
2. **Visibility**: DLQ позволяет анализировать неудачные сообщения
3. **Retry possibility**: Можно повторно отправить сообщения из DLQ
4. **НЕТ retry**: При ошибке вызова агента — сразу в DLQ, никаких retry

### Почему abort sessions перед disconnect?
1. **Clean shutdown**: Прерывание активных сессий до disconnect
2. **Cost**: Не оставляем мёртвые сессии в OpenCode
3. **Graceful**: Дать агентам шанс корректно завершить работу

### Почему Promise.allSettled для abort?
1. **Resiliency**: Если один abort failed, продолжаем с другими
2. **Non-blocking**: Не крашим graceful shutdown из-за ошибок abort
3. **Visibility**: Логируем failed aborts для анализа

### Почему activeSessions Map (v1)?
1. **Graceful shutdown**: Используется для abort all active sessions при shutdown
2. **Best-effort abort**: При timeout сессия добавляется в activeSessions для возможности abort
3. **Future work**: Full cleanup (background task для orphan detection) — в v2

### Почему не используем activeSessions?
1. **Simplicity**: После получения ответа сессия удалена, activeSessions не нужна
2. **Future work**: Если захотим abort активных (в процессе) сессий, можно добавить tracking
3. **Current implementation**: Graceful shutdown не aborts active sessions (они уже завершены)

## Последствия

### Положительные

1. **Reliability**: At-least-once processing с commit offset после ответа
2. **Flexibility**: Optional response topic для разных use cases
3. **Constitution compliance**: Все 5 принципов соблюдены
4. **Clean shutdown**: Abort sessions → disconnect consumer → disconnect producers
5. **Error visibility**: DLQ для всех ошибок

### Отрицательные

1. **Lower throughput**: Синхронный blocking вызов ограничивает пропускную способность
   - *Mitigation*: Это ожидаемый tradeoff для reliability

2. **Potential duplicates**: At-least-once processing может создавать дубликаты
   - *Mitigation*: Агенты должны быть idempotent

3. **Response send failures**: Ошибка при отправке ответа не отправляется в DLQ
   - *Mitigation*: Логируем ошибки, ответ не критичен для обработки

4. **Additional complexity**: response producer добавляет ещё один Kafka connection
   - *Mitigation*: Разумная цена за гибкость

## Следующие шаги

1. Обновить файл `src/kafka/consumer.ts` с eachMessageHandler
2. Обновить файл `src/kafka/consumer.ts` с performGracefulShutdown
3. Обновить файл `src/kafka/consumer.ts` с startConsumer
4. Обновить файл `src/kafka/client.ts` с createResponseProducer
5. Обновить файл `src/index.ts` с OpenCodeAgentAdapter
6. Обновить файл `src/schemas/index.ts` с RuleV003Schema (agentId, responseTopic, timeoutSeconds)
7. Написать unit tests для всех изменений
8. Написать integration tests с real Redpanda и mock agent

## Open вопросы

1. **Response format**: Какой формат ответа для responseTopic? (сейчас: JSON с messageKey, sessionId, ruleName, agentId, response, status, executionTimeMs, timestamp)
   - *Recommendation*: Оставить текущий формат, добавить возможность настройки через template

2. **Active sessions tracking**: activeSessions Map используется для:
   - Graceful shutdown: abort all active sessions
   - Best-effort abort при timeout (v1)
   - Full cleanup (background task для orphan detection) — v2

3. **Orphan sessions**: Best-effort abort в v1 — при graceful shutdown пытаемся abort все active sessions. Full cleanup — в v2.

4. **Response send failures**: Нет retry — логируем ошибку, НЕ бросаем исключение, commit offset
