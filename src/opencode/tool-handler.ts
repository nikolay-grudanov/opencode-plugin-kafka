/**
 * Tool handler for spec-009 tool-based response delivery.
 *
 * Creates OpenCode custom tools via the official `tool()` helper from
 * `@opencode-ai/plugin`. Each rule with a responseTopic gets one tool:
 * `send_to_kafka_<sanitized_rule_name>`. When the LLM calls the tool,
 * the handler publishes to Kafka via the existing sendResponse() producer.
 *
 * Tool name pattern: `send_to_kafka_<rule_name>` with non-alphanumeric
 * characters replaced by `_`. This avoids collisions and matches the
 * spec's naming convention.
 *
 * FR-1: register one custom tool per rule with non-null responseTopic.
 * FR-2: tool args schema is a Zod object with responseTopic/response/sessionId.
 * FR-3: tool.execute() publishes to Kafka and returns success string.
 * FR-T1: only created when toolDelivery toggle is true.
 *
 * @see specs/009-tool-based-response-delivery/spec.md
 * @see docs/architecture/ADR-009-tool-based-response-delivery.md
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import type { Producer } from 'kafkajs';
import type { RuleV003 } from '../schemas/index.js';
import { sendResponse } from '../kafka/response-producer.js';
import { markToolCalled } from './session-watchers.js';

/**
 * Sanitize a rule name for use as a tool identifier. Non-alphanumeric
 * characters (except `_`) are replaced with `_`.
 *
 * Examples:
 *   "default-prompt-rule" → "default_prompt_rule"
 *   "rule.with.dots"     → "rule_with_dots"
 *   "kafka v2"           → "kafka_v2"
 */
