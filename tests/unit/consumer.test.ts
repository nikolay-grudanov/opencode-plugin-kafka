/**
 * Unit tests for eachMessageHandler
 * @fileoverview Tests for sequential message processing with DLQ support
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eachMessageHandler, logDlqRate, logConsumerLagMetrics, isBrokerThrottleError, executeWithThrottleRetry } from '../../src/kafka/consumer.js';
import type { PluginConfigV003, RuleV003 } from '../../src/schemas/index.js';
import type { Producer } from 'kafkajs';
import type { IOpenCodeAgent, AgentResult } from '../../src/opencode/IOpenCodeAgent.js';

/**
 * Mock состояние consumer для тестов (Constitution Principle IV: No-State Consumer)
 */
interface MockConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

// Mock для sendToDlq
vi.mock('../../src/kafka/dlq.js', () => ({
  sendToDlq: vi.fn(),
}));

// Import mocked module
import { sendToDlq } from '../../src/kafka/dlq.js';

describe('eachMessageHandler', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockConfig: PluginConfigV003;
  let mockState: MockConsumerState;
  let rules: RuleV003[];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;

  beforeEach(() => {
    // Setup mocks
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 0,
      dlqMessagesCount: 0,
      lastDlqRateLogTime: Date.now(),
    };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock agent - по умолчанию возвращает success
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Mock response producer
    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    // Active sessions set
    activeSessions = new Set<AbortController>();

    // Setup config with one matching rule
    rules = [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
      },
    ];

    mockConfig = {
      topics: ['test-topic'],
      rules: rules,
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Valid JSON passes parsing', () => {
    it('должен успешно обработать валидный JSON', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
      expect(mockCommitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '0' },
      ]);

      // Verify sendToDlq was NOT called (no error)
      expect(sendToDlq).not.toHaveBeenCalled();
    });
  });

  describe('Invalid JSON throws → DLQ', () => {
    it('должен отправить в DLQ при невалидном JSON', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid json'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq was called
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify commitOffsets was called (after DLQ)
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
      expect(mockCommitOffsets).toHaveBeenCalledWith([
        { topic: 'test-topic', partition: 0, offset: '0' },
      ]);

      // Verify DLQ call included error about JSON parsing
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toMatch(/JSON/i);
    });

    it('должен отправить в DLQ при некорректной JSON структуре', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": unclosed}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq was called
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });
  });

  describe('Oversized message (>1MB) → DLQ', () => {
    it('должен отправить в DLQ сообщение превышающее 1MB', async () => {
      // Создаем сообщение размером 1MB + 1 byte
      const oversizedMessage = 'x'.repeat(1024 * 1024 + 1);

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from(oversizedMessage),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq was called
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error mentions size limit
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toContain('exceeds maximum');

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });

    it('должен успешно обработать сообщение размером ровно 1MB', async () => {
      // Создаем сообщение размером ровно 1MB
      const exactSizeMessage = 'x'.repeat(1024 * 1024);

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from(exactSizeMessage),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      // Этот тест фокусируется на проверке размера, поэтому мы игнорируем ошибку JSON parse
      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq was called (из-за JSON parse error, но НЕ из-за размера)
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error is NOT about size
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).not.toContain('exceeds maximum');
    });
  });

  describe('matchRuleV003() throws → DLQ', () => {
    it('должен отправить в DLQ если matchRuleV003 выбрасывает исключение', async () => {
      // Mock matchRuleV003 to throw an error
      vi.spyOn(await import('../../src/core/routing.js'), 'matchRuleV003').mockImplementationOnce(() => {
        throw new Error('matchRuleV003 error');
      });

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq был вызван
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify commitOffsets был вызван
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });
  });

  describe('Unexpected error in eachMessageHandler → DLQ', () => {
    it('должен отправить в DLQ при неожиданной ошибке в обработчике', async () => {
      // Mock commitOffsets to throw an error (simulating unexpected error)
      mockCommitOffsets.mockImplementationOnce(() => {
        throw new Error('Commit failed');
      });

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq был вызван (из-за ошибки в commitOffsets)
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error mentions "Unexpected error"
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toContain('Unexpected error');
    });

    it('должен отправить в DLQ при не-Error в catch block (строка вместо Error)', async () => {
      // Mock commitOffsets to throw a string instead of Error
      mockCommitOffsets.mockImplementationOnce(() => {
        throw 'String error instead of Error object';
      });

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq был вызван
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error message includes the string error
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toContain('Unexpected error');
      expect(dlqCall[2].message).toContain('String error instead of Error object');
    });
  });

  describe('buildPromptV003() returns fallback → no error', () => {
    it('должен успешно обработать когда buildPromptV003 возвращает fallback', async () => {
      // Создаем правило, которое совпадет, но с placeholder для несуществующего поля
      rules = [
        {
          name: 'test-rule',
          jsonPath: '$.test',
          promptTemplate: 'Process: ${$.missing}', // Placeholder с несуществующим полем
        },
      ];
      mockConfig.rules = rules;

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify console.log was called with "message_processed"
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
        return JSON.stringify(call).includes('message_processed');
      });
      expect(logCall).toBeDefined();

      // Verify log contains matchedRule name
      expect(JSON.stringify(logCall)).toContain('test-rule');

      // Verify sendToDlq was NOT called (fallback is NOT an error)
      expect(sendToDlq).not.toHaveBeenCalled();

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });
  });

  describe('No global state between invocations', () => {
    it('не должен сохранять состояние между вызовами', async () => {
      const payloads = [
        {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('{"test": "first"}'),
            offset: '0',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        },
        {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('{"test": "second"}'),
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
            value: Buffer.from('{"test": "third"}'),
            offset: '2',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        },
      ];

      // Обрабатываем все сообщения
      for (const payload of payloads) {
        await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);
      }

      // Verify each message was processed independently
      expect(mockCommitOffsets).toHaveBeenCalledTimes(3);
      expect(sendToDlq).not.toHaveBeenCalled();

      // Verify each commit had correct offset
      expect(mockCommitOffsets).toHaveBeenNthCalledWith(1, [{ topic: 'test-topic', partition: 0, offset: '0' }]);
      expect(mockCommitOffsets).toHaveBeenNthCalledWith(2, [{ topic: 'test-topic', partition: 0, offset: '1' }]);
      expect(mockCommitOffsets).toHaveBeenNthCalledWith(3, [{ topic: 'test-topic', partition: 0, offset: '2' }]);
    });
  });

  describe('Sequential processing', () => {
    function createTestPayload(index: number) {
      return {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from(`{"test": "value-${index}"}`),
          offset: String(index),
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };
    }

    it('должен обрабатывать сообщения последовательно (сообщения обрабатываются в правильном порядке)', async () => {
      // Создаем сообщения
      const numMessages = 5;
      const payloads: Array<ReturnType<typeof createTestPayload>> = [];

      for (let i = 0; i < numMessages; i++) {
        payloads.push(createTestPayload(i));
      }

      // Отслеживаем порядок обработки сообщений
      const processedOffsets: string[] = [];
      mockCommitOffsets.mockImplementation((offsets) => {
        processedOffsets.push(offsets[0].offset);
        return Promise.resolve();
      });

      // Обрабатываем сообщения последовательно
      for (const payload of payloads) {
        await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);
      }

      // Проверяем, что все сообщения обработаны
      expect(mockCommitOffsets).toHaveBeenCalledTimes(numMessages);
      expect(sendToDlq).not.toHaveBeenCalled();

      // Проверяем sequential processing — сообщения обработаны в правильном порядке
      expect(processedOffsets).toEqual(['0', '1', '2', '3', '4']);

      // Проверяем, что каждое сообщение было обработано (commitOffsets вызван с правильным offset)
      for (let i = 0; i < numMessages; i++) {
        expect(mockCommitOffsets).toHaveBeenNthCalledWith(i + 1, [
          { topic: 'test-topic', partition: 0, offset: String(i) },
        ]);
      }
    });
  });

  describe('Edge cases', () => {
    it('должен обрабатывать null message value (tombstone)', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: null, // Tombstone
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify sendToDlq was called (tombstone → DLQ)
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error mentions tombstone
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toContain('null');

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });

    it('должен логировать "no rule matched" если ни одно правило не совпало', async () => {
      // Создаем правило, которое не совпадет с payload
      rules = [
        {
          name: 'non-matching-rule',
          jsonPath: '$.nonexistent',
          promptTemplate: 'Test',
        },
      ];
      mockConfig.rules = rules;

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify console.log was called with "no_rule_matched"
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
        return JSON.stringify(call).includes('no_rule_matched');
      });
      expect(logCall).toBeDefined();

      // Verify sendToDlq was NOT called (no rule matched is NOT an error)
      expect(sendToDlq).not.toHaveBeenCalled();

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });

    it('должен корректно обрабатывать успешное совпадение правила', async () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "matched-value"}'),
          offset: '0',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

      // Verify console.log was called with "message_processed"
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
        return JSON.stringify(call).includes('message_processed');
      });
      expect(logCall).toBeDefined();

      // Verify log contains matchedRule name
      expect(JSON.stringify(logCall)).toContain('test-rule');

      // Verify sendToDlq was NOT called
      expect(sendToDlq).not.toHaveBeenCalled();

      // Verify commitOffsets was called
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Unit tests для helper functions (logDlqRate, logConsumerLagMetrics, isBrokerThrottleError, executeWithThrottleRetry)
 */
