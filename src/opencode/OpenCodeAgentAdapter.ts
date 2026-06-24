/**
 * OpenCodeAgentAdapter — production реализация IOpenCodeAgent.
 * FR-006: Адаптер для реального OpenCode SDK.
 * T013: Имплементация адаптера с timeout, error handling и cleanup.
 *
 * Особенности:
 * - Promise.race для timeout
 * - best-effort cleanup (abort на timeout, delete на error)
 * - все ошибки оборачиваются в AgentResult
 *
 * CRITICAL FIX: session.prompt() returns {data: undefined} because the LLM
 * response comes via SSE streaming. The adapter must poll session.messages()
 * to retrieve the actual assistant response.
 */

import type { IOpenCodeAgent, AgentResult, InvokeOptions } from './IOpenCodeAgent.js';
import type { SDKClient } from '../types/opencode-sdk.js';
import { TimeoutError, AgentError } from './AgentError.js';
import { extractResponseText } from './utils.js';

/**
 * Maximum number of polling attempts for getting the LLM response.
 * Poll interval: 1 second, total max wait: 30 seconds
 */
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 1000;

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
    // Валидация входных параметров
    if (!prompt?.trim()) {
      return {
        status: 'error',
        errorMessage: 'Prompt cannot be empty',
        sessionId: '',
        executionTimeMs: 0,
        timestamp: new Date().toISOString(),
      };
    }
    if (!agentId?.trim()) {
      return {
        status: 'error',
        errorMessage: 'Agent ID cannot be empty',
        sessionId: '',
        executionTimeMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const startTime = Date.now();
    let sessionId = '';

    try {
      // 1. Создаём новую сессию
      // hey-api wrapper возвращает { data: { id: ... }, error: null }
      const session = await this.client.session.create({
        body: { title: `kafka-plugin-${agentId}` },
      });
      sessionId = session.data?.id ?? '';
      if (!sessionId) {
        return {
          status: 'error',
          errorMessage: 'Empty session ID from SDK',
          sessionId: '',
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // 2. Устанавливаем timeout (по умолчанию 120 сек)
      const timeoutMs = options.timeoutMs ?? 120000;

      // 3. Проверяем signal на early abort (C2)
      if (options.signal?.aborted) {
        throw new AgentError('Operation was aborted');
      }

      // 4. Соз��аём промисы для race: timeout и abort signal
      const { promise: timeoutPromise, clear: cleanupTimeout } =
        this.createTimeoutPromise(timeoutMs);
      const { promise: signalPromise, clear: cleanupSignal } = this.createSignalPromise(
        options.signal
      );

      // 5. Send the prompt via session.prompt()
      // CRITICAL: session.prompt() returns {data: undefined} because the LLM response
      // comes via SSE streaming. The prompt is sent but we get no response body.
      try {
        await Promise.race([
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

      // 6. Poll session.messages() to get the LLM response
      // The session.prompt() sent the message but the actual response is delivered
      // via SSE. We need to poll for the assistant's response message.
      const responseText = await this.pollForResponse(sessionId, options.signal);

      // 7. Успешный результат
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

  // TODO: вызывающий код ожидает что session.prompt() вернёт ответ,
  // но реальный SDK возвращает {data: undefined}. Удалить после фикса SDK.
  /**
   * Polls session.messages() until the LLM response is received.
   *
   * The session.prompt() method sends the prompt but returns immediately
   * with {data: undefined} because the actual response comes via SSE.
   * We poll messages to retrieve the assistant's response.
   *
   * @param sessionId - ID сессии для polling
   * @param signal - AbortSignal для отмены
   * @returns текст ответа от LLM
   */
  private async pollForResponse(sessionId: string, signal?: AbortSignal): Promise<string> {
    let lastMessageCount = 0;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      // Check for abort signal
      if (signal?.aborted) {
        throw new AgentError('Operation was aborted');
      }

      // Get messages from the session
      const messagesResult = await this.client.session.messages({
        path: { id: sessionId },
      });

      const messages = messagesResult.data ?? [];
      const currentMessageCount = messages.length;

      // If we have more messages than before, check the latest assistant message
      if (currentMessageCount > lastMessageCount) {
        // Find the latest assistant message (the LLM response)
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'assistant' && msg.parts && msg.parts.length > 0) {
            // Found the assistant response
            const responseText = extractResponseText(msg.parts);
            if (responseText) {
              return responseText;
            }
          }
        }
      }

      lastMessageCount = currentMessageCount;

      // Wait before next poll
      await this.sleep(POLL_INTERVAL_MS);
    }

    // Timeout: no assistant response received after max attempts
    throw new TimeoutError(`No response received after ${MAX_POLL_ATTEMPTS} polling attempts`);
  }

  /**
   * Sleep helper for polling delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
  private createSignalPromise(signal?: AbortSignal): {
    promise: Promise<never>;
    clear: () => void;
  } {
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