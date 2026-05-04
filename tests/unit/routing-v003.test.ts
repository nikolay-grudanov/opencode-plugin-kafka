/**
 * Unit tests for spec 003 routing logic (matchRuleV003)
 * @fileoverview Tests for matchRuleV003 function following TDD approach
 */

import { describe, it, expect } from 'vitest';
import { matchRuleV003 } from '../../src/core/routing.js';
import type { RuleV003 } from '../../src/schemas/index.js';

// Тестовые данные - минимальные обязательные поля для всех RuleV003
const defaultRuleV003: Partial<RuleV003> = {
  agentId: 'test-agent',
  timeoutMs: 120_000,
  concurrency: 1,
};

describe('matchRuleV003', () => {
  // Тест 1: Rule with matching jsonPath returns that rule
  it('должен вернуть правило, если jsonPath совпадает с payload', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL', id: 'CVE-2024-1234' }],
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'critical-vulns',
        jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
        promptTemplate: 'Critical vuln: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('critical-vulns');
  });

  // Тест 2: Rule without matching jsonPath returns null
  it('должен вернуть null, если ни одно правило не совпадает', () => {
    const payload = {
      vulnerabilities: [{ severity: 'LOW', id: 'CVE-2024-1234' }],
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'critical-vulns',
        jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
        promptTemplate: 'Critical vuln: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toBeNull();
  });

  // Тест 3: No condition (empty jsonPath) — all paths match
  it('должен вернуть первое правило, если jsonPath возвращает результат', () => {
    const payload = {
      message: 'any message',
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'root-path',
        jsonPath: '$',
        promptTemplate: 'Root: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('root-path');
  });

  // Тест 4: First matching rule wins (multiple rules)
  it('должен вернуть первое совпавшее правило из нескольких', () => {
    const payload = {
      vulnerabilities: [{ severity: 'CRITICAL', id: 'CVE-2024-1234' }],
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'first-rule',
        jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
        promptTemplate: 'First: ${$}',
      } as RuleV003,
      {
        ...defaultRuleV003,
        name: 'second-rule',
        jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
        promptTemplate: 'Second: ${$}',
      } as RuleV003,
      {
        ...defaultRuleV003,
        name: 'third-rule',
        jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
        promptTemplate: 'Third: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('first-rule');
  });

  // Тест 5: Null/undefined payload handling
  it('должен корректно обрабатывать null и undefined payload', () => {
    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'root-path',
        jsonPath: '$',
        promptTemplate: 'Root: ${$}',
      } as RuleV003,
    ];

    // Тест с null payload
    const resultNull = matchRuleV003(null, rules);
    expect(resultNull).toBeNull();

    // Тест с undefined payload
    const resultUndefined = matchRuleV003(undefined, rules);
    expect(resultUndefined).toBeNull();
  });

  // Дополнительный тест: empty rules array
  it('должен вернуть null для пустого массива правил', () => {
    const payload = { message: 'test' };
    const rules: RuleV003[] = [];

    const result = matchRuleV003(payload, rules);

    expect(result).toBeNull();
  });

  // Дополнительный тест: invalid jsonPath handled gracefully
  it('должен корректно обрабатывать некорректные JSONPath выражения', () => {
    const payload = { message: 'test' };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'invalid-jsonpath',
        jsonPath: '[[invalid jsonpath',
        promptTemplate: 'Invalid: ${$}',
      } as RuleV003,
    ];

    // При некорректном JSONPath JSONPath бросет ошибку
    // Но это нормально — это будет обнаружено в runtime
    expect(() => matchRuleV003(payload, rules)).not.toThrow();
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

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'complex-filter',
        jsonPath: "$.data.items[?(@.active==true && @.type=='A')]",
        promptTemplate: 'Active A: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

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

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'rule1',
        jsonPath: '$.data[?(@.type=="CRITICAL")]',
        promptTemplate: 'Critical: ${$}',
      } as RuleV003,
      {
        ...defaultRuleV003,
        name: 'rule2',
        jsonPath: '$.data[?(@.type=="INFO")]',
        promptTemplate: 'Info: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    // Должно вернуть первое правило
    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('rule1');
  });

  // Дополнительный тест: JSONPath возвращает несколько элементов
  it('должен вернуть правило, если JSONPath возвращает несколько элементов', () => {
    const payload = {
      items: [1, 2, 3, 4, 5],
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'multiple-items',
        jsonPath: '$.items',
        promptTemplate: 'Items: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('multiple-items');
  });

  // Дополнительный тест: nested path access
  it('должен работать с deeply nested paths', () => {
    const payload = {
      level1: {
        level2: {
          level3: {
            value: 'found',
          },
        },
      },
    };

    const rules: RuleV003[] = [
      {
        ...defaultRuleV003,
        name: 'deep-path',
        jsonPath: '$.level1.level2.level3.value',
        promptTemplate: 'Value: ${$}',
      } as RuleV003,
    ];

    const result = matchRuleV003(payload, rules);

    expect(result).toEqual(rules[0]);
    expect(result?.name).toBe('deep-path');
  });
});