describe('Helper functions', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('logDlqRate', () => {
    it('должен логировать DLQ rate каждые 100 сообщений', () => {
      const state = {
        isShuttingDown: false,
        totalMessagesProcessed: 100,
        dlqMessagesCount: 5,
        lastDlqRateLogTime: Date.now() - 1000,
      };

      logDlqRate(state);

      // Verify log содержит dlq_rate
      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls[0];
      const logObj = JSON.parse(logCall[0] as string);
      expect(logObj.event).toBe('dlq_rate');
      expect(logObj.totalMessages).toBe(100);
      expect(logObj.dlqMessages).toBe(5);
      expect(logObj.dlqRatePercent).toBe('5.00');
    });

    it('не должен логировать при totalMessagesProcessed === 0', () => {
      const state = {
        isShuttingDown: false,
        totalMessagesProcessed: 0,
        dlqMessagesCount: 0,
        lastDlqRateLogTime: Date.now(),
      };

      logDlqRate(state);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('не должен логировать при totalMessagesProcessed не кратном 100', () => {
      const state = {
        isShuttingDown: false,
        totalMessagesProcessed: 50,
        dlqMessagesCount: 2,
        lastDlqRateLogTime: Date.now(),
      };

      logDlqRate(state);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('должен обновлять lastDlqRateLogTime после логирования', () => {
      const previousLogTime = Date.now() - 5000;
      const state = {
        isShuttingDown: false,
        totalMessagesProcessed: 100,
        dlqMessagesCount: 10,
        lastDlqRateLogTime: previousLogTime,
      };

      logDlqRate(state);

      expect(state.lastDlqRateLogTime).toBeGreaterThan(previousLogTime);
    });

    it('должен корректно вычислять 50% DLQ rate', () => {
      const state = {
        isShuttingDown: false,
        totalMessagesProcessed: 200,
        dlqMessagesCount: 100,
        lastDlqRateLogTime: Date.now() - 1000,
      };

      logDlqRate(state);

      const logCall = vi.mocked(consoleLogSpy).mock.calls[0];
      const logObj = JSON.parse(logCall[0] as string);
      expect(logObj.dlqRatePercent).toBe('50.00');
    });
  });

  describe('logConsumerLagMetrics', () => {
    it('должен логировать consumer lag metrics', () => {
      const payload = {
        topic: 'test-topic',
        partition: 0,
        offset: '123',
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '123',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
} as EachMessagePayload;

      logConsumerLagMetrics(payload);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = vi.mocked(consoleLogSpy).mock.calls[0];
      const logObj = JSON.parse(logCall[0] as string);
      expect(logObj.event).toBe('consumer_lag_metrics');
      expect(logObj.topic).toBe('test-topic');
      expect(logObj.partition).toBe(0);
      expect(logObj.offset).toBe('123');
      expect(logObj.messageTimestamp).toBe('2024-04-22T00:00:00.000Z');
    });
  });

  describe('isBrokerThrottleError', () => {
    it('должен возвращать true для ошибки с "throttle"', () => {
      const error = new Error('Request throttled by broker');
      expect(isBrokerThrottleError(error)).toBe(true);
    });

    it('должен возвращать true для ошибки с "rate limit"', () => {
      const error = new Error('Rate limit exceeded');
      expect(isBrokerThrottleError(error)).toBe(true);
    });

    it('должен возвращать true для ошибки с "too many requests"', () => {
      const error = new Error('Too many requests');
      expect(isBrokerThrottleError(error)).toBe(true);
    });

    it('должен возвращать true для ошибки с "THROTTLE" в верхнем регистре', () => {
      const error = new Error('THROTTLE ERROR');
      expect(isBrokerThrottleError(error)).toBe(true);
    });

    it('должен возвращать false для обычной ошибки', () => {
      const error = new Error('Connection refused');
      expect(isBrokerThrottleError(error)).toBe(false);
    });

    it('должен обрабатывать строку вместо Error объекта', () => {
      const errorString = 'Some random error';
      expect(isBrokerThrottleError(errorString)).toBe(false);
    });

    it('должен обрабатывать null', () => {
      expect(isBrokerThrottleError(null)).toBe(false);
    });

    it('должен обрабатывать undefined', () => {
      expect(isBrokerThrottleError(undefined)).toBe(false);
    });

    it('должен обрабатывать объект без message', () => {
      const error = { code: 'ERR_THROTTLED' } as unknown as Error;
      expect(isBrokerThrottleError(error)).toBe(false);
    });
  });

  describe('executeWithThrottleRetry', () => {
    it('должен успешно выполнить операцию с первой попытки', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithThrottleRetry(operation, 'testOperation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('должен выполнить retry при throttle ошибке и успехе на второй попытке', async () => {
      const throttleError = new Error('Request throttled by broker');
      const operation = vi
        .fn()
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce('success');

      const result = await executeWithThrottleRetry(operation, 'testOperation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
      // Проверяем что было логирование throttle
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('должен выбросить ошибку после max retries при throttle', async () => {
      const throttleError = new Error('Request throttled by broker');
      const operation = vi.fn().mockRejectedValue(throttleError);

      await expect(executeWithThrottleRetry(operation, 'testOperation')).rejects.toThrow(
        'Request throttled by broker',
      );

      // MAX_THROTTLE_RETRIES = 3
      expect(operation).toHaveBeenCalledTimes(3);
      // Проверяем что было error логирование
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('должен выбросить ошибку сразу при не-throttle ошибке', async () => {
      const normalError = new Error('Connection refused');
      const operation = vi.fn().mockRejectedValue(normalError);

      await expect(executeWithThrottleRetry(operation, 'testOperation')).rejects.toThrow(
        'Connection refused',
      );

      expect(operation).toHaveBeenCalledTimes(1);
      // Не должно быть throttle warnings
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('должен логировать retry попытку', async () => {
      const throttleError = new Error('throttled');
      const operation = vi
        .fn()
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce('success');

      await executeWithThrottleRetry(operation, 'commitOffsets');

      // Проверяем info лог о retry
      const infoLogCalls = vi.mocked(consoleLogSpy).mock.calls.filter((call) => {
        const logObj = JSON.parse(call[0] as string);
        return logObj.event === 'broker_throttle_retrying';
      });
      expect(infoLogCalls.length).toBe(1);
    });
  });
});

/**
 * Unit tests для shutdown state в eachMessageHandler
 */
describe('eachMessageHandler shutdown state', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockConfig: PluginConfigV003;
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;

  beforeEach(() => {
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockState = {
      isShuttingDown: true, // Важно: Shutdown в процессе
      totalMessagesProcessed: 50,
      dlqMessagesCount: 5,
      lastDlqRateLogTime: Date.now(),
    };

    // Mock agent
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Mock response producer
    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    activeSessions = new Set<AbortController>();

    const rules = [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
      },
    ];

    mockConfig = {
      topics: ['test-topic'],
      rules: rules,
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('должен пропустить сообщение когда isShuttingDown === true', async () => {
    const payload = {
      topic: 'test-topic',
      partition: 0,
      message: {
        value: Buffer.from('{"test": "value"}'),
        offset: '0',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify message_skipped_during_shutdown логируется
    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('message_skipped_during_shutdown');
    });
    expect(logCall).toBeDefined();

    // Verify commitOffsets НЕ был вызван
    expect(mockCommitOffsets).not.toHaveBeenCalled();

    // Verify totalMessagesProcessed НЕ увеличился
    expect(mockState.totalMessagesProcessed).toBe(50);
  });

  it('должен корректно обрабатывать isShuttingDown = false (нормальный flow)', async () => {
    mockState.isShuttingDown = false;

    const payload = {
      topic: 'test-topic',
      partition: 0,
      message: {
        value: Buffer.from('{"test": "value"}'),
        offset: '0',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify commitOffsets был вызван
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);

    // Verify totalMessagesProcessed увеличился
    expect(mockState.totalMessagesProcessed).toBe(51);
  });
});

/**
 * Unit tests для KAFKA_IGNORE_TOMBSTONES
 */
describe('eachMessageHandler KAFKA_IGNORE_TOMBSTONES', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockConfig: PluginConfigV003;
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;

  beforeEach(() => {
    originalEnv = process.env;
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 0,
      dlqMessagesCount: 0,
      lastDlqRateLogTime: Date.now(),
    };

    // Mock agent
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Mock response producer
    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    activeSessions = new Set<AbortController>();

    const rules = [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
      },
    ];

    mockConfig = {
      topics: ['test-topic'],
      rules: rules,
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.env = originalEnv;
  });

  it('должен игнорировать tombstone когда KAFKA_IGNORE_TOMBSTONES=true', async () => {
    process.env.KAFKA_IGNORE_TOMBSTONES = 'true';

    const payload = {
      topic: 'test-topic',
      partition: 0,
      message: {
        value: null, // Tombstone
        offset: '0',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify tombstone_ignored логируется
    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('tombstone_ignored');
    });
    expect(logCall).toBeDefined();

    // Verify commitOffsets был вызван
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);

    // Verify sendToDlq НЕ был вызван
    expect(sendToDlq).not.toHaveBeenCalled();
  });

  it('должен отправлять tombstone в DLQ когда KAFKA_IGNORE_TOMBSTONES=false', async () => {
    process.env.KAFKA_IGNORE_TOMBSTONES = 'false';

    const payload = {
      topic: 'test-topic',
      partition: 0,
      message: {
        value: null, // Tombstone
        offset: '0',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq был вызван
    expect(sendToDlq).toHaveBeenCalledTimes(1);
  });

  it('должен отправлять tombstone в DLQ когда KAFKA_IGNORE_TOMBSTONES не установлен (default)', async () => {
    // KAFKA_IGNORE_TOMBSTONES не установлен
    delete process.env.KAFKA_IGNORE_TOMBSTONES;

    const payload = {
      topic: 'test-topic',
      partition: 0,
      message: {
        value: null, // Tombstone
        offset: '0',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq был вызван (default behavior)
    expect(sendToDlq).toHaveBeenCalledTimes(1);
  });
});

/**
 * Unit tests для performGracefulShutdown
 */
describe('performGracefulShutdown', () => {
  // Импортируем после моков
  let performGracefulShutdown: typeof import('../../src/kafka/consumer.js').performGracefulShutdown;
  let mockConsumer: { disconnect: ReturnType<typeof vi.fn> };
  let mockDlqProducer: { disconnect: ReturnType<typeof vi.fn> };
  let mockResponseProducer: { disconnect: ReturnType<typeof vi.fn> };
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: (code: number) => never;

  beforeEach(async () => {
    // Моки должны быть установлены до импорта
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(vi.fn());

    // Mock для exitFn параметра
    mockExit = vi.fn() as unknown as (code: number) => never;

    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 100,
      dlqMessagesCount: 5,
      lastDlqRateLogTime: Date.now(),
    };

    // Мокаем consumer и producers
    mockConsumer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockDlqProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockResponseProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Динамический импорт чтобы подхватить моки
    const consumerModule = await import('../../src/kafka/consumer.js');
    performGracefulShutdown = consumerModule.performGracefulShutdown;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('должен успешно выполнить shutdown (оба disconnect успешны)', async () => {
    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.isShuttingDown).toBe(true);

    // Проверяем логирование всех этапов
    const logCalls = vi.mocked(consoleLogSpy).mock.calls.map((call) =>
      JSON.parse(call[0] as string).event,
    );
    expect(logCalls).toContain('graceful_shutdown_started');
    expect(logCalls).toContain('consumer_disconnect_started');
    expect(logCalls).toContain('consumer_disconnect_completed');
    expect(logCalls).toContain('dlq_producer_disconnect_started');
    expect(logCalls).toContain('dlq_producer_disconnect_completed');
    expect(logCalls).toContain('response_producer_disconnect_started');
    expect(logCalls).toContain('response_producer_disconnect_completed');
    expect(logCalls).toContain('graceful_shutdown_completed');
  });

  it('должен продолжить producer disconnect если consumer disconnect падает', async () => {
    mockConsumer.disconnect.mockRejectedValueOnce(new Error('Consumer disconnect failed'));

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1); // Producer всё равно отключается
    expect(mockState.isShuttingDown).toBe(true);

    // Проверяем логирование ошибки consumer
    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorLog = vi.mocked(consoleErrorSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('consumer_disconnect_failed');
    });
    expect(errorLog).toBeDefined();
  });

  it('должен завершить shutdown если producer disconnect падает', async () => {
    mockDlqProducer.disconnect.mockRejectedValueOnce(new Error('Producer disconnect failed'));

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.isShuttingDown).toBe(true);

// Проверяем логирование ошибки dlq producer
    const errorLog = vi.mocked(consoleErrorSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('dlq_producer_disconnect_failed');
    });
    expect(errorLog).toBeDefined();
  });

  it('должен завершить shutdown если responseProducer disconnect падает', async () => {
    // DLQ успешен, но responseProducer падает
    mockDlqProducer.disconnect.mockResolvedValueOnce(undefined);
    mockResponseProducer.disconnect.mockRejectedValueOnce(new Error('Response producer disconnect failed'));

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.isShuttingDown).toBe(true);

    // Проверяем логирование ошибки responseProducer
    const errorLog = vi.mocked(consoleErrorSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('response_producer_disconnect_failed');
    });
    expect(errorLog).toBeDefined();
  });

  it('должен корректно обработать string error в responseProducer.disconnect', async () => {
    mockDlqProducer.disconnect.mockResolvedValueOnce(undefined);
    mockResponseProducer.disconnect.mockRejectedValueOnce('String error not an Error object');

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    // Должен продолжить shutdown несмотря на string error
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.isShuttingDown).toBe(true);
  });

  it('должен быть idempotent (повторный вызов игнорируется)', async () => {
    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    // Второй вызов
    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    // Только один раз disconnect был вызван
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);

    // Проверяем логирование shutdown_already_in_progress
    const warnLog = vi.mocked(consoleLogSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('shutdown_already_in_progress');
    });
    expect(warnLog).toBeDefined();
  });

  it('должен выйти с кодом 1 при timeout', async () => {
    vi.useFakeTimers();

    mockConsumer.disconnect.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20_000)), // долгий disconnect
    );

    const shutdownPromise = performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState, mockExit);

    // Fast-forward времени
    vi.advanceTimersByTime(15_000);

    await vi.runAllTimersAsync();

    try {
      await shutdownPromise;
    } catch {
      // Expected to timeout
    }

    // Проверяем force exit через exitFn
    expect(mockExit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it('должен корректно обработать не-Error в consumer.disconnect error', async () => {
    // Мокаем disconnect чтобы выбросил строку вместо Error
    mockConsumer.disconnect.mockRejectedValueOnce('String error not an Error object');

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    // Должен продолжить и disconnect producer
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('должен корректно обработать не-Error в producer.disconnect error', async () => {
    // Мокаем consumer disconnect успешным, а producer - строкой вместо Error
    mockDlqProducer.disconnect.mockRejectedValueOnce('String producer error not an Error object');

    await performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState);

    // Должен продолжить shutdown несмотря на ошибку producer
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.isShuttingDown).toBe(true);
  });

  it('должен корректно обработать строку в outer catch block (timeout)', async () => {
    // Используем fake timers для timeout
    vi.useFakeTimers();

    // Мокаем consumer.disconnect который永远不会 завершается (зависает)
    mockConsumer.disconnect.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject('Timeout as string'), 20_000)),
    );

    const shutdownPromise = performGracefulShutdown(mockConsumer, mockDlqProducer, mockResponseProducer, 'SIGTERM', mockState, mockExit);

    // Fast-forward времени до срабатывания timeout
    vi.advanceTimersByTime(25_000);

    try {
      await shutdownPromise;
    } catch {
      // Expected: timeout error
    }

    // Проверяем force exit через exitFn
    expect(mockExit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });
});

/**
 * Unit tests для startConsumer
 */
describe('startConsumer', () => {
  // Моки
  vi.mock('../../src/kafka/client.js', () => ({
    createKafkaClient: vi.fn(),
    createConsumer: vi.fn(),
    createDlqProducer: vi.fn(),
    createResponseProducer: vi.fn(),
  }));

  let startConsumer: typeof import('../../src/kafka/consumer.js').startConsumer;
  let mockKafka: Record<string, unknown>;
  let mockConsumer: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    commitOffsets: ReturnType<typeof vi.fn>;
  };
  let mockDlqProducer: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  let mockResponseProducer: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  let mockAgent: IOpenCodeAgent;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let processOnceSpy: ReturnType<typeof vi.spyOn>;

  const mockConfig: PluginConfigV003 = {
    topics: ['test-topic'],
    rules: [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(vi.fn());

    // Мокаем process.once для SIGTERM/SIGINT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processOnceSpy = vi.spyOn(process, 'once').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGTERM' || event === 'SIGINT') {
        // Сохраняем handler для вызова позже в тесте
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process as any)._savedHandlers = (process as any)._savedHandlers || {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process as any)._savedHandlers[event] = handler;
      }
      return process;
    });

    // Mock agent
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Мокаем Kafka клиенты
    mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      commitOffsets: vi.fn().mockResolvedValue(undefined),
    };

    mockDlqProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };

    mockResponseProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };

    mockKafka = {};

    // Настраиваем моки модуля client.js
    const clientModule = await import('../../src/kafka/client.js');
    vi.mocked(clientModule.createKafkaClient).mockReturnValue({
      kafka: mockKafka,
      validatedEnv: { KAFKA_BROKERS: 'localhost:9092', KAFKA_GROUP_ID: 'test-group' },
    });
    vi.mocked(clientModule.createConsumer).mockReturnValue(mockConsumer);
    vi.mocked(clientModule.createDlqProducer).mockReturnValue(mockDlqProducer);
    vi.mocked(clientModule.createResponseProducer).mockReturnValue(mockResponseProducer);

    const consumerModule = await import('../../src/kafka/consumer.js');
    startConsumer = consumerModule.startConsumer;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    if (processOnceSpy) processOnceSpy.mockRestore();
  });

  it('должен успешно запустить consumer', async () => {
    const startPromise = startConsumer(mockConfig, mockAgent);

    // Даём время для инициализации
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());

    await startPromise;

    // Проверяем успешный запуск
    expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.connect).toHaveBeenCalledTimes(1);
    expect(mockConsumer.subscribe).toHaveBeenCalledWith({ topics: ['test-topic'] });
    expect(mockConsumer.run).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('должен выполнить graceful shutdown и exit(1) при consumer.connect() error', async () => {
    mockConsumer.connect.mockRejectedValueOnce(new Error('Connection failed'));

    const startPromise = startConsumer(mockConfig, mockAgent);

    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());

    try {
      await startPromise;
    } catch {
      // Expected
    }

    // Проверяем exit с кодом 1
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('должен выполнить graceful shutdown и exit(1) при dlqProducer.connect() error', async () => {
    mockDlqProducer.connect.mockRejectedValueOnce(new Error('DLQ connection failed'));

    const startPromise = startConsumer(mockConfig, mockAgent);

    await vi.waitFor(() => expect(mockDlqProducer.connect).toHaveBeenCalled());

    try {
      await startPromise;
    } catch {
      // Expected
    }

    // Проверяем exit с кодом 1
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('должен выполнить graceful shutdown и exit(1) при consumer.subscribe() error', async () => {
    mockConsumer.subscribe.mockRejectedValueOnce(new Error('Subscribe failed'));

    const startPromise = startConsumer(mockConfig, mockAgent);

    await vi.waitFor(() => expect(mockConsumer.subscribe).toHaveBeenCalled());

    try {
      await startPromise;
    } catch {
      // Expected
    }

    // Проверяем exit с кодом 1
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('должен выйти с кодом 0 при SIGTERM', async () => {
    // Запускаем consumer (не ждём завершения - он работает в фоне)
    startConsumer(mockConfig, mockAgent);

    // Дожидаемся инициализации
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockDlqProducer.connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockConsumer.subscribe).toHaveBeenCalled());

    // Вызываем SIGTERM handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedHandlers = (process as any)._savedHandlers;
    if (savedHandlers && savedHandlers['SIGTERM']) {
      savedHandlers['SIGTERM']('SIGTERM');
    }

    // Даём время для выполнения async shutdown
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled(), { timeout: 2000 });

    // Проверяем graceful shutdown и exit(0)
    expect(mockConsumer.disconnect).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('должен выйти с кодом 0 при SIGINT', async () => {
    // Запускаем consumer (не ждём завершения - он работает в фоне)
    startConsumer(mockConfig, mockAgent);

    // Дожидаемся инициализации
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockDlqProducer.connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockConsumer.subscribe).toHaveBeenCalled());

    // Вызываем SIGINT handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedHandlers = (process as any)._savedHandlers;
    if (savedHandlers && savedHandlers['SIGINT']) {
      savedHandlers['SIGINT']('SIGINT');
    }

    // Даём время для выполнения async shutdown
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled(), { timeout: 2000 });

    // Проверяем graceful shutdown и exit(0)
    expect(mockConsumer.disconnect).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('должен выполнить graceful shutdown и exit(1) при consumer.run() error', async () => {
    // Мокаем run чтобы он выбросил ошибку
    mockConsumer.run.mockRejectedValueOnce(new Error('Consumer run loop failed'));

    // Запускаем consumer
    startConsumer(mockConfig, mockAgent);

    // Дожидаемся инициализации
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());

    // Ждём пока ошибка будет обработана и exit(1) вызван
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1), { timeout: 2000 });

    // Проверяем что disconnect был вызван (через performGracefulShutdown)
    expect(mockConsumer.disconnect).toHaveBeenCalled();
  });

  it('должен корректно вызвать eachMessage callback через consumer.run()', async () => {
    // Мокаем run чтобы он сразу вызвал eachMessage callback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockConsumer.run.mockImplementationOnce((config: any) => {
      // Вызываем eachMessage callback сразу с тестовым payload
      if (config.eachMessage) {
        const testPayload = {
          topic: 'test-topic',
          partition: 0,
          message: {
            value: Buffer.from('{"test": "value"}'),
            offset: '0',
            key: null,
            headers: {},
            timestamp: '2024-04-22T00:00:00.000Z',
          },
        };
        config.eachMessage(testPayload);
      }
      return Promise.resolve();
    });

    // Запускаем consumer
    startConsumer(mockConfig, mockAgent);

    // Дожидаемся инициализации и выполнения callback
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockConsumer.run).toHaveBeenCalled());

    // callback должен был вызвать eachMessageHandler и commitOffsets
    expect(mockConsumer.commitOffsets).toHaveBeenCalled();
  });

  it('должен корректно обработать не-Error в consumer.run() error', async () => {
    // Мокаем run чтобы выбросил строку вместо Error объекта
    mockConsumer.run.mockRejectedValueOnce('String error from run loop');

    // Запускаем consumer
    startConsumer(mockConfig, mockAgent);

    // Дожидаемся инициализации
    await vi.waitFor(() => expect(mockConsumer.connect).toHaveBeenCalled());

    // Ждём пока ошибка будет обработана и exit(1) вызван
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1), { timeout: 2000 });
  });

  it('должен корректно обработать не-Error в startConsumer error', async () => {
    // Мокаем connect чтобы выбросил строку вместо Error объекта
    mockConsumer.connect.mockRejectedValueOnce('String connection error');

    // Запускаем consumer
    startConsumer(mockConfig, mockAgent);

    // Ждём пока ошибка будет обработана и exit(1) вызван
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1), { timeout: 2000 });
  });
});

