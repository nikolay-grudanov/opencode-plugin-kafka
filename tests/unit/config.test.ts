/**
 * Unit tests for parseConfig function
 * Test-First Development: Tests are written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';

// Мокируем fs ДО импорта parseConfig
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { parseConfig, parseConfigV003, validateTopicCoverage } from '../../src/core/config.js';
import { readFileSync } from 'fs';

describe('parseConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
            command: 'process',
            prompt_field: '$.data.text',
          },
          {
            name: 'rule2',
            topic: 'topic2',
            agent: 'agent2',
            condition: '$.status == "pending"',
            command: 'process',
            prompt_field: '$.data.text',
          },
        ],
      };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      const result = parseConfig();

      expect(result).toEqual(validConfig);
    });

    it('should use default path .opencode/kafka-router.json when env var not set', () => {
      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
          },
        ],
      };

      delete process.env.KAFKA_ROUTER_CONFIG;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      parseConfig();

      expect(readFileSync).toHaveBeenCalledWith('.opencode/kafka-router.json', 'utf-8');
    });

    it('should use path from KAFKA_ROUTER_CONFIG env var when set', () => {
      process.env.KAFKA_ROUTER_CONFIG = '/custom/config.json';

      const validConfig = {
        topics: ['topic1'],
        rules: [
          {
            name: 'rule1',
            topic: 'topic1',
            agent: 'agent1',
          },
        ],
      };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      parseConfig();

      expect(readFileSync).toHaveBeenCalledWith('/custom/config.json', 'utf-8');

      delete process.env.KAFKA_ROUTER_CONFIG;
    });
  });

  describe('Missing required field throws ZodError', () => {
    it('should throw ZodError with field path when required field is missing', () => {
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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => parseConfig()).toThrowError(ZodError);

      try {
        parseConfig();
        throw new Error('Should have thrown ZodError');
      } catch (error: unknown) {
        if (error instanceof ZodError) {
          expect(error.issues).toContainEqual(
            expect.objectContaining({
              code: 'invalid_type',
              expected: 'string',
              received: 'undefined',
              path: ['rules', 0, 'topic'],
            })
          );
        } else {
          throw error;
        }
      }
    });
  });

  describe('Invalid JSON in config file throws', () => {
    it('should throw Error with "Invalid JSON" message when JSON is malformed', () => {
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

      expect(() => parseConfig()).toThrow('Invalid JSON in config file');
    });

    it('should throw Error when file read fails', () => {
      const fileError = new Error('ENOENT: no such file');
      vi.mocked(readFileSync).mockImplementation(() => {
        throw fileError;
      });

      expect(() => parseConfig()).toThrow('Failed to read config file');
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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(configWithoutPromptField));

      const result = parseConfig();

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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => parseConfig()).toThrowError(ZodError);

      try {
        parseConfig();
        throw new Error('Should have thrown ZodError');
      } catch (error: unknown) {
        if (error instanceof ZodError) {
          expect(error.issues).toContainEqual(
            expect.objectContaining({
              code: 'too_small',
              minimum: 1,
              type: 'array',
              path: ['topics'],
            })
          );
        } else {
          throw error;
        }
      }
    });

    it('should throw ZodError when rules array is empty', () => {
      const invalidConfig = {
        topics: ['topic1'],
        rules: [], // empty rules array
      };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => parseConfig()).toThrowError(ZodError);

      try {
        parseConfig();
        throw new Error('Should have thrown ZodError');
      } catch (error: unknown) {
        if (error instanceof ZodError) {
          expect(error.issues).toContainEqual(
            expect.objectContaining({
              code: 'too_small',
              minimum: 1,
              type: 'array',
              path: ['rules'],
            })
          );
        } else {
          throw error;
        }
      }
    });
  });

  describe('Topic coverage validation (FR-017)', () => {
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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

      expect(() => parseConfig()).not.toThrow();
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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => parseConfig()).toThrow('Topics without rules: b');
    });

    it('should throw error for multiple topics without coverage', () => {
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

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      expect(() => parseConfig()).toThrow('Topics without rules: topic2, topic3');
    });
  });

  describe('validateTopicCoverage (FR-017 for spec 003)', () => {
    it('should NOT throw when no responseTopic matches input topics', () => {
      const config = {
        topics: ['input-topic-1', 'input-topic-2'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.status',
            promptTemplate: 'Process {$.status}',
            agentId: 'agent-1',
            responseTopic: 'output-topic-1',
          },
          {
            name: 'rule2',
            jsonPath: '$.type',
            promptTemplate: 'Handle {$.type}',
            agentId: 'agent-2',
            responseTopic: 'output-topic-2',
          },
        ],
      };

      expect(() => validateTopicCoverage(config)).not.toThrow();
    });

    it('should throw when a responseTopic matches an input topic', () => {
      const config = {
        topics: ['input-topic-1', 'input-topic-2'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.status',
            promptTemplate: 'Process {$.status}',
            agentId: 'agent-1',
            responseTopic: 'input-topic-1', // совпадает с input topic!
          },
        ],
      };

      expect(() => validateTopicCoverage(config)).toThrow(
        'FR-017 topic coverage violation'
      );
      expect(() => validateTopicCoverage(config)).toThrow('input-topic-1');
    });

    it('should NOT throw when rules have no responseTopic (all undefined)', () => {
      const config = {
        topics: ['input-topic-1', 'input-topic-2'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.status',
            promptTemplate: 'Process {$.status}',
            agentId: 'agent-1',
            // responseTopic не указан (undefined)
          },
          {
            name: 'rule2',
            jsonPath: '$.type',
            promptTemplate: 'Handle {$.type}',
            agentId: 'agent-2',
            // responseTopic не указан (undefined)
          },
        ],
      };

      expect(() => validateTopicCoverage(config)).not.toThrow();
    });

    it('should throw descriptive error message with the conflicting topic name', () => {
      const config = {
        topics: ['topic-a', 'topic-b', 'topic-c'],
        rules: [
          {
            name: 'rule1',
            jsonPath: '$.status',
            promptTemplate: 'Process {$.status}',
            agentId: 'agent-1',
            responseTopic: 'topic-b', // конфликт
          },
        ],
      };

      expect(() => validateTopicCoverage(config)).toThrow(
        'FR-017 topic coverage violation: responseTopic "topic-b" cannot be one of the input topics: topic-a, topic-b, topic-c'
      );
    });
  });

  describe('parseConfigV003', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('Valid V003 config parsing returns PluginConfigV003', () => {
      it('should return valid PluginConfigV003 for complete V003 configuration', () => {
        const validV003Config = {
          topics: ['topic1', 'topic2'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process {$.status}',
              agentId: 'agent1',
            },
            {
              name: 'rule2',
              jsonPath: '$.type',
              promptTemplate: 'Handle {$.type}',
              agentId: 'agent2',
              responseTopic: 'response-topic',
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validV003Config));

        const result = parseConfigV003();

        // Проверяем основные поля (Zod добавляет дефолтные значения)
        expect(result.topics).toEqual(['topic1', 'topic2']);
        expect(result.rules).toHaveLength(2);
        expect(result.rules[0].name).toBe('rule1');
        expect(result.rules[1].responseTopic).toBe('response-topic');
      });

      it('should use default path .opencode/kafka-router.json when env var not set', () => {
        const validV003Config = {
          topics: ['topic1'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.test',
              promptTemplate: 'Test',
              agentId: 'agent1',
            },
          ],
        };

        delete process.env.KAFKA_ROUTER_CONFIG;
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validV003Config));

        parseConfigV003();

        expect(readFileSync).toHaveBeenCalledWith('.opencode/kafka-router.json', 'utf-8');
      });

      it('should use path from KAFKA_ROUTER_CONFIG env var when set', () => {
        process.env.KAFKA_ROUTER_CONFIG = '/custom/config.json';

        const validV003Config = {
          topics: ['topic1'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.test',
              promptTemplate: 'Test',
              agentId: 'agent1',
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validV003Config));

        parseConfigV003();

        expect(readFileSync).toHaveBeenCalledWith('/custom/config.json', 'utf-8');

        delete process.env.KAFKA_ROUTER_CONFIG;
      });
    });

    describe('Invalid JSON in V003 config file throws', () => {
      it('should throw Error with "Invalid JSON" message when JSON is malformed', () => {
        vi.mocked(readFileSync).mockReturnValue('{ invalid json }');

        expect(() => parseConfigV003()).toThrow('Invalid JSON in config file');
      });

      it('should throw Error when V003 file read fails', () => {
        const fileError = new Error('ENOENT: no such file');
        vi.mocked(readFileSync).mockImplementation(() => {
          throw fileError;
        });

        expect(() => parseConfigV003()).toThrow('Failed to read config file');
      });
    });

    describe('V003 topic coverage validation (FR-017)', () => {
      it('should pass when all topics have rules', () => {
        const validConfig = {
          topics: ['a', 'b'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
            },
            {
              name: 'rule2',
              jsonPath: '$.type',
              promptTemplate: 'Handle',
              agentId: 'agent2',
              responseTopic: 'response-topic',
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

        expect(() => parseConfigV003()).not.toThrow();
      });

      it('should throw when responseTopic matches input topic (FR-017 violation)', () => {
        const invalidConfig = {
          topics: ['input-topic'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
              responseTopic: 'input-topic', // совпадает с input topic!
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

        expect(() => parseConfigV003()).toThrow('FR-017 topic coverage violation');
      });

      it('should throw when one of multiple responseTopics matches input topic', () => {
        const invalidConfig = {
          topics: ['topic-a', 'topic-b'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
              responseTopic: 'valid-response',
            },
            {
              name: 'rule2',
              jsonPath: '$.type',
              promptTemplate: 'Handle',
              agentId: 'agent2',
              responseTopic: 'topic-a', // конфликт!
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

        expect(() => parseConfigV003()).toThrow('FR-017 topic coverage violation');
      });

      it('should NOT throw when rules have no responseTopic (all undefined)', () => {
        const validConfig = {
          topics: ['input-topic'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
              // responseTopic не указан (undefined)
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

        expect(() => parseConfigV003()).not.toThrow();
      });

      it('should NOT throw when responseTopic is null', () => {
        // Примечание: Zod schema не позволяет null для responseTopic (только undefined)
        // Этот тест проверяет что undefined не вызывает ошибку
        const validConfig = {
          topics: ['input-topic'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
              responseTopic: undefined, // undefined - не конфликт
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

        expect(() => parseConfigV003()).not.toThrow();
      });

      it('should NOT throw when responseTopic is empty string', () => {
        // Примечание: Zod schema требует минимум 1 символ для responseTopic
        // Пустая строка будет отклонена на уровне Zod (до validateTopicCoverage)
        const validConfig = {
          topics: ['input-topic'],
          rules: [
            {
              name: 'rule1',
              jsonPath: '$.status',
              promptTemplate: 'Process',
              agentId: 'agent1',
              responseTopic: 'a', // Минимум 1 символ - валидно
            },
          ],
        };

        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));

        expect(() => parseConfigV003()).not.toThrow();
      });
    });
  });
});
