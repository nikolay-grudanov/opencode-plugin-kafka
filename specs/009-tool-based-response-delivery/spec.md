# Feature Specification: Tool-Based Response Delivery

**Feature Branch**: `009-tool-based-response-delivery`
**Created**: 2026-06-24
**Status**: Draft
**Input**: "Заменить polling-based response retrieval в `OpenCodeAgentAdapter` на event-driven подход через регистрацию custom tool в OpenCode SDK. Агент сам решает когда ответ готов и вызывает tool, который публикует в responseTopic. Это устраняет race condition (polling пропускает assistant messages), снижает latency (нет фиксированного 30s timeout) и открывает путь для multi-turn Kafka-сессий."

**Supersedes**: Polling-based response retrieval introduced in commit `599d18c` (spec-008 WIP).

## Context and Motivation

Spec-008 introduced `pollForResponse()` (in `OpenCodeAgentAdapter.ts`) to work around the OpenCode SDK limitation that `session.prompt()` returns `{data: undefined}` because LLM responses stream over SSE rather than completing synchronously. Live debugging on 2026-06-24 confirmed the polling implementation is unreliable:

- `session.messages()` polled every 1s for 30s — observed LLM completing in ~5s, exiting loop cleanly, yet polling still reports "No response received after 30 polling attempts" in 5/8 e2e tests.
- Each Kafka message therefore blocks the consumer for at least 30s even on success, creating severe throughput degradation.
- The architecture inherited from specs 003-006 (polling in sync-blocking mode) was a deliberate trade-off (ADR-005, ADR-006) **based on an OpenCode SDK version that did not expose the plugin API**. We have since discovered (live debugging 2026-06-24) that OpenCode 1.17.9 ships `@opencode-ai/plugin` v1.16.2 with two crucial capabilities: `Hooks.tool` (register custom tools the LLM can call) and `Hooks.event` (subscribe to a 30+-event SSE bus including `session.idle` and `message.part.updated`).

This spec adopts the official OpenCode plugin API and replaces polling with a tool-based response delivery model. It is a **non-breaking, additive change**: the external Kafka contract (input topic → response topic / DLQ) is preserved. Internal mechanics change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Agent-Initiated Response Delivery via Custom Tool (Priority: P1) 🎯 MVP

As an LLM agent invoked by the kafka plugin, when I have produced a complete answer I want to deliver it back to the Kafka response topic by calling a registered tool (`send_to_kafka`). The plugin exposes the tool to me with the right args schema (response text, topic, sessionId) and handles the actual Kafka publish transparently.

**Why this priority**: This is the core architectural shift. Without it the plugin cannot deliver responses reliably — polling failure is the root cause of all spec-008 WIP e2e test failures and the 30s-per-message throughput cliff.

**Independent Test**: Produce a Kafka message, observe that the LLM is invoked with a system prompt that mentions the `send_to_kafka` tool, observe the LLM calling the tool exactly once with the expected args, observe the response appearing in the configured response topic.

**Acceptance Scenarios**:

1. **Given** a rule with `responseTopic: opencode.responses`, **When** a Kafka message arrives and the LLM produces a final answer, **Then** the LLM calls `send_to_kafka({ response: "<answer>", responseTopic: "opencode.responses" })` and a record with `status: success` lands in `opencode.responses` within 1s of the LLM producing its last token (no 30s wait).
2. **Given** the LLM decides to call `send_to_kafka` mid-stream (before full completion, e.g. a quick answer), **Then** the tool still publishes to the response topic and the session may continue or terminate per LLM's choice — tool delivery is independent of session lifecycle.
3. **Given** a rule with `responseTopic: null` (fire-and-forget), **When** the LLM runs, **Then** the `send_to_kafka` tool is NOT registered for that rule (no error, no publish), and the plugin does not block waiting for any tool call.

### User Story 2 — Safety Net via session.idle Event (Priority: P1)

As the plugin operator, I want a safety net: if the LLM forgets to call `send_to_kafka` (model error, prompt mistake, or the rule has `responseTopic` but the LLM somehow bypasses the tool), I want the plugin to detect this via the `session.idle` event and either send to DLQ or fall back to capturing the last assistant text part via `event.message.part.updated`.

**Why this priority**: Tool calls are not guaranteed (LLM is non-deterministic). Without a safety net, lost responses become silent data loss — worse than the polling failure it replaces.

**Independent Test**: Configure a rule where the LLM is instructed NOT to call `send_to_kafka` (e.g. a "raw-echo" agent). Observe that the plugin detects the missing tool call via `session.idle` and either publishes the captured text to responseTopic (fallback mode) or sends to DLQ with `errorMessage: "tool not called within session timeout"`.

**Acceptance Scenarios**:

