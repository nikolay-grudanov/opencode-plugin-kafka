# ADR-002: Типы и схемы для интеграции с OpenCode SDK

## Контекст

Необходимо определить типы для:
1. **PluginContext** — структура контекста плагина из OpenCode
2. **PluginHooks** — события, которые может возвращать плагин
3. **OpenCode SDK interfaces** — типы для работы с SDK client
4. **Расширенные схемы RuleV003Schema** — добавление agentId, responseTopic, timeoutSeconds

## Рассмотренные альтернативы

### Вариант 1: Полные типы из OpenCode SDK (реэкспорт)
**Описание**: Реэкспортировать все типы из @opencode/sdk пакетов

**Плюсы**:
- Полная совместимость с OpenCode SDK
- Все типы актуальные

**Минусы**:
- Жёсткая зависимость от @opencode/sdk
- Больший bundle size
- Типы могут меняться между версиями SDK

### Вариант 2: Минимальные типы только для используемых методов (ВЫБРАНО)
**Описание**: Определить только те типы, которые реально использует плагин

**Плюсы**:
- Минимальная зависимость от OpenCode SDK
- Bundle size меньше
- Easy to update при изменениях SDK (меньше типов для обновления)
- Следует "Simplicity First"

**Минусы**:
- Нужно поддерживать синхронизацию типов с OpenCode SDK
- Меньше type safety при работе с SDK

## Принятое решение

Выбран **Вариант 2**: Минимальные типы только для используемых методов.

### Типы PluginContext и PluginHooks

```typescript
/**
 * OpenCode plugin context
 *
 * Контекст, который OpenCode передаёт в плагин при старте.
 * Содержит SDK client и метаданные проекта.
 *
 * @see https://opencode.ai/docs/ru/plugins/
 */
export interface PluginContext {
  /** SDK client для работы с OpenCode */
  client: SDKClient;

  /** Метаданные проекта */
  project: Project;

  /** Рабочая директория плагина */
  directory: string;

  /** Git root директория */
  worktree: string;

  /** Shell API */
  $: BunShell;
}

/**
 * Plugin hooks returned by plugin function
 *
 * Хуки, которые плагин может вернуть для подписки на события OpenCode.
 *
 * Для kafka-плагина мы НЕ возвращаем hooks (простой вариант).
 * Обработка ошибок происходит через DLQ, а не через hooks.
 */
export interface PluginHooks {
  [key: string]: unknown;
}
```

### Типы OpenCode SDK

