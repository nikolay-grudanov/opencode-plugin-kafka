/**
 * Вспомогательные функции для управления Redpanda/Kafka контейнером в E2E тестах.
 *
 * Поддерживает два режима:
 * 1. Внешний Kafka (USE_EXTERNAL_KAFKA=true) - использует Kafka из docker-compose.kafka.yml
 * 2. testcontainers Redpanda - запускает реальный Redpanda контейнер
 */

import { RedpandaContainer } from '@testcontainers/redpanda';
import type {
  StartedRedpandaContainer as StartedRedpandaContainerType,
} from '@testcontainers/redpanda';
import { Wait } from 'testcontainers';

/**
 * Время ожидания запуска контейнера в миллисекундах (2 минуты).
 */
const STARTUP_TIMEOUT_MS = 120_000;

/**
 * Путь к starter script внутри контейнера.
 */
const STARTER_SCRIPT = '/testcontainers_start.sh';

/**
 * Проверяет доступность внешнего Kafka и возвращает рабочий брокер.
 * Проверяет оба порта: 9092 (Standard) и 9093 (External из docker-compose).
 * @returns Рабочий брокер ('localhost:9092' или 'localhost:9093') или null если недоступен
 */
async function checkExternalKafkaAvailable(): Promise<string | null> {
  // Пробуем оба порта Kafka
  const portsToCheck = ['localhost:9092', 'localhost:9093'];

  for (const broker of portsToCheck) {
    try {
      const { Kafka } = await import('kafkajs');
      const kafka = new Kafka({
        clientId: 'e2e-check',
        brokers: [broker],
        connectionTimeout: 3000,
      });
      const admin = kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return broker; // Возвращаем работающий брокер
    } catch {
      // Пробуем следующий порт
      continue;
    }
  }
  return null;
}

/**
 * Интерфейс для mock контейнера (используется с внешним Kafka).
 */
class ExternalKafkaContainer {
  private brokers: string[];

  constructor(brokers: string[]) {
    this.brokers = brokers;
  }

  getBootstrapServers(): string {
    // Используем первый брокер из переданного списка
    return this.brokers[0];
  }

  getSchemaRegistryAddress(): string {
    return 'http://localhost:8081';
  }

  getAdminAddress(): string {
    return 'http://localhost:9644';
  }

  getRestProxyAddress(): string {
    return 'http://localhost:8082';
  }

  getHost(): string {
    return 'localhost';
  }

  getMappedPort(port: number | string): number {
    return typeof port === 'string' ? parseInt(port, 10) : port;
  }

  async stop(): Promise<void> {
    // Ничего не делаем - внешний Kafka останавливается отдельно
  }

  getId(): string {
    return 'external-kafka';
  }

  getImage(): string {
    return 'external';
  }
}

/**
 * Кастомный started container для Podman rootless.
 * Переопределяет getMappedPort чтобы не полагаться на BoundPorts.
 */
class PodmanStartedRedpandaContainer implements StartedRedpandaContainerType {
  private container: StartedRedpandaContainerType;

  constructor(container: StartedRedpandaContainerType) {
    this.container = container;
  }

  getBootstrapServers(): string {
    return `localhost:9092`;
  }

  getSchemaRegistryAddress(): string {
    return `http://localhost:8081`;
  }

  getAdminAddress(): string {
    return `http://localhost:9644`;
  }

  getRestProxyAddress(): string {
    return `http://localhost:8082`;
  }

  getHost(): string {
    return 'localhost';
  }

  getMappedPort(port: number | string): number {
    return typeof port === 'string' ? parseInt(port, 10) : port;
  }

  async stop(): Promise<void> {
    return this.container.stop();
  }

  getId(): string {
    return this.container.getId();
  }

  getImage(): string {
    return this.container.getImage();
  }

  copyContentToContainer(files: { content: string; target: string; mode?: number }[]): Promise<void> {
    return this.container.copyContentToContainer(files);
  }
}

class PodmanRedpandaContainer extends RedpandaContainer {
  REDPANDA_PORT = 9092;

