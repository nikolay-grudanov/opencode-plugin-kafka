/**
 * Unit tests для IOpenCodeAgent interface и связанных типов.
 * Проверяет корректность type definitions и interface contracts.
 */

import { describe, it, expect } from 'vitest';
import type { IOpenCodeAgent, AgentResult, InvokeOptions, AgentStatus } from '../../../src/opencode/IOpenCodeAgent.js';

describe('IOpenCodeAgent — типы и интерфейсы', () => {
  describe('AgentStatus type', () => {
    it('допускает корректные значения статуса', () => {
      const success: AgentStatus = 'success';
      const error: AgentStatus = 'error';
      const timeout: AgentStatus = 'timeout';

      expect(success).toBe('success');
      expect(error).toBe('error');
      expect(timeout).toBe('timeout');
    });

    it('содержит ровно 3 допустимых значения', () => {
      const statuses: AgentStatus[] = ['success', 'error', 'timeout'];
      expect(statuses).toHaveLength(3);
    });
  });

  describe('InvokeOptions', () => {
    it('содержит обязательное поле timeoutMs', () => {
      const options: InvokeOptions = { timeoutMs: 120_000 };
      expect(options.timeoutMs).toBe(120_000);
    });

    it('принимает произвольное положительное число', () => {
      const options: InvokeOptions = { timeoutMs: 5000 };
      expect(options.timeoutMs).toBeGreaterThan(0);
    });
  });

  describe('AgentResult', () => {
    it('создаёт корректный success результат', () => {
      const result: AgentResult = {
        status: 'success',
        response: 'Текст ответа агента',
        sessionId: 'sess_abc123',
        executionTimeMs: 45678,
        timestamp: '2026-04-23T14:30:00.000Z',
      };

      expect(result.status).toBe('success');
      expect(result.response).toBe('Текст ответа агента');
      expect(result.sessionId).toBe('sess_abc123');
      expect(result.errorMessage).toBeUndefined();
    });

    it('создаёт корректный error результат', () => {
      const result: AgentResult = {
        status: 'error',
        sessionId: 'sess_def456',
        errorMessage: 'Agent execution failed',
        executionTimeMs: 1000,
        timestamp: '2026-04-23T14:30:01.000Z',
      };

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBe('Agent execution failed');
      expect(result.response).toBeUndefined();
    });

    it('создаёт корректный timeout результат', () => {
      const result: AgentResult = {
        status: 'timeout',
        sessionId: 'sess_ghi789',
        errorMessage: 'Agent timed out after 120000ms',
        executionTimeMs: 120_000,
        timestamp: '2026-04-23T14:32:00.000Z',
      };

      expect(result.status).toBe('timeout');
      expect(result.errorMessage).toContain('timed out');
      expect(result.response).toBeUndefined();
    });

    it('содержит все обязательные поля', () => {
      const result: AgentResult = {
        status: 'success',
        sessionId: 'sess_test',
        executionTimeMs: 100,
        timestamp: '2026-04-23T14:30:00.000Z',
      };

      // Проверяем наличие всех обязательных полей
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('executionTimeMs');
      expect(result).toHaveProperty('timestamp');
    });
  });

  describe('IOpenCodeAgent interface', () => {
    it('определяет mockable объект с invoke и abort', () => {
      // С��здаём mock реализацию для проверки интерфейса
      const mockAgent: IOpenCodeAgent = {
        invoke: async (_prompt: string, _agentId: string, _options: InvokeOptions): Promise<AgentResult> => ({
          status: 'success',
          response: 'Mock response',
          sessionId: 'sess_mock',
          executionTimeMs: 50,
          timestamp: new Date().toISOString(),
        }),
        abort: async (_sessionId: string): Promise<boolean> => true,
      };

      expect(typeof mockAgent.invoke).toBe('function');
      expect(typeof mockAgent.abort).toBe('function');
    });

    it('invoke возвращает AgentResult через Promise', async () => {
      const mockAgent: IOpenCodeAgent = {
        invoke: async (): Promise<AgentResult> => ({
          status: 'success',
          response: 'Test response',
          sessionId: 'sess_invoke_test',
          executionTimeMs: 100,
          timestamp: '2026-04-23T14:30:00.000Z',
        }),
        abort: async () => false,
      };

      const result = await mockAgent.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

      expect(result.status).toBe('success');
      expect(result.sessionId).toBe('sess_invoke_test');
    });

    it('abort возвращает boolean через Promise', async () => {
      const mockAgent: IOpenCodeAgent = {
        invoke: async () => ({
          status: 'success',
          sessionId: 'sess_test',
          executionTimeMs: 0,
          timestamp: '',
        }),
        abort: async (sessionId: string): Promise<boolean> => sessionId === 'sess_exists',
      };

      await expect(mockAgent.abort('sess_exists')).resolves.toBe(true);
      await expect(mockAgent.abort('sess_not_found')).resolves.toBe(false);
    });
  });
});