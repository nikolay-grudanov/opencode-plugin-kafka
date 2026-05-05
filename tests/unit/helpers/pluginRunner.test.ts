/**
 * Unit tests для pluginRunner helper.
 * Тестирует функции runPlugin и управление process.exit в контексте E2E тестов.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Мокируем startConsumer ДО импорта pluginRunner
vi.mock('../../../src/kafka/consumer.js', () => ({
  startConsumer: vi.fn(),
}));

import { runPlugin, type KafkaConnectionSettings } from '../../e2e/helpers/pluginRunner.js';
import { startConsumer } from '../../../src/kafka/consumer.js';

describe('pluginRunner', () => {
  // Сохраняем оригинальный process.exit для восстановления
  const originalExit = process.exit;

  // Мок агента
  const mockAgent = {
    invoke: vi.fn().mockResolvedValue({ result: 'ok' }),
    abort: vi.fn(),
  };

  // Базовая конфигурация подключения
  const baseConnection: KafkaConnectionSettings = {
    brokers: 'localhost:9092',
    clientId: 'test-client',
    groupId: 'test-group',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Восстанавливаем process.exit перед каждым тестом
    process.exit = originalExit;
    // Очищаем env vars
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_CLIENT_ID;
    delete process.env.KAFKA_GROUP_ID;
    delete process.env.KAFKA_SSL;
    delete process.env.KAFKA_USERNAME;
    delete process.env.KAFKA_PASSWORD;
    delete process.env.KAFKA_SASL_MECHANISM;
    delete process.env.KAFKA_DLQ_TOPIC;
    delete process.env.KAFKA_IGNORE_TOMBSTONES;
  });

  afterEach(() => {
    // Гарантируем восстановление process.exit после каждого теста
    process.exit = originalExit;
  });

  describe('runPlugin', () => {
    describe('Перехват process.exit', () => {
      it('должен перехватить process.exit при запуске плагина', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        // Запускаем плагин — это должно перехватить process.exit
        await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // Проверяем что process.exit был перехвачен (т.е. это уже не оригинальная функция)
        expect(process.exit).not.toBe(originalExit);
      });

      it('должен вызывать exit handler без завершения процесса', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // Вызываем перехваченный exit — он не должен завершить процесс
        let reachedHere = false;

        try {
          // Перехваченный exit не вызывает originalExit, поэтому процесс продолжается
          process.exit(0);
          reachedHere = true;
        } catch {
          // process.exit может выбросить, но это не должно крашнуть тест
        }

        expect(reachedHere).toBe(true);
      });
    });

    describe('Управление env vars', () => {
      it('должен сохранять и восстанавливать KAFKA_BROKERS', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const originalBrokers = 'original-broker:9092';
        process.env.KAFKA_BROKERS = originalBrokers;

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // KAFKA_BROKERS дол��ен быть изменён
        expect(process.env.KAFKA_BROKERS).toBe('localhost:9092');

        // Останавливаем плагин — env должен быть восстановлен
        await handle.stop();

        expect(process.env.KAFKA_BROKERS).toBe(originalBrokers);
      });

      it('должен сохранять и восстанавливать KAFKA_CLIENT_ID', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const originalClientId = 'original-client';
        process.env.KAFKA_CLIENT_ID = originalClientId;

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        expect(process.env.KAFKA_CLIENT_ID).toBe('test-client');

        await handle.stop();

        expect(process.env.KAFKA_CLIENT_ID).toBe(originalClientId);
      });

      it('должен сохранять и восстанавливать KAFKA_GROUP_ID', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const originalGroupId = 'original-group';
        process.env.KAFKA_GROUP_ID = originalGroupId;

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        expect(process.env.KAFKA_GROUP_ID).toBe('test-group');

        await handle.stop();

        expect(process.env.KAFKA_GROUP_ID).toBe(originalGroupId);
      });

      it('должен удалять env var если его не было до запуска', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        // Убеждаемся что env var нет
        delete process.env.KAFKA_BROKERS;

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // После остановки env var должен быть удалён
        await handle.stop();

        expect(process.env.KAFKA_BROKERS).toBeUndefined();
      });

      it('должен устанавливать KAFKA_SSL когда передан ssl: true', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, ssl: true }
        );

        expect(process.env.KAFKA_SSL).toBe('true');

        await handle.stop();
      });

      it('должен устанавливать KAFKA_SSL как false когда передан ssl: false', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, ssl: false }
        );

        expect(process.env.KAFKA_SSL).toBe('false');

        await handle.stop();
      });

      it('должен устанавливать KAFKA_USERNAME и KAFKA_PASSWORD когда переданы', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, username: 'user', password: 'pass' }
        );

        expect(process.env.KAFKA_USERNAME).toBe('user');
        expect(process.env.KAFKA_PASSWORD).toBe('pass');

        await handle.stop();
      });

      it('должен устанавливать KAFKA_SASL_MECHANISM когда передан', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, saslMechanism: 'scram-sha-256' }
        );

        expect(process.env.KAFKA_SASL_MECHANISM).toBe('scram-sha-256');

        await handle.stop();
      });

      it('должен уста��авливать KAFKA_DLQ_TOPIC когда передан', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, dlqTopic: 'dlq-topic' }
        );

        expect(process.env.KAFKA_DLQ_TOPIC).toBe('dlq-topic');

        await handle.stop();
      });

      it('должен устанавливать KAFKA_IGNORE_TOMBSTONES когда передан', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin(
          { topics: ['test'], rules: [] },
          mockAgent,
          { ...baseConnection, ignoreTombstones: true }
        );

        expect(process.env.KAFKA_IGNORE_TOMBSTONES).toBe('true');

        await handle.stop();
      });
    });

    describe('Обработка ошибок consumer', () => {
      it('должен логировать ошибку когда startConsumer падает', async () => {
        const errorMessage = 'Consumer connection failed';
        vi.mocked(startConsumer).mockRejectedValue(new Error(errorMessage));

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // Даём время для catch в pluginRunner
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Проверяем что ошибка была залогирована
        expect(consoleSpy).toHaveBeenCalled();

        // Останавливаем плагин
        await handle.stop();
        consoleSpy.mockRestore();
      });
    });

    describe('PluginRunnerHandle.stop()', () => {
      it('должен восстановить process.exit после остановки', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        // Вызываем stop
        await handle.stop();

        // process.exit должен быть восстановлен
        expect(process.exit).toBe(originalExit);
      });

      it('должен отправлять SIGTERM при остановке', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        await handle.stop();

        // Проверяем что был отправлен SIGTERM
        expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');

        killSpy.mockRestore();
      });

      it('должен восстановить все env vars после остановки', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        // Устанавливаем все env vars
        process.env.KAFKA_BROKERS = 'old-broker';
        process.env.KAFKA_CLIENT_ID = 'old-client';
        process.env.KAFKA_GROUP_ID = 'old-group';
        process.env.KAFKA_SSL = 'true';
        process.env.KAFKA_USERNAME = 'old-user';
        process.env.KAFKA_PASSWORD = 'old-pass';
        process.env.KAFKA_SASL_MECHANISM = 'plain';
        process.env.KAFKA_DLQ_TOPIC = 'old-dlq';
        process.env.KAFKA_IGNORE_TOMBSTONES = 'true';

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        await handle.stop();

        // Все env vars должны быть восстановлены
        expect(process.env.KAFKA_BROKERS).toBe('old-broker');
        expect(process.env.KAFKA_CLIENT_ID).toBe('old-client');
        expect(process.env.KAFKA_GROUP_ID).toBe('old-group');
        expect(process.env.KAFKA_SSL).toBe('true');
        expect(process.env.KAFKA_USERNAME).toBe('old-user');
        expect(process.env.KAFKA_PASSWORD).toBe('old-pass');
        expect(process.env.KAFKA_SASL_MECHANISM).toBe('plain');
        expect(process.env.KAFKA_DLQ_TOPIC).toBe('old-dlq');
        expect(process.env.KAFKA_IGNORE_TOMBSTONES).toBe('true');
      });

      it('должен восстанавливать undefined env vars после остановки', async () => {
        vi.mocked(startConsumer).mockResolvedValue(undefined);

        // Убеждаемся что env vars не определены
        delete process.env.KAFKA_BROKERS;
        delete process.env.KAFKA_CLIENT_ID;
        delete process.env.KAFKA_GROUP_ID;
        delete process.env.KAFKA_SSL;
        delete process.env.KAFKA_USERNAME;
        delete process.env.KAFKA_PASSWORD;
        delete process.env.KAFKA_SASL_MECHANISM;
        delete process.env.KAFKA_DLQ_TOPIC;
        delete process.env.KAFKA_IGNORE_TOMBSTONES;

        const handle = await runPlugin({ topics: ['test'], rules: [] }, mockAgent, baseConnection);

        await handle.stop();

        // Все env vars должны быть удалены (undefined)
        expect(process.env.KAFKA_BROKERS).toBeUndefined();
        expect(process.env.KAFKA_CLIENT_ID).toBeUndefined();
        expect(process.env.KAFKA_GROUP_ID).toBeUndefined();
        expect(process.env.KAFKA_SSL).toBeUndefined();
        expect(process.env.KAFKA_USERNAME).toBeUndefined();
        expect(process.env.KAFKA_PASSWORD).toBeUndefined();
        expect(process.env.KAFKA_SASL_MECHANISM).toBeUndefined();
        expect(process.env.KAFKA_DLQ_TOPIC).toBeUndefined();
        expect(process.env.KAFKA_IGNORE_TOMBSTONES).toBeUndefined();
      });
    });
  });
});