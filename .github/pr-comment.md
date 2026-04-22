## Known Issues

### Coverage ниже 90% — требуются integration tests с real Redpanda

**Проблема**: `src/kafka/consumer.ts` имеет покрытие 39.82% из-за сложной логики с Kafka API.

**Текущее состояние**:
- Unit tests для pure functions (routing, prompt, dlq) — 100% coverage ✅
- `consumer.ts` требует integration tests с реальным Redpanda контейнером
- Unit tests для consumer.ts невозможны без моков Kafka API

**Требуется**:
1. Integration tests с real Redpanda для `consumer.ts` (eachMessageHandler, graceful shutdown)
2. CI/CD environment с Docker/Podman для запуска Redpanda
3. Или исключение `consumer.ts` из coverage threshold

**Файлы требующие coverage**:
- `src/kafka/consumer.ts` — 39.82%
- `src/core/config.ts` — 59.18%