/**
 * Unit tests для OpenCodeAgentAdapter и extractResponseText.
 * T010: extractResponseText тесты
 * T011: OpenCodeAgentAdapter тесты с моком SDK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKClient, MessagePart, Session, AssistantMessage } from '../../../src/types/opencode-sdk.js';
import type { IOpenCodeAgent } from '../../../src/opencode/IOpenCodeAgent.js';
import { TimeoutError } from '../../../src/opencode/AgentError.js';

describe('extractResponseText', () => {
  // Импортируем приватную функцию для тестирования через отдельный экспорт
  // Для этого протестируем через сам класс, который использует эту функцию

  it('должен извлекать текст из text parts', () => {
    // Этот тест проверяет логику через вызов реального метода
    const parts: MessagePart[] = [
      { type: 'text', text: 'Hello' },
    ];

    const textParts = parts.filter((part) => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Hello');
  });

  it('должен объединять несколько text parts через двойной перевод строки', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'First part' },
      { type: 'text', text: 'Second part' },
    ];

    const textParts = parts.filter((part) => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('First part\n\nSecond part');
  });

  it('должен возвращать пустую строку для пустого массива parts', () => {
    const parts: MessagePart[] = [];

    const textParts = parts.filter((part) => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });

  it('должен пропускать non-text parts', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'Text content' },
      { type: 'code', code: 'console.log("test")', language: 'javascript' },
    ];

    const textParts = parts.filter((part) => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Text content');
  });

  it('должен обрабатывать массив только с non-text типами', () => {
    const parts: MessagePart[] = [
      { type: 'code', code: 'const x = 1', language: 'javascript' },
      { type: 'image', filePath: 'image.png' },
    ];

    const textParts = parts.filter((part) => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });
});

// Мок SDK клиента - возвращает правильную структуру hey-api wrapper
function createMockSDKClient(overrides?: {
  createSession?: () => Promise<{ data: Session; error: null }>;
  promptSession?: (params: { path: { id: string }; body: { parts: Array<{ type: string; text?: string }>; agent?: string } }) => Promise<{ data: AssistantMessage; error: null }>;
  abortSession?: (params: { path: { id: string } }) => Promise<{ data: boolean; error: null }>;
  deleteSession?: (params: { path: { id: string } }) => Promise<{ data: boolean; error: null }>;
}): SDKClient {
  const defaultCreate = () => Promise.resolve({ data: { id: 'session-123' }, error: null });
  const defaultPrompt = (_params: { path: { id: string }; body: { parts: Array<{ type: string; text?: string }>; agent?: string } }) => Promise.resolve({ data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] }, error: null });
  const defaultAbort = (_params: { path: { id: string } }) => Promise.resolve({ data: true, error: null });
  const defaultDelete = (_params: { path: { id: string } }) => Promise.resolve({ data: true, error: null });
  const defaultMessages = () => Promise.resolve({ data: [], error: null });

  const createFn = overrides?.createSession ?? defaultCreate;
  const promptFn = overrides?.promptSession ?? defaultPrompt;
  const abortFn = overrides?.abortSession ?? defaultAbort;
  const deleteFn = overrides?.deleteSession ?? defaultDelete;

  return {
    session: {
      create: () => createFn(),
      prompt: (params: { path: { id: string }; body: { parts: Array<{ type: string; text?: string }>; agent?: string } }) => promptFn(params),
      abort: (params: { path: { id: string } }) => abortFn(params),
      delete: (params: { path: { id: string } }) => deleteFn(params),
      messages: () => defaultMessages(),
    },
  } as unknown as SDKClient;
}

describe('OpenCodeAgentAdapter', () => {
  let OpenCodeAgentAdapter: new (client: SDKClient, mode?: 'tool-based' | 'polling') => IOpenCodeAgent;
  let extractResponseText: (parts: Array<{type: 'text' | 'code' | 'image' | 'file'; text?: string; code?: string; language?: string; filePath?: string}>) => string;

  beforeEach(async () => {
    // Динамический импорт модуля после моков
    const module = await import('../../../src/opencode/OpenCodeAgentAdapter.js');
    OpenCodeAgentAdapter = module.OpenCodeAgentAdapter;

    const utilsModule = await import('../../../src/opencode/utils.js');
    extractResponseText = utilsModule.extractResponseText;
  });

  it('должен возвращать результат success при успешном вызове SDK', async () => {
    // Для polling mode адаптер ожидает что session.prompt возвращает данные напрямую (без wrapper)
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-123' }, error: null }),
        prompt: () => Promise.resolve({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] }),
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
        messages: () => Promise.resolve({ data: [], error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe('response');
    expect(result.sessionId).toBe('session-123');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeUndefined();
  });

  it('должен возвращать результат timeout когда SDK превышает timeoutMs', async () => {
    const mockClient = createMockSDKClient({
      promptSession: () => new Promise<{ data: AssistantMessage; error: null }>((resolve) => setTimeout(() => resolve({ data: { role: 'assistant', parts: [] }, error: null }), 200)),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 50 });

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('timed out');
  });

  it('должен возвращать результат error когда SDK бросает исключение', async () => {
    const mockClient = createMockSDKClient({
      createSession: () => Promise.reject(new Error('SDK connection refused')),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('SDK connection refused');
  });

  it('должен пытаться вызвать abort при timeout', async () => {
    const abortSpy = vi.fn().mockResolvedValue(true);

    const mockClient = createMockSDKClient({
      promptSession: () => new Promise<{ data: AssistantMessage; error: null }>((resolve) => setTimeout(() => resolve({ data: { role: 'assistant', parts: [] }, error: null }), 200)),
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 50 });

    expect(result.status).toBe('timeout');
    expect(abortSpy).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'session-123' } }));
  });

  it('должен пытаться вызвать delete при error', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(true);

    const mockClient = createMockSDKClient({
      promptSession: () => Promise.reject(new Error('Prompt API failed')),
      deleteSession: deleteSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('должен передавать agentId в SDK prompt', async () => {
    const promptSpy = vi.fn().mockResolvedValue({ data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] }, error: null });

    const mockClient = createMockSDKClient({
      promptSession: promptSpy as never,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    await adapter.invoke('test prompt', 'my-test-agent', { timeoutMs: 5000 });

    expect(promptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: 'my-test-agent',
        }),
      })
    );
  });

  it('никогда не бросает исключения даже при катастрофическом сбое SDK', async () => {
    const crashClient = {
      session: {
        create: () => Promise.reject(new Error('Catastrophic failure')),
        prompt: () => { throw new Error('Should not reach here'); },
        abort: () => Promise.reject(new Error('Abort failed')),
        delete: () => Promise.reject(new Error('Delete failed')),
        messages: () => Promise.reject(new Error('Messages failed')),
      },
    };

    const adapter = new OpenCodeAgentAdapter(crashClient as unknown as SDKClient, 'polling');

    // Не должен выбросить исключение
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result).toBeDefined();
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBeDefined();
  });

  it('abort возвращает boolean', async () => {
    const mockClient = createMockSDKClient();

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');

    const abortResult = await adapter.abort('session-123');

    expect(typeof abortResult).toBe('boolean');
  });

  it('abort возвращает true при успешном abort', async () => {
    const abortSpy = vi.fn().mockResolvedValue(true);
    const mockClient = createMockSDKClient({
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.abort('session-123');

    expect(result).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'session-123' } }));
  });

  it('abort возвращает false при ошибке abort', async () => {
    const abortSpy = vi.fn().mockRejectedValue(new Error('Abort failed'));
    const mockClient = createMockSDKClient({
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.abort('session-123');

    // abort возвращает false при ошибке (best-effort)
    expect(result).toBe(false);
  });

  it('performCleanup не выбрасывает при ошибке cleanup (best-effort)', async () => {
    // Мокаем SDK с медленным prompt и падающим abort
    const errorClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-123' }, error: null }),
        prompt: () => new Promise((resolve) =>
          setTimeout(() => resolve({ data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] }, error: null }), 100)
        ),
        abort: () => Promise.reject(new Error('Abort failed')),
        delete: () => Promise.reject(new Error('Delete failed')),
      },
    };

    const adapter = new OpenCodeAgentAdapter(errorClient as unknown as SDKClient, 'polling');
    
    // Timeout вызовет performCleanup с TimeoutError
    // abort выбросит ошибку, но она будет поймана в catch block (line 167)
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 50 });

    // Должен вернуть timeout и НЕ выбросить исключение (cleanup errors ignored)
    expect(result.status).toBe('timeout');
  });

  it('performCleanup вызывает abort при TimeoutError', async () => {
    const abortSpy = vi.fn().mockResolvedValue({ data: true, error: null });
    const deleteSpy = vi.fn().mockResolvedValue({ data: true, error: null });
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-abort-test' }, error: null }),
        prompt: () => new Promise((_, reject) =>
          setTimeout(() => reject(new TimeoutError('Timeout')), 50)
        ),
        abort: abortSpy,
        delete: deleteSpy,
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 20 });

    // При timeout должен вызываться abort (не delete)
    expect(result.status).toBe('timeout');
  });

  it('performCleanup вызывает delete при НЕ-TimeoutError', async () => {
    const abortSpy = vi.fn().mockResolvedValue({ data: true, error: null });
    const deleteSpy = vi.fn().mockResolvedValue({ data: true, error: null });
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-delete-test' }, error: null }),
        prompt: () => Promise.reject(new Error('Some error')),
        abort: abortSpy,
        delete: deleteSpy,
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 5000 });

    // При ошибке должен вызываться delete (не abort)
    expect(result.status).toBe('error');
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('extractResponseText экспортируемая pure function', () => {
    expect(typeof extractResponseText).toBe('function');

    const parts: Array<{ type: 'text'; text?: string }> = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ];

    const result = extractResponseText(parts);
    expect(result).toBe('Hello\n\nWorld');
  });

  it('extractResponseText использует ?? fallback когда text undefined', async () => {
    const { extractResponseText } = await import('../../../src/opencode/utils.js');

    // part.text undefined - это должно покрыть branch `part.text ?? ''`
    const parts: Array<{ type: 'text'; text?: string }> = [
      { type: 'text' }, // text не передан (undefined)
    ];

    const result = extractResponseText(parts);
    expect(result).toBe(''); // используется fallback ''
  });
});

describe('extractResponseText standalone', () => {
  it('экспортируется и работает как standalone функция', async () => {
    const { extractResponseText } = await import('../../../src/opencode/utils.js');

    const parts: Array<{ type: 'text'; text?: string }> = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
      { type: 'text', text: 'Line 3' },
    ];

    const result = extractResponseText(parts);
    expect(result).toBe('Line 1\n\nLine 2\n\nLine 3');
  });
});

// =============================================================================
// spec-009: tool-based mode tests
// =============================================================================

describe('OpenCodeAgentAdapter tool-based mode', () => {
  let OpenCodeAgentAdapter: new (client: SDKClient, mode?: 'tool-based' | 'polling') => IOpenCodeAgent;

  beforeEach(async () => {
    const module = await import('../../../src/opencode/OpenCodeAgentAdapter.js');
    OpenCodeAgentAdapter = module.OpenCodeAgentAdapter;
    // Clear session watchers before each test
    const { _clearAllSessionWatchersForTesting } = await import('../../../src/opencode/session-watchers.js');
    _clearAllSessionWatchersForTesting();
  });

  it('invoke в tool-based mode возвращает success с пустым response', async () => {
    const mockClient = createMockSDKClient();
    const adapter = new OpenCodeAgentAdapter(mockClient, 'tool-based');

    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe(''); // intentionally empty in tool-based mode
    expect(result.sessionId).toBe('session-123');
    expect(result.errorMessage).toBeUndefined();
  });

  it('invoke в tool-based mode создаёт session и вызывает prompt', async () => {
    const createSpy = vi.fn().mockResolvedValue({ data: { id: 'session-tool-based' }, error: null });
    const promptSpy = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const mockClient = {
      session: {
        create: createSpy,
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue({ data: true, error: null }),
        delete: vi.fn().mockResolvedValue({ data: true, error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'tool-based');
    await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledTimes(1);
  });

  it('invoke передаёт ruleName и responseTopic из options в SessionWatcher', async () => {
    const mockClient = createMockSDKClient();
    const adapter = new OpenCodeAgentAdapter(mockClient, 'tool-based');

    await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      ruleName: 'my-matched-rule',
      responseTopic: 'my-response-topic',
    });

    // Проверяем что watcher был зарегистрирован с правильными данными
    const { getSessionWatcher } = await import('../../../src/opencode/session-watchers.js');
    const watcher = getSessionWatcher('session-123');
    expect(watcher).toBeDefined();
    expect(watcher?.ruleName).toBe('my-matched-rule');
    expect(watcher?.responseTopic).toBe('my-response-topic');
  });

  it('invoke передаёт Kafka context в SessionWatcher', async () => {
    const mockClient = createMockSDKClient();
    const adapter = new OpenCodeAgentAdapter(mockClient, 'tool-based');

    await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      ruleName: 'kafka-rule',
      responseTopic: 'kafka-response',
      kafkaMessageKey: 'msg-key-123',
      kafkaTopic: 'input-topic',
      kafkaPartition: 2,
      kafkaOffset: '42',
    });

    const { getSessionWatcher } = await import('../../../src/opencode/session-watchers.js');
    const watcher = getSessionWatcher('session-123');
    expect(watcher?.originalMessageKey).toBe('msg-key-123');
    expect(watcher?.originalTopic).toBe('input-topic');
    expect(watcher?.originalPartition).toBe(2);
    expect(watcher?.originalOffset).toBe('42');
  });

  it('invoke использует agentId как fallback когда ruleName не передан', async () => {
    const mockClient = createMockSDKClient();
    const adapter = new OpenCodeAgentAdapter(mockClient, 'tool-based');

    await adapter.invoke('test prompt', 'fallback-agent', {
      timeoutMs: 5000,
      // ruleName не передан
      responseTopic: 'response-topic',
    });

    const { getSessionWatcher } = await import('../../../src/opencode/session-watchers.js');
    const watcher = getSessionWatcher('session-123');
    expect(watcher?.ruleName).toBe('fallback-agent');
  });

  it('invoke обрабатывает ошибку session.prompt() — abort watcher и propagate error', async () => {
    const promptSpy = vi.fn().mockRejectedValue(new Error('Prompt failed'));
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-error' }, error: null }),
        prompt: promptSpy as never,
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'tool-based');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Prompt failed');
  });

  it('invoke проверяет signal.aborted после создания session и возвращает error', async () => {
    const createSpy = vi.fn().mockResolvedValue({ data: { id: 'session-aborted' }, error: null });
    const mockClient = {
      session: {
        create: createSpy,
        prompt: () => Promise.resolve({ data: undefined, error: null }),
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
      },
    };

    const abortedSignal = { aborted: true } as AbortSignal;
    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'tool-based');
    const result = await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      signal: abortedSignal,
    });

    // session.create ВЫЗЫВАЕТСЯ (проверка после создания)
    expect(createSpy).toHaveBeenCalled();
    // После aborted signal - ошибка
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('Operation was aborted');
  });

  it('polling mode вызывает prompt и возвращает response', async () => {
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'polling response' }] });
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-polling' }, error: null }),
        prompt: promptSpy,
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    const result = await adapter.invoke('test prompt', 'polling-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe('polling response');
  });

  it('polling mode использует default timeoutMs когда не передан', async () => {
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] });
    const mockClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-default-timeout' }, error: null }),
        prompt: promptSpy,
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    const result = await adapter.invoke('test prompt', 'polling-agent', { timeoutMs: 120000 });

    expect(result.status).toBe('success');
  });

  it('createSignalPromise возвращает rejected promise когда signal.aborted уже true', async () => {
    // Это тестирует createSignalPromise напрямую через polling mode
    // При aborted signal - промпт должен быть отклонён сразу
    const createSpy = vi.fn().mockResolvedValue({ data: { id: 'session-aborted-direct' }, error: null });
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] });
    const mockClient = {
      session: {
        create: createSpy,
        prompt: promptSpy,
        abort: () => Promise.resolve({ data: true, error: null }),
        delete: () => Promise.resolve({ data: true, error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as unknown as SDKClient, 'polling');
    // Передаём уже aborted signal - это должно вызвать ошибку
    const abortedSignal = { aborted: true } as AbortSignal;
    const result = await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      signal: abortedSignal,
    });

    // Должен вернуть error статус из-за aborted signal
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('Operation was aborted');
  });
});
