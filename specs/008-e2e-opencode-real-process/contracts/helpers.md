# Interface Contracts: E2E Test Helpers

**Date**: 2026-04-28 | **Feature**: 008-e2e-opencode-real-process

## opencodeProcess.ts

### `spawnOpenCodeServe(opts?) => Promise<OpenCodeProcessHandle>`

Спавнит `opencode serve --port <port>` и ждёт готовности через polling /health.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| opts.port | `number` | `3001` | HTTP port |
| opts.startupTimeoutMs | `number` | `30000` | Max wait for ready |
| opts.checkIntervalMs | `number` | `500` | Health check interval |

**Returns:** `OpenCodeProcessHandle`

**Errors:**
- `Port ${port} is already in use` — если /health отвечает до spawn
- `opencode serve exited prematurely with code X` — если процесс упал
- `opencode serve did not become ready within Xms` — если health check не прошёл

**Side Effects:**
- Spawns child process
- Pipes stderr to process.stderr with `[opencode-serve]` prefix
- Log PID to stdout for zombie detection: `[opencode-serve] PID: {pid}`

### `OpenCodeProcessHandle`

```typescript
interface OpenCodeProcessHandle {
  readonly baseURL: string;       // e.g., "http://localhost:3001"
  readonly pid: number;            // Child process PID for zombie detection
  kill(): Promise<void>;          // SIGTERM → 5s → SIGKILL
}
```

---

## redpandaContainer.ts

### `startRedpanda() => Promise<StartedRedpandaContainer>`

Запускает реальный Redpanda контейнер через `@testcontainers/redpanda`.

**Returns:** `StartedRedpandaContainer` из `@testcontainers/redpanda`

**Errors:**
- Testcontainers timeout — Docker/Podman не доступен

### `stopRedpanda(container) => Promise<void>`

Останавливает Redpanda контейнер.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| container | `StartedRedpandaContainer` | Запущенный контейнер |

---

## kafkaUtils.ts

### `createTopics(brokers, topics) => Promise<void>`

Создаёт Kafka топики через admin client.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| brokers | `string[]` | Kafka bootstrap servers |
| topics | `string[]` | Список топиков для создания |

### `produceMessage(brokers, topic, message, key?) => Promise<void>`

Отправляет одно сообщение в топик.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| brokers | `string[]` | Kafka bootstrap servers |
| topic | `string` | Целевой топик |
| message | `object | null` | Тело сообщения (JSON.stringify) |
| key | `string?` | Ключ сообщения |

### `consumeOneMessage(brokers, topic, timeoutMs) => Promise<KafkaMessage | null>`

Читает одно новое сообщение из топика с таймаутом.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| brokers | `string[]` | Kafka bootstrap servers |
| topic | `string` | Целевой топик |
| timeoutMs | `number` | Таймаут ожидания |

**Returns:** `KafkaMessage | null` (null если таймаут)

**Behavior:**
- `fromBeginning: false` — только новые сообщения
- Уникальный group ID (auto-generated) — изоляция от предыдущих прогонов
- Disconnects после получения или по таймауту

### `KafkaMessage`

```typescript
interface KafkaMessage {
  value: string | null;
  key: string | null;
}
```

---

## pluginRunner.ts

### `runPlugin(config, agent, env) => Promise<PluginRunnerHandle>`

Запускает consumer в контексте теста.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| config | `PluginConfigV003` | Конфигурация плагина |
| agent | `IOpenCodeAgent` | Агент (OpenCodeAgentAdapter с real SDK) |
| env | `Record<string, string>` | Env vars для Kafka (KAFKA_BROKERS, etc.) |

**Behavior:**
1. Устанавливает `process.env` из `env`
2. Вызывает `startConsumer(config, agent)`
3. Возвращает handle с `stop()` методом

### `PluginRunnerHandle`

```typescript
interface PluginRunnerHandle {
  stop(): Promise<void>;  // Graceful shutdown consumer
}
```

**stop() behavior:**
- Вызывает shutdown механизм consumer
- Ждёт завершения до 10 секунд
- Log PID перед shutdown для отладки zombie-процессов
- Force kill через process.kill(pid, 'SIGKILL') если shutdown не завершён за 10s
- Не бросает ошибки при shutdown failure (log only)

---

## SDK Client Factory (для E2E)

### `createSDKClient(opts) => SDKClient`

Создаёт SDK клиент, подключённый к `opencode serve`.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| opts.baseURL | `string` | HTTP base URL opencode serve |

**Returns:** `SDKClient` (реализует интерфейс из `src/types/opencode-sdk.d.ts`)

**Implementation:**
```typescript
import { Opencode } from '@opencode-ai/sdk';

const sdk = new Opencode({
  baseURL: opts.baseURL,
  timeout: 60000,
});

// Адаптация к SDKClient интерфейсу:
// SDK экспортирует все методы SessionsAPI напрямую
// return { session: sdk } // или direct wrap если нужно
```