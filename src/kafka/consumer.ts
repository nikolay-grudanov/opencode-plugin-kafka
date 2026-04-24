/**
 * Kafka consumer handler for sequential message processing.
 *
 * Implements eachMessageHandler for strict sequential processing with DLQ support.
 * Implements startConsumer for orchestrating Kafka client lifecycle.
 * Implements FR-023, FR-024 from spec 003-kafka-consumer.
 *
 * @see https://kafka.js.org/docs/consuming#a-name-getting-the-message-a-message
 */
import type { PluginConfigV003 } from '../schemas/index.js';
import type { Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { matchRuleV003 } from '../core/routing.js';
import { buildPromptV003 } from '../core/prompt.js';
import { sendToDlq } from './dlq.js';
import { createKafkaClient, createConsumer, createDlqProducer, createResponseProducer } from './client.js';
import { sendResponse } from './response-producer.js';
import type { IOpenCodeAgent, AgentResult } from '../opencode/IOpenCodeAgent.js';

/**
 * Максимальный размер сообщения (1MB по умолчанию для KafkaJS).
 */
const MAX_MESSAGE_SIZE_BYTES = 1024 * 1024; // 1MB

/**
 * Максимальное время для graceful shutdown (15 секунд) (SC-008).
 */
const SHUTDOWN_TIMEOUT_MS = 15_000; // 15 seconds (SC-008)

/**
 * Максимальное количество retry для broker throttle.
 */
const MAX_THROTTLE_RETRIES = 3;

/**
 * Пауза между retry при broker throttle (1 секунда).
 */
const THROTTLE_RETRY_DELAY_MS = 1000; // 1 second

/**
 * Интервал для логирования DLQ rate (каждые 100 сообщений).
 */
const DLQ_RATE_LOG_INTERVAL = 100;

/**
 * Тип для функции commitOffsets из KafkaJS Consumer.
 *
 * @see https://kafka.js.org/docs/consuming#a-name-committing-offsets-a-committing-offsets
 */
export type CommitOffsetsFn = (
  _offsets: Array<{ topic: string; partition: number; offset: string }>,
) => Promise<void>;

/**
 * Состояние consumer для отслеживания метрик и shutdown (Constitution Principle IV: No-State Consumer).
 */
export interface ConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

/**
 * Логирует DLQ rate (NFR-010).
 *
 * Логирует процент сообщений, отправленных в DLQ, каждые DLQ_RATE_LOG_INTERVAL сообщений.
 *
 * @param state - Состояние consumer с метриками
 * @returns void
 */
export function logDlqRate(state: ConsumerState): void {
  const currentTime = Date.now();
  const timeSinceLastLog = currentTime - state.lastDlqRateLogTime;

  // Логируем каждые DLQ_RATE_LOG_INTERVAL сообщений
  if (state.totalMessagesProcessed > 0 && state.totalMessagesProcessed % DLQ_RATE_LOG_INTERVAL === 0) {
    const dlqRate = (state.dlqMessagesCount / state.totalMessagesProcessed) * 100;

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'dlq_rate',
        totalMessages: state.totalMessagesProcessed,
        dlqMessages: state.dlqMessagesCount,
        dlqRatePercent: dlqRate.toFixed(2),
        timeSinceLastLogMs: timeSinceLastLog,
        timestamp: new Date().toISOString(),
      }),
    );

    state.lastDlqRateLogTime = currentTime;
  }
}

/**
 * Логирует consumer lag metrics (NFR-010).
 *
 * Логирует текущий offset и message timestamp для расчёта consumer lag внешними инструментами.
 * KafkaJS не предоставляет прямой API для получения consumer lag, но мы можем логировать метаданные.
 *
 * @param payload - Сообщение из Kafka (eachMessage payload)
 * @returns void
 */
