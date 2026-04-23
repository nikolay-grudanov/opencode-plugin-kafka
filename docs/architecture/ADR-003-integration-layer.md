# ADR-003: OpenCode Integration Layer — IOpenCodeAgent Interface

## Контекст

Необходимо создать слой абстракции между Kafka consumer и OpenCode SDK для:
1. Тестируемости (90%+ coverage с mockable зависимостью)
2. Изоляции зависимостей (consumer logic не зависит напрямую от SDK)
3. Централизованного управления timeout и error handling
4. Поддержки graceful shutdown (abort active sessions)

## Рассмотренные альтернативы

### Вариант 1: Прямое использование SDK client в consumer
**Описание**: Вызывать `context.client.session.create()` и `session.prompt()` напрямую в eachMessageHandler

**Плюсы**:
- Минимальный код, простая реализация
- Меньше абстракций

**Минусы**:
- Сложно тестировать unit tests (нужен реальный SDK или сложный мок)
- Tight coupling к OpenCode SDK
- Timeout handling разбросан по коду
- Трудно mock для интеграционных тестов

### Вариант 2: Integration layer с mockable интерфейсом IOpenCodeAgent (ВЫБРАНО)
**Описание**: Создать интерфейс `IOpenCodeAgent` с двумя реализациями:
- `OpenCodeAgentAdapter` — использует real SDK client
- `MockOpenCodeAgent` — для unit/integration tests

**Плюсы**:
- Высокая тестируемость (90%+ coverage достижимо)
- Loose coupling к OpenCode SDK
- Timeout handling в одном месте
- Easy to mock для тестов
- Следует Dependency Inversion Principle

**Минусы**:
- Больше кода (дополнительный слой абстракции)
- Дополнительный интерфейс для поддержки

### Вариант 3: Integration layer с async/callback interface
**Описание**: Использовать event-driven интерфейс с callbacks для ответов

**Плюсы**:
- Better throughput
- Non-blocking

**Минусы**:
- Очень сложная координация состояния
- Сохранение mapping между сообщениями Kafka и сессиями OpenCode
- Нарушает "No-State Consumer" принцип
- Сложно тестируемо

## Принятое решение

Выбран **Вариант 2**: Integration layer с mockable интерфейсом и синхронным blocking вызовом.

### Интерфейс IOpenCodeAgent

```typescript
/**
 * Интерфейс для работы с OpenCode агентами
 *
 * Mockable интерфейс для интеграции с OpenCode SDK.
 * Позволяет тестировать consumer logic без реального SDK client.
 *
 * @implements Dependency Inversion Principle
 */
export interface IOpenCodeAgent {
  /**
   * Вызывает OpenCode агента с промптом
   *
   * Создаёт сессию, отправляет промпт, ждёт ответ, удаляет сессию.
   *
   * @param prompt - Промпт для агента
   * @param agentId - ID агента OpenCode
   * @param options - Опции вызова (timeout, metadata)
   * @returns Promise с результатом выполнения агента
   *
   * @throws {TimeoutError} Если агент не ответил за timeoutSeconds
   * @throws {AgentError} Если произошла ошибка при вызове агента
   *
   * @example
   * ```ts
   * const result = await agent.invoke(
   *   "Analyze vulnerabilities",
   *   "security-analyzer",
   *   { timeoutSeconds: 120 }
   * );
   * // result: AgentResult { response: "...", sessionId: "...", status: "success" }
   * ```
   */
  invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions,
  ): Promise<AgentResult>;

  /**
   * Прерывает активную сессию
   *
   * @param sessionId - ID сессии для прерывания
   * @returns Promise с boolean: true если успешно прервана
   */
  abort(sessionId: string): Promise<boolean>;
}

/**
 * Опции для вызова агента
 */
export interface InvokeOptions {
  /** Timeout в секундах (default: 120) */
  timeoutSeconds?: number;

  /** Дополнительные метаданные */
  metadata?: {
    [key: string]: unknown;
  };
}

/**
 * Результат вызова агента
 */
export interface AgentResult {
  /** Статус выполнения */
  status: 'success' | 'error' | 'timeout';

  /** Ответ от агента (если success) */
  response?: string;

  /** ID сессии (для отслеживания) */
  sessionId: string;

  /** Error message (если error/timeout) */
  errorMessage?: string;

  /** Время выполнения в миллисекундах */
  executionTimeMs: number;

  /** Timestamp завершения */
  timestamp: string;
}
```

