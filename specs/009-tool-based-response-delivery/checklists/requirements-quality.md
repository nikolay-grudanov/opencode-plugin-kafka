# Requirements Quality Checklist — Spec 009 Tool-Based Response Delivery

**Purpose**: Validate quality of requirements in `spec.md`, NOT verify implementation.
**Spec under review**: `specs/009-tool-based-response-delivery/spec.md`

## Compatibility Analysis

- [ ] Does the spec explicitly state that `matchRuleV003` and `promptTemplate` logic are UNCHANGED?
- [ ] Does the spec explicitly state that `agentId` flow (from rule to `agent.invoke()`) is UNCHANGED?
- [ ] Does the spec define plugin-level toggles (`toolDelivery`, `eventHook`, `pollingFallback`) at the top of `kafka-router.json` (not per-rule)?
- [ ] Does the spec define behavior for **each of the 8 combinations** of toggles?
- [ ] Does the spec refuse to boot when all three toggles are false (Constitution III)?

## Completeness

- [ ] Does the spec define behavior for **each rule** with `responseTopic` set (US1)?
- [ ] Does the spec define behavior for rules with `responseTopic: null` (fire-and-forget)?
- [ ] Does the spec define behavior when **LLM does not call the tool** (US2 safety net)?
- [ ] Does the spec define behavior when **tool is called with empty `response`**?
- [ ] Does the spec define behavior when **Kafka is unavailable during tool.execute()**?
- [ ] Does the spec define behavior when **OpenCode SDK < 1.16** (graceful degradation)?
- [ ] Does the spec define behavior when **multiple tools called in one session**?
- [ ] Does the spec define behavior when **session is aborted during tool.execute()** (AbortController)?
- [ ] Does the spec define **per-test DLQ topic naming convention** (US4)?
- [ ] Does the spec define what happens to **previous spec-008 e2e tests** — broken, rewritten, deprecated?

## Clarity

- [ ] Is "agent decides when answer is ready" quantified? What if agent decides never?
- [ ] Is "scoped ephemeral state" (Constitution IV) explicitly defined with lifetime bounds?
- [ ] Is `safetyNetTimeoutMs` distinguished from `maxSessionMs` — when each fires?
- [ ] Is the relationship between `requireToolCall: true` and `fallbackToTextCapture: true` defined? Both can be true — which wins?
- [ ] Is the tool name pattern (`send_to_kafka_<sanitized>`) collision-safe for rules with similar names?

## Consistency

- [ ] Are the same names used in spec.md, plan.md, tasks.md, data-model.md, ADR-009?
- [ ] Does FR-7 (remove polling) align with tasks.md Phase 3 (T008)?
- [ ] Does US4 in spec align with Phase 5 (T013-T014) in tasks.md?
- [ ] Does Constitution IV (No-State Consumer) still hold given SessionWatcher Map?
- [ ] Are ADR-005 and ADR-006 referenced correctly as "superseded"?

## Coverage

- [ ] Does the spec cover the **migration path** from spec-008 (which tests break, which work)?
- [ ] Does the spec cover **observability** for the new lifecycle (NFR-2: phase log)?
- [ ] Does the spec cover **rollback** if OpenCode SDK breaks `Hooks.tool` in future?
- [ ] Are performance characteristics (latency floor, throughput) explicitly stated (NFR-1)?

## Edge Cases

- [ ] Concurrent sessions from different Kafka partitions — bounded by rule `concurrency`?
- [ ] Tool called multiple times in one session (idempotency)?
- [ ] Tool called with `responseTopic` not in `kafka-router.json` config (rejected by Kafka ACL or auto-create)?
- [ ] Session idle event fires for a session not created by the plugin (filtered out)?
- [ ] `message.part.updated` event for non-text parts (filtered out)?

## Notes

This checklist validates the requirements in `spec.md`. Implementation verification (does the code do what the spec says?) is done via unit + integration + e2e tests, not via this checklist.