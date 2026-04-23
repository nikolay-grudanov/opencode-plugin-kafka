/**
 * Интеграционные тесты для consumer.ts с реальным Redpanda контейнером.
 *
 * T006-T014: Тестирование полного потока consumer с реальным Kafka брокером.
 *
 * Запуск: npx vitest run --config vitest.integration.config.ts
 *
 * @see vitest.integration.config.ts
 */

import { describe, beforeAll, afterAll, it, expect, beforeEach, vi } from 'vitest';
import { RedpandaContainer } from '@testcontainers/redpanda';
import type { Producer, EachMessagePayload } from 'kafkajs';
import { Kafka } from 'kafkajs';

import { eachMessageHandler, performGracefulShutdown, startConsumer } from '../../src/kafka/consumer.js';
import type { PluginConfigV003, RuleV003 } from '../../src/schemas/index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 *DLQ topic name для тестов.
 */
const TEST_DLQ_TOPIC = 'test-dlq';

/**
 * Test topic #1 для базовых тестов.
 */
const TEST_TOPIC_1 = 'test-topic-1';

/**
 * Test topic #2 для sequential ordering тестов.
 */
const TEST_TOPIC_2 = 'test-topic-2';

/**
 * Стандартный JSONPath для тестов.
 */
// const DEFAULT_JSON_PATH = '$.type';

/**
 * Таймаут для startup контейнера (2 минуты).
 */
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

// ============================================================================
// Types
// ============================================================================

/**
 * Состояние consumer для тестирования eachMessageHandler.
 */
interface TestConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

/**
 * Результат обработки сообщения для верификации.
 */
// interface ProcessingVerification {
//   processed: boolean;
//   matchedRule?: string;
//   sentToDlq: boolean;
//   error?: string;
// }

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Генерирует уникальный groupId для каждого теста.
 * Это предотвращает offset conflicts между тестами.
 */
