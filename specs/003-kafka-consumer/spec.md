# Feature Specification: 003-kafka-consumer — KafkaJS Consumer with DLQ

**Feature Branch**: `003-kafka-consumer`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "нужно создать новую ветку для новой задачи..."

## Clarifications

### Session 2026-04-22

- Q: What throughput expectation? → A: Medium throughput (100-1000 msg/sec)
- Q: What latency target? → A: High latency (≤5s acceptable)
- Q: Scalability limits? → A: Pre-configured static limits (max 10 partitions/consumer, max 5 topics; horizontal scaling via multiple instances with manual partition assignment)
- Q: Max message size? → A: 1MB default limit (aligned with KafkaJS default; messages >1MB sent to DLQ)
- Q: Broker throttle handling? → A: Graceful retry with backpressure (pause 1s on throttle, retry up to 3 times, then DLQ)
- Q: Throughput overflow behavior? → A: Backpressure + sequential queue (consumer slows down to maintain sequential processing; new messages queue locally)
- Q: DLQ unavailability strategy? → A: DLQ is optional; if DLQ topic is unavailable, log error and commit original message offset (non-fatal)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Environment-based Kafka Initialization (Priority: P1)

As a plugin operator,
I want the KafkaJS client to initialize from environment variables,
So that credentials never appear in config files.

**Why this priority**: Без инициализации из env плагин не сможет подключиться к Kafka — это базовое требование.

**Independent Test**: Может быть протестировано независимо через установку env vars и проверку создания Kafka client.

**Acceptance Scenarios**:

1. **Given** required env vars (`KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`) are set, **When** `createKafkaClient()` is called, **Then** Kafka client is created successfully
2. **Given** `KAFKA_BROKERS` is missing, **When** `createKafkaClient()` is called, **Then** descriptive Error is thrown mentioning missing field
3. **Given** `KAFKA_SSL=true` is set, **When** `createKafkaClient()` is called, **Then** SSL is enabled in client config
4. **Given** `KAFKA_USERNAME` + `KAFKA_PASSWORD` are set, **When** `createKafkaClient()` is called, **Then** SASL authentication is configured with mechanism from `KAFKA_SASL_MECHANISM` (default: plain)
5. **Given** consumer is created, **When** consumer connects, **Then** `sessionTimeout` is 300000ms and `heartbeatInterval` is 30000ms

---

### User Story 2 — Sequential Message Processing with Backpressure (Priority: P1)

As a plugin operator,
I want Kafka messages to be processed strictly one-at-a-time,
So that the OpenCode agent is never overloaded.

**Why this priority**: Защита от перегрузки OpenCode агента — критично для стабильности системы.

**Independent Test**: Может быть протестировано через отправку множественных сообщений и проверки времени обработки (sequential timing).

**Acceptance Scenarios**:

1. **Given** consumer is running with `autoCommit: false`, **When** messages arrive, **Then** they are processed strictly sequentially (next message starts only after current `await` resolves)
2. **Given** message handler resolves successfully, **When** processing completes, **Then** `commitOffsets()` is called immediately
3. **Given** multiple messages are processed, **When** timing is measured, **Then** total time ≈ N × single message time (no parallelism)
4. **Given** message handler is invoked multiple times, **When** between invocations, **Then** no global state persists between messages

---

### User Story 3 — Dead Letter Queue on Processing Failure (Priority: P1)

As a plugin operator,
I want failed messages routed to a DLQ topic,
So that no message is silently lost.

**Why this priority**: No message loss — каждое сообщение должно быть либо обработано, либо отправлено в DLQ.

**Independent Test**: Может быть протестировано через отправку invalid JSON и проверку содержимого DLQ топика.

**Acceptance Scenarios**:

1. **Given** `eachMessage` handler receives message with invalid JSON, **When** JSON.parse throws, **Then** error is caught and message is published to DLQ topic
2. **Given** `eachMessage` handler receives message but `matchRule()` throws, **When** exception occurs, **Then** error is caught and message is published to DLQ topic
3. **Given** `eachMessage` handler receives message but `buildPrompt()` throws, **When** exception occurs, **Then** error is caught and message is published to DLQ topic
4. **Given** DLQ message is sent, **When** it is produced, **Then** it contains: original `value`, original `topic`, `partition`, `offset`, `error.message`, ISO `failedAt` timestamp
5. **Given** DLQ topic is configured via `KAFKA_DLQ_TOPIC`, **When** sending to DLQ, **Then** message goes to configured topic; otherwise defaults to `{original-topic}-dlq`
6. **Given** DLQ producer send fails, **When** send error occurs, **Then** error is logged but consumer process does NOT crash
7. **Given** DLQ send succeeds, **When** message processing throws, **Then** `commitOffsets()` is called (message is NOT retried)

---

### User Story 4 — Graceful Shutdown (Priority: P2)

As a plugin operator,
I want the consumer to disconnect cleanly on SIGTERM/SIGINT,
So that in-flight messages are not duplicated.

**Why this priority**: Предотвращение дублирования сообщений при передеплое.

**Independent Test**: Может быть протестировано через отправку SIGTERM и проверку корректного disconnect.

**Acceptance Scenarios**:

1. **Given** consumer is running, **When** SIGTERM is received, **Then** `consumer.disconnect()` is called, then `producer.disconnect()` is called
2. **Given** SIGTERM is received, **When** shutdown sequence runs, **Then** it completes within 10 seconds (force-kill after timeout)
3. **Given** shutdown sequence runs, **When** it executes, **Then** sequence is logged

---

### User Story 5 — Real Kafka Producer Integration Test (Priority: P1)

As a developer,
I want an integration test that sends real messages via KafkaJS producer to Redpanda,
So that the full consumer→routing→DLQ flow is verified end-to-end.

**Why this priority**: Интеграционный тест — единственный способ проверить всю цепочку от продюсера до DLQ.

**Independent Test**: Это самостоятельный интеграционный тест, требующий Redpanda контейнер.

**Acceptance Scenarios**:

1. **Given** Redpanda testcontainer is running, **When** integration test starts, **Then** it creates a KafkaJS producer connected to Redpanda
2. **Given** producer is connected, **When** test sends 3 messages (one matching rule, one non-matching, one invalid JSON), **Then** all messages are received by consumer
3. **Given** matching message is processed, **When** `matchRule()` + `buildPrompt()` are called, **Then** correct result is produced
4. **Given** invalid JSON message is processed, **When** JSON.parse fails, **Then** message lands in DLQ topic
5. **Given** multiple messages are processed, **When** total processing time is measured, **Then** total time ≈ N × single message time (sequential, no parallelism)

---

### Edge Cases

- `KAFKA_BROKERS` contains trailing spaces → trim each broker before passing to KafkaJS
- `message.value` is null (Kafka tombstone) → treat as invalid JSON → DLQ
- `matchRule()` returns null (no matching rule) → NOT an error, just skip + log "no rule matched", then commit
- DLQ topic send fails → log error, still commit original message offset (avoid infinite loop); DLQ is optional feature
- DLQ topic unavailable → log error and commit original message offset (non-fatal, DLQ is optional)
- `SIGTERM` arrives during DLQ send → complete the send, then disconnect
- `message.value` exceeds 1MB → treat as oversized → send to DLQ
- Kafka broker throttle detected → pause processing for 1s, retry up to 3 times, then send to DLQ if throttle persists

## Requirements *(mandatory)*

### Functional Requirements