export function logConsumerLagMetrics(payload: EachMessagePayload): void {
  console.log(
    JSON.stringify({
      level: 'debug',
      event: 'consumer_lag_metrics',
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
      messageTimestamp: payload.message.timestamp,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Проверяет, является ли ошибка broker throttle (NFR-012).
 *
 * KafkaJS выбрасывает ошибки типа "Request throttled by broker".
 * Функция проверяет, содержит ли сообщение об ошибке ключевые слова throttle.
 *
 * @param error - Ошибка для проверки
 * @returns true если это throttle ошибка, иначе false
 */
export function isBrokerThrottleError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    errorMessage.toLowerCase().includes('throttle') ||
    errorMessage.toLowerCase().includes('rate limit') ||
    errorMessage.toLowerCase().includes('too many requests')
  );
}

/**
 * Выполняет операцию с retry логикой для broker throttle (NFR-012).
 *
 * ⚠️ Use ONLY for Kafka I/O operations (commitOffsets, producer.send).
 * Do NOT use for pure functions — they cannot receive Kafka throttle errors.
 *
 * Если операция вызывает throttle ошибку, пауза 1s и retry до MAX_THROTTLE_RETRIES раз.
 * Если throttle сохраняется после всех retry, выбрасывает ошибку для обработки в DLQ.
 *
 * @param operation - Асинхронная операция для выполнения
 * @param operationName - Имя операции для логирования
 * @returns Promise<T> — результат операции
 * @throws Error если throttle сохраняется после всех retry
 *
 * @template T - Тип возвращаемого значения операции
 */
export async function executeWithThrottleRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_THROTTLE_RETRIES; attempt++) {
    try {
      // Пытаемся выполнить операцию
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Проверяем, является ли это throttle ошибкой
      if (!isBrokerThrottleError(lastError)) {
        // Это не throttle ошибка — выбрасываем сразу
        throw lastError;
      }

      // Это throttle ошибка — логируем и retry
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'broker_throttle_detected',
          operation: operationName,
          attempt: attempt,
          maxAttempts: MAX_THROTTLE_RETRIES,
          error: lastError.message,
          timestamp: new Date().toISOString(),
        }),
      );

      // Если это последний attempt — выбрасываем ошибку для DLQ
      if (attempt === MAX_THROTTLE_RETRIES) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'broker_throttle_max_retries_exceeded',
            operation: operationName,
            maxAttempts: MAX_THROTTLE_RETRIES,
            error: lastError.message,
            timestamp: new Date().toISOString(),
          }),
        );
        throw lastError;
      }

      // Пауза перед retry
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'broker_throttle_retrying',
          operation: operationName,
          attempt: attempt,
          retryDelayMs: THROTTLE_RETRY_DELAY_MS,
          timestamp: new Date().toISOString(),
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, THROTTLE_RETRY_DELAY_MS));
    }
  }

  // Этот код недостижим, но TypeScript требует return
  throw lastError || new Error('Unknown error in executeWithThrottleRetry');
}

/**
 * Обработчик одного сообщения с sequential processing.
 *
 * FR-023: parses message.value as JSON (throws → DLQ);
 *         validates message size (max 1MB, oversized → DLQ);
 *         calls matchRuleV003() (throws → DLQ);
 *         calls buildPromptV003() (throws → DLQ);
 *         invokes OpenCode agent (errors → DLQ);
 *         sends response to responseTopic (success flow);
 *         commits offset on success;
 *         autoCommit: false — manual commitOffsets() after each message
 *
 * Каждая операция выполняется последовательно с await, что обеспечивает:
 * - Никакого параллелизма
 * - Следующее сообщение начинается только после завершения текущего
 * - Естественный backpressure для защиты OpenCode агента
 *
 * @param payload - Сообщение из Kafka (eachMessage payload)
 * @param config - Конфигурация плагина (PluginConfigV003)
 * @param dlqProducer - Producer для отправки в DLQ
 * @param commitOffsets - Функция для commit offsets из KafkaJS consumer
 * @param state - Состояние consumer (Constitution Principle IV: No-State Consumer)
 * @param agent - OpenCode agent для обработки сообщений
 * @param responseProducer - Producer для отправки ответов агентам
 * @param activeSessions - Set для отслеживания активных сессий (Set<AbortController>)
 * @returns Promise<void>
 *
 * @example
 * ```ts
 * await eachMessageHandler(
 *   { topic: 'test', partition: 0, message: { value: Buffer.from('{"test":1}'), ... } },
 *   config,
 *   dlqProducer,
 *   consumer.commitOffsets.bind(consumer),
 *   state,
 *   agent,
 *   responseProducer,
 *   activeSessions
 * );
 * ```
 */
