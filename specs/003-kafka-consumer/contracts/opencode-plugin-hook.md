# OpenCode Plugin Hook Contract

**Feature**: 003-kafka-consumer | **Type**: Plugin Entry Point

## Hook Signature

```typescript
// Default export from src/index.ts
export default async function start(): Promise<void>;
```

## Contract

Plugin MUST be loaded by OpenCode agent and called via `start()` function.

### Startup Sequence

1. **Environment Validation**
   - Read `KAFKA_ROUTER_CONFIG` env (default: `.opencode/kafka-router.json`)
   - Parse and validate config via `parseConfig()`
   - Read required env vars: `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`
   - Throw descriptive Error if any required var missing

2. **Kafka Client Creation**
   - `createKafkaClient(process.env)` → Kafka instance
   - Configure SSL if `KAFKA_SSL=true`
   - Configure SASL if `KAFKA_USERNAME` + `KAFKA_PASSWORD` set

3. **Consumer Creation**
   - `createConsumer(kafka)` → Consumer instance
   - `sessionTimeout: 300000`, `heartbeatInterval: 30000`

4. **DLQ Producer Creation**
   - `createDlqProducer(kafka)` → Producer instance (separate from main flow)

5. **Start Consumption**
   - `startConsumer(config)` → subscribes to all `config.topics`
   - Registers SIGTERM/SIGINT handlers for graceful shutdown

### Error Handling Contract

- All errors caught and logged
- Failed messages routed to DLQ (if configured)
- Consumer process NEVER crashes
- DLQ send failures are non-fatal (logged, then continue)

### Shutdown Contract

On SIGTERM/SIGINT:
1. Log shutdown sequence start
2. Disconnect consumer
3. Disconnect producer
4. Complete within 10 seconds (force-kill after timeout)

## Exit States

| State | Condition | Behavior |
|-------|-----------|----------|
| STARTED | All initialization successful | Consumer running |
| CONFIG_ERROR | Invalid/missing config | Throw at startup (fail-fast) |
| ENV_ERROR | Missing required env vars | Throw at startup (fail-fast) |
| SHUTDOWN | SIGTERM/SIGINT received | Graceful disconnect |
| FATAL | Unrecoverable Kafka error | Log, attempt graceful shutdown |

## Dependencies

- `kafkajs` - Kafka client
- `zod` - Runtime validation
- `jsonpath-plus` - JSONPath routing
- OpenCode agent (provides `client.sessions.create()`)