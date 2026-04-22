/**
 * Core routing logic for Kafka Router Plugin
 * @fileoverview Pure functions for message routing and rule matching
 */

import { JSONPath } from 'jsonpath-plus';
import type { Rule, RuleV003, Payload } from '../schemas/index.js';

/**
 * Находит первое подходящее правило для payload.
 *
 * Фильтрация по topic должна происходить ДО вызова этой функции.
 * Вызывающий код должен передать только правила для нужного topic.
 *
 * @param payload - JSON-объект сообщения из Kafka
 * @param rules - массив правил для проверки (уже отфильтрованных по topic)
 * @returns первое правило, удовлетворяющее условию, или null если ни одно не подошло
 *
 * @example
 * ```ts
 * // Пример 1: Rule с совпадающим condition
 * const message = { vulnerabilities: [{ severity: 'CRITICAL' }] };
 * const rules = [{
 *   name: 'critical',
 *   topic: 'security',
 *   agent: 'security-agent',
 *   condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]'
 * }];
 * const matched = matchRule(message, rules);
 * // matched: Rule { name: 'critical', ... }
 *
 * // Пример 2: Catch-all правило (без condition)
 * const message = { anything: 'goes' };
 * const rules = [{
 *   name: 'catch-all',
 *   topic: 'general',
 *   agent: 'general-agent'
 * }];
 * const matched = matchRule(message, rules);
 * // matched: Rule { name: 'catch-all', ... }
 *
 * // Пример 3: Нет совпадений
 * const message = { status: 'LOW' };
 * const rules = [{
 *   name: 'critical',
 *   topic: 'security',
 *   agent: 'security-agent',
 *   condition: '$.status == "CRITICAL"'
 * }];
 * const matched = matchRule(message, rules);
 * // matched: null
 * ```
 */
export function matchRule(payload: Payload, rules: Rule[]): Rule | null {
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
    // Если нет condition → catch-all, совпадает
    if (!rule.condition) {
      return rule;
    }

    // Если есть condition → используем JSONPath
    const results = JSONPath({ path: rule.condition, json: payload });

    // Если results не пустой → совпадение
    if (results && results.length > 0) {
      return rule;
    }
  }

  // Ни одно правило не совпало
  return null;
}

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
