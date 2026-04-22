/**
 * Core routing logic for Kafka Router Plugin
 * @fileoverview Pure functions for message routing and rule matching
 */

import { JSONPath } from 'jsonpath-plus';
import type { RuleV003, Payload } from '../schemas/index.js';

/**
 * Находит первое подходящее правило для payload (spec 003 — JSONPath routing).
 *
 * Использует RuleV003 с полем jsonPath для фильтрации сообщений.
 * Вызывающий код должен передать все правила для проверки.
 *
 * @param payload - JSON-объект сообщения из Kafka
 * @param rules - массив правил RuleV003 для проверки
 * @returns первое правило RuleV003, удовлетворяющее jsonPath, или null если ни одно не подошло
 *
 * @example
 * ```ts
 * // Пример 1: Rule с совпадающим jsonPath
 * const message = { vulnerabilities: [{ severity: 'CRITICAL' }] };
 * const rules = [{
 *   name: 'critical',
 *   jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
 *   promptTemplate: 'Analyze: ${$.vulnerabilities}'
 * }];
 * const matched = matchRuleV003(message, rules);
 * // matched: RuleV003 { name: 'critical', ... }
 *
 * // Пример 2: Catch-all правило (jsonPath: '$')
 * const message = { anything: 'goes' };
 * const rules = [{
 *   name: 'catch-all',
 *   jsonPath: '$',
 *   promptTemplate: 'Process: ${$}'
 * }];
 * const matched = matchRuleV003(message, rules);
 * // matched: RuleV003 { name: 'catch-all', ... }
 *
 * // Пример 3: Нет совпадений
 * const message = { status: 'LOW' };
 * const rules = [{
 *   name: 'critical',
 *   jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
 *   promptTemplate: 'Critical vuln: ${$}'
 * }];
 * const matched = matchRuleV003(message, rules);
 * // matched: null
 * ```
 */
export function matchRuleV003(payload: Payload, rules: RuleV003[]): RuleV003 | null {
  // Edge case: null/undefined payload
  if (payload === null || payload === undefined) {
    return null;
  }

  // Edge case: пустой массив правил
  if (rules.length === 0) {
    return null;
  }

  // Проверка каждого правила в порядке
  for (const rule of rules) {
    // Выполняем JSONPath запрос
    const results = JSONPath({ path: rule.jsonPath, json: payload });

    // Если results не пустой → совпадение
    if (results && results.length > 0) {
      return rule;
    }
  }

  // Ни одно правило не совпало
  return null;
}