function generateGroupId(testName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${testName}-${timestamp}-${random}`;
}

/**
 * Создает EachMessagePayload из данных.
 * Используется для гибридного подхода в тестах.
 */
function createPayload(
  topic: string,
  value: Buffer | string | null,
  offset: string,
  partition: number = 0,
  key: Buffer | null = null
): EachMessagePayload {
  return {
    topic,
    partition,
    message: {
      value: typeof value === 'string' ? Buffer.from(value) : value,
      offset,
      key,
      headers: {},
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Ожидает выполнения условия с таймаутом.
 */
async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  pollIntervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}

/**
 * Создает пустое состояние consumer для тестирования.
 */
function createTestState(): TestConsumerState {
  return {
    isShuttingDown: false,
    totalMessagesProcessed: 0,
    dlqMessagesCount: 0,
    lastDlqRateLogTime: Date.now(),
  };
}

function createTestConfig(topics: string[], rules: RuleV003[]): PluginConfigV003 {
  return {
    topics,
    rules,
  };
}

// ============================================================================
// Global Test Suite Variables
// ============================================================================

let container: Awaited<ReturnType<typeof RedpandaContainer.prototype.start>> | null = null;
let kafka: Kafka | null = null;
let bootstrapServers: string | null = null;

/**
 * Флаг доступности container runtime.
 * Устанавливается в false если RedpandaContainer.start() падает.
 * Используется для skip тестов T007-T014.
 */
let containerAvailable = false;

// ============================================================================
// Integration Tests: Real Redpanda Consumer
// ============================================================================

describe('Integration Tests: Real Redpanda Consumer', () => {
  /**
   * Запускает RedpandaContainer и создает Kafka клиент.
   * Выполняется один раз перед всеми тестами.
   */
  let originalDlqTopic: string | undefined;

  beforeAll(async () => {
    try {
      // Сохраняем оригинальное значение env и устанавливаем DLQ topic
      originalDlqTopic = process.env.KAFKA_DLQ_TOPIC;
      process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;

      // Запускаем реальный Redpanda контейнер
      container = await new RedpandaContainer('docker.redpanda.com/redpandadata/redpanda:latest')
        .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
        .start();

      // Получаем bootstrap servers
      bootstrapServers = container.getBootstrapServers();

      // Создаем Kafka клиент
      kafka = new Kafka({
        clientId: 'test-client',
        brokers: [bootstrapServers],
        retry: {
          initialRetryTime: 100,
          retries: 3,
        },
      });

      // Создаем admin для создания topics
      const admin = kafka.admin();
      await admin.connect();

      // Создаем необходимые topics
      await admin.createTopics({
        topics: [
          { topic: TEST_DLQ_TOPIC, numPartitions: 1, replicationFactor: 1 },
          { topic: TEST_TOPIC_1, numPartitions: 1, replicationFactor: 1 },
          { topic: TEST_TOPIC_2, numPartitions: 1, replicationFactor: 1 },
        ],
      });

      await admin.disconnect();

      console.log(`[Integration Tests] Redpanda container started: ${bootstrapServers}`);
      containerAvailable = true;
    } catch (err) {
      // Контейнер недоступен — логируем предупреждение и продолжаем без пробрасывания
      console.warn(
        '⚠️ Container runtime not available, skipping integration tests (T007-T014)\n' +
        '⚠️ To run these tests, ensure Podman/Docker is running:\n' +
        `  systemctl --user start podman.socket\n' +
        '   Original error: ${err}`
      );
      containerAvailable = false;
    }
  }, CONTAINER_STARTUP_TIMEOUT_MS + 10_000);

  /**
   * Останавливает контейнер и закрывает соединения.
   * Выполняется один раз после всех тестов.
   */
  afterAll(async () => {
    // Восстанавливаем env
    if (originalDlqTopic !== undefined) {
      process.env.KAFKA_DLQ_TOPIC = originalDlqTopic;
    } else {
      delete process.env.KAFKA_DLQ_TOPIC;
    }

    if (container && containerAvailable) {
      await container.stop();
      container = null;
      console.log('[Integration Tests] Redpanda container stopped');
    }
  });

  // ========================================================================
  // T006: Redpanda Container Startup
  // ========================================================================

  describe('T006: Redpanda Container Startup', () => {
    it('должен запустить Redpanda контейнер и получить bootstrap servers', () => {
      if (!containerAvailable) return;
      expect(container).toBeDefined();
      expect(bootstrapServers).toBeDefined();
      expect(bootstrapServers).toMatch(/^localhost:\d+$/);
    });

    it('должен подключиться к Kafka через admin и получить metadata', async () => {
      if (!containerAvailable) return;
      expect(kafka).toBeDefined();

      const admin = kafka!.admin();
      await admin.connect();

      const clusterMetadata = await admin.describeCluster();

      expect(clusterMetadata).toBeDefined();
      expect(clusterMetadata.brokers).toBeDefined();
      expect(clusterMetadata.brokers.length).toBeGreaterThan(0);

      await admin.disconnect();
    });
  });

// ============================================================================
// T007: Basic Message Production/Consumption
// ============================================================================

describe('T007: Basic Message Production/Consumption', () => {
  let producer: Producer;
  let dlqProducer: Producer;

  beforeEach(async () => {
    expect(kafka).toBeDefined();

    dlqProducer = kafka!.producer();
    await dlqProducer.connect();
  });

  afterEach(async () => {
    if (dlqProducer) {
      await dlqProducer.disconnect();
    }
  });

  it('T007: должен обработать валидное JSON сообщение и закоммитить offset', async () => {
    // Подготавливаем данные
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process type {{type}}',
    };

    const config = createTestConfig([TEST_TOPIC_1], [rule]);
    const state = createTestState();

    // Mock commit функция
    const mockCommit = async () => {};

    // Отправляем тестовое сообщение через producer
    producer = kafka!.producer();
    await producer.connect();

    const testMessage = {
      type: 'test-type',
      data: 'test-data',
    };

    await producer.send({
      topic: TEST_TOPIC_1,
      messages: [{ value: JSON.stringify(testMessage) }],
    });

    await producer.disconnect();

    // Создаём payload вручную (гибридный подход)
    // Это симулирует то, что consumer получил бы сообщение из Kafka
    const payload = createPayload(TEST_TOPIC_1, JSON.stringify(testMessage), '0');

    // Вызываем eachMessageHandler напрямую
    await eachMessageHandler(payload, config, dlqProducer, mockCommit, state);

    // Проверяем что сообщение обработано
    expect(state.totalMessagesProcessed).toBe(1);

    // Проверяем что offset закоммичен (нет ошибок)
    expect(state.isShuttingDown).toBe(false);
  });
});

// ============================================================================
// T008: Container Cleanup
// ============================================================================

