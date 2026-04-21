/**
 * Core routing logic for Kafka Router Plugin
 * @fileoverview Pure functions for message routing and rule matching
 */

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
  // TODO: Implement logic according to spec.md US2
  // This is a placeholder that will be implemented after tests are written
  throw new Error('matchRule not implemented yet');
}
