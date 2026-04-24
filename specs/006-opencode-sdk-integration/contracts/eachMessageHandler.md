# Contract: eachMessageHandler

**Feature**: 006-opencode-sdk-integration
**File**: `src/kafka/consumer.ts`
**Type**: Function contract

## Описание

Обработчик каждого Kafka сообщения. 10-step pipeline с DLQ fallback.

## Signature

```typescript
async function eachMessageHandler(
  payload: EachMessagePayload,
  config: PluginConfigV003,
  dlqProducer: Producer,
  responseProducer: Producer,
  commitOffsets: () => Promise<void>,
  agent: IOpenCodeAgent,
  state: ConsumerState,
  activeSessions: Set<string>
): Promise<void>
```

## Pipeline (10 steps)

| Step | Условие | Действие | Результат |
|------|---------|----------|-----------|
| 1 | `message.value === null` | Log tombstone | commit + return |
| 2 | `message.value.length > 1_048_576` | DLQ: oversized | commit + return |
| 3 | JSON parse fails | DLQ: parse error | commit + return |
| 4 | `matchRuleV003() === null` | Log no match | commit + return |
| 5 | `buildPromptV003()` | Build prompt | → step 6 |
| 6 | `agent.invoke()` | Add sessionId to activeSessions | → step 7-9 |
| 7 | invoke completes | Remove sessionId from activeSessions | → step 8-9 |
| 8a | `status === 'success'` AND `responseTopic` | sendResponse() | → step 10 |
| 8b | sendResponse fails | Log error (no throw) | → step 10 |
| 9 | `status === 'error' OR 'timeout'` | sendToDlq() | → step 10 |
| 10 | **always** | commitOffsets() | return |

## Invariants

1. **commit offset ALWAYS** — независимо от результата
2. **Never throws** — все ошибки через DLQ
3. **activeSessions tracking** — add before invoke, remove after
4. **No retry** — при любой ошибке сразу DLQ
5. **Sequential** — одно сообщение за раз (backpressure)
6. **No cross-message state** — каждый invoke isolated

## Error Matrix

| Error Type | Destination | Commit Offset |
|-----------|-------------|---------------|
| Tombstone | Skip | Yes |
| Oversized | DLQ | Yes |
| Parse error | DLQ | Yes |
| No match | Skip | Yes |
| Agent timeout | DLQ | Yes |
| Agent error | DLQ | Yes |
| Response send fail | Log only | Yes |
| DLQ send fail | Log only | Yes |