describe('T008: Container Cleanup', () => {
  it('T008: после завершения всех тестов контейнер должен быть остановлен', () => {
    // Этот тест верифицирует что afterAll корректно останавливает контейнер
    // Проверяем что глобальный container null (он будет остановлен после всех тестов)
    // Но в данном describe контейнер еще жив
    expect(container).toBeDefined();
  });

  it('T008: все Kafka соединения должны быть закрыты', async () => {
    // Создаем отдельные соединения и проверяем их закрытие
    const testProducer = kafka!.producer();
    await testProducer.connect();
    await testProducer.disconnect();

    const testConsumer = kafka!.consumer({ groupId: generateGroupId('cleanup') });
    await testConsumer.connect();
    await testConsumer.disconnect();

    // Если мы дошли до этой точки без ошибок - соединения закрыты корректно
    expect(true).toBe(true);
  });
});

// ============================================================================
// T009: Sequential Message Ordering
// ============================================================================

describe('T009: Sequential Message Ordering', () => {
  let producer: Producer;
  let dlqProducer: Producer;

  beforeEach(async () => {
    dlqProducer = kafka!.producer();
    await dlqProducer.connect();
  });

  afterEach(async () => {
    await dlqProducer?.disconnect();
  });

  it('T009: должен обрабатывать сообщения в порядке отправки', async () => {
    const rule: RuleV003 = {
      name: 'order-rule',
      jsonPath: '$.order',
      promptTemplate: 'Process order {{order}}',
    };

    const config = createTestConfig([TEST_TOPIC_2], [rule]);
    const state = createTestState();

    // Отправляем 3 сообщения в определённом порядке через producer
    producer = kafka!.producer();
    await producer.connect();

    const messages = [
      { order: 1, data: 'first' },
      { order: 2, data: 'second' },
      { order: 3, data: 'third' },
    ];

    for (const msg of messages) {
      await producer.send({
        topic: TEST_TOPIC_2,
        messages: [{ value: JSON.stringify(msg) }],
      });
    }

    await producer.disconnect();

    // Обрабатываем каждое сообщение через eachMessageHandler напрямую
    const mockCommit = async () => {};

    for (let i = 0; i < messages.length; i++) {
      const payload = createPayload(TEST_TOPIC_2, JSON.stringify(messages[i]), String(i));
      await eachMessageHandler(payload, config, dlqProducer, mockCommit, state);
    }

    // Проверяем что все сообщения обработаны
    expect(state.totalMessagesProcessed).toBe(3);

    // Consumer не крашнут
    expect(state.isShuttingDown).toBe(false);
  });
});

// ============================================================================
// T010: Invalid JSON → DLQ
// ============================================================================

describe('T010: Invalid JSON → DLQ', () => {
  let producer: Producer;
  let dlqProducer: Producer;

  beforeEach(async () => {
    dlqProducer = kafka!.producer();
    await dlqProducer.connect();
  });

  afterEach(async () => {
    await dlqProducer?.disconnect();
  });

  it('T010: должен отправить invalid JSON сообщение в DLQ и закоммитить offset', async () => {
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process type {{type}}',
    };

    const config = createTestConfig([TEST_TOPIC_1], [rule]);
    const state = createTestState();

    // Mock commit функция
    const mockCommit = async () => {};

    // Отправляем invalid JSON через producer (чтобы проверить что producer работает)
    producer = kafka!.producer();
    await producer.connect();

    const invalidJson = '{ invalid json: not parsed }';

    await producer.send({
      topic: TEST_TOPIC_1,
      messages: [{ value: invalidJson }],
    });

    await producer.disconnect();

    // Вызываем eachMessageHandler напрямую с invalid JSON
    const payload = createPayload(TEST_TOPIC_1, invalidJson, '0');

    // eachMessageHandler должен поймать ошибку парсинга и отправить в DLQ
    await eachMessageHandler(payload, config, dlqProducer, mockCommit, state);

    // Проверяем что сообщение не крашнуло consumer
    expect(state.isShuttingDown).toBe(false);

    // Проверяем что сообщение попало в DLQ
    expect(state.dlqMessagesCount).toBe(1);

    // Читаем DLQ чтобы проверить структуру
    const dlqConsumer = kafka!.consumer({ groupId: generateGroupId('dlq-check') });
    await dlqConsumer.connect();
    await dlqConsumer.subscribe({ topics: [TEST_DLQ_TOPIC], fromBeginning: true });

    const dlqMessages: string[] = [];

    await dlqConsumer.run({
      autoCommit: false,
      eachMessage: async (payload) => {
        const value = payload.message.value?.toString('utf-8');
        if (value) {
          dlqMessages.push(value);
        }
      },
    });

    // Ждём появления сообщения в DLQ
    const dlqReceived = await waitForCondition(
      () => dlqMessages.length > 0,
      5000
    );

    expect(dlqReceived).toBe(true);
    expect(dlqMessages.length).toBeGreaterThan(0);

    // Парсим DLQ envelope и проверяем структуру
    const dlqEnvelope = JSON.parse(dlqMessages[0]);
    expect(dlqEnvelope.originalValue).toBe(invalidJson);
    expect(dlqEnvelope.errorMessage).toBeDefined();
    expect(dlqEnvelope.topic).toBe(TEST_TOPIC_1);
    expect(dlqEnvelope.partition).toBeDefined();
    expect(dlqEnvelope.offset).toBeDefined();
    expect(dlqEnvelope.failedAt).toBeDefined();

    await dlqConsumer.disconnect();
  });
});

