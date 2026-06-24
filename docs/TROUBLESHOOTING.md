# Troubleshooting Guide

Common errors and fixes for opencode-plugin-kafka.

---

## Quick Diagnosis

| Symptom | Quick Fix |
|---------|----------|
| Consumer won't start | Check Kafka is running: `docker-compose ps` |
| No messages processed | Check JSONPath in config matches message structure |
| Agent timeout | Increase `timeoutMs` in rule |
| DLQ full | Check error messages, fix source issue |

---

## Error Reference

### E001: "Broker not reachable"

**Full error:**
```
KafkaJSConnectionError: Connection timed out
```

**Cause:** Kafka broker is not running or unreachable.

**Fix:**
```bash
# Check Kafka status
docker-compose -f docker-compose.kafka.yml ps

# Restart Kafka
docker-compose -f docker-compose.kafka.yml restart

# Check logs
docker-compose -f docker-compose.kafka.yml logs kafka
```

---

### E002: "Invalid configuration: empty topics array"

**Full error:**
```
ValidationError: Invalid topics array
```

**Cause:** No topics defined in config.

**Fix:** Add at least one topic to `.opencode/kafka-router.json`:
```json
{
  "topics": ["my-topic"]
}
```

---

### E003: "Invalid rules array"

**Full error:**
```
ValidationError: Invalid rules array
```

**Cause:** Empty rules array in config.

**Fix:** Add at least one rule:
```json
{
  "rules": [{
    "name": "my-rule",
    "jsonPath": "$.task",
    "promptTemplate": "Task: ${$.task}",
    "agentId": "my-agent"
  }]
}
```

---

### E004: "Agent not found: {agentId}"

**Full error:**
```
Error: Agent not found: e2e-responder
```

**Cause:** Agent ID not defined in OpenCode config.

**Fix:** Define agent in `.opencode/opencode.json`:
```json
{
  "agents": {
    "e2e-responder": {
      "description": "My agent",
      "mode": "subagent",
      "model": "lemonade/Qwen3.5-9B",
      "prompt": "Reply briefly."
    }
  }
}
```

---

### E005: "FR-017 violation: responseTopic matches input topic"

**Full error:**
```
FR-017 violation: responseTopic 'my-topic' is in topics list
```

**Cause:** responseTopic cannot be the same as any input topic (prevents infinite loop).

**Fix:** Use a different topic name:
```json
{
  "topics": ["input-topic"],
  "rules": [{
    "name": "my-rule",
    "jsonPath": "$.task",
    "promptTemplate": "${$.task}",
    "agentId": "my-agent",
    "responseTopic": "output-topic"  // Different from input-topic
  }]
}
```

---

### E006: "Unexpected token 'x'... is not valid JSON"

**Full error:**
```
SyntaxError: Unexpected token 't', "... is not valid JSON"
```

**Cause:** Message value is not valid JSON.

**Fix:** Ensure producer sends valid JSON:
```javascript
// ❌ Wrong
await producer.send({
  topic: 'my-topic',
  messages: [{ value: 'not json' }]
});

// ✅ Correct
await producer.send({
  topic: 'my-topic',
  messages: [{ value: JSON.stringify({ task: 'hello' }) }]
});
```

---

### E007: "Agent timeout"

**Full error:**
```
Error: Agent timeout after 30000ms
```

**Cause:** Agent took too long to respond.

**Fix:** Increase timeout in rule:
```json
{
  "timeoutMs": 60000  // Increase from default 120000
}
```

Or check if LLM is running.

---

### E008: "Message value is null (tombstone message)"

**Full error:**
```
Error: Message value is null (tombstone message)
```

**Cause:** Kafka message has null value (tombstone).

**Fix:** Set environment variable to ignore tombstones:
```bash
export KAFKA_IGNORE_TOMBSTONES=true
```

---

### E009: "No messages in response topic"

**Symptom:** Response topic is empty after processing.

**Causes:**
1. responseTopic not specified in config
2. Consumer hasn't processed yet
3. Mock agent not returning response

**Fix:**
1. Add responseTopic to rule:
```json
{
  "responseTopic": "my-response"
}
```
2. Wait 5 seconds after consumer start
3. Check consumer logs

---

### E010: "Rule not matching"

**Symptom:** Messages never match any rule.

**Cause:** JSONPath expression doesn't match message structure.

**Fix:** Check JSONPath:
```json
{
  "jsonPath": "$.task"
}
```

For message: `{ "task": "hello" }` → returns `["hello"]` ✓
For message: `{ "msg": "hello" }` → returns `[]` ✗

---

## Debug Commands

### Check Kafka Status

```bash
# List topics
podman exec redpanda rpk topic list

# View messages in topic
podman exec redpanda rpk topic consume my-topic

# Check consumer group
podman exec redpanda rpk group list
```

### Check Plugin Status

```bash
# Verify config is valid
cat .opencode/kafka-router.json | python3 -m json.tool

# Check environment variables
env | grep KAFKA
```

### Verbose Logging

```bash
# Enable debug logging
export DEBUG=*

# Run plugin directly
node dist/index.js
```

### Network Debugging

```bash
# Test Kafka port
nc -zv localhost 9092

# Check DNS resolution
nslookup localhost
```

---

## Logs Reference

### Consumer Log Events

| Event | Description |
|-------|-------------|
| `kafka_consumer_started` | Consumer started |
| `consumer_connected` | Connected to Kafka |
| `message_received` | Message received from Kafka |
| `rule_matched` | Rule matched (jsonPath returned result) |
| `no_rule_matched` | No rule matched, message skipped |
| `prompt_built` | Prompt constructed |
| `agent_invoking` | Calling agent |
| `agent_invoke_success` | Agent succeeded |
| `agent_invoke_failed` | Agent failed |
| `response_sent` | Response sent to responseTopic |
| `dlq_sent` | Message sent to DLQ |
| `message_processed` | Message processing complete |

### Example Log Output

```json
{"level":"info","event":"message_processed","topic":"my-topic","partition":0,"offset":"42","matchedRule":"my-rule","prompt":"Task: hello","processingTimeMs":1234,"timestamp":"2026-05-19T12:00:00.000Z"}
```

---

## Health Checks

### Is Kafka Running?

```bash
docker-compose -f docker-compose.kafka.yml ps
# Should show: kafka | Up
```

### Is Topic Created?

```bash
podman exec redpanda rpk topic list | grep my-topic
# Should show: my-topic
```

### Is Consumer Connected?

```bash
podman exec redpanda rpk group list
# Should show consumer group
```

### Are Messages In Topic?

```bash
podman exec redpanda rpk topic consume my-topic --limit 1
# Should show message
```

---

## Recovery Procedures

### Full Reset

```bash
# 1. Stop consumer
pkill -f "node dist"

# 2. Stop Kafka
docker-compose -f docker-compose.kafka.yml down

# 3. Delete data
docker volume rm opencode-plugin-kafka_kafka-data

# 4. Restart Kafka
docker-compose -f docker-compose.kafka.yml up -d

# 5. Recreate topics
podman exec redpanda rpk topic create my-input my-response my-input-dlq

# 6. Run consumer
npm run start
```

### Clear DLQ

```bash
# Delete and recreate DLQ topic
podman exec redpanda rpk topic delete my-dlq-topic
podman exec redpanda rpk topic create my-dlq-topic
```

### Reset Consumer Offset

```bash
# Reset to beginning
podman exec redpanda rpk topic consume my-topic --reset-offsets --to-earliest

# Or delete consumer group and restart
podman exec redpanda rpk group delete my-group
```