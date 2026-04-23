/**
 * AgentError — кастомные ошибки для OpenCode agent integration.
 * FR-009: Специфичные классы ошибок для timeout и agent failures.
 */

/**
 * Ошибка таймаута при выполнении агента.
 * Генерируется когда Promise.race timeout побеждает agent response.
 */
export class TimeoutError extends Error {
  public override readonly name = 'TimeoutError';

  constructor(message: string) {
    super(message);
    // Восстановление прототипа для instanceof в ES2022
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Общая ошибка при выполнении агента.
 * Оборачивает ошибки SDK в domain-specific error.
 */
export class AgentError extends Error {
  public override readonly name = 'AgentError';
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message);
    // Восстановление прототипа для instanceof в ES2022
    Object.setPrototypeOf(this, AgentError.prototype);
    this.originalError = originalError;
  }
}