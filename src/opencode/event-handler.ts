/**
 * Event handler for spec-009 tool-based response delivery.
 *
 * Subscribes to OpenCode plugin Hooks.event and filters for:
 * - session.idle — fires when a session becomes idle (no more processing)
 * - message.part.updated — fires when a message part is added/updated
 *   (used for fallbackToTextCapture mode to harvest assistant text)
 *
 * Both are used as the safety net: if the LLM never calls send_to_kafka
 * for a session the plugin created, session.idle triggers a DLQ envelope
 * (when rule.requireToolCall=true) or a fallback text publish
 * (when rule.fallbackToTextCapture=true).
 *
 * @see specs/009-tool-based-response-delivery/spec.md §FR-4, FR-5
 * @see docs/architecture/ADR-009-tool-based-response-delivery.md
 */

import type { Producer } from 'kafkajs';
import type { PluginConfigV003 } from '../schemas/index.js';
import {
  captureText,
  cleanupSessionWatcher,
  getSessionWatcher,
  getAllSessionWatchers,
} from './session-watchers.js';
import { sendResponse } from '../kafka/response-producer.js';
import { sendToDlq } from '../kafka/dlq.js';

export interface EventHandlerDeps {
  /** Response producer for fallback-to-text-capture mode. */
  responseProducer: Producer;
  /** DLQ producer for safety-net envelopes. */
  dlqProducer: Producer;
  /** Plugin config (for rules lookup and per-rule settings). */
  config: PluginConfigV003;
}

/**
 * Factory that returns a configured event handler with the given deps.
 *
 * Use this from src/index.ts:
 *
 *   const handleEvent = createEventHandler({ responseProducer, dlqProducer, config });
 *   return { event: handleEvent, tool, 'session.error': ... };
 */
export function createEventHandler(deps: EventHandlerDeps) {
  return async function handleEvent(input: {
    event: { type: string; properties?: unknown };
  }): Promise<void> {
    const event = input.event;

    try {
      if (event.type === 'session.idle') {
        const idleEvent = event as {
          type: 'session.idle';
          properties: { sessionID: string };
        };
        await handleSessionIdle(idleEvent, deps);
        return;
      }
      if (event.type === 'message.part.updated') {
        const partEvent = event as {
          type: 'message.part.updated';
          properties: {
            part: { type: string; sessionID?: string; messageID?: string; text?: string };
          };
        };
        handleMessagePartUpdated(partEvent);
        return;
      }
      // All other event types intentionally ignored
    } catch (error) {
      // Event handler must NEVER throw — log and swallow
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'event_handler_failed',
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        })
      );
    }
  };
}

/**
 * Handle session.idle: the safety-net trigger.
 *
 * Looks up the SessionWatcher for this sessionID:
 * - If watcher doesn't exist: this session wasn't created by our plugin.
 * - If watcher.toolCalled=true: LLM called send_to_kafka_<rule>. Done.
 * - If watcher.toolCalled=false AND rule.fallbackToTextCapture=true AND
 *   text captured: publish captured text to responseTopic as success.
 * - If watcher.toolCalled=false AND rule.requireToolCall=true: send DLQ.
 * - Else: silent log (FR-T4).
 */
