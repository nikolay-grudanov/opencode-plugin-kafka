# Contract: ResponseMessage

**Feature**: 006-opencode-sdk-integration
**File**: `src/kafka/response-producer.ts`
**Type**: Data Transfer Object

## Описание

Формат сообщения, отправляемого в `responseTopic` после успешного вызова OpenCode агента.

## Schema

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| `messageKey` | `string` | Да | Key исходного Kafka сообщения (для корреляции) |
| `sessionId` | `string` | Да | ID OpenCode сессии |
| `ruleName` | `string` | Да | Имя сработавшего правила |
| `agentId` | `string` | Да | ID вызванного агента |
| `response` | `string` | Да | Текст ответа агента |
| `status` | `'success'` | Да | Всегда 'success' (errors → DLQ) |
| `executionTimeMs` | `number` | Да | Время выполнения в миллисекундах |
| `timestamp` | `string` | Да | ISO 8601 timestamp |

## Kafka Metadata

- **Topic**: определяется полем `rule.responseTopic`
- **Key**: `sessionId` (для partition affinity)
- **allowAutoTopicCreation**: `false`

## Invariants

1. Отправляется ТОЛЬКО при `status === 'success'`
2. Errors и timeouts → DLQ (НЕ responseTopic)
3. При ошибке отправки: логировать, не бросать, commit offset
4. `messageKey` = `payload.message.key?.toString('utf-8') ?? ""`

## Example

```json
{
  "messageKey": "100-jfu2-SSI017U",
  "sessionId": "sess_abc123",
  "ruleName": "ibs-plan-rule",
  "agentId": "code-executor",
  "response": "Приложение для интернет магазина будет разработано...",
  "status": "success",
  "executionTimeMs": 45678,
  "timestamp": "2026-04-23T14:30:00.000Z"
}
```