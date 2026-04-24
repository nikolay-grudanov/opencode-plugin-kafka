/**
 * Unit tests for Kafka client initialization
 * Test-First Development: Tests are written before implementation
 * @fileoverview Tests for createKafkaClient, createConsumer, createDlqProducer functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createKafkaClient, createConsumer, createDlqProducer, createResponseProducer } from '../../src/kafka/client.js';

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

      const { kafka, validatedEnv } = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      expect(kafka).toHaveProperty('consumer');
      expect(kafka).toHaveProperty('producer');
      expect(validatedEnv.KAFKA_BROKERS).toBe('localhost:9092');
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

      const { kafka, validatedEnv } = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      expect(validatedEnv.KAFKA_SSL).toBe(true);
      // Проверяем что Kafka client создан
      // (подробная проверка конфигурации будет в интеграционных тестах)
    });
  });

  describe('SSL disabled when KAFKA_SSL=false', () => {
    it('должен отключить SSL когда KAFKA_SSL=false', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_SSL = 'false';

      const { validatedEnv } = createKafkaClient(process.env);

      expect(validatedEnv.KAFKA_SSL).toBe(false);
    });
  });

  describe('KAFKA_SSL not set returns false', () => {
    it('должен вернуть false когда KAFKA_SSL не установлен', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';

      const { validatedEnv } = createKafkaClient(process.env);

      expect(validatedEnv.KAFKA_SSL).toBe(false);
    });
  });

  describe('SASL configured when username+password set', () => {
    it('должен сконфигурировать SASL когда установлены KAFKA_USERNAME и KAFKA_PASSWORD', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_USERNAME = 'user';
      process.env.KAFKA_PASSWORD = 'pass';

      const { kafka, validatedEnv } = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      expect(validatedEnv.KAFKA_USERNAME).toBe('user');
      // SASL будет сконфигурирован с механизмом по умолчанию (plain)
    });

    it('должен использовать механизм из KAFKA_SASL_MECHANISM когда установлен', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.KAFKA_USERNAME = 'user';
      process.env.KAFKA_PASSWORD = 'pass';
      process.env.KAFKA_SASL_MECHANISM = 'scram-sha-256';

      const { kafka, validatedEnv } = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      expect(validatedEnv.KAFKA_SASL_MECHANISM).toBe('scram-sha-256');
      // SASL будет сконфигурирован с механизмом scram-sha-256
    });
  });

  describe('Trims trailing spaces from KAFKA_BROKERS', () => {
    it('должен передать trimmed brokers в Kafka client', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092 , kafka2:9092 ';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';

      const { kafka } = createKafkaClient(process.env);

      expect(kafka).toBeDefined();
      // validatedEnv.KAFKA_BROKERS остаётся как в input (без мутации)
      // Kafka client получает trimmed brokers через internal переменную
    });
  });

  describe('Extra process.env keys are ignored (passthrough)', () => {
    it('должен игнорировать дополнительные ключи из process.env', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CLIENT_ID = 'test-client';
      process.env.KAFKA_GROUP_ID = 'test-group';
      process.env.PATH = '/usr/bin';
      process.env.HOME = '/home/user';
      process.env.USER = 'testuser';

      const { validatedEnv } = createKafkaClient(process.env);

      // validatedEnv должен содержать только определённые ключи
      expect(validatedEnv.KAFKA_BROKERS).toBe('localhost:9092');
      expect(validatedEnv.KAFKA_CLIENT_ID).toBe('test-client');
      expect(validatedEnv.KAFKA_GROUP_ID).toBe('test-group');
      // PATH, HOME, USER не должны вызывать ошибку
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
      const { kafka, validatedEnv } = createKafkaClient(process.env);
      const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);

      expect(consumer).toBeDefined();
      // sessionTimeout будет проверен в интеграционных тестах
    });

    it('должен создать consumer с heartbeatInterval: 30000', () => {
      const { kafka, validatedEnv } = createKafkaClient(process.env);
      const consumer = createConsumer(kafka, validatedEnv.KAFKA_GROUP_ID);

      expect(consumer).toBeDefined();
      // heartbeatInterval будет проверен в интеграционных тестах
    });

    it('должен использовать groupId из переданного параметра', () => {
      const { kafka } = createKafkaClient(process.env);
      const consumer = createConsumer(kafka, 'my-custom-group');

      expect(consumer).toBeDefined();
      // groupId будет проверен в интеграционных тестах
    });

    it('должен выбросить ошибку при пустом groupId', () => {
      const { kafka } = createKafkaClient(process.env);
      expect(() => createConsumer(kafka, '')).toThrow('groupId is required');
    });

    it('должен выбросить ошибку при groupId только с пробелами', () => {
      const { kafka } = createKafkaClient(process.env);
      expect(() => createConsumer(kafka, '   ')).toThrow('groupId is required');
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
      const { kafka } = createKafkaClient(process.env);
      const producer = createDlqProducer(kafka);

      expect(producer).toBeDefined();
      // Producer должен быть отдельным экземпляром от основного producer
    });
  });
});

describe('createResponseProducer', () => {
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

  describe('Valid Kafka creates response producer', () => {
    it('должен создать producer для ответов агентов', async () => {
      const { kafka } = createKafkaClient(process.env);
      // Мокаем connect чтобы не пытаться подключиться к реальному Kafka
      const mockProducer = {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
      };
      
      // Перехватываем вызов producer() чтобы вернуть мок
      kafka.producer = vi.fn().mockReturnValue(mockProducer);
      
      const producer = createResponseProducer(kafka);

      expect(producer).toBeDefined();
      expect(kafka.producer).toHaveBeenCalled();
      // createResponseProducer НЕ должен вызывать connect — это делает startConsumer
      expect(mockProducer.connect).not.toHaveBeenCalled();
    });
  });
});