export async function eachMessageHandler(
  payload: EachMessagePayload,
  config: PluginConfigV003,
  dlqProducer: Producer,
  commitOffsets: CommitOffsetsFn,
  state: ConsumerState,
  agent: IOpenCodeAgent,
  responseProducer: Producer,
  activeSessions: Set<AbortController>,
): Promise<void> {
  // Проверяем состояние shutdown — если shutdown в процессе, не обрабатываем новые сообщения
  if (state.isShuttingDown) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'message_skipped_during_shutdown',
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
      }),
    );
    return;
  }

  // Увеличиваем счётчик сообщений
  state.totalMessagesProcessed++;

  // Логируем consumer lag metrics (NFR-010)
  logConsumerLagMetrics(payload);

  const startTime = Date.now();

  try {
    // 1. Проверяем message value (null = tombstone)
    const messageValue = payload.message.value;
    if (messageValue === null) {
      const ignoreTombstones = process.env.KAFKA_IGNORE_TOMBSTONES === 'true';
      if (ignoreTombstones) {
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'tombstone_ignored',
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
            timestamp: new Date().toISOString(),
          }),
        );
        await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
        return;
      }
      // Default: отправляем tombstone в DLQ
      const error = new Error('Message value is null (tombstone message)');
      await sendToDlq(dlqProducer, {
        value: null,
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        originalKey: payload.message.key?.toString() ?? null,
      }, error);
      state.dlqMessagesCount++;
      logDlqRate(state);
      await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
      return;
    }

    // 2. Валидируем размер сообщения (max 1MB)
    const messageSize = messageValue.length;
    if (messageSize > MAX_MESSAGE_SIZE_BYTES) {
      const error = new Error(`Message size (${messageSize} bytes) exceeds maximum (${MAX_MESSAGE_SIZE_BYTES} bytes)`);
      await sendToDlq(dlqProducer, {
        value: messageValue.toString('utf-8'),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        originalKey: payload.message.key?.toString() ?? null,
      }, error);
      state.dlqMessagesCount++;
      logDlqRate(state);
      await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
      return;
    }

    // 3. Парсим JSON из message.value (throws → DLQ)
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(messageValue.toString('utf-8'));
    } catch (parseError) {
      const error = parseError instanceof Error ? parseError : new Error('Failed to parse JSON');
      await sendToDlq(dlqProducer, {
        value: messageValue.toString('utf-8'),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        originalKey: payload.message.key?.toString() ?? null,
      }, error);
      state.dlqMessagesCount++;
      logDlqRate(state);
      await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
      return;
    }

    // 4. Вызываем matchRuleV003 (throws → DLQ) — sync pure function
    let matchedRule: ReturnType<typeof matchRuleV003>;
    try {
      matchedRule = matchRuleV003(parsedPayload, config.rules);
    } catch (matchError) {
      const error = matchError instanceof Error ? matchError : new Error('Failed to match rule');
      await sendToDlq(dlqProducer, {
        value: messageValue.toString('utf-8'),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        originalKey: payload.message.key?.toString() ?? null,
      }, error);
      state.dlqMessagesCount++;
      logDlqRate(state);
      await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
      return;
    }

    // Если ни одно правило не совпало — это не ошибка, просто логируем и коммитим
    if (!matchedRule) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'no_rule_matched',
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          timestamp: new Date().toISOString(),
        }),
      );
      logDlqRate(state);
      await commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]);
      return;
    }

    // 5. Вызываем buildPromptV003 (никогда не throws, возвращает fallback) — sync pure function
    const prompt = buildPromptV003(matchedRule, parsedPayload);

    // 6. Логируем matched rule name и prompt с processing time (NFR-010)
    const processingTime = Date.now() - startTime;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'message_processed',
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        matchedRule: matchedRule.name,
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''), // Логируем первые 200 символов
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
      }),
    );

    // 7. Вызываем OpenCode агента (C2: AbortController для реальной отмены)
    const abortController = new AbortController();
    activeSessions.add(abortController);

    let agentResult: AgentResult;
    try {
      agentResult = await agent.invoke(prompt, matchedRule.agentId, {
        timeoutMs: matchedRule.timeoutMs ?? 120_000,
        signal: abortController.signal,
      });
    } finally {
      activeSessions.delete(abortController); // гарантированная очистка во всех путях
    }

    // 8. Обрабатываем результат агента — отправляем response или DLQ
    const sessionId = agentResult.sessionId;

    if (agentResult.status === 'success') {
      // Отправляем response если правило имеет responseTopic
      if (matchedRule.responseTopic) {
        await sendResponse(responseProducer, matchedRule.responseTopic, {
          messageKey: sessionId,
          sessionId,
          ruleName: matchedRule.name,
          agentId: matchedRule.agentId,
          response: agentResult.response ?? '',
          status: 'success',
          executionTimeMs: agentResult.executionTimeMs,
          timestamp: new Date().toISOString(),
        });
      }
      // Логируем успешное выполнение
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'agent_invoke_success',
          sessionId,
          ruleName: matchedRule.name,
          agentId: matchedRule.agentId,
          executionTimeMs: agentResult.executionTimeMs,
          timestamp: new Date().toISOString(),
        }),
      );
    } else {
      // Агент вернул ошибку или timeout → отправляем в DLQ
      const errorReason = agentResult.status === 'timeout' ? 'Agent timeout' : 'Agent error';
      const errorMsg = agentResult.errorMessage ?? errorReason;
      const error = new Error(`Agent invoke failed: ${errorMsg} (status: ${agentResult.status})`);
      await sendToDlq(dlqProducer, {
        value: messageValue.toString('utf-8'),
        topic: payload.topic,
        partition: payload.partition,
        offset: payload.message.offset,
        originalKey: payload.message.key?.toString() ?? null,
      }, error);
      state.dlqMessagesCount++;

      console.error(
        JSON.stringify({
          level: 'error',
          event: 'agent_invoke_failed',
          sessionId,
          ruleName: matchedRule.name,
          agentId: matchedRule.agentId,
          agentStatus: agentResult.status,
          errorMessage: errorMsg,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // 9. Commit offset on success с throttle retry
    logDlqRate(state);
    await executeWithThrottleRetry(
      () => commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]),
      'commitOffsets',
    );
  } catch (error) {
    // Любая неожиданная ошибка → DLQ + commit
    const errorMessage = error instanceof Error ? error.message : String(error);
    const dlqError = new Error(`Unexpected error in eachMessageHandler: ${errorMessage}`);

    await sendToDlq(dlqProducer, {
      value: payload.message.value?.toString('utf-8') ?? null,
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
      originalKey: payload.message.key?.toString() ?? null,
    }, dlqError);

    state.dlqMessagesCount++;
    logDlqRate(state);

    await executeWithThrottleRetry(
      () => commitOffsets([{ topic: payload.topic, partition: payload.partition, offset: payload.message.offset }]),
      'commitOffsets',
    );
  }
}

