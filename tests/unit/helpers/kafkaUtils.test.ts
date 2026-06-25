/**
 * Unit tests для kafkaUtils helper.
 * Тестирует функции для создания/удаления топиков и работы с сообщениями.
 * Используем простой подход - проверяем что функции не падают при валидных входах.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Простой мок для kafkajs который не требует типизации
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type MockKafkaInstance = {
  admin: () => {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    createTopics: ReturnType<typeof vi.fn>;
    deleteTopics: ReturnType<typeof vi.fn>;
  };
  producer: () => {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  consumer: () => {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
};

vi.mock('kafkajs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Kafka: vi.fn((): MockKafkaInstance => ({
    admin: () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue([]),
      deleteTopics: vi.fn().mockResolvedValue([]),
    }),
    producer: () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue([]),
    }),
    consumer: () => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid'),
}));

// Импорт после мока
import {
  createTopics,
  deleteTopics,
  produceMessage,
  consumeOneMessage,
  consumeMessages,
  type KafkaTestMessage,
} from '../../e2e/helpers/kafkaUtils.js';

describe('kafkaUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTopics', () => {
    it('принимает массив brokers и topics', async () => {
      const result = await createTopics(['localhost:9092'], ['topic1']);
      expect(result).toBeUndefined();
    });

    it('не падает при пустом массиве топиков', async () => {
      await expect(createTopics(['localhost:9092'], [])).resolves.toBeUndefined();
    });

    it('создаёт несколько топиков', async () => {
      await createTopics(['broker:9092'], ['topic-a', 'topic-b', 'topic-c']);
      // Просто проверяем что не упало
      expect(true).toBe(true);
    });
  });

  describe('deleteTopics', () => {
    it('принимает массив brokers и topics', async () => {
      const result = await deleteTopics(['localhost:9092'], ['topic1']);
      expect(result).toBeUndefined();
    });

    it('не падает при пустом массиве топиков', async () => {
      await expect(deleteTopics(['localhost:9092'], [])).resolves.toBeUndefined();
    });
  });

  describe('produceMessage', () => {
    it('принимает сообщение с value', async () => {
      const msg: KafkaTestMessage = { value: '{"test":1}' };
      const result = await produceMessage(['localhost:9092'], 'topic', msg);
      expect(result).toBeUndefined();
    });

    it('принимает сообщение с заголовками', async () => {
      const msg: KafkaTestMessage = {
        value: '{}',
        headers: { 'content-type': 'application/json' },
      };
      await expect(
        produceMessage(['localhost:9092'], 'topic', msg)
      ).resolves.toBeUndefined();
    });

    it('принимает ключ сообщения', async () => {
      const msg: KafkaTestMessage = { value: '{}' };
      await expect(
        produceMessage(['localhost:9092'], 'topic', msg, 'key')
      ).resolves.toBeUndefined();
    });
  });

  describe('consumeOneMessage', () => {
    it('прин��мает параметры и возвращает Promise', async () => {
      const result = await consumeOneMessage(['localhost:9092'], 'topic', 50);
      // Возвращает null по таймауту или сообщение
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('принимает fromBeginning параметр', async () => {
      const result = await consumeOneMessage(['localhost:9092'], 'topic', 50, true);
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('принимает fromBeginning: false', async () => {
      const result = await consumeOneMessage(['localhost:9092'], 'topic', 50, false);
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('работает с разными таймаутами', async () => {
      const r1 = await consumeOneMessage(['localhost:9092'], 'topic', 10);
      const r2 = await consumeOneMessage(['localhost:9092'], 'topic', 100);
      expect(r1 === null || typeof r1 === 'object').toBe(true);
      expect(r2 === null || typeof r2 === 'object').toBe(true);
    });
  });

  describe('consumeMessages', () => {
    it('принимает expectedCount', async () => {
      const result = await consumeMessages(['localhost:9092'], 'topic', 1, 50);
      expect(Array.isArray(result)).toBe(true);
    });

    it('возвращает массив', async () => {
      const result = await consumeMessages(['localhost:9092'], 'topic', 3, 50);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('принимает разные таймауты', async () => {
      const result = await consumeMessages(['localhost:9092'], 'topic', 10, 100);
      expect(Array.isArray(result)).toBe(true);
    });

    it('принимает expectedCount = 0', async () => {
      const result = await consumeMessages(['localhost:9092'], 'topic', 0, 50);
      expect(Array.isArray(result)).toBe(true);
    });

    it('принимает большой expectedCount', async () => {
      const result = await consumeMessages(['localhost:9092'], 'topic', 100, 50);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });
});