  constructor(image: string = 'docker.redpanda.com/redpandadata/redpanda:latest') {
    super(image);
    this.waitStrategy = Wait.forOneShotStartup();
    this.autoCleanup = false;
  }

  async start(): Promise<PodmanStartedRedpandaContainer> {
    const container = await super.start();
    return new PodmanStartedRedpandaContainer(container);
  }

  async containerStarted(
    container: StartedRedpandaContainerType,
    inspectResult: Record<string, unknown>
  ): Promise<void> {
    const command = `#!/bin/bash\nrpk redpanda start --mode dev-container --smp=1 --memory=1G`;
    await container.copyContentToContainer([{ content: command, target: STARTER_SCRIPT, mode: 0o777 }]);
    await container.copyContentToContainer([
      {
        content: this.renderRedpandaFile('localhost', 9092),
        target: '/etc/redpanda/redpanda.yaml',
      },
    ]);
  }
}

/**
 * Запускает Kafka (внешний или контейнер).
 *
 * @returns Promise с работающим Kafka контейнером (или mock для внешнего)
 *
 * @example
 * ```ts
 * const container = await startRedpanda();
 * const bootstrapServers = container.getBootstrapServers();
 * ```
 */
export async function startRedpanda(): Promise<
  PodmanStartedRedpandaContainer | ExternalKafkaContainer
> {
  // Режим 1: USE_EXTERNAL_KAFKA=true - используем внешний Kafka из docker-compose
  const useExternalKafka = process.env.USE_EXTERNAL_KAFKA === 'true';

  if (useExternalKafka) {
    console.log(
      JSON.stringify({
        msg: 'Using external Kafka (USE_EXTERNAL_KAFKA=true)',
        brokers: ['localhost:9093'],
      })
    );
    return new ExternalKafkaContainer(['localhost:9093']);
  }

  // Режим 2: Автоматическая проверка доступности внешнего Kafka
  const workingBroker = await checkExternalKafkaAvailable();
  if (workingBroker) {
    console.log(
      JSON.stringify({
        msg: 'Using external Kafka',
        broker: workingBroker,
      })
    );
    return new ExternalKafkaContainer([workingBroker]);
  }

  // Режим 3: Пробуем testcontainers (Podman/Docker)
  try {
    const startTime = Date.now();

    const container = await new PodmanRedpandaContainer(
      'docker.redpanda.com/redpandadata/redpanda:latest'
    )
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();

    const elapsedMs = Date.now() - startTime;
    const bootstrapServers = container.getBootstrapServers();

    console.log(
      JSON.stringify({
        msg: 'Redpanda container started',
        bootstrapServers,
        startupTimeMs: elapsedMs,
      })
    );

    return container;
  } catch (err) {
    // Понятная ошибка - Kafka не доступен
    const errorMessage =
      'Could not start Redpanda container and external Kafka not available. ' +
      'Either start Kafka with: docker-compose -f docker-compose.kafka.yml up -d ' +
      'or set USE_EXTERNAL_KAFKA=true';

    console.log(
      JSON.stringify({
        msg: 'Redpanda not available, tests will be skipped',
        reason: err instanceof Error ? err.message : String(err),
        suggestion: errorMessage,
      })
    );

    // Бросаем специфичную ошибку для skip логики в тестах
    const skipError = new Error('Redpanda not available, E2E tests skipped');
    skipError.name = 'SkippableError';
    throw skipError;
  }
}

/**
 * Останавливает и удаляет Redpanda контейнер.
 *
 * @param container - запущенный контейнер для остановки
 *
 * @example
 * ```ts
 * await stopRedpanda(container);
 * ```
 */
export async function stopRedpanda(
  container: StartedRedpandaContainer
): Promise<void> {
  try {
    await container.stop();

    console.log(
      JSON.stringify({
        msg: 'Redpanda container stopped',
      })
    );
  } catch (err) {
    // Подавляем ошибки при остановке — логируем только предупреждение
    console.warn(
      JSON.stringify({
        msg: 'Failed to stop Redpanda container, ignoring error',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}