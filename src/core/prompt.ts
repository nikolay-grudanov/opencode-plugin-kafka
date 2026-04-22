/**
 * Функции для построения промптов на основе правил маршрутизации.
 */

import { JSONPath } from 'jsonpath-plus';
import type { Rule } from './types.js';

/**
 * Строка fallback для случаев, когда поле не найдено.
 */
const FALLBACK_PROMPT = 'Process this payload';

/**
 * Извлекает текст промпта из payload на основе правил маршрутизации.
 *
 * @param payload - Произвольный JSON-объект сообщения из Kafka topic
 * @param rule - Правило маршрутизации с JSONPath выражением и опциональной командой
 * @returns Строка промпта для отправки агенту
 *
 * @example
 * ```ts
 * buildPrompt({ task: 'Test code' }, { command: 'test', prompt_field: '$.task' });
 * // Returns: '/test Test code'
 * ```
 */
export function buildPrompt(payload: unknown, rule: Rule): string {
  // 0. Быстрая проверка null/undefined payload
  if (payload === null || payload === undefined) {
    return FALLBACK_PROMPT;
  }

  // 1. Определяем JSONPath выражение (по умолчанию root '$')
  const path = rule.prompt_field ?? '$';

  // 2. Выполняем JSONPath запрос
  const result = JSONPath({ path, json: payload });

  // 3. Проверяем результат (пустой массив → поле не найдено)
  if (result.length === 0) {
    return FALLBACK_PROMPT;
  }

  const extracted = result[0];

  // 4. Обрабатываем null/undefined
  if (extracted === null || extracted === undefined) {
    return FALLBACK_PROMPT;
  }

  // 5. Преобразуем в строку
  let text: string;

  if (typeof extracted === 'string') {
    // Строка → используем как есть
    text = extracted;
  } else if (typeof extracted === 'object') {
    // Объект/массив → JSON.stringify (compact mode)
    text = JSON.stringify(extracted);
  } else {
    // Примитивные типы (number, boolean, etc) → fallback
    return FALLBACK_PROMPT;
  }

  // 6. Добавляем префикс команды если задан
  if (rule.command) {
    return `/${rule.command} ${text}`;
  }

  return text;
}
