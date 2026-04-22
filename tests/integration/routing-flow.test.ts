/**
 * Integration Tests для полного потока routing
 * Тестирует: message → routing → prompt building
 *
 * Test Strategy:
 * - Unit Tests покрывают parseConfig, matchRule, buildPrompt как pure functions
 * - Integration Tests верифицируют корректность integration этих функций в потоке
 * - OpenCode session invocation за-mock'ен (проверяются вызовы с правильными параметрами)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRedpandaContainer, cleanupRedpandaContainer } from './setup';
import type { StartedTestContainer } from 'testcontainers';
import { parseConfig } from '../../src/core/config';
import { matchRule } from '../../src/core/routing';
import { buildPrompt } from '../../src/core/prompt';
import type { Rule, PluginConfig } from '../../src/core/types';

describe('Integration Tests: Routing Flow', () => {
  let redpandaContainer: StartedTestContainer | null = null;
  let bootstrapServers: string | null = null;

  /**
   * Setup: Запуск Redpanda контейнера перед всеми тестами
   */
  beforeAll(async () => {
    redpandaContainer = await createRedpandaContainer();

    // Получаем bootstrap servers для Kafka producer/consumer
    // В реальном продакшен коде здесь настраивался бы Kafka client
    // Для integration тестов мы используем только container startup verification
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

  describe('Поток 1: Message → Parse Config → Routing', () => {
    it('должен успешно распарсить конфигурацию и найти соответствующее правило', () => {
      // Step 1: Config parsing (message → config)
      const rawConfig = {
        topics: ['security-events'],
        rules: [
          {
            name: 'critical-vulns',
            topic: 'security-events',
            agent: 'security-agent',
            condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
            command: 'investigate',
            prompt_field: '$.vulnerabilities',
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      expect(config).toBeDefined();
      expect(config.topics).toEqual(['security-events']);
      expect(config.rules).toHaveLength(1);

      // Step 2: Message matching (routing logic)
      const message = {
        vulnerabilities: [
          { id: 'CVE-2024-1234', severity: 'CRITICAL', description: 'RCE' },
          { id: 'CVE-2024-5678', severity: 'LOW', description: 'Info Disclosure' },
        ],
      };

      const matchedRule: Rule | null = matchRule(message, 'security-events', config.rules);

      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('critical-vulns');
      expect(matchedRule?.agent).toBe('security-agent');
      expect(matchedRule?.command).toBe('investigate');
    });
  });

  describe('Поток 2: Message → Routing → Prompt Building (Array filter)', () => {
    it('должен создать правильный prompt с command prefix из совпавшего правила', () => {
      // Step 1: Config parsing
      const rawConfig = {
        topics: ['audit-tasks'],
        rules: [
          {
            name: 'code-audit',
            topic: 'audit-tasks',
            agent: 'code-review-agent',
            condition: '$.tasks[?(@.type=="code-audit")]',
            command: 'audit',
            prompt_field: '$.tasks[0].description',
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      // Step 2: Message matching (filter expression for array)
      const message = {
        tasks: [
          {
            type: 'code-audit',
            repository: 'my-app',
            description: 'Review authentication module for security issues',
          },
        ],
      };

      const matchedRule: Rule | null = matchRule(message, 'audit-tasks', config.rules);

      expect(matchedRule).not.toBeNull();

      // Step 3: Prompt building
      const prompt: string = buildPrompt(message, matchedRule!);

      // Проверяем что prompt содержит command prefix
      expect(prompt).toMatch(/^\/audit\s+/);
      // Проверяем что prompt содержит описание
      expect(prompt).toContain('Review authentication module for security issues');
    });
  });

  describe('Поток 3: Catch-all routing с default prompt_field', () => {
    it('должен использовать catch-all правило и default prompt_field "$"', () => {
      // Step 1: Config parsing (catch-all rule без condition)
      const rawConfig = {
        topics: ['general'],
        rules: [
          {
            name: 'default-handler',
            topic: 'general',
            agent: 'general-agent',
            // нет condition = catch-all
            // нет prompt_field = default "$"
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      // Step 2: Message matching (любое сообщение совпадет с catch-all)
      const message = {
        data: 'some random data',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const matchedRule: Rule | null = matchRule(message, 'general', config.rules);

      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('default-handler');

      // Step 3: Prompt building (default prompt_field = "$")
      const prompt: string = buildPrompt(message, matchedRule!);

      // Проверяем что prompt содержит весь payload как JSON
      expect(prompt).toContain('"data":"some random data"');
      expect(prompt).toContain('"timestamp":"2024-01-01T00:00:00Z"');
    });
  });

  describe('Поток 4: Нет совпавшего правила → null routing', () => {
    it('должен вернуть null если ни одно правило не совпало', () => {
      // Step 1: Config parsing
      const rawConfig = {
        topics: ['alerts'],
        rules: [
          {
            name: 'critical-alerts',
            topic: 'alerts',
            agent: 'alert-agent',
            condition: '$.priority=="CRITICAL"',
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      // Step 2: Message matching (LOW priority не совпадет)
      const message = {
        priority: 'LOW',
        message: 'Minor issue detected',
      };

      const matchedRule: Rule | null = matchRule(message, 'alerts', config.rules);

      expect(matchedRule).toBeNull();

      // Step 3: Prompt building не выполняется (нет правила)
      // В реальном продакшен коде здесь будет логика для unmatched messages
    });
  });

  describe('Поток 5: Несколько правил — первое совпавшее wins', () => {
    it('должен вернуть первое совпавшее правило из нескольких', () => {
      // Step 1: Config parsing (несколько правил для одного topic)
      const rawConfig = {
        topics: ['security-events'],
        rules: [
          {
            name: 'rule-1',
            topic: 'security-events',
            agent: 'agent-1',
            condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
            command: 'urgent',
            prompt_field: '$.vulnerabilities[0].id',
          },
          {
            name: 'rule-2',
            topic: 'security-events',
            agent: 'agent-2',
            condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
            command: 'secondary',
            prompt_field: '$.vulnerabilities[0].id',
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      // Step 2: Message matching
      const message = {
        vulnerabilities: [
          { severity: 'CRITICAL', id: 'SEC-001' },
        ],
      };

      const matchedRule: Rule | null = matchRule(message, 'security-events', config.rules);

      // Первое совпавшее правило
      expect(matchedRule).not.toBeNull();
      expect(matchedRule?.name).toBe('rule-1');
      expect(matchedRule?.agent).toBe('agent-1');
      expect(matchedRule?.command).toBe('urgent');

      // Step 3: Prompt building
      const prompt: string = buildPrompt(message, matchedRule!);

      expect(prompt).toBe('/urgent SEC-001');
    });
  });

  describe('Поток 6: Mock OpenCode session invocation', () => {
    it('должен вызвать OpenCode API с правильными параметрами (mock)', () => {
      // Mock OpenCode client
      const mockOpenCodeClient = {
        createSession: vi.fn().mockResolvedValue({
          sessionId: 'test-session-123',
          status: 'created',
        }),
      };

      // Step 1: Config parsing
      const rawConfig = {
        topics: ['analysis-requests'],
        rules: [
          {
            name: 'analysis-rule',
            topic: 'analysis-requests',
            agent: 'analysis-agent',
            condition: '$.tasks[?(@.action=="analyze")]',
            command: 'analyze',
            prompt_field: '$.tasks[0].data',
          },
        ],
      };

      const config: PluginConfig = parseConfig(rawConfig);

      // Step 2: Message matching
      const message = {
        tasks: [
          { action: 'analyze', data: 'Analyze this dataset' },
        ],
      };

      const matchedRule: Rule | null = matchRule(message, 'analysis-requests', config.rules);

      expect(matchedRule).not.toBeNull();

      // Step 3: Prompt building
      const prompt: string = buildPrompt(message, matchedRule!);

      // Step 4: Mock OpenCode session invocation
      // В реальном коде здесь был бы вызов OpenCode API
      mockOpenCodeClient.createSession({
        agent: matchedRule!.agent,
        prompt: prompt,
      });

      // Проверяем что mock был вызван с правильными параметрами
      expect(mockOpenCodeClient.createSession).toHaveBeenCalledWith({
        agent: 'analysis-agent',
        prompt: '/analyze Analyze this dataset',
      });
    });
  });

  describe('Поток 7: Redpanda container доступен для Kafka operations', () => {
    it('должен успешно запустить Redpanda контейнер', () => {
      // Проверяем что контейнер запущен
      expect(redpandaContainer).not.toBeNull();
      expect(redpandaContainer).toBeInstanceOf(Object);

      // В реальном тесте здесь можно было бы:
      // - Создать Kafka producer
      // - Produce сообщение
      // - Создать Kafka consumer
      // - Consume сообщение
      // Но для текущего scope достаточно проверки запуска контейнера
    });
  });
});
