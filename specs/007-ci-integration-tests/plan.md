# Implementation Plan: CI Integration Tests Pipeline

**Branch**: `007-ci-integration-tests` | **Date**: 2026-04-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-ci-integration-tests/spec.md`

## Summary

Добавить отдельный job `integration` в `.github/workflows/ci.yml` для автоматического запуска integration-тестов с Redpanda (testcontainers) на каждый PR и push в `main`. Job работает параллельно с существующим job `ci`. Также обновить устаревший комментарий в существующем job.

## Technical Context

**Language/Version**: TypeScript 6.x (ES2022, ESNext modules)
**Primary Dependencies**: GitHub Actions (actions/checkout@v4.2.2, actions/setup-node@v4.4.0), testcontainers-node + @testcontainers/redpanda
**Storage**: N/A
**Testing**: vitest (unit), vitest + testcontainers + Redpanda (integration)
**Target Platform**: GitHub Actions ubuntu-latest runner
**Project Type**: CI/CD pipeline configuration (YAML modification)
**Performance Goals**: Integration job таймаут 15 мин; фактическое выполнение 2-5 мин
**Constraints**: Pinned SHA для actions; параллельное выполнение без `needs`
**Scale/Scope**: 1 YAML файл (ci.yml), 1 скрипт в package.json (проверка)

## Constitution Check

*GATE: Must pass before implementation.*

| Принцип | Статус | Комментарий |
|---------|--------|-------------|
| I. Strict Initialization | ✅ Не затронут | Изменение CI pipeline, не конфигурация плагина |
| II. Domain Isolation | ✅ Не затронут | Не влияет на routing/consumer логику |
| III. Resiliency | ✅ Не затронут | Не влияет на error handling в consumer |
| IV. No-State Consumer | ✅ Не затронут | Не влияет на state management |
| V. Test-First Development | ✅ **Напрямую реализует** | Принцип требует: «All tests MUST run in CI/CD pipeline». Эта фича закрывает TODO по запуску integration-тестов в CI |

**Вердикт**: Нарушений нет. Фича напрямую реализует Принцип V конституции.

## Applicability of Standard Plan Artifacts

> **Внимание**: Данная фича является конфигурационным изменением CI pipeline (YAML). Многие стандартные артефакты плана неприменимы.

| Артефакт | Применимость | Обоснование |
|----------|-------------|-------------|
| `research.md` | ❌ НЕ НУЖЕН | Нет неизвестных. ТЗ содержит точную структуру YAML, pinned SHA, команды. Все технические решения уже приняты |
| `data-model.md` | ❌ НЕ ПРИМЕНИМ | Нет сущностей, нет данных, нет state. Изменяется только YAML конфигурация |
| `contracts/` | ❌ НЕ ПРИМЕНИМ | Нет внешних интерфейсов, API или публичных контрактов. CI pipeline — это infrastructure, не application |
| `quickstart.md` | ❌ НЕ ПРИМЕНИМ | Не пользовательская фича. CI pipeline запускается автоматически, не требует руководства по запуску |

**Обоснование пропуска Phase 0 и Phase 1**: Фича не вводит новый код, данные или интерфейсы — только добавляет job в существующий CI YAML и обновляет комментарий. Все технические решения зафиксированы в ТЗ и спецификации.

## Project Structure

### Documentation (this feature)

```text
specs/007-ci-integration-tests/
├── spec.md              # Спецификация фичи
├── plan.md              # Этот файл — план реализации
├── checklists/
│   └── requirements.md  # Чеклист качества спецификации
└── tasks.md             # Фаза 2 — задачи для реализации (/speckit.tasks)
```

### Source Code (repository root)

```text
.github/
└── workflows/
    └── ci.yml           # ← Основной файл для изменения

package.json              # ← Проверка наличия скрипта test:integration

tests/
└── integration/          # ← Существующие integration-тесты (не изменяются)
    └── kafka-opencode.integration.test.ts

vitest.integration.config.ts  # ← Существующая конфигурация (не изменяется)
```

**Structure Decision**: Single YAML file modification. No new files created except spec documentation. The `test:integration` script already exists in `package.json`.

## Implementation Steps

### Шаг 1: Проверить `package.json` — скрипт `test:integration`

**Действие**: Убедиться что скрипт `"test:integration": "vitest run --config vitest.integration.config.ts"` присутствует.

**Ожидаемый результат**: Скрипт уже существует (подтверждено при создании spec). Если нет — добавить.

**Файлы**: `package.json`

### Шаг 2: Добавить job `integration` в `ci.yml`

**Действие**: Добавить новый job `integration` после существующего job `ci`. Использовать те же pinned SHA.

**Структура job**:
- `runs-on: ubuntu-latest`
- `timeout-minutes: 15`
- Steps: checkout → setup-node → npm ci → npm run test:integration
- Pinned SHA: checkout@`11bd71901bbe5b1630ceea73d27597364c9af683`, setup-node@`49933ea5288caeca8642d1e84afbd3f7d6820020`

**Ключевые ограничения**:
- НЕ добавлять `needs: [ci]` — jobs параллельны
- НЕ менять триггеры — используются глобальные из `on:` секции
- НЕ добавлять Docker Compose — testcontainers работает автоматически

**Файлы**: `.github/workflows/ci.yml`

### Шаг 3: Обновить комментарий в job `ci`

**Действие**: Заменить устаревший TODO-комментарий (3 строки) над шагом `Test` на краткий актуальный комментарий.

**Было** (3 строки):
```yaml
# Integration tests не запускаются в CI — требуют container runtime (Docker/Podman)
# Запускаются локально: npm run test:integration
# TODO: Добавить integration tests в CI при настройке self-hosted runner с Podman
```

**Стало** (1 строка):
```yaml
# Unit tests only — integration tests run in the separate 'integration' job
```

**Файлы**: `.github/workflows/ci.yml`

### Шаг 4: Валидация

**Действие**: Проверить что YAML валиден и структура корректна.

**Проверки**:
- `npm run lint` — lint проходит (YAML не проверяется линтером, но проект должен собираться)
- `npm run typecheck` — типы корректны
- `npm run build` — сборка успешна
- YAML валидация — визуальная проверка структуры

## Complexity Tracking

Нет нарушений конституции. Нет необходимости в обосновании сложности.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
```