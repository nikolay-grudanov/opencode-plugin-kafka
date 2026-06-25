/**
 * Per-test topic helpers for e2e test isolation.
 *
 * Creates unique input/response/dlq topic names per test to prevent
 * cross-test pollution when running multiple tests in sequence.
 *
 * Why per-test topics: spec-008 had T-E2E-007 / T-E2E-008 failing because
 * consumeOneMessage() in test A caught envelope from test B (both wrote
 * to the same shared DLQ topic). Per-test topics eliminate this race.
 *
 * @see specs/009-tool-based-response-delivery/spec.md US4
 * @see specs/009-tool-based-response-delivery/data-model.md §4
 */

import type { Admin, Consumer, Producer } from 'kafkajs';
import { Kafka } from 'kafkajs';

export interface PerTestTopics {
  /** Test identifier (sanitized). */
  testName: string;
  /** Unique input topic for this test. */
  inputTopic: string;
  /** Unique response topic for this test. */
  responseTopic: string;
  /** Unique DLQ topic for this test. */
  dlqTopic: string;
  /** Timestamp when topics were created. */
  createdAt: number;
}

/**
 * Sanitize a test name for use in Kafka topic name. Kafka topic names
 * allow [a-zA-Z0-9._-]. We replace any other char with `_`.
 */
export function sanitizeTestName(testName: string): string {
  return testName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

/**
 * Create per-test topics via Kafka admin API. Returns names + an admin
 * handle for later cleanup.
 *
 * Topic naming convention: e2e-{sanitizedTestName}-{role}. Each test
 * gets its own input/response/dlq triplet, isolated from other tests.
 */
export async function createPerTestTopics(
  testName: string,
  brokers: string[],
  options?: { partitions?: number; replicationFactor?: number }
): Promise<PerTestTopics> {
  const sanitized = sanitizeTestName(testName);
  const partitions = options?.partitions ?? 1;
  const replicationFactor = options?.replicationFactor ?? 1;

  const topics = {
    testName,
    inputTopic: `e2e-${sanitized}-input`,
    responseTopic: `e2e-${sanitized}-response`,
    dlqTopic: `e2e-${sanitized}-dlq`,
    createdAt: Date.now(),
  };

  const kafka = new Kafka({ clientId: `e2e-topics-${sanitized}`, brokers });
  const admin: Admin = kafka.admin();
  await admin.connect();

  try {
    const existing = await admin.listTopics();
    const toCreate = [
      { topic: topics.inputTopic, numPartitions: partitions, replicationFactor },
      { topic: topics.responseTopic, numPartitions: partitions, replicationFactor },
      { topic: topics.dlqTopic, numPartitions: partitions, replicationFactor },
    ].filter((t) => !existing.includes(t.topic));

    if (toCreate.length > 0) {
      await admin.createTopics({ topics: toCreate, waitForLeaders: true });
    }
  } finally {
    await admin.disconnect();
  }

  return topics;
}

/**
 * Delete per-test topics. Called in afterAll to keep Kafka clean.
 * Silently ignores deletion failures (topics may already be gone).
 */
export async function cleanupPerTestTopics(
  topics: PerTestTopics,
  brokers: string[]
): Promise<void> {
  const kafka = new Kafka({ clientId: `e2e-cleanup-${topics.testName}`, brokers });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.deleteTopics({
      topics: [topics.inputTopic, topics.responseTopic, topics.dlqTopic],
      timeout: 10000,
    });
  } catch (err) {
    // Best-effort cleanup — don't fail tests if Kafka admin has issues
    console.warn(
      `[perTestTopics] cleanup failed for ${topics.testName}:`,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    try {
      await admin.disconnect();
    } catch {
      // ignore
    }
  }
}

/**
 * Create a producer bound to per-test topics. Convenience wrapper used
 * in test beforeAll/beforeEach to send test messages.
 */
export function createTestProducer(
  brokers: string[],
  clientId = 'e2e-test-producer'
): Producer {
  const kafka = new Kafka({ clientId, brokers });
  return kafka.producer();
}

/**
 * Create a consumer bound to per-test topics. Used in tests to consume
 * from response/dlq topics with unique group ID per call (avoids
 * offset reuse issues across tests).
 */
export function createTestConsumer(
  brokers: string[],
  groupId: string
): Consumer {
  const kafka = new Kafka({ clientId: `e2e-test-consumer-${groupId}`, brokers });
  return kafka.consumer({ groupId });
}
