# Data Model: Multi-Turn Session Delivery (spec-010)

## Entities

### 1. ResumeDecision

Result of session resume logic in `OpenCodeAgentAdapter.invoke()`.

```typescript
type ResumeDecision =
  | { kind: 'new' }                                           // spec-009 default path
  | { kind: 'resume-existing'; sessionId: string }            // resume OK
  | { kind: 'resume-fallback-new'; attemptedSessionId: string; reason: string };
                                                            // session.get() failed
```

**Flow**:
1. If `existingSessionId` undefined → `new`
2. If `existingSessionId` defined → call `client.session.get({path: {id}})`
3. If `get()` returns success → `resume-existing`
4. If `get()` returns error/404 → `resume-fallback-new`, log warning

### 2. SessionLookupResult (returned by `verifySessionExists()`)

```typescript
type SessionLookupResult =
  | { ok: true;  sessionId: string }
  | { ok: false; reason: 'not-found' | 'lookup-error' | 'invalid-id'; details?: string };
```

### 3. Extended RuleV003Schema field

```typescript
RuleV003Schema = z.object({
  // ... existing fields from spec-009 ...
  resumeFromPayloadField: z
    .string()
    .nullish()                       // accept null | undefined
    .transform(v => v === null || v === '' ? null : v)
    .default('sessionId'),            // default = look for "sessionId" field
});
```

After Zod transform:
- Field omitted → default `"sessionId"` (resume enabled for standard field)
- `"sessionId"` → use field "sessionId" in payload
- `"$.meta.session"` → use JSONPath `$.meta.session`
- `null` (explicit) → resume disabled
- `""` → resume disabled (transformed to null)

### 4. KafkaPayload (incoming message, augmented)

```typescript
interface KafkaPayload {
  // existing fields — preserved unchanged
  [key: string]: unknown;
  
  // NEW (spec-010): optional sessionId at the top level OR at configured JSONPath
  sessionId?: string;             // when rule.resumeFromPayloadField === "sessionId" (default)
  // or at custom path e.g. $.meta.session when rule.resumeFromPayloadField === "$.meta.session"
}
```

**Backward compat**: payloads without sessionId are unchanged.

### 5. ResponseMessage (outgoing, augmented)

The existing `ResponseMessage` already includes `sessionId` (from spec-009).
For spec-010, the semantics are explicit:

```typescript
interface ResponseMessage {
  // existing fields preserved
  messageKey: string;        // sessionId for new+resumed sessions
  sessionId: string;         // ← existing field, semantics clarified
  ruleName: string;
  agentId: string;
  response: string;
  status: 'success';
  executionTimeMs: number;
  timestamp: string;
  
  // NEW (spec-010): resume metadata
  resumed?: boolean;          // true if sessionId from payload was used
}
```

For DLQ envelopes (also augmented):
```typescript
interface DlqEnvelope {
  // existing fields from spec-009
  // ...
  resumeAttempted?: boolean;  // true if we tried to resume and failed
  attemptedSessionId?: string; // sessionId that was attempted but invalid
}
```

### 6. SessionLifecycleEvent (kafka_message_lifecycle phases)

Extends the existing phases with spec-010 additions:

```typescript
type SessionLifecyclePhase =
  | 'session_created'         // spec-010 NEW: new session
  | 'session_resumed'         // spec-010 NEW: resumed existing session
  | 'session_lookup_failed'   // spec-010 NEW: session.get() errored
  | 'tool_called'
  | 'fallback_text_published'
  | 'dlq_sent'
  | 'idle_no_tool_silent'
  | 'offset_committed';
```

## State machine

```
Kafka message arrives
    ↓
extract payload.sessionId (via rule.resumeFromPayloadField JSONPath)
    ↓
sessionId present and string?
    ├─NO → SessionLifecyclePhase="session_created" → create new
    └─YES ↓
       client.session.get({path: {id: sessionId}})
       ├─OK → SessionLifecyclePhase="session_resumed" → use existing
       └─ERROR → SessionLifecyclePhase="session_lookup_failed" → log + create new
            ↓
       (either path) → session.prompt({path: {id: sessionId_or_newId}, body: {...}})
            ↓
       (in all cases) → LLM streams response (uses session history if resumed)
            ↓
       (either path) → sendResponse with sessionId in envelope
            ↓
       offset_committed
```

## Schema migration

`kafka-router.json` configs:
- v1 (spec-003/006/008): no `resumeFromPayloadField` → defaults to `"sessionId"`, resume enabled
- v2 (spec-010): explicit `resumeFromPayloadField: null` → resume disabled

No breaking changes. Existing payloads without sessionId work unchanged.

## Migration from spec-009

| Aspect | spec-009 | spec-010 |
|---|---|---|
| Kafka payload | `{task: "..."}` | `{task: "...", sessionId: "ses_xxx"?}` |
| session.create() | always | conditional (only when no resume or resume failed) |
| session.prompt() path.id | fresh sessionId | resumeSessionId OR fresh sessionId |
| Response envelope sessionId | fresh | resumeSessionId OR fresh |
| Tool handler ctx.sessionID | new sessionId | resumed sessionId (auto-injected by OpenCode) |
| session-watcher registration | always | always (same Map, same lifecycle) |
| session.idle safety net | works | works (resumed session fires session.idle too) |
| maxSessionMs guard | works | works |

## Failure modes

| Failure | Handling |
|---|---|
| payload.sessionId is not a string (number, object, array) | Log warn, fall back to new session (FR-2) |
| session.get() throws network error | Log warn, fall back to new session (FR-3) |
| session.get() returns 404 (session deleted) | Log warn, fall back to new session (FR-3) |
| Two Kafka messages with same sessionId arrive concurrently | Serialized via rule.concurrency (default 1) — spec-009 behavior |
| Session resume fails partway (e.g., session.prompt throws) | EachMessageHandler try/catch → DLQ envelope with resumeAttempted=true |
| Kafka payload has sessionId but rule has resumeFromPayloadField=null | Ignore field, new session (FR-1) |