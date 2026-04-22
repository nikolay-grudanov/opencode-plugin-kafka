import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/core/prompt';
import type { Rule } from '../../src/schemas/index.js';

describe('buildPrompt', () => {
  describe('Default prompt_field "$" extracts entire payload', () => {
    it('should use default "$" path when prompt_field is not specified', () => {
      const payload = { message: 'Hello world' };
      const rule: Rule = {
        name: 'default-path-rule',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('{"message":"Hello world"}');
    });
  });

  describe('Simple text field extraction with command prefix', () => {
    it('should extract text field and add command prefix', () => {
      const payload = { task_text: 'Audit the code' };
      const rule: Rule = {
        name: 'audit-rule',
        topic: 'tasks',
        agent: 'code-agent',
        command: 'audit',
        prompt_field: '$.task_text',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('/audit Audit the code');
    });
  });

  describe('Nested object field extraction returns JSON string', () => {
    it('should extract nested object and return JSON string', () => {
      const payload = {
        details: {
          name: 'Alice',
          age: 30,
          email: 'alice@example.com',
        },
      };
      const rule: Rule = {
        name: 'details-rule',
        topic: 'users',
        agent: 'user-agent',
        prompt_field: '$.details',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('{"name":"Alice","age":30,"email":"alice@example.com"}');
    });
  });

  describe('Array field extraction returns JSON string', () => {
    it('should extract array and return JSON string', () => {
      const payload = {
        items: [1, 2, 3, 4, 5],
      };
      const rule: Rule = {
        name: 'items-rule',
        topic: 'data',
        agent: 'data-agent',
        prompt_field: '$.items',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('[1,2,3,4,5]');
    });
  });

  describe('Fallback string when field not found', () => {
    it('should return fallback when JSONPath field does not exist in payload', () => {
      const payload = { foo: 'bar' };
      const rule: Rule = {
        name: 'fallback-rule',
        topic: 'fallback',
        agent: 'fallback-agent',
        prompt_field: '$.missing',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Null/undefined payload handling', () => {
    it('should return fallback when payload is null', () => {
      const payload = null;
      const rule: Rule = {
        name: 'null-rule',
        topic: 'null',
        agent: 'null-agent',
        prompt_field: '$',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when payload is undefined', () => {
      const payload = undefined;
      const rule: Rule = {
        name: 'undefined-rule',
        topic: 'undefined',
        agent: 'undefined-agent',
        prompt_field: '$',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Extracted field is null/undefined returns fallback', () => {
    it('should return fallback when extracted field is null', () => {
      const payload = { value: null };
      const rule: Rule = {
        name: 'null-value-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.value',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when extracted field is undefined', () => {
      const payload = { value: undefined };
      const rule: Rule = {
        name: 'undefined-value-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.value',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Primitive types return string representation', () => {
    it('should return "42" for number 42', () => {
      const payload = { count: 42 };
      const rule: Rule = {
        name: 'number-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.count',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('42');
    });

    it('should return "0" for number 0', () => {
      const payload = { count: 0 };
      const rule: Rule = {
        name: 'number-zero-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.count',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('0');
    });

    it('should return "true" for boolean true', () => {
      const payload = { active: true };
      const rule: Rule = {
        name: 'boolean-true-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.active',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('true');
    });

    it('should return "false" for boolean false', () => {
      const payload = { active: false };
      const rule: Rule = {
        name: 'boolean-false-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.active',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('false');
    });

    it('should return "42" for BigInt(42)', () => {
      const payload = { big: BigInt(42) };
      const rule: Rule = {
        name: 'bigint-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.big',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('42');
    });

    it('should return "" for empty string', () => {
      const payload = { text: '' };
      const rule: Rule = {
        name: 'empty-string-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.text',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('');
    });
  });

  describe('Non-object payloads handled', () => {
    it('should handle number as payload', () => {
      const payload = 42;
      const rule: Rule = {
        name: 'number-payload',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('42');
    });

    it('should handle string as payload', () => {
      const payload = 'hello';
      const rule: Rule = {
        name: 'string-payload',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('hello');
    });

    it('should handle boolean as payload', () => {
      const payload = true;
      const rule: Rule = {
        name: 'boolean-payload',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('true');
    });

    it('should handle array as payload', () => {
      const payload = [1, 2, 3];
      const rule: Rule = {
        name: 'array-payload',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('[1,2,3]');
    });
  });

  describe('Template substitution works', () => {
    it('should correctly substitute multiple placeholders', () => {
      const payload = {
        user: 'Alice',
        task: 'Review PR #123',
      };
      const rule: Rule = {
        name: 'multi-placeholder',
        topic: 'tasks',
        agent: 'task-agent',
        prompt_field: '$',
        command: 'assign',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('/assign {"user":"Alice","task":"Review PR #123"}');
    });

    it('should handle complex nested structures', () => {
      const payload = {
        project: {
          name: 'Kafka Plugin',
          version: '1.0.0',
          features: ['routing', 'parsing'],
        },
      };
      const rule: Rule = {
        name: 'complex-nested',
        topic: 'projects',
        agent: 'project-agent',
        prompt_field: '$.project',
      };

      const result = buildPrompt(rule, payload);

      expect(result).toBe('{"name":"Kafka Plugin","version":"1.0.0","features":["routing","parsing"]}');
    });
  });
});
