# OpenCode Kafka Plugin — Production Documentation

## Overview

**opencode-plugin-kafka** is a Kafka consumer plugin for OpenCode that consumes messages from Kafka topics, processes them via OpenCode agents, and produces responses back to designated topics.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     KAFKA CLUSTER                               │
│  ┌─────────────────┐    ┌─────────────────┐                   │
│  │ opencode.prompts │    │opencode.responses│                  │
│  │    (INPUT)    │───▶│    (OUTPUT)    │                  │
│  └─────────────────┘    └─────────────────┘                   │
│                              ↑                                 │
│  ┌─────────────────┐           │                                 │
│  │  opencode.dlq  │◀─────────┘                                 │
│  │    (ERRORS)   │                                            │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│              OPENCODE PLUGIN                            │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │  CONSUMER  │───▶│    AGENT   │                  │
│  │ (kafkajs) │    │  (SDK)    │                  │
│  └──────────────┘    └──────────────┘                  │
│         │                                               │
│         ↓                                               │
│  ┌──────────────────────────────────┐                   │
│  │     10-STEP MESSAGE HANDLER       │                   │
│  │ 1. Parse JSON from message       │                   │
│  │ 2. Match rule via JSONPath      │                   │
│  │ 3. Build prompt template      │                   │
│  │ 4. Call OpenCode agent       │                   │
│  │ 5. Extract response text   │                   │
│  │ 6. Send to response topic  │                   │
│  │ 7. OR: Send to DLQ      │                   │
│  │ 8. Commit offset        │                   │
│  │ 9. Handle errors      │                   │
│  │ 10. Graceful shutdown│                   │
│  └──────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────┐
│              OPENCODE AGENT                         │
│         Processes prompts, returns responses          │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Docker** or **Podman**
- **Node.js** 20+

### Step 1: Start Kafka

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
docker-compose -f docker-compose.kafka.yml up -d
```

Verify Kafka is ready (check UI at http://localhost:8090):

```bash
# Wait for Kafka to be healthy
docker-compose -f docker-compose.kafka.yml ps
```

### Step 2: Build Plugin

```bash
npm install
npm run build
```

### Step 3: Run Demo

```bash
npm run demo
```

This demo will:
1. Connect producer to Kafka
2. Send a test message to `opencode.prompts`
3. The consumer (plugin) picks up the message
4. Matches the JSONPath rule
5. Builds the final prompt
6. Invokes the OpenCode agent (via SDK)
7. Produces response to `opencode.responses`

---

## Demo Scenario Walkthrough

### Scenario: Complete E2E Flow

**Input Message:**

```json
{
  "task_id": "demo-001",
  "type": "code_review",
  "payload": {
    "repo": "my-app",
    "files": ["src/index.ts", "src/utils.ts"]
  }
}
```

**Execution Flow:**

```
[Step 1] Message received from opencode.prompts
  ↓
[Step 2] Parse JSON: { task_id, type, payload }
  ↓
[Step 3] JSONPath matching:
  - Rule: jsonPath="$" 
  - Result: non-empty (entire payload matches)
  - Match: "default-prompt-rule"
  ↓
[Step 4] Build prompt:
  - Template: "Выполни задачу: ${$.task || $.prompt}"
  - Result: "Выполни задачу: code_review"
  ↓
[Step 5] Call OpenCode agent:
  - agentId: "e2e-responder"
  - Timeout: 120s
  ↓
[Step 6] Response received
  ↓
[Step 7] Send to opencode.responses:
{
  "sessionId": "session-uuid",
  "ruleName": "default-prompt-rule",
  "agentId": "e2e-responder",
  "response": "Agent response text",
  "status": "success",
  "executionTimeMs": 2456,
  "timestamp": "2026-05-19T12:00:00.000Z"
}
```

---

## SSL Configuration

### SSL Ports

The plugin supports two connection modes:

| Port | Protocol | Description |
|------|----------|-------------|
| 9092 | PLAINTEXT_INTERNAL | Internal plaintext (within docker network) |
| 9093 | PLAINTEXT_EXTERNAL | External plaintext (localhost) |
| 9095 | SSL_EXTERNAL | External SSL/TLS (localhost) |

### Quick SSL Setup (Development)

The kafka-ssl directory already contains pre-generated certificates:

```bash
# List available certificates
ls -la kafka-ssl/
```

Certificates:
- `ca.pem` — Certificate Authority
- `client.pem`, `client-key.pem` — Client certificate and key
- `server.pem`, `server-key.pem` — Server certificate and key
- `kafka.keystore.jks` — Java KeyStore for Kafka broker
- `kafka.truststore.jks` — Java TrustStore for Kafka broker

### Start Kafka with SSL

```bash
# Start Kafka with SSL listener
docker compose -f docker-compose.kafka.yml up -d

