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
      const { promise: timeoutPromise, clear: clearTimeout } = this.createTimeoutPromise(timeoutMs);
      const signalPromise = this.createSignalPromise(options.signal);
      const response = await Promise.race([
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
      clearTimeout();

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
   * Возвращает объект с promise и функцией очистки таймера.
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
   */
  private createSignalPromise(signal?: AbortSignal): Promise<never> {
    return new Promise<never>((_, reject) => {
      if (!signal) {
        // Без signal — никогда не отклоняем
        return;
      }
      if (signal.aborted) {
        reject(new AgentError('Operation was aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(new AgentError('Operation was aborted'));
      }, { once: true });
    });
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