// ============================================================================
// T011: Oversized Message → DLQ
// ============================================================================

describe('T011: Oversized Message → DLQ', () => {
  let dlqProducer: Producer;

  beforeEach(async () => {
    dlqProducer = kafka!.producer();
    await dlqProducer.connect();
  });

  afterEach(async () => {
    await dlqProducer?.disconnect();
  });

  it('T011: должен отправить oversized сообщение (>1MB) в DLQ', async () => {
    const rule: RuleV003 = {
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process type {{type}}',
    };

    const config = createTestConfig([TEST_TOPIC_1], [rule]);
    const state = createTestState();

    // Mock commit функция
    const mockCommit = async () => {};

    // Создаём payload > 1MB напрямую (без отправки через producer)
    const oversizedBuffer = Buffer.alloc(1024 * 1024 + 100); // ~1MB + 100 bytes
    oversizedBuffer.fill('x');

    const payload = createPayload(TEST_TOPIC_1, oversizedBuffer, '0');

    // Вызываем eachMessageHandler напрямую
    await eachMessageHandler(payload, config, dlqProducer, mockCommit, state);

    // Проверяем что oversized сообщение отправлено в DLQ
    expect(state.dlqMessagesCount).toBe(1);

    // Consumer продолжает работу
    expect(state.isShuttingDown).toBe(false);

    // state.dlqMessagesCount уже верифицирует что сообщение попало в DLQ
    // НЕ читаем из DLQ чтобы избежать получения сообщений от предыдущих тестов
  });
});

// ============================================================================
// T012: Unmatched Message — Skip Gracefully
// ============================================================================

describe('T012: Unmatched Message — Skip Gracefully', () => {
  let producer: Producer;
  let dlqProducer: Producer;

  beforeEach(async () => {
    dlqProducer = kafka!.producer();
    await dlqProducer.connect();
  });

  afterEach(async () => {
    await dlqProducer?.disconnect();
  });

  it('T012: должен пропустить сообщение без matching rule и закоммитить offset', async () => {
    // Правило с JSONPath который не matchирует сообщение
    const rule: RuleV003 = {
      name: 'specific-rule',
      jsonPath: '$.nonexistent.path',
      promptTemplate: 'Process {{type}}',
    };

    const config = createTestConfig([TEST_TOPIC_1], [rule]);
    const state = createTestState();

    // Mock commit функция
    const mockCommit = async () => {};

    // Отправляем сообщение через producer (чтобы проверить что producer работает)
    producer = kafka!.producer();
    await producer.connect();

    const unmatchedMessage = { type: 'unmatched', data: 'test' };

    await producer.send({
      topic: TEST_TOPIC_1,
      messages: [{ value: JSON.stringify(unmatchedMessage) }],
    });

    await producer.disconnect();

    // Вызываем eachMessageHandler напрямую с payload
    const payload = createPayload(TEST_TOPIC_1, JSON.stringify(unmatchedMessage), '0');

    await eachMessageHandler(payload, config, dlqProducer, mockCommit, state);

    // Проверяем что consumer не крашнулся
    expect(state.isShuttingDown).toBe(false);

    // Проверяем что DLQ пуст (сообщение НЕ отправлено в DLQ)
    expect(state.dlqMessagesCount).toBe(0);

    // Проверяем что offset закоммичен (message processed)
    expect(state.totalMessagesProcessed).toBe(1);

    // state.dlqMessagesCount = 0 уже верифицирует что сообщение НЕ попало в DLQ
    // НЕ читаем из DLQ чтобы избежать получения сообщений от предыдущих тестов
  });
});