- **FR-019**: `createKafkaClient(env: NodeJS.ProcessEnv): Kafka` — reads `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`; throws Error with field name if required var missing; configures SSL and SASL conditionally; **env vars validated via Zod schema** (strict mode — fail-fast on invalid env)
- **FR-020**: `createConsumer(kafka: Kafka): Consumer` — `sessionTimeout: 300000`, `heartbeatInterval: 30000`; `groupId` from `KAFKA_GROUP_ID` env
- **FR-021**: `createDlqProducer(kafka: Kafka): Producer` — dedicated producer instance for DLQ sends; separate from any future main-flow producer
- **FR-022**: `sendToDlq(producer, originalMessage, topic, error): Promise<void>` — constructs DLQ payload with `originalValue`, `topic`, `partition`, `offset`, `errorMessage`, `failedAt`; target topic from `KAFKA_DLQ_TOPIC` env or `${topic}-dlq`; wraps in try/catch, logs on failure, never throws
- **FR-023**: `eachMessageHandler(payload, config, dlqProducer): Promise<void>` — parses `message.value` as JSON (throws → DLQ); validates message size (max 1MB, oversized → DLQ); calls `matchRule()` (throws → DLQ); calls `buildPrompt()` (throws → DLQ); logs matched rule name and prompt; commits offset on success
- **FR-024**: `startConsumer(config: PluginConfig): Promise<void>` — wires FR-019..FR-023 together; subscribes to all `config.topics`; registers SIGTERM/SIGINT handlers
- **FR-025**: `src/index.ts` plugin entry point — reads `kafka-router.json` from `KAFKA_ROUTER_CONFIG` env (default: `.opencode/kafka-router.json`); calls `parseConfig()` on file contents; calls `startConsumer(config)`; exports default async function `start(): Promise<void>`

### Non-Functional Requirements

- **NFR-005**: No message loss — every message either committed or sent to DLQ
- **NFR-006**: Crash isolation — eachMessage errors never crash consumer process
- **NFR-007**: Env-only credentials — no secrets in config files or code
- **NFR-008**: Graceful shutdown ≤ 10 seconds
- **NFR-009**: Integration test uses only Redpanda (not Apache Kafka)
- **NFR-010**: Observability — structured JSON logs with key metrics: message processing time, DLQ rate, consumer lag
- **NFR-011**: Scalability — max 10 partitions per consumer instance, max 5 topics per instance; horizontal scaling via multiple plugin instances with manual partition assignment
- **NFR-012**: Broker throttle resilience — on Kafka producer throttle error, pause 1s and retry up to 3 times; if throttle persists, route to DLQ
- **NFR-013**: Throughput overflow — consumer maintains sequential processing as backpressure mechanism; local queue absorbs spikes above 1000 msg/sec without overwhelming OpenCode agent

### Key Entities *(include if feature involves data)*

- **DlqEnvelope**: Message envelope for DLQ — contains `originalValue` (string | null), `topic` (string), `partition` (number), `offset` (string), `errorMessage` (string), `failedAt` (ISO string timestamp)
- **KafkaEnv**: Environment variables interface — `KAFKA_BROKERS` (required, comma-separated), `KAFKA_CLIENT_ID` (required), `KAFKA_GROUP_ID` (required), `KAFKA_SSL` (optional, default false), `KAFKA_USERNAME` (optional, enables SASL), `KAFKA_PASSWORD` (optional), `KAFKA_SASL_MECHANISM` (optional, default plain), `KAFKA_DLQ_TOPIC` (optional, default `{topic}-dlq`), `KAFKA_ROUTER_CONFIG` (optional, default `.opencode/kafka-router.json`)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Missing required env vars (`KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`) throw descriptive Error at startup — fail-fast behavior
- **SC-002**: Messages are processed strictly sequentially — no parallelism; timing assertion passes: total time ≈ N × single message time
- **SC-003**: System handles medium throughput: 100-1000 messages/second with stable processing
- **SC-004**: Individual message processing latency ≤5 seconds (high latency acceptable)
- **SC-005**: Every error in `eachMessage` (JSON parse, matchRule, buildPrompt) routes message to DLQ — zero unhandled exceptions crash consumer
- **SC-006**: DLQ producer send failure logs error but does NOT crash consumer process — crash isolation verified
- **SC-007**: Graceful shutdown completes within 10 seconds including disconnect of consumer and producer
- **SC-008**: Integration test with real KafkaJS producer to Redpanda passes — full end-to-end flow verified
- **SC-009**: Code coverage ≥ 90% on new files (`src/kafka/*.ts`)
- **SC-010**: No message loss — every message either committed (success) or sent to DLQ (failure)
- **SC-011**: DLQ unavailability is non-fatal — if DLQ topic is unavailable, error is logged and original message offset is committed (consumer continues)