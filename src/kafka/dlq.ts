/**
 * Dead Letter Queue functions for Kafka Router Plugin
 *
 * Provides DLQ (Dead Letter Queue) functionality for failed messages.
 * Implements FR-022 from spec 003-kafka-consumer.
 *
 * @see https://kafka.js.org/docs/producing
 */

import type { ProducerRecord } from 'kafkajs';
import type { Producer } from 'kafkajs';

/**
 * Тип огибающей сообщения для Dead Letter Queue.
 *
 * Содержит оригинальное сообщение плюс метаданные об ошибке.
 *
 * @see FR-022 в spec 003-kafka-consumer
 */
export interface DlqEnvelope {
  /** Оригинальное значение сообщения (может быть null для tombstone) */
  originalValue: string | null;

  /** Имя оригинального топика */
  topic: string;

  /** Номер оригинальной партиции */
  partition: number;

  /** Оригинальный offset (string для больших чисел) */
  offset: string;

  /** Описание ошибки */
  errorMessage: string;

  /** ISO 8601 timestamp момента отказа */
  failedAt: string;
}

/**
 * Отправляет сообщение в Dead Letter Queue (DLQ).
 *
 * Конструирует DLQ envelope с originalValue, topic, partition, offset, errorMessage, failedAt.
 * Целевой топик берётся из KAFKA_DLQ_TOPIC env или ${topic}-dlq.
 * Обёрнут в try/catch: логирует при ошибке, никогда не бросает исключения.
 *
 * FR-022: constructs DLQ payload with originalValue, topic, partition, offset, errorMessage, failedAt (ISO timestamp);
 *         target topic from KAFKA_DLQ_TOPIC env or ${topic}-dlq;
 *         try/catch wrapper: logs on failure, never throws;
 *         DLQ send failure is non-fatal
 *
 * @param producer - Kafka producer (созданный через createDlqProducer)
 * @param originalMessage - Оригинальное сообщение из Kafka
 * @param error - Ошибка, которая привела к отправке в DLQ
 * @returns Promise<void> — никогда не бросает исключения
 *
 * @example
 * ```ts
 * await sendToDlq(dlqProducer, message, new Error('Invalid JSON'));
 * ```
 */
export async function sendToDlq(
  producer: Producer,
  originalMessage: { value: string | null; topic: string; partition: number; offset: string | number },
  error: Error,
): Promise<void> {
  try {
    // Определяем целевой DLQ топик
    const dlqTopic = process.env.KAFKA_DLQ_TOPIC || `${originalMessage.topic}-dlq`;

    // Конструируем DLQ envelope
    const envelope: DlqEnvelope = {
      originalValue: originalMessage.value,
      topic: originalMessage.topic,
      partition: originalMessage.partition,
      offset: String(originalMessage.offset),
      errorMessage: error.message,
      failedAt: new Date().toISOString(),
    };

    // Формируем Kafka record
    const record: ProducerRecord = {
      topic: dlqTopic,
      messages: [
        {
          value: JSON.stringify(envelope),
          key: `${originalMessage.topic}-${originalMessage.partition}-${originalMessage.offset}`,
        },
      ],
    };

    // Отправляем в DLQ
    await producer.send(record);

    // Логируем успешную отправку (структурированный JSON log)
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'dlq_sent',
        topic: dlqTopic,
        originalTopic: originalMessage.topic,
        partition: originalMessage.partition,
        offset: originalMessage.offset,
        errorMessage: error.message,
        failedAt: envelope.failedAt,
      }),
    );
  } catch (sendError) {
    // DLQ send failure — non-fatal, логируем и продолжаем
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'dlq_send_failed',
        originalTopic: originalMessage.topic,
        partition: originalMessage.partition,
        offset: originalMessage.offset,
        errorMessage: error.message,
        sendError: sendError instanceof Error ? sendError.message : String(sendError),
        failedAt: new Date().toISOString(),
      }),
    );
  }
}