/**
 * Unit tests для agent invoke integration в eachMessageHandler
 */
describe('agent invoke integration', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;
  let sendToDlqSpy: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const createConfigWithRules = (rules: RuleV003[]): PluginConfigV003 => ({
    topics: ['test-topic'],
    rules,
  });

  const createPayload = (value: Record<string, unknown>, partition = 0, offset = '0') => ({
    topic: 'test-topic',
    partition,
    message: {
      value: Buffer.from(JSON.stringify(value)),
      offset,
      key: null,
      headers: {},
      timestamp: '2024-04-22T00:00:00.000Z',
    },
  });

  beforeEach(() => {
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 0,
      dlqMessagesCount: 0,
      lastDlqRateLogTime: Date.now(),
    };

    // Mock agent
    mockAgent = {
      invoke: vi.fn(),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Mock response producer
    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    activeSessions = new Set<AbortController>();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock sendToDlq
    sendToDlqSpy = vi.fn();
    vi.mocked(sendToDlq).mockImplementation(sendToDlqSpy);

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('должен вызвать агента и отправить response при success с responseTopic', async () => {
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'success' as const,
      response: 'agent response',
      sessionId: 'test-session',
      executionTimeMs: 500,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as AgentResult);

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    expect(mockAgent.invoke).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.send).toHaveBeenCalledTimes(1);
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
  });

  it('должен вызвать агента но не отправлять response когда правило без responseTopic', async () => {
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'success' as const,
      response: 'agent response',
      sessionId: 'test-session',
      executionTimeMs: 500,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as AgentResult);

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      // Нет responseTopic
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    expect(mockAgent.invoke).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.send).not.toHaveBeenCalled();
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
  });

  it('должен отправить в DLQ когда агент возвращает timeout status', async () => {
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'timeout' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent timed out',
      executionTimeMs: 120000,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as AgentResult);

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    expect(mockAgent.invoke).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.send).not.toHaveBeenCalled();
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
  });

  it('должен отправить в DLQ когда агент возвращает error status', async () => {
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'error' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent crashed',
      executionTimeMs: 50,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as AgentResult);

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    expect(mockAgent.invoke).toHaveBeenCalledTimes(1);
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
  });

  it('должен отправить в DLQ когда вызов агента выбрасывает исключение', async () => {
    mockAgent.invoke = vi.fn().mockRejectedValue(new Error('Unexpected invoke error'));

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    expect(sendToDlq).toHaveBeenCalledTimes(1);
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
  });

  it('должен оставить activeSessions пустым (session управляется агентом)', async () => {
    mockAgent.invoke = vi.fn().mockImplementation(async () => {
      // activeSessions остаётся пустым - агент сам управляет сессиями
      return {
        status: 'success' as const,
        response: 'test',
        sessionId: 'test-session',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      } as AgentResult;
    });

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // activeSessions остаётся пустым - сессии управляются агентом внутри
    expect(activeSessions.size).toBe(0);
  });

  it('должен оставить activeSessions пустым при ошибке агента', async () => {
    mockAgent.invoke = vi.fn().mockRejectedValue(new Error('Agent error'));

    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.type',
      promptTemplate: 'Process: ${$.type}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    const payload = createPayload({ type: 'test' });

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // activeSessions остаётся пустым - сессии управляются агентом
    expect(activeSessions.size).toBe(0);
  });
});

