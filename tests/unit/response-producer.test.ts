/**
 * Unit tests для sendResponse()
 * Test-First Development: Tests для Response Producer functionality
 * @fileoverview Tests for sendResponse function с producer mocking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Producer } from 'kafkajs';
import { sendResponse, type ResponseMessage } from '../../src/kafka/response-producer.js';

describe('sendResponse', () => {
  let mockProducer: Producer;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Создаём mock producer
    mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as Producer;

    // Spy на console.error для проверки логирования ошибок
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Восстанавливаем console.error
    consoleErrorSpy.mockRestore();
  });

  describe('should send response message to specified topic', () => {
    it('должен отправить response message в указанный topic', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key-123',
        sessionId: 'session-456',
        ruleName: 'test-rule',
        agentId: 'agent-789',
        response: 'Test response text',
        status: 'success',
        executionTimeMs: 150,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'test-response-topic', message);

      // Verify producer.send был вызван
      expect(mockProducer.send).toHaveBeenCalledTimes(1);
      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что topic указан корректно
      expect(record.topic).toBe('test-response-topic');
      expect(record.messages).toBeDefined();
      expect(record.messages).toHaveLength(1);
    });
  });

  describe('should use sessionId as Kafka message key', () => {
    it('должен использовать sessionId как Kafka message key', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key-123',
        sessionId: 'unique-session-id',
        ruleName: 'test-rule',
        agentId: 'agent-789',
        response: 'Test response text',
        status: 'success',
        executionTimeMs: 150,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'test-topic', message);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];
      const kafkaMessage = record.messages[0];

      // Проверяем что key = sessionId
      expect(kafkaMessage.key).toBe('unique-session-id');
    });

    it('должен корректно обрабатывать sessionId с разными форматами', async () => {
      const testCases = [
        { sessionId: 'simple-id', expected: 'simple-id' },
        { sessionId: 'uuid-format-12345678', expected: 'uuid-format-12345678' },
        { sessionId: 'session.with.dots', expected: 'session.with.dots' },
        { sessionId: 'SESSION-CAPS', expected: 'SESSION-CAPS' },
      ];

      for (const testCase of testCases) {
        vi.mocked(mockProducer.send).mockClear();

        const message: ResponseMessage = {
          messageKey: 'msg-key',
          sessionId: testCase.sessionId,
          ruleName: 'rule',
          agentId: 'agent',
          response: 'response',
          status: 'success',
          executionTimeMs: 100,
          timestamp: '2024-01-15T10:30:00.000Z',
        };

        await sendResponse(mockProducer, 'topic', message);

        const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
        expect(sendCall[0].messages[0].key).toBe(testCase.expected);
      }
    });
  });

  describe('should use acks: -1 (all ISR)', () => {
    it('должен использовать acks: -1 для all ISR', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session-123',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'topic', message);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      // Проверяем что acks = -1 (all ISR)
      expect(record.acks).toBe(-1);
    });
  });

  describe('should serialize ResponseMessage as JSON value', () => {
    it('должен сериализовать ResponseMessage как JSON в value', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key-123',
        sessionId: 'session-456',
        ruleName: 'test-rule',
        agentId: 'agent-789',
        response: 'Test response text',
        status: 'success',
        executionTimeMs: 150,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'topic', message);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];
      const kafkaMessage = record.messages[0];

      // Парсим JSON из value
      const parsedValue = JSON.parse(kafkaMessage.value as string);

      // Проверяем что все поля сериализованы корректно
      expect(parsedValue.messageKey).toBe('msg-key-123');
      expect(parsedValue.sessionId).toBe('session-456');
      expect(parsedValue.ruleName).toBe('test-rule');
      expect(parsedValue.agentId).toBe('agent-789');
      expect(parsedValue.response).toBe('Test response text');
      expect(parsedValue.status).toBe('success');
      expect(parsedValue.executionTimeMs).toBe(150);
      expect(parsedValue.timestamp).toBe('2024-01-15T10:30:00.000Z');
    });

    it('должен сериализовать специальные символы в response', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'Response with "quotes" and \'apostrophes\' and \n newlines',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'topic', message);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const parsedValue = JSON.parse(sendCall[0].messages[0].value as string);

      // JSON сериализация должна корректно обработать спецсимволы
      expect(parsedValue.response).toBe('Response with "quotes" and \'apostrophes\' and \n newlines');
    });
  });

  describe('should not throw on send failure', () => {
    it('должен перехватывать ошибку Producer.send() и не бросать исключение', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      // Mock Producer.send() чтобы выбросить ошибку
      vi.mocked(mockProducer.send).mockRejectedValueOnce(
        new Error('Kafka connection failed')
      );

      // sendResponse НЕ должен бросать исключение
      await expect(
        sendResponse(mockProducer, 'topic', message)
      ).resolves.not.toThrow();
    });

    it('должен возвращать Promise<void> даже при ошибке', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      vi.mocked(mockProducer.send).mockRejectedValueOnce(new Error('Network error'));

      const result = sendResponse(mockProducer, 'topic', message);

      // Проверяем что возвращается Promise<void>
      await expect(result).resolves.toBeUndefined();
    });
  });

  describe('should log error on send failure', () => {
    it('должен логировать ошибку при Producer.send() failure', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const kafkaError = new Error('Kafka connection failed');
      vi.mocked(mockProducer.send).mockRejectedValueOnce(kafkaError);

      await sendResponse(mockProducer, 'test-topic', message);

      // Проверяем что console.error был вызван с JSON-структурой
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      // Парсим JSON-лог
      const errorLog = JSON.parse(vi.mocked(consoleErrorSpy).mock.calls[0][0] as string);
      expect(errorLog.level).toBe('error');
      expect(errorLog.event).toBe('response_send_failed');
      expect(errorLog.topic).toBe('test-topic');
      expect(errorLog.errorMessage).toBe('Kafka connection failed');
      expect(errorLog.timestamp).toBeDefined();
    });

    it('должен логировать правильный topic в сообщении об ошибке', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      vi.mocked(mockProducer.send).mockRejectedValueOnce(new Error('Error'));

      await sendResponse(mockProducer, 'custom-response-topic', message);

      const errorLog = JSON.parse(vi.mocked(consoleErrorSpy).mock.calls[0][0] as string);
      expect(errorLog.topic).toBe('custom-response-topic');
    });

    it('должен корректно обрабатывать не-Error объект при Producer.send() failure', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      // Mock Producer.send() to throw non-Error object
      vi.mocked(mockProducer.send).mockRejectedValueOnce('String error');

      await sendResponse(mockProducer, 'topic', message);

      // Проверяем что console.error был вызван
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const errorLog = JSON.parse(vi.mocked(consoleErrorSpy).mock.calls[0][0] as string);
      expect(errorLog.errorMessage).toBe('String error');
    });

    it('должен корректно обрабатывать объект ошибки без message', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      const errorWithoutMessage = new Error();
      errorWithoutMessage.message = ''; // Пустое сообщение

      vi.mocked(mockProducer.send).mockRejectedValueOnce(errorWithoutMessage);

      await sendResponse(mockProducer, 'topic', message);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const errorLog = JSON.parse(vi.mocked(consoleErrorSpy).mock.calls[0][0] as string);
      expect(errorLog.event).toBe('response_send_failed');
      expect(errorLog.level).toBe('error');
    });
  });

  describe('ResponseMessage interface validation', () => {
    it('должен принимать message со всеми обязательными полями', async () => {
      const message: ResponseMessage = {
        messageKey: 'key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'text',
        status: 'success',
        executionTimeMs: 250,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'topic', message);

      expect(mockProducer.send).toHaveBeenCalledTimes(1);
    });

    it('должен использовать acks: -1 (all ISR)', async () => {
      const message: ResponseMessage = {
        messageKey: 'msg-key',
        sessionId: 'session',
        ruleName: 'rule',
        agentId: 'agent',
        response: 'response',
        status: 'success',
        executionTimeMs: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
      };

      await sendResponse(mockProducer, 'topic', message);

      const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
      const record = sendCall[0];

      expect(record.acks).toBe(-1);
    });
  });
});