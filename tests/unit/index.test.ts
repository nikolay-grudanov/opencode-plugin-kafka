/**
 * Unit tests for plugin entry point
 * Test-First Development: Tests are written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';

// Мокируем модули ДО импорта плагина
vi.mock('../../src/core/config.js', () => ({
  parseConfigV003: vi.fn(),
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

  describe('Should create OpenCodeAgentAdapter with context.client', () => {
    it('should create adapter instance with SDK client', async () => {
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
      vi.mocked(startConsumer).mockResolvedValue(undefined);

      const plugin = await getDefaultExport();
      await plugin(mockContext);

      expect(OpenCodeAgentAdapter).toHaveBeenCalledWith(mockContext.client);
    });
  });

  describe('Should call startConsumer with config and agent', () => {
    it('should pass both config and agent to startConsumer', async () => {
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
      vi.mocked(startConsumer).mockResolvedValue(undefined);

      const plugin = await getDefaultExport();
      await plugin(mockContext);

      expect(startConsumer).toHaveBeenCalledTimes(1);
      expect(startConsumer).toHaveBeenCalledWith(validConfig, expect.any(Object));
    });
  });

  describe('Should return plugin hooks object', () => {
    it('should register session.error observability hook (ADR-005, spec-006 FR-001)', async () => {
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
      vi.mocked(startConsumer).mockResolvedValue(undefined);

      const plugin = await getDefaultExport();
      const result = await plugin(mockContext);

      // Hook object must contain exactly one entry — the session.error handler
      // mandated by ADR-005 / spec-006 FR-001 / T020.
      expect(result).toHaveProperty('session.error');
      expect(typeof result['session.error']).toBe('function');

      // Per ADR-006: this is the ONLY hook we register. No chat.message,
      // session.idle, or event subscriptions — those would force state
      // tracking and violate the No-State Consumer principle.
      expect(Object.keys(result)).toEqual(['session.error']);
    });

    it('session.error handler should log structured JSON error event', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const validConfig = {
        topics: ['topic1'],
        rules: [{ name: 'rule1', topic: 'topic1', agent: 'agent1' }],
      };

      vi.mocked(parseConfigV003).mockReturnValue(validConfig as never);
      vi.mocked(startConsumer).mockResolvedValue(undefined);

      const plugin = await getDefaultExport();
      const result = await plugin(mockContext);

      const handler = result['session.error']!;
      const testError = new Error('opencode runtime crash');
      handler(testError, 'session-abc-123');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedJson = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(loggedJson);

      expect(parsed.level).toBe('error');
      expect(parsed.event).toBe('opencode_session_error');
      expect(parsed.sessionId).toBe('session-abc-123');
      expect(parsed.error).toBe('opencode runtime crash');
      expect(parsed.stack).toBeDefined();
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      consoleSpy.mockRestore();
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
      vi.mocked(startConsumer).mockRejectedValue(new Error('Kafka connection failed'));

      const plugin = await getDefaultExport();

      await expect(plugin(mockContext)).rejects.toThrow('Kafka connection failed');
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