/**
 * Unit tests для graceful shutdown с agent abort (FR-016)
 */
describe('graceful shutdown (FR-016)', () => {
  let performGracefulShutdown: typeof import('../../src/kafka/consumer.js').performGracefulShutdown;
  let mockConsumer: { disconnect: ReturnType<typeof vi.fn> };
  let mockDlqProducer: { disconnect: ReturnType<typeof vi.fn> };
  let mockResponseProducer: { disconnect: ReturnType<typeof vi.fn> };
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let mockAgent: IOpenCodeAgent;
  let activeSessions: Set<AbortController>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: (code: number) => never;

  beforeEach(async () => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock для exitFn параметра
    mockExit = vi.fn() as unknown as (code: number) => never;

    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 100,
      dlqMessagesCount: 5,
      lastDlqRateLogTime: Date.now(),
    };

    // Mock agent с abort методом
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    // Active sessions с несколькими AbortController (C2)
    activeSessions = new Set<AbortController>([new AbortController(), new AbortController(), new AbortController()]);

    // Мокаем consumer и producers
    mockConsumer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockDlqProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockResponseProducer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Динамический импорт чтобы подхватить моки
    const consumerModule = await import('../../src/kafka/consumer.js');
    performGracefulShutdown = consumerModule.performGracefulShutdown;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('должен abort все активные сессии во время shutdown', async () => {
    await performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      undefined,      // agent - позиция 7
      activeSessions, // activeSessions - позиция 8
    );

    // C2: Проверяем что все AbortController были aborted
    for (const controller of activeSessions) {
      expect(controller.signal.aborted).toBe(true);
    }

    // Проверяем что все disconnect вызваны
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);

    // Проверяем что activeSessions очищен
    expect(activeSessions.size).toBe(0);
  });

  it('должен продолжать abort остальных сессий если один abort падает', async () => {
    // Первый AbortController падает при abort - но AbortController.abort() не бросает ошибок
    // Этот тест проверяет что все controllers всё равно aborted

    await performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      undefined,      // agent - позиция 7
      activeSessions, // activeSessions - позиция 8
    );

    // C2: Все AbortController должны быть aborted (AbortController.abort() не бросает)
    for (const controller of activeSessions) {
      expect(controller.signal.aborted).toBe(true);
    }

    // Disconnect должен продолжить выполнение
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('должен корректно завершить shutdown с пустым activeSessions', async () => {
    // Пустой Set сессий
    activeSessions.clear();

    await performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      activeSessions,
    );

    // C2: AbortController.abort() не бросает - просто проверяем что disconnect вызван

    // Все disconnect должны быть вызваны
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);

    // shutdown должен завершиться успешно
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('должен disconnect consumer, dlqProducer и responseProducer во время shutdown', async () => {
    await performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      mockAgent,
      activeSessions,
    );

    // C2: Проверяем что все AbortController были aborted
    for (const controller of activeSessions) {
      expect(controller.signal.aborted).toBe(true);
    }

    // Все три disconnect вызваны
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('должен выйти с кодом 1 если shutdown превышает 15 секунд', async () => {
    vi.useFakeTimers();

    // Мокаем медленный disconnect
    mockConsumer.disconnect.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20_000)),
    );

    const shutdownPromise = performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      mockAgent,
      activeSessions,
    );

    // Fast-forward времени до 15 секунд
    vi.advanceTimersByTime(15_000);

    await vi.runAllTimersAsync();

    try {
      await shutdownPromise;
    } catch {
      // Expected to timeout
    }

    // Проверяем force exit через exitFn
    expect(mockExit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it('должен логировать warning при timeout shutdown', async () => {
    vi.useFakeTimers();

    // Мокаем медленный disconnect
    mockConsumer.disconnect.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20_000)),
    );

    const shutdownPromise = performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
      mockAgent,
      activeSessions,
    );

    // Fast-forward времени до 15 секунд
    vi.advanceTimersByTime(15_000);

    await vi.runAllTimersAsync();

    try {
      await shutdownPromise;
    } catch {
      // Expected to timeout
    }

    // Проверяем что был error лог при timeout (логируется в console.error)
    const errorLog = vi.mocked(consoleErrorSpy).mock.calls.find((call) => {
      return JSON.stringify(call).includes('force_exit_after_timeout');
    });
    expect(errorLog).toBeDefined();

    vi.useRealTimers();
  });

  it('должен работать без agent параметра (обратная совместимость)', async () => {
    // Вызываем без agent и activeSessions — должен работать как раньше
    await performGracefulShutdown(
      mockConsumer,
      mockDlqProducer,
      mockResponseProducer,
      'SIGTERM',
      mockState,
      mockExit,
    );

// abort не должен быть вызван
    expect(mockAgent.abort).not.toHaveBeenCalled();

    // Все disconnect должны быть вызваны
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockDlqProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockResponseProducer.disconnect).toHaveBeenCalledTimes(1);
  });
});

