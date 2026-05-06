/**
 * Утилита для измерения времени в тестах.
 */

export interface TimerHandle {
  /** Возвращает количество миллисекунд с момента запуска таймера. */
  elapsedMs: () => number;
  /** Возвращает количество секунд с момента запуска таймера (дробное значение). */
  elapsedSec: () => number;
}

/**
 * Создаёт новый таймер и возвращает handle для измерения elapsed времени.
 */
export function startTimer(): TimerHandle {
  const startTime = Date.now();

  return {
    elapsedMs: () => Date.now() - startTime,
    elapsedSec: () => (Date.now() - startTime) / 1000,
  };
}