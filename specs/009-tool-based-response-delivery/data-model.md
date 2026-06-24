# Data Model: Tool-Based Response Delivery (spec-009)

## Entities

### 1. ToolDefinition (external — from `@opencode-ai/plugin`)

A tool registered by the plugin for one rule. Created via the official `tool()` helper:

```typescript
import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';

const sendToKafkaArgs = z.object({
  responseTopic: z.string().optional(),
  response: z.string().min(1),
  sessionId: z.string().optional(),
});

const sendToKafkaTool = tool({
  description: 'Publish the final answer to the Kafka response topic. Call exactly once when your answer is ready.',
  args: sendToKafkaArgs.shape,
  execute: async (args, ctx) => { /* see §3 below */ },
});
```

**Validation rules**:
- `response` MUST be non-empty. Empty string → tool returns error, plugin sends DLQ.
- `responseTopic` is optional; if omitted, defaults to `rule.responseTopic` (the rule this tool was registered for). If the rule has no `responseTopic`, tool registration is skipped (US3).
- `sessionId` is optional; defaults to `ctx.sessionID` (auto-injected by OpenCode).

### 2. SessionWatcher (per-session ephemeral state)

Closure-scoped object created when the plugin starts a session for a Kafka message. Lives until `session.idle` fires or `maxSessionMs` elapses.

```typescript
type SessionWatcher = {
  sessionId: string;        // ctx.sessionID
  ruleName: string;         // matched rule
  agentId: string;          // matched rule's agent
  startTime: number;        // epoch ms
  toolCalled: boolean;      // becomes true when send_to_kafka_* fires
  textCapture?: string;     // last assistant text part (only if fallbackToTextCapture)
  abortController: AbortController;  // for shutdown propagation
};
```

**Storage**: Map keyed by `sessionId`, lives in `src/opencode/session-watchers.ts`. Auto-cleanup on `session.idle` event.

**Concurrency**: Multiple sessions can run in parallel (one per concurrent Kafka partition). Map operations are synchronous (no locking needed for typical consumer concurrency).

### 3. PluginToggles (plugin-level delivery control)

```typescript
type PluginToggles = {
  toolDelivery: boolean;        // default true — register send_to_kafka_* tools via Hooks.tool
  eventHook: boolean;           // default true — subscribe to Hooks.event for session.idle
  pollingFallback: boolean;     // default false — keep pollForResponse() (spec-008 behavior)
};
```

Sits at the top of `kafka-router.json` alongside `topics` and `rules`. Validated by extending `PluginConfigV003Schema` in `src/schemas/index.ts`:

```typescript
const PluginConfigV003Schema = z.object({
  topics: z.array(z.string()).min(1).max(5),
  rules: z.array(RuleV003Schema).min(1),
  toggles: z.object({
    toolDelivery: z.boolean().default(true),
    eventHook: z.boolean().default(true),
    pollingFallback: z.boolean().default(false),
  }).default({}),  // entire block optional; nested defaults apply
});
```

**Validation at startup (FR-T2)**: if `toolDelivery: false && eventHook: false && pollingFallback: false`, plugin refuses to start (Constitution III Resiliency violation). Error message: `errorMessage: "no delivery mechanism active: all toggles are false; set pollingFallback: true"`.

### 4. PerTestTopics (test helper)

```typescript
type PerTestTopics = {
  testName: string;
  inputTopic: string;
  responseTopic: string;
  dlqTopic: string;
  createdAt: number;
};
```

Created by `tests/e2e/helpers/perTestTopics.ts` in `beforeAll`. Names pattern: `e2e-{sanitizedTestName}-{role}` (e.g. `e2e-t_e2e_001_happy_path-input`). Cleaned in `afterAll` via `admin.deleteTopics()`.

## Schema changes

### `kafka-router.json` rule schema

Old fields preserved (NFR-3 back-compat). New fields added:

```typescript
const RuleV003Schema = z.object({
  // ... existing fields ...
  name: z.string(),
  jsonPath: z.string(),
  promptTemplate: z.string(),
  agentId: z.string(),
  responseTopic: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),

  // NEW in spec-009:
  requireToolCall: z.boolean().default(true),       // FR-6
  fallbackToTextCapture: z.boolean().default(false), // FR-6
  safetyNetTimeoutMs: z.number().int().positive().default(60_000),  // FR-6
  maxSessionMs: z.number().int().positive().default(300_000),       // FR-6
}).strict();
```

### Kafka envelope (DLQ) — new optional fields

Existing `DlqEnvelope` (spec-003) gains two optional fields, only populated when relevant:

```typescript
type DlqEnvelope = {
  // ... existing fields ...
  toolCallObserved?: boolean;       // was the LLM's send_to_kafka tool called?
  fallbackUsed?: boolean;           // was fallbackToTextCapture engaged?
  sessionDurationMs?: number;       // how long the session lived
};
```

## State machine

```
Kafka message received
    ↓
session.create()
    ↓
session.prompt() ────────► LLM streams response
    ↓                          ↓
session.idle event         (LLM calls send_to_kafka tool)
    ↓                          ↓
check toolCalled           tool.execute() publishes to responseTopic
    ↓                          ↓
requireToolCall?           SessionWatcher.toolCalled = true
    ↓                          ↓
YES → DLQ if !toolCalled   session.idle fires
NO  → OK regardless             ↓
    ↓                          cleanup SessionWatcher
commit Kafka offset
```

**Concurrency note**: All session lifecycle is driven by OpenCode events. Plugin NEVER uses `setTimeout` for session tracking — only `maxSessionMs` wall-clock guard in the `event` handler closure.

## Migration from spec-008

Old `OpenCodeAgentAdapter.pollForResponse()` is removed. The `invoke()` method becomes:

```typescript
async invoke(prompt: string, agentId: string, options: InvokeOptions): Promise<AgentResult> {
  // 1. Create session (unchanged from spec-006)
  const session = await this.client.session.create({ body: { agent: agentId, title: `kafka-plugin-${agentId}` } });
  const sessionId = session.data!.id!;

  // 2. Register per-session watcher (NEW in spec-009)
  sessionWatchers.set(sessionId, { sessionId, ruleName: ..., toolCalled: false, ... });

  // 3. Send prompt (returns immediately because tool will fire async)
  await this.client.session.prompt({ path: { id: sessionId }, body: { agent: agentId, parts: [{ type: 'text', text: prompt }] } });

  // 4. Return immediately — the actual response arrives via the tool + event hook
  return { status: 'success', response: '', sessionId, executionTimeMs: 0 };
}
```

This means `agentResult.response` is **always empty** in spec-009. The actual response text is delivered by the tool to responseTopic. Tests that assert on `agentResult.response` need to switch to asserting on responseTopic content.