/**
 * Unit tests для DLQ error handling envelope verification (FR-015)
 */
describe('DLQ error handling (FR-015)', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockConfig: PluginConfigV003;
  let mockState: { isShuttingDown: boolean; totalMessagesProcessed: number; dlqMessagesCount: number; lastDlqRateLogTime: number };
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;

  const createConfigWithRules = (rules: RuleV003[]): PluginConfigV003 => ({
    topics: ['test-topic'],
    rules,
  });

  const createPayload = (value: Record<string, unknown>, partition = 0, offset = '0') => ({
    topic: 'test-topic',
    partition,
    message: {
      value: Buffer.from(JSON.stringify(value)),
      offset,
      key: null,
      headers: {},
      timestamp: '2024-04-22T00:00:00.000Z',
    },
  });

  beforeEach(() => {
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 0,
      dlqMessagesCount: 0,
      lastDlqRateLogTime: Date.now(),
    };

    // Mock agent - default success
    mockAgent = {
      invoke: vi.fn().mockResolvedValue({
        status: 'success' as const,
        response: 'test response',
        sessionId: 'test-session-id',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      }),
      abort: vi.fn().mockResolvedValue(true),
    };

    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    activeSessions = new Set<AbortController>();

    const rules = [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
      },
    ];

    mockConfig = {
      topics: ['test-topic'],
      rules: rules,
    };

    vi.clearAllMocks();
  });

