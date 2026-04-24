/**
 * Unit tests: Agent Error/Timeout → DLQ
 * Тестирует: consumer → DLQ integration при status=error и status=timeout от агента
 *
 * @fileoverview Tests for agent error/timeout scenarios (MAJOR M8)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eachMessageHandler } from '../../src/kafka/consumer.js';
import type { PluginConfigV003, RuleV003 } from '../../src/schemas/index.js';
import type { Producer } from 'kafkajs';
import type { IOpenCodeAgent } from '../../src/opencode/IOpenCodeAgent.js';

/**
 * Mock состояние consumer для тестов
 */
interface MockConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

describe('Agent Error/Timeout → DLQ', () => {
  let mockDlqProducer: Producer;
  let mockCommitOffsets: ReturnType<typeof vi.fn>;
  let mockConfig: PluginConfigV003;
  let mockState: MockConsumerState;
  let mockAgent: IOpenCodeAgent;
  let mockResponseProducer: Producer;
  let activeSessions: Set<AbortController>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Setup mocks
    mockDlqProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    mockCommitOffsets = vi.fn().mockResolvedValue(undefined);

    mockState = {
      isShuttingDown: false,
      totalMessagesProcessed: 0,
      dlqMessagesCount: 0,
      lastDlqRateLogTime: Date.now(),
    };

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Setup config with one matching rule
    const rules: RuleV003[] = [
      {
        name: 'test-rule',
        jsonPath: '$.test',
        promptTemplate: 'Process: ${$}',
        agentId: 'test-agent',
        timeoutMs: 30000,
      },
    ];

    mockConfig = {
      topics: ['test-topic'],
      rules: rules,
    };

    mockResponseProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Producer;

    activeSessions = new Set<AbortController>();

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Agent Error → DLQ', () => {
    it('отправляет сообщение в DLQ когда агент возвращает status=error', async () => {
      // Mock agent с ошибкой
      mockAgent = {
        invoke: vi.fn().mockResolvedValue({
          status: 'error' as const,
          errorMessage: 'Agent processing failed',
          sessionId: 'sess_error',
          executionTimeMs: 100,
          timestamp: new Date().toISOString(),
        }),
        abort: vi.fn().mockResolvedValue(true),
      };

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
        mockDlqProducer,
        mockCommitOffsets,
        mockState,
        mockAgent,
        mockResponseProducer,
        activeSessions
      );

      // Проверяем что Producer.send был вызван
      expect(mockDlqProducer.send).toHaveBeenCalledTimes(1);

      // Получаем отправленный envelope
      const sendCall = vi.mocked(mockDlqProducer.send).mock.calls[0];
      const record = sendCall[0];
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем что errorMessage содержит текст ошибки агента
      expect(envelope.errorMessage).toContain('Agent processing failed');
      expect(envelope.errorMessage).toContain('error');

      // Проверяем что commitOffsets вызван
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });

    it('правильно формирует errorMessage для status=error', async () => {
      // Mock agent с детальным сообщением об ошибке
      mockAgent = {
        invoke: vi.fn().mockResolvedValue({
          status: 'error' as const,
          errorMessage: 'Failed to process request: invalid input data',
          sessionId: 'sess_error_detail',
          executionTimeMs: 250,
          timestamp: new Date().toISOString(),
        }),
        abort: vi.fn().mockResolvedValue(true),
      };

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '10',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(
        payload,
        mockConfig,
        mockDlqProducer,
        mockCommitOffsets,
        mockState,
        mockAgent,
        mockResponseProducer,
        activeSessions
      );

      // Проверяем sendToDlq
      expect(mockDlqProducer.send).toHaveBeenCalledTimes(1);

      const sendCall = vi.mocked(mockDlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем полное сообщение
      expect(envelope.errorMessage).toContain('Failed to process request: invalid input data');
    });
  });

  describe('Agent Timeout → DLQ', () => {
    it('отправляет сообщение в DLQ когда агент возвращает status=timeout', async () => {
      // Mock agent с timeout
      mockAgent = {
        invoke: vi.fn().mockResolvedValue({
          status: 'timeout' as const,
          errorMessage: 'Agent timed out after 120000ms',
          sessionId: 'sess_timeout',
          executionTimeMs: 120000,
          timestamp: new Date().toISOString(),
        }),
        abort: vi.fn().mockResolvedValue(true),
      };

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
        mockDlqProducer,
        mockCommitOffsets,
        mockState,
        mockAgent,
        mockResponseProducer,
        activeSessions
      );

      // Проверяем что Producer.send был вызван
      expect(mockDlqProducer.send).toHaveBeenCalledTimes(1);

      // Получаем отправленный envelope
      const sendCall = vi.mocked(mockDlqProducer.send).mock.calls[0];
      const record = sendCall[0];
      const envelope = JSON.parse(record.messages[0].value as string);

      // Проверяем что errorMessage указывает на timeout
      expect(envelope.errorMessage).toContain('timeout');
      expect(envelope.errorMessage).toContain('120000');

      // Проверяем что commitOffsets вызван
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });

    it('правильно формирует errorMessage для status=timeout', async () => {
      // Mock agent с custom timeout message
      mockAgent = {
        invoke: vi.fn().mockResolvedValue({
          status: 'timeout' as const,
          errorMessage: 'Request took too long, aborting after 60000ms',
          sessionId: 'sess_custom_timeout',
          executionTimeMs: 60000,
          timestamp: new Date().toISOString(),
        }),
        abort: vi.fn().mockResolvedValue(true),
      };

      const payload = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('{"test": "value"}'),
          offset: '20',
          key: null,
          headers: {},
          timestamp: '2024-04-22T00:00:00.000Z',
        },
      };

      await eachMessageHandler(
        payload,
        mockConfig,
        mockDlqProducer,
        mockCommitOffsets,
        mockState,
        mockAgent,
        mockResponseProducer,
        activeSessions
      );

      // Проверяем sendToDlq
      expect(mockDlqProducer.send).toHaveBeenCalledTimes(1);

      const sendCall = vi.mocked(mockDlqProducer.send).mock.calls[0];
      const envelope = JSON.parse(sendCall[0].messages[0].value as string);

      // Проверяем полное сообщение с timeout
      expect(envelope.errorMessage).toContain('Request took too long, aborting after 60000ms');
    });
  });

  describe('Agent Success → NO DLQ', () => {
    it('не отправляет сообщение в DLQ когда агент возвращает status=success', async () => {
      // Mock agent с успешным ответом
      mockAgent = {
        invoke: vi.fn().mockResolvedValue({
          status: 'success' as const,
          response: 'Agent processed successfully',
          sessionId: 'sess_success',
          executionTimeMs: 150,
          timestamp: new Date().toISOString(),
        }),
        abort: vi.fn().mockResolvedValue(true),
      };

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

      await eachMessageHandler(
        payload,
        mockConfig,
        mockDlqProducer,
        mockCommitOffsets,
        mockState,
        mockAgent,
        mockResponseProducer,
        activeSessions
      );

      // Проверяем что sendToDlq НЕ вызван
      expect(mockDlqProducer.send).not.toHaveBeenCalled();

      // Проверяем что commitOffsets вызван
      expect(mockCommitOffsets).toHaveBeenCalledTimes(1);
    });
  });
});