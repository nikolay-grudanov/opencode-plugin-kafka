# Kafka Message Contract

**Feature**: 003-kafka-consumer | **Type**: Message Format

## Inbound Message (Consumed from Kafka)

### Structure

```typescript
interface KafkaConsumerMessage {
  topic: string;
  partition: number;
  offset: string;
  value: Buffer | null;  // null = tombstone message
  timestamp: string;
  headers?: Record<string, Buffer>;
}
```

### Normalization

Plugin normalizes incoming message to internal `KafkaMessage` format:

```typescript
interface KafkaMessage {
  value: string | null;  // Decoded from Buffer, null if tombstone
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
}
```

### Validation Rules

| Field | Rule | Handling |
|-------|------|----------|
| `value` | Non-null | Tombstone → send to DLQ |
| `value` | Size < 1MB | Oversized → send to DLQ |
| `value` | Valid JSON | Invalid JSON → send to DLQ |

## DLQ Outbound Message (Produced to DLQ Topic)

### Envelope Structure

```typescript
interface DlqEnvelope {
  originalValue: string | null;  // Original message value
  topic: string;                  // Original topic name
  partition: number;              // Original partition
  offset: string;                 // Original offset
  errorMessage: string;           // Error description
  failedAt: string;               // ISO 8601 timestamp
}
```

### DLQ Topic Resolution

1. If `KAFKA_DLQ_TOPIC` env set → use that topic
2. Otherwise → use `{original-topic}-dlq` (e.g., `my-topic-dlq`)

### Serialization

DLQ messages serialized as JSON string in `DlqEnvelope` format.

## Example Flows

### Happy Path

```
Input:  { "type": "code_review", "code": "..." }
Output: → matchRule() → buildPrompt() → OpenCode agent → commitOffsets()
```

### JSON Parse Error

```
Input:  { "type": "code_review", "broken json }
Output: → JSON.parse() throws → sendToDlq() → commitOffsets()
DLQ:    { originalValue: '{ "type', topic: 'input', partition: 0, offset: '123', errorMessage: 'Unexpected end of JSON input', failedAt: '2026-04-22T12:00:00.000Z' }
```

### Oversized Message

```
Input:  value > 1MB
Output: → size check fails → sendToDlq() → commitOffsets()
DLQ:    { originalValue: null, topic: 'input', partition: 0, offset: '456', errorMessage: 'Message size exceeds 1MB limit', failedAt: '2026-04-22T12:00:01.000Z' }
```

### Rule Match Error

```
Input:  { "type": "unknown" } with no matching rule
Output: → matchRule() returns null → log "no rule matched" → commitOffsets()
(Not an error, no DLQ)
```