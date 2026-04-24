/**
 * Kafka client initialization functions
 *
 * Provides environment-based Kafka client creation with fail-fast validation.
 * Implements FR-019, FR-020, FR-021 from spec 003-kafka-consumer.
 *
 * @see https://kafka.js.org/docs/configuration
 * @see https://kafka.js.org/docs/consuming
 * @see https://kafka.js.org/docs/producing
 */

import { Kafka, type Consumer, type Producer, type SASLOptions } from 'kafkajs';
import { kafkaEnvSchema, type KafkaEnv } from '../schemas/index.js';

/**
 * Создаёт Kafka клиент из переменных окружения
 *
 * Читает KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID и конфигурирует Kafka client.
 * Валидирует переменные окружения через kafkaEnvSchema.
 * Бросает Error с field name если required var missing.
 *
 * FR-019: reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID;
 *         validates via kafkaEnvSchema;
 *         throws Error with field name if required var missing;
 *         configures SSL and SASL conditionally
 *
 * @param env - Переменные окружения (обычно process.env)
 * @returns Object containing Kafka client and validated environment
 * @throws {Error} Если required variable missing (с указанием field name)
 *
 * @example
 * ```ts
 * const { kafka, validatedEnv } = createKafkaClient(process.env);
 * ```
 */
export function createKafkaClient(env: NodeJS.ProcessEnv): { kafka: Kafka; validatedEnv: KafkaEnv } {
  // Валидируем переменные окружения через Zod schema
  // Zod выбросит Error с указанием missing field name
  const validatedEnv = kafkaEnvSchema.parse(env);

  // Trims trailing spaces from KAFKA_BROKERS
  const trimmedBrokers = validatedEnv.KAFKA_BROKERS.trim();
  const brokers = trimmedBrokers.split(',').map((b) => b.trim());

  // Создаём конфигурацию для Kafka клиента
  const kafkaConfig: ConstructorParameters<typeof Kafka>[0] = {
    clientId: validatedEnv.KAFKA_CLIENT_ID,
    brokers: brokers,
  };

  // Configures SSL if KAFKA_SSL=true
  if (validatedEnv.KAFKA_SSL) {
    kafkaConfig.ssl = true;
  }

  // Configures SASL if KAFKA_USERNAME + KAFKA_PASSWORD set
  if (validatedEnv.KAFKA_USERNAME && validatedEnv.KAFKA_PASSWORD) {
    const saslConfig: SASLOptions = {
      mechanism: (validatedEnv.KAFKA_SASL_MECHANISM || 'plain') as 'plain' | 'scram-sha-256' | 'scram-sha-512',
      username: validatedEnv.KAFKA_USERNAME,
      password: validatedEnv.KAFKA_PASSWORD,
    };
    kafkaConfig.sasl = saslConfig;
  }

  // Создаём и возвращаем Kafka клиент
  const kafka = new Kafka(kafkaConfig);
  return { kafka, validatedEnv };
}

/**
 * Создаёт Kafka consumer с правильными настройками
 *
 * FR-020: sessionTimeout: 300000, heartbeatInterval: 30000;
 *         groupId passed as explicit parameter (not from env);
 *         autoCommit: false
 *
 * @param kafka - Kafka клиент (созданный через createKafkaClient)
 * @param groupId - Consumer group ID (должен быть валидирован до этого)
 * @returns Kafka consumer
 * @throws {Error} Если groupId пустой или невалидный
 *
 * @example
 * ```ts
 * const { kafka, validatedEnv } = createKafkaClient(process.env);
 * const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);
 * ```
 */
export function createConsumer(kafka: Kafka, groupId: string): Consumer {
  if (!groupId || groupId.trim() === '') {
    throw new Error('groupId is required for consumer creation');
  }

  // Создаём consumer с правильными настройками
  const consumer = kafka.consumer({
    groupId: groupId,
    sessionTimeout: 300000, // 5 минут
    heartbeatInterval: 30000, // 30 секунд
  });

  return consumer;
}

/**
 * Создаёт отдельный producer для DLQ (Dead Letter Queue)
 *
 * FR-021: dedicated producer for DLQ sends;
 *         separate instance from any future main-flow producer
 *
 * @param kafka - Kafka клиент (созданный через createKafkaClient)
 * @returns Kafka producer для DLQ
 *
 * @example
 * ```ts
 * const kafka = createKafkaClient(process.env);
 * const dlqProducer = createDlqProducer(kafka);
 * ```
 */
export function createDlqProducer(kafka: Kafka): Producer {
  // Создаём отдельный producer для DLQ
  // Это отдельный экземпляр от любого основного producer
  // allowAutoTopicCreation: false — DLQ топики должны быть созданы заранее
  const producer = kafka.producer({ allowAutoTopicCreation: false });

  return producer;
}

/**
 * Создаёт отдельный Producer для отправки ответов агентов.
 *
 * FR-022: dedicated producer for agent response sends;
 *         separate instance from DLQ producer для изоляции
 *
 * @param kafka - Kafka клиент (созданный через createKafkaClient)
 * @returns Kafka Producer для отправки ответов
 *
 * @example
 * ```ts
 * const kafka = createKafkaClient(process.env);
 * const responseProducer = await createResponseProducer(kafka);
 * ```
 */
export function createResponseProducer(kafka: Kafka): Producer {
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  return producer;
}
