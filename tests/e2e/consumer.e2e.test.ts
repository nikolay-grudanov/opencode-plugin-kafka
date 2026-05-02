/**
 * E2E тест для проверки Kafka consumer плагина с реальным OpenCode процессом и Redpanda.
 *
 * T-E2E-001: Happy Path — produce task, consume response
 * T-E2E-002: Routing — JSONPath match/skip
 * T-E2E-003: JSONPath field extraction
 * T-E2E-004: Agent timeout → DLQ
 * T-E2E-005: Minimal response — not DLQ
 * T-E2E-006: fire-and-forget — no responseTopic
 * T-E2E-007: invalid JSON → DLQ
 * T-E2E-008: consumer recovery — series of errors
 */
import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import {
  startRedpanda,
  stopRedpanda,
} from './helpers/redpandaContainer.js';
import { spawnOpenCodeServe } from './helpers/opencodeProcess.js';
import {
  createTopics,
  produceMessage,
  consumeOneMessage,
  consumeMessages,
} from './helpers/kafkaUtils.js';
import { runPlugin } from './helpers/pluginRunner.js';
import { createSDKClient } from './helpers/sdkClient.js';
import { OpenCodeAgentAdapter } from '../../src/opencode/OpenCodeAgentAdapter.js';
import type { PluginConfigV003 } from '../../src/schemas/index.js';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { StartedRedpandaContainer } from '@testcontainers/redpanda';

