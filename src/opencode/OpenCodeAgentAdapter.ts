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
import type { SDKClient, MessagePart } from '../types/opencode-sdk.js';
import { TimeoutError } from './AgentError.js';

/**
 * Извлекает текстовый контент из ответа ассистента.
 * Фильтрует только text parts и объединяет их через двойной перевод строки.
 *
 * @param parts - массив частей сообщения
 * @returns объединённый текст
 */
export function extractResponseText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n\n');
}

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
      const session = await this.client.session.create({ body: {} });
      sessionId = session.id;

      // 2. Устанавливаем timeout (по умолчанию 120 сек)
      const timeoutMs = options.timeoutMs ?? 120000;

      // 3. Promptsешение с race против timeout
      const response = await Promise.race([
        this.client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text', text: prompt }],
            agent: agentId,
          },
        }),
        this.createTimeoutPromise(timeoutMs, agentId),
      ]);

      // 4. Извлекаем текст из ответа
      const responseText = extractResponseText(response.parts);

      // 5. Успешный результат
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
   */
  private createTimeoutPromise(timeoutMs: number, agentId: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new TimeoutError(`Agent ${agentId} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    );
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