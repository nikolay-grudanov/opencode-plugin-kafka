/**
 * OpenCode SDK - Типы декларации для плагинов OpenCode.
 * FR-004: SDK type declarations
 *
 * Эти типы основаны на реальных паттернах плагинов (plannotator pattern)
 * и представляют собой ambient declarations для использования
 * в TypeScript проектах с ES2022.
 */

// ============================================================================
// Базовые типы сообщений
// ============================================================================

/**
 * Часть сообщения - объединение различных типов контента.
 */
export type MessagePart =
  | TextMessagePart
  | ToolCallMessagePart
  | ToolResultMessagePart;

/**
 * Текстовая часть сообщения.
 */
export interface TextMessagePart {
  type: 'text';
  text: string;
}

/**
 * Вызов инструмента.
 */
export interface ToolCallMessagePart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Результат выполнения инструмента.
 */
export interface ToolResultMessagePart {
  type: 'tool-result';
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/**
 * Базовый интерфейс сообщения.
 */
export interface Message {
  role: 'user' | 'assistant';
  parts: MessagePart[];
}

/**
 * Сообщение от ассистента - расширенное сообщение с частями.
 */
export interface AssistantMessage extends Message {
  role: 'assistant';
  parts: MessagePart[];
}

// ============================================================================
// Типы сессий
// ============================================================================

/**
 * Сессия представляет активный диалог с ассистентом.
 */
export interface Session {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Параметры API методов
// ============================================================================

/**
 * Параметры для создания новой сессии.
 */
export interface CreateSessionParams {
  body: {
    title?: string;
  };
}

/**
 * Параметры для отправки промпта в сессию.
 */
export interface PromptSessionParams {
  path: {
    id: string;
  };
  body: {
    parts: MessagePart[];
    agent?: string;
  };
}

/**
 * Параметры для получения сообщений сессии.
 */
export interface GetMessagesParams {
  path: {
    id: string;
  };
}

/**
 * Параметры для завершения сессии.
 */
export interface AbortSessionParams {
  path: {
    id: string;
  };
}

/**
 * Параметры для удаления сессии.
 */
export interface DeleteSessionParams {
  path: {
    id: string;
  };
}

// ============================================================================
// Sessions API
// ============================================================================

/**
 * API для управления сессиями ассистента.
 * Предоставляет методы для создания, промптинга, завершения и удаления сессий.
 */
export interface SessionsAPI {
  /**
   * Создать новую сессию с ассистентом.
   * @param params - параметры создания сессии
   * @returns созданная сессия
   */
  create(params: CreateSessionParams): Promise<Session>;

  /**
   * Отправить промпт в существующую сессию.
   * @param params - параметры промпта (path.id - ID сессии, body.parts - части сообщения)
   * @returns ответ ассистента
   */
  prompt(params: PromptSessionParams): Promise<AssistantMessage>;

  /**
   * Прервать выполнение в сессии.
   * @param params - параметры (path.id - ID сессии)
   * @returns true при успешном завершении
   */
  abort(params: AbortSessionParams): Promise<boolean>;

  /**
   * Удалить сессию.
   * @param params - параметры (path.id - ID сессии)
   * @returns true при успешном удалении
   */
  delete(params: DeleteSessionParams): Promise<boolean>;

  /**
   * Получить список сообщений сессии.
   * @param params - параметры (path.id - ID сессии)
   * @returns массив сообщений
   */
  messages(params: GetMessagesParams): Promise<Message[]>;
}

// ============================================================================
// SDK Client
// ============================================================================

/**
 * SDK клиент для взаимодействия с OpenCode.
 * Предоставляет доступ к различным API через свойства.
 */
export interface SDKClient {
  /**
   * API для управления сессиями ассистента.
   */
  session: SessionsAPI;
}

// ============================================================================
// Глобальная декларация модуля
// ============================================================================

/**
 * Расширение глобального контекста OpenCode плагина.
 */
declare global {
  namespace OpenCode {
    interface Context {
      client: SDKClient;
    }
  }
}

export {};