/**
 * E2E helper для запуска Kafka плагина (consumer) в тестовом процессе.
 *
 * CRITICAL: startConsumer вызывает process.exit() в signal handlers и при ошибках.
 * Этот helper перехватывает process.exit чтобы предотвратить завершение тестового процесса.
 */

import type { PluginConfigV003 } from '../../../src/schemas/index.js';
import type { IOpenCodeAgent } from '../../../src/opencode/IOpenCodeAgent.js';
import { startConsumer } from '../../../src/kafka/consumer.js';

/**
 * Таймаут для graceful shutdown при остановке плагина (10 секунд).
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Время на подключение consumer после старта.
 */
const CONSUMER_CONNECT_WAIT_MS = 2_000;

/**
 * Интерфейс дескриптора для управления запущенным плагином.
 */
interface PluginRunnerHandle {
  /**
   * Останавливает consumer с gracefully shutdown.
   *
   * @returns Promise<void> — resolve после остановки или таймаута
   */
  stop(): Promise<void>;
}

/**
 * Настройки Kafka connections для E2E тестов.
 *
 * PluginConfigV003 содержит только topics и rules.
 * Kafka connection settings (brokers, clientId, groupId) передаются отдельно.
 */
interface KafkaConnectionSettings {
  /** Список Kafka brokers (через запятую) */
  brokers: string;
  /** Идентификатор клиента для Kafka */
  clientId: string;
  /** Идентификатор группы consumer */
  groupId: string;
  /** SSL включён (по умолчанию: false) */
  ssl?: boolean;
  /** Имя пользователя для SASL (опционально) */
  username?: string;
  /** Пароль для SASL (опционально) */
  password?: string;
  /** SASL механизм (по умолчанию: 'plain') */
  saslMechanism?: string;
  /** DLQ топик (опционально) */
  dlqTopic?: string;
  /** Игнорировать tombstones (по умолчанию: false) */
  ignoreTombstones?: boolean;
}

/**
 * Запускает Kafka плагин (consumer) в текущем процессе.
 *
 * @param config - Конфигурация плагина (topics + rules)
 * @param agent - Агент для обработки сообщений (IOpenCodeAgent)
 * @param connection - Настройки подключения к Kafka
 * @returns Promise<PluginRunnerHandle> — дескриптор для остановки
 *
 * @example
 * ```ts
 * import { OpenCodeAgentAdapter } from '../../../src/opencode/OpenCodeAgentAdapter.js';
 *
 * const agent = new OpenCodeAgentAdapter({ baseURL: 'http://localhost:3001' });
 * const handle = await runPlugin(
 *   { topics: ['input'], rules: [...] },
 *   agent,
 *   { brokers: 'localhost:9092', clientId: 'test', groupId: 'test-group' }
 * );
 *
 * // ... тесты ...
 *
 * await handle.stop();
 * ```
 */
