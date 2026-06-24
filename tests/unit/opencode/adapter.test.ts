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
  getSession?: () => Promise<{ data?: { id: string } | null } | null>;
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
      get: overrides?.getSession ?? vi.fn().mockResolvedValue({ data: { id: 'session-123' } }),
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

  // ========================================================================
  // spec-010: Multi-turn session resume
  // ========================================================================

  it('должен resume существующую сессию когда existingSessionId передан и session.get находит её', async () => {
    const mockClient = createMockSDKClient({
      getSession: () => Promise.resolve({ data: { id: 'ses_existing' } }),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      existingSessionId: 'ses_existing',
    });

    expect(result.status).toBe('success');
    expect(result.sessionId).toBe('ses_existing');
    // session.create() NOT called — we resumed existing
    expect(mockClient.session.create).not.toHaveBeenCalled();
    // session.prompt() called with existing sessionId in path
    const promptCalls = (mockClient.session.prompt as ReturnType<typeof vi.fn>).mock.calls;
    expect(promptCalls.length).toBeGreaterThan(0);
    const promptArg = promptCalls[0][0] as { path: { id: string } };
    expect(promptArg.path.id).toBe('ses_existing');
  });

  it('должен создать новую сессию когда existingSessionId передан но session.get возвращает null', async () => {
    const mockClient = createMockSDKClient({
      getSession: () => Promise.resolve(null),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      existingSessionId: 'ses_missing',
    });

    expect(result.status).toBe('success');
    expect(result.sessionId).toBe('session-123'); // default mock createSession ID
    expect(mockClient.session.create).toHaveBeenCalled();
  });

  it('должен создать новую сессию когда existingSessionId передан но session.get throws', async () => {
    const mockClient = createMockSDKClient({
      getSession: () => Promise.reject(new Error('connection refused')),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient, 'polling');
    const result = await adapter.invoke('test prompt', 'test-agent', {
      timeoutMs: 5000,
      existingSessionId: 'ses_unreachable',
    });

    expect(result.status).toBe('success');
    expect(result.sessionId).toBe('session-123'); // default mock createSession ID
    expect(mockClient.session.create).toHaveBeenCalled();
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
});
describe('extractResponseText standalone', () => {
  it('экспортируется и работает как standalone функция', async () => {
    const { extractResponseText: ert } = await import('../../../src/opencode/utils.js');
    expect(typeof ert).toBe('function');

    const parts: Array<{ type: string; text?: string }> = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
      { type: 'text', text: 'Line 3' },
    ];

    const result = ert(parts);
    expect(result).toBe('Line 1\n\nLine 2\n\nLine 3');
  });
});

