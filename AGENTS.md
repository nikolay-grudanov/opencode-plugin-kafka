# AGENTS.md — Developer Documentation

## Overview

This document provides comprehensive developer setup, architecture, testing, and deployment documentation for **opencode-plugin-kafka**.

## Table of Contents

1. [Developer Setup](#1-developer-setup)
2. [Architecture](#2-architecture)
3. [Testing](#3-testing)
4. [Deployment](#4-deployment)
5. [Troubleshooting](#5-troubleshooting)
6. [SSL Configuration](#6-ssl-configuration)

---

## 1. Developer Setup

### Prerequisites

- **Node.js** 20+ (check with `node --version`)
- **Docker** or **Podman** (for integration tests and demos)
- **npm** (package manager — NOT yarn/pnpm)

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd /home/gna/workspase/projects/opencode-plugin-kafka

# Install dependencies
npm install

# Build the project
npm run build

# Verify with tests
npm run test
```

### Required Environment Variables

Create a `.env` file or export:

```bash
# Required
export KAFKA_BROKERS="localhost:9092"
export KAFKA_CLIENT_ID="your-client-id"
export KAFKA_GROUP_ID="your-consumer-group"

# Optional
export KAFKA_DLQ_TOPIC="your-dlq-topic"
export KAFKA_SSL="false"
export KAFKA_ROUTER_CONFIG=".opencode/kafka-router.json"
```

### Running Locally

#### Option 1: Docker Compose (Recommended)

```bash
# Start Kafka + Kafka UI
docker-compose -f docker-compose.kafka.yml up -d

# Verify Kafka is ready
docker-compose -f docker-compose.kafka.yml logs kafka

# Open Kafka UI at http://localhost:8090
```

#### Option 2: Manual Redpanda

```bash
# Start Redpanda
podman run -d --name redpanda -p 9092:9092 \
  docker.redpanda.com/redpandadata/redpanda:latest

# Create topics
podman exec redpanda rpk topic create my-input my-response my-input-dlq
```

### Available npm Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run check` | Lint + test (without typecheck and build) |
| `npm run lint` | ESLint src/**/*.ts tests/**/*.ts |
| `npm run typecheck` | tsc --noEmit |
| `npm run test` | vitest run (unit tests only) |
| `npm run test:coverage` | vitest --coverage |
| `npm run test:integration` | vitest --config vitest.integration.config.ts |
| `npm run test:e2e` | vitest --config vitest.e2e.config.ts |
| `npm run format` | prettier --write "src/**/*.ts" |
| `npm run demo` | Run demo script |
| `npm run demo:ssl` | Run SSL demo script |

---

## 2. Architecture

### Core Components

```
src/
├── index.ts                    # Plugin entry point (exports default plugin function)
├── core/
│   ├── config.ts               # parseConfig, parseConfigV003, validateTopicCoverage
│   ├── routing.ts              # matchRuleV003 — pure function (Domain Isolation)
│   ├── prompt.ts               # buildPromptV003
│   └── index.ts                # Public API re-exports
├── schemas/
│   └── index.ts                # Zod schemas + types via z.infer<>
├── kafka/
│   ├── client.ts               # createKafkaClient, createConsumer, createDlqProducer, createResponseProducer
│   ├── consumer.ts             # eachMessageHandler, startConsumer, performGracefulShutdown
│   ├── dlq.ts                  # sendToDlq, DlqEnvelope
│   └── response-producer.ts    # sendResponse, ResponseMessage
├── opencode/
│   ├── IOpenCodeAgent.ts       # Interface: AgentResult, InvokeOptions
│   ├── OpenCodeAgentAdapter.ts # Production adapter
│   ├── MockOpenCodeAgent.ts    # Test mock
│   └── AgentError.ts           # TimeoutError, AgentError
└── types/
    ├── opencode-plugin.d.ts    # PluginContext, PluginHooks declarations
    └── opencode-sdk.d.ts       # SDKClient, SessionsAPI declarations
```

### Data Flow

```
1. Kafka Topic Message
          ↓
2. Parse JSON from message.value
          ↓
3. matchRuleV003(payload, rules)
   - Apply jsonPath expression to payload
   - Return first matching rule or null
          ↓
4. buildPromptV003(rule, payload)
   - Replace ${$.path} placeholders
   - Return final prompt string
          ↓
5. agent.invoke(options)
   - Call OpenCode agent with prompt
   - Apply AbortController timeout
          ↓
   ┌─────────────────────────────────────────────┐
   │ SUCCESS                                    │
   │ → Optional: sendResponse() to responseTopic│
   │ → commit offset                           │
   ├─────────────────────────────────────────────┤
   │ ERROR / TIMEOUT                           │
   │ → sendToDlq() with error                  │
   │ → commit offset                          │
   └─────────────────────────────────────────────┘
```

### Key Design Principles

#### 1. Domain Isolation

The routing logic (`matchRuleV003`) is a pure function:

```typescript
// src/core/routing.ts
function matchRuleV003(payload: Payload, rules: RuleV003[]): RuleV003 | null {
  for (const rule of rules) {
    const result = JSONPath({ path: rule.jsonPath, json: payload });
    if (result.length > 0) {
      return rule;
    }
  }
  return null;
}
```

- No side effects
- Easy to test
- Predictable behavior

#### 2. Resiliency

Every message handler wraps processing in try-catch:

```typescript
// src/kafka/consumer.ts
async function eachMessageHandler(...) {
  try {
    // Process message
  } catch (error) {
    // Send to DLQ instead of crashing
    await sendToDlq(producer, topic, message, rule, error);
  } finally {
    // Always commit offset
    await commitOffsets();
  }
}
```

#### 3. Strict Initialization

Configuration is validated at startup via Zod:

```typescript
// src/core/config.ts
const PluginConfigV003Schema = z.object({
  topics: z.array(z.string()).min(1).max(5),
  rules: z.array(RuleV003Schema).min(1),
}).strict();

export function parseConfigV003(): PluginConfigV003 {
  const config = loadConfigFile();
  return PluginConfigV003Schema.parse(config);
}
```

#### 4. No-State Consumer

The consumer doesn't store session state between messages:

```typescript
// Only metrics are stored
const state = {
  totalMessagesProcessed: 0,
  dlqMessagesCount: 0,
  consecutiveErrors: 0,
};
```

### Type Import — CRITICAL RULE

Types are exported from schemas via `z.infer<>`:

```typescript
// ✅ CORRECT
import type { RuleV003 } from '../schemas/index.js';
import type { PluginConfigV003 } from '../schemas/index.js';

// ❌ INCORRECT — file doesn't exist
import type { Rule } from '../core/types';
```

---

## 3. Testing

### Test Structure

```
tests/
├── unit/                    # Pure function tests
│   ├── config.test.ts       # Configuration validation
│   ├── routing.test.ts    # matchRuleV003 logic
│   ├── prompt.test.ts    # buildPromptV003 logic
│   └── types-verification.test.ts
└── integration/           # testcontainers + Redpanda
    └── consumer.test.ts
```

### Running Tests

#### Unit Tests Only

```bash
npm run test
```

With coverage:

```bash
npm run test:coverage
```

#### Integration Tests

⚠️ **Requires Docker/Podman** running:

```bash
# Start Kafka first
docker-compose -f docker-compose.kafka.yml up -d

# Run integration tests
npm run test:integration
```

#### End-to-End Tests

```bash
npm run test:e2e
```

### Coverage Thresholds

| Metric | Threshold |
|--------|-----------|
| Lines | 90% |
| Branches | 90% |
| Functions | 90% |
| Statements | 90% |

Files excluded from coverage:
- `src/core/types.ts` (if exists)
- `src/core/index.ts` (re-exports only)
- `**/*.d.ts` files
- Tests, configs, dist

### Writing Tests

#### Pure Function Tests

```typescript
// tests/unit/routing.test.ts
import { describe, it, expect } from 'vitest';
import { matchRuleV003 } from '../../src/core/routing.js';
import type { RuleV003 } from '../../src/schemas/index.js';

describe('matchRuleV003', () => {
  it('should match rule when jsonPath returns non-empty array', () => {
    const payload = { task: 'hello' };
    const rules: RuleV003[] = [
      {
        name: 'test-rule',
        jsonPath: '$.task',
        promptTemplate: '${$.task}',
        agentId: 'test-agent',
        timeoutMs: 120000,
        concurrency: 1,
      },
    ];
    
    const result = matchRuleV003(payload, rules);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('test-rule');
  });
  
  it('should return null when no rule matches', () => {
    const payload = { other: 'data' };
    const rules: RuleV003[] = [
      {
        name: 'test-rule',
        jsonPath: '$.task',
        promptTemplate: '${$.task}',
        agentId: 'test-agent',
        timeoutMs: 120000,
        concurrency: 1,
      },
    ];
    
    const result = matchRuleV003(payload, rules);
    expect(result).toBeNull();
  });
});
```

#### Integration Tests with Redpanda

```typescript
// tests/integration/consumer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kafka } from 'kafkajs';
import { RedpandaContainer } from '@testcontainers/redpanda';
import { startConsumer } from '../../src/kafka/consumer.js';
import { MockOpenCodeAgent } from '../../src/opencode/MockOpenCodeAgent.js';

describe('Consumer Integration', () => {
  let redpanda: RedpandaContainer;
  
  beforeAll(async () => {
    redpanda = await new RedpandaContainer().start();
  });
  
  afterAll(async () => {
    await redpanda.stop();
  });
  
  it('should process messages from Kafka', async () => {
    const kafka = new Kafka({
      clientId: 'test',
      brokers: [redpanda.getBootstrapServer()],
    });
    
    // Send test message
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'test-input',
      messages: [{ value: JSON.stringify({ task: 'test' }) }],
    });
    
    // Process with consumer
    const agent = new MockOpenCodeAgent();
    // ... run consumer and verify
  });
});
```

---

## 4. Deployment

### Docker Deployment

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY .opencode/ ./.opencode/

ENV KAFKA_BROKERS=kafka:9092
ENV KAFKA_CLIENT_ID=production-client
ENV KAFKA_GROUP_ID=production-group

CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  kafka-router:
    build: .
    environment:
      - KAFKA_BROKERS=${KAFKA_BROKERS}
      - KAFKA_CLIENT_ID=kafka-router
      - KAFKA_GROUP_ID=kafka-router-group
      - KAFKA_ROUTER_CONFIG=/app/config/kafka-router.json
    volumes:
      - ./kafka-router.json:/app/config/kafka-router.json:ro
    depends_on:
      - kafka

  kafka:
    image: apache/kafka:3.7.0
    ports:
      - "9092:9092"
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-router
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kafka-router
  template:
    metadata:
      labels:
        app: kafka-router
    spec:
      containers:
        - name: kafka-router
          image: kafka-router:latest
          env:
            - name: KAFKA_BROKERS
              value: "kafka:9092"
            - name: KAFKA_CLIENT_ID
              value: "kafka-router"
            - name: KAFKA_GROUP_ID
              value: "kafka-router-group"
          volumeMounts:
            - name: config
              mountPath: /app/config
      volumes:
        - name: config
          configMap:
            name: kafka-router-config
```

### Environment-Specific Configuration

#### Development

```bash
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=dev-client
KAFKA_GROUP_ID=dev-group
KAFKA_SSL=false
```

#### Staging

```bash
KAFKA_BROKERS=kafka-staging:9092
KAFKA_CLIENT_ID=staging-client
KAFKA_GROUP_ID=staging-group
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-512
```

#### Production

```bash
KAFKA_BROKERS=kafka-prod-1:9092,kafka-prod-2:9092,kafka-prod-3:9092
KAFKA_CLIENT_ID=prod-client
KAFKA_GROUP_ID=prod-group
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-512
KAFKA_SASL_USERNAME=${KAFKA_USERNAME}
KAFKA_SASL_PASSWORD=${KAFKA_PASSWORD}
```

---

## 5. Troubleshooting

### Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid configuration: empty topics array` | No topics in config | Add at least one topic to `topics` array |
| `Invalid rules array` | Empty rules array | Add at least one rule to `rules` array |
| `Agent not found: {agentId}` | Agent not defined in OpenCode | Define agent in `.opencode/opencode.json` |
| `FR-017 violation: responseTopic matches input topic` | responseTopic in topics list | Change responseTopic to different name |
| `Invalid JSON in message` | Non-JSON message value | Ensure producer sends valid JSON |
| `Agent timeout` | LLM took too long | Increase `timeoutMs` in rule |
| `Consumer not connected` | Kafka broker unreachable | Check KAFKA_BROKERS setting |
| `SSL connection failed` | SSL not configured correctly | Set KAFKA_SSL=true and configure certs |

### Debugging Steps

1. **Check Kafka is running**:
   ```bash
   docker-compose -f docker-compose.kafka.yml ps
   docker-compose -f docker-compose.kafka.yml logs kafka
   ```

2. **Verify configuration**:
   ```bash
   cat .opencode/kafka-router.json
   ```

3. **Check environment variables**:
   ```bash
   env | grep KAFKA
   ```

4. **Run with verbose logging**:
   ```bash
   DEBUG=* node dist/index.js
   ```

5. **Test Kafka connectivity**:
   ```bash
   # Using kafkacat or rpk
   podman exec redpanda rpk cluster info
   ```

### Logs and Monitoring

Consumer logs structured JSON to stdout:
- `kafka_consumer_started` — consumer started
- `consumer_connected` — connected to Kafka
- `message_received` — message received
- `rule_matched` — rule matched
- `prompt_built` — prompt constructed
- `agent_invoking` — calling agent
- `agent_invoke_success` — agent succeeded
- `agent_invoke_failed` — agent failed
- `response_sent` — response sent
- `dlq_sent` — message sent to DLQ
- `message_processed` — message processed

---

## 6. SSL Configuration

### SSL/TLS Setup

#### Generate SSL Certificates

```bash
# Create directory for certificates
mkdir -p kafka-ssl

# Generate CA key
openssl genrsa -despass pass:123456 -out kafka-ssl/ca.key 2048

# Generate CA certificate
openssl req -new -x509 -days 365 -key kafka-ssl/ca.key \
  -passin pass:123456 -out kafka-ssl/ca.crt \
  -subj "/CN=Kafka-CA"

# Generate broker key
openssl req -new -newkey rsa:2048 -nodes \
  -keyout kafka-ssl/broker.key \
  -out kafka-ssl/broker.csr \
  -subj "/CN=kafka"

# Sign broker certificate
openssl x509 -req -days 365 \
  -in kafka-ssl/broker.csr \
  -CA kafka-ssl/ca.crt \
  -CAkey kafka-ssl/ca.key \
  -passin pass:123456 \
  -out kafka-ssl/broker.crt
```

#### Configure Kafka with SSL

In `docker-compose.kafka.yml`:

```yaml
services:
  kafka:
    environment:
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT_INTERNAL:SSL,PLAINTEXT_EXTERNAL:SSL
      KAFKA_SSL_KEYSTORE_LOCATION: /var/lib/kafka/keystore.jks
      KAFKA_SSL_KEYSTORE_PASSWORD: password
      KAFKA_SSL_KEY_PASSWORD: password
      KAFKA_SSL_TRUSTSTORE_LOCATION: /var/lib/kafka/truststore.jks
      KAFKA_SSL_TRUSTSTORE_PASSWORD: password
```

#### Configure Plugin with SSL

Set environment variables:

```bash
export KAFKA_SSL="true"
export KAFKA_BROKERS="localhost:9093"
# For client certificate authentication
export KAFKA_SSL_KEYSTORE_PATH="/path/to/keystore.jks"
export KAFKA_SSL_KEYSTORE_PASSWORD="password"
export KAFKA_SSL_TRUSTSTORE_PATH="/path/to/truststore.jks"
export KAFKA_SSL_TRUSTSTORE_PASSWORD="password"
```

### SASL Authentication

#### SASL/PLAIN

```bash
export KAFKA_SASL_MECHANISM="plain"
export KAFKA_SASL_USERNAME="admin"
export KAFKA_SASL_PASSWORD="secret"
```

#### SASL/SCRAM-SHA-512

```bash
export KAFKA_SASL_MECHANISM="scram-sha-512"
export KAFKA_SASL_USERNAME="admin"
export KAFKA_SASL_PASSWORD="secret"
```

---

## Tech Stack

- **TypeScript 6.x** (ES2022 target, ESNext modules, `moduleResolution: bundler`)
- **kafkajs** — Kafka client
- **zod** — runtime config validation
- **jsonpath-plus** — JSONPath queries (routing.ts, prompt.ts)
- **vitest** — unit + integration testing
- **testcontainers-node + Redpanda** — integration tests (NOT Apache Kafka)
- **npm** — package manager
- **Node.js 20** in CI

## CI Pipeline

GitHub Actions:
- `ci` job: lint → typecheck → test → build
- `integration` job: Redpanda via testcontainers
- Runs on ubuntu-latest, Node.js 20

## Contributing

1. Create a feature branch
2. Write tests first (Test-First Development)
3. Implement with 90%+ coverage target
4. Run `npm run check` before commit
5. Submit PR

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for version history.