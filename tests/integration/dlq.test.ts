/**
 * Integration Tests для DLQ flow
 * Тестирует: consumer → DLQ integration при обработке ошибок
 *
 * Test Strategy:
 * - Semi-integration: настоящий eachMessageHandler + mocked Producer
 * - Проверяется полный поток обработки ошибок
 * - Producer mocking позволяет контролировать ошибки отправки
 *
 * @fileoverview Tests for DLQ integration with eachMessageHandler
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { eachMessageHandler } from '../../src/kafka/consumer.js';
import type { PluginConfigV003 } from '../../src/schemas/index.js';

// Import setup functions (могут быть использованы для будущих реальных integration tests)
import { createRedpandaContainer, cleanupRedpandaContainer } from './setup';
import type { StartedTestContainer } from 'testcontainers';

// Import helpers для mock объектов
import { createMockHandlerDeps, createMockErrorAgent, createMockTimeoutAgent } from './helpers/index.js';
import type { MockHandlerDeps } from './helpers/index.js';

describe('Integration Tests: DLQ Flow', () => {
  let redpandaContainer: StartedTestContainer | null = null;
  let deps: MockHandlerDeps;
  let mockConfig: PluginConfigV003;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Setup: Запуск Redpanda контейнера перед всеми тестами
   * В текущей версии используется mock контейнер, но в будущем можно расширить
   * для реального Kafka integration testing.
   */
  beforeAll(async () => {
    redpandaContainer = await createRedpandaContainer();
    console.log(`Redpanda started: ${redpandaContainer.getHost()}:${redpandaContainer.getMappedPort(9092)}`);
  }, 120000); // 2 минуты timeout для запуска Redpanda

  /**
   * Cleanup: Остановка Redpanda контейнера после всех тестов
   */
  afterAll(async () => {
    if (redpandaContainer) {
      await cleanupRedpandaContainer(redpandaContainer);
      console.log('Redpanda container stopped');
    }
  });

  /**
   * Setup перед каждым тестом
   */
  beforeEach(() => {
    // Используем factory для создания полного набора mock зависимостей
    deps = createMockHandlerDeps();

    // Создаем тестовую конфигурацию
    mockConfig = {
      topics: ['test-topic'],
      rules: [
        {
          name: 'test-rule',
          jsonPath: '$.test',
          promptTemplate: 'Process: ${$}',
        },
      ],
    };

    // Spy на console.log и console.error
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Clear all mocks
    vi.clearAllMocks();
  });

  /**
   * Cleanup после каждого теста
   */
  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Invalid JSON message lands in DLQ topic', () => {
    it('должен отправить невалидный JSON в DLQ с правильным envelope', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Проверяем что Producer.send был вызван (сообщение отправлено в DLQ)
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);

      // Получаем отправленный envelope
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const record = sendCall[0];
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем структуру DLQ envelope
      expect(envelope.originalValue).toBe('invalid json');
      expect(envelope.topic).toBe('test-topic');
      expect(envelope.partition).toBe(0);
      expect(envelope.offset).toBe('42');
      expect(envelope.errorMessage).toMatch(/JSON/i); // Ошибка про JSON parsing
      expect(envelope.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO 8601

      // Проверяем что commitOffsets был вызван (сообщение НЕ retry'ится)
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
      expect(deps.commitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '42' },
      ]);
    });

    it('должен отправить в DLQ при некорректной JSON структуре (unclosed brace)', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 1,
        message: {
          value: Buffer.from('{"test": unclosed}'),
          offset: '789',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify DLQ send
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      expect(envelope.originalValue).toBe('{"test": unclosed}');
      expect(envelope.topic).toBe('test-topic');
      expect(envelope.partition).toBe(1);
      expect(envelope.offset).toBe('789');
      expect(envelope.errorMessage).toMatch(/JSON/i);

      // Verify commit
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
    });

    it('должен отправить в DLQ при пустом JSON', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from(''),
          offset: '123',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify DLQ send
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      expect(envelope.originalValue).toBe('');
      expect(envelope.errorMessage).toMatch(/JSON/i);
    });
  });

  describe('DLQ envelope has correct structure', () => {
    it('должен содержать все required fields в DLQ envelope', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 2,
        message: {
          value: Buffer.from('invalid json'),
          offset: '456',
          key: Buffer.from('test-key'),
          headers: { 'header1': Buffer.from('value1') },
          timestamp: '2024-04-22T12:34:56.789Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем все required fields из FR-022
      expect(envelope).toHaveProperty('originalValue');
      expect(envelope).toHaveProperty('topic');
      expect(envelope).toHaveProperty('partition');
      expect(envelope).toHaveProperty('offset');
      expect(envelope).toHaveProperty('errorMessage');
      expect(envelope).toHaveProperty('failedAt');

      // Проверяем типы
      expect(typeof envelope.originalValue).toBe('string');
      expect(typeof envelope.topic).toBe('string');
      expect(typeof envelope.partition).toBe('number');
      expect(typeof envelope.offset).toBe('string');
      expect(typeof envelope.errorMessage).toBe('string');
      expect(typeof envelope.failedAt).toBe('string');
    });

    it('должн устанавливать failedAt как ISO 8601 timestamp', async () => {
      const beforeCall = Date.now();
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);
      const afterCall = Date.now();

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем что failedAt валидный ISO timestamp
      const failedAtDate = new Date(envelope.failedAt);
      expect(failedAtDate.toISOString()).toBe(envelope.failedAt);

      // Проверяем что timestamp в разумном временном окне
      expect(failedAtDate.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(failedAtDate.getTime()).toBeLessThanOrEqual(afterCall + 1000);
    });

    it('должен использовать правильный DLQ topic name', async () => {
      const payload = {
        topic: 'my-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что topic = {original-topic}-dlq
      expect(record.topic).toBe('my-topic-dlq');
    });

    it('должен использовать custom DLQ topic когда KAFKA_DLQ_TOPIC установлен', async () => {
      // Set custom DLQ topic
      process.env.KAFKA_DLQ_TOPIC = 'custom-dlq-topic';

      const payload = {
        topic: 'my-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что используется custom DLQ topic
      expect(record.topic).toBe('custom-dlq-topic');

      // Cleanup
      delete process.env.KAFKA_DLQ_TOPIC;
    });
  });

  describe('DLQ send failure does NOT crash consumer', () => {
    it('должен продолжать работу при Producer.send() failure', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      // Mock Producer.send() to throw error
      vi.mocked(deps.dlqProducer.send).mockRejectedValueOnce(
        new Error('Kafka connection failed')
      );

      // eachMessageHandler НЕ должен бросить исключение
      await expect(
        eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions)
      ).resolves.not.toThrow();

      // Проверяем что commitOffsets был вызван (consumer продолжает работать)
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
      expect(deps.commitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '42' },
      ]);
    });

    it('должен логировать ошибку при Producer.send() failure', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      const kafkaError = new Error('Kafka connection failed');
      vi.mocked(deps.dlqProducer.send).mockRejectedValueOnce(kafkaError);

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Проверяем что console.error был вызван
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const errorLog = vi.mocked(consoleErrorSpy).mock.calls[0][0];

      // Проверяем структуру error log
      const parsedErrorLog = JSON.parse(errorLog);
      expect(parsedErrorLog.level).toBe('error');
      expect(parsedErrorLog.event).toBe('dlq_send_failed');
      expect(parsedErrorLog.sendError).toBe('Kafka connection failed');
      expect(parsedErrorLog.originalTopic).toBe('test-topic');
      expect(parsedErrorLog.partition).toBe(0);
      expect(parsedErrorLog.offset).toBe('42');
    });

    it('должен корректно обрабатывать несколько сообщений при intermittent DLQ failures', async () => {
      const payloads = [
        {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('invalid json 1'),
            offset: '1',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        },
        {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('invalid json 2'),
            offset: '2',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        },
        {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('invalid json 3'),
            offset: '3',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        },
      ];

      // Mock Producer.send() для первого и третьего сообщений (fail), для второго (success)
      vi.mocked(deps.dlqProducer.send)
        .mockRejectedValueOnce(new Error('Kafka connection failed'))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Kafka connection failed'));

      // Обрабатываем все сообщения
      for (const payload of payloads) {
        await expect(
          eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions)
        ).resolves.not.toThrow();
      }

      // Проверяем что все сообщения были закоммичены (consumer не крашнулся)
      expect(deps.commitOffsets).toHaveBeenCalledTimes(3);
      expect(deps.commitOffsets).toHaveBeenNthCalledWith(1, [{ topic: 'test-topic', partition: 0, offset: '1' }]);
      expect(deps.commitOffsets).toHaveBeenNthCalledWith(2, [{ topic: 'test-topic', partition: 0, offset: '2' }]);
      expect(deps.commitOffsets).toHaveBeenNthCalledWith(3, [{ topic: 'test-topic', partition: 0, offset: '3' }]);
    });
  });

  describe('Integration with eachMessageHandler', () => {
    it('должен обрабатывать полный поток: invalid JSON → DLQ → commit', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify DLQ send
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      expect(envelope.originalValue).toBe('invalid json');
      expect(envelope.topic).toBe('test-topic');
      expect(envelope.partition).toBe(0);
      expect(envelope.offset).toBe('42');

      // Step 2: Verify commitOffsets
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
      expect(deps.commitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '42' },
      ]);

      // Step 3: Verify that message is NOT retried (no exception thrown)
      // (already verified by expect().resolves.not.toThrow())
    });

    it('должен обрабатывать полный поток: matchRuleV003 throws → DLQ → commit', async () => {
      // Mock matchRuleV003 to throw
      vi.spyOn(await import('../../src/core/routing.js'), 'matchRuleV003').mockImplementationOnce(() => {
        throw new Error('matchRuleV003 failed');
      });

      const payload = {
        topic: 'test-topic',
        partition: 1,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '789',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify DLQ send
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      expect(envelope.originalValue).toBe('{"test": "value"}');
      expect(envelope.errorMessage).toBe('matchRuleV003 failed');

      // Verify commitOffsets
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
    });

    it('должен обрабатывать полный поток: unexpected error → DLQ → commit', async () => {
      // Mock matchRuleV003 to throw unexpected error
      vi.spyOn(await import('../../src/core/routing.js'), 'matchRuleV003').mockImplementationOnce(() => {
        throw new Error('Unexpected internal error');
      });

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify DLQ send
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      expect(envelope.errorMessage).toBe('Unexpected internal error');
      expect(envelope.originalValue).toBe('{"test": "value"}');

      // Verify commitOffsets был вызван
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
      expect(deps.commitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '42' },
      ]);
    });

    it('должен логировать successful DLQ send', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, deps.dlqProducer, deps.commitOffsets, deps.state, deps.agent, deps.responseProducer, deps.activeSessions);

      // Verify console.log was called with dlq_sent event
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
        return JSON.stringify(call).includes('dlq_sent');
      });
      expect(logCall).toBeDefined();
    });
  });

  /**
   * Agent Error/Timeout сценарии (MAJOR M8)
   */
  describe('Agent Error → DLQ', () => {
    beforeEach(() => {
      // Override agent с ошибкой
      deps.agent = createMockErrorAgent('Agent processing failed');
    });

    it('отправляет сообщение в DLQ когда агент возвращает status=error', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(
        payload,
        mockConfig,
        deps.dlqProducer,
        deps.commitOffsets,
        deps.state,
        deps.agent,
        deps.responseProducer,
        deps.activeSessions
      );

      // Проверяем что sendToDlq вызван
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);

      // Получаем отправленный envelope
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const record = sendCall[0];
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем что errorMessage содержит текст ошибки агента
      expect(envelope.errorMessage).toContain('Agent processing failed');
      expect(envelope.errorMessage).toContain('error');

      // Проверяем что commitOffsets вызван
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
    });
  });

  describe('Agent Timeout → DLQ', () => {
    beforeEach(() => {
      // Override agent с timeout
      deps.agent = createMockTimeoutAgent(120000);
    });

    it('отправляет сообщение в DLQ когда агент возвращает status=timeout', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '42',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(
        payload,
        mockConfig,
        deps.dlqProducer,
        deps.commitOffsets,
        deps.state,
        deps.agent,
        deps.responseProducer,
        deps.activeSessions
      );

      // Проверяем что sendToDlq вызван
      expect(deps.dlqProducer.send).toHaveBeenCalledTimes(1);

      // Получаем отправленный envelope
      const sendCall = vi.mocked(deps.dlqProducer.send).mock.calls[0];
      const record = sendCall[0];
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем что errorMessage указывает на timeout
      expect(envelope.errorMessage).toContain('timeout');
      expect(envelope.errorMessage).toContain('120000');

      // Проверяем что commitOffsets вызван
      expect(deps.commitOffsets).toHaveBeenCalledTimes(1);
    });
  });
});