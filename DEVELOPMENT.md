# Разработка (DEVELOPMENT.md)

Документ для разработчиков: настройка окружения, запуск тестов, CI/CD pipeline.

## Содержание

- [Обзор проекта](#обзор-проекта)
- [Предварительные требования](#предварительные-требования)
- [Установка и запуск](#установка-и-запуск)
- [Доступные команды](#доступные-команды)
- [Integration Tests](#integration-tests)
- [CI/CD Pipeline](#cicd-pipeline)
- [Структура проекта](#структура-проекта)
- [Coverage требования](#coverage-требования)

---

## Обзор проекта

**opencode-plugin-kafka** — TypeScript плагин для OpenCode, реализующий Kafka consumer с поддержкой:

- Конфигурации через Zod схемы с валидацией (FR-017: проверка покрытия топиков)
- Маршрутизации сообщений по правилам (JSONPath запросы)
- DLQ (Dead Letter Queue) для ошибок
- Graceful shutdown

Проект использует:
- **TypeScript 6.x** (ES2022 target, ESNext modules)
- **kafkajs** — Kafka клиент
- **zod** — runtime валидация конфигурации
- **jsonpath-plus** — JSONPath запросы для фильтрации сообщений
- **vitest** — тестирование
- **testcontainers-node + Redpanda** — integration tests

---

## Предварительные требования

| Инструмент | Минимальная версия | Примечание |
|------------|--------------------|-------------|
| Node.js | 20+ | LTS |
| npm | 10+ | Поставляется с Node.js |
| container runtime | — | Docker или Podman (для integration tests) |

Для запуска **integration tests** требуется:
- **Podman** (рекомендуется для Arch/Manjaro)
- **Docker** (для Linux/macOS)

---

## Установка и запуск

```bash
# Клонирование репозитория
git clone https://github.com/your-org/opencode-plugin-kafka.git
cd opencode-plugin-kafka

# Установка зависимостей
npm install

# Сборка TypeScript
npm run build
```

---

## Доступные команды

| Команда | Описание |
|---------|----------|
| `npm run lint` | ESLint проверка кода |
| `npm run typecheck` | TypeScript проверка типов (без компиляции) |
| `npm run test` | Unit тесты (vitest run) |
| `npm run test:coverage` | Unit тесты с покрытием кода |
| `npm run test:integration` | Integration тесты с реальным Redpanda контейнером |
| `npm run build` | Компиляция TypeScript в JavaScript |
| `npm run check` | lint + test (для pre-commit хуков) |
| `npm run format` | Prettier форматирование кода |

### Рекомендуемый порядок проверки

```bash
# Перед коммитом
npm run check

# Полная проверка с coverage
npm run typecheck && npm run test:coverage && npm run build
```

---

## Integration Tests

Integration тесты используют **Redpanda** (Kafka-совместимый брокер) вместо Apache Kafka для скорости (10-100x быстрее).

### С Podman (Arch/Manjaro)

```bash
# Разрешение linger для пользователя (запуск контейнеров без активной сессии)
loginctl enable-linger $(whoami)

# Запуск podman.socket
systemctl --user enable --now podman.socket

# Проверка доступности сокета
ls /run/user/$(id -u)/podman/podman.sock

# Запуск тестов
npm run test:integration
```

### С Docker (Linux/macOS)

```bash
# Установка переменной окружения (Linux)
export DOCKER_HOST=unix:///var/run/docker.sock

# Запуск тестов
npm run test:integration
```

### Troubleshooting

| Ошибка | Причина | Решение |
|--------|---------|----------|
| `Connection refused: podman.sock not found` | Podman socket не запущен | Запустите `systemctl --user start podman.socket` |
| `Connection refused: docker.sock not found` | Docker не запущен | Запустите Docker Desktop или dockerd |
| `Error: No such container: redpanda` | Контейнер не создался | Проверьте `podman ps -a` или `docker ps -a` |
| `Port already in use` | Порт занят другим процессом | Освободите порт или настройте другой в `vitest.integration.config.ts` |

---

## CI/CD Pipeline

### GitHub Actions Workflow

Файл: `.github/workflows/ci.yml`

#### Triggers

- **Push** в ветку `main`
- **Pull Request** в ветку `main`

#### Steps

1. **Checkout** — получение кода репозитория
2. **Setup Node.js** — установка Node.js 20 с кэшированием npm
3. **Install dependencies** — `npm ci` (точная установка из lock файла)
4. **Lint** — `npm run lint`
5. **Type check** — `npm run typecheck`
6. **Test** — `npm run test`
7. **Build** — `npm run build`

#### Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Отменяет предыдущий запущенный pipeline при новом push.

#### Ограничения

Integration тесты **НЕ включены** в CI, так как требуют container runtime (Docker/Podman), который не доступен в GitHub Actions hosted runners без дополнительной настройки.

### Integration Tests в CI

**Текущий статус**: Integration tests НЕ запускаются в CI pipeline.

**Причина**: GitHub Actions standard runners не имеют container runtime (Docker/Podman), необходимого для testcontainers.

**План**: Добавить integration tests в CI при настройке self-hosted runner с Podman (future phase).

**Запуск локально**: `npm run test:integration`

---

## Структура проекта

```
opencode-plugin-kafka/
├── src/                      # Исходный код
│   ├── core/                  # Core модули
│   │   ├── config.ts          # parseConfig (Zod валидация + FR-017)
│   │   ├── routing.ts         # matchRule (pure function)
│   │   ├── prompt.ts         # buildPrompt
│   │   └── index.ts          # Public API
│   ├── schemas/               # Zod схемы и типы
│   │   └── index.ts           # z.infer<> типы
│   └── index.ts               # Plugin entry point
├── tests/
│   ├── unit/                 # Unit тесты (быстрые, без зависимостей)
│   │   ├── config.test.ts    # Тесты parseConfig
│   │   ├── routing.test.ts   # Тесты matchRule
│   │   ├── prompt.test.ts   # Тесты buildPrompt
│   │   └── types-verification.test.ts
│   └── integration/          # Integration тесты (требуют Redpanda)
│       └── consumer.test.ts
├── .github/workflows/        # CI/CD конфигурация
│   └── ci.yml               # GitHub Actions workflow
├── package.json             # Зависимости и npm scripts
├── tsconfig.json            # TypeScript конфигурация
├── vitest.config.ts         # Vitest конфигурация (unit)
├── vitest.integration.config.ts # Vitest конфигурация (integration)
└── DEVELOPMENT.md           # Этот документ
```

---

## Coverage требования

**Минимальный порог**: 90% для всех метрик

| Метрика | Порог |
|---------|-------|
| Lines | 90% |
| Branches | 90% |
| Functions | 90% |
| Statements | 90% |

### Исключения

Из coverage **исключены** type-only файлы:
- `src/core/types.ts`
- `src/core/index.ts`

Эти файлы содержат только интерфейсы и re-exports — не имеют runtime кода.

### Запуск с coverage

```bash
# Unit тесты с coverage отчётом
npm run test:coverage
```

---

## Дополнительная информация

- [SPEC.md](./SPEC.md) — Полная спецификация проекта
- [AGENTS.md](./AGENTS.md) — Инструкции для агентов
- [README.md](./README.md) — Документация пользователя