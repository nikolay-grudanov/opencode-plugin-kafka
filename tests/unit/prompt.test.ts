import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/core/prompt';
import type { Rule } from '../../src/core/types';

describe('buildPrompt', () => {
  describe('Default prompt_field "$" extracts entire payload', () => {
    it('should use default "$" path when prompt_field is not specified', () => {
      const payload = { message: 'Hello world' };
      const rule: Rule = {
        name: 'default-path-rule',
        topic: 'test',
        agent: 'test-agent',
      };

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

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

      const result = buildPrompt(payload, rule);

      expect(result).toBe('Process this payload');
    });
  });

  describe('Primitive types return fallback', () => {
    it('should return fallback when extracted value is a number', () => {
      const payload = { count: 42 };
      const rule: Rule = {
        name: 'number-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.count',
      };

      const result = buildPrompt(payload, rule);

      expect(result).toBe('Process this payload');
    });

    it('should return fallback when extracted value is a boolean', () => {
      const payload = { active: true };
      const rule: Rule = {
        name: 'boolean-rule',
        topic: 'test',
        agent: 'test-agent',
        prompt_field: '$.active',
      };

      const result = buildPrompt(payload, rule);

      expect(result).toBe('Process this payload');
    });
  });
});
