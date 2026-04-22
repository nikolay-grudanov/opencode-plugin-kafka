# Data Model: 003-kafka-consumer

**Branch**: `003-kafka-consumer` | **Date**: 2026-04-22 | **Status**: Complete

## Entity Definitions

### KafkaEnv

Environment variables interface for Kafka client configuration.

```typescript
interface KafkaEnv {
  // Required fields
  KAFKA_BROKERS: string;         // Comma-separated broker list
  KAFKA_CLIENT_ID: string;       // Client identifier
  KAFKA_GROUP_ID: string;        // Consumer group ID

  // Optional SSL
  KAFKA_SSL?: boolean;           // Default: false

  // Optional SASL authentication
  KAFKA_USERNAME?: string;       // Enables SASL if set
  KAFKA_PASSWORD?: string;
  KAFKA_SASL_MECHANISM?: string; // Default: 'plain'

  // Optional DLQ
  KAFKA_DLQ_TOPIC?: string;      // Default: `{original-topic}-dlq`

  // Optional config path
  KAFKA_ROUTER_CONFIG?: string;  // Default: '.opencode/kafka-router.json'
}
```

### DlqEnvelope

Message envelope for Dead Letter Queue.

```typescript
interface DlqEnvelope {
  originalValue: string | null;  // Original message value (may be null for tombstone)
  topic: string;                  // Original topic name
  partition: number;              // Original partition
  offset: string;                // Original offset (string for large numbers)
  errorMessage: string;           // Error description
  failedAt: string;               // ISO 8601 timestamp
}
```

### PluginConfig

Configuration loaded from `kafka-router.json`.

```typescript
interface PluginConfig {
  topics: string[];               // List of topics to subscribe (max 5)
  rules: Rule[];                  // Routing rules
}

interface Rule {
  name: string;                   // Human-readable rule name
  jsonPath: string;               // JSONPath expression for matching
  promptTemplate: string;         // Template for building prompt
}
```

### KafkaMessage

Normalized message structure used internally.

```typescript
interface KafkaMessage {
  value: string | null;           // Message value (null = tombstone)
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
}
```

### ProcessingResult

Result of message processing.

```typescript
interface ProcessingResult {
  success: boolean;
  matchedRule?: string;
  prompt?: string;
  error?: string;
  sentToDlq: boolean;
  committed: boolean;
}
```

## Validation Rules

| Field | Rule | Error Code |
|-------|------|------------|
| `KAFKA_BROKERS` | Non-empty string, trimmed | `MISSING_KAFKA_BROKERS` |
| `KAFKA_CLIENT_ID` | Non-empty string | `MISSING_KAFKA_CLIENT_ID` |
| `KAFKA_GROUP_ID` | Non-empty string | `MISSING_KAFKA_GROUP_ID` |
| `topics` | Array, max 5 items | `TOPICS_LIMIT_EXCEEDED` |
| `message.value` | Non-null, < 1MB | `MESSAGE_TOO_LARGE` |
| `topic` | Non-empty string | `INVALID_TOPIC` |

## State Transitions

### Consumer Lifecycle

```
CREATED → CONNECTING → CONNECTED → CONSUMING → DISCONNECTING → DISCONNECTED
                ↓           ↓           ↓
            THROTTLED    ERROR       PAUSED
                              ↓         ↓
                           DLQ_SEND  RESUMING
```

### Message Processing States

```
RECEIVED → PARSING → MATCHING → BUILDING → PROCESSING → COMMITTED
              ↓          ↓          ↓
            DLQ_SEND   DLQ_SEND   DLQ_SEND
```

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Plugin Entry (index.ts)                      │
│                         start() → startConsumer()                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Kafka Client (client.ts)                          │
│  createKafkaClient(env) → Kafka                                     │
│  createConsumer(kafka) → Consumer                                   │
│  createDlqProducer(kafka) → Producer                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Consumer (consumer.ts)                               │
│  startConsumer(config)                                              │
│  eachMessageHandler(payload)                                         │
└─────────────────────────────────────────────────────────────────────┘
        │                           │                       │
        ▼                           ▼                       ▼
   ┌─────────┐              ┌─────────────┐          ┌─────────┐
   │ Routing  │              │   Prompt    │          │   DLQ   │
   │ matchRule│              │ buildPrompt │          │ sendToDlq│
   └─────────┘              └─────────────┘          └─────────┘
```

## Type Dependencies

```
PluginConfig (config.ts) ← Rule (schemas/index.ts)
     │
     ├── topics: string[]
     └── rules: Rule[]
              │
              ├── name: string
              ├── jsonPath: string
              └── promptTemplate: string

KafkaEnv (schemas/index.ts) ← z.infer<typeof kafkaEnvSchema>
     │
     ├── KAFKA_BROKERS: string (required)
     ├── KAFKA_CLIENT_ID: string (required)
     ├── KAFKA_GROUP_ID: string (required)
     ├── KAFKA_SSL?: boolean
     ├── KAFKA_USERNAME?: string
     ├── KAFKA_PASSWORD?: string
     └── KAFKA_SASL_MECHANISM?: string
```

## Excluded from Coverage

The following type-only files are excluded from coverage per spec 002:

- `src/core/types.ts` — removed, types now exported from `src/schemas/index.ts`
- `src/core/index.ts` — re-exports only, no runtime code

## Data Flow

```
1. Plugin.start() → reads KAFKA_ROUTER_CONFIG env → parseConfig()
2. parseConfig() → validates kafka-router.json → PluginConfig
3. createKafkaClient(env) → Kafka client (env vars via Zod validation)
4. createConsumer(kafka) → Consumer (sessionTimeout: 300000, heartbeatInterval: 30000)
5. createDlqProducer(kafka) → Producer (separate from main flow)
6. startConsumer(config) → subscribes to config.topics
7. eachMessage arrives → eachMessageHandler(payload, config, dlqProducer)
   a. Parse JSON.parse(message.value) → throws → sendToDlq()
   b. Validate size → > 1MB → sendToDlq()
   c. matchRule(parsed, config.rules) → throws → sendToDlq()
   d. buildPrompt(matchedRule, parsed) → throws → sendToDlq()
   e. Success → commitOffsets()
```