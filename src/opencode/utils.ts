/**
 * Утилиты для работы с OpenCode агентом.
 */

import type { MessagePart } from '../types/opencode-sdk.js';

/**
 * Извлекает текстовый контент из ответа ассистента.
 * Фильтрует только text parts и объединяет их через двойной перевод строки.
 *
 * @param parts - массив частей сообщения
 * @returns объединённый текст
 */
export function extractResponseText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n\n');
}