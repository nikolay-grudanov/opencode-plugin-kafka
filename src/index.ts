/**
 * Kafka Router Plugin Entry Point
 *
 * Plugin entry point for OpenCode Kafka Router plugin.
 * Implements FR-025 from spec 003-kafka-consumer.
 *
 * spec-009: now wires up tool-based response delivery via
 * @opencode-ai/plugin Hooks.tool + Hooks.event. See ADR-009.
 *
 * @see https://opencode.ai/docs/plugins/
 * @see spec/003-kafka-consumer/spec.md § FR-025
 * @see specs/009-tool-based-response-delivery/spec.md
 */

import type { PluginContext, PluginHooks } from './types/opencode-plugin.d.ts';
import type { Producer } from 'kafkajs';
import { parseConfigV003 } from './core/config.js';
import { startConsumer } from './kafka/consumer.js';
import { createKafkaClient, createResponseProducer, createDlqProducer } from './kafka/client.js';
import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';
import { buildAllTools } from './opencode/tool-handler.js';
import { createEventHandler, startMaxSessionGuard } from './opencode/event-handler.js';

/**
 * OpenCode SDK session error handler (ADR-005, spec-006 FR-001, T020).
 *
 * Pure observability hook: logs internal OpenCode runtime errors. Does NOT
 * influence Kafka message processing — all Kafka errors flow through DLQ.
 */
function handleSessionError(error: Error, sessionId: string): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'opencode_session_error',
      sessionId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Plugin entry point for OpenCode Kafka Router plugin.
 *
 * spec-009 tool-based delivery flow:
 *   1. Parse kafka-router.json (validates Zod schema + FR-017 + toggles)
 *   2. Create Kafka client + shared producers (response + DLQ)
 *   3. Build Hooks.tool map (if toggles.toolDelivery)
 *   4. Build Hooks.event handler (if toggles.eventHook) + start max-session guard
 *   5. Create adapter with mode matching toggles.pollingFallback
 *   6. Return Hooks with tool + event + 'session.error'
 *   7. startConsumer runs in background, processes Kafka messages
 */
export default async function plugin(context: PluginContext): Promise<PluginHooks> {
  try {
    // 1. Парсим конфигурацию из kafka-router.json
    const config = parseConfigV003();

    // 2. Создаём Kafka client + shared producers
    const { kafka } = createKafkaClient(process.env);
    const responseProducer: Producer = createResponseProducer(kafka);
    const dlqProducer: Producer = createDlqProducer(kafka);

    // Defensive defaults (back-compat with configs lacking toggles block)
    const toggles = config.toggles ?? {
      toolDelivery: true,
      eventHook: true,
      pollingFallback: false,
    };

    // 3. Создаём адаптер с правильным mode
    const adapterMode = toggles.pollingFallback ? 'polling' : 'tool-based';
    const agent = new OpenCodeAgentAdapter(context.client, adapterMode);

    // 4. Запускаем Kafka consumer в фоне
    startConsumer(config, agent).catch((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'consumer_start_failed',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        })
      );
    });

    // 5. Строим Hooks объект согласно toggles (FR-T1)
    const hooks: Record<string, unknown> = {
      'session.error': handleSessionError,
    };

    if (toggles.toolDelivery) {
      const tools = buildAllTools(config.rules, { producer: responseProducer });
      hooks.tool = tools;
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'plugin_tools_registered',
          toolCount: Object.keys(tools).length,
          rulesWithTool: config.rules.filter((r) => r.responseTopic).length,
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'plugin_tool_delivery_disabled',
          message: 'No send_to_kafka tools registered (toolDelivery=false)',
          timestamp: new Date().toISOString(),
        })
      );
    }

    if (toggles.eventHook) {
      // Register event handler: session.idle → safety net (DLQ or fallback)
      hooks.event = createEventHandler({
        responseProducer,
        dlqProducer,
        config,
      });
      // Start maxSessionMs wall-clock guard (periodic check)
      startMaxSessionGuard({ responseProducer, dlqProducer, config });
    } else {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'plugin_event_hook_disabled',
          message:
            'No Hooks.event subscription (eventHook=false); safety net disabled. ' +
            'Tools may not deliver if LLM forgets to call them.',
          timestamp: new Date().toISOString(),
        })
      );
    }

    return hooks as unknown as PluginHooks;
  } catch (error) {
    // Fail-fast: log and rethrow so OpenCode surfaces the error
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'plugin_start_failed',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      })
    );
    throw error;
  }
}