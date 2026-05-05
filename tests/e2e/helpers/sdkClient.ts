/**
 * Создание SDK клиента для E2E тестирования.
 * FR-004: SDK client helper для подключения к реальному OpenCode serve process.
 */

import type { SDKClient } from '../../../src/types/opencode-sdk.js';
import { createOpencodeClient } from '@opencode-ai/sdk';

/**
 * Создаёт SDK клиент для подключения к OpenCode serve.
 * @param opts - опции с baseURL (параметр: baseURL, но SDK ожидает baseUrl)
 * @returns SDKClient
 */
function createSDKClient(opts: { baseURL: string }): SDKClient {
  // SDK (@opencode-ai/sdk) ожидает baseUrl (c 'b' в lowerCamelCase)
  // Наш интерфейс SDKClient использует baseURL для консистентности с остальным кодом
  const client = createOpencodeClient({ baseUrl: opts.baseURL });

  // Приводим к нашему SDKClient типу — SDK возвращает OpencodeClient с другим API
  // Cast безопасен: оба клиента предоставляют session API
  return client as unknown as SDKClient;
}

export { createSDKClient };