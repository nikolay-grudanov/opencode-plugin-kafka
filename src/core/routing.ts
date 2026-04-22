/**
 * Core routing logic for Kafka Router Plugin
 * @fileoverview Pure functions for message routing and rule matching
 */

import { JSONPath } from 'jsonpath-plus';
import type { Rule, Payload } from './types.js';

/**
 * Находит первое подходящее правило для payload и topic.
 *
 * @param payload - JSON-объект сообщения из Kafka
 * @param topic - имя Kafka topic
 * @param rules - массив правил для проверки
 * @returns первое правило, удовлетворяющее условию, или null если ни одно не подошло
 *
 * @example
 * ```ts
 * const message = { vulnerabilities: [{ severity: 'CRITICAL' }] };
 * const rules = [{
 *   name: 'critical',
 *   topic: 'security',
 *   agent: 'security-agent',
 *   condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]'
 * }];
 * const matched = matchRule(message, 'security', rules);
 * // matched: Rule { name: 'critical', ... }
 * ```
 */
export function matchRule(payload: Payload, topic: string, rules: Rule[]): Rule | null {
  // Edge case: null/undefined payload
  if (payload === null || payload === undefined) {
    return null;
  }

  // Edge case: пустой массив правил
  if (rules.length === 0) {
    return null;
  }

  // Фильтрация по topic
  const filteredRules = rules.filter((rule) => rule.topic === topic);

  // Если нет правил для этого topic
  if (filteredRules.length === 0) {
    return null;
  }

  // Проверка каждого правила в порядке
  for (const rule of filteredRules) {
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
