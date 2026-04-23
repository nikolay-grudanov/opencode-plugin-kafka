/**
 * Unit tests for spec 003 prompt building (buildPromptV003)
 * @fileoverview Tests for buildPromptV003 function following TDD approach
 */

import { describe, it, expect } from 'vitest';
import { buildPromptV003 } from '../../src/core/prompt.js';
import type { RuleV003 } from '../../src/schemas/index.js';

describe('buildPromptV003', () => {
  describe('No placeholders — returns template as-is', () => {
    it('should return template unchanged when no placeholders present', () => {
      const payload = { message: 'Hello world' };
      const rule: RuleV003 = {
        name: 'no-placeholder',
        jsonPath: '$',
        promptTemplate: 'Simple template without placeholders',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Simple template without placeholders');
    });
  });

  describe('Single placeholder substitution', () => {
    it('should extract and substitute single placeholder', () => {
      const payload = { task: 'Audit the code' };
      const rule: RuleV003 = {
        name: 'single-placeholder',
        jsonPath: '$',
        promptTemplate: 'Task: ${$.task}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Task: Audit the code');
    });

    it('should extract from nested path', () => {
      const payload = {
        user: {
          name: 'Alice',
          email: 'alice@example.com',
        },
      };
      const rule: RuleV003 = {
        name: 'nested-placeholder',
        jsonPath: '$',
        promptTemplate: 'User: ${$.user.name} (${$.user.email})',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('User: Alice (alice@example.com)');
    });
  });

  describe('Multiple placeholders substitution', () => {
    it('should substitute all placeholders in order', () => {
      const payload = {
        user: 'Alice',
        task: 'Review PR #123',
        priority: 'HIGH',
      };
      const rule: RuleV003 = {
        name: 'multi-placeholder',
        jsonPath: '$',
        promptTemplate: '${$.user} needs to ${$.task} with ${$.priority} priority',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Alice needs to Review PR #123 with HIGH priority');
    });
  });

  describe('Array extraction with placeholder', () => {
    it('should substitute array as JSON string', () => {
      const payload = {
        items: [1, 2, 3, 4, 5],
      };
      const rule: RuleV003 = {
        name: 'array-placeholder',
        jsonPath: '$',
        promptTemplate: 'Items: ${$.items}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Items: [1,2,3,4,5]');
    });

    it('should substitute nested array', () => {
      const payload = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };
      const rule: RuleV003 = {
        name: 'nested-array',
        jsonPath: '$',
        promptTemplate: 'Matrix: ${$.matrix}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Matrix: [[1,2],[3,4]]');
    });
  });

  describe('Object extraction with placeholder', () => {
    it('should substitute object as JSON string', () => {
      const payload = {
        details: {
          name: 'Alice',
          age: 30,
          email: 'alice@example.com',
        },
      };
      const rule: RuleV003 = {
        name: 'object-placeholder',
        jsonPath: '$',
        promptTemplate: 'Details: ${$.details}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Details: {"name":"Alice","age":30,"email":"alice@example.com"}');
    });
  });

  describe('Primitive types substitution', () => {
    it('should substitute number 42 as string "42"', () => {
      const payload = { count: 42 };
      const rule: RuleV003 = {
        name: 'number-placeholder',
        jsonPath: '$',
        promptTemplate: 'Count: ${$.count}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Count: 42');
    });

    it('should substitute boolean true as string "true"', () => {
      const payload = { active: true };
      const rule: RuleV003 = {
        name: 'boolean-placeholder',
        jsonPath: '$',
        promptTemplate: 'Active: ${$.active}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Active: true');
    });

    it('should substitute boolean false as string "false"', () => {
      const payload = { active: false };
      const rule: RuleV003 = {
        name: 'boolean-false',
        jsonPath: '$',
        promptTemplate: 'Active: ${$.active}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Active: false');
    });

    it('should substitute BigInt as string', () => {
      const payload = { big: BigInt(42) };
      const rule: RuleV003 = {
        name: 'bigint-placeholder',
        jsonPath: '$',
        promptTemplate: 'Big: ${$.big}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Big: 42');
    });
  });

  describe('Fallback when placeholder not found', () => {
    it('should return fallback when JSONPath does not match any value', () => {
      const payload = { foo: 'bar' };
      const rule: RuleV003 = {
        name: 'missing-placeholder',
        jsonPath: '$',
        promptTemplate: 'Value: ${$.missing}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Fallback when extracted value is null/undefined', () => {
    it('should return fallback when extracted value is null', () => {
      const payload = { value: null };
      const rule: RuleV003 = {
        name: 'null-value',
        jsonPath: '$',
        promptTemplate: 'Value: ${$.value}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when extracted value is undefined', () => {
      const payload = { value: undefined };
      const rule: RuleV003 = {
        name: 'undefined-value',
        jsonPath: '$',
        promptTemplate: 'Value: ${$.value}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Fallback when payload is null/undefined', () => {
    it('should return fallback when payload is null', () => {
      const payload = null;
      const rule: RuleV003 = {
        name: 'null-payload',
        jsonPath: '$',
        promptTemplate: 'Value: ${$}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when payload is undefined', () => {
      const payload = undefined;
      const rule: RuleV003 = {
        name: 'undefined-payload',
        jsonPath: '$',
        promptTemplate: 'Value: ${$}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Non-object payloads handled', () => {
    it('should handle number as payload with root placeholder', () => {
      const payload = 42;
      const rule: RuleV003 = {
        name: 'number-payload',
        jsonPath: '$',
        promptTemplate: 'Value: ${$}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Value: 42');
    });

    it('should handle string as payload with root placeholder', () => {
      const payload = 'hello';
      const rule: RuleV003 = {
        name: 'string-payload',
        jsonPath: '$',
        promptTemplate: 'Value: ${$}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Value: hello');
    });
  });

  describe('Template substitution works with complex structures', () => {
    it('should correctly substitute multiple placeholders from complex object', () => {
      const payload = {
        project: {
          name: 'Kafka Plugin',
          version: '1.0.0',
          features: ['routing', 'parsing'],
        },
        author: 'Alice',
      };
      const rule: RuleV003 = {
        name: 'complex-structure',
        jsonPath: '$',
        promptTemplate: '${$.project.name} v${$.project.version} by ${$.author}. Features: ${$.project.features}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Kafka Plugin v1.0.0 by Alice. Features: ["routing","parsing"]');
    });
  });

  describe('Invalid JSONPath in placeholder', () => {
    it('should return fallback when JSONPath expression is invalid', () => {
      const payload = { message: 'test' };
      const rule: RuleV003 = {
        name: 'invalid-jsonpath',
        jsonPath: '$',
        promptTemplate: 'Value: ${[[invalid}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when JSONPath throws error during execution', () => {
      const payload = { message: 'test' };
      const rule: RuleV003 = {
        name: 'error-jsonpath',
        jsonPath: '$',
        promptTemplate: 'Value: ${$.missing[!(@.invalid)]}',
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when jsonPath parameter is invalid and throws during query', () => {
      // Этот тест покрывает catch block (lines 122-123) когда JSONPath.query() выбрасывает исключение
      // Для невалидного JSONPath в promptTemplate (не в jsonPath параметре) возвращается fallback
      const payload = { status: 'active' };
      const rule: RuleV003 = {
        name: 'invalid-placeholder',
        jsonPath: '$.status',
        promptTemplate: 'Value: ${[[invalid}', // Невалидный placeholder - синтаксическая ошибка в самом шаблоне
      };

      const result = buildPromptV003(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });
});
