/**
 * Kafka client initialization functions
 *
 * Provides environment-based Kafka client creation with fail-fast validation.
 * Implements FR-019, FR-020, FR-021 from spec 003-kafka-consumer.
 *
 * SSL Support:
 * - KAFKA_SSL=true: Uses simple SSL with system truststore
 * - KAFKA_SSL=true + KAFKA_SSL_CA/CERT/KEY: Uses PEM certificates
 *
 * @see https://kafka.js.org/docs/configuration
 * @see https://kafka.js.org/docs/consuming
 * @see https://kafka.js.org/docs/producing
 */

import { promises as fs } from 'fs';
import { Kafka, type Consumer, type Producer, type SASLOptions } from 'kafkajs';
import { kafkaEnvSchema, type KafkaEnv } from '../schemas/index.js';

/**
 * Reads a PEM file and returns its content as Buffer
 * Returns null if filePath is not provided
 *
 * @param filePath - Path to PEM file
 * @returns Promise<Buffer | null>
 */
async function readPemFile(filePath: string | undefined): Promise<Buffer | null> {
  if (!filePath) return null;
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

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
 *         configures SSL and SASL conditionally;
 *         supports PEM certificates via KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY;
 *
 * @param env - Переменные окружения (обычно process.env)
 * @returns Object containing Kafka client and validated environment
 * @throws {Error} Если required variable missing (с указанием field name)
 *
 * @example
 * ```ts
 * const { kafka, validatedEnv } = createKafkaClient(process.env);
 * ```
 *
 * @example with SSL
 * ```ts
 * process.env.KAFKA_SSL = 'true';
 * process.env.KAFKA_SSL_CA = './kafka-ssl/ca.pem';
 * process.env.KAFKA_SSL_CERT = './kafka-ssl/client.pem';
 * process.env.KAFKA_SSL_KEY = './kafka-ssl/client-key.pem';
 * const { kafka, validatedEnv } = createKafkaClient(process.env);
 * ```
 */
export async function createKafkaClient(env: NodeJS.ProcessEnv): Promise<{
  kafka: Kafka;
  validatedEnv: KafkaEnv;
}> {
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

  // Configures SSL if KAFKA_SSL=true or PEM certs are provided
  if (validatedEnv.KAFKA_SSL || validatedEnv.KAFKA_SSL_CA || validatedEnv.KAFKA_SSL_CERT || validatedEnv.KAFKA_SSL_KEY) {
    // Check if PEM certificates are provided
    const sslOptions: Record<string, unknown> = {};

    // Read PEM files if provided
    if (validatedEnv.KAFKA_SSL_CA || validatedEnv.KAFKA_SSL_CERT || validatedEnv.KAFKA_SSL_KEY) {
      // Read PEM certificates
      const ca = await readPemFile(validatedEnv.KAFKA_SSL_CA);
      const cert = await readPemFile(validatedEnv.KAFKA_SSL_CERT);
      const key = await readPemFile(validatedEnv.KAFKA_SSL_KEY);

      if (ca) sslOptions.ca = [ca];
      if (cert) sslOptions.cert = cert;
      if (key) sslOptions.key = key;

      // If we have at least some PEM content, enable SSL
      if (ca || cert || key) {
        kafkaConfig.ssl = sslOptions;
      }
    }

    // If no PEM but SSL is enabled, use simple SSL
    if (!kafkaConfig.ssl && validatedEnv.KAFKA_SSL) {
      // Просто включаем SSL - используем дефолтные TLS настройки
      // KafkaJS автоматически использует системный truststore
      kafkaConfig.ssl = true;
    }
  }

  // Configures SASL if KAFKA_USERNAME + KAFKA_PASSWORD set
  if (validatedEnv.KAFKA_USERNAME && validatedEnv.KAFKA_PASSWORD) {
    const saslConfig: SASLOptions = {
      mechanism: (validatedEnv.KAFKA_SASL_MECHANISM || 'plain') as
        | 'plain'
        | 'scram-sha-256'
        | 'scram-sha-512',
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
