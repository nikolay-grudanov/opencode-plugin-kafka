/**
 * OpenCodeAgentAdapter — production реализация IOpenCodeAgent.
 * FR-006: Адаптер для реального OpenCode SDK.
 * T013: Имплементация адаптера с timeout, error handling и cleanup.
 *
 * Особенности:
 * - Promise.race для timeout
 * - best-effort cleanup (abort на timeout, delete на error)
 * - все ошибки оборачиваются в AgentResult
 */

import type { IOpenCodeAgent, AgentResult, InvokeOptions } from './IOpenCodeAgent.js';
import type { SDKClient } from '../types/opencode-sdk.js';
import { TimeoutError, AgentError } from './AgentError.js';
import { extractResponseText } from './utils.js';

/**
 * Адаптер для вызова OpenCode агентов через SDK.
 * Изолирует consumer logic от конкретной SDK реализации.
 */
export class OpenCodeAgentAdapter implements IOpenCodeAgent {
  /**
   * Создаёт адаптер с переданным SDK клиентом.
   *
   * @param client - SDK клиент (обычно инжектируется в plugin)
   */
  constructor(private readonly client: SDKClient) {}

  /**
   * Вызвать OpenCode агента с промптом.
   *
   * Создаёт новую сессию, отправляет prompt, обрабатывает ответ.
   * Все ошибки трансформируются в AgentResult — исключения никогда не летят.
   *
   * @param prompt - текст промпта для агента
   * @param agentId - ID OpenCode агента
   * @param options - опции вызова (timeoutMs)
   * @returns результат выполнения агента
   */
  async invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult> {
    const startTime = Date.now();
    let sessionId = '';

    try {
      // 1. Создаём новую сессию
      const session = await this.client.session.create({ body: { title: `kafka-plugin-${agentId}` } });
      sessionId = session.id;

      // 2. Устанавливаем timeout (по умолчанию 120 сек)
      const timeoutMs = options.timeoutMs ?? 120000;

      // 3. Проверяем signal на early abort (C2)
      if (options.signal?.aborted) {
        throw new AgentError('Operation was aborted');
      }

      // 4. Создаём промисы для race: timeout и abort signal
      const { promise: timeoutPromise, clear: cleanupTimeout } = this.createTimeoutPromise(timeoutMs);
      const { promise: signalPromise, clear: cleanupSignal } = this.createSignalPromise(options.signal);
      let response;
      try {
        response = await Promise.race([
          this.client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: 'text', text: prompt }],
              agent: agentId,
            },
          }),
          timeoutPromise,
          signalPromise,
        ]);
      } finally {
        cleanupTimeout();
        cleanupSignal();
      }

      // 5. Извлекаем текст из ответа
      const parts = response?.parts ?? [];
      const responseText = extractResponseText(parts);

      // 6. Успешный результат
      return {
        status: 'success',
        response: responseText,
        sessionId,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Логируем ошибку для диагностики
      const err = error instanceof Error ? error : new Error(String(error));

      // Best-effort cleanup: abort или delete
      await this.performCleanup(err, sessionId);

      // Формируем результат на основе типа ошибки
      if (err instanceof TimeoutError) {
        return {
          status: 'timeout',
          sessionId,
          errorMessage: err.message,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // C2: AbortSignal отмена
      if (err instanceof AgentError && err.message === 'Operation was aborted') {
        return {
          status: 'error',
          sessionId,
          errorMessage: err.message,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        status: 'error',
        sessionId,
        errorMessage: err.message,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Прервать активную сессию агента.
   *
   * best-effort — не бросает исключения, возвращает boolean.
   *
   * @param sessionId - ID сессии для прерывания
   * @returns true если успешно, false при ошибке
   */
  async abort(sessionId: string): Promise<boolean> {
    try {
      await this.client.session.abort({ path: { id: sessionId } });
      return true;
    } catch {
      return false;
    }
  }

  // ========================================================================
  // Приватные методы
  // ========================================================================

  /**
   * Создаёт Promise который отклоняется через указанное время.
   * Используется для Promise.race с prompt.
   *
   * @param timeoutMs - Таймаут в миллисекундах
   * @returns Объект с:
   *   - `promise` — Promise который reject TimeoutError через timeoutMs
   *   - `clear` — Функция очистки таймера (вызывать в finally)
   */
  private createTimeoutPromise(timeoutMs: number): { promise: Promise<never>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError(`Agent timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    return {
      promise,
      clear: () => {
        if (timer) clearTimeout(timer);
      },
    };
  }

  /**
   * Создаёт Promise который отклоняется при abort signal (C2).
   * Используется для Promise.race с prompt.
   *
   * @param signal - AbortSignal для отмены операции (опционально)
   * @returns Объект с:
   *   - `promise` — Promise который reject AgentError при abort
   *   - `clear` — Функция удаления слушателя (вызывать в finally)
   */
  private createSignalPromise(signal?: AbortSignal): { promise: Promise<never>; clear: () => void } {
    if (!signal) {
      return { promise: new Promise<never>(() => {}), clear: () => {} };
    }
    if (signal.aborted) {
      return { promise: Promise.reject(new AgentError('Operation was aborted')), clear: () => {} };
    }
    let handler: (() => void) | undefined;
    const promise = new Promise<never>((_, reject) => {
      handler = () => reject(new AgentError('Operation was aborted'));
      signal.addEventListener('abort', handler, { once: true });
    });
    return {
      promise,
      clear: () => {
        if (handler) signal.removeEventListener('abort', handler);
      },
    };
  }

  /**
   * Best-effort cleanup: abort при timeout, delete при ошибке.
   * Игнорирует любые ошибки cleanup — это best-effort.
   */
  private async performCleanup(error: Error, sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      if (error instanceof TimeoutError) {
        await this.client.session.abort({ path: { id: sessionId } });
      } else {
        await this.client.session.delete({ path: { id: sessionId } });
      }
    } catch {
      // Best-effort — игнорируем ошибки cleanup
    }
  }
}