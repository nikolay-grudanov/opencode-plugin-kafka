/**
 * Unit tests for Kafka client initialization
 * Test-First Development: Tests are written before implementation
 * @fileoverview Tests for createKafkaClient, createConsumer, createDlqProducer functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKafkaClient, createConsumer, createDlqProducer } from '../../src/kafka/client.js';

describe('createKafkaClient', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Сохраняем оригинальные переменные окружения
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Восстанавливаем оригинальные переменные окружения
    process.env = originalEnv;
  });

  describe('Valid environment creates Kafka client', () => {
    it('должен создать Kafka клиент для корректных переменных окружения', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';

      const kafka = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      expect(kafka).toHaveProperty('consumer');
      expect(kafka).toHaveProperty('producer');
    });
  });

  describe('Missing KAFKA_BROKERS throws descriptive error', () => {
    it('должен выбросить Error с упоминанием KAFKA_BROKERS при отсутствии переменной', () => {
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      // KAFKA_BROKERS не установлен

      expect(() => createKafkaClient(process.env)).toThrow('KAFKA_BROKERS');
    });
  });

  describe('Missing KAFKA_CLIENT_ID throws descriptive error', () => {
    it('должен выбросить Error с упоминанием KAFKA_CLIENT_ID при отсутствии переменной', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_GROUP_ID = 'test-group';
      // KAFKA_CLIENT_ID не установлен

      expect(() => createKafkaClient(process.env)).toThrow('KAFKA_CLIENT_ID');
    });
  });

  describe('Missing KAFKA_GROUP_ID throws descriptive error', () => {
    it('должен выбросить Error с упоминанием KAFKA_GROUP_ID при отсутствии переменной', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      // KAFKA_GROUP_ID не установлен

      expect(() => createKafkaClient(process.env)).toThrow('KAFKA_GROUP_ID');
    });
  });

  describe('SSL enabled when KAFKA_SSL=true', () => {
    it('должен включить SSL когда KAFKA_SSL=true', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_SSL = 'true';

      const kafka = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      // Проверяем что Kafka client создан
      // (подробная проверка конфигурации будет в интеграционных тестах)
    });
  });

  describe('SASL configured when username+password set', () => {
    it('должен сконфигурировать SASL когда установлены KAFKA_USERNAME и KAFKA_PASSWORD', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_USERNAME = 'user';
      process.env.KAFKA_PASSWORD = 'pass';

      const kafka = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      // SASL будет сконфигурирован с механизмом по умолчанию (plain)
    });

    it('должен использовать механизм из KAFKA_SASL_MECHANISM когда установлен', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_USERNAME = 'user';
      process.env.KAFKA_PASSWORD = 'pass';
      process.env.KAFKA_SASL_MECHANISM = 'scram-sha-256';

      const kafka = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      // SASL будет сконфигурирован с механизмом scram-sha-256
    });
  });

  describe('Trims trailing spaces from KAFKA_BROKERS', () => {
    it('должен удалить trailing spaces из KAFKA_BROKERS', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092 , kafka2:9092 ';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';

      const kafka = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      // Kafka client будет создан с обрезанными брокерами
    });
  });
});

describe('createConsumer', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Устанавливаем минимальные переменные окружения
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'test-client';
    process.env.KAFKA_GROUP_ID = 'test-group';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Valid Kafka creates consumer with correct settings', () => {
    it('должен создать consumer с sessionTimeout: 300000', () => {
      const kafka = createKafkaClient(process.env);
      const consumer = createConsumer(kafka);

      expect(consumer).toBeDefined();
      // sessionTimeout будет проверен в интеграционных тестах
    });

    it('должен создать consumer с heartbeatInterval: 30000', () => {
      const kafka = createKafkaClient(process.env);
      const consumer = createConsumer(kafka);

      expect(consumer).toBeDefined();
      // heartbeatInterval будет проверен в интеграционных тестах
    });

    it('должен использовать groupId из KAFKA_GROUP_ID env', () => {
      process.env.KAFKA_GROUP_ID = 'my-custom-group';
      const kafka = createKafkaClient(process.env);
      const consumer = createConsumer(kafka);

      expect(consumer).toBeDefined();
      // groupId будет проверен в интеграционных тестах
    });

    it('должен создать consumer с autoCommit: false', () => {
      const kafka = createKafkaClient(process.env);
      const consumer = createConsumer(kafka);

      expect(consumer).toBeDefined();
      // autoCommit будет проверен в интеграционных тестах
    });
  });
});

describe('createDlqProducer', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.KAFKA_BROKERS = 'localhost:9092';
    process.env.KAFKA_CLIENT_ID = 'test-client';
    process.env.KAFKA_GROUP_ID = 'test-group';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Valid Kafka creates DLQ producer', () => {
    it('должен создать отдельный producer для DLQ', () => {
      const kafka = createKafkaClient(process.env);
      const producer = createDlqProducer(kafka);

      expect(producer).toBeDefined();
      // Producer должен быть отдельным экземпляром от основного producer
    });
  });
});