```typescript
/**
 * SDK client для работы с OpenCode
 *
 * Минимальный интерфейс для используемых методов SDK client.
 */
export interface SDKClient {
  /** Sessions API */
  session: SessionsAPI;
}

/**
 * Sessions API для управления сессиями OpenCode
 *
 * Позволяет создавать, отправлять промпты, прерывать и удалять сессии.
 */
export interface SessionsAPI {
  /**
   * Создаёт новую сессию OpenCode
   *
   * @param params - Параметры создания сессии
   * @returns Promise с созданной сессией
   *
   * @example
   * ```ts
   * const session = await client.session.create({
   *   body: { title: "My session" }
   * });
   * // session: Session { id: "123", status: "idle", ... }
   * ```
   */
  create(params: { body: { title: string } }): Promise<Session>;

  /**
   * Отправляет промпт в сессию
   *
   * @param params - Параметры промпта
   * @returns Promise с сообщением ассистента
   *
   * @example
   * ```ts
   * // С агентом
   * const response = await client.session.prompt({
   *   path: { id: "123" },
   *   body: {
   *     agent: "agent-123",
   *     parts: [{ type: "text", text: "Hello" }]
   *   }
   * });
   * // response: AssistantMessage { parts: [...], ... }
   *
   * // Без ответа (инъекция контекста)
   * await client.session.prompt({
   *   path: { id: "123" },
   *   body: { noReply: true, parts: [{ type: "text", text: "Context" }] }
   * });
   * ```
   */
  prompt(params: {
    path: { id: string };
    body: PromptParams;
  }): Promise<AssistantMessage>;

  /**
   * Прерывает активную сессию
   *
   * @param params - Параметры прерывания
   * @returns Promise с boolean: true если успешно прервана
   *
   * @example
   * ```ts
   * const aborted = await client.session.abort({ path: { id: "123" } });
   * // aborted: true или false
   * ```
   */
  abort(params: { path: { id: string } }): Promise<boolean>;

  /**
   * Получает список сообщений в сессии
   *
   * @param params - Параметры запроса
   * @returns Promise с массивом сообщений
   */
  messages(params: { path: { id: string } }): Promise<Message[]>;

  /**
   * Получает статус сессии
   *
   * @returns Promise с статусом сессии
   */
  status(params: { path: { id: string } }): Promise<SessionStatus>;

  /**
   * Удаляет сессию
   *
   * @param params - Параметры удаления
   * @returns Promise с boolean: true если успешно удалена
   */
  delete(params: { path: { id: string } }): Promise<boolean>;
}

/**
 * Параметры для отправки промпта
 */
export interface PromptParams {
  /**
   * ID агента OpenCode (если указан)
   *
   * Если не указан, используется default agent.
   */
  agent?: string;

  /**
   * Не ждать ответа (только инъекция контекста)
   *
   * true: только отправка UserMessage, без ожидания AssistantMessage
   * false или undefined: ждать AssistantMessage от агента
   */
  noReply?: boolean;

  /**
   * Части сообщения (text, code, images, etc.)
   */
  parts: MessagePart[];
}

/**
 * Часть сообщения (text, code, images, etc.)
 */
export interface MessagePart {
  /** Тип части сообщения */
  type: 'text' | 'code' | 'image' | 'file';

  /** Содержимое части сообщения */
  text?: string;
  code?: string;
  language?: string;
  filePath?: string;
  [key: string]: unknown;
}

/**
 * Сессия OpenCode
 */
export interface Session {
  /** Уникальный ID сессии */
  id: string;

  /** Название сессии */
  title: string;

  /** Статус сессии */
  status: SessionStatus;

  /** Время создания */
  createdAt: string;

  /** Время последнего обновления */
  updatedAt: string;
}

/**
 * Статус сессии
 */
export type SessionStatus =
  | 'idle' /** Сессия завершилась (AI finished) */
  | 'processing' /** Сессия в процессе выполнения */
  | 'error' /** Ошибка в сессии */
  | 'cancelled' /** Сессия была отменена */

/**
 * Сообщение в сессии
 */
export interface Message {
  /** ID сообщения */
  id: string;

  /** Type: text, code, image, file */
  type: 'text' | 'code' | 'image' | 'file';

  /** Role: user, assistant, system */
  role: 'user' | 'assistant' | 'system';

  /** Части сообщения */
  parts: MessagePart[];

  /** Время создания */
  createdAt: string;
}

/**
 * Сообщение ассистента (ответ от AI)
 */
export interface AssistantMessage extends Message {
  role: 'assistant';
  /** Дополнительные метаданные */
  metadata?: {
    [key: string]: unknown;
  };
}

/**
 * Сообщение пользователя (входящий промпт)
 */
export interface UserMessage extends Message {
  role: 'user';
}

/**
 * Проект OpenCode
 */
export interface Project {
  /** ID проекта */
  id: string;

  /** Название проекта */
  name: string;

  /** Путь к проекту */
  path: string;

  /** Репозиторий (если есть) */
  repository?: {
    provider: 'github' | 'gitlab' | 'bitbucket';
    owner: string;
    repo: string;
    branch: string;
  };
}

/**
 * Shell API (упрощённый)
 */
export interface BunShell {
  /** Выполняет shell команду */
  $: (command: string) => Promise<string>;
}
```

### Расширенные схемы RuleV003Schema

