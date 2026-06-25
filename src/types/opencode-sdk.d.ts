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
 * Согласно спецификации: type: 'text' | 'code' | 'image' | 'file'
 */
export interface MessagePart {
  type: 'text' | 'code' | 'image' | 'file';
  text?: string;
  code?: string;
  language?: string;
  filePath?: string;
  [key: string]: unknown;
}

/**
 * Текстовая часть сообщения (alias для обратной совместимости).
 * @deprecated Используйте MessagePart с type: 'text'
 */
export interface TextMessagePart {
  type: 'text';
  text: string;
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
 * hey-api wrapper: реальный ответ оборачивается в { data: AssistantMessage, error: null }
 */
export interface AssistantMessage extends Message {
  role: 'assistant';
  parts: MessagePart[];
  // hey-api wrapper fields
  data?: {
    info?: {
      id: string;
      role: string;
      mode: string;
      agent: string;
      tokens?: { total: number; input: number; output: number };
      finish: string;
      sessionID: string;
    };
    parts: MessagePart[];
  };
}

// ============================================================================
// Типы сессий
// ============================================================================

/**
 * Сессия представляет активный диалог с ассистентом.
 * hey-api wrapper: реальный ответ оборачивается в { data: Session, error: null }
 */
export interface Session {
  id: string;
  title?: string;
  slug?: string;
  version?: string;
  projectID?: string;
  directory?: string;
  path?: string;
  createdAt?: string;
  updatedAt?: string;
  // hey-api wrapper fields
  data?: {
    id: string;
    title?: string;
  };
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
 * hey-api wrapper: все методы возвращают Promise<{ data: T, error: null }>
 */
export interface SessionsAPI {
  /**
   * Создать новую сессию с ассистентом.
   * @param params - параметры создания сессии
   * @returns { data: Session, error: null }
   */
  create(params: CreateSessionParams): Promise<{ data: Session; error: null }>;

  /**
   * Отправить промпт в существующую сессию.
   * @param params - параметры промпта (path.id - ID сессии, body.parts - части сообщения)
   * @returns { data: AssistantMessage, error: null }
   */
  prompt(params: PromptSessionParams): Promise<{ data: AssistantMessage; error: null }>;

  /**
   * Прервать выполнение в сессии.
   * @param params - параметры (path.id - ID сессии)
   * @returns { data: boolean, error: null }
   */
  abort(params: AbortSessionParams): Promise<{ data: boolean; error: null }>;

  /**
   * Удалить сессию.
   * @param params - параметры (path.id - ID сессии)
   * @returns { data: boolean, error: null }
   */
  delete(params: DeleteSessionParams): Promise<{ data: boolean; error: null }>;

  /**
   * Получить список сообщений сессии.
   * @param params - параметры (path.id - ID сессии)
   * @returns { data: Message[], error: null }
   */
  messages(params: GetMessagesParams): Promise<{ data: Message[]; error: null }>;
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