### Реализация OpenCodeAgentAdapter

```typescript
/**
 * Адаптер для работы с реальным OpenCode SDK client
 *
 * Реализует IOpenCodeAgent через OpenCode SDK client.
 *
 * @implements IOpenCodeAgent
 */
export class OpenCodeAgentAdapter implements IOpenCodeAgent {
  constructor(private readonly sdkClient: SDKClient) {}

  async invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions = {},
  ): Promise<AgentResult> {
    const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
    const startTime = Date.now();

    try {
      // 1. Создаём сессию
      const session = await this.sdkClient.session.create({
        body: { title: `Kafka message: ${agentId}` },
      });

      // 2. Создаём timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new TimeoutError(`Agent timeout after ${options.timeoutSeconds}s`)), timeoutMs);
      });

      // 3. Отправляем промпт с agentId и ждём ответ (или timeout)
      const assistantMessage = await Promise.race([
        this.sdkClient.session.prompt({
          path: { id: session.id },
          body: { agent: agentId, parts: [{ type: 'text', text: prompt }] },
        }),
        timeoutPromise,
      ]);

      // 4. Извлекаем текст из сообщений сессии
      const messages = await this.sdkClient.session.messages({ path: { id: session.id } });
      const response = this.extractResponseText(messages);

      // 5. Удаляем сессию
      await this.sdkClient.session.delete({ path: { id: session.id } });

      // 6. Возвращаем результат
      return {
        status: 'success',
        response,
        sessionId: session.id,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Обработка ошибок
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Если timeout → пытаемся abort сессии (best-effort), возвращаем timeout status
      if (error instanceof TimeoutError) {
        // Best-effort abort: пытаемся прервать сессию, но не бросаем исключение
        let aborted = false;
        try {
          aborted = await this.sdkClient.session.abort({ path: { id: session.id } });
        } catch (abortError) {
          // Best-effort: логируем ошибку, но не бросаем
          console.error(`Best-effort abort failed for session ${session.id}:`, abortError);
        }
        return {
          status: 'timeout',
          sessionId: session.id,
          errorMessage,
          executionTimeMs: timeoutMs,
          timestamp: new Date().toISOString(),
        };
      }

      // Любая другая ошибка → status: error
      return {
        status: 'error',
        sessionId: 'unknown',
        errorMessage,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async abort(sessionId: string): Promise<boolean> {
    try {
      return await this.sdkClient.session.abort({ path: { id: sessionId } });
    } catch (error) {
      console.error(`Failed to abort session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Извлекает текст из AssistantMessage
   *
   * Извлекает только text parts, join через \n\n.
   */
  private extractResponseText(messages: Message[]): string {
    // Фильтруем только text части и объединяем через двойной перенос строки
    const textParts = messages
      .filter((m) => m.type === 'text')
      .map((m) => m.text);
    return textParts.join('\n\n');
  }
}

/**
 * Ошибка timeout
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Ошибка агента
 */
export class AgentError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'AgentError';
  }
}
```

### Mock-реализация для тестов

```typescript
/**
 * Mock реализация IOpenCodeAgent для тестов
 *
 * @implements IOpenCodeAgent
 */
export class MockOpenCodeAgent implements IOpenCodeAgent {
  private responses: Map<string, { response: string; delayMs?: number }>;
  private activeSessions: Set<string> = new Set();

  constructor(responses: Record<string, { response: string; delayMs?: number }>) {
    this.responses = new Map(Object.entries(responses));
  }

