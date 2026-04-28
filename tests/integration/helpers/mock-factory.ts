/**
 * Factory functions для создания полных mock объектов.
 * Решает проблему incomplete mocks — все 8 параметров eachMessageHandler.
 */
import { vi } from 'vitest';
import type { Producer } from 'kafkajs';
import type { IOpenCodeAgent, AgentResult } from '../../../src/opencode/IOpenCodeAgent.js';

/**
 * Mock состояние consumer для тестов (Constitution Principle IV: No-State Consumer)
 */
export interface MockConsumerState {
  isShuttingDown: boolean;
  totalMessagesProcessed: number;
  dlqMessagesCount: number;
  lastDlqRateLogTime: number;
}

/**
 * Полный набор зависимостей для eachMessageHandler.
 * Все 8 параметров, которые expects eachMessageHandler.
 */
export interface MockHandlerDeps {
  dlqProducer: Producer;
  commitOffsets: ReturnType<typeof vi.fn>;
  state: MockConsumerState;
  agent: IOpenCodeAgent;
  responseProducer: Producer;
  activeSessions: Set<AbortController>;
}

/**
 * Создаёт свежий mock consumer state.
 */
export function createFreshState(): MockConsumerState {
  return {
    isShuttingDown: false,
    totalMessagesProcessed: 0,
    dlqMessagesCount: 0,
    lastDlqRateLogTime: Date.now(),
  };
}

/**
 * Создаёт mock DLQ producer.
 */
export function createMockDlqProducer(): Producer {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Producer;
}

/**
 * Создаёт mock response producer.
 */
export function createMockResponseProducer(): Producer {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Producer;
}

/**
 * Создаёт mock OpenCode agent с успешным результатом.
 */
export function createMockAgent(override?: Partial<AgentResult>): IOpenCodeAgent {
  const defaultResult: AgentResult = {
    status: 'success',
    response: 'Mock agent response',
    sessionId: `mock-session-${Date.now()}`,
    executionTimeMs: 100,
    timestamp: new Date().toISOString(),
  };

  return {
    invoke: vi.fn().mockResolvedValue(override ? { ...defaultResult, ...override } : defaultResult),
    abort: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Создаёт mock OpenCode agent с ошибкой.
 */
export function createMockErrorAgent(errorMessage: string): IOpenCodeAgent {
  return {
    invoke: vi.fn().mockResolvedValue({
      status: 'error',
      errorMessage,
      sessionId: `mock-error-session-${Date.now()}`,
      executionTimeMs: 50,
      timestamp: new Date().toISOString(),
    }),
    abort: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Создаёт mock OpenCode agent с timeout.
 */
export function createMockTimeoutAgent(timeoutMs: number): IOpenCodeAgent {
  return {
    invoke: vi.fn().mockResolvedValue({
      status: 'timeout',
      errorMessage: `Agent timed out after ${timeoutMs}ms`,
      sessionId: `mock-timeout-session-${Date.now()}`,
      executionTimeMs: timeoutMs,
      timestamp: new Date().toISOString(),
    }),
    abort: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Создаёт ПОЛНЫЙ набор mock зависимостей для eachMessageHandler.
 * Использовать в каждом тесте вместо создания отдельных mock'ов.
 */
export function createMockHandlerDeps(overrides?: Partial<MockHandlerDeps>): MockHandlerDeps {
  return {
    dlqProducer: createMockDlqProducer(),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
    state: createFreshState(),
    agent: createMockAgent(),
    responseProducer: createMockResponseProducer(),
    activeSessions: new Set(),
    ...overrides,
  };
}