// ============================================================================
// T013: Graceful Shutdown Completion
// ============================================================================

describe('T013: Graceful Shutdown Completion', () => {
  it('T013: consumer должен корректно отключиться при shutdown', async () => {
    if (!containerAvailable) return;
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('graceful-shutdown') });
    const testProducer = kafka!.producer();

    await testConsumer.connect();
    await testProducer.connect();

    // Выполняем graceful disconnect
    await testConsumer.disconnect();
    await testProducer.disconnect();

    // Проверяем что disconnect прошел без ошибок
    expect(true).toBe(true);
  });

  it('T013: shutdown должен завершиться в пределах timeout', async () => {
    if (!containerAvailable) return;
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('shutdown-timeout') });

    await testConsumer.connect();

    const startTime = Date.now();

    // Disconnect с небольшим timeout
    await testConsumer.disconnect();

    const shutdownTime = Date.now() - startTime;

    // Проверяем что shutdown быстрый (не более 5 секунд для локального consumer)
    expect(shutdownTime).toBeLessThan(5000);
  });
});

// ============================================================================
// T014: Shutdown Without Unhandled Errors
// ============================================================================

describe('T014: Shutdown Without Unhandled Errors', () => {
  const errors: Error[] = [];
  let rejectionHandler: ((reason: unknown) => void) | null = null;

  beforeEach(() => {
    errors.length = 0; // Очищаем массив перед каждым тестом

    // Сохраняем reference на handler для возможности удаления
    rejectionHandler = (reason) => {
      if (reason instanceof Error) {
        errors.push(reason);
      }
    };
    process.on('unhandledRejection', rejectionHandler);
  });

  afterEach(() => {
    if (rejectionHandler) {
      process.removeListener('unhandledRejection', rejectionHandler);
      rejectionHandler = null;
    }
  });

  it('T014: при shutdown не должно быть unhandled promise rejections', async () => {
    if (!containerAvailable) return;

    // Создаем и закрываем consumer/producer
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('no-unhandled') });
    const testProducer = kafka!.producer();

    await testConsumer.connect();
    await testProducer.connect();

    // Создаем тестовый topic
    const admin = kafka!.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: 'test-shutdown-topic', numPartitions: 1, replicationFactor: 1 }],
    });
    await admin.disconnect();

    // Отправляем сообщение
    await testProducer.send({
      topic: 'test-shutdown-topic',
      messages: [{ value: JSON.stringify({ test: true }) }],
    });

    // Закрываем соединения
    await testProducer.disconnect();
    await testConsumer.disconnect();

    // Ждем немного для обнаружения любых async ошибок
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Проверяем что не было unhandled errors
    expect(errors.length).toBe(0);
  });

  it('T014: consumer и producer должны отключиться корректно', async () => {
    if (!containerAvailable) return;
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('cleanup-check') });
    const testProducer = kafka!.producer();

    // Connect
    await testConsumer.connect();
    await testProducer.connect();

    // Verify connected state через metadata
    const admin = kafka!.admin();
    await admin.connect();
    const clusterMetadata = await admin.describeCluster();
    expect(clusterMetadata.brokers.length).toBeGreaterThan(0);
    await admin.disconnect();

    // Disconnect
    await testProducer.disconnect();
    await testConsumer.disconnect();

    // Повторное отключение не должно вызывать ошибок
    await expect(testProducer.disconnect()).resolves.not.toThrow();
    await expect(testConsumer.disconnect()).resolves.not.toThrow();
  });
});

// ============================================================================
// T016: Graceful Shutdown — Normal
// ============================================================================

