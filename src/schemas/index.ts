/**
 * Zod schemas for runtime validation of Kafka Plugin configuration
 *
 * Contains schemas for two specifications:
 * - spec 002-core-refinements: RuleSchema, PluginConfigSchema (legacy, uses topic/agent)
 * - spec 003-kafka-consumer: kafkaEnvSchema, RuleV003Schema, PluginConfigV003Schema (current, uses jsonPath/promptTemplate)
 * - spec 006-opencode-sdk-integration: RuleV003Schema (enhanced, uses agentId/responseTopic/timeoutSeconds/concurrency)
 */

import { z } from 'zod';

// ============================================================================
// Spec 002-core-refinements Schemas (Legacy)
// ============================================================================

/**
 * Zod schema for Rule (spec 002 - legacy format with topic/agent)
 *
 * @deprecated Use RuleV003Schema for spec 003-kafka-consumer instead
 */
export const RuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  topic: z.string().min(1, 'Topic is required'),
  agent: z.string().min(1, 'Agent is required'),
  condition: z.string().optional(),
  command: z.string().optional(),
  prompt_field: z.string().default('$'),
});

/**
 * TypeScript type for Rule (spec 002) — derived from schema via z.infer<>
 *
 * @deprecated Use RuleV003 for spec 003-kafka-consumer instead
 */
export type Rule = z.infer<typeof RuleSchema>;

/**
 * Zod schema for PluginConfig (spec 002 - legacy format)
 *
 * @deprecated Use PluginConfigV003Schema for spec 003-kafka-consumer instead
 */
export const PluginConfigSchema = z.object({
  topics: z.array(z.string()).min(1, 'At least one topic required'),
  rules: z.array(RuleSchema).min(1, 'At least one rule required'),
});

/**
 * TypeScript type for PluginConfig (spec 002) — derived from schema via z.infer<>
 *
 * @deprecated Use PluginConfigV003 for spec 003-kafka-consumer instead
 */
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// ============================================================================
// Spec 003-kafka-consumer Schemas (T004-T006)
// ============================================================================

/**
 * Zod schema for Kafka environment variables
 *
 * Validates Kafka client configuration from process.env.
 * Uses .passthrough() to allow extra process.env keys (PATH, HOME, USER, etc.).
 *
 * @see https://kafka.js.org/docs/configuration
 */
export const kafkaEnvSchema = z
  .object({
    // Required fields - no defaults
    KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),
    KAFKA_CLIENT_ID: z.string().min(1, 'KAFKA_CLIENT_ID is required'),
    KAFKA_GROUP_ID: z.string().min(1, 'KAFKA_GROUP_ID is required'),

    // Optional SSL configuration (must be lowercase "true" or "false")
    KAFKA_SSL: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),

    // Optional SASL authentication
    KAFKA_USERNAME: z.string().optional(),
    KAFKA_PASSWORD: z.string().optional(),
    KAFKA_SASL_MECHANISM: z.string().optional(),

    // Optional DLQ configuration
    KAFKA_DLQ_TOPIC: z.string().optional(),

    // Optional config file path
    KAFKA_ROUTER_CONFIG: z.string().optional(),

    // Optional tombstone handling (must be lowercase "true" or "false")
    KAFKA_IGNORE_TOMBSTONES: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  })
  .passthrough();

/**
 * TypeScript type for KafkaEnv — derived from kafkaEnvSchema
 */
export type KafkaEnv = z.infer<typeof kafkaEnvSchema>;

/**
 * Zod schema for Rule (spec 003 - JSONPath routing)
 *
 * Rules for matching Kafka messages using JSONPath queries.
 * Each rule contains a JSONPath expression to evaluate against message payload
 * and a prompt template to generate prompts for OpenCode agent.
 */
export const RuleV003Schema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  jsonPath: z.string().min(1, 'JSONPath expression is required'),
  promptTemplate: z.string().min(1, 'Prompt template is required'),
  // ID OpenCode агента для вызова
  agentId: z.string().min(1, 'Agent ID is required'),
  // Топик для отправки ответа (optional)
  responseTopic: z.string().min(1, 'Response topic name is required').optional(),
  // Таймаут выполнения агента в секундах (default: 120)
  timeoutSeconds: z.number().int().positive('Timeout must be positive').default(120),
  // Максимальное количество параллельных вызовов (default: 1, v1 — sequential)
  concurrency: z.number().int().min(1, 'Concurrency must be at least 1').max(10, 'Concurrency must be at most 10').default(1),
});

/**
 * TypeScript type for Rule (spec 003) — derived from RuleV003Schema
 */
export type RuleV003 = z.infer<typeof RuleV003Schema>;

/**
 * Zod schema for PluginConfig (spec 003 - Kafka consumer configuration)
 *
 * Configuration loaded from kafka-router.json for Kafka consumer plugin.
 *
 * @note FR-017 topic coverage validation is applied in spec 006
 *       via validateTopicCoverage() in config.ts — checks that responseTopic
 *       does not overlap with input topics.
 *
 * @see https://opencode-plugin-kafka/specs/003-kafka-consumer/spec.md
 */
export const PluginConfigV003Schema = z.object({
  topics: z
    .array(z.string().min(1, 'Topic name cannot be empty'))
    .min(1, 'At least one topic is required')
    .max(5, 'Maximum 5 topics allowed'),
  rules: z.array(RuleV003Schema).min(1, 'At least one rule is required'),
});

/**
 * TypeScript type for PluginConfig (spec 003) — derived from PluginConfigV003Schema
 */
export type PluginConfigV003 = z.infer<typeof PluginConfigV003Schema>;

// ============================================================================
// Common Types
// ============================================================================

/**
 * TypeScript type for Kafka message payload — unknown as structure varies by producer
 */
export type Payload = unknown;

// ============================================================================
// Spec 003-kafka-consumer Additional Types
// ============================================================================

/**
 * Normalized message structure used internally by Kafka consumer.
 *
 * @see https://kafka.js.org/docs/consuming#a-name-getting-the-message-a-message
 */
export interface KafkaMessage {
  /** Message value (null = tombstone) */
  value: string | null;

  /** Original topic name */
  topic: string;

  /** Partition number */
  partition: number;

  /** Offset (string for large numbers) */
  offset: string;

  /** Message timestamp */
  timestamp: string;
}

/**
 * Result of message processing.
 *
 * Used internally to track processing status and metrics.
 */
export interface ProcessingResult {
  /** Processing succeeded? */
  success: boolean;

  /** Matched rule name (if any) */
  matchedRule?: string;

  /** Generated prompt (if any) */
  prompt?: string;

  /** Error message (if failed) */
  error?: string;

  /** Message sent to DLQ? */
  sentToDlq: boolean;

  /** Offset committed? */
  committed: boolean;
}
