/**
 * Polling utility для замены fixed setTimeout в integration tests.
 * Повторяет проверку condition пока она не вернёт true или не истечёт timeout.
 */

export interface WaitForOptions {
  /** Максимальное время ожидания в ms (default: 10000) */
  timeoutMs?: number;
  /** Интервал между проверками в ms (default: 200) */
  intervalMs?: number;
  /** Сообщение об ошибке при таймауте */
  timeoutMessage?: string;
}

/**
 * Ждёт пока conditionFn не вернёт truthy значение.
 * Использует polling с configurable timeout и interval.
 *
 * @example
 * await waitFor(() => processedMessages.length >= 3, {
 *   timeoutMs: 15000,
 *   timeoutMessage: 'Не все 3 сообщения были обработаны за 15с'
 * });
 */
export async function waitFor(
  conditionFn: () => boolean | Promise<boolean>,
  options: WaitForOptions = {}
): Promise<void> {
  const { timeoutMs = 10000, intervalMs = 200, timeoutMessage } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await conditionFn();
    if (result) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    timeoutMessage ?? `waitFor: condition not met within ${timeoutMs}ms`
  );
}

/**
 * Ждёт пока async conditionFn не resolve успешно.
 * Полезно для awaiting assertion-based checks.
 *
 * @example
 * await waitForExpect(async () => {
 *   expect(processedMessages.length).toBe(3);
 * }, { timeoutMs: 15000 });
 */
export async function waitForExpect(
  assertionFn: () => void | Promise<void>,
  options: WaitForOptions = {}
): Promise<void> {
  const { timeoutMs = 10000, intervalMs = 200, timeoutMessage } = options;
  const startTime = Date.now();
  let lastError: unknown;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await assertionFn();
      return; // Assertion passed
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  if (timeoutMessage) {
    throw new Error(timeoutMessage);
  }
  throw lastError;
}