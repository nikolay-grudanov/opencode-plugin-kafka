/**
 * Unit tests for routing logic
 * @fileoverview Tests for matchRule function following TDD approach
 */

import { describe, it, expect } from 'vitest';
import { matchRule } from '../../src/core/routing.js';
import type { Rule } from '../../src/core/types.js';

describe('matchRule', () => {
  // Тест 1: Rule with matching condition returns that rule
  it('должен вернуть правило, если condition совпадает с payload', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL', id: 'CVE-2024-1234' }],
    };

    const rules: Rule[] = [
      {
        name: 'critical-vulns',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
    ];

    const result = matchRule(payload, 'security', rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('critical-vulns');
  });

  // Тест 2: Rule without matching condition returns null
  it('должен вернуть null, если ни одно правило не совпадает', () => {
    const payload = {
      vulnerabilities: [{ severity: 'LOW', id: 'CVE-2024-1234' }],
    };

    const rules: Rule[] = [
      {
        name: 'critical-vulns',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
    ];

    const result = matchRule(payload, 'security', rules);

    expect(result).toBeNull();
  });

  // Тест 3: Catch-all rule (no condition) always matches
  it('должен вернуть catch-all правило, если condition отсутствует', () => {
    const payload = {
      message: 'any message',
    };

    const rules: Rule[] = [
      {
        name: 'catch-all',
        topic: 'general',
        agent: 'general-agent',
      },
    ];

    const result = matchRule(payload, 'general', rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('catch-all');
  });

  // Тест 4: First matching rule wins (multiple rules)
  it('должен вернуть первое совпавшее правило из нескольких', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL', id: 'CVE-2024-1234' }],
    };

    const rules: Rule[] = [
      {
        name: 'first-rule',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
      {
        name: 'second-rule',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
      {
        name: 'third-rule',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
    ];

    const result = matchRule(payload, 'security', rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('first-rule');
  });

  // Тест 5: Null/undefined payload handling
  it('должен корректно обрабатывать null и undefined payload', () => {
    const rules: Rule[] = [
      {
        name: 'catch-all',
        topic: 'general',
        agent: 'general-agent',
      },
    ];

    // Тест с null payload
    const resultNull = matchRule(null, 'general', rules);
    expect(resultNull).toBeNull();

    // Тест с undefined payload
    const resultUndefined = matchRule(undefined, 'general', rules);
    expect(resultUndefined).toBeNull();
  });

  // Дополнительный тест: topic matching
  it('должен проверять topic правила при совпадении', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL' }],
    };

    const rules: Rule[] = [
      {
        name: 'security-rule',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
      {
        name: 'other-rule',
        topic: 'other-topic',
        agent: 'other-agent',
      },
    ];

    // Правило должно совпасть только для правильного topic
    const resultMatched = matchRule(payload, 'security', rules);
    expect(resultMatched?.name).toBe('security-rule');

    // Не должно совпасть для другого topic
    const resultNotMatched = matchRule(payload, 'other-topic', rules);
    expect(resultNotMatched?.name).not.toBe('security-rule');
  });

  // Дополнительный тест: empty rules array
  it('должен вернуть null для пустого массива правил', () => {
    const payload = { message: 'test' };
    const rules: Rule[] = [];

    const result = matchRule(payload, 'test-topic', rules);

    expect(result).toBeNull();
  });

  // Дополнительный тест: no rules for the specified topic
  it('должен вернуть null если нет правил для указанного topic', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL' }],
    };

    const rules: Rule[] = [
      {
        name: 'security-rule',
        topic: 'security',
        agent: 'security-agent',
        condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      },
    ];

    // Запрашиваем topic для которого нет правил
    const result = matchRule(payload, 'different-topic', rules);

    expect(result).toBeNull();
  });
});
