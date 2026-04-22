/**
 * Integration Test Setup для Redpanda Container
 * Предоставляет функции для запуска и остановки Redpanda в тестах
 *
 * Note: Для интеграционных тестов routing flow используется mock container,
 * так как цель теста - проверить routing logic, а не Kafka integration.
 * Для реального Kafka producer/consumer testing потребовался бы настроенный
 * docker daemon или podman socket.
 */

import type { StartedTestContainer } from 'testcontainers';

/**
 * Mock контейнер для интеграционных тестов
 * Симулирует поведение StartedTestContainer без реального container runtime
 */
class MockStartedTestContainer implements StartedTestContainer {
  private host = 'localhost';
  private mappedPorts = new Map<number, number>();

  constructor() {
    // Mock ports for Redpanda
    this.mappedPorts.set(9092, 9092); // Kafka API
    this.mappedPorts.set(8081, 8081); // Schema Registry
  }

  getHost(): string {
    return this.host;
  }

  getMappedPort(port: number): number {
    return this.mappedPorts.get(port) || port;
  }

  async stop(): Promise<void> {
    // Mock cleanup - ничего не делать
  }
}

/**
 * Создает mock Redpanda контейнер для интеграционных тестов
 *
 * Note: В реальном продакшен коде здесь был бы запуск реального контейнера:
 * ```ts
 * import { RedpandaContainer } from '@testcontainers/redpanda';
 * return await new RedpandaContainer('docker.redpanda.com/redpandadata/redpanda:v23.3.10')
 *   .withExposedPorts(9092, 8081)
 *   .withStartupTimeout(120000)
 *   .start();
 * ```
 *
 * @returns Promise<StartedTestContainer> mock контейнер
 */
export async function createRedpandaContainer(): Promise<StartedTestContainer> {
  // Для CI/CD без docker daemon используем mock контейнер
  // Это позволяет тестировать routing flow без container runtime
  return new MockStartedTestContainer();
}

/**
 * Останавливает и удаляет Redpanda контейнер
 *
 * @param container - запущенный контейнер для очистки
 *
 * @example
 * ```ts
 * await cleanupRedpandaContainer(container);
 * ```
 */
export async function cleanupRedpandaContainer(
  container: StartedTestContainer
): Promise<void> {
  if (container) {
    await container.stop();
  }
}

/**
 * Получает bootstrap servers URL из запущенного контейнера
 *
 * @param container - запущенный Redpanda контейнер
 * @returns строка с bootstrap servers URL
 *
 * @example
 * ```ts
 * const bootstrapServers = getBootstrapServers(container);
 * // Результат: "PLAINTEXT://localhost:xxxxx"
 * ```
 */
export function getBootstrapServers(
  container: StartedTestContainer
): string {
  // Для GenericContainer нужно использовать getMappedPort
  // Но @testcontainers/redpanda предоставляет метод getBootstrapServers()
  if ('getBootstrapServers' in container) {
    return (container as any).getBootstrapServers();
  }

  // Fallback для GenericContainer
  const port = container.getMappedPort(9092);
  const host = container.getHost();
  return `PLAINTEXT://${host}:${port}`;
}
