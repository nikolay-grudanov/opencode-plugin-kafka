/**
 * Вспомогательные функции для управления Redpanda контейнером в E2E тестах.
 *
 * Использует @testcontainers/redpanda для создания реального Redpanda контейнера.
 * Предоставляет простой API для start/stop контейнера.
 */

import { RedpandaContainer } from '@testcontainers/redpanda';
import type { StartedRedpandaContainer } from '@testcontainers/redpanda';

/**
 * Время ожидания запуска контейнера в миллисекундах (2 минуты).
 */
const STARTUP_TIMEOUT_MS = 120_000;

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
export async function startRedpanda(): Promise<StartedRedpandaContainer> {
  const startTime = Date.now();

  const container = await new RedpandaContainer(
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