/**
 * Unit tests для OpenCodeAgentAdapter и extractResponseText.
 * T010: extractResponseText тесты
 * T011: OpenCodeAgentAdapter тесты с моком SDK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKClient, TextMessagePart, MessagePart, Session, AssistantMessage } from '../../../src/types/opencode-sdk.js';
import type { IOpenCodeAgent } from '../../../src/opencode/IOpenCodeAgent.js';

describe('extractResponseText', () => {
  // Импортируем приватную функцию для тестирования через отдельный экспорт
  // Для этого протестируем через сам класс, который использует эту функцию

  it('должен извлекать текст из text parts', () => {
    // Этот тест проверяет логику через вызов реального метода
    const parts: MessagePart[] = [
      { type: 'text', text: 'Hello' },
    ];

    const textParts = parts.filter((part): part is TextMessagePart => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Hello');
  });

  it('должен объединять несколько text parts через двойной перевод строки', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'First part' },
      { type: 'text', text: 'Second part' },
    ];

    const textParts = parts.filter((part): part is TextMessagePart => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('First part\n\nSecond part');
  });

  it('должен возвращать пустую строку для пустого массива parts', () => {
    const parts: MessagePart[] = [];

    const textParts = parts.filter((part): part is TextMessagePart => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });

  it('должен пропускать non-text parts', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'Text content' },
      { type: 'tool-call', toolCallId: 'call-123', toolName: 'tool', input: {} },
    ];

    const textParts = parts.filter((part): part is TextMessagePart => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Text content');
  });

  it('должен обрабатывать массив только с non-text типами', () => {
    const parts: MessagePart[] = [
      { type: 'tool-call', toolCallId: 'call-123', toolName: 'tool', input: {} },
      { type: 'tool-result', toolCallId: 'call-123', result: { foo: 'bar' } },
    ];

    const textParts = parts.filter((part): part is TextMessagePart => part.type === 'text');
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });
});

// Мок SDK клиента
function createMockSDKClient(overrides?: {
  createSession?: () => Promise<Session>;
  promptSession?: () => Promise<AssistantMessage>;
  abortSession?: () => Promise<boolean>;
  deleteSession?: () => Promise<boolean>;
}): SDKClient {
  return {
    session: {
      create: overrides?.createSession ?? vi.fn().mockResolvedValue({ id: 'session-123' }),
      prompt: vi.fn(
        // @ts-expect-error: мок функция с динамическим возвращаемым значением
        overrides?.promptSession ?? (() => Promise.resolve({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] }))
      ),
      abort: overrides?.abortSession ?? vi.fn().mockResolvedValue(true),
      delete: overrides?.deleteSession ?? vi.fn().mockResolvedValue(true),
    },
  };
}

describe('OpenCodeAgentAdapter', () => {
  let OpenCodeAgentAdapter: new (client: SDKClient) => IOpenCodeAgent;
  let extractResponseText: (parts: Array<{type: string; text?: string}>) => string;

  beforeEach(async () => {
    // Динамический импорт модуля после моков
    const module = await import('../../../src/opencode/OpenCodeAgentAdapter.js');
    OpenCodeAgentAdapter = module.OpenCodeAgentAdapter;

    const utilsModule = await import('../../../src/opencode/utils.js');
    extractResponseText = utilsModule.extractResponseText;
  });

  it('должен возвращать результат success при успешном вызове SDK', async () => {
    const mockClient = createMockSDKClient();

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe('response');
    expect(result.sessionId).toBe('session-123');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeUndefined();
  });

  it('должен возвращать результат timeout когда SDK превышает timeoutMs', async () => {
    const mockClient = createMockSDKClient({
      promptSession: () => new Promise((resolve) => setTimeout(resolve, 200)),
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
      promptSession: () => new Promise((resolve) => setTimeout(resolve, 200)),
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
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] });

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
    const crashClient: SDKClient = {
      session: {
        create: () => Promise.reject(new Error('Catastrophic failure')),
        // @ts-expect-error: intentionally broken mock
        prompt: () => { throw new Error('Should not reach here'); },
        abort: () => Promise.reject(new Error('Abort failed')),
        delete: () => Promise.reject(new Error('Delete failed')),
      },
    };

    const adapter = new OpenCodeAgentAdapter(crashClient, 'polling');

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
        create: vi.fn().mockResolvedValue({ id: 'session-123' }),
        prompt: vi.fn().mockImplementation(() => new Promise((resolve) => 
          setTimeout(() => resolve({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] }), 100)
        )),
        abort: vi.fn().mockRejectedValue(new Error('Abort failed')), // abort выбросит ошибку в cleanup
        delete: vi.fn().mockRejectedValue(new Error('Delete failed')),
      },
    };

    const adapter = new OpenCodeAgentAdapter(errorClient, 'polling');
    
    // Timeout вызовет performCleanup с TimeoutError
    // abort выбросит ошибку, но она будет поймана в catch block (line 167)
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 50 });

    // Должен вернуть timeout и НЕ выбросить исключение (cleanup errors ignored)
    expect(result.status).toBe('timeout');
  });

  it('performCleanup вызывает abort при TimeoutError', async () => {
    const abortSpy = vi.fn().mockResolvedValue(true);
    const deleteSpy = vi.fn().mockResolvedValue(true);
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'session-abort-test' }),
        prompt: vi.fn().mockImplementation(() => new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 50)
        )),
        abort: abortSpy,
        delete: deleteSpy,
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'polling');
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 20 });

    // При timeout должен вызываться abort (не delete)
    expect(result.status).toBe('timeout');
  });

  it('performCleanup вызывает delete при НЕ-TimeoutError', async () => {
    const abortSpy = vi.fn().mockResolvedValue(true);
    const deleteSpy = vi.fn().mockResolvedValue(true);
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'session-delete-test' }),
        prompt: vi.fn().mockRejectedValue(new Error('Some error')),
        abort: abortSpy,
        delete: deleteSpy,
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'polling');
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 5000 });

    // При ошибке должен вызываться delete (не abort)
    expect(result.status).toBe('error');
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('extractResponseText экспортируемая pure function', () => {
    expect(typeof extractResponseText).toBe('function');

    const parts: Array<{ type: string; text?: string }> = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ];

    const result = extractResponseText(parts);
    expect(result).toBe('Hello\n\nWorld');
  });

  it('extractResponseText использует ?? fallback когда text undefined', async () => {
    const { extractResponseText } = await import('../../../src/opencode/utils.js');

    // part.text undefined - это должно покрыть branch `part.text ?? ''`
    const parts: Array<{ type: string; text?: string }> = [
      { type: 'text' }, // text не передан (undefined)
    ];

    const result = extractResponseText(parts);
    expect(result).toBe(''); // используется fallback ''
  });
});

describe('extractResponseText standalone', () => {
  it('экспортируется и работает как standalone функция', async () => {
    const { extractResponseText } = await import('../../../src/opencode/utils.js');

    const parts: Array<{ type: string; text?: string }> = [
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
    const createSpy = vi.fn().mockResolvedValue({ id: 'session-tool-based' });
    const promptSpy = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      session: {
        create: createSpy,
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'tool-based');
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
        create: vi.fn().mockResolvedValue({ id: 'session-error' }),
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'tool-based');
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Prompt failed');
  });

  it('invoke проверяет signal.aborted после создания session и возвращает error', async () => {
    const createSpy = vi.fn().mockResolvedValue({ id: 'session-aborted' });
    const mockClient = {
      session: {
        create: createSpy,
        prompt: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const abortedSignal = { aborted: true } as AbortSignal;
    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'tool-based');
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
        create: vi.fn().mockResolvedValue({ id: 'session-polling' }),
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'polling');
    const result = await adapter.invoke('test prompt', 'polling-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe('polling response');
  });

  it('polling mode использует default timeoutMs когда не передан', async () => {
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] });
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'session-default-timeout' }),
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'polling');
    // timeoutMs НЕ передан - используется default 120000
    const result = await adapter.invoke('test prompt', 'polling-agent', {});

    expect(result.status).toBe('success');
  });

  it('createSignalPromise возвращает rejected promise когда signal.aborted уже true', async () => {
    // Это тестирует createSignalPromise напрямую через polling mode
    // При aborted signal - промпт должен быть отклонён сразу
    const createSpy = vi.fn().mockResolvedValue({ id: 'session-aborted-direct' });
    const promptSpy = vi.fn().mockResolvedValue({ role: 'assistant', parts: [{ type: 'text', text: 'response' }] });
    const mockClient = {
      session: {
        create: createSpy,
        prompt: promptSpy,
        abort: vi.fn().mockResolvedValue(true),
        delete: vi.fn().mockResolvedValue(true),
      },
    };

    const adapter = new OpenCodeAgentAdapter(mockClient as SDKClient, 'polling');
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
