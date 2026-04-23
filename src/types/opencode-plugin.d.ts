/**
 * Type declarations for opencode-plugin
 *
 * Minimal type declarations for OpenCode plugin integration.
 * Used by opencode-plugin-kafka to define plugin entry point.
 */

/**
 * OpenCode plugin context
 *
 * Context object passed to plugin entry point.
 * Contents depend on OpenCode version and configuration.
 */
export type PluginContext = unknown;

/**
 * Plugin hooks returned by plugin function
 *
 * Currently empty object - plugin runs as standalone Kafka consumer.
 * May include event handlers in future versions.
 */
export interface PluginHooks {
  [key: string]: unknown;
}

/**
 * OpenCode plugin function type
 *
 * Plugin entry point that OpenCode calls on startup.
 * @param context - Plugin context from OpenCode
 * @returns Promise resolving to plugin hooks
 */
export type Plugin = (context: PluginContext) => Promise<PluginHooks>;