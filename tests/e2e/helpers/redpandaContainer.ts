/**
 * Вспомогательные функции для управления Redpanda контейнером в E2E тестах.
 *
 * Использует @testcontainers/redpanda для создания реального Redpanda контейнера.
 * Предоставляет простой API для start/stop контейнера.
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
 * Запускает реальный Redpanda контейнер.
 *
 * @returns Promise<StartedRedpandaContainer> запущенный контейнер
 *
 * @example
 * ```ts
 * const container = await startRedpanda();
 * const bootstrapServers = container.getBootstrapServers();
 * ```
 */
export async function startRedpanda(): Promise<PodmanStartedRedpandaContainer> {
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