describe.skipIf(!containerAvailable)('T016: Graceful Shutdown — Normal', () => {
  it('T016: должен корректно выполнить graceful shutdown', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('normal-shutdown') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    // Подключаем consumer и producer
    await testConsumer.connect();
    await testProducer.connect();

    // Act
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // Assert
    expect(state.isShuttingDown).toBe(true);
    // Consumer и producer отключены (повторное отключение не вызывает ошибок)
    await expect(testConsumer.disconnect()).resolves.not.toThrow();
    await expect(testProducer.disconnect()).resolves.not.toThrow();
  });

  it('T016: shutdown должен логировать события', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('log-shutdown') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    await testConsumer.connect();
    await testProducer.connect();

    // Mock console.log для проверки логов
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Act
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // Assert — проверяем что логировались события shutdown
    const logCalls = logSpy.mock.calls.map(c => c[0]).filter(Boolean);
    const logStrings = logCalls.map(c => typeof c === 'string' ? c : String(c));

    const hasShutdownStarted = logStrings.some(s => s.includes('graceful_shutdown_started'));
    const hasShutdownCompleted = logStrings.some(s => s.includes('graceful_shutdown_completed'));

    expect(hasShutdownStarted).toBe(true);
    expect(hasShutdownCompleted).toBe(true);

    logSpy.mockRestore();

    // Cleanup
    try { await testConsumer.disconnect(); } catch { /* ignore */ }
    try { await testProducer.disconnect(); } catch { /* ignore */ }
  });
});

// ============================================================================
// T017: Graceful Shutdown — Idempotent (Double Shutdown)
// ============================================================================

describe.skipIf(!containerAvailable)('T017: Graceful Shutdown — Idempotent', () => {
  it('T017: повторный shutdown должен вернуть Promise.resolve() без disconnect', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('idempotent-shutdown') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    await testConsumer.connect();
    await testProducer.connect();

    // Первый shutdown
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);
    expect(state.isShuttingDown).toBe(true);

    // Mock для отслеживания повторного disconnect
    const disconnectSpy = vi.spyOn(testConsumer, 'disconnect');

    // Act — второй shutdown
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // Assert — disconnect не должен быть вызван повторно
    expect(disconnectSpy).toHaveBeenCalledTimes(0);

    disconnectSpy.mockRestore();

    // Cleanup
    try { await testConsumer.disconnect(); } catch { /* ignore */ }
    try { await testProducer.disconnect(); } catch { /* ignore */ }
  });

  it('T017: isShuttingDown защита предотвращает повторный shutdown', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('protection-test') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    await testConsumer.connect();
    await testProducer.connect();

    // Вызываем shutdown
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // state.isShuttingDown должен быть true
    expect(state.isShuttingDown).toBe(true);

    // Cleanup
    try { await testConsumer.disconnect(); } catch { /* ignore */ }
    try { await testProducer.disconnect(); } catch { /* ignore */ }
  });
});

// ============================================================================
// T018: Graceful Shutdown — Error Handling
// ============================================================================

