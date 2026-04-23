# Contract: IOpenCodeAgent

**Feature**: 006-opencode-sdk-integration
**File**: `src/opencode/IOpenCodeAgent.ts`
**Type**: Interface (TypeScript)

## Описание

Mockable interface для вызова OpenCode агентов. Изолирует consumer logic от SDK implementation.

## Interface Definition

### invoke(prompt, agentId, options) → AgentResult

**Параметры:**
| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `prompt` | `string` | Да | Текст промпта для агента |
| `agentId` | `string` | Да | ID OpenCode агента |
| `options` | `InvokeOptions` | Да | Опции вызова |

**InvokeOptions:**
| Поле | Тип | Описание |
|------|-----|----------|
| `timeoutMs` | `number` | Timeout в миллисекундах |

**Возвращает:** `Promise<AgentResult>`

**AgentResult:**
| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `'success' \| 'error' \| 'timeout'` | Статус выполнения |
| `response` | `string?` | Текст ответа (text parts, join \n\n) |
| `sessionId` | `string` | ID сессии |
| `errorMessage` | `string?` | Ошибка (при error/timeout) |
| `executionTimeMs` | `number` | Время выполнения (мс) |
| `timestamp` | `string` | ISO 8601 |

**Behaviour:**
- Создаёт новую сессию через `client.session.create()`
- Отправляет промпт через `client.session.prompt()` с `agent: agentId`
- `Promise.race([prompt, timeout(options.timeoutMs)])` — timeout handled
- При timeout: best-effort `client.session.abort()` (try-catch, ошибки логируются)
- При success: `extractResponseText()` — filter parts где type='text', join \n\n
- Никогда не бросает исключения — все ошибки через AgentResult

### abort(sessionId) → boolean

**Параметры:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `sessionId` | `string` | ID сессии для прерывания |

**Возвращает:** `Promise<boolean>` — `true` если успешно, `false` при ошибке

**Behaviour:**
- Вызывает `client.session.abort({ path: { id: sessionId } })`
- Никогда не бросает исключения
- Возвращает `false` при любой ошибке

## Implementations

| Класс | Файл | Назначение |
|-------|------|------------|
| `OpenCodeAgentAdapter` | `src/opencode/OpenCodeAgentAdapter.ts` | Production: real SDK client |
| `MockOpenCodeAgent` | `src/opencode/MockOpenCodeAgent.ts` | Tests: simulated responses |

## Usage Example

```typescript
const agent: IOpenCodeAgent = new OpenCodeAgentAdapter(ctx.client)

const result = await agent.invoke(
  "Разработать приложение для интернет магазина",
  "code-executor",
  { timeoutMs: 120_000 }
)

if (result.status === 'success') {
  console.log(result.response) // текст ответа агента
} else {
  console.error(result.errorMessage) // ошибка → DLQ
}
```