async function runPlugin(
  config: PluginConfigV003,
  agent: IOpenCodeAgent,
  connection: KafkaConnectionSettings,
): Promise<PluginRunnerHandle> {
  // Сохраняем оригинальную функцию process.exit
  const originalExit = process.exit as (code?: number) => never;

  // Перехватываем process.exit чтобы предотвратить завершение тестового процесса
  process.exit = ((code?: number) => {
    console.log(
      JSON.stringify({
        msg: 'process.exit intercepted in pluginRunner',
        code,
      }),
    );
  }) as never;

  // Устанавливаем переменные окружения для Kafka
  const savedEnv = {
    KAFKA_BROKERS: process.env.KAFKA_BROKERS,
    KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID,
    KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID,
    KAFKA_SSL: process.env.KAFKA_SSL,
    KAFKA_USERNAME: process.env.KAFKA_USERNAME,
    KAFKA_PASSWORD: process.env.KAFKA_PASSWORD,
    KAFKA_SASL_MECHANISM: process.env.KAFKA_SASL_MECHANISM,
    KAFKA_DLQ_TOPIC: process.env.KAFKA_DLQ_TOPIC,
    KAFKA_IGNORE_TOMBSTONES: process.env.KAFKA_IGNORE_TOMBSTONES,
  };

  process.env.KAFKA_BROKERS = connection.brokers;
  process.env.KAFKA_CLIENT_ID = connection.clientId;
  process.env.KAFKA_GROUP_ID = connection.groupId;

  if (connection.ssl !== undefined) {
    process.env.KAFKA_SSL = connection.ssl ? 'true' : 'false';
  }

  if (connection.username !== undefined) {
    process.env.KAFKA_USERNAME = connection.username;
  }

  if (connection.password !== undefined) {
    process.env.KAFKA_PASSWORD = connection.password;
  }

  if (connection.saslMechanism !== undefined) {
    process.env.KAFKA_SASL_MECHANISM = connection.saslMechanism;
  }

  if (connection.dlqTopic !== undefined) {
    process.env.KAFKA_DLQ_TOPIC = connection.dlqTopic;
  }

  if (connection.ignoreTombstones !== undefined) {
    process.env.KAFKA_IGNORE_TOMBSTONES = connection.ignoreTombstones ? 'true' : 'false';
  }

  // Запускаем consumer — он работает в фоне (не await-им)
  // startConsumer устанавливает signal handlers и блокируется на consume()
  const consumerPromise = startConsumer(config, agent).catch((error) => {
    console.warn(
      JSON.stringify({
        msg: 'Consumer error in pluginRunner',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });

  // Даём consumer время подключиться к Kafka
  await new Promise((resolve) => setTimeout(resolve, CONSUMER_CONNECT_WAIT_MS));

  return {
    stop: async () => {
      try {
        // Отправляем SIGTERM себе — это триггерит shutdownHandler в consumer
        // signal handler вызовет mocked process.exit (пока он ещё перехвачен)
        process.kill(process.pid, 'SIGTERM');

        // Ждём завершения shutdown или таймаута
        const timeoutPromise = new Promise<void>((resolve) =>
          setTimeout(resolve, SHUTDOWN_TIMEOUT_MS),
        );
        await Promise.race([consumerPromise, timeoutPromise]);

        // Восстанавливаем оригинальный process.exit ПОСЛЕ shutdown
        process.exit = originalExit;

        // Восстанавливаем сохранённые env vars
        if (savedEnv.KAFKA_BROKERS !== undefined) {
          process.env.KAFKA_BROKERS = savedEnv.KAFKA_BROKERS;
        } else {
          delete process.env.KAFKA_BROKERS;
        }

        if (savedEnv.KAFKA_CLIENT_ID !== undefined) {
          process.env.KAFKA_CLIENT_ID = savedEnv.KAFKA_CLIENT_ID;
        } else {
          delete process.env.KAFKA_CLIENT_ID;
        }

        if (savedEnv.KAFKA_GROUP_ID !== undefined) {
          process.env.KAFKA_GROUP_ID = savedEnv.KAFKA_GROUP_ID;
        } else {
          delete process.env.KAFKA_GROUP_ID;
        }

        if (savedEnv.KAFKA_SSL !== undefined) {
          process.env.KAFKA_SSL = savedEnv.KAFKA_SSL;
        } else {
          delete process.env.KAFKA_SSL;
        }

        if (savedEnv.KAFKA_USERNAME !== undefined) {
          process.env.KAFKA_USERNAME = savedEnv.KAFKA_USERNAME;
        } else {
          delete process.env.KAFKA_USERNAME;
        }

        if (savedEnv.KAFKA_PASSWORD !== undefined) {
          process.env.KAFKA_PASSWORD = savedEnv.KAFKA_PASSWORD;
        } else {
          delete process.env.KAFKA_PASSWORD;
        }

        if (savedEnv.KAFKA_SASL_MECHANISM !== undefined) {
          process.env.KAFKA_SASL_MECHANISM = savedEnv.KAFKA_SASL_MECHANISM;
        } else {
          delete process.env.KAFKA_SASL_MECHANISM;
        }

        if (savedEnv.KAFKA_DLQ_TOPIC !== undefined) {
          process.env.KAFKA_DLQ_TOPIC = savedEnv.KAFKA_DLQ_TOPIC;
        } else {
          delete process.env.KAFKA_DLQ_TOPIC;
        }

        if (savedEnv.KAFKA_IGNORE_TOMBSTONES !== undefined) {
          process.env.KAFKA_IGNORE_TOMBSTONES = savedEnv.KAFKA_IGNORE_TOMBSTONES;
        } else {
          delete process.env.KAFKA_IGNORE_TOMBSTONES;
        }
      } catch (error) {
        // Подавляем все ошибки при остановке
        console.warn(
          JSON.stringify({
            msg: 'Plugin stop error (ignored)',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  };
}

export { runPlugin };
export type { PluginRunnerHandle, KafkaConnectionSettings };