/**
 * Выполняет graceful shutdown для consumer и producers.
 *
 * SIGTERM/SIGINT → abort all active sessions → consumer.disconnect() → dlqProducer.disconnect() → responseProducer.disconnect().
 * Single timeout: 15 секунд для всего процесса shutdown (force-kill after timeout) (SC-008).
 * SIGTERM во время DLQ send: завершается отправка, затем disconnect.
 * Последовательность логируется.
 *
 * FR-016: abort all active sessions via agent.abort() using Promise.allSettled()
 * FR-026: SIGTERM/SIGINT → consumer.disconnect() → dlqProducer.disconnect() → responseProducer.disconnect();
 *         Single timeout: 15 seconds (force-kill after timeout) (SC-008);
 *         SIGTERM during DLQ send: complete it, then disconnect;
 *         Sequence logged
 *
 * @param consumer - Kafka consumer для отключения
 * @param dlqProducer - Kafka DLQ producer для отключения
 * @param responseProducer - Kafka response producer для отключения
 * @param signal - Сигнал shutdown ('SIGTERM' или 'SIGINT')
 * @param state - Состояние consumer (Constitution Principle IV: No-State Consumer)
 * @param exitFn - Функция для выхода из процесса (по умолчанию process.exit)
 * @param agent - OpenCode agent для abort активных сессий (опционально)
 * @param activeSessions - Set активных сессий для abort (C2: Set<AbortController>, опционально)
 * @returns Promise<void>
 *
 * @example
 * ```ts
 * await performGracefulShutdown(consumer, dlqProducer, responseProducer, 'SIGTERM', state, undefined, agent, activeSessions);
 * ```
 */
