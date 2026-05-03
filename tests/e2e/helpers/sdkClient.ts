/**
 * Создание SDK клиента для E2E тестирования.
 * FR-004: SDK client helper для подключения к реальному OpenCode serve process.
 */

import type { SDKClient } from '../../../src/types/opencode-sdk.js';
import { createOpencodeClient } from '@opencode-ai/sdk';

function createSDKClient(opts: { baseURL: string }): SDKClient {
  const client = createOpencodeClient({ baseUrl: opts.baseURL });
  return client as unknown as SDKClient;
}

export { createSDKClient };