1. **Given** a rule with `responseTopic: opencode.responses` and `requireToolCall: true` (default), **When** the LLM completes without calling `send_to_kafka`, **Then** within `safetyNetTimeoutMs` (default 60s) of `session.idle` event the plugin sends a DLQ envelope with `errorMessage: "session idle without tool call: <sessionId>"` and commits the offset.
2. **Given** a rule with `responseTopic: opencode.responses` and `fallbackToTextCapture: true`, **When** the LLM produces an assistant text part but never calls the tool, **Then** the captured text is published to responseTopic with `status: success`, `fallbackUsed: true` field in metadata.
3. **Given** a session in tool-call-required mode that times out before `session.idle` fires (e.g. SDK bug or hung stream), **Then** a hard wall-clock timeout (`maxSessionMs`, default 300s) escalates to DLQ to prevent indefinite blocking.

### User Story 3 — Tool Registration Plugin Bootstrap (Priority: P2)

As a developer installing the plugin, I want the plugin to register the `send_to_kafka` tool automatically on OpenCode startup, with the schema derived from the loaded `kafka-router.json` (one tool instance per rule that has a `responseTopic`). I do NOT want to modify `.opencode/opencode.json` or the agent prompt files manually.

**Why this priority**: Without this, every rule requires manual `.opencode/opencode.json` edits and prompt changes — defeats the purpose of the plugin. P2 because it can ship after US1/US2 land; for the MVP a single hardcoded tool works.

**Independent Test**: On plugin boot, inspect the returned `Hooks` object. Assert it contains exactly N tools where N = number of rules with non-null `responseTopic`, each tool name is `send_to_kafka_<sanitized_rule_name>`, and each tool's args schema includes `responseTopic` (defaulted to that rule's responseTopic), `sessionId` (auto-filled from `ctx.sessionID`), and `response` (the answer text).

**Acceptance Scenarios**:

1. **Given** `kafka-router.json` with 2 rules both having `responseTopic`, **When** the plugin loads, **Then** `Hooks.tool` contains exactly 2 keys named `send_to_kafka_rule_a` and `send_to_kafka_rule_b`.
2. **Given** a rule with `responseTopic: null`, **When** the plugin loads, **Then** no tool is registered for that rule (other rules still get their tools).
3. **Given** the agent calls one of the registered tools, **When** the tool's `execute()` runs, **Then** `ctx.sessionID` (passed by OpenCode) matches the session that was created by the plugin for the Kafka message, allowing correlation of request → response.

### User Story 4 — Per-Test DLQ Topics for E2E Isolation (Priority: P2)

As a test author, I want each e2e test to have its own DLQ topic so that `consumeOneMessage()` cannot accidentally catch an envelope from a previous test (the root cause of T-E2E-007 and T-E2E-008 failures on 2026-06-24).

**Why this priority**: Without this, e2e tests are flaky and the team loses trust in the test suite. P2 because it unblocks the test gate but does not affect production behavior.

**Independent Test**: Run the full e2e suite. Assert that no test consumes a message produced by a different test — verifiable by unique topic names per `describe()` block.

**Acceptance Scenarios**:

1. **Given** test file `tests/e2e/consumer.e2e.test.ts` with multiple `describe()` blocks, **When** each `beforeAll` runs, **Then** a unique DLQ topic is created (e.g. `e2e-input-T-E2E-001-dlq`, `e2e-input-T-E2E-007-dlq`) and the plugin is configured to write to it for that test only.
2. **Given** two tests fail and both write envelopes to their respective per-test DLQs, **When** `afterAll` cleans up, **Then** the per-test DLQ topics are deleted (or marked for cleanup) so they do not pollute Kafka.

### Edge Cases

