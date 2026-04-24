/**
 * Type declarations for opencode-plugin
 *
 * Minimal type declarations for OpenCode plugin integration.
 * Used by opencode-plugin-kafka to define plugin entry point.
 */

import type { SDKClient } from './opencode-sdk.js';

// ============================================================================
// Project
// ============================================================================

/**
 * Информация о проекте OpenCode.
 */
export interface Project {
  /** ID проекта */
  id: string;
  /** Имя проекта */
  name: string;
  /** Путь к проекту */
  path: string;
  /** Информация о git репозитории */
  repository?: {
    provider: 'github' | 'gitlab' | 'bitbucket';
    owner: string;
    repo: string;
    branch: string;
  };
}

// ============================================================================
// BunShell
// ============================================================================

/**
 * Bun shell API для выполнения команд.
 */
export interface BunShell {
  /** Выполнить shell команду */
  $: (command: string) => Promise<string>;
}

// ============================================================================
// Plugin Context
// ============================================================================

/**
 * OpenCode plugin context
 *
 * Контекст объекта, передаваемый в plugin entry point.
 * Содержит SDK клиент и метаданные окружения.
 */
export interface PluginContext {
  /** OpenCode SDK клиент — типизированный доступ к session API */
  client: SDKClient;
  /** Метаданные проекта */
  project: Project;
  /** Рабочая директория (cwd) */
  directory: string;
  /** Git root */
  worktree: string;
  /** Bun shell API */
  $: BunShell;
}

// ============================================================================
// Plugin Hooks
// ============================================================================

/**
 * Plugin hooks returned by plugin function
 *
 * Хуки для обработки событий плагина.
 * Currently empty object - plugin runs as standalone Kafka consumer.
 * May include event handlers in future versions.
 */
export interface PluginHooks {
  /** Обработчик ошибок сессии — logging, не влияет на Kafka processing */
  'session.error'?: (error: Error, sessionId: string) => void;
}

// ============================================================================
// Plugin Function
// ============================================================================

/**
 * OpenCode plugin function type
 *
 * Plugin entry point that OpenCode calls on startup.
 * @param context - Plugin context from OpenCode
 * @returns Promise resolving to plugin hooks
 */
export type Plugin = (context: PluginContext) => Promise<PluginHooks>;