/**
 * Helpers для управления Kafka ресурсами в integration tests.
 * Решает проблему test isolation через уникальные topic names и group IDs.
 */
import { Kafka, type Consumer, type Producer } from 'kafkajs';

/**
 * Генерирует уникальный topic name для test isolation.
 * Формат: {prefix}-{timestamp}-{random}
 */
export function uniqueTopicId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Генерирует уникальный consumer group ID для test isolation.
 */
export function uniqueGroupId(testName: string): string {
  return `test-${testName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Создаёт Kafka topics через admin client.
 * Автоматически disconnects admin после создания.
 */
export async function createTopics(
  kafka: Kafka,
  topics: string[],
  numPartitions = 1,
  replicationFactor = 1
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: topics.map((topic) => ({
        topic,
        numPartitions,
        replicationFactor,
      })),
      waitForLeaders: true,
    });
  } finally {
    await admin.disconnect();
  }
}

/**
 * Безопасная остановка и отключение consumer.
 * Обрабатывает ошибки gracefully — не бросает исключения.
 */
export async function safeStopConsumer(consumer: Consumer): Promise<void> {
  try {
    await consumer.stop();
  } catch {
    // Consumer может быть уже остановлен
  }
  try {
    await consumer.disconnect();
  } catch {
    // Consumer может быть уже отключен
  }
}

/**
 * Безопасное отключение producer.
 */
export async function safeDisconnectProducer(producer: Producer): Promise<void> {
  try {
    await producer.disconnect();
  } catch {
    // Producer может быть уже отключен
  }
}

/**
 * Безопасное отключение списка ресурсов (producers, consumers).
 * Использует Promise.allSettled для параллельной остановки.
 */
export async function safeCleanup(
  resources: Array<Consumer | Producer>
): Promise<void> {
  await Promise.allSettled(
    resources.map(async (resource) => {
      if ('stop' in resource) {
        try { await resource.stop(); } catch { /* ignore */ }
      }
      try { await resource.disconnect(); } catch { /* ignore */ }
    })
  );
}