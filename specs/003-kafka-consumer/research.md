# Research: 003-kafka-consumer

**Branch**: `003-kafka-consumer` | **Date**: 2026-04-22 | **Status**: Complete

## Research Summary

All NEEDS CLARIFICATION items resolved via clarifications session (2026-04-22). No additional web research required.

---

## Decision 1: KafkaJS Consumer Configuration

**Decision**: Use `sessionTimeout: 300000` (5 min), `heartbeatInterval: 30000` (30 sec) — aligned with KafkaJS defaults.

**Rationale**:
- Session timeout 5 min is standard for consumer groups with moderate processing time
- Heartbeat every 30 sec allows quick rebalance detection without excessive network traffic
- These values align with KafkaJS defaults and are appropriate for the 100-1000 msg/sec throughput target

**Alternatives considered**:
- Shorter session timeout (2 min): Would cause more frequent rebalances with no benefit
- Longer heartbeat interval (60 sec): Slower failure detection

---

## Decision 2: Sequential Processing with Backpressure

**Decision**: Consumer processes messages strictly sequentially; no parallelism.

**Rationale**:
- OpenCode agent cannot handle concurrent requests — sequential processing acts as natural backpressure
- Simplifies error handling and offset management
- Total processing time = N × single_message_time (verifiable property)
- No message ordering issues since each message is independent

**Alternatives considered**:
- Parallel processing with bounded concurrency: Complex to implement correctly, potential for agent overload
- Batching: Not suitable for this use case (each message triggers independent agent session)

---

## Decision 3: DLQ Strategy — Optional Feature with Non-Fatal Failure

**Decision**: DLQ is optional. If DLQ send fails or DLQ topic unavailable, log error and commit original message offset.

**Rationale**:
- DLQ unavailability should NOT block message processing
- Log-and-commit approach prevents infinite retry loops
- DLQ is best-effort delivery, not a hard requirement

**Alternatives considered**:
- Retry DLQ send indefinitely: Risk of blocking consumer on DLQ issues
- Throw error on DLQ failure: Violates crash isolation principle (III)

---

## Decision 4: Broker Throttle Handling

**Decision**: On throttle error: pause 1s, retry up to 3 times, then send to DLQ.

**Rationale**:
- Kafka broker throttling is expected behavior under load
- 3 retries with 1s pause gives broker time to recover
- DLQ after exhausted retries prevents poison pill messages

**Alternatives considered**:
- Immediate DLQ on throttle: Too aggressive, transient throttles would cause message loss
- No retry: Would cause unnecessary DLQ routing for transient issues

---

## Decision 5: Graceful Shutdown Timeout

**Decision**: 10 second timeout for graceful shutdown; force-kill after timeout.

**Rationale**:
- 10 seconds is sufficient to commit offsets and disconnect cleanly in normal operation
- Force-kill after timeout prevents consumer from blocking indefinitely
- SIGTERM during DLQ send: complete the send, then disconnect (no interruption)

---

## Decision 6: Environment-Based Credential Management

**Decision**: All Kafka credentials via environment variables only; none in config files.

**Rationale**:
- Credentials in env vars align with 12-factor app principles
- Config files may be committed to version control; env vars cannot
- Zod validation ensures required credentials present at startup

---

## Technical Stack Confirmation

| Technology | Decision | Justification |
|------------|----------|---------------|
| Language | TypeScript 6.x | Required by project spec |
| Kafka Client | KafkaJS | Binary-free, works in Node/Bun/Deno |
| Config Validation | Zod | Runtime validation + type inference |
| Testing | Vitest + Testcontainers + Redpanda | Required by constitution |
| JSONPath | jsonpath-plus | Existing project dependency |

---

## Open Questions: None

All clarifications resolved in Session 2026-04-22.