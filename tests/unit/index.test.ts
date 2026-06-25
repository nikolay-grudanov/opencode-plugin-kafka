/**
 * Unit tests for plugin entry point
 * Test-First Development: Tests are written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';

// Мокируем модули ДО импорта плагина
vi.mock('../../src/core/config.js', () => ({
  parseConfigV003: vi.fn().mockImplementation(() => ({
    topics: [],
    rules: [],
    toggles: {
      toolDelivery: true,
      eventHook: true,
      pollingFallback: false,
    },
  })),
}));

vi.mock('../../src/kafka/consumer.js', () => ({
  startConsumer: vi.fn(),
}));

vi.mock('../../src/opencode/OpenCodeAgentAdapter.js', () => ({
  OpenCodeAgentAdapter: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    abort: vi.fn(),
  })),
}));

vi.mock('../../src/kafka/client.js', () => ({
  createKafkaClient: vi.fn().mockReturnValue({
    kafka: { producer: vi.fn(), consumer: vi.fn() },
  }),
  createResponseProducer: vi.fn().mockReturnValue({
    connect: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
  }),
  createDlqProducer: vi.fn().mockReturnValue({
    connect: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('../../src/opencode/event-handler.js', () => ({
  createEventHandler: vi.fn().mockReturnValue(vi.fn()),
  startMaxSessionGuard: vi.fn(),
  stopMaxSessionGuard: vi.fn(),
}));

// Импортируем после моков
import { parseConfigV003 } from '../../src/core/config.js';
import { startConsumer } from '../../src/kafka/consumer.js';
import { OpenCodeAgentAdapter } from '../../src/opencode/OpenCodeAgentAdapter.js';

import type { PluginContext } from '../../src/types/opencode-plugin.d.ts';

// Динамический импорт плагина
const getDefaultExport = async () => {
  const module = await import('../../src/index.js');
  return module.default;
};

describe('plugin', () => {
  let mockContext: PluginContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Создаём мок контекста
    mockContext = {
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ id: 'session-1' }),
          prompt: vi.fn().mockResolvedValue({ parts: [] }),
          abort: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      } as never,
      project: null as never,
      directory: '/test',
      worktree: '/test',
      $: vi.fn().mockResolvedValue('') as never,
    };
  });

  describe('Should create OpenCodeAgentAdapter with context.client (tool-based mode)', () => {
    it('should create adapter instance with SDK client in tool-based mode (default)', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
          },
        ],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      // startConsumer now returns a never-resolving promise (background task)
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      await plugin(mockContext);

      expect(OpenCodeAgentAdapter).toHaveBeenCalledWith(mockContext.client, 'tool-based');
    });

    it('should create adapter in polling mode when toggles.pollingFallback=true', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
          },
        ],
        toggles: {
          toolDelivery: false,
          eventHook: false,
          pollingFallback: true,
        },
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      await plugin(mockContext);

      expect(OpenCodeAgentAdapter).toHaveBeenCalledWith(mockContext.client, 'polling');
    });
  });

  describe('Should start Kafka consumer in background', () => {
    it('should call startConsumer without awaiting (consumer is a background task)', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
          },
        ],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      await plugin(mockContext);

      // startConsumer was called, but plugin() did not wait for it
      expect(startConsumer).toHaveBeenCalledTimes(1);
      expect(startConsumer).toHaveBeenCalledWith(validConfig, expect.any(Object));
    });
  });

  describe('Should return plugin hooks object', () => {
    it('should return hooks with session.error handler (already implemented for ADR-005)', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
          },
        ],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      const result = await plugin(mockContext);

      // Hook object must contain exactly one entry — the session.error handler
      // mandated by ADR-005 / spec-006 FR-001 / T020.
      expect(result).toHaveProperty('session.error');
      expect(typeof result['session.error']).toBe('function');
    });

    it('should register send_to_kafka tool per rule when toggles.toolDelivery=true (default)', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule-with-response',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
            responseTopic: 'opencode.responses',
          },
        ],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      const result = await plugin(mockContext);

      // spec-009 FR-1: tool per rule with responseTopic, named send_to_kafka_<rule>
      const hooks = result as unknown as { tool?: Record<string, unknown> };
      expect(hooks.tool).toBeDefined();
      expect(Object.keys(hooks.tool!)).toContain('send_to_kafka_rule_with_response');
    });

    it('should NOT register tools when toggles.toolDelivery=false', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.task',
            promptTemplate: 'Do: ${$.task}',
            agentId: 'agent1',
            responseTopic: 'opencode.responses',
          },
        ],
        toggles: {
          toolDelivery: false,
          eventHook: false,
          pollingFallback: true, // need at least one delivery path
        },
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockReturnValue(new Promise(() => {}) as never);

      const plugin = await getDefaultExport();
      const result = await plugin(mockContext);

      const hooks = result as unknown as { tool?: unknown };
      expect(hooks.tool).toBeUndefined();
    });
  });

  describe('Should throw when parseConfigV003 throws (config error propagation)', () => {
    it('should propagate ZodError from parseConfigV003', async () => {
      // Мокаем parseConfigV003 чтобы он выбросил ошибку валидации
      vi.mocked(parseConfigV003).mockImplementation(() => {
        throw new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['rules', 0, 'topic'],
            message: 'Required',
          },
        ]);
      });

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow(ZodError);
    });

    it('should propagate custom error from parseConfigV003', async () => {
      vi.mocked(parseConfigV003).mockImplementation(() => {
        throw new Error('Custom config error');
      });

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow('Custom config error');
    });

    it('should log error before throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(parseConfigV003).mockImplementation(() => {
        throw new Error('Config error');
      });

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('error')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Error handling flows', () => {
    it('should throw when startConsumer throws', async () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
          },
        ],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      // startConsumer rejected — but in spec-009 plugin() does NOT await
      // startConsumer (it's a background task). Errors are logged via
      // .catch and surfaced as 'consumer_start_failed' event.
      vi.mocked(startConsumer).mockRejectedValue(new Error('Kafka connection failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const plugin = await getDefaultExport();

      // plugin() must resolve (not reject) — error is logged and swallowed
      const result = await plugin(mockContext);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('session.error');

      // Allow the background .catch handler to fire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Error was logged with event=consumer_start_failed
      const errorCalls = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errorCalls).toContain('consumer_start_failed');
      expect(errorCalls).toContain('Kafka connection failed');

      consoleSpy.mockRestore();
    });

    it('should handle non-Error thrown (string instead of Error)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(parseConfigV003).mockImplementation(() => {
        throw 'String error'; // Не Error объект, а строка
      });

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow('String error');

      // Проверяем что логирование содержит сообщение об ошибке
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('String error')
      );

      consoleSpy.mockRestore();
    });

    it('should handle non-Error thrown (object instead of Error)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(parseConfigV003).mockImplementation(() => {
        throw { code: 'ERR_CODE', message: 'Object error' }; // Объект без Error прототипа
      });

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow();

      // Проверяем что логирование содержит информацию об объекте
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('object')
      );

      consoleSpy.mockRestore();
    });
  });
});
