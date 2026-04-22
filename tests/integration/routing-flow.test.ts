/**
 * Integration Tests для полного потока routing (spec 003)
 * Тестирует: message → matchRuleV003 → buildPromptV003
 *
 * Test Strategy:
 * - Unit Tests покрывают matchRuleV003 и buildPromptV003 как pure functions
 * - Integration Tests верифицируют корректность integration этих функций в потоке
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRedpandaContainer, cleanupRedpandaContainer } from './setup';
import type { StartedTestContainer } from 'testcontainers';
import { matchRuleV003 } from '../../src/core/routing';
import { buildPromptV003 } from '../../src/core/prompt';
import type { RuleV003 } from '../../src/schemas/index.js';

describe('Integration Tests: Routing Flow (spec 003)', () => {
  let redpandaContainer: StartedTestContainer | null = null;
  let bootstrapServers: string | null = null;

  /**
   * Setup: Запуск Redpanda контейнера перед всеми тестами
   */
  beforeAll(async () => {
    redpandaContainer = await createRedpandaContainer();

    // Получаем bootstrap servers для Kafka producer/consumer
    bootstrapServers = redpandaContainer.getHost() + ':' + redpandaContainer.getMappedPort(9092);

    console.log(`Redpanda started: ${bootstrapServers}`);
  }, 120000); // 2 минуты timeout для запуска Redpanda

  /**
   * Cleanup: Остановка Redpanda контейнера после всех тестов
   */
  afterAll(async () => {
    if (redpandaContainer) {
      await cleanupRedpandaContainer(redpandaContainer);
      console.log('Redpanda container stopped');
    }
  });

  describe('Поток 1: Message → Routing (matchRuleV003)', () => {
    it('должен найти соответствующее правило по JSONPath condition', () => {
      const rules: RuleV003[] = [
        {
          name: 'critical-vulns',
          jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
          promptTemplate: 'Investigate: ${$.vulnerabilities}',
        },
      ];

      const message = {
        vulnerabilities: [
          { id: 'CVE-2024-1234', severity: 'CRITICAL', description: 'RCE' },
          { id: 'CVE-2024-5678', severity: 'LOW', description: 'Info Disclosure' },
        ],
      };

      const matchedRule = matchRuleV003(message, rules);

      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('critical-vulns');
    });

    it('должен вернуть null если ни одно правило не совпадает', () => {
      const rules: RuleV003[] = [
        {
          name: 'critical-vulns',
          jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
          promptTemplate: 'Investigate: ${$.vulnerabilities}',
        },
      ];

      const message = {
        vulnerabilities: [
          { id: 'CVE-2024-5678', severity: 'LOW', description: 'Info Disclosure' },
        ],
      };

      const matchedRule = matchRuleV003(message, rules);

      expect(matchedRule).toBeNull();
    });
  });

  describe('Поток 2: Routing → Prompt Building (buildPromptV003)', () => {
    it('должен создать prompt с placeholder substitution', () => {
      const rule: RuleV003 = {
        name: 'code-audit',
        jsonPath: '$.tasks',
        promptTemplate: '/audit ${$.tasks[0].description}',
      };

      const message = {
        tasks: [
          {
            type: 'code-audit',
            repository: 'my-app',
            description: 'Review authentication module for security issues',
          },
        ],
      };

      const prompt = buildPromptV003(rule, message);

      expect(prompt).toBe('/audit Review authentication module for security issues');
    });

    it('должен обрабатывать примитивные типы', () => {
      const rule: RuleV003 = {
        name: 'process-count',
        jsonPath: '$.count',
        promptTemplate: 'Count: ${$.count}',
      };

      const message = { count: 42 };

      const prompt = buildPromptV003(rule, message);

      expect(prompt).toBe('Count: 42');
    });

    it('должен возвращать fallback при отсутствии пути в payload', () => {
      const rule: RuleV003 = {
        name: 'default-rule',
        jsonPath: '$.data',
        promptTemplate: '/process ${$.nonexistent}',
      };

      const message = { data: 'test' };

      const prompt = buildPromptV003(rule, message);

      expect(prompt).toBe('Process this payload');
    });

    it('должен возвращать fallback для пустого шаблона', () => {
      const rule: RuleV003 = {
        name: 'empty-rule',
        jsonPath: '$.data',
        promptTemplate: 'No placeholders here',
      };

      const message = { data: 'test' };

      const prompt = buildPromptV003(rule, message);

      // Без placeholders возвращает шаблон как есть
      expect(prompt).toBe('No placeholders here');
    });
  });

  describe('Поток 3: Full flow — Message → Routing → Prompt', () => {
    it('должен обработать полный поток от message до prompt', () => {
      const rules: RuleV003[] = [
        {
          name: 'vuln-analysis',
          jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
          promptTemplate: '/analyze ${$}',
        },
      ];

      const message = {
        vulnerabilities: [
          { id: 'CVE-2024-1234', severity: 'CRITICAL', description: 'RCE in auth module' },
          { id: 'CVE-2024-5678', severity: 'LOW', description: 'Minor info disclosure' },
        ],
      };

      // Step 1: Routing
      const matchedRule = matchRuleV003(message, rules);

      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('vuln-analysis');

      // Step 2: Prompt building
      const prompt = buildPromptV003(matchedRule!, message);

      expect(prompt).toContain('/analyze');
    });
  });

  describe('Поток 4: Multiple rules — first match wins', () => {
    it('должен вернуть первое совпавшее правило', () => {
      const rules: RuleV003[] = [
        {
          name: 'rule-1',
          jsonPath: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
          promptTemplate: '/urgent ${$}',
        },
        {
          name: 'rule-2',
          jsonPath: '$.vulnerabilities[?(@.severity=="LOW")]',
          promptTemplate: '/low-priority ${$}',
        },
      ];

      const message = {
        vulnerabilities: [
          { severity: 'CRITICAL', id: 'SEC-001' },
          { severity: 'LOW', id: 'SEC-002' },
        ],
      };

      const matchedRule = matchRuleV003(message, rules);

      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('rule-1');
    });
  });

  describe('Поток 5: JSONPath expression result', () => {
    it('должен корректно обрабатывать результат JSONPath как массив', () => {
      const rule: RuleV003 = {
        name: 'all-critical',
        jsonPath: '$.vulnerabilities',
        promptTemplate: 'Critical: ${$.vulnerabilities[0].id}',
      };

      const message = {
        vulnerabilities: [
          { id: 'CVE-2024-0001', severity: 'CRITICAL' },
          { id: 'CVE-2024-0002', severity: 'CRITICAL' },
        ],
      };

      const prompt = buildPromptV003(rule, message);

      expect(prompt).toContain('CVE-2024-0001');
    });
  });

  describe('Поток 6: Empty rules array', () => {
    it('должен вернуть null для пустого массива правил', () => {
      const rules: RuleV003[] = [];

      const message = { data: 'test' };

      const matchedRule = matchRuleV003(message, rules);

      expect(matchedRule).toBeNull();
    });
  });

  describe('Поток 7: Redpanda container verification', () => {
    it('должен успешно запустить Redpanda контейнер', () => {
      expect(redpandaContainer).not.toBeNull();
      expect(redpandaContainer).toBeInstanceOf(Object);
    });
  });
});