export async function performGracefulShutdown(
  consumer: Consumer,
  dlqProducer: Producer,
  responseProducer: Producer,
  signal: string,
  state: ConsumerState,
  exitFn: (code: number) => never = process.exit as (code: number) => never,
  // зарезервировано для будущего использования; отмена через AbortController
  _agent?: IOpenCodeAgent,
  activeSessions?: Set<AbortController>,
): Promise<void> {
  // Защита от повторных вызовов
  if (state.isShuttingDown) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'shutdown_already_in_progress',
        signal,
        timestamp: new Date().toISOString(),
      }),
    );
    return Promise.resolve();
  }

  state.isShuttingDown = true;

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'graceful_shutdown_started',
      signal,
      timestamp: new Date().toISOString(),
    }),
  );

  const startTime = Date.now();

  try {
    // Создаем Promise для graceful shutdown с timeout
    const shutdownPromise = (async () => {
      // 0. Abort all active sessions via AbortController.abort() (C2: заменяет agent.abort())
      if (activeSessions && activeSessions.size > 0) {
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'aborting_active_sessions',
            sessionCount: activeSessions.size,
            timestamp: new Date().toISOString(),
          }),
        );

        // C2: Вызываем abort() на каждом AbortController
        let abortedCount = 0;
        for (const controller of activeSessions) {
          try {
            controller.abort();
            abortedCount++;
          } catch (abortError) {
            console.warn(
              JSON.stringify({
                level: 'warn',
                event: 'session_abort_failed',
                error: abortError instanceof Error ? abortError.message : String(abortError),
                timestamp: new Date().toISOString(),
              }),
            );
          }
        }

        console.log(
          JSON.stringify({
            level: 'info',
            event: 'sessions_aborted',
            totalSessions: activeSessions.size,
            abortedCount,
            timestamp: new Date().toISOString(),
          }),
        );

        // Очищаем activeSessions после abort
        activeSessions.clear();
      }

      try {
        // 1. Disconnect consumer
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'consumer_disconnect_started',
            timestamp: new Date().toISOString(),
          }),
        );

        await consumer.disconnect();

        console.log(
          JSON.stringify({
            level: 'info',
            event: 'consumer_disconnect_completed',
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (consumerError) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'consumer_disconnect_failed',
            error: consumerError instanceof Error ? consumerError.message : String(consumerError),
            timestamp: new Date().toISOString(),
          }),
        );
        // Продолжаем shutdown даже если consumer.disconnect() не удался
      }

      try {
        // 2. Disconnect DLQ producer
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'dlq_producer_disconnect_started',
            timestamp: new Date().toISOString(),
          }),
        );

        await dlqProducer.disconnect();

        console.log(
          JSON.stringify({
            level: 'info',
            event: 'dlq_producer_disconnect_completed',
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (dlqProducerError) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'dlq_producer_disconnect_failed',
            error: dlqProducerError instanceof Error ? dlqProducerError.message : String(dlqProducerError),
            timestamp: new Date().toISOString(),
          }),
        );
        // Продолжаем shutdown даже если dlqProducer.disconnect() не удался
      }

      try {
        // 3. Disconnect response producer
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
      } catch (responseProducerError) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'response_producer_disconnect_failed',
            error: responseProducerError instanceof Error ? responseProducerError.message : String(responseProducerError),
            timestamp: new Date().toISOString(),
          }),
        );
        // Продолжаем shutdown даже если responseProducer.disconnect() не удался
      }
    })();

    // Ждем завершения shutdown или timeout
    await Promise.race([
      shutdownPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Graceful shutdown timeout')), SHUTDOWN_TIMEOUT_MS),
      ),
    ]);

    const shutdownTime = Date.now() - startTime;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'graceful_shutdown_completed',
        shutdownTimeMs: shutdownTime,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const shutdownTime = Date.now() - startTime;

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'graceful_shutdown_failed',
        error: errorMessage,
        shutdownTimeMs: shutdownTime,
        timestamp: new Date().toISOString(),
      }),
    );

    // Force exit после timeout
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'force_exit_after_timeout',
        signal,
        shutdownTimeMs: shutdownTime,
        timestamp: new Date().toISOString(),
      }),
    );

    exitFn(1);
  }
}

/**
 * Запускает Kafka consumer с graceful shutdown support.
 *
 * FR-024: wires FR-019..FR-023 together;
 *         Subscribes to all config.topics;
 *         Registers SIGTERM/SIGINT handlers;
 *         Orchestrates createKafkaClient → createConsumer → createDlqProducer → createResponseProducer → eachMessageHandler
 *
 * FR-026: SIGTERM/SIGINT → consumer.disconnect() → dlqProducer.disconnect() → responseProducer.disconnect();
 *         Shutdown timeout: 15 seconds (force-kill after timeout) (SC-008);
 *         SIGTERM during DLQ send: complete it, then disconnect;
 *         Sequence logged
 *
 * @param config - Конфигурация плагина (PluginConfigV003)
 * @param agent - OpenCode agent для обработки сообщений
 * @returns Promise<void> — resolves after successful consumer initialization;
 *         consumer continues running in background until SIGTERM/SIGINT
 *
 * @example
 * ```ts
 * await startConsumer(config, agent);
 * ```
 */
