import { vi } from 'vitest';
import type { Consumer, Producer, EachMessagePayload, KafkaMessage, Admin } from 'kafkajs';

/**
 * Создаёт типизированный мок Consumer для тестов.
 * Используй вместо inline mock объектов.
 */
export function mockConsumer(overrides?: Record<string, unknown>): Consumer {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
    commitOffsets: vi.fn(),
    seek: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    events: {},
    logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    ...overrides,
  } as unknown as Consumer;
}

/**
 * Создаёт типизированный мок Producer для тестов.
 * Используй вместо inline mock объектов.
 */
export function mockProducer(overrides?: Record<string, unknown>): Producer {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn().mockResolvedValue([]),
    sendBatch: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
    events: {},
    logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    ...overrides,
  } as unknown as Producer;
}

/**
 * Создаёт типизированный мок EachMessagePayload для тестов.
 * Используй вместо inline объектов payload.
 */
export function mockPayload(
  topic: string,
  value: string | Buffer | null,
  overrides?: Partial<EachMessagePayload>
): EachMessagePayload {
  return {
    topic,
    partition: 0,
    message: {
      key: null,
      value: typeof value === 'string' ? Buffer.from(value) : value,
      offset: '0',
      timestamp: String(Date.now()),
      size: 0,
      attributes: 0,
      headers: {},
    } as unknown as KafkaMessage,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockReturnValue(() => {}),
    resume: vi.fn(),
    ...overrides,
  } as unknown as EachMessagePayload;
}

/**
 * Создаёт типизированный мок KafkaMessage для тестов.
 * Используй вместо inline объектов message.
 */
export function mockKafkaMessage(
  value: string | Buffer | null,
  overrides?: Partial<KafkaMessage>
): KafkaMessage {
  return {
    key: null,
    value: typeof value === 'string' ? Buffer.from(value) : value,
    offset: '0',
    timestamp: String(Date.now()),
    size: 0,
    attributes: 0,
    headers: {},
    ...overrides,
  } as unknown as KafkaMessage;
}

/**
 * Создаёт типизированный мок Admin для тестов.
 * Используй вместо inline mock объектов.
 */
export function mockAdmin(overrides?: Record<string, unknown>): Admin {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    createTopics: vi.fn().mockResolvedValue([]),
    deleteTopics: vi.fn().mockResolvedValue([]),
    listTopics: vi.fn().mockResolvedValue([]),
    listAcls: vi.fn().mockResolvedValue([]),
    describeConfigs: vi.fn().mockResolvedValue({ resources: [] }),
    on: vi.fn(),
    off: vi.fn(),
    logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    ...overrides,
  } as unknown as Admin;
}