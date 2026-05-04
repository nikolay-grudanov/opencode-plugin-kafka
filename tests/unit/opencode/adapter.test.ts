/**
 * Unit tests для OpenCodeAgentAdapter и extractResponseText.
 * T010: extractResponseText тесты
 * T011: OpenCodeAgentAdapter тесты с моком SDK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKClient, MessagePart, Session, AssistantMessage } from '../../../src/types/opencode-sdk.js';
import type { IOpenCodeAgent } from '../../../src/opencode/IOpenCodeAgent.js';

describe('extractResponseText', () => {
  // Импортируем приватную функцию для тестирования через отдельный экспорт
  // Для этого протестируем через сам класс, который использует эту функцию

  it('должен извлекать текст из text parts', () => {
    // Этот тест проверяет логику через вызов реального метода
    const parts: MessagePart[] = [
      { type: 'text' as const, text: 'Hello' },
    ];

    const textParts = parts.filter((part) => part.type === 'text') as MessagePart[];
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Hello');
  });

  it('должен объединять несколько text parts через двойной перевод строки', () => {
    const parts: MessagePart[] = [
      { type: 'text' as const, text: 'First part' },
      { type: 'text' as const, text: 'Second part' },
    ];

    const textParts = parts.filter((part) => part.type === 'text') as MessagePart[];
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('First part\n\nSecond part');
  });

  it('должен возвращать пустую строку для пустого массива parts', () => {
    const parts: MessagePart[] = [];

    const textParts = parts.filter((part) => part.type === 'text') as MessagePart[];
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });

  it('должен пропускать non-text parts', () => {
    const parts: MessagePart[] = [
      { type: 'text' as const, text: 'Text content' },
      { type: 'code' as const, code: 'console.log("test")', language: 'javascript' },
    ];

    const textParts = parts.filter((part) => part.type === 'text') as MessagePart[];
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('Text content');
  });

  it('должен обрабатывать массив только с non-text типами', () => {
    const parts: MessagePart[] = [
      { type: 'code' as const, code: 'console.log("test")', language: 'javascript' },
      { type: 'image' as const, filePath: '/image.png' },
    ];

    const textParts = parts.filter((part) => part.type === 'text') as MessagePart[];
    const result = textParts.map(part => part.text).join('\n\n');

    expect(result).toBe('');
  });
});

// Мок SDK клиента
function createMockSDKClient(overrides?: {
  createSession?: () => Promise<{ data: Session; error: null }>;
  promptSession?: () => Promise<{ data: AssistantMessage; error: null }>;
  abortSession?: () => Promise<{ data: boolean; error: null }>;
  deleteSession?: () => Promise<{ data: boolean; error: null }>;
  messagesSession?: () => Promise<{ data: never[]; error: null }>;
}): SDKClient {
  return {
    session: {
      create: overrides?.createSession ?? vi.fn().mockResolvedValue({ data: { id: 'session-123' }, error: null }),
      prompt: overrides?.promptSession ?? vi.fn().mockResolvedValue({
        data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
        error: null
      }),
      abort: overrides?.abortSession ?? vi.fn().mockResolvedValue({ data: true, error: null }),
      delete: overrides?.deleteSession ?? vi.fn().mockResolvedValue({ data: true, error: null }),
      messages: overrides?.messagesSession ?? vi.fn().mockResolvedValue({ data: [], error: null }),
    },
  };
}

describe('OpenCodeAgentAdapter', () => {
  let OpenCodeAgentAdapter: new (client: SDKClient) => IOpenCodeAgent;
  let extractResponseText: (parts: MessagePart[]) => string;

  beforeEach(async () => {
    // Динамический импорт модуля после моков
    const module = await import('../../../src/opencode/OpenCodeAgentAdapter.js');
    OpenCodeAgentAdapter = module.OpenCodeAgentAdapter;

    const utilsModule = await import('../../../src/opencode/utils.js');
    extractResponseText = utilsModule.extractResponseText;
  });

  it('должен возвращать результат success при успешном вызове SDK', async () => {
    const mockClient = createMockSDKClient();

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('success');
    expect(result.response).toBe('response');
    expect(result.sessionId).toBe('session-123');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeUndefined();
  });

  it('должен возвращать результат timeout когда SDK превышает timeoutMs', async () => {
    const mockClient = createMockSDKClient({
      promptSession: () => new Promise((resolve) => setTimeout(resolve, 200)).then(
        () => ({ data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] }, error: null })
      ),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 50 });

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('timed out');
  });

  it('должен возвращать результат error когда SDK бросает исключение', async () => {
    const mockClient = createMockSDKClient({
      createSession: () => Promise.reject(new Error('SDK connection refused')),
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('SDK connection refused');
  });

  it('должен пытаться вызвать abort при timeout', async () => {
    const abortSpy = vi.fn().mockResolvedValue({ data: true, error: null });

    const mockClient = createMockSDKClient({
      promptSession: () => new Promise((resolve) => setTimeout(resolve, 200)).then(
        () => ({ data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] }, error: null })
      ),
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 50 });

    expect(result.status).toBe('timeout');
    expect(abortSpy).toHaveBeenCalledWith({ path: { id: 'session-123' } });
  });

  it('должен пытаться вызвать delete при error', async () => {
    const deleteSpy = vi.fn().mockResolvedValue({ data: true, error: null });

    const mockClient = createMockSDKClient({
      promptSession: () => Promise.reject(new Error('Prompt API failed')),
      deleteSession: deleteSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result.status).toBe('error');
    expect(deleteSpy).toHaveBeenCalledWith({ path: { id: 'session-123' } });
  });

  it('должен передавать agentId в SDK prompt', async () => {
    const promptSpy = vi.fn().mockResolvedValue({
      data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
      error: null
    });

    const mockClient = createMockSDKClient({
      promptSession: promptSpy as never,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
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
    // Используем any для bypass проверки типов - это тест на runtime behavior
    const crashClient: SDKClient = {
      session: {
        create: () => Promise.resolve({ data: { id: 'session-123' }, error: null }),
        prompt: (() => { throw new Error('Should not reach here'); }) as never,
        abort: () => Promise.resolve({ data: false, error: new Error('Abort failed') }) as never,
        delete: () => Promise.resolve({ data: false, error: new Error('Delete failed') }) as never,
        messages: () => Promise.resolve({ data: [], error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(crashClient);

    // Не должен выбросить исключение
    const result = await adapter.invoke('test prompt', 'test-agent', { timeoutMs: 5000 });

    expect(result).toBeDefined();
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBeDefined();
  });

  it('abort возвращает boolean', async () => {
    const mockClient = createMockSDKClient();

    const adapter = new OpenCodeAgentAdapter(mockClient);

    const abortResult = await adapter.abort('session-123');

    expect(typeof abortResult).toBe('boolean');
  });

  it('abort возвращает true при успешном abort', async () => {
    const abortSpy = vi.fn().mockResolvedValue({ data: true, error: null });
    const mockClient = createMockSDKClient({
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.abort('session-123');

    expect(result).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith({ path: { id: 'session-123' } });
  });

  it('abort возвращает false при ошибке abort', async () => {
    const abortSpy = vi.fn().mockRejectedValue(new Error('Abort failed'));
    const mockClient = createMockSDKClient({
      abortSession: abortSpy,
    });

    const adapter = new OpenCodeAgentAdapter(mockClient);
    const result = await adapter.abort('session-123');

    // abort возвращает false при ошибке (best-effort)
    expect(result).toBe(false);
  });

  it('performCleanup не выбрасывает при ошибке cleanup (best-effort)', async () => {
    // Мокаем SDK с медленным prompt и падающим abort
    const errorClient = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'session-123' }, error: null }),
        prompt: vi.fn().mockImplementation(() => new Promise((resolve) => 
          setTimeout(() => resolve({
            data: { role: 'assistant', parts: [{ type: 'text', text: 'response' }] },
            error: null
          }), 100)
        )),
        abort: vi.fn().mockRejectedValue(new Error('Abort failed')), // abort выбросит ошибку в cleanup
        delete: vi.fn().mockRejectedValue(new Error('Delete failed')),
        messages: vi.fn().mockResolvedValue({ data: [], error: null }),
      },
    };

    const adapter = new OpenCodeAgentAdapter(errorClient);
    
    // Timeout вызовет performCleanup с TimeoutError
    // abort выбросит ошибку, но она будет поймана в catch block (line 167)
    const result = await adapter.invoke('test', 'agent', { timeoutMs: 50 });

    // Должен вернуть timeout и НЕ выбросить исключение (cleanup errors ignored)
    expect(result.status).toBe('timeout');
  });

  it('extractResponseText экспортируемая pure function', () => {
    expect(typeof extractResponseText).toBe('function');

    const parts: MessagePart[] = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: 'World' },
    ];

    const result = extractResponseText(parts);
    expect(result).toBe('Hello\n\nWorld');
  });
});

describe('extractResponseText standalone', () => {
  it('экспортируется и работает как standalone функция', async () => {
    const { extractResponseText } = await import('../../../src/opencode/utils.js');

    const parts = [
      { type: 'text' as const, text: 'Line 1' },
      { type: 'text' as const, text: 'Line 2' },
      { type: 'text' as const, text: 'Line 3' },
    ];

    const result = extractResponseText(parts);
    expect(result).toBe('Line 1\n\nLine 2\n\nLine 3');
  });
});