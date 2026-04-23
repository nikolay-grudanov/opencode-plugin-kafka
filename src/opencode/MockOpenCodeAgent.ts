/**
 * MockOpenCodeAgent — мок агента для тестирования.
 * T012: Не вызывает реальный OpenCode SDK, возвращает предопределённые ответы.
 *
 * Используется для:
 * - Unit тестов consumer логики
 * - Integration тестов без реального OpenCode
 * - CI/CD где SDK недоступен
 */

import { randomUUID } from 'node:crypto';
import type { IOpenCodeAgent, AgentResult, InvokeOptions } from './IOpenCodeAgent.js';

/**
 * Конфигурация мок агента.
 * Каждая конфигурация привязана к конкретному agentId.
 */
export interface MockAgentConfig {
  /** ID агента (должен совпадать с вызовом invoke) */
  agentId: string;
  /** Предопределённый ответ (по умолчанию: 'Mock response for {agentId}') */
  response?: string;
  /** Задержка в миллисекундах перед ответом */
  delayMs?: number;
  /** При true возвращает error вместо success */
  shouldError?: boolean;
  /** Сообщение об ошибке при shouldError=true */
  errorMessage?: string;
}

/**
 * Mock агент для тестирования.
 *
 * Особенности:
 * - Всегда возвращает предопределённые результаты
 * - Трекает активные сессии (abort работает корректно)
 * - Поддерживает таймауты через delayMs > timeoutMs
 * - sessionId всегда валидный UUID
 */
export class MockOpenCodeAgent implements IOpenCodeAgent {
  /** Map agentId → конфигурация */
  private readonly configMap: Map<string, MockAgentConfig>;

  /** Активные сессии (нужны для abort) */
  private readonly activeSessions: Set<string> = new Set();

  /**
   * Создать мок агента.
   *
   * @param configs - массив конфигураций для разных agentId
   */
  constructor(configs: MockAgentConfig[]) {
    this.configMap = new Map(configs.map(c => [c.agentId, c]));
  }

  /**
   * Вызвать мок агента.
   *
   * @param prompt - текст промпта (игнорируется в моке)
   * @param agentId - ID агента для поиска конфигурации
   * @param options - опции вызова (timeoutMs опционально)
   * @returns результат согласно конфигурации или ошибка
   */
  async invoke(
    _prompt: string,
    agentId: string,
    options?: InvokeOptions
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const sessionId = randomUUID();
    this.activeSessions.add(sessionId);

    try {
      const config = this.configMap.get(agentId);

      // Нет конфигурации для agentId
      if (!config) {
        return {
          status: 'error',
          sessionId,
          errorMessage: `No mock config for agentId: ${agentId}`,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Конфигурация с ошибкой
      if (config.shouldError) {
        return {
          status: 'error',
          sessionId,
          errorMessage: config.errorMessage ?? 'Mock error',
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Проверяем таймаут
      const delayMs = config.delayMs ?? 0;
      const timeoutMs = options?.timeoutMs ?? 30000;

      if (delayMs > timeoutMs) {
        return {
          status: 'timeout',
          sessionId,
          errorMessage: `Agent invocation timed out after ${timeoutMs}ms`,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Задержка если нужна
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Успешный ответ
      return {
        status: 'success',
        response: config.response ?? `Mock response for ${agentId}`,
        sessionId,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      // Убираем из активных после завершения
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Прервать активную сессию.
   *
   * @param sessionId - ID сессии для прерывания
   * @returns true если сессия была активна, false если нет
   */
  async abort(sessionId: string): Promise<boolean> {
    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Получить количество активных сессий.
   *
   * @returns количество активных сессий
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}