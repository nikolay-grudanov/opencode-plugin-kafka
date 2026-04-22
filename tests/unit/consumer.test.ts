/**
 * Unit tests for eachMessageHandler
 * @fileoverview Tests for sequential message processing with DLQ support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eachMessageHandler } from '../../src/kafka/consumer.js';
import type { PluginConfigV003, RuleV003 } from '../../src/schemas/index.js';
import type { Producer } from 'kafkajs';

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
  let rules: RuleV003[];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Setup mocks
    mockDlqProducer = {} as Producer;
    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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
      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

      // Verify sendToDlq был вызван (из-за ошибки в commitOffsets)
      expect(sendToDlq).toHaveBeenCalledTimes(1);

      // Verify error mentions "Unexpected error"
      const dlqCall = vi.mocked(sendToDlq).mock.calls[0];
      expect(dlqCall[2].message).toContain('Unexpected error');
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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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
        await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);
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
        await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);
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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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

      await eachMessageHandler(payload, mockConfig, mockDlqProducer, mockCommitOffsets);

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
