# Quickstart: 003-kafka-consumer

**Feature**: 003-kafka-consumer | **Type**: Developer Guide

## Prerequisites

- Node.js 18+ or Bun 1.0+
- Kafka broker (or Redpanda for local development)
- OpenCode agent

## Installation

```bash
npm install
```

## Environment Variables

Create `.env` file with required variables:

```bash
# Required
export KAFKA_BROKERS="broker1:9092,broker2:9092"
export KAFKA_CLIENT_ID="opencode-plugin-kafka"
export KAFKA_GROUP_ID="opencode-agent-group"

# Optional - SSL
export KAFKA_SSL="true"

# Optional - SASL authentication
export KAFKA_USERNAME="myuser"
export KAFKA_PASSWORD="mypassword"
export KAFKA_SASL_MECHANISM="plain"  # or 'scram-sha-256', 'scram-sha-512'

# Optional - DLQ topic (default: {original-topic}-dlq)
export KAFKA_DLQ_TOPIC="my-dlq-topic"

# Optional - config file path (default: .opencode/kafka-router.json)
export KAFKA_ROUTER_CONFIG=".opencode/kafka-router.json"

# Optional - tombstone handling (default: false — tombstones sent to DLQ)
export KAFKA_IGNORE_TOMBSTONES="false"
```

## Configuration File

Create `.opencode/kafka-router.json`:

```json
{
  "topics": ["opencode-tasks", "opencode-results"],
  "rules": [
    {
      "name": "code-review",
      "jsonPath": "$.type",
      "promptTemplate": "Review this code: ${context.code}"
    },
    {
      "name": "refactor",
      "jsonPath": "$.intent",
      "promptTemplate": "Refactor: ${context.description}"
    }
  ]
}
```

## Running the Plugin

```bash
# Development
npm run dev

# Production
npm start
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest tests/unit/routing.test.ts
```

## Integration Tests (Redpanda)

```bash
# Start Redpanda container
podman run -d --name redpanda -p 9092:9092 redpandadata/redpanda:latest

# Run integration tests
npm run test:integration

# Stop Redpanda
podman stop redpanda
```

## Troubleshooting

### Consumer not connecting

1. Check `KAFKA_BROKERS` is correct and brokers are reachable
2. Verify firewall allows connection to Kafka ports
3. Check `KAFKA_CLIENT_ID` and `KAFKA_GROUP_ID` are set

### Messages not being routed to DLQ

1. Verify DLQ topic exists (or `KAFKA_DLQ_TOPIC` is set correctly)
2. Check plugin logs for DLQ send errors
3. Verify `KAFKA_DLQ_TOPIC` has appropriate write permissions

### High latency

1. Sequential processing is expected behavior (backpressure)
2. Check OpenCode agent is responding within 5s
3. Monitor consumer lag via Kafka metrics

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        OpenCode Agent                                 │
│                                                                      │
│  1. Plugin subscribes to Kafka topics                                │
│  2. Message arrives → eachMessageHandler()                           │
│  3. matchRule() → finds matching JSONPath rule                       │
│  4. buildPrompt() → constructs prompt from template                  │
│  5. client.sessions.create() → invokes OpenCode agent                 │
│  6. Response logged, offset committed                                │
│                                                                      │
│  On Error:                                                            │
│  - JSON parse error → sendToDlq() → commit                           │
│  - Rule match error → sendToDlq() → commit                           │
│  - Prompt build error → sendToDlq() → commit                         │
│  - DLQ send error → log error → commit (non-fatal)                   │
└──────────────────────────────────────────────────────────────────────┘
```