# Verify SSL port is exposed
docker compose -f docker-compose.kafka.yml ps
# Should show: 0.0.0.0:9095->9095/tcp for SSL
```

### SSL with PEM Certificates

Configure the plugin to use PEM certificates:

```bash
# Using PEM certificates
export KAFKA_BROKERS="localhost:9095"
export KAFKA_CLIENT_ID="my-ssl-client"
export KAFKA_GROUP_ID="my-consumer-group"
export KAFKA_SSL="true"
export KAFKA_SSL_CA="./kafka-ssl/ca.pem"
export KAFKA_SSL_CERT="./kafka-ssl/client.pem"
export KAFKA_SSL_KEY="./kafka-ssl/client-key.pem"
```

### Simple SSL (System TrustStore)

For simpler setups without custom certificates:

```bash
# Just enable SSL (uses system truststore)
export KAFKA_BROKERS="localhost:9095"
export KAFKA_CLIENT_ID="my-ssl-client"
export KAFKA_GROUP_ID="my-consumer-group"
export KAFKA_SSL="true"
```

### SSL Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `KAFKA_SSL` | Enable SSL (`true`/`false`) | No (default: false) |
| `KAFKA_SSL_CA` | Path to CA certificate (PEM) | For PEM auth |
| `KAFKA_SSL_CERT` | Path to client certificate (PEM) | For PEM auth |
| `KAFKA_SSL_KEY` | Path to client private key (PEM) | For PEM auth |
| `KAFKA_SASL_MECHANISM` | SASL mechanism (PLAIN, SCRAM-SHA-256, etc.) | No |
| `KAFKA_USERNAME` | SASL username | No |
| `KAFKA_PASSWORD` | SASL password | No |

### Run SSL Demo

```bash
# Build the project first
npm run build

# Run the SSL demo script
node scripts/demo-ssl.mjs

# Or with explicit SSL flags
npm run demo:ssl
```

Expected output when Kafka is running with SSL:
```
[...] Mode: SSL (TLS)
[...] Brokers: localhost:9095
[...] ✓ Kafka client created
[...] Connecting to Kafka...
[...] ✓ Consumer connected - SSL handshake successful!
```

### Troubleshooting SSL

**Connection Refused:**
```bash
# Check Kafka is running
docker compose -f docker-compose.kafka.yml ps

# Check SSL port is listening
ss -tlnp | grep 9095
```

**Certificate Errors:**
```bash
# Verify certificates exist
ls -la kafka-ssl/ca.pem kafka-ssl/client.pem kafka-ssl/client-key.pem

# Regenerate if needed
cd kafka-ssl && ./generate-certs.sh
```

**Plaintext Fallback:**
```bash
# If SSL fails, use plaintext
export KAFKA_BROKERS="localhost:9093"
export KAFKA_SSL="false"
```

---

## Kafka UI Access

**URL:** http://localhost:8090

### Viewing Messages

1. Open Kafka UI at http://localhost:8090
2. Select cluster "local"
3. Navigate to **Topics**
4. Click on a topic (e.g., `opencode.prompts`)
5. View messages under **Messages** tab

### Monitoring Topics

| Topic | Description | Direction |
|-------|------------|----------|
| `opencode.prompts` | Input messages | IN |
| `opencode.responses` | Successful agent responses | OUT |
| `opencode.dlq` | Failed/error messages | ERROR |

---

## Configuration Reference

### kafka-router.json Schema

```json
{
  "version": "003",
  "topics": ["opencode.prompts"],
  "dlqTopic": "opencode.dlq",
  "rules": [
    {
      "name": "rule-name",
      "jsonPath": "$.field.path",
      "promptTemplate": "Do: ${$.field}",
      "agentId": "agent-id",
      "responseTopic": "output-topic",
      "timeoutMs": 120000,
      "concurrency": 1
    }
  ]
}
```

### Rule Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `name` | string | Yes | — | Unique rule name |
| `jsonPath` | string | Yes | — | JSONPath expression to match |
| `promptTemplate` | string | Yes | — | Prompt with `${$.path}` placeholders |
| `agentId` | string | Yes | — | OpenCode agent ID |
| `responseTopic` | string | No | — | Topic for responses |
| `timeoutMs` | number | No | 120000 | Timeout in ms |
| `concurrency` | number | No | 1 | Parallel processing |

---

## Troubleshooting

### Common Issues

**Issue: "Broker not reachable"**

```bash
# Check Kafka is running
docker-compose -f docker-compose.kafka.yml ps

# Restart Kafka
docker-compose -f docker-compose.kafka.yml restart kafka
```

**Issue: "Topic does not exist"**

```bash
# Kafka auto-creates topics, or create manually:
podman exec redpanda rpk topic create opencode.prompts
```

**Issue: "No messages in response topic"**

- Wait 5 seconds for processing
- Check consumer logs
- Verify `responseTopic` in config

---

## Files Created

| File | Description |
|------|-------------|
| `/home/gna/workspase/projects/opencode-plugin-kafka/README.md` | Main documentation |
| `/home/gna/workspase/projects/opencode-plugin-kafka/scripts/demo-e2e-flow.mjs` | E2E demo script |
| `/home/gna/workspase/projects/opencode-plugin-kafka/DEMO-MANAGEMENT.md` | Management demo guide |