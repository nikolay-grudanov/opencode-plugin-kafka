/**
 * Unit tests for routing logic
 * @fileoverview Tests for matchRule function following TDD approach
 */

import { describe, it, expect } from 'vitest';
import { matchRule } from '../../src/core/routing.js';
import type { Rule } from '../../src/schemas/index.js';

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

    const result = matchRule(payload, rules);

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

    const result = matchRule(payload, rules);

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

    const result = matchRule(payload, rules);

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

    const result = matchRule(payload, rules);

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
    const resultNull = matchRule(null, rules);
    expect(resultNull).toBeNull();

    // Тест с undefined payload
    const resultUndefined = matchRule(undefined, rules);
    expect(resultUndefined).toBeNull();
  });

  // Дополнительный тест: empty rules array
  it('должен вернуть null для пустого массива правил', () => {
    const payload = { message: 'test' };
    const rules: Rule[] = [];

    const result = matchRule(payload, rules);

    expect(result).toBeNull();
  });

  // Дополнительный тест: invalid jsonPath handled gracefully
  it('должен корректно обрабатывать некорректные JSONPath выражения', () => {
    const payload = { message: 'test' };

    const rules: Rule[] = [
      {
        name: 'invalid-jsonpath',
        topic: 'test',
        agent: 'test-agent',
        condition: '[[invalid jsonpath',
      },
    ];

    // При некорректном JSONPath JSONPath бросит ошибку
    // Но это нормально — это будет обнаружено в runtime
    expect(() => matchRule(payload, rules)).not.toThrow();
  });

  // Дополнительный тест: сложные JSONPath выражения
  it('должен работать со сложными JSONPath выражениями', () => {
    const payload = {
      data: {
        items: [
          { id: 1, type: 'A', active: true },
          { id: 2, type: 'B', active: false },
        ],
      },
    };

    const rules: Rule[] = [
      {
        name: 'complex-filter',
        topic: 'test',
        agent: 'test-agent',
        condition: "$.data.items[?(@.active==true && @.type=='A')]",
      },
    ];

    const result = matchRule(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('complex-filter');
  });

  // Дополнительный тест: multiple conditions в разных правилах
  it('должен проверять несколько условий и вернуть первое совпавшее', () => {
    const payload = {
      data: [
        { type: 'CRITICAL', id: 1 },
        { type: 'INFO', id: 2 },
      ],
    };

    const rules: Rule[] = [
      {
        name: 'rule1',
        topic: 'test',
        agent: 'agent1',
        condition: '$.data[?(@.type=="CRITICAL")]',
      },
      {
        name: 'rule2',
        topic: 'test',
        agent: 'agent2',
        condition: '$.data[?(@.type=="INFO")]',
      },
    ];

    const result = matchRule(payload, rules);

    // Должно вернуть первое правило
    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('rule1');
  });

  // Дополнительный тест: правило без condition всегда совпадает
  it('должен всегда возвращать catch-all правило, даже если есть другие правила', () => {
    const payload = { anything: 'goes' };

    const rules: Rule[] = [
      {
        name: 'specific-rule',
        topic: 'test',
        agent: 'agent1',
        condition: '$.nonexistent == "value"',
      },
      {
        name: 'catch-all',
        topic: 'test',
        agent: 'agent2',
      },
    ];

    const result = matchRule(payload, rules);

    // Должно вернуть catch-all правило
    expect(result).toEqual(rules[1]);
    expect(result?.name).toBe('catch-all');
  });
});
