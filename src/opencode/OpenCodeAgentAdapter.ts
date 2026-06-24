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
 * spec-009 tool-based delivery:
 * - invoke() now registers a SessionWatcher and calls session.prompt()
 *   without waiting for the assistant response. The actual response is
 *   delivered via the send_to_kafka_<rule> tool (registered in src/index.ts).
 * - When `pollingFallback: true` (legacy config), the adapter uses the old
 *   blocking prompt + parse-response.parts flow.
 * - toolCalled and text capture are managed by session-watchers.ts and
 *   the tool-handler / event-handler modules.
 *
 * NOTE: invoke() returns immediately after session.prompt() resolves in the
 * tool-based mode. agentResult.response is empty — the real text arrives via
 * Kafka publish in the tool handler, not here. This is the spec-009 design.
 */

import type { IOpenCodeAgent, AgentResult, InvokeOptions } from './IOpenCodeAgent.js';
import type { SDKClient } from '../types/opencode-sdk.js';
import type { RuleV003 } from '../schemas/index.js';
import { TimeoutError, AgentError } from './AgentError.js';
import { extractResponseText } from './utils.js';
import { registerSessionWatcher } from './session-watchers.js';

/**
 * Mode the adapter operates in, controlled by the `pollingFallback` toggle.
 *
 * - 'tool-based' (spec-009 default): invoke() returns immediately after
 *   session.prompt(); tool delivery happens asynchronously.
 * - 'polling' (legacy spec-008): invoke() blocks for up to timeoutMs
 *   parsing session.prompt() response.parts directly.
 */
export type AdapterMode = 'tool-based' | 'polling';

/**
 * Адаптер для вызова OpenCode агентов через SDK.
 * Изолирует consumer logic от конкретной SDK реализации.
 */
export class OpenCodeAgentAdapter implements IOpenCodeAgent {
  /**
   * Mode is set by src/index.ts at construction time based on the
   * `pollingFallback` toggle from kafka-router.json. Defaults to 'tool-based'
   * (spec-009 recommended).
   */
  private readonly mode: AdapterMode;

  /**
   * Создаёт адаптер с переданным SDK клиентом.
   *
   * @param client - SDK клиент (обычно инжектируется в plugin)
   * @param mode - 'tool-based' (spec-009 default) or 'polling' (spec-008 fallback)
   */
  constructor(
    private readonly client: SDKClient,
    mode: AdapterMode = 'tool-based'
  ) {
    this.mode = mode;
  }

  /**
   * Вызвать OpenCode агента с промптом.
   *
   * Two modes (controlled by AdapterMode):
   *
   * Mode 'tool-based' (spec-009 default):
   *   1. Create session
   *   2. Register SessionWatcher
   *   3. Call session.prompt() (returns immediately — LLM response arrives
   *      asynchronously via SSE; tool-handler publishes to Kafka when LLM
   *      calls send_to_kafka_<rule>)
   *   4. Return AgentResult with empty response, success status, sessionId
   *   The actual response text is NOT in agentResult.response — it's in Kafka.
   *
   * Mode 'polling' (spec-008 fallback when pollingFallback: true):
   *   1. Create session
   *   2. Call session.prompt() with Promise.race timeout/signal
   *   3. Parse response.data.parts, extract text
   *   4. Return AgentResult with response text
   *   This is the legacy behavior — works but unreliable (5/8 e2e tests
   *   fail because session.prompt() returns {data: undefined} for streaming
   *   responses).
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

      // 2. Проверяем signal на early abort (C2)
      if (options.signal?.aborted) {
        throw new AgentError('Operation was aborted');
      }

      if (this.mode === 'polling') {
        // Legacy polling mode (spec-008 fallback) — blocks waiting for prompt response
        return await this.invokePolling(prompt, agentId, sessionId, options, startTime);
      }

      // Tool-based mode (spec-009 default) — returns immediately
      return await this.invokeToolBased(prompt, agentId, sessionId, options, startTime);
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
   * Tool-based invoke (spec-009): creates session, registers watcher,
   * calls session.prompt(), returns immediately. Response is delivered
   * asynchronously by the send_to_kafka_<rule> tool when the LLM calls it.
   *
   * NOTE: agentResult.response is intentionally empty. The real answer
   * lands in Kafka via the tool handler (src/opencode/tool-handler.ts),
   * not via this return value.
   */
  private async invokeToolBased(
    prompt: string,
    agentId: string,
    sessionId: string,
    _options: InvokeOptions,
    startTime: number
  ): Promise<AgentResult> {
    // Note: _options is unused in tool-based mode. The AbortSignal in
    // options is captured into the SessionWatcher's abortController for
    // event-handler to propagate shutdown. The outer `invoke()` already
    // checked options.signal.aborted before reaching here.
    // Register SessionWatcher so the event-handler (Phase 4) can track
    // whether the tool was called and send to DLQ if not.
    const abortController = new AbortController();
    const ruleStub: Pick<RuleV003, 'name' | 'agentId' | 'responseTopic'> = {
      name: agentId, // best-effort: agentId used as ruleName fallback
      agentId,
      responseTopic: undefined,
    };
    registerSessionWatcher(sessionId, ruleStub, abortController);

    // Send prompt. session.prompt() returns immediately with
    // {data: undefined} for streaming responses — that's OK, the tool
    // handler will publish the actual response when the LLM calls it.
    try {
      await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
          agent: agentId,
        },
      });
    } catch (error) {
      // Prompt failed to send — abort the watcher and propagate the error
      const err = error instanceof Error ? error : new Error(String(error));
      abortController.abort();
      throw err;
    }

    // Return success immediately. Real response is in Kafka, delivered
    // by send_to_kafka_<rule> tool handler.
    return {
      status: 'success',
      response: '', // intentionally empty in tool-based mode
      sessionId,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Polling invoke (spec-008 fallback): blocks for up to timeoutMs,
   * parses session.prompt() response.parts directly. Unreliable because
   * session.prompt() returns {data: undefined} for streaming LLM responses.
   */
  private async invokePolling(
    prompt: string,
    agentId: string,
    sessionId: string,
    options: InvokeOptions,
    startTime: number
  ): Promise<AgentResult> {
    const timeoutMs = options.timeoutMs ?? 120000;

    // Создаём промисы для race: timeout и abort signal
    const { promise: timeoutPromise, clear: cleanupTimeout } =
      this.createTimeoutPromise(timeoutMs);
    const { promise: signalPromise, clear: cleanupSignal } =
      this.createSignalPromise(options.signal);

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

    // Извлекаем текст из ответа
    const parts = response?.parts ?? [];
    const responseText = extractResponseText(parts);

    return {
      status: 'success',
      response: responseText,
      sessionId,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
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