export function sanitizeRuleName(ruleName: string): string {
  return ruleName.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Tool name pattern: `send_to_kafka_<sanitized_rule_name>`.
 */
export function makeToolName(rule: Pick<RuleV003, 'name'>): string {
  return `send_to_kafka_${sanitizeRuleName(rule.name)}`;
}

/**
 * Tool args schema (Zod). Used inline in createSendToKafkaTool via tool({args: ...}).
 *
 * Exported for unit testing — tests instantiate the schema directly to verify
 * validation behavior (empty response rejection, missing responseTopic default).
 */
export const sendToKafkaToolArgsSchema = z.object({
  responseTopic: z
    .string()
    .min(1, 'responseTopic cannot be empty')
    .optional()
    .describe('Kafka topic to publish to (optional if rule has a default)'),
  response: z
    .string()
    .min(1, 'response cannot be empty — provide the full answer text')
    .describe('The final answer text the agent wants to publish to Kafka'),
  sessionId: z
    .string()
    .optional()
    .describe('Source session ID (auto-filled from OpenCode context if omitted)'),
});

/** Inferred TypeScript type for tool args. */
export type SendToKafkaToolArgs = z.infer<typeof sendToKafkaToolArgsSchema>;

export interface ToolHandlerDeps {
  /** Response producer (from createResponseProducer in src/kafka/client.ts). */
  producer: Producer;
}

/**
 * Create a send_to_kafka tool for one rule.
 *
 * Per FR-3, the tool's execute():
 * 1. Resolves effective responseTopic (LLM-supplied or rule default)
 * 2. Resolves effective sessionId (LLM-supplied or ctx.sessionID)
 * 3. Marks the session watcher as "tool called" (used by event-handler safety net)
 * 4. Calls sendResponse() to publish to Kafka
 * 5. Returns success string to LLM (it sees the tool result)
 *
 * @throws never — errors are logged and returned as failure string to LLM
 */
export function createSendToKafkaTool(
  rule: Pick<RuleV003, 'name' | 'agentId' | 'responseTopic'>,
  deps: ToolHandlerDeps
): ToolDefinition {
  const toolName = makeToolName(rule);
  // The description reflects the default responseTopic so the LLM knows
  // where the answer will go. Args schema is shared across all rules
  // (defaults are applied via ctx/runner, not via schema).
  const description =
    `Publish the final answer to the Kafka response topic '${rule.responseTopic}'. ` +
    `Call exactly once when your answer is ready. Do not call for intermediate text.`;

  return tool({
    description,
    // Cast: @opencode-ai/plugin@1.17.10 ships its own zod v4 inside
    // node_modules/@opencode-ai/plugin/node_modules/zod, while the rest
    // of this project uses zod v3. The two are structurally compatible
    // (same `z.object({...}).shape` API), but TypeScript's structural
    // type check rejects the assignment because v4's `$ZodType` requires
    // a `_zod` property that v3's types don't have. The cast is safe —
    // both versions validate identically at runtime.
    args: sendToKafkaToolArgsSchema.shape as unknown as Parameters<typeof tool>[0]['args'],
    execute: async (args, ctx) => {
      const startTime = Date.now();
      const a = args as SendToKafkaToolArgs;
      const effectiveResponseTopic = a.responseTopic ?? rule.responseTopic;
      const effectiveSessionId = a.sessionId ?? ctx.sessionID;

      // Validation: responseTopic must be known (either LLM-supplied or from rule)
      if (!effectiveResponseTopic) {
        const errMsg = 'no responseTopic available: tool was registered without a default and LLM did not provide one';
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'tool_execution_failed',
            tool: toolName,
            sessionId: effectiveSessionId,
            ruleName: rule.name,
            error: errMsg,
            timestamp: new Date().toISOString(),
          })
        );
        return { output: `error: ${errMsg}`, metadata: { error: true } };
      }

      // Validation: response must be non-empty (Zod schema already enforces this,
      // but defensive check for clarity)
      if (!a.response || a.response.length === 0) {
        const errMsg = 'empty response — refusing to publish empty answer';
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'tool_execution_failed',
            tool: toolName,
            sessionId: effectiveSessionId,
            ruleName: rule.name,
            error: errMsg,
            timestamp: new Date().toISOString(),
          })
        );
        return { output: `error: ${errMsg}`, metadata: { error: true } };
      }

      // Mark session as "tool called" — used by event-handler safety net
      // to know the response was delivered via tool, not via fallback.
      markToolCalled(effectiveSessionId);

      // Publish via the existing sendResponse helper.
      // sendResponse never throws (it logs and swallows), but we measure
      // execution time around it for the response payload.
      await sendResponse(deps.producer, effectiveResponseTopic, {
        messageKey: effectiveSessionId,
        sessionId: effectiveSessionId,
        ruleName: rule.name,
        agentId: rule.agentId,
        response: a.response,
        status: 'success',
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      // Log structured success event for observability (NFR-2)
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'tool_response_sent',
          tool: toolName,
          topic: effectiveResponseTopic,
          sessionId: effectiveSessionId,
          ruleName: rule.name,
          agentId: rule.agentId,
          responseLength: a.response.length,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        })
      );

      return {
        output: `published to ${effectiveResponseTopic} (sessionId=${effectiveSessionId})`,
        metadata: {
          topic: effectiveResponseTopic,
          sessionId: effectiveSessionId,
          bytes: a.response.length,
        },
      };
    },
  });
}

/**
 * Build the Hooks.tool map for all rules that have a responseTopic.
 *
 * Used by src/index.ts when constructing Hooks to return to OpenCode.
 * Returns an empty object if no rules have responseTopic.
 */
export function buildAllTools(
  rules: ReadonlyArray<Pick<RuleV003, 'name' | 'agentId' | 'responseTopic'>>,
  deps: ToolHandlerDeps
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};
  for (const rule of rules) {
    if (!rule.responseTopic) continue; // fire-and-forget rules get no tool
    const toolName = makeToolName(rule);
    if (tools[toolName]) {
      // Name collision — two rules sanitize to the same name. Skip second
      // and log a warning. Should never happen with reasonable rule names.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'tool_name_collision',
          toolName,
          skippedRule: rule.name,
          timestamp: new Date().toISOString(),
        })
      );
      continue;
    }
    tools[toolName] = createSendToKafkaTool(rule, deps);
  }
  return tools;
}
