/**
 * Unit tests for parseConfig function
 * Test-First Development: Tests are written before implementation
 */

import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../src/core/config';
import { ZodError } from 'zod';
import type { PluginConfig } from '../../src/schemas/index.js';

describe('parseConfig', () => {
  describe('Valid config parsing returns PluginConfig', () => {
    it('should return valid PluginConfig for complete configuration', () => {
      const validConfig = {
        topics: ['topic1', 'topic2'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
            condition: '$.status == "active"',
            command: '/process',
            prompt_field: '$.data.text',
          },
          {
            name: 'rule2',
            topic: 'topic2',
            agent: 'agent2',
            condition: '$.status == "pending"',
            command: '/process',
            prompt_field: '$.data.text',
          },
        ],
      };

      const result = parseConfig(validConfig);

      expect(result).toEqual(validConfig);
    });
  });

  describe('Missing required field throws ZodError', () => {
    it('should throw ZodError with field path, expected type, and actual value when required field is missing', () => {
      const invalidConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            // missing topic (required field)
            agent: 'agent1',
          },
        ],
      };

      expect(() => parseConfig(invalidConfig)).toThrowError(ZodError);

      try {
        parseConfig(invalidConfig);
        throw new Error('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect(error.issues).toContainEqual(
          expect.objectContaining({
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['rules', 0, 'topic'],
          })
        );
      }
    });
  });

  describe('Null/undefined payload throws ZodError', () => {
    it('should throw ZodError for null payload', () => {
      expect(() => parseConfig(null)).toThrowError(ZodError);
    });

    it('should throw ZodError for undefined payload', () => {
      expect(() => parseConfig(undefined)).toThrowError(ZodError);
    });
  });

  describe('Missing optional prompt_field defaults to "$"', () => {
    it('should set default value for prompt_field when not provided', () => {
      const configWithoutPromptField = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
            // missing prompt_field (optional field)
          },
        ],
      };

      const result = parseConfig(configWithoutPromptField);

      expect(result.rules[0].prompt_field).toBe('$');
    });
  });

  describe('Empty topics/rules array throws ZodError', () => {
    it('should throw ZodError when topics array is empty', () => {
      const invalidConfig = {
        topics: [], // empty topics array
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
          },
        ],
      };

      expect(() => parseConfig(invalidConfig)).toThrowError(ZodError);

      try {
        parseConfig(invalidConfig);
        throw new Error('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect(error.issues).toContainEqual(
          expect.objectContaining({
            code: 'too_small',
            minimum: 1,
            type: 'array',
            path: ['topics'],
          })
        );
      }
    });

    it('should throw ZodError when rules array is empty', () => {
      const invalidConfig = {
        topics: ['topic1'],
        rules: [], // empty rules array
      };

      expect(() => parseConfig(invalidConfig)).toThrowError(ZodError);

      try {
        parseConfig(invalidConfig);
        throw new Error('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect(error.issues).toContainEqual(
          expect.objectContaining({
            code: 'too_small',
            minimum: 1,
            type: 'array',
            path: ['rules'],
          })
        );
      }
    });
  });

  describe('Topic coverage validation', () => {
    it('should pass when all topics have rules', () => {
      const validConfig = {
        topics: ['a', 'b'],
        rules: [
          {
            name: 'rule1',
            topic: 'a',
            agent: 'agent1',
          },
          {
            name: 'rule2',
            topic: 'b',
            agent: 'agent2',
          },
        ],
      };

      expect(() => parseConfig(validConfig)).not.toThrow();
    });

    it('should throw "Topics without rules: b" when topic b has no rule', () => {
      const invalidConfig = {
        topics: ['a', 'b'],
        rules: [
          {
            name: 'rule1',
            topic: 'a',
            agent: 'agent1',
          },
        ],
      };

      expect(() => parseConfig(invalidConfig)).toThrow('Topics without rules: b');
    });

    it('should throw error for topic without coverage', () => {
      const invalidConfig = {
        topics: ['topic1', 'topic2', 'topic3'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
          },
          {
            name: 'rule2',
            topic: 'topic1',
            agent: 'agent2',
          },
        ],
      };

      expect(() => parseConfig(invalidConfig)).toThrow('Topics without rules: topic2, topic3');
    });
  });
});
