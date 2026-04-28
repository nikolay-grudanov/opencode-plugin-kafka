# Quickstart: E2E-тесты с реальным OpenCode-процессом

**Date**: 2026-04-28 | **Feature**: 008-e2e-opencode-real-process

## Предусловия

### 1. Lemonade LLM запущен

```bash
# Проверить доступность Lemonade
curl http://localhost:13305/api/v1/models
```

Если не отвечает — запустить Lemonade перед тестами.

### 2. Docker или Podman доступен

```bash
# Docker
docker info

# Podman (alternative)
systemctl --user start podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
```

### 3. opencode CLI в PATH

```bash
which opencode
opencode --version
```

### 4. Порт 3001 свободен

```bash
curl http://localhost:3001/health 2>/dev/null && echo "PORT BUSY" || echo "PORT FREE"
```

Если занят — остановить существующий `opencode serve`.

## Запуск E2E тестов

```bash
# Полный прогон
npm run test:e2e

# Конкретный тест
npx vitest run --config vitest.e2e.config.ts -t "T-E2E-001"
```

## Что происходит при запуске

1. `beforeAll`: Поднять Redpanda контейнер (~5s) → Спавнить `opencode serve :3001` (~10s) → Создать Kafka-топики
2. Каждый тест: Запустить consumer → Отправить сообщение → Проверить response/DLQ → Остановить consumer
3. `afterAll`: Убить opencode serve → Остановить Redpanda контейнер

## Ожидаемое время выполнения

| Компонент | Время |
|-----------|-------|
| Redpanda startup | ~5s |
| opencode serve startup | ~10s |
| Каждый тест | ~30-60s |
| Full suite (6 тестов) | ~5-8 min |

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| `Port 3001 is already in use` | Остановить существующий `opencode serve` |
| `opencode serve exited prematurely` | Проверить Lemonade доступность |
| `testcontainers timeout` | Проверить Docker/Podman |
| `LLM response timeout` | Lemonade может быть перегружен |
| `consumeOneMessage timeout` | Проверить, что consumer group ID уникален |
```