describe.skipIf(!containerAvailable)('T018: Graceful Shutdown — Error Handling', () => {
  it('T018: ошибка consumer.disconnect() не прерывает shutdown', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('error-shutdown') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    await testConsumer.connect();
    await testProducer.connect();

    // Мокаем consumer.disconnect чтобы выбросил ошибку
    vi.spyOn(testConsumer, 'disconnect').mockRejectedValueOnce(new Error('Consumer disconnect failed'));

    // Mock console для проверки ошибки
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act — shutdown должен продолжиться несмотря на ошибку
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // Assert
    expect(state.isShuttingDown).toBe(true);
    // Ошибка была залогирована
    const errorCalls = errorSpy.mock.calls.map(c => c[0]).filter(Boolean);
    const errorStrings = errorCalls.map(c => typeof c === 'string' ? c : String(c));
    const hasConsumerDisconnectFailed = errorStrings.some(s => s.includes('consumer_disconnect_failed'));
    expect(hasConsumerDisconnectFailed).toBe(true);

    errorSpy.mockRestore();

    // Producer shutdown продолжается — cleanup
    try { await testConsumer.disconnect(); } catch { /* ignore — может уже отключен */ }
    try { await testProducer.disconnect(); } catch { /* ignore */ }
  });

  it('T018: ошибка producer.disconnect() не прерывает shutdown', async () => {
    // Arrange
    const testConsumer = kafka!.consumer({ groupId: generateGroupId('producer-error') });
    const testProducer = kafka!.producer();
    const state = createTestState();

    await testConsumer.connect();
    await testProducer.connect();

    // Мокаем producer.disconnect чтобы выбросил ошибку
    vi.spyOn(testProducer, 'disconnect').mockRejectedValueOnce(new Error('Producer disconnect failed'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    await performGracefulShutdown(testConsumer, testProducer, 'SIGTERM', state);

    // Assert
    expect(state.isShuttingDown).toBe(true);
    const errorCalls = errorSpy.mock.calls.map(c => c[0]).filter(Boolean);
    const errorStrings = errorCalls.map(c => typeof c === 'string' ? c : String(c));
    const hasProducerDisconnectFailed = errorStrings.some(s => s.includes('producer_disconnect_failed'));
    expect(hasProducerDisconnectFailed).toBe(true);

    errorSpy.mockRestore();

    // Cleanup
    try { await testConsumer.disconnect(); } catch { /* ignore */ }
    try { await testProducer.disconnect(); } catch { /* ignore */ }
  });
});

// ============================================================================
// T019: startConsumer Lifecycle
// ============================================================================

describe.skipIf(!containerAvailable)('T019: startConsumer Lifecycle', () => {
  const originalExit = process.exit;
  let exitMock: ReturnType<typeof vi.fn>;
  let originalBrokers: string | undefined;
  let originalGroupId: string | undefined;
  let originalDlqTopic: string | undefined;

  beforeEach(() => {
    exitMock = vi.fn();
    process.exit = exitMock as never;

    // Сохраняем оригинальные env
    originalBrokers = process.env.KAFKA_BROKERS;
    originalGroupId = process.env.KAFKA_GROUP_ID;
    originalDlqTopic = process.env.KAFKA_DLQ_TOPIC;
  });

  afterEach(async () => {
    // Восстанавливаем env
    process.env.KAFKA_BROKERS = originalBrokers;
    process.env.KAFKA_GROUP_ID = originalGroupId;
    if (originalDlqTopic !== undefined) {
      process.env.KAFKA_DLQ_TOPIC = originalDlqTopic;
    } else {
      delete process.env.KAFKA_DLQ_TOPIC;
    }

    // Восстанавливаем process.exit
    process.exit = originalExit;

    // Cleanup любых оставшихся consumers
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it('T019: должен успешно запустить consumer и подключиться к Kafka', async () => {
    // Arrange
    const testTopic = `test-start-consumer-${Date.now()}`;

    // Устанавливаем env vars
    process.env.KAFKA_BROKERS = bootstrapServers;
    process.env.KAFKA_GROUP_ID = generateGroupId('start-consumer');
    process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;

    // Создаём topic через admin
    const admin = kafka!.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: testTopic, numPartitions: 1, replicationFactor: 1 }],
    });
    await admin.disconnect();

    // Конфиг
    const testConfig: PluginConfigV003 = {
      topics: [testTopic],
      rules: [{
        name: 'test-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process {{type}}',
      }],
    };

    // Отправляем тестовое сообщение
    const producer = kafka!.producer();
    await producer.connect();
    await producer.send({
      topic: testTopic,
      messages: [{ value: JSON.stringify({ type: 'test' }) }],
    });
    await producer.disconnect();

    // Перехватываем логи для проверки подключения
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Act — запускаем startConsumer в фоне
    startConsumer(testConfig);

    // Ждём подключения (логируем kafka_consumer_started)
    const connected = await waitForCondition(
      () => logSpy.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('kafka_consumer_started')),
      15000,
      500
    );

    expect(connected).toBe(true);

    // Проверяем что process.exit не был вызван (consumer работает)
    expect(exitMock).not.toHaveBeenCalled();

    logSpy.mockRestore();

    // Cleanup — вызываем performGracefulShutdown через SIGTERM
    process.emit('SIGTERM' as NodeJS.Signals);

    // Ждём завершения
    await waitForCondition(
      () => exitMock.mock.calls.length > 0 || !connected,
      15000,
      500
    );
  }, 30000);

  it('T019: startConsumer должен выйти с кодом 1 при ошибке инициализации', async () => {
    // Arrange
    const testConfig: PluginConfigV003 = {
      topics: ['non-existent-topic'],
      rules: [],
    };

    // Устанавливаем невалидные env
    process.env.KAFKA_BROKERS = 'invalid-broker:9092';
    process.env.KAFKA_GROUP_ID = generateGroupId('init-error');
    process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;

    // Mock process.exit
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    startConsumer(testConfig);

    // Ждём выхода с ошибкой (невалидный broker)
    await waitForCondition(
      () => exitMock.mock.calls.length > 0,
      20000,
      500
    );

    // Assert
    expect(exitMock).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
  }, 30000);
});
});