async function handleSessionIdle(
  event: { type: 'session.idle'; properties: { sessionID: string } },
  deps: EventHandlerDeps
): Promise<void> {
  const sessionId = event.properties.sessionID;
  const watcher = getSessionWatcher(sessionId);
  if (!watcher) return; // not our session

  const rule = deps.config.rules.find((r) => r.name === watcher.ruleName);
  if (!rule) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'event_idle_rule_not_found',
        sessionId,
        ruleName: watcher.ruleName,
        timestamp: new Date().toISOString(),
      })
    );
    cleanupSessionWatcher(sessionId);
    return;
  }

  const sessionDurationMs = Date.now() - watcher.startTime;

  if (watcher.toolCalled) {
    // LLM called the tool — already published to Kafka by tool-handler
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'kafka_message_lifecycle',
        phase: 'tool_called',
        sessionId,
        ruleName: rule.name,
        sessionDurationMs,
        timestamp: new Date().toISOString(),
      })
    );
    cleanupSessionWatcher(sessionId);
    return;
  }

  // Tool not called — try fallback text capture
  if (watcher.textCapture && rule.fallbackToTextCapture && rule.responseTopic) {
    try {
      await sendResponse(deps.responseProducer, rule.responseTopic, {
        messageKey: sessionId,
        sessionId,
        ruleName: rule.name,
        agentId: rule.agentId,
        response: watcher.textCapture,
        status: 'success',
        executionTimeMs: sessionDurationMs,
        timestamp: new Date().toISOString(),
      });
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'kafka_message_lifecycle',
          phase: 'fallback_text_published',
          sessionId,
          ruleName: rule.name,
          responseLength: watcher.textCapture.length,
          sessionDurationMs,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'fallback_publish_failed',
          sessionId,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
    cleanupSessionWatcher(sessionId);
    return;
  }

  // Tool not called and no fallback — DLQ if required
  if (rule.requireToolCall) {
    try {
      await sendToDlq(
        deps.dlqProducer,
        {
          value: null,
          topic: rule.responseTopic ?? 'unknown',
          partition: 0,
          offset: '0',
          originalKey: null,
        },
        new Error(
          `session idle without tool call: sessionId=${sessionId}, ruleName=${rule.name}, duration=${sessionDurationMs}ms`
        ),
        deps.config.dlqTopic
      );
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'kafka_message_lifecycle',
          phase: 'dlq_sent',
          sessionId,
          ruleName: rule.name,
          sessionDurationMs,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'dlq_send_failed',
          sessionId,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        })
      );
    }
  } else {
    // requireToolCall=false and no fallback — silent log
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'kafka_message_lifecycle',
        phase: 'idle_no_tool_silent',
        sessionId,
        ruleName: rule.name,
        sessionDurationMs,
        timestamp: new Date().toISOString(),
      })
    );
  }

  cleanupSessionWatcher(sessionId);
}

/**
 * Handle message.part.updated: capture text parts for fallback mode.
 */
function handleMessagePartUpdated(event: {
  type: 'message.part.updated';
  properties: {
    part: { type: string; sessionID?: string; messageID?: string; text?: string };
  };
}): void {
  const part = event.properties.part;
  if (part.type !== 'text' || !part.sessionID) return;

  const watcher = getSessionWatcher(part.sessionID);
  if (!watcher) return; // not our session
  if (watcher.textCapture === undefined) return; // fallback not enabled

  // Capture full text (delta events accumulate; we replace rather than
  // append because OpenCode SDK delivers the full part.text per update)
  captureText(part.sessionID, part.text ?? '');
}

// =============================================================================
// T012: maxSessionMs wall-clock guard
// =============================================================================

let maxSessionGuardInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic check that force-DLQs sessions exceeding their
 * rule's maxSessionMs. Runs every checkIntervalMs (no minimum).
 *
 * Called once at plugin startup. Must be paired with stopMaxSessionGuard
 * during graceful shutdown.
 */
export function startMaxSessionGuard(
  deps: EventHandlerDeps,
  checkIntervalMs = 5000
): void {
  if (maxSessionGuardInterval) return; // already running

  maxSessionGuardInterval = setInterval(() => {
    const now = Date.now();
    for (const watcher of getAllSessionWatchers()) {
      const rule = deps.config.rules.find((r) => r.name === watcher.ruleName);
      if (!rule) continue;

      const elapsed = now - watcher.startTime;
      if (elapsed > rule.maxSessionMs && !watcher.toolCalled) {
        // Session exceeded maxSessionMs without tool call — force DLQ
        // Fire-and-forget — don't await to keep interval tick fast
        sendToDlq(
          deps.dlqProducer,
          {
            value: null,
            topic: rule.responseTopic ?? 'unknown',
            partition: 0,
            offset: '0',
            originalKey: null,
          },
          new Error(
            `session exceeded maxSessionMs (${rule.maxSessionMs}) without tool call: ` +
            `sessionId=${watcher.sessionId}, ruleName=${rule.name}, elapsed=${elapsed}ms`
          ),
          deps.config.dlqTopic
        ).catch((err) => {
          console.error(
            JSON.stringify({
              level: 'error',
              event: 'max_session_guard_dlq_failed',
              sessionId: watcher.sessionId,
              error: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            })
          );
        });
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'session_exceeded_max_session_ms',
            sessionId: watcher.sessionId,
            ruleName: rule.name,
            elapsedMs: elapsed,
            maxSessionMs: rule.maxSessionMs,
            timestamp: new Date().toISOString(),
          })
        );
        cleanupSessionWatcher(watcher.sessionId);
      }
    }
  }, checkIntervalMs);
}

/**
 * Stop the max-session guard. Called during graceful shutdown.
 */
export function stopMaxSessionGuard(): void {
  if (maxSessionGuardInterval) {
    clearInterval(maxSessionGuardInterval);
    maxSessionGuardInterval = null;
  }
}