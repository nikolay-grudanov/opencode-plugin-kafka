/**
 * Утилиты для E2E тестирования Kafka плагина.
 * Создаёт топики, производит и потребляет сообщения из реального Redpanda контейнера.
 */
import { Kafka, type KafkaMessage } from 'kafkajs';

/**
 * Интерфейс тестового сообщения для отправки в Kafka.
 */
interface KafkaTestMessage {
  /** JSON строка с полезной нагрузкой */
  value: string;
  /** Дополнительные заголовки сообщения */
  headers?: Record<string, string>;
}

/**
 * Создаёт Kafka топики через admin client.
 * @param brokers - список брокеров Kafka
 * @param names - названия топиков для создания
 */
async function createTopics(brokers: string[], topics: string[]): Promise<void> {
  const kafka = new Kafka({
    clientId: 'e2e-create-topics',
    brokers,
  });

  const admin = kafka.admin();
  await admin.connect();

  try {
    await admin.createTopics({
      topics: topics.map((topic) => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      })),
      waitForLeaders: true,
    });

    console.log(JSON.stringify({
      msg: 'Topics created',
      topics,
      brokers,
    }));
  } finally {
    try {
      await admin.disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        msg: 'Admin disconnect error',
        error: errorMessage,
      }));
    }
  }
}

/**
 * Отправляет одно сообщение в указанный топик.
 * @param brokers - список брокеров Kafka
 * @param topic - название топика
 * @param message - тестовое сообщение для отправки
 * @param key - опциональный ключ сообщения
 */
async function produceMessage(
  brokers: string[],
  topic: string,
  message: KafkaTestMessage,
  key?: string
): Promise<void> {
  const kafka = new Kafka({
    clientId: 'e2e-produce-message',
    brokers,
  });

  const producer = kafka.producer();
  await producer.connect();

  try {
    const record = {
      topic,
      messages: [
        {
          key: key ?? null,
          value: message.value,
          headers: message.headers,
        },
      ],
    };

    await producer.send(record);

    console.log(JSON.stringify({
      msg: 'Message produced',
      topic,
      key: key ?? null,
      hasHeaders: !!message.headers,
      brokers,
    }));
  } finally {
    try {
      await producer.disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        msg: 'Producer disconnect error',
        error: errorMessage,
      }));
    }
  }
}

/**
 * Потребляет одно сообщение из указанного топика.
 * Использует уникальный consumer group ID для каждого вызова.
 * @param brokers - список брокеров Kafka
 * @param topic - название топика
 * @param timeoutMs - таймаут ожидания сообщения в миллисекундах (по умолчанию 30000)
 * @returns сообщение или null если таймаут истёк
 */
async function consumeOneMessage(
  brokers: string[],
  topic: string,
  timeoutMs: number = 30_000
): Promise<KafkaMessage | null> {
  const kafka = new Kafka({
    clientId: 'e2e-consume-message',
    brokers,
  });

  const consumer = kafka.consumer({
    groupId: crypto.randomUUID(),
  });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  let result: KafkaMessage | null = null;
  let resolveRun: () => void;
  const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

  try {
    // Запускаем consumer
    consumer.run({
      eachMessage: async ({ message }) => {
        result = message;
        resolveRun(); // Сигнализируем что сообщение получено
      },
    });

    // Ждём либо сообщение, либо таймаут
    await Promise.race([runPromise, timeoutPromise]);

    if (result) {
      console.log(JSON.stringify({
        msg: 'Message received',
        topic,
        offset: result.offset,
        partition: result.partition,
        hasKey: !!result.key,
        brokers,
      }));
    } else {
      console.log(JSON.stringify({
        msg: 'Consume timeout',
        topic,
        timeoutMs,
        brokers,
      }));
    }
  } finally {
    try {
      await consumer.stop();
      await consumer.disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        msg: 'Consumer disconnect error',
        error: errorMessage,
      }));
    }
  }

  return result;
}

/**
 * Потребляет несколько сообщений из указанного топика.
 * Использует уникальный consumer group ID для каждого вызова.
 * @param brokers - список брокеров Kafka
 * @param topic - название топика
 * @param expectedCount - ожидаемое количество сообщений
 * @param timeoutMs - общий таймаут ожидания в миллисекундах (по умолчанию 30000)
 * @returns массив сообщений (может быть меньше expectedCount если таймаут)
 */
async function consumeMessages(
  brokers: string[],
  topic: string,
  expectedCount: number,
  timeoutMs: number = 30_000
): Promise<KafkaMessage[]> {
  const kafka = new Kafka({
    clientId: 'e2e-consume-messages',
    brokers,
  });

  const consumer = kafka.consumer({
    groupId: crypto.randomUUID(),
  });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  const messages: KafkaMessage[] = [];
  let resolveRun: () => void;
  const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

  try {
    // Запускаем consumer
    consumer.run({
      eachMessage: async ({ message }) => {
        messages.push(message);
        if (messages.length >= expectedCount) {
          resolveRun(); // Достаточно сообщений получено
        }
      },
    });

    // Ждём либо enough messages, либо таймаут
    await Promise.race([runPromise, timeoutPromise]);

    console.log(JSON.stringify({
      msg: 'Messages received',
      topic,
      count: messages.length,
      expected: expectedCount,
      brokers,
    }));
  } finally {
    try {
      await consumer.stop();
      await consumer.disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        msg: 'Consumer disconnect error',
        error: errorMessage,
      }));
    }
  }

  return messages;
}

export { createTopics, produceMessage, consumeOneMessage, consumeMessages };
export type { KafkaTestMessage, KafkaMessage };