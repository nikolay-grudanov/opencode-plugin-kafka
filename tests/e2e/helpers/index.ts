/**
 * Экспорт вспомогательных функций для E2E тестов.
 */

export { startRedpanda, stopRedpanda } from './redpandaContainer.js';
export { spawnOpenCodeServe } from './opencodeProcess.js';
export type { OpenCodeProcessHandle } from './opencodeProcess.js';
export { createTopics, produceMessage, consumeOneMessage } from './kafkaUtils.js';
export type { KafkaTestMessage } from './kafkaUtils.js';
export { createSDKClient } from './sdkClient.js';
export { startTimer } from './timing.js';
export type { TimerHandle } from './timing.js';
export { runPlugin } from './pluginRunner.js';
export type { PluginRunnerHandle, KafkaConnectionSettings } from './pluginRunner.js';