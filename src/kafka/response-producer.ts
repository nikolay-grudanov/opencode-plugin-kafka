/**
 * Response Producer - отправка ответов агентов в Kafka
 *
 * FR-022: отправляет ResponseMessage в responseTopic;
 *         использует sessionId как Kafka key;
 *         allowAutoTopicCreation: false задаётся при создании producer;
 *         никогда не бросает исключения
 */

import type { Producer } from 'kafkajs';

/**
 * Формат ответного сообщения, отправляемого в responseTopic.
 */
export interface ResponseMessage {
  /** Исходный ключ сообщения */
  messageKey: string;
  /** ID сессии агента */
  sessionId: string;
  /** Имя правила маршрутизации */
  ruleName: string;
  /** ID агента */
  agentId: string;
  /** Текстовый ответ */
  response: string;
  /** Статус ответа (всегда success для успешных) */
  status: 'success';
  /** Время выполнения в миллисекундах */
  executionTimeMs: number;
  /** Время отправки (ISO 8601) */
  timestamp: string;
}

/**
 * Отправляет ответ агента в Kafka topic.
 *
 * Никогда не бросает исключения — ошибки логируются и глотаются.
 * Это обеспечивает resilience: ошибки отправки ответа не должны
 * крашить consumer и прерывать обработку сообщений.
 *
 * @param producer - Kafka producer (созданный через createResponseProducer)
 * @param topic - Kafka topic для отправки ответа
 * @param message - ResponseMessage с данными ответа
 * @returns Promise<void> - всегда завершается без ошибок
 */
export async function sendResponse(
  producer: Producer,
  topic: string,
  message: ResponseMessage,
): Promise<void> {
  try {
    await producer.send({
      topic,
      acks: -1, // all ISR
      messages: [
        {
          key: message.sessionId,
          value: JSON.stringify(message),
        },
      ],
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: 'error',
      event: 'response_send_failed',
      topic,
      errorMessage: errMsg,
      timestamp: new Date().toISOString(),
    }));
  }
}