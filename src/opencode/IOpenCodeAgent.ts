/**
 * IOpenCodeAgent — Mockable интерфейс для вызова OpenCode агентов.
 * FR-006: Interface isolates consumer logic от SDK implementation.
 *
 * Две реализации:
 * - OpenCodeAgentAdapter — production (real SDK client)
 * - MockOpenCodeAgent — tests (simulated responses)
 */

// ============================================================================
// Типы результата выполнения агента
// ============================================================================

/**
 * Статус выполнения агента.
 * - success: агент успешно выполнен, ответ доступен в response
 * - error: агент завершился с ошибкой, описание в errorMessage
 * - timeout: агент превысил лимит времени, best-effort abort выполнен
 */
export type AgentStatus = 'success' | 'error' | 'timeout';

/**
 * Результат вызова OpenCode агента.
 *
 * Инварианты:
 * - success → response заполнен, errorMessage отсутствует
 * - error → errorMessage заполнен, response отсутствует
 * - timeout → errorMessage заполнен, response отсутствует
 */
export interface AgentResult {
  /** Статус выполнения */
  status: AgentStatus;
  /** Текст ответа агента (фильтрация text parts, join через \n\n) */
  response?: string;
  /** ID созданной сессии */
  sessionId: string;
  /** Описание ошибки (при status='error' или 'timeout') */
  errorMessage?: string;
  /** Время выполнения в миллисекундах */
  executionTimeMs: number;
  /** ISO 8601 timestamp момента завершения */
  timestamp: string;
}

// ============================================================================
// Опции вызова
// ============================================================================

/**
 * Параметры вызова OpenCode агента.
 */
export interface InvokeOptions {
  /** Таймаут выполнения в миллисекундах */
  timeoutMs: number;
  /** Signal для отмены запроса (C2: заменяет фейковый UUID на AbortController) */
  signal?: AbortSignal;
}

// ============================================================================
// Интерфейс агента
// ============================================================================

/**
 * Mockable интерфейс для вызова OpenCode агентов.
 *
 * Изолирует consumer logic от SDK implementation.
 * Никогда не бросает исключения — все ошибки через AgentResult.
 */
export interface IOpenCodeAgent {
  /**
   * Вызвать OpenCode агента с промптом.
   *
   * @param prompt - текст промпта для агента
   * @param agentId - ID OpenCode агента
   * @param options - опции вызова (timeout)
   * @returns результат выполнения (никогда не бросает)
   */
  invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult>;

  /**
   * Прервать активную сессию агента.
   *
   * @param sessionId - ID сессии для прерывания
   * @returns true если успешно, false при ошибке
   */
  abort(sessionId: string): Promise<boolean>;
}