- **What happens when `session.prompt()` is called on an aborted/cancelled session?** The `AbortController` signal wired into the tool's `execute(args, ctx)` (via `ctx.abort`) must propagate; tool publish to Kafka should fail fast if aborted.
- **How does the plugin handle multiple tools being called in a single session?** OpenCode allows multiple tool invocations per turn. The plugin should accept the first `send_to_kafka_*` tool call and ignore subsequent calls for the same session (idempotent — record session completion in a Set).
- **What if the LLM calls a tool with an empty `response` string?** The plugin should publish to DLQ with `errorMessage: "empty response from agent"`, not silently commit a zero-length answer.
- **What if Kafka is unavailable when the tool's `execute()` runs?** The tool returns an error to the LLM ("kafka publish failed") which the LLM may surface to the user; the plugin also schedules the DLQ envelope asynchronously so the offset can be committed even if Kafka is down.
- **What if the plugin is loaded into an OpenCode instance that does not support `Hooks.tool` (older SDK)?** Plugin must log a clear warning, fall back to spec-008 polling mode for that session, and continue operating. This is a graceful-degradation path, not an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-1**: Plugin MUST register one custom tool per rule with non-null `responseTopic`. Tool name MUST be `send_to_kafka_<sanitized_rule_name>` where `<sanitized_rule_name>` is the rule name with non-alphanumeric chars replaced by `_`.
- **FR-2**: Tool args schema MUST be a Zod object with three fields: `responseTopic` (string, optional if rule has exactly one responseTopic — auto-filled), `response` (string, the answer), `sessionId` (string, optional — auto-filled from `ctx.sessionID` if omitted).
- **FR-3**: Tool `execute(args, ctx)` MUST publish `{sessionId, ruleName, agentId, response, status: "success", executionTimeMs, timestamp}` to `args.responseTopic` via the existing `sendResponse()` producer. Tool MUST return `{output: "published to <topic>"}` on success.
- **FR-4**: Plugin MUST subscribe to the global `event` hook and filter for `type: "session.idle"`. For each idle session where the rule requires a tool call (`requireToolCall: true` default), if no `send_to_kafka_*` tool was called for that session, plugin MUST send a DLQ envelope.
- **FR-5**: Plugin MUST also subscribe to `event.message.part.updated` filtered for `part.type === "text"` and `part.sessionID` matches a session the plugin created. This is used by the optional `fallbackToTextCapture` mode (US2).
- **FR-6**: Plugin MUST expose new rule config fields in `kafka-router.json` schema: `requireToolCall` (boolean, default `true`), `fallbackToTextCapture` (boolean, default `false`), `safetyNetTimeoutMs` (number, default `60000`), `maxSessionMs` (number, default `300000`).
- **FR-7**: Plugin MUST remove `pollForResponse()` and the `MAX_POLL_ATTEMPTS`/`POLL_INTERVAL_MS` constants from `OpenCodeAgentAdapter.ts`. The adapter's `invoke()` becomes a thin shim that creates the session, builds the prompt with the tool-aware system prefix, calls `session.prompt()`, and returns immediately (the tool fires the actual publish asynchronously).
- **FR-8**: E2E test harness MUST use per-test DLQ topics. A new helper `tests/e2e/helpers/perTestTopics.ts` exposes `createPerTestTopics(testName)` that creates uniquely-named input/response/dlq topics and returns their names for the test to use.
- **FR-9**: Plugin MUST keep `session.error` observability hook (already implemented in commit `fcae64e`) — this is independent of the tool migration.
- **FR-10**: Plugin MUST NOT introduce new long-lived state. Per-session state (e.g. "did this session already call the tool?") MUST live inside the `session.idle` handler closure for the duration of one session and be discarded after offset commit.

### Non-Functional Requirements

- **NFR-1 (Performance)**: Median end-to-end latency from Kafka message arrival to response in responseTopic MUST be ≤ LLM streaming time + 1s (currently ≥ LLM streaming time + 30s due to polling). Worst case under `maxSessionMs` timeout MUST be ≤ `maxSessionMs + 5s`.
- **NFR-2 (Observability)**: Each Kafka message MUST produce exactly one structured log event with `event: "kafka_message_lifecycle"` and a `phase` field that transitions: `received → session_created → tool_called → response_sent → offset_committed` (or `→ dlq_sent` on failure). All phases MUST be logged with `sessionId` and `ruleName`.
- **NFR-3 (Backwards compat)**: `kafka-router.json` config files written for spec-008 (without the new fields) MUST load with `requireToolCall: true` and `fallbackToTextCapture: false` defaults — existing configs continue to work unchanged.
- **NFR-4 (Constitution)**: This spec MUST NOT violate Constitution Principle IV (No-State Consumer). The "did this session call the tool?" state lives in the per-session event handler closure for ≤ `maxSessionMs` and is discarded after offset commit. It is not cross-session state.
- **NFR-5 (Test coverage)**: Unit test coverage for new code in `src/opencode/tool-handler.ts` MUST be ≥ 90% (lines/branches/functions/statements), matching the existing project threshold.

### Key Entities *(see data-model.md for full schema)*

- **Tool Definition** — OpenCode `ToolDefinition` with Zod args schema and `execute(args, ctx)`. One instance per rule with `responseTopic`.
- **Session Watcher** — per-session Set of `{toolCalled: boolean, sessionId: string, ruleName: string, startTime: number}`. Lives in `event` hook closure; auto-cleaned on `session.idle` or `maxSessionMs` timeout.
- **PerTestTopics** — `{inputTopic, responseTopic, dlqTopic: string}` returned by `createPerTestTopics(testName)`. Created in `beforeAll`, cleaned in `afterAll`.

## Out of Scope

- Multi-turn Kafka conversations (where the LLM tool calls back into Kafka to fetch more context) — future spec.
- Streaming response parts into response topic one delta at a time — out of scope, single message per tool call.
- Tool that allows the LLM to abort or skip a Kafka message — covered by `AbortController` signal in `ctx.abort`, no explicit "skip" tool needed.
- Replacing `kafkajs` with a different Kafka client — out of scope.

## Open Questions *(to resolve before implementation)*

1. Should `requireToolCall: false` be the default for new rules? Current default `true` favors safety (DLQ on no-call) but may be too strict for simple agents. Decision needed during `/speckit.clarify`.
2. Should `fallbackToTextCapture: true` be a separate opt-in or a fallback always-on? It complicates correctness (LLM may produce multiple text parts; which one wins?) — recommend opt-in only, default off.
3. Should the plugin also register a `send_to_dlq` tool for the LLM to explicitly fail messages? Useful for "I can't answer this question" cases. Out of scope for this spec, considered for 010.