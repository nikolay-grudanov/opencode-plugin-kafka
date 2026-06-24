# DEMO.md — Demo Documentation

## Overview

This document provides step-by-step demos for managers and users, with screenshots, commands, and expected outputs. Run these demos to verify the plugin works correctly.

## Table of Contents

1. [Quick Demo](#1-quick-demo)
2. [Full E2E Demo](#2-full-e2e-demo)
3. [SSL Demo](#3-ssl-demo)
4. [Manual Testing](#4-manual-testing)
5. [Demo Scenarios](#5-demo-scenarios)

---

## 1. Quick Demo

### Prerequisite

Start Kafka first:

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
docker-compose -f docker-compose.kafka.yml up -d
```

Wait for Kafka to be ready (check with `docker-compose -f docker-compose.kafka.yml logs kafka`).

### Run Demo

```bash
npm run build
npm run demo
```

### Expected Output

```text
[Producer] Connecting to Kafka...
[Producer] ✅ Producer connected to Kafka
[Producer] Sending message to opencode.prompts...
[Producer] ✅ Message sent: { task_id: 'demo-001', type: 'code_review' }
[Consumer] Waiting for messages...
[Consumer] ✅ Message received: { task_id: 'demo-001', type: 'code_review' }
[Consumer] ✅ Demo completed successfully!
```

---

## 2. Full E2E Demo

This demo shows the complete flow: **produce → consume → process → verify response/DLQ**

### Prerequisites

```bash
# Ensure dependencies are installed
npm install
npm run build

# Start Kafka
docker-compose -f docker-compose.kafka.yml up -d
```

### Run Full Demo

```bash
node scripts/demo-full.mjs
```

### Expected Flow

```
========================================
FULL E2E DEMO - opencode-plugin-kafka
========================================
[Step 1] Starting Kafka...
✅ Kafka ready (localhost:9092)

[Step 2] Creating topics...
✅ Topics created:
  - demo-input (input)
  - demo-response (responses)
  - demo-input-dlq (DLQ)

[Step 3] Sending test message...
✅ Message sent to demo-input:
  {
    "task": "What is 2+2? Answer briefly.",
    "correlationId": "demo-full-001"
  }

[Step 4] Starting consumer (5s)...

[Step 5] Processing message...
  → Payload parsed: { task: "What is 2+2? Answer briefly.", correlationId: "demo-full-001" }
  → Rule matched: demo-rule (jsonPath: $.task)
  → Prompt built: What is 2+2? Answer briefly.
  → Calling agent: demo-agent (timeout: 30000ms)
  → Agent responded: "4" (in 2456ms)
  → Response sent to demo-response topic

[Step 6] Verifying response...
✅ Response received:
  {
    "correlationId": "demo-full-001",
    "response": "4",
    "status": "success",
    "executionTimeMs": 2456
  }

[Step 7] Cleanup...
✅ Demo completed successfully!

========================================
SUMMARY
========================================
Total messages sent:     1
Messages processed:    1
Successes:            1
Errors:              0
DLQ messages:         0
Duration:            3.2s
========================================
```

### What the Demo Shows

1. ✅ Kafka connectivity
2. ✅ Topic creation
3. ✅ Message production
4. ✅ Message consumption
5. ✅ JSON parsing
6. ✅ JSONPath routing
7. ✅ Prompt building with placeholders
8. ✅ Mock agent invocation
9. ✅ Response production
10. ✅ Offset committing

---

## 3. SSL Demo

### Prerequisites

```bash
# Generate SSL certificates first
mkdir -p kafka-ssl
# (See AGENTS.md for certificate generation)
```

### Run SSL Demo

```bash
npm run build
npm run demo:ssl
```

### Expected Output

```text
SSL Demo
======
✅ Producer connecting with SSL...
✅ Producer connected (SSL enabled)
�� SSL handshake successful
✅ Demo completed!
```

---

## 4. Manual Testing

### Option 1: Using Kafka UI

1. Open http://localhost:8090
2. Select cluster "local"
3. Navigate to **Topics**
4. Click a topic to view messages

### Option 2: Using rpk CLI

```bash
# List topics
podman exec redpanda rpk topic list

# Produce a message
podman exec -it redpanda rpk topic produce demo-input
# Enter: {"task": "Hello", "correlationId": "manual-001"}
# Press Ctrl+D to send

# Consume messages
podman exec -it redpanda rpk topic consume demo-response --group demo-group
```

### Option 3: Using kafkajs

```javascript
// test-producer.mjs
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'test-producer',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer();
await producer.connect();

await producer.send({
  topic: 'demo-input',
  messages: [{
    key: 'test-key',
    value: JSON.stringify({
      task: 'What is 1+1?',
      correlationId: 'test-001',
    }),
  }],
});

await producer.disconnect();
```

---

## 5. Demo Scenarios

### Scenario A: Success Flow

**Input message:**

```json
{
  "task": "What is 2+2?",
  "correlationId": "succ-001"
}
```

**Expected behavior:**
1. Parse JSON ✓
2. Match rule `$.task` ✓
3. Build prompt ✓
4. Call agent ✓
5. Send response to responseTopic ✓

**Output in responseTopic:**

```json
{
  "correlationId": "succ-001",
  "response": "4",
  "status": "success",
  "executionTimeMs": 2456
}
```

---

### Scenario B: JSON Parse Error

**Input message:**

```
this is not json
```

**Expected behavior:**
1. Parse fails
2. Send to DLQ

**Output in DLQ:**

```json
{
  "originalValue": "this is not json",
  "failedMessage": "this is not json",
  "errorMessage": "JSON parse error",
  "topic": "demo-input",
  "failedAt": "2026-05-19T12:00:00.000Z"
}
```

---

### Scenario C: No Matching Rule

**Input message:**

```json
{
  "other": "data",
  "correlationId": "nomatch-001"
}
```

**Config rule:**

```json
{
  "jsonPath": "$.task"
}
```

**Expected behavior:**
1. Parse JSON ✓
2. No rule matches ($.task returns empty array)
3. Skip message, commit offset
4. No output (message filtered)

---

### Scenario D: Agent Timeout

**Input message:**

```json
{
  "task": "Slow task",
  "correlationId": "timeout-001"
}
```

**Expected behavior:**
1. Call agent
2. Timeout after timeoutMs
3. AbortController.cancel()
4. Send to DLQ

**Output in DLQ:**

```json
{
  "originalValue": "{\"task\": \"Slow task\", \"correlationId\": \"timeout-001\"}",
  "errorMessage": "Agent timeout after 5000ms",
  "topic": "demo-input",
  "failedAt": "2026-05-19T12:00:05.000Z"
}
```

---

### Scenario E: Nested Fields

**Input message:**

```json
{
  "request": {
    "query": "What is the capital of France?",
    "language": "en"
  },
  "correlationId": "nested-001"
}
```

**Config rule:**

```json
{
  "jsonPath": "$.request.query",
  "promptTemplate": "In ${$.request.language}: ${$.request.query}"
}
```

**Expected behavior:**
1. JSONPath: `$.request.query`
2. Prompt: "In en: What is the capital of France?"

---

### Scenario F: Fire-and-Forget (No responseTopic)

**Config:**

```json
{
  "jsonPath": "$.notification",
  "promptTemplate": "Send: ${$.notification}",
  "agentId": "notification-agent"
}
```

**Input message:**

```json
{
  "notification": "Hello World",
  "correlationId": "fire-001"
}
```

**Expected behavior:**
1. Process message
2. Call agent
3. **NO** response sent (responseTopic not specified)
4. Commit offset

---

## Verification Checklist

After running demos, verify:

- [ ] Kafka running (`docker-compose ps`)
- [ ] Topics exist (`rpk topic list`)
- [ ] Messages in input topic
- [ ] Consumer logs show processing
- [ ] Response in response topic (or DLQ if error)

## Demo Scripts Available

| Script | Description |
|--------|-------------|
| `scripts/demo-simple.mjs` | Basic produce/consume demo |
| `scripts/demo-full.mjs` | Full E2E with mock processing |
| `scripts/demo-ssl.mjs` | SSL/TLS demo |
| `scripts/manual-test.mjs` | Manual integration test |

## Common Issues

### Issue: "Broker not reachable"

**Cause:** Kafka not running.

**Fix:**

```bash
docker-compose -f docker-compose.kafka.yml up -d
docker-compose -f docker-compose.kafka.yml logs -f
```

### Issue: "Topic does not exist"

**Cause:** Topics not created.

**Fix:**

```bash
podman exec redpanda rpk topic create demo-input demo-response demo-input-dlq
```

### Issue: "No messages in response topic"

**Cause:** 
- Consumer hasn't processed yet (wait 5s)
- Mock agent not returning response
- responseTopic not specified in config

**Fix:** Check consumer logs, verify config has responseTopic.