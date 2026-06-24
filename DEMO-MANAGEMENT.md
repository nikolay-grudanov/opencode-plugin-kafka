# Demo Guide for Management — opencode-plugin-kafka

## Purpose

This document provides a step-by-step demonstration guide for presenting **opencode-plugin-kafka** to stakeholders and management. It focuses on business value, key features, and expected outcomes.

---

## Executive Summary

**What is this plugin?**

The opencode-plugin-kafka is a Kafka consumer plugin that integrates with OpenCode. It consumes prompts from Kafka topics, routes them to OpenCode agents, and produces responses back to Kafka.

**Business Value:**

- **Automation**: Automatically process incoming requests without manual intervention
- **Scalability**: Handle high-volume message streams
- **Reliability**: Dead Letter Queue ensures no messages are lost
- **Monitoring**: Kafka UI provides real-time visibility

---

## Pre-Demo Checklist

- [ ] Docker/Kafka running (`docker-compose -f docker.compose.kafka.yml up -d`)
- [ ] Kafka UI accessible at http://localhost:8090
- [ ] Plugin built (`npm install && npm run build`)
- [ ] Terminal ready with demo script

---

## Demo Presentation Steps

### Opening (2 minutes)

**Say:**
> "Today I'll demonstrate our Kafka integration plugin. It listens to Kafka topics, processes messages through OpenCode agents, and returns results — fully automated."

**Show:**
- Kafka UI at http://localhost:8090
- Empty topics (ready to receive)

---

### Step 1: Architecture Overview (3 minutes)

**Diagram:**

```
┌─────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  PROMPTS   │───▶│ PLUGIN (THIS)   │───▶│ RESPONSES BACK  │
│  (INPUT)  │    │                 │    │    (OUTPUT)    │
└─────────────┘    └─────────────────┘    └──────────────────┘
                        ↓
                   ┌─────────────┐
                   │   AGENT    │
                   │ (OpenCode) │
                   └─────────────┘
                        ↕
                   ERRORS → DLQ
```

**Key Points:**
- "Messages enter via Kafka — industry-standard interface"
- "Plugin routes to the right agent based on rules"
- "Responses come back to Kafka — integrable with anything"

---

### Step 2: Live Demo (5 minutes)

**Run:**

```bash
cd /home/gna/workspase/projects/opencode-plugin-kafka
node scripts/demo-e2e-flow.mjs
```

**While demo runs, explain each step:**

1. **Message Sent** — "Here's a request coming in"
2. **JSONPath Match** — "The plugin finds the correct rule"
3. **Prompt Building** — "Templates fill in the blanks"
4. **Agent Call** — "Sent to OpenCode — this is the brain"
5. **Response** — "Results go back to Kafka"

---

### Step 3: Kafka UI Inspection (2 minutes)

During demo, switch to Kafka UI:

1. Go to http://localhost:8090
2. Navigate to **Topics** → **opencode.prompts** → **Messages**
3. Show the input message
4. Navigate to **opencode.responses**
5. Show the response

**Say:**
> "Everything is visible in real-time. Operators can monitor progress without digging through logs."

---

### Step 4: Error Handling Demo (3 minutes)

**Explain:**
> "What happens when something fails?"

| Error Scenario | Behavior |
|--------------|---------|
| Invalid JSON | Sent to DLQ |
| Agent timeout | Sent to DLQ after timeout |
| No matching rule | Message skipped |

**Show via Kafka UI:**
1. Navigate to **opencode.dlq**
2. Explain: "Failed messages land here — no data loss"

---

## Key Takeaways for Management

### Business Benefits

| Feature | Benefit |
|---------|--------|
| **Automated Processing** | No manual review needed |
| **Scalable** | Handles burst loads |
| **Reliable** | Zero message loss (DLQ) |
| **Monitorable** | Real-time Kafka UI |
| **Configurable** | JSONPath rules without code changes |

### Risk Mitigation

1. **Failures go to DLQ** — Nothing lost
2. **Timeout protection** — 2-minute max per message
3. **Graceful shutdown** — Clean stop on signals
4. **Sequential processing** — No race conditions

### Integration Points

| System | How it Connects |
|--------|-----------------|
| Existing services | Produce to Kafka topic |
| Frontend apps | Subscribe to response topic |
| Monitoring | Kafka UI or metrics |
| Alerting | Configure DLQ consumer alerts |

---

## Expected Demo Output

Running the demo script produces:

```
==================================================
      OPENCODE PLUGIN KAFKA — E2E DEMO
==================================================

Input topic:  opencode.prompts
Output topic: opencode.responses
DLQ topic:    opencode.dlq

[Step 1] Create Kafka client
  ✅ Kafka client created

[Step 2] Connect producer
  ✅ Producer connected

[Step 3] Produce test message
  ✅ Message sent to opencode.prompts

[Step 4] Wait for consumer
  ✅ Consumer processing...

Processing flow demonstrated:
  1. ✅ Produce to input topic
  2. ✅ Consume from input topic
  3. ✅ Parse JSON payload
  4. ✅ Match JSONPath rule
  5. ✅ Build prompt template
  6. ✅ Call OpenCode agent
  7. ✅ Produce to output topic

✅ E2E Demo completed successfully!
```

---

## Follow-Up Questions

Be prepared for:

| Question | Suggested Answer |
|----------|----------------|
| "What's the latency?" | "~2-5 seconds for simple tasks" |
| "Scale limits?" | "Kafka handles millions; plugin scales horizontally" |
| "What about failures?" | "Dead Letter Queue — no data loss" |
| "Security?" | "SSL/TLS supported, SASL auth available" |
| "Monitoring?" | "Kafka UI + metrics export" |

---

## Post-Demo Actions

1. Share repository link
2. Provide configuration example
3. Offer follow-up POC for specific use case

---

## Contact

For questions about the plugin:
- Repository: `/home/gna/workspase/projects/opencode-plugin-kafka`
- Documentation: README.md, DEMO.md, ARCHITECTURE.md
- Demo script: `scripts/demo-e2e-flow.mjs`