```typescript
/**
 * Zod schema для Rule (spec 003 - JSONPath routing) с поддержкой OpenCode
 *
 * Расширенная версия RuleV003Schema с полями для интеграции с OpenCode:
 * - agentId: ID агента OpenCode (обязательное)
 * - responseTopic: Topic для отправки ответа (опциональное)
 * - timeoutSeconds: Timeout для вызова агента (опциональное, default: 120)
 * - concurrency: Количество параллельных сообщений (опциональное, default: 1)
 *
 * Пример конфигурации:
 * ```json
 * {
 *   "topics": ["input-topic"],
 *   "rules": [
 *     {
 *       "name": "vulnerability-rule",
 *       "jsonPath": "$.vulnerabilities[?(@.severity==\"CRITICAL\")]",
 *       "promptTemplate": "Analyze critical vulnerabilities: ${$}",
 *       "agentId": "security-analyzer",
 *       "responseTopic": "output-topic",
 *       "timeoutSeconds": 120,
 *       "concurrency": 1
 *     }
 *   ]
 * }
 * ```
 */
export const RuleV003Schema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  jsonPath: z.string().min(1, 'JSONPath expression is required'),
  promptTemplate: z.string().min(1, 'Prompt template is required'),

  // OpenCode integration fields
  agentId: z.string().min(1, 'Agent ID is required'),
  responseTopic: z.string().optional(),
  timeoutSeconds: z.number().int().min(10).max(3600).default(120),
  concurrency: z.number().int().min(1).max(10).default(1),
});

/**
 * TypeScript type для RuleV003 (с OpenCode) — derived from RuleV003Schema
 */
export type RuleV003 = z.infer<typeof RuleV003Schema>;
```

## Обоснование (Rationale)

### Почему минимальные типы SDK?
1. **Simplicity**: Определяем только то, что используем
2. **Low coupling**: Меньше зависимостей от OpenCode SDK
3. **Easy to maintain**: Меньше типов для обновления при изменениях SDK

### Почему timeoutSeconds с default 120?
1. **Reasonable default**: 2 минуты достаточно для большинства задач
2. **Configurable**: Пользователь может настроить для долгих задач
3. **Safety**: Timeout предотвращает вечные ожидания

### Почему responseTopic optional?
1. **Simplicity**: Для многих use cases достаточно логов
2. **Flexibility**: Пользователь выбирает: логи vs Kafka ответ
3. **Backward compatibility**: Существующие конфиги без responseTopic продолжают работать

### Почему concurrency поле на уровне правила?
1. **Granularity**: Каждое правило может иметь свою степень параллелизма
2. **Forward compatibility**: Поле добавлено для будущей поддержки parallel processing
3. **Default = 1**: Sequential обработка по умолчанию (безопасно для большинства case)
4. **Semantics**: 1 = sequential, >1 = parallel message processing в рамках этого правила
5. **v1 support**: В v1 поддерживается только sequential (concurrency=1), поле добавлено для forward compatibility

### Почему agentId required?
1. **Explicit is better**: Принудительное указание агента
2. **Fail-fast**: Невалидная конфигурация падает при старте (Constitution Principle I)

## Следующие шаги

1. Создать файл `src/types/opencode-sdk.d.ts` с типами SDK
2. Обновить файл `src/types/opencode-plugin.d.ts` с PluginContext и PluginHooks
3. Обновить файл `src/schemas/index.ts` с RuleV003Schema (добавить agentId, responseTopic, timeoutSeconds)
4. Создать интерфейс `IOpenCodeAgent` в новом модуле
5. Создать тесты для валидации новых типов

## Open вопросы

1. **Типы SDK**: Нужно ли использовать @opencode/sdk пакет или достаточно локальных типов?
   - *Recommendation*: Использовать локальные типы для минимальной зависимости

2. **Timeout default**: 120 секунд (2 минуты) достаточно? Или нужно больше/меньше?
   - *Recommendation*: Оставить 120, сделать конфигурируемым

3. **AgentId validation**: Нужно ли валидировать, что agentId существует?
   - *Recommendation*: Нет, fail-fast при runtime (если агент не существует, SDK вернёт ошибку)