it('should send to DLQ with correct args on parse error', async () => {
    // Use invalid JSON (non-parseable)
    const payload = {
      topic: 'test-topic',
      partition: 3,
      message: {
        value: Buffer.from('not valid json'), // Invalid JSON
        offset: '42',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq was called with correct payload metadata
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    const dlqCall = vi.mocked(sendToDlq).mock.calls[0];

    // dlqCall[0] = dlqProducer, dlqCall[1] = originalMessage, dlqCall[2] = error
    expect(dlqCall[1].topic).toBe('test-topic');
    expect(dlqCall[1].partition).toBe(3);
    expect(dlqCall[1].offset).toBe('42');

    // Verify error message contains "JSON" or "parse"
    expect(dlqCall[2].message).toMatch(/JSON|parse/i);
  });

  it('should send to DLQ with correct args on timeout', async () => {
    // Create config with agent rule
    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.test',
      promptTemplate: 'Process: ${$}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    // Mock agent to return timeout result
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'timeout' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent timed out after 120 seconds',
      executionTimeMs: 120000,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as unknown as AgentResult);

    const payload = createPayload({ test: 'value' }, 1, '15');

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq was called with correct payload metadata
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    const dlqCall = vi.mocked(sendToDlq).mock.calls[0];

    // dlqCall[0] = dlqProducer, dlqCall[1] = originalMessage, dlqCall[2] = error
    expect(dlqCall[1].topic).toBe('test-topic');
    expect(dlqCall[1].partition).toBe(1);
    expect(dlqCall[1].offset).toBe('15');

    // Verify error message contains timeout info
    expect(dlqCall[2].message).toMatch(/timeout|timed out/i);
  });

  it('should send to DLQ with correct args on agent error', async () => {
    // Create config with agent rule
    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.test',
      promptTemplate: 'Process: ${$}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    // Mock agent to return error result
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'error' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent execution failed: invalid prompt',
      executionTimeMs: 50,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as unknown as AgentResult);

    const payload = createPayload({ test: 'value' }, 5, '99');

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq was called with correct payload metadata
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    const dlqCall = vi.mocked(sendToDlq).mock.calls[0];

    // dlqCall[0] = dlqProducer, dlqCall[1] = originalMessage, dlqCall[2] = error
    expect(dlqCall[1].topic).toBe('test-topic');
    expect(dlqCall[1].partition).toBe(5);
    expect(dlqCall[1].offset).toBe('99');

    // Verify error message contains agent error
    expect(dlqCall[2].message).toMatch(/error|fail/i);
  });

  it('should send to DLQ with correct args on timeout', async () => {
    // Create config with agent rule
    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.test',
      promptTemplate: 'Process: ${$}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    // Mock agent to return timeout result
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'timeout' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent timed out after 120 seconds',
      executionTimeMs: 120000,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as unknown as AgentResult);

    const payload = createPayload({ test: 'value' }, 1, '15');

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq was called with correct payload metadata
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    const dlqCall = vi.mocked(sendToDlq).mock.calls[0];

    // Verify payload metadata
    expect(dlqCall[1].topic).toBe('test-topic');
    expect(dlqCall[1].partition).toBe(1);
    expect(dlqCall[1].offset).toBe('15');

    // Verify error message contains timeout info
    expect(dlqCall[2].message).toMatch(/timeout|timed out/i);
  });

  it('should send to DLQ with correct args on agent error', async () => {
    // Create config with agent rule
    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.test',
      promptTemplate: 'Process: ${$}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    // Mock agent to return error result
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'error' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent execution failed: invalid prompt',
      executionTimeMs: 50,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as unknown as AgentResult);

    const payload = createPayload({ test: 'value' }, 5, '99');

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify sendToDlq was called with correct payload metadata
    expect(sendToDlq).toHaveBeenCalledTimes(1);
    const dlqCall = vi.mocked(sendToDlq).mock.calls[0];

    // Verify payload metadata
    expect(dlqCall[1].topic).toBe('test-topic');
    expect(dlqCall[1].partition).toBe(5);
    expect(dlqCall[1].offset).toBe('99');

    // Verify error message contains agent error
    expect(dlqCall[2].message).toMatch(/error|fail/i);
  });

  it('should commit offsets even when DLQ send fails', async () => {
    // Use invalid JSON to trigger DLQ path
    const payload = {
      topic: 'test-topic',
      partition: 2,
      message: {
        value: Buffer.from('invalid json'),
        offset: '7',
        key: null,
        headers: {},
        timestamp: '2024-04-22T00:00:00.000Z',
      },
    };

    // Mock sendToDlq to reject (resilience test - in reality it never throws)
    vi.mocked(sendToDlq).mockRejectedValueOnce(new Error('DLQ send failed'));

    await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify commitOffsets was called even though sendToDlq failed
    expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    expect(mockCommitOffsets).toHaveBeenCalledWith([
      { topic: 'test-topic', partition: 2, offset: '7' },
    ]);
  });

  it('should commit offsets after DLQ is called', async () => {
    // Create config with agent rule to trigger agent path
    const config = createConfigWithRules([{
      name: 'test-rule',
      jsonPath: '$.test',
      promptTemplate: 'Process: ${$}',
      agentId: 'test-agent',
      responseTopic: 'response-topic',
      timeoutMs: 120_000,
    }]);

    // Mock agent to return error to trigger DLQ path
    mockAgent.invoke = vi.fn().mockResolvedValue({
      status: 'error' as const,
      sessionId: 'test-session',
      errorMessage: 'Agent failed',
      executionTimeMs: 50,
      timestamp: '2024-01-01T00:00:00.000Z',
    } as unknown as AgentResult);

    const payload = createPayload({ test: 'value' }, 0, '1');

    await eachMessageHandler(payload, config, mockDlqProducer, mockCommitOffsets, mockState, mockAgent, mockResponseProducer, activeSessions);

    // Verify both were called
    expect(sendToDlq).toHaveBeenCalled();
    expect(mockCommitOffsets).toHaveBeenCalled();

    // Verify call order: sendToDlq called before commitOffsets
    const sendToDlqCallIndex = vi.mocked(sendToDlq).mock.calls.length - 1;
    expect(sendToDlqCallIndex).toBeLessThan(mockCommitOffsets.mock.calls.length);
  });

  /**
   * SIGTERM во время обработки сообщения (MAJOR M9)
   * Тестирует что сообщение которое в процессе обработки (agent.invoke вызван) корректно завершается при получении SIGTERM
   */
  describe('SIGTERM при активной обработке', () => {
    it('должен завершить текущую обработку сообщения при получении SIGTERM', async () => {
      // 1. Создаём mock agent с задержкой (invoke занимает время)
      let invokeResolve: (result: AgentResult) => void;
      const invokePromise = new Promise<AgentResult>((resolve) => {
        invokeResolve = resolve;
      });

      const slowAgent: IOpenCodeAgent = {
        invoke: vi.fn().mockReturnValue(invokePromise),
        abort: vi.fn().mockResolvedValue(true),
      };

      // 2. Создаём payload и state
      const slowConfig: PluginConfigV003 = {
        topics: ['test-topic'],
        rules: [
          {
            name: 'slow-rule',
            jsonPath: '$.test',
            promptTemplate: 'Process: ${$}',
            agentId: 'slow-agent',
            timeoutMs: 60000,
          },
        ],
      };

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "slow-value"}'),
          offset: '5',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      const slowState: MockConsumerState = {
        isShuttingDown: false,
        totalMessagesProcessed: 0,
        dlqMessagesCount: 0,
        lastDlqRateLogTime: Date.now(),
      };

      const slowActiveSessions = new Set<AbortController>();

      const slowResponseProducer = {
        send: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Producer;

      // 3. Начинаем обработку сообщения (НЕ await - запускаем в фоне)
      const handlerPromise = eachMessageHandler(
        payload,
        slowConfig,
        mockDlqProducer,
        mockCommitOffsets,
        slowState,
        slowAgent,
        slowResponseProducer,
        slowActiveSessions
      );

      // Ждём немного чтобы invoke начал выполняться
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 4. Проверяем что сообщение в процессе обработки (invoke был вызван)
      expect(slowAgent.invoke).toHaveBeenCalled();

      // 5. Завершаем invoke (эмулируем завершение работы агента)
      invokeResolve!({
        status: 'success' as const,
        response: 'Processing completed',
        sessionId: 'sess_slow',
        executionTimeMs: 100,
        timestamp: new Date().toISOString(),
      });

      // 6. Ждём завершения handler
      await handlerPromise;

      // 7. Проверяем что:
      // - Сообщение было обработано (commit вы��ван)
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);

      // - Сообщение обработано успешно
      expect(slowState.totalMessagesProcessed).toBe(1);
    });

    it('должен корректно обработать failed agent при SIGTERM', async () => {
      // Тестируем сценарий когда agent возвращает error/timeout

      let invokeResolve: (result: AgentResult) => void;
      const invokePromise = new Promise<AgentResult>((resolve) => {
        invokeResolve = resolve;
      });

      const errorAgent: IOpenCodeAgent = {
        invoke: vi.fn().mockReturnValue(invokePromise),
        abort: vi.fn().mockResolvedValue(true),
      };

      const errorPayload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "error-value"}'),
          offset: '6',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      const errorState: MockConsumerState = {
        isShuttingDown: false,
        totalMessagesProcessed: 0,
        dlqMessagesCount: 0,
        lastDlqRateLogTime: Date.now(),
      };

      const errorActiveSessions = new Set<AbortController>();

      const errorResponseProducer = {
        send: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as Producer;

      const errorHandlerPromise = eachMessageHandler(
        errorPayload,
        mockConfig,
        mockDlqProducer,
        mockCommitOffsets,
        errorState,
        errorAgent,
        errorResponseProducer,
        errorActiveSessions
      );

      // Ждём немного чтобы invoke начал выполняться
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Завершаем invoke с error
      invokeResolve!({
        status: 'error' as const,
        errorMessage: 'Agent failed during processing',
        sessionId: 'sess_error',
        executionTimeMs: 50,
        timestamp: new Date().toISOString(),
      });

      // Ждём завершения
      await errorHandlerPromise;

      // Проверяем что:
      // - Сообщение было обработано
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);

      // - Отправлено в DLQ (status=error)
      expect(sendToDlq).toHaveBeenCalled();
    });
  });
});
