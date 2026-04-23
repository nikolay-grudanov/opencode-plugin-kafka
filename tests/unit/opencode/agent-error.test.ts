/**
 * Unit tests для AgentError и TimeoutError классов.
 * Проверяет корректность создания, наследования и свойств ошибок.
 */

import { describe, it, expect } from 'vitest';
import { TimeoutError, AgentError } from '../../../src/opencode/AgentError.js';

describe('TimeoutError', () => {
  it('создаётся с корректным сообщением', () => {
    const error = new TimeoutError('Agent timed out after 120000ms');

    expect(error.message).toBe('Agent timed out after 120000ms');
  });

  it('имеет name = "TimeoutError"', () => {
    const error = new TimeoutError('timeout');

    expect(error.name).toBe('TimeoutError');
  });

  it('является экземпляром Error', () => {
    const error = new TimeoutError('timeout');

    expect(error).toBeInstanceOf(Error);
  });

  it('является экземпляром TimeoutError', () => {
    const error = new TimeoutError('timeout');

    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('может быть пойман через catch', () => {
    const throwTimeout = (): void => {
      throw new TimeoutError('Operation exceeded time limit');
    };

    expect(throwTimeout).toThrow(TimeoutError);
    expect(throwTimeout).toThrow('Operation exceeded time limit');
  });

  it('может быть отличён от обычного Error', () => {
    const timeoutError = new TimeoutError('timeout');
    const regularError = new Error('regular');

    expect(timeoutError).toBeInstanceOf(TimeoutError);
    expect(regularError).not.toBeInstanceOf(TimeoutError);
  });

  it('может быть отличён от AgentError', () => {
    const timeoutError = new TimeoutError('timeout');
    const agentError = new AgentError('agent failed');

    expect(timeoutError).toBeInstanceOf(TimeoutError);
    expect(timeoutError).not.toBeInstanceOf(AgentError);
    expect(agentError).not.toBeInstanceOf(TimeoutError);
  });
});

describe('AgentError', () => {
  it('создаётся с корректным сообщением', () => {
    const error = new AgentError('Agent execution failed');

    expect(error.message).toBe('Agent execution failed');
  });

  it('имеет name = "AgentError"', () => {
    const error = new AgentError('agent error');

    expect(error.name).toBe('AgentError');
  });

  it('является экземпляром Error', () => {
    const error = new AgentError('error');

    expect(error).toBeInstanceOf(Error);
  });

  it('является экземпляром AgentError', () => {
    const error = new AgentError('error');

    expect(error).toBeInstanceOf(AgentError);
  });

  it('сохраняет originalError когда передан', () => {
    const original = new Error('SDK connection refused');
    const error = new AgentError('Agent invocation failed', original);

    expect(error.originalError).toBe(original);
    expect(error.originalError?.message).toBe('SDK connection refused');
  });

  it('имеет undefined originalError когда не передан', () => {
    const error = new AgentError('Agent failed without cause');

    expect(error.originalError).toBeUndefined();
  });

  it('может быть пойман через catch', () => {
    const throwAgent = (): void => {
      throw new AgentError('Critical agent failure');
    };

    expect(throwAgent).toThrow(AgentError);
    expect(throwAgent).toThrow('Critical agent failure');
  });

  it('сохраняет цепочку ошибок (error chain)', () => {
    const rootCause = new TypeError('Cannot read property "session" of undefined');
    const wrapped = new AgentError('Session creation failed', rootCause);

    expect(wrapped.originalError).toBeInstanceOf(TypeError);
    expect(wrapped.originalError).toBe(rootCause);
  });

  it('сохраняет originalError когда передан non-Error объект', () => {
    const original = { code: 'ERR_SDK', message: 'Custom error' };
    const error = new AgentError('Agent failed', original);

    expect(error.originalError).toBe(original);
    expect(error.getOriginalErrorMessage()).toBe('[object Object]');
  });

  it('сохраняет originalError когда передан примитив string', () => {
    const original = 'string error';
    const error = new AgentError('Agent failed', original);

    expect(error.originalError).toBe(original);
    expect(error.getOriginalErrorMessage()).toBe('string error');
  });

  it('сохраняет originalError когда передан null', () => {
    const original = null;
    const error = new AgentError('Agent failed', original);

    expect(error.originalError).toBeNull();
    expect(error.getOriginalErrorMessage()).toBeUndefined();
  });

  it('getOriginalErrorMessage возвращает undefined когда originalError отсутствует', () => {
    const error = new AgentError('Agent failed');

    expect(error.getOriginalErrorMessage()).toBeUndefined();
  });
});