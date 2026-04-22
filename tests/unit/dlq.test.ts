/**
 * Unit tests для sendToDlq()
 * Test-First Development: Tests для DLQ functionality
 * @fileoverview Tests for sendToDlq function with producer mocking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendToDlq } from '../../src/kafka/dlq.js';
import type { Producer } from 'kafkajs';

describe('sendToDlq', () => {
  let mockProducer: Producer;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Сохраняем оригинальные переменные окружения
    originalEnv = { ...process.env };

    // Создаем mock producer
    mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    // Spy на console.log и console.error
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Восстанавливаем оригинальные переменные окружения
    process.env = originalEnv;
    // Восстанавливаем console.log и console.error
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('DLQ envelope содержит все required fields', () => {
    it('должен создать DLQ envelope со всеми обязательными полями', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      // Verify producer.send был вызван
      expect(mockProducer.send).toHaveBeenCalledTimes(1);
      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем структуру DLQ envelope
      expect(record.topic).toBeDefined();
      expect(record.messages).toBeDefined();
      expect(record.messages).toHaveLength(1);

      // Парсим envelope из сообщения
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем все required fields
      expect(envelope).toHaveProperty('originalValue');
      expect(envelope).toHaveProperty('topic');
      expect(envelope).toHaveProperty('partition');
      expect(envelope).toHaveProperty('offset');
      expect(envelope).toHaveProperty('errorMessage');
      expect(envelope).toHaveProperty('failedAt');

      // Проверяем значения
      expect(envelope.originalValue).toBe('{"test": "value"}');
      expect(envelope.topic).toBe('test-topic');
      expect(envelope.partition).toBe(0);
      expect(envelope.offset).toBe('42');
      expect(envelope.errorMessage).toBe('Test error');
    });

    it('должен корректно обрабатывать null originalValue (tombstone)', async () => {
      const originalMessage = {
        value: null,
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Tombstone message');

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем что originalValue может быть null
      expect(envelope.originalValue).toBeNull();
    });

    it('должен корректно обрабатывать offset как number', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: 123456789012, // Large number as number type
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем что offset конвертирован в string
      expect(typeof envelope.offset).toBe('string');
      expect(envelope.offset).toBe('123456789012');
    });
  });

  describe('DLQ topic defaults to {original-topic}-dlq', () => {
    it('должен использовать {original-topic}-dlq по умолчанию', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      // Удаляем KAFKA_DLQ_TOPIC если установлен
      delete process.env.KAFKA_DLQ_TOPIC;

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что DLQ topic = {original-topic}-dlq
      expect(record.topic).toBe('my-topic-dlq');
    });

    it('должен поддерживать разные форматы имен топиков', async () => {
      const testCases = [
        { topic: 'simple', expectedDlq: 'simple-dlq' },
        { topic: 'my-topic-with-dashes', expectedDlq: 'my-topic-with-dashes-dlq' },
        { topic: 'my.topic.with.dots', expectedDlq: 'my.topic.with.dots-dlq' },
        { topic: 'MyTopicCamelCase', expectedDlq: 'MyTopicCamelCase-dlq' },
      ];

      for (const testCase of testCases) {
        // Reset mock
        vi.mocked(mockProducer.send).mockClear();

        const originalMessage = {
          value: '{"test": "value"}',
          topic: testCase.topic,
          partition: 0,
          offset: '42',
        };
        const error = new Error('Test error');

        delete process.env.KAFKA_DLQ_TOPIC;

        await sendToDlq(mockProducer, originalMessage, error);

        const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
        expect(sendCall[0].topic).toBe(testCase.expectedDlq);
      }
    });
  });

  describe('Custom KAFKA_DLQ_TOPIC used when set', () => {
    it('должен использовать KAFKA_DLQ_TOPIC когда переменная установлена', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      // Устанавливаем custom DLQ topic
      process.env.KAFKA_DLQ_TOPIC = 'custom-dlq-topic';

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что используется custom DLQ topic
      expect(record.topic).toBe('custom-dlq-topic');
    });

    it('должен использовать custom DLQ topic даже если он не соответствует {topic}-dlq формату', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      process.env.KAFKA_DLQ_TOPIC = 'completely-different-dlq-name';

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      expect(sendCall[0].topic).toBe('completely-different-dlq-name');
    });

    it('должен поддерживать complex topic names в KAFKA_DLQ_TOPIC', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      process.env.KAFKA_DLQ_TOPIC = 'production.dlq.failures.v1';

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      expect(sendCall[0].topic).toBe('production.dlq.failures.v1');
    });
  });

  describe('sendToDlq never throws', () => {
    it('должен перехватывать ошибку Producer.send() и не бросать исключение', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      // Mock Producer.send() to throw error
      vi.mocked(mockProducer.send).mockRejectedValueOnce(
        new Error('Kafka connection failed')
      );

      // sendToDlq НЕ должен бросать исключение
      await expect(
        sendToDlq(mockProducer, originalMessage, error)
      ).resolves.not.toThrow();
    });

    it('должен логировать ошибку при Producer.send() failure', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      const kafkaError = new Error('Kafka connection failed');
      vi.mocked(mockProducer.send).mockRejectedValueOnce(kafkaError);

      await sendToDlq(mockProducer, originalMessage, error);

      // Проверяем что console.error был вызван
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const errorLog = vi.mocked(consoleErrorSpy).mock.calls[0][0];

      // Проверяем структуру error log
      const parsedErrorLog = JSON.parse(errorLog);
      expect(parsedErrorLog).toHaveProperty('level');
      expect(parsedErrorLog).toHaveProperty('event');
      expect(parsedErrorLog).toHaveProperty('sendError');
      expect(parsedErrorLog.level).toBe('error');
      expect(parsedErrorLog.event).toBe('dlq_send_failed');
      expect(parsedErrorLog.sendError).toBe('Kafka connection failed');
      expect(parsedErrorLog.originalTopic).toBe('test-topic');
      expect(parsedErrorLog.partition).toBe(0);
      expect(parsedErrorLog.offset).toBe('42');
    });

    it('должен логировать правильную оригинальную ошибку при Producer.send() failure', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const originalError = new Error('Original processing error');

      const kafkaError = new Error('Kafka connection failed');
      vi.mocked(mockProducer.send).mockRejectedValueOnce(kafkaError);

      await sendToDlq(mockProducer, originalMessage, originalError);

      const errorLog = vi.mocked(consoleErrorSpy).mock.calls[0][0];
      const parsedErrorLog = JSON.parse(errorLog);

      // Проверяем что original error logged correctly
      expect(parsedErrorLog.errorMessage).toBe('Original processing error');
    });

    it('должен логировать timestamp при Producer.send() failure', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      const kafkaError = new Error('Kafka connection failed');
      vi.mocked(mockProducer.send).mockRejectedValueOnce(kafkaError);

      const beforeCall = Date.now();
      await sendToDlq(mockProducer, originalMessage, error);
      const afterCall = Date.now();

      const errorLog = vi.mocked(consoleErrorSpy).mock.calls[0][0];
      const parsedErrorLog = JSON.parse(errorLog);

      // Проверяем что failedAt валидный ISO timestamp в разумном временном окне
      expect(parsedErrorLog).toHaveProperty('failedAt');
      const failedAtDate = new Date(parsedErrorLog.failedAt);
      expect(failedAtDate.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(failedAtDate.getTime()).toBeLessThanOrEqual(afterCall + 1000);
    });

    it('должен корректно обрабатывать не-Error объект при Producer.send() failure', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      // Mock Producer.send() to throw non-Error object
      vi.mocked(mockProducer.send).mockRejectedValueOnce('String error');

      await sendToDlq(mockProducer, originalMessage, error);

      // Проверяем что console.error был вызван
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const errorLog = vi.mocked(consoleErrorSpy).mock.calls[0][0];
      const parsedErrorLog = JSON.parse(errorLog);

      // Проверяем что sendError конвертирован в string
      expect(parsedErrorLog.sendError).toBe('String error');
    });
  });

  describe('Key format is ${topic}-${partition}-${offset}', () => {
    it('должен использовать key в формате ${topic}-${partition}-${offset}', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 2,
        offset: '789',
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const message = sendCall[0].messages[0];

      // Проверяем формат key
      expect(message.key).toBe('my-topic-2-789');
    });

    it('должен корректно формировать key с number offset', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my-topic',
        partition: 1,
        offset: 456, // offset как number
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const message = sendCall[0].messages[0];

      // Проверяем что offset корректно конвертирован в string в key
      expect(message.key).toBe('my-topic-1-456');
    });

    it('должен поддерживать topic с спецсимволами', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'my_topic.with.dashes-dots',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const message = sendCall[0].messages[0];

      expect(message.key).toBe('my_topic.with.dashes-dots-0-42');
    });
  });

  describe('failedAt is ISO 8601 timestamp', () => {
    it('должен использовать ISO 8601 формат для failedAt', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      const beforeCall = Date.now();
      await sendToDlq(mockProducer, originalMessage, error);
      const afterCall = Date.now();

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем что failedAt валидный ISO timestamp
      const failedAtDate = new Date(envelope.failedAt);
      expect(failedAtDate.toISOString()).toBe(envelope.failedAt);

      // Проверяем что timestamp в разумном временном окне
      expect(failedAtDate.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(failedAtDate.getTime()).toBeLessThanOrEqual(afterCall + 1000);
    });

    it('должен генерировать уникальный timestamp для каждого вызова', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      // Вызываем sendToDlq несколько раз с задержкой
      const timestamps: string[] = [];
      for (let i = 0; i < 3; i++) {
        await sendToDlq(mockProducer, originalMessage, error);
        const sendCall = vi.mocked(mockProducer.send).mock.calls[i];
        const envelope = JSON.parse(sendCall[0].messages[0].value as string);
        timestamps.push(envelope.failedAt);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Проверяем что все timestamps разные
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBe(3);
    });
  });

  describe('console.log called on success', () => {
    it('должен логировать успешную отправку в DLQ', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      await sendToDlq(mockProducer, originalMessage, error);

      // Проверяем что console.log был вызван
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const log = vi.mocked(consoleLogSpy).mock.calls[0][0];

      // Проверяем структуру success log
      const parsedLog = JSON.parse(log);
      expect(parsedLog).toHaveProperty('level');
      expect(parsedLog).toHaveProperty('event');
      expect(parsedLog).toHaveProperty('topic');
      expect(parsedLog).toHaveProperty('originalTopic');
      expect(parsedLog).toHaveProperty('partition');
      expect(parsedLog).toHaveProperty('offset');
      expect(parsedLog).toHaveProperty('errorMessage');
      expect(parsedLog).toHaveProperty('failedAt');

      // Проверяем значения
      expect(parsedLog.level).toBe('info');
      expect(parsedLog.event).toBe('dlq_sent');
      expect(parsedLog.topic).toBe('test-topic-dlq'); // Default topic name
      expect(parsedLog.originalTopic).toBe('test-topic');
      expect(parsedLog.partition).toBe(0);
      expect(parsedLog.offset).toBe('42');
      expect(parsedLog.errorMessage).toBe('Test error');
    });

    it('должен логировать правильный DLQ topic когда KAFKA_DLQ_TOPIC установлен', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      process.env.KAFKA_DLQ_TOPIC = 'custom-dlq';

      await sendToDlq(mockProducer, originalMessage, error);

      const log = vi.mocked(consoleLogSpy).mock.calls[0][0];
      const parsedLog = JSON.parse(log);

      expect(parsedLog.topic).toBe('custom-dlq');
    });

    it('должен логировать timestamp в success log', async () => {
      const originalMessage = {
        value: '{"test": "value"}',
        topic: 'test-topic',
        partition: 0,
        offset: '42',
      };
      const error = new Error('Test error');

      const beforeCall = Date.now();
      await sendToDlq(mockProducer, originalMessage, error);
      const afterCall = Date.now();

      const log = vi.mocked(consoleLogSpy).mock.calls[0][0];
      const parsedLog = JSON.parse(log);

      // Проверяем что failedAt валидный ISO timestamp в разумном временном окне
      const failedAtDate = new Date(parsedLog.failedAt);
      expect(failedAtDate.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(failedAtDate.getTime()).toBeLessThanOrEqual(afterCall + 1000);
    });
  });
});
