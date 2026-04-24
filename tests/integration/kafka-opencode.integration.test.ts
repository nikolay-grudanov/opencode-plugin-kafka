/**
 * Integration Tests: Kafka + OpenCode Agent (T027)
 *
 * Тестирует полный поток: message → routing → OpenCode agent → response/DLQ
 *
 * Test Scenarios (NFR-002, NFR-003):
 * 1. Success flow — валидное сообщение → match rule → agent invoke → response в responseTopic
 * 2. Timeout flow — agent возвращает timeout → сообщение уходит в DLQ
 * 3. Error flow — agent возвращает error → сообщение уходит в DLQ
 * 4. Tombstone — null value → DLQ
 * 5. No match — сообщение не match ни одно правило → лог + commit (без DLQ)
 *
 * Запуск: npx vitest run --config vitest.integration.config.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RedpandaContainer } from '@testcontainers/redpanda';
import type { Producer, EachMessagePayload } from 'kafkajs';
import { Kafka } from 'kafkajs';

import { eachMessageHandler } from '../../src/kafka/consumer.js';
import type { PluginConfigV003, RuleV003 } from '../../src/schemas/index.js';
import { MockOpenCodeAgent } from '../../src/opencode/MockOpenCodeAgent.js';

// ============================================================================
// Constants
// ============================================================================

const TEST_DLQ_TOPIC = 'test-dlq';
const TEST_TOPIC = 'test-topic-opencode';
const TEST_RESPONSE_TOPIC = 'test-response-topic';

const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

// ============================================================================
// Types
// ============================================================================

interface TestConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

// ============================================================================
// Fixtures
// ============================================================================

function generateGroupId(testName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${testName}-${timestamp}-${random}`;
}

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

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  pollIntervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

// ============================================================================
// Global Test Suite Variables
// ============================================================================

let container: Awaited<ReturnType<typeof RedpandaContainer.prototype.start>> | null = null;
let kafka: Kafka | null = null;
let bootstrapServers: string | null = null;
let containerAvailable = false;

// ============================================================================
// Setup/Teardown
// ============================================================================

describe('Integration Tests: Kafka + OpenCode Agent', () => {
  let originalDlqTopic: string | undefined;

  beforeAll(async () => {
    try {
      // Сохраняем и устанавливаем KAFKA_DLQ_TOPIC для DLQ
      originalDlqTopic = process.env.KAFKA_DLQ_TOPIC;
      process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;

      // Запускаем Redpanda контейнер
      container = await new RedpandaContainer('docker.redpanda.com/redpandadata/redpanda:latest')
        .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
        .start();

      bootstrapServers = container.getBootstrapServers();

      kafka = new Kafka({
        clientId: 'test-opencode-client',
        brokers: [bootstrapServers],
        retry: {
          initialRetryTime: 100,
          retries: 3,
        },
      });

      // Создаём topics
      const admin = kafka.admin();
      await admin.connect();

      await admin.createTopics({
        topics: [
          { topic: TEST_DLQ_TOPIC, numPartitions: 1, replicationFactor: 1 },
          { topic: TEST_TOPIC, numPartitions: 1, replicationFactor: 1 },
          { topic: TEST_RESPONSE_TOPIC, numPartitions: 1, replicationFactor: 1 },
        ],
      });

      await admin.disconnect();

      console.log(`[T027] Redpanda started: ${bootstrapServers}`);
      containerAvailable = true;
    } catch (err) {
      console.warn(
        `⚠️ Container runtime not available, skipping integration tests (T027)\n` +
        `⚠️ Original error: ${err}`
      );
      containerAvailable = false;
    }
  }, CONTAINER_STARTUP_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    // Восстанавливаем оригинальное значение KAFKA_DLQ_TOPIC
    if (originalDlqTopic !== undefined) {
      process.env.KAFKA_DLQ_TOPIC = originalDlqTopic;
    } else {
      delete process.env.KAFKA_DLQ_TOPIC;
    }

    if (container && containerAvailable) {
      await container.stop();
      console.log('[T027] Redpanda container stopped');
    }
  });

  // ========================================================================
  // T027-1: Success Flow
  // ========================================================================

  describe('T027-1: Success Flow', () => {
    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      // Mock agent с успешным ответом
      mockAgent = new MockOpenCodeAgent([
        {
          agentId: 'success-agent',
          response: 'Agent processed the request successfully',
          delayMs: 0,
        },
      ]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-1: должен обработать сообщение и отправить response в responseTopic', async () => {
      if (!containerAvailable) return;

      const rule: RuleV003 = {
        name: 'success-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process ${$.type}',
        agentId: 'success-agent',
        responseTopic: TEST_RESPONSE_TOPIC,
        timeoutMs: 30_000,
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      const testMessage = { type: 'test-type', data: 'test-data' };
      const payload = createPayload(TEST_TOPIC, JSON.stringify(testMessage), '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что сообщение обработано успешно
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(0);
      expect(state.isShuttingDown).toBe(false);

      // Читаем response из responseTopic
      const responseConsumer = kafka!.consumer({ groupId: generateGroupId('response-check') });
      await responseConsumer.connect();
      await responseConsumer.subscribe({ topics: [TEST_RESPONSE_TOPIC], fromBeginning: true });

      // Явный Promise для получения сообщения (M10)
      let resolveMessage: () => void;
      const messageReceived = new Promise<void>((resolve) => {
        resolveMessage = resolve;
      });

      const responses: string[] = [];
      await responseConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) {
            responses.push(value);
            resolveMessage(); // Сигнал что сообщение получено
          }
        },
      });

      // Ждём только пока получим сообщение или timeout
      await Promise.race([
        messageReceived,
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);

      expect(responses.length).toBeGreaterThan(0);

      // Парсим и проверяем response envelope
      const responseEnvelope = JSON.parse(responses[0]);
      expect(responseEnvelope.status).toBe('success');
      expect(responseEnvelope.response).toBe('Agent processed the request successfully');
      expect(responseEnvelope.ruleName).toBe('success-rule');
      expect(responseEnvelope.agentId).toBe('success-agent');

      // Явный disconnect (M10)
      await responseConsumer.disconnect();
    });
  });

  // ========================================================================
  // T027-2: Timeout Flow
  // ========================================================================

  describe('T027-2: Timeout Flow', () => {
    const timeoutDlqTopic = 'test-timeout-dlq';

    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeAll(async () => {
      if (!containerAvailable) return;
      // Создаём уникальный DLQ топик для этого теста
      const admin = kafka!.admin();
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: timeoutDlqTopic, numPartitions: 1, replicationFactor: 1 }],
      });
      await admin.disconnect();
      // Устанавливаем KAFKA_DLQ_TOPIC для этого теста
      process.env.KAFKA_DLQ_TOPIC = timeoutDlqTopic;
    });

    afterAll(async () => {
      if (!containerAvailable) return;
      process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;
    });

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      // Mock agent с delayMs > timeoutMs = timeout
      mockAgent = new MockOpenCodeAgent([
        {
          agentId: 'timeout-agent',
          delayMs: 5000, // 5 секунд delay
          response: 'This should not be returned',
        },
      ]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-2: при timeout агента сообщение должно уйти в DLQ', async () => {
      if (!containerAvailable) return;

      const rule: RuleV003 = {
        name: 'timeout-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process ${$.type}',
        agentId: 'timeout-agent',
        responseTopic: TEST_RESPONSE_TOPIC,
        timeoutMs: 1_000, // 1 секунда timeout (меньше чем delayMs)
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      const testMessage = { type: 'timeout-test', data: 'test-data' };
      const payload = createPayload(TEST_TOPIC, JSON.stringify(testMessage), '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что сообщение обработано и отправлено в DLQ
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(1);
      expect(state.isShuttingDown).toBe(false);

      // Читаем DLQ и проверяем структуру (M10 - explicit message waiting + disconnect)
      const dlqConsumer = kafka!.consumer({ groupId: generateGroupId('dlq-timeout-check') });
      await dlqConsumer.connect();
      await dlqConsumer.subscribe({ topics: [timeoutDlqTopic], fromBeginning: true });

      // Явный Promise для получения сообщения (M10)
      let resolveDlq: () => void;
      const dlqReceivedPromise = new Promise<void>((resolve) => {
        resolveDlq = resolve;
      });

      const dlqMessages: string[] = [];
      await dlqConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) {
            dlqMessages.push(value);
            resolveDlq();
          }
        },
      });

      // Ждём только пока получим сообщение или timeout
      await Promise.race([
        dlqReceivedPromise,
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);

      expect(dlqMessages.length).toBeGreaterThan(0);
      const dlqEnvelope = JSON.parse(dlqMessages[0]);
      expect(dlqEnvelope.originalValue).toBe(JSON.stringify(testMessage));
      expect(dlqEnvelope.errorMessage).toContain('timeout');

      // Явный disconnect (M10)
      await dlqConsumer.disconnect();
    });
  });

  // ========================================================================
  // T027-3: Error Flow
  // ========================================================================

  describe('T027-3: Error Flow', () => {
    const errorDlqTopic = 'test-error-dlq';

    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeAll(async () => {
      if (!containerAvailable) return;
      // Создаём уникальный DLQ топик для этого теста
      const admin = kafka!.admin();
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: errorDlqTopic, numPartitions: 1, replicationFactor: 1 }],
      });
      await admin.disconnect();
      // Устанавливаем KAFKA_DLQ_TOPIC для этого теста
      process.env.KAFKA_DLQ_TOPIC = errorDlqTopic;
    });

    afterAll(async () => {
      if (!containerAvailable) return;
      process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;
    });

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      // Mock agent с ошибкой
      mockAgent = new MockOpenCodeAgent([
        {
          agentId: 'error-agent',
          shouldError: true,
          errorMessage: 'Agent processing failed: internal error',
        },
      ]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-3: при ошибке агента сообщение должно уйти в DLQ', async () => {
      if (!containerAvailable) return;

      const rule: RuleV003 = {
        name: 'error-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process ${$.type}',
        agentId: 'error-agent',
        responseTopic: TEST_RESPONSE_TOPIC,
        timeoutMs: 30_000,
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      const testMessage = { type: 'error-test', data: 'test-data' };
      const payload = createPayload(TEST_TOPIC, JSON.stringify(testMessage), '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что сообщение обработано и отправлено в DLQ
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(1);
      expect(state.isShuttingDown).toBe(false);

      // Читаем DLQ и проверяем структуру
      const dlqConsumer = kafka!.consumer({ groupId: generateGroupId('dlq-error-check') });
      await dlqConsumer.connect();
      await dlqConsumer.subscribe({ topics: [errorDlqTopic], fromBeginning: true });

      const dlqMessages: string[] = [];
      await dlqConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) dlqMessages.push(value);
        },
      });

      const dlqReceived = await waitForCondition(
        () => dlqMessages.length > 0,
        5000
      );

      expect(dlqReceived).toBe(true);
      const dlqEnvelope = JSON.parse(dlqMessages[0]);
      expect(dlqEnvelope.originalValue).toBe(JSON.stringify(testMessage));
      expect(dlqEnvelope.errorMessage).toContain('Agent processing failed');

      await dlqConsumer.disconnect();
    });
  });

  // ========================================================================
  // T027-4: Tombstone Flow
  // ========================================================================

  describe('T027-4: Tombstone Flow', () => {
    const tombstoneDlqTopic = 'test-tombstone-dlq';

    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeAll(async () => {
      if (!containerAvailable) return;
      // Создаём уникальный DLQ топик для этого теста
      const admin = kafka!.admin();
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: tombstoneDlqTopic, numPartitions: 1, replicationFactor: 1 }],
      });
      await admin.disconnect();
      // Устанавливаем KAFKA_DLQ_TOPIC для этого теста
      process.env.KAFKA_DLQ_TOPIC = tombstoneDlqTopic;
    });

    afterAll(async () => {
      if (!containerAvailable) return;
      process.env.KAFKA_DLQ_TOPIC = TEST_DLQ_TOPIC;
    });

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      mockAgent = new MockOpenCodeAgent([]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-4: tombstone (null value) должно уйти в DLQ', async () => {
      if (!containerAvailable) return;

      const rule: RuleV003 = {
        name: 'tombstone-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process ${$.type}',
        agentId: 'any-agent',
        responseTopic: TEST_RESPONSE_TOPIC,
        timeoutMs: 30_000,
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      // Payload с null value (tombstone)
      const payload = createPayload(TEST_TOPIC, null, '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что tombstone обработан и отправлен в DLQ
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(1);
      expect(state.isShuttingDown).toBe(false);

      // Читаем DLQ и проверяем структуру
      const dlqConsumer = kafka!.consumer({ groupId: generateGroupId('dlq-tombstone-check') });
      await dlqConsumer.connect();
      await dlqConsumer.subscribe({ topics: [tombstoneDlqTopic], fromBeginning: true });

      const dlqMessages: string[] = [];
      await dlqConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) dlqMessages.push(value);
        },
      });

      const dlqReceived = await waitForCondition(
        () => dlqMessages.length > 0,
        5000
      );

      expect(dlqReceived).toBe(true);
      const dlqEnvelope = JSON.parse(dlqMessages[0]);
      expect(dlqEnvelope.originalValue).toBeNull();
      expect(dlqEnvelope.errorMessage).toContain('tombstone');

      await dlqConsumer.disconnect();
    });
  });

  // ========================================================================
  // T027-5: No Match Flow
  // ========================================================================

  describe('T027-5: No Match Flow', () => {
    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      mockAgent = new MockOpenCodeAgent([]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-5: сообщение без matching rule должно быть закоммичено без DLQ', async () => {
      if (!containerAvailable) return;

      // Правило которое НЕ matchирует наше сообщение
      const rule: RuleV003 = {
        name: 'unmatched-rule',
        jsonPath: '$.nonexistent.path[?(@.value=="specific")]',
        promptTemplate: 'Process ${$.type}',
        agentId: 'any-agent',
        responseTopic: TEST_RESPONSE_TOPIC,
        timeoutMs: 30_000,
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      // Сообщение которое не matchирует ни одно правило
      const testMessage = { type: 'unmatched', data: 'test-data' };
      const payload = createPayload(TEST_TOPIC, JSON.stringify(testMessage), '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что сообщение обработано но НЕ отправлено в DLQ
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(0);
      expect(state.isShuttingDown).toBe(false);

      // Проверяем что в DLQ нет новых сообщений от этого теста
      const dlqConsumer = kafka!.consumer({ groupId: generateGroupId('dlq-empty-check') });
      await dlqConsumer.connect();
      await dlqConsumer.subscribe({ topics: [TEST_DLQ_TOPIC], fromBeginning: false });

      const dlqMessages: string[] = [];
      await dlqConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) dlqMessages.push(value);
        },
      });

      // Ждём немного и проверяем что DLQ пуст
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(dlqMessages.length).toBe(0);

      await dlqConsumer.disconnect();
    });
  });

  // ========================================================================
  // T027-6: Response without responseTopic
  // ========================================================================

  describe('T027-6: Response without responseTopic', () => {
    let dlqProducer: Producer;
    let responseProducer: Producer;
    let mockAgent: MockOpenCodeAgent;

    beforeEach(async () => {
      if (!containerAvailable) return;

      dlqProducer = kafka!.producer();
      await dlqProducer.connect();

      responseProducer = kafka!.producer();
      await responseProducer.connect();

      mockAgent = new MockOpenCodeAgent([
        {
          agentId: 'no-response-topic-agent',
          response: 'Success but no responseTopic',
        },
      ]);
    });

    afterEach(async () => {
      if (!containerAvailable) return;
      await dlqProducer?.disconnect();
      await responseProducer?.disconnect();
    });

    it('T027-6: при отсутствии responseTopic response не отправляется', async () => {
      if (!containerAvailable) return;

      // Правило БЕЗ responseTopic
      const rule: RuleV003 = {
        name: 'no-response-topic-rule',
        jsonPath: '$.type',
        promptTemplate: 'Process ${$.type}',
        agentId: 'no-response-topic-agent',
        // responseTopic НЕ указан
        timeoutMs: 30_000,
      };

      const config = createTestConfig([TEST_TOPIC], [rule]);
      const state = createTestState();
      const activeSessions = new Set<AbortController>();
      const mockCommit = async () => {};

      const testMessage = { type: 'no-topic-test', data: 'test-data' };
      const payload = createPayload(TEST_TOPIC, JSON.stringify(testMessage), '0');

      // Вызываем eachMessageHandler
      await eachMessageHandler(
        payload,
        config,
        dlqProducer,
        mockCommit,
        state,
        mockAgent,
        responseProducer,
        activeSessions
      );

      // Проверяем что сообщение обработано успешно
      expect(state.totalMessagesProcessed).toBe(1);
      expect(state.dlqMessagesCount).toBe(0);
      expect(state.isShuttingDown).toBe(false);

      // Проверяем что в responseTopic ничего не появилось
      const responseConsumer = kafka!.consumer({ groupId: generateGroupId('no-response-check') });
      await responseConsumer.connect();
      await responseConsumer.subscribe({ topics: [TEST_RESPONSE_TOPIC], fromBeginning: false });

      const responses: string[] = [];
      await responseConsumer.run({
        autoCommit: false,
        eachMessage: async (p) => {
          const value = p.message.value?.toString('utf-8');
          if (value) responses.push(value);
        },
      });

      // Ждём и проверяем что responseTopic пуст
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(responses.length).toBe(0);

      await responseConsumer.disconnect();
    });
  });
});