export async function startConsumer(
  config: PluginConfigV003,
  agent: IOpenCodeAgent,
): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'kafka_consumer_starting',
      topics: config.topics,
      rulesCount: config.rules.length,
      timestamp: new Date().toISOString(),
    }),
  );

  // 1. Создаем Kafka клиент (FR-019)
  const { kafka, validatedEnv } = createKafkaClient(process.env);

  // 2. Создаем consumer (FR-020)
  const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);

  // 3. Создаем DLQ producer (FR-021)
  const dlqProducer = createDlqProducer(kafka);

  // 3a. Создаем response producer для отправки ответов агентов (FR-022)
  const responseProducer = createResponseProducer(kafka);

  // 4. Создаем состояние consumer (Constitution Principle IV: No-State Consumer)
  const state: ConsumerState = {
    isShuttingDown: false,
    totalMessagesProcessed: 0,
    dlqMessagesCount: 0,
    lastDlqRateLogTime: Date.now(),
  };

  // 4a. Создаем Set для отслеживания активных сессий агентов (C2: AbortController)
  const activeSessions = new Set<AbortController>();

  try {
    // 5. Подключаем consumer и producer
    await consumer.connect();
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'consumer_connected',
        timestamp: new Date().toISOString(),
      }),
    );

    await dlqProducer.connect();
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'dlq_producer_connected',
        timestamp: new Date().toISOString(),
      }),
    );

    await responseProducer.connect();
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'response_producer_connected',
        timestamp: new Date().toISOString(),
      }),
    );

    // 6. Подписываемся на все топики из конфигурации
    await consumer.subscribe({ topics: config.topics });
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'consumer_subscribed',
        topics: config.topics,
        timestamp: new Date().toISOString(),
      }),
    );

    // 7. Регистрируем SIGTERM/SIGINT handlers для graceful shutdown
    const shutdownHandler = async (signal: NodeJS.Signals) => {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'shutdown_signal_received',
          signal,
          timestamp: new Date().toISOString(),
        }),
      );

      // Выполняем graceful shutdown с agent и activeSessions (FR-016)
      await performGracefulShutdown(
        consumer,
        dlqProducer,
        responseProducer,
        signal,
        state,
        process.exit as (code: number) => never,
        agent,
        activeSessions,
      );

      // Выходим из процесса после успешного shutdown
      process.exit(0);
    };

    process.once('SIGTERM', shutdownHandler);
    process.once('SIGINT', shutdownHandler);

    // 8. Логируем что consumer запущен
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'kafka_consumer_started',
        topics: config.topics,
        timestamp: new Date().toISOString(),
      }),
    );

    // 9. Запускаем consumer с eachMessage handler (FR-023)
    // consumer.run() никогда не resolve — запускаем без await
    consumer.run({
      autoCommit: false, // Required: manual offset commit via commitOffsets()
      eachMessage: async (payload: EachMessagePayload) => {
        await eachMessageHandler(payload, config, dlqProducer, consumer.commitOffsets.bind(consumer), state, agent, responseProducer, activeSessions);
      },
    }).catch((error) => {
      // Фатальная ошибка в run loop — пытаемся выполнить graceful shutdown
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'consumer_run_loop_error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
      );

      // Выполняем graceful shutdown при ошибке
      performGracefulShutdown(
        consumer,
        dlqProducer,
        responseProducer,
        'ERROR',
        state,
        process.exit as (code: number) => never,
        agent,
        activeSessions,
      ).finally(() => process.exit(1));
    });

    // startConsumer() возвращает здесь после успешной инициализации
    // Consumer продолжает работать в фоновом режиме
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'kafka_consumer_error',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
    );

    // Graceful shutdown даже в случае ошибки (FR-016)
    await performGracefulShutdown(
      consumer,
      dlqProducer,
      responseProducer,
      'ERROR',
      state,
      process.exit as (code: number) => never,
      agent,
      activeSessions,
    );

    process.exit(1);
  }
}
