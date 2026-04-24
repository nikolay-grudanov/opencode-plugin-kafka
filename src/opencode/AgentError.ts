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
  public readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    // Восстановление прототипа для instanceof в ES2022
    Object.setPrototypeOf(this, AgentError.prototype);
    this.originalError = originalError;
  }

  /**
   * Возвращает сообщение оригинальной ошибки.
   *
   * @returns сообщение оригинальной ошибки или undefined если originalError отсутствует
   */
  getOriginalErrorMessage(): string | undefined {
    if (!this.originalError) return undefined;
    return this.originalError instanceof Error
      ? this.originalError.message
      : String(this.originalError);
  }
}