/**
 * Функции для построения промптов на основе правил маршрутизации.
 */

import { JSONPath } from 'jsonpath-plus';
import type { RuleV003 } from '../schemas/index.js';

/**
 * Строка fallback для случаев, когда шаблон не может быть применён.
 */
const FALLBACK_PROMPT_V003 = 'Process this payload';

/**
 * Строит промпт на основе правила RuleV003 и payload (spec 003).
 *
 * Использует promptTemplate для генерации промпта с подстановкой JSONPath выражений.
 * Поддерживает placeholders вида ${...} для извлечения данных из payload.
 *
 * @param rule - Правило маршрутизации RuleV003 с jsonPath и promptTemplate
 * @param payload - Произвольный JSON-объект сообщения из Kafka topic
 * @returns Строка промпта для отправки агенту
 *
 * @example
 * ```ts
 * // Пример 1: Template substitution
 * const rule = {
 *   name: 'vuln-rule',
 *   jsonPath: '$.vulnerabilities',
 *   promptTemplate: 'Analyze vulnerabilities: ${$}'
 * };
 * const payload = { vulnerabilities: [{ severity: 'CRITICAL' }] };
 * buildPromptV003(rule, payload);
 * // Returns: 'Analyze vulnerabilities: [{"severity":"CRITICAL"}]'
 *
 * // Пример 2: Simple template without placeholders
 * const rule = {
 *   name: 'simple-rule',
 *   jsonPath: '$',
 *   promptTemplate: 'Process this message'
 * };
 * const payload = { message: 'Hello' };
 * buildPromptV003(rule, payload);
 * // Returns: 'Process this message'
 *
 * // Пример 3: Template with multiple placeholders
 * const rule = {
 *   name: 'multi-rule',
 *   jsonPath: '$',
 *   promptTemplate: 'User ${$.name} (ID: ${$.id})'
 * };
 * const payload = { name: 'Alice', id: 123 };
 * buildPromptV003(rule, payload);
 * // Returns: 'User Alice (ID: 123)'
 *
 * // Пример 4: Invalid JSONPath → fallback
 * const rule = {
 *   name: 'invalid-rule',
 *   jsonPath: '$',
 *   promptTemplate: 'Value: ${$.missing}'
 * };
 * const payload = { foo: 'bar' };
 * buildPromptV003(rule, payload);
 * // Returns: 'Process this payload'
 * ```
 */
export function buildPromptV003(rule: RuleV003, payload: unknown): string {
  // 0. Быстрая проверка null/undefined payload
  if (payload === null || payload === undefined) {
    return FALLBACK_PROMPT_V003;
  }

  // 1. Проверяем, содержит ли шаблон placeholders
  const template = rule.promptTemplate;
  const placeholderRegex = /\$\{([^}]+)\}/g;

  // Если нет placeholders — возвращаем шаблон как есть
  if (!placeholderRegex.test(template)) {
    return template;
  }

  // 2. Заменяем каждый placeholder
  let result = template;
  let match: RegExpExecArray | null;

  // Сбрасываем lastIndex для повторного использования regex
  placeholderRegex.lastIndex = 0;

  while ((match = placeholderRegex.exec(template)) !== null) {
    const [fullMatch, jsonPathExpr] = match;

    try {
      // Выполняем JSONPath запрос
      const extracted = JSONPath({ path: jsonPathExpr, json: payload });

      // Проверяем результат (пустой массив → поле не найдено)
      if (extracted.length === 0) {
        return FALLBACK_PROMPT_V003;
      }

      const value = extracted[0];

      // Проверяем null/undefined
      if (value === null || value === undefined) {
        return FALLBACK_PROMPT_V003;
      }

      // Преобразуем в строку
      let text: string;

      if (typeof value === 'string') {
        text = value;
      } else if (typeof value === 'object') {
        text = JSON.stringify(value);
      } else {
        text = String(value);
      }

      // Заменяем placeholder в шаблоне
      result = result.replace(fullMatch, text);
    } catch {
      // Если JSONPath execution failed → fallback
      return FALLBACK_PROMPT_V003;
    }
  }

  return result;
}