describe('Kafka consumer E2E', () => {
  // Переменные на уровне модуля для beforeAll/afterAll
  let brokers: string[];
  let redpandaContainer: StartedRedpandaContainer;
  let opencodeHandle: Awaited<ReturnType<typeof spawnOpenCodeServe>>;
  let configHashBefore: string | null = null;

  /**
   * Вычисляет SHA256 хэш файла.
   * @param filePath - путь к файлу
   * @returns хэш в hex формате или null если файл не существует
   */
  function computeFileHash(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  // Конфигурация плагина
  const INPUT_TOPIC = 'e2e-input';
  const RESPONSE_TOPIC = 'e2e-response';
  const DLQ_TOPIC = 'e2e-input-dlq';
  const AGENT_ID = 'e2e-responder';

  // Routing тест topics
  const ROUTING_INPUT_TOPIC = 'e2e-routing-input';
  const ROUTING_RESPONSE_TOPIC = 'e2e-routing-response';
  const ROUTING_DLQ_TOPIC = 'e2e-routing-input-dlq';

  // Timeout test topics
  const TIMEOUT_INPUT_TOPIC = 'e2e-timeout-input';
  const TIMEOUT_DLQ_TOPIC = 'e2e-timeout-input-dlq';

  // Field extraction test topics
  const EXTRACTION_INPUT_TOPIC = 'e2e-extraction-input';
  const EXTRACTION_RESPONSE_TOPIC = 'e2e-extraction-response';

  // Minimal response test topics
  const MINIMAL_INPUT_TOPIC = 'e2e-minimal-input';
  const MINIMAL_RESPONSE_TOPIC = 'e2e-minimal-response';
  const MINIMAL_DLQ_TOPIC = 'e2e-minimal-input-dlq';

  // Fire-and-forget test topics
  const FIREFORGET_INPUT_TOPIC = 'e2e-fireforget-input';
  const FIREFORGET_DLQ_TOPIC = 'e2e-fireforget-input-dlq';

  // Invalid JSON test topics
  const INVALID_INPUT_TOPIC = 'e2e-invalid-input';
  const INVALID_RESPONSE_TOPIC = 'e2e-invalid-response';
  const INVALID_DLQ_TOPIC = 'e2e-invalid-input-dlq';

  // Recovery test topics
  const RECOVERY_INPUT_TOPIC = 'e2e-recovery-input';
  const RECOVERY_RESPONSE_TOPIC = 'e2e-recovery-response';
  const RECOVERY_DLQ_TOPIC = 'e2e-recovery-input-dlq';

  const pluginConfig: PluginConfigV003 = {
    topics: [INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-echo-rule',
        jsonPath: '$.task',
        promptTemplate: '{{value}}',
        agentId: AGENT_ID,
        responseTopic: RESPONSE_TOPIC,
        timeoutMs: 120_000,
        concurrency: 1,
      },
    ],
  };

  beforeAll(
    async function () {
      // 1. Snapshot config hash (FR-009)
      const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
      configHashBefore = computeFileHash(configPath);

      // 2. Start Redpanda
      redpandaContainer = await startRedpanda();
      const host = redpandaContainer.getHost();
      const port = redpandaContainer.getMappedPort(9093);
      brokers = [`${host}:${port}`];

      // 3. Spawn opencode serve
      opencodeHandle = await spawnOpenCodeServe();

      // 4. Create topics
      await createTopics(brokers, [INPUT_TOPIC, RESPONSE_TOPIC, DLQ_TOPIC]);
    },
    60_000
  );

  afterAll(async function () {
    // 1. Kill opencode process (if started)
    if (opencodeHandle) {
      await opencodeHandle.kill();
    }

    // 2. Verify config hash unchanged (FR-009)
    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
    const configHashAfter = computeFileHash(configPath);
    if (configHashBefore !== null && configHashAfter !== null) {
      expect(configHashAfter).toBe(configHashBefore);
    }

    // 3. Stop Redpanda
    await stopRedpanda(redpandaContainer);
  });

  test(
    'T-E2E-001: happy path — produce task, consume response',
    async function () {
      // 1. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 2. Start plugin consumer
      // Преобразуем массив brokers в строку через запятую (требуется для KafkaConnectionSettings)
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-consumer-client',
        groupId: 'e2e-consumer-group',
        dlqTopic: DLQ_TOPIC,
      };
      const pluginHandle = await runPlugin(pluginConfig, agent, connection);

      // 3. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 4. Produce test message
      const testMessage = { task: 'What is 2+2?' };
      await produceMessage(brokers, INPUT_TOPIC, {
        value: JSON.stringify(testMessage),
      });

      // 5. Consume response (with generous timeout for E2E)
      const responseMessage = await consumeOneMessage(
        brokers,
        RESPONSE_TOPIC,
        90_000
      );
      expect(responseMessage).not.toBeNull();

      // 6. Parse and assert response
      const response = JSON.parse(responseMessage!.value!.toString());

      expect(response.status).toBe('success');
      expect(response.response).toBeDefined();
      expect(typeof response.response).toBe('string');
      expect(response.response.length).toBeGreaterThan(0);
      expect(response.sessionId).toBeDefined();
      expect(typeof response.sessionId).toBe('string');
      expect(response.ruleName).toBe('e2e-echo-rule');

      // 7. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  // Routing plugin config для T-E2E-002
  const routingPluginConfig: PluginConfigV003 = {
    topics: [ROUTING_INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-routing-rule',
        jsonPath: '$.type[?(@=="question")]', // совпадает ТОЛЬКО когда type === "question"
        promptTemplate: '${$.content}', // извлекает content поле из payload
        agentId: AGENT_ID,
        responseTopic: ROUTING_RESPONSE_TOPIC,
        timeoutMs: 120_000,
        concurrency: 1,
      },
    ],
  };

  // Timeout plugin config для T-E2E-004
  const timeoutPluginConfig: PluginConfigV003 = {
    topics: [TIMEOUT_INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-timeout-rule',
        jsonPath: '$.task',
        promptTemplate: '{{value}}',
        agentId: AGENT_ID,
        responseTopic: 'e2e-timeout-response',
        timeoutMs: 100, // заведомо мало для реального LLM
        concurrency: 1,
      },
    ],
  };

  // Field extraction plugin config для T-E2E-003
  const extractionPluginConfig: PluginConfigV003 = {
    topics: [EXTRACTION_INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-extraction-rule',
        jsonPath: '$.data.query',
        promptTemplate: 'Context: ${$.data.context} Question: ${$.data.query}',
        agentId: AGENT_ID,
        responseTopic: EXTRACTION_RESPONSE_TOPIC,
        timeoutMs: 60_000,
        concurrency: 1,
      },
    ],
  };

  // Minimal response plugin config для T-E2E-005
  const minimalPluginConfig: PluginConfigV003 = {
    topics: [MINIMAL_INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-minimal-rule',
        jsonPath: '$.task',
        promptTemplate: '${$.task}',
        agentId: AGENT_ID,
        responseTopic: MINIMAL_RESPONSE_TOPIC,
        timeoutMs: 30_000,
        concurrency: 1,
      },
    ],
  };

  // Fire-and-forget plugin config для T-E2E-006 (rule WITHOUT responseTopic)
  const fireforgetPluginConfig: PluginConfigV003 = {
    topics: [FIREFORGET_INPUT_TOPIC],
    rules: [
      {
        name: 'e2e-fireforget-rule',
        jsonPath: '$.task',
        promptTemplate: '{{value}}',
        agentId: AGENT_ID,
        // NO responseTopic — fire-and-forget mode
        timeoutMs: 30_000,
        concurrency: 1,
      },
    ],
  };

  test(
    'T-E2E-002: routing — JSONPath match/skip',
    async function () {
      // 1. Create routing topics
      await createTopics(brokers, [
        ROUTING_INPUT_TOPIC,
        ROUTING_RESPONSE_TOPIC,
        ROUTING_DLQ_TOPIC,
      ]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer with routing config
      // Преобразуем массив brokers в строку через запятую (требуется для KafkaConnectionSettings)
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-routing-client',
        groupId: `e2e-routing-group-${Date.now()}`,
        dlqTopic: ROUTING_DLQ_TOPIC,
      };
      const pluginHandle = await runPlugin(routingPluginConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Send non-matching message (type: "notification") → should be skipped
      const nonMatchingMessage = { type: 'notification', content: 'hello' };
      await produceMessage(brokers, ROUTING_INPUT_TOPIC, {
        value: JSON.stringify(nonMatchingMessage),
      });

      // 6. Wait for potential processing, then check NO response
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const noResponse = await consumeOneMessage(brokers, ROUTING_RESPONSE_TOPIC, 5_000);
      expect(noResponse).toBeNull(); // Non-matching message should NOT produce response

      // 7. Send matching message (type: "question") → should be processed
      const matchingMessage = { type: 'question', content: 'What color is the sky?' };
      await produceMessage(brokers, ROUTING_INPUT_TOPIC, {
        value: JSON.stringify(matchingMessage),
      });

      // 8. Consume response (with generous timeout for E2E)
      const responseMessage = await consumeOneMessage(brokers, ROUTING_RESPONSE_TOPIC, 90_000);
      expect(responseMessage).not.toBeNull();

      // 9. Parse and assert response
      const response = JSON.parse(responseMessage!.value!.toString());
      expect(response.status).toBe('success');
      expect(response.response).toBeDefined();
      expect(typeof response.response).toBe('string');
      expect(response.response.length).toBeGreaterThan(0);
      expect(response.ruleName).toBe('e2e-routing-rule');
      expect(response.agentId).toBe(AGENT_ID);

      // 10. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-004: timeout → DLQ',
    async function () {
      // 1. Create timeout topics
      await createTopics(brokers, [TIMEOUT_INPUT_TOPIC, TIMEOUT_DLQ_TOPIC]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer with timeout config
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-timeout-client',
        groupId: `e2e-timeout-group-${Date.now()}`,
        dlqTopic: TIMEOUT_DLQ_TOPIC,
      };
      const pluginHandle = await runPlugin(timeoutPluginConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Produce message that will timeout
      const timeoutMessage = { task: 'This should timeout' };
      await produceMessage(brokers, TIMEOUT_INPUT_TOPIC, {
        value: JSON.stringify(timeoutMessage),
      });

      // 6. Consume from DLQ (timeout message should appear)
      const dlqMessage = await consumeOneMessage(brokers, TIMEOUT_DLQ_TOPIC, 30_000);
      expect(dlqMessage).not.toBeNull();

      // 7. Parse and assert DLQ envelope
      const dlqEnvelope = JSON.parse(dlqMessage!.value!.toString());
      expect(dlqEnvelope.topic).toBe(TIMEOUT_INPUT_TOPIC);
      expect(dlqEnvelope.errorMessage.toLowerCase()).toContain('timeout');
      expect(dlqEnvelope.originalValue).not.toBeNull();
      expect(dlqEnvelope.failedAt).toBeDefined();

      // 8. Verify consumer continues: send another message
      const secondMessage = { task: 'Another timeout test' };
      await produceMessage(brokers, TIMEOUT_INPUT_TOPIC, {
        value: JSON.stringify(secondMessage),
      });

      // 9. Consume second DLQ message — proves consumer is still alive
      const secondDlqMessage = await consumeOneMessage(brokers, TIMEOUT_DLQ_TOPIC, 30_000);
      expect(secondDlqMessage).not.toBeNull();
      const secondEnvelope = JSON.parse(secondDlqMessage!.value!.toString());
      expect(secondEnvelope.topic).toBe(TIMEOUT_INPUT_TOPIC);
      expect(secondEnvelope.errorMessage.toLowerCase()).toContain('timeout');

      // 10. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-003: JSONPath field extraction',
    async function () {
      // 1. Create extraction topics
      await createTopics(brokers, [EXTRACTION_INPUT_TOPIC, EXTRACTION_RESPONSE_TOPIC]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer with extraction config
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-extraction-client',
        groupId: `e2e-extraction-group-${Date.now()}`,
        dlqTopic: 'e2e-extraction-dlq',
      };
      const pluginHandle = await runPlugin(extractionPluginConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Produce message with nested fields
      const extractionMessage = {
        data: {
          query: 'What is TypeScript?',
          context: 'Programming languages discussion',
        },
      };
      await produceMessage(brokers, EXTRACTION_INPUT_TOPIC, {
        value: JSON.stringify(extractionMessage),
      });

      // 6. Consume response (with generous timeout for E2E)
      const responseMessage = await consumeOneMessage(brokers, EXTRACTION_RESPONSE_TOPIC, 90_000);
      expect(responseMessage).not.toBeNull();

      // 7. Parse and assert response
      const response = JSON.parse(responseMessage!.value!.toString());
      expect(response.status).toBe('success');
      expect(response.response).toBeDefined();
      expect(typeof response.response).toBe('string');
      expect(response.response.length).toBeGreaterThan(0);
      expect(response.ruleName).toBe('e2e-extraction-rule');
      expect(response.agentId).toBe(AGENT_ID);

      // 8. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-005: minimal response — not DLQ',
    async function () {
      // 1. Create minimal response topics
      await createTopics(brokers, [
        MINIMAL_INPUT_TOPIC,
        MINIMAL_RESPONSE_TOPIC,
        MINIMAL_DLQ_TOPIC,
      ]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer with minimal config
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-minimal-client',
        groupId: `e2e-minimal-group-${Date.now()}`,
        dlqTopic: MINIMAL_DLQ_TOPIC,
      };
      const pluginHandle = await runPlugin(minimalPluginConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Produce minimal prompt: single word response
      const minimalMessage = { task: 'Reply with the single word ok' };
      await produceMessage(brokers, MINIMAL_INPUT_TOPIC, {
        value: JSON.stringify(minimalMessage),
      });

      // 6. Consume response from responseTopic (should be success)
      const responseMessage = await consumeOneMessage(
        brokers,
        MINIMAL_RESPONSE_TOPIC,
        90_000
      );
      expect(responseMessage).not.toBeNull();

      // 7. Parse and assert response is success
      const response = JSON.parse(responseMessage!.value!.toString());
      expect(response.status).toBe('success');
      expect(response.response).toBeDefined();
      expect(typeof response.response).toBe('string');
      expect(response.response.length).toBeGreaterThan(0);
      expect(response.ruleName).toBe('e2e-minimal-rule');
      expect(response.agentId).toBe(AGENT_ID);

      // 8. Verify no DLQ entry (short timeout to avoid long wait)
      const dlqMessage = await consumeOneMessage(
        brokers,
        MINIMAL_DLQ_TOPIC,
        5_000
      );
      expect(dlqMessage).toBeNull(); // Minimal response should NOT go to DLQ

      // 9. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-006: fire-and-forget — no responseTopic',
    async function () {
      // 1. Create fire-and-forget topics
      await createTopics(brokers, [
        FIREFORGET_INPUT_TOPIC,
        FIREFORGET_DLQ_TOPIC,
      ]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer with fire-and-forget config (no responseTopic)
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-fireforget-client',
        groupId: `e2e-fireforget-group-${Date.now()}`,
        dlqTopic: FIREFORGET_DLQ_TOPIC,
      };
      const pluginHandle = await runPlugin(fireforgetPluginConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Produce message — should be processed but no response sent (fire-and-forget)
      await produceMessage(brokers, FIREFORGET_INPUT_TOPIC, {
        value: JSON.stringify({ task: 'This is fire and forget' }),
      });

      // 6. Wait for processing to complete
      await new Promise((resolve) => setTimeout(resolve, 15_000));

      // 7. Verify DLQ is empty — agent succeeded, no error
      const dlqMsg = await consumeOneMessage(brokers, FIREFORGET_DLQ_TOPIC, 5_000);
      expect(dlqMsg).toBeNull(); // Fire-and-forget success → no DLQ entry

      // 8. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-007: invalid JSON → DLQ',
    async function () {
      // 1. Create invalid JSON test topics
      await createTopics(brokers, [
        INVALID_INPUT_TOPIC,
        INVALID_RESPONSE_TOPIC,
        INVALID_DLQ_TOPIC,
      ]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-invalid-client',
        groupId: `e2e-invalid-group-${Date.now()}`,
        dlqTopic: INVALID_DLQ_TOPIC,
      };

      const invalidConfig: PluginConfigV003 = {
        topics: [INVALID_INPUT_TOPIC],
        rules: [
          {
            name: 'e2e-invalid-rule',
            jsonPath: '$.task',
            promptTemplate: '{{value}}',
            agentId: AGENT_ID,
            responseTopic: INVALID_RESPONSE_TOPIC,
            timeoutMs: 30_000,
            concurrency: 1,
          },
        ],
      };

      const pluginHandle = await runPlugin(invalidConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Send invalid JSON (raw string, not parseable)
      await produceMessage(brokers, INVALID_INPUT_TOPIC, {
        value: 'not a json',
      });

      // 6. Consume from DLQ — should contain parse error
      const dlqMessage = await consumeOneMessage(brokers, INVALID_DLQ_TOPIC, 30_000);
      expect(dlqMessage).not.toBeNull();

      const dlqEnvelope = JSON.parse(dlqMessage!.value!.toString());
      expect(dlqEnvelope.topic).toBe(INVALID_INPUT_TOPIC);
      expect(dlqEnvelope.errorMessage.toLowerCase()).toMatch(/parse|json/);
      expect(dlqEnvelope.failedAt).toBeDefined();

      // 7. Verify consumer continues: send valid message after invalid
      await produceMessage(brokers, INVALID_INPUT_TOPIC, {
        value: JSON.stringify({ task: 'Still working after error?' }),
      });

      // 8. Consume response — should succeed (consumer didn't crash)
      const responseMessage = await consumeOneMessage(brokers, INVALID_RESPONSE_TOPIC, 90_000);
      expect(responseMessage).not.toBeNull();

      const response = JSON.parse(responseMessage!.value!.toString());
      expect(response.status).toBe('success');
      expect(response.response).toBeDefined();
      expect(typeof response.response).toBe('string');
      expect(response.response.length).toBeGreaterThan(0);

      // 9. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );

  test(
    'T-E2E-008: consumer recovery — series of errors',
    async function () {
      // 1. Create recovery test topics
      await createTopics(brokers, [
        RECOVERY_INPUT_TOPIC,
        RECOVERY_RESPONSE_TOPIC,
        RECOVERY_DLQ_TOPIC,
      ]);

      // 2. Create SDK client and agent adapter
      const sdkClient = createSDKClient({ baseURL: opencodeHandle.baseURL });
      const agent = new OpenCodeAgentAdapter(sdkClient);

      // 3. Start plugin consumer
      const brokersString = brokers.join(',');
      const connection = {
        brokers: brokersString,
        clientId: 'e2e-recovery-client',
        groupId: `e2e-recovery-group-${Date.now()}`,
        dlqTopic: RECOVERY_DLQ_TOPIC,
      };

      const recoveryConfig: PluginConfigV003 = {
        topics: [RECOVERY_INPUT_TOPIC],
        rules: [
          {
            name: 'e2e-recovery-rule',
            jsonPath: '$.task',
            promptTemplate: '{{value}}',
            agentId: AGENT_ID,
            responseTopic: RECOVERY_RESPONSE_TOPIC,
            timeoutMs: 60_000,
            concurrency: 1,
          },
        ],
      };

      const pluginHandle = await runPlugin(recoveryConfig, agent, connection);

      // 4. Give consumer time to connect and subscribe
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      // 5. Send series: invalid → valid → invalid → valid
      // Message 1: invalid JSON
      await produceMessage(brokers, RECOVERY_INPUT_TOPIC, { value: 'invalid-json-1' });
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      // Message 2: valid JSON
      await produceMessage(brokers, RECOVERY_INPUT_TOPIC, {
        value: JSON.stringify({ task: 'What is 1+1?' }),
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      // Message 3: invalid JSON
      await produceMessage(brokers, RECOVERY_INPUT_TOPIC, { value: 'invalid-json-2' });
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      // Message 4: valid JSON
      await produceMessage(brokers, RECOVERY_INPUT_TOPIC, {
        value: JSON.stringify({ task: 'What is 3+3?' }),
      });

      // 6. Wait for all processing to complete
      await new Promise((resolve) => setTimeout(resolve, 10_000));

      // 7. Verify 2 DLQ messages (2 invalid)
      const dlqMessages = await consumeMessages(brokers, RECOVERY_DLQ_TOPIC, 2, 30_000);
      expect(dlqMessages.length).toBe(2);

      for (const dlqRaw of dlqMessages) {
        const dlqEnvelope = JSON.parse(dlqRaw.value!.toString());
        expect(dlqEnvelope.topic).toBe(RECOVERY_INPUT_TOPIC);
        expect(dlqEnvelope.errorMessage.toLowerCase()).toMatch(/parse|json/);
        expect(dlqEnvelope.failedAt).toBeDefined();
      }

      // 8. Verify 2 success responses (2 valid)
      const responseMessages = await consumeMessages(brokers, RECOVERY_RESPONSE_TOPIC, 2, 90_000);
      expect(responseMessages.length).toBe(2);

      for (const respRaw of responseMessages) {
        const resp = JSON.parse(respRaw.value!.toString());
        expect(resp.status).toBe('success');
        expect(resp.response).toBeDefined();
        expect(typeof resp.response).toBe('string');
        expect(resp.response.length).toBeGreaterThan(0);
        expect(resp.ruleName).toBe('e2e-recovery-rule');
      }

      // 9. Stop plugin
      await pluginHandle.stop();
    },
    120_000
  );
});