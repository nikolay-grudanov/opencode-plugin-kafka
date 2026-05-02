/**
 * Создание SDK клиента для E2E тестирования.
 * FR-004: SDK client helper для подключения к реальному OpenCode serve process.
 */

import type { SDKClient } from '../../../src/types/opencode-sdk.js';
import { Opencode } from '@opencode-ai/sdk';

/**
 * Создать SDK клиент для взаимодействия с OpenCode serve.
 * @param opts - параметры подключения
 * @returns готовый к использованию SDKClient
 */
function createSDKClient(opts: { baseURL: string }): SDKClient {
  const client = new Opencode({ baseURL: opts.baseURL });
  return client as SDKClient;
}

export { createSDKClient };