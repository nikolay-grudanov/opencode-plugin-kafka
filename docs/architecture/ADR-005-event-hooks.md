# ADR-005: Event Hooks — Минимум один hook (session.error)

## Контекст

OpenCode плагины могут возвращать event hooks для подписки на события (session.idle, session.error, etc.). Нужно определить, нужны ли hooks для kafka-плагина.

## Рассмотренные альтернативы

### Вариант 1: Использовать session.idle hook для отслеживания завершения
**Описание**: Подписаться на `session.idle` для асинхронного получения ответов

**Плюсы**:
- Event-driven architecture
- Non-blocking
- Better throughput

**Минусы**:
- Очень сложная координация состояния
- Сохранение mapping между сообщениями Kafka и сессиями OpenCode
- Нарушает "No-State Consumer" принцип
- Сложно тестируемо
- Противоречит выбранному синхронному blocking подходу (ADR-003, ADR-004)

### Вариант 2: Использовать session.error hook для observability (ВЫБРАНО)
**Описание**: Подписаться на `session.error` для логирования ошибок OpenCode runtime

**Плюсы**:
- Centralized observability: логирование внутренних ошибок OpenCode runtime
- Не влияет на Kafka message processing
- DLQ уже обрабатывает ошибки Kafka-сообщений

**Минусы**:
- Minimal overhead для логирования

### Вариант 3: НЕ возвращать hooks
**Описание**: Плагин не возвращает hooks, обрабатывает всё внутри eachMessageHandler

**Плюсы**:
- **Simplicity**: Минимальная сложность

**Минусы**:
- Нет visibility во внутренние ошибки OpenCode runtime
- Observability hook нужен для мониторинга

## Принятое решение

**НЕ использовать event hooks** в kafka-плагине.

### Принятое решение

**Использовать минимум один hook** — `session.error`.

1. **Observability**: `session.error` hook нужен для логирования внутренних ошибок OpenCode runtime (не Kafka ошибок)
2. **DLQ уже обрабатывает Kafka errors**: Основной error handling — DLQ для сообщений, которые не удалось обработать
3. **session.error — observability hook**: He влияет на flow обработки Kafka сообщений, только логирование
4. **Minimal complexity**: Один hook, простая реализация

## Следствия

### Положительные

1. **Observability**: Видимость внутренних ошибок OpenCode runtime
2. **DLQ остаётся primary**: DLQ — основной механизм error handling для Kafka сообщений
3. **Minimal complexity**: Один hook, простая реализация
4. **Non-blocking**: session.error hook не влияет на Kafka processing flow

### Отрицательные

1. **Minimal overhead**: Один hook добавляет tiny complexity
   - *Mitigation*: Observability стоит этого overhead

## Реализация

```typescript
// src/index.ts

import { OpenCodeAgentAdapter } from './opencode/OpenCodeAgentAdapter.js';
import type { PluginContext } from './types/opencode-plugin.d.js';

export default async function plugin(context: PluginContext) {
  try {
    // 1. Парсим конфигурацию
    const config = parseConfigV003();

    // 2. Создаём OpenCode agent adapter
    const agent = new OpenCodeAgentAdapter(context.client);

    // 3. Запускаем consumer с agent
    await startConsumer(config, agent);

    // 4. Возвращаем hooks (минимум один — session.error)
    return {
      "session.error": async ({ sessionId, error }) => {
        logger.error(`OpenCode session error: sessionId=${sessionId}`, error);
        // Это internal logging hook, НЕ влияет на Kafka message processing
      },
    };
  } catch (error) {
    // ... (error handling)
  }
}
```

## Следующие шаги

1. Реализовать `session.error` hook в plugin()
2. Использовать синхронный blocking подход
3. Обрабатывать Kafka ошибки через DLQ
4. Использовать `session.error` hook для observability (не влияет на Kafka processing)

## Статус

| Дата | Статус | Notes |
|------|--------|-------|
| 2026-04-23 | 🔴 Пересмотреть | Требуется session.error hook для observability |
| 2026-04-23 | 🟢 Принято | Минимум один hook — session.error |

## Open вопросы

Нет открытых вопросов — решение однозначно: используем минимум один hook (`session.error`) для observability.