  async invoke(
    prompt: string,
    agentId: string,
    options: InvokeOptions = {},
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const sessionId = `mock-session-${Date.now()}`;
    this.activeSessions.add(sessionId);

    // Имитируем задержку (если указана)
    const agentResponse = this.responses.get(agentId);
    if (agentResponse?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, agentResponse.delayMs));
    }

    // Проверяем timeout
    const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
    if (Date.now() - startTime > timeoutMs) {
      this.activeSessions.delete(sessionId);
      return {
        status: 'timeout',
        sessionId,
        errorMessage: `Mock timeout after ${options.timeoutSeconds}s`,
        executionTimeMs: timeoutMs,
        timestamp: new Date().toISOString(),
      };
    }

    // Возвращаем ответ
    this.activeSessions.delete(sessionId);
    return {
      status: 'success',
      response: agentResponse?.response ?? `Mock response for agent ${agentId}`,
      sessionId,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  async abort(sessionId: string): Promise<boolean> {
    return this.activeSessions.delete(sessionId);
  }

  /** Получить количество активных сессий (для тестов) */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
```

## Обоснование (Rationale)

### Почему mockable интерфейс?
1. **Testability**: 90%+ coverage достижимо без реального SDK
2. **Isolation**: Consumer logic не зависит от OpenCode SDK
3. **Flexibility**: Easy to swap implementations (mock, stub, real)
4. **Timeout handling**: Централизованный timeout management через Promise.race()

### Почему синхронный blocking вызов?
1. **Testability**: Easy to write unit tests с predictable flow
2. **Reliability**: At-least-once processing (commit offset только после ответа)
3. **Simplicity**: Простой flow, без state management между сообщениями
4. **Constitution compliance**: Соответствует "No-State Consumer" принципу

### Почему Promise.race() для timeout?
1. **Non-blocking timeout**: Не блокирует поток исполнения
2. **Clean error handling**: TimeoutError отделён от других ошибок
3. **Standard pattern**: Common pattern для timeout handling в async/await

### Почему удаление сессии после ответа?
1. **Clean up**: Не оставляем мёртвые сессии
2. **Cost**: OpenCode может лимитировать количество сессий
3. **Privacy**: Удаляем промпты и ответы после обработки

### Почему extractResponseText конкатенирует все text части?
1. **Simplicity**: Простой и понятный подход
2. **Flexibility**: Поддерживает многострочные ответы с несколькими text частями
3. **Fallback**: Если нет text части, возвращаем пустую строку

### Почему agentId validation только синтаксическая?
1. **Fail-fast**: Синтаксическая проверка при старте (non-empty string)
2. **No runtime check**: Не проверяем существование агента при старте
3. **DLQ for missing**: Если агент не найден — ошибка через DLQ
4. **Simplicity**: Проверка существования требует额外 API call

### Почему best-effort abort при timeout?
1. **Cleanup**: Пытаемся освободить ресурсы сервера
2. **Best-effort**: abort() может падать — логируем, но не бросаем
3. **Status preserved**: Результат всё равно timeout status

## Последствия

### Положительные

1. **High testability**: Mockable интерфейс позволяет писать unit tests без реального SDK
2. **Constitution compliance**: Соответствует "Domain Isolation" и "Resiliency" принципам
3. **Timeout safety**: Promise.race() гарантирует timeout
4. **Clean error handling**: TimeoutError отделён от других ошибок
5. **Graceful shutdown support**: Метод abort() для прерывания активных сессий

### Отрицательные

1. **Additional code layer**: ~150-200 строк кода для адаптера
   - *Mitigation*: Это разумная цена за тестируемость и изоляцию зависимостей

2. **Session overhead**: Создание и удаление сессии для каждого сообщения
   - *Mitigation*: Это необходимо для изоляции сообщений (Constitution Principle IV: No-State Consumer)

3. **Timeout handling**: Promise.race() оставляет "orphan" сессию при timeout
   - *Mitigation*: Можно добавить cleanup task для orphan сессий (будет в будущем)

## Следующие шаги

1. Создать файл `src/opencode/IOpenCodeAgent.ts` с интерфейсом
2. Создать файл `src/opencode/OpenCodeAgentAdapter.ts` с реализацией
3. Создать файл `src/opencode/MockOpenCodeAgent.ts` с mock-реализацией
4. Создать файл `src/opencode/AgentError.ts` с ошибками
5. Создать unit tests для всех трёх реализаций
6. Интегрировать invokeAgent в eachMessageHandler

## Open вопросы

1. **Orphan sessions**: Нужно ли cleanup task для orphan сессий при timeout?
   - *Recommendation*: Да, создать фоновой процесс для очистки orphan сессий каждые N минут

2. **Response format**: Нужно ли извлекать код из AssistantMessage.parts?
   - *Recommendation*: Пока только text части, код можно добавить в будущем

3. **Retry logic**: Нужно ли retry при transient ошибках?
   - *Recommendation*: Нет, использовать DLQ для всех ошибок (Constitution Principle III: Resiliency)
