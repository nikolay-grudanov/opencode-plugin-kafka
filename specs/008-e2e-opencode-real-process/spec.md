# Feature Specification: E2E-тесты с реальным OpenCode-процессом

**Feature Branch**: `008-e2e-opencode-real-process`  
**Created**: 2026-04-28  
**Status**: Draft  
**Input**: "Добавить E2E-тесты, которые проверяют полный путь: Kafka message → plugin → OpenCodeAgentAdapter → opencode serve → Lemonade LLM → responseTopic/DLQ. Тесты не запускаются в CI на каждый PR — только вручную или через workflow_dispatch."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Happy Path: сообщение проходит полный конвейер (Priority: P1)

Как разработчик, я хочу убедиться, что валидное Kafka-сообщение проходит через весь конвейер (Kafka → routing → агент → LLM → response topic) и возвращается осмысленный ответ. Это основной сценарий, подтверждающий работоспособность всей цепочки.

**Why this priority**: Это минимальный жизнеспособный сценарий. Если он не работает — ничего другого тестировать нет смысла. Проверяет интеграцию всех компонентов end-to-end.

**Independent Test**: Можно полностью протестировать, отправив сообщение в Kafka-топик и проверив, что ответ появился в responseTopic с корректной структурой (status, response, sessionId, ruleName).

**Acceptance Scenarios**:

1. **Given** запущены Redpanda и opencode serve, **When** в input-топик отправляется сообщение `{ task: "What is 2+2?" }`, **Then** в responseTopic появляется сообщение со status `success`, непустым текстовым ответом, заполненными `sessionId` и `ruleName`
2. **Given** правило `e2e-echo-rule` с `jsonPath: '$.task'`, **When** сообщение содержит поле `task`, **Then** правило срабатывает и агент получает промпт, сгенерированный из `promptTemplate`

---

### User Story 2 — Routing: JSONPath-фильтрация (Priority: P1)

Как разработчик, я хочу убедиться, что routing-правила корректно фильтруют сообщения: совпадающие обрабатываются агентом, несовпадающие — тихо пропускаются без вызова агента.

**Why this priority**: Routing — ключевая логика плагина. E2E-проверка подтверждает, что Domain Isolation работает в реальном окружении: pure function routing корректно взаимодействует с Kafka consumer.

**Independent Test**: Можно протестировать, отправив два сообщения — одно совпадающее с JSONPath-фильтром, другое нет, и проверив, что только первое вызвало ответ.

**Acceptance Scenarios**:

1. **Given** правило с `jsonPath: '$.type[?(@=="question")]'`, **When** отправляется сообщение `{ type: "notification", content: "hello" }`, **Then** сообщение пропускается (skip), ответ не появляется в responseTopic
2. **Given** то же правило, **When** отправляется сообщение `{ type: "question", content: "What color is the sky?" }`, **Then** правило срабатывает, агент вызывается, ответ появляется в responseTopic со status `success`

---

### User Story 3 — JSONPath field extraction: извлечение вложенных полей (Priority: P2)

Как разработчик, я хочу убедиться, что JSONPath корректно извлекает вложенные поля из сообщения и подставляет их в promptTemplate, что агент получает осмысленный контекст и отвечает релевантно.

**Why this priority**: Проверяет корректность сборки промпта через buildPromptV003 в реальных условиях. Не-MVP, но важен для уверенности в quality routing logic.

**Independent Test**: Отправить сообщение с вложенной структурой данных и проверить, что ответ агента содержит релевантные ключевые слова, подтверждающие правильную обработку контекста.

**Acceptance Scenarios**:

1. **Given** правило с `jsonPath: '$.data.query'` и `promptTemplate: 'Context: {{$.data.context}} Question: {{value}}'`, **When** отправляется сообщение с вложенным объектом `{ data: { query: "What is TypeScript?", context: "Programming languages discussion" } }`, **Then** ответ агента содержит релевантные ключевые слова (например, "typescript", "language", "programming")

---

### User Story 4 — Agent timeout: сообщение уходит в DLQ (Priority: P1)

Как разработчик, я хочу убедиться, что при превышении таймаута агент-вызова сообщение корректно попадает в Dead Letter Queue, а не теряется и не крашит consumer.

**Why this priority**: Resiliency — один из 5 конституционных принципов. E2E-подтверждение критично: timeout handling должен работать в реальном окружении, а не только в unit-тестах.

**Independent Test**: Установить заведомо малый timeoutMs (100ms), отправить сообщение и проверить, что оно появилось в DLQ с описанием ошибки timeout.

**Timeout Simulation Strategy**: Используется заведомо малый `timeoutMs: 100` с реальным LLM через Lemonade. LLM физически не может ответить за 100ms, что гарантирует timeout. Не требуется mock-агент — это тестирует реальный путь timeout handling в consumer.

**Acceptance Scenarios**:

1. **Given** правило с `timeoutMs: 100` (заведомо мало для реального LLM), **When** отправляется сообщение с полем `task`, **Then** сообщение появляется в DLQ-топике с `originalTopic: 'e2e-input'` и `error`, содержащим "timeout"
2. **Given** тот же сценарий, **Then** consumer продолжает работу после timeout — не крашится

---

### User Story 5 — Минимальный ответ: не DLQ (Priority: P2)

Как разработчик, я хочу убедиться, что пустой или очень короткий ответ LLM считается успешным — сообщение попадает в responseTopic, а не в DLQ.

**Why this priority**: Гарантирует, что плагин не завышает требования к ответу агента. Короткий ответ — это валидный ответ.

**Independent Test**: Отправить сообщение с промптом, провоцирующим минимальный ответ ("ok"), и проверить success-статус и отсутствие в DLQ.

**Acceptance Scenarios**:

1. **Given** правило с prompt-шаблоном "Reply with the single word ok", **When** отправляется сообщение, **Then** ответ в responseTopic имеет status `success`, response — непустая строка
2. **Given** тот же сценарий, **Then** DLQ-топик остаётся пустым (нет ложных срабатываний)

---

### User Story 6 — Fire-and-forget: нет responseTopic (Priority: P2)

Как разработчик, я хочу убедиться, что правило без responseTopic корректно вызывает агента, но не отправляет ответ ни в какой топик и не создаёт DLQ-запись при успехе.

**Why this priority**: Подтверждает optional nature responseTopic — плагин должен работать в fire-and-forget режиме без побочных эффектов.

**Independent Test**: Настроить правило без responseTopic, отправить сообщение, подождать и проверить, что response topic и DLQ пусты.

**Acceptance Scenarios**:

1. **Given** правило без `responseTopic`, **When** отправляется сообщение в отдельный fire-forget топик, **Then** response topic и DLQ остаются пустыми — агент вызван, но ответ нигде не сохранён

---

### User Story 7 — Invalid Kafka message: consumer не крашится (Priority: P1)

Как разработчик, я хочу убедиться, что malformed JSON в Kafka-сообщении не крашит consumer, а корректно отправляется в DLQ с описанием ошибки parse.

**Why this priority**: Resiliency — конституционный принцип #3. E2E-подтверждение что consumer не падает на невалидных данных — критично.

**Independent Test**: Отправить невалидный JSON (не-JSON строку) в input-топик, проверить что consumer продолжает работу и DLQ содержит ошибку parse.

**Acceptance Scenarios**:

1. **Given** запущены Redpanda и opencode serve, **When** в input-топик отправляется невалидный JSON (например, "not a json"), **Then** сообщение попадает в DLQ с error содержащим "parse" или "JSON", consumer продолжает работу
2. **Given** тот же сценарий, **When** после невалидного сообщения отправляется валидное, **Then** валидное сообщение обрабатывается корректно — consumer не остановился

---

### User Story 8 — Consumer recovery после ошибки (Priority: P2)

Как разработчик, я хочу убедиться, что consumer корректно обрабатывает серию ошибок и продолжает работу — не теряет offset, не крашится.

**Why this priority**: Подтверждает Resiliency (III) и No-State Consumer (IV) — consumer не накапливает состояние при ошибках.

**Independent Test**: Отправить серию: невалидное → валидное → невалидное → валидное, проверить что все валидные обработаны, все невалидные в DLQ.

**Acceptance Scenarios**:

1. **Given** запущены Redpanda и opencode serve, **When** отправляется серия из 4 сообщений (invalid→valid→invalid→valid), **Then** 2 валидных обработаны с success, 2 невалидные в DLQ, consumer продолжает работу

---

### Edge Cases

- Что происходит, если порт opencode serve уже занят? → Тест должен упасть с понятной ошибкой до начала (не зависать)
- Что происходит, если Lemonade не запущен? → `spawnOpenCodeServe` падает на `/health` check с понятной диагностикой
- Что происходит, если Redpanda контейнер не стартует? → `beforeAll` падает с ошибкой testcontainers
- Что происходит, если агент отвечает быстрее timeout? → Ответ корректно попадает в responseTopic
- Что происходит при конкурентных сообщениях? → Consumer обрабатывает последовательно (concurrency: 1)
- Invalid JSONPath expression в правиле → невалидный route → silent skip или error handling
- Empty LLM response ("") → не должен падать в DLQ
- Что происходит при DLQ message с невалидной схемой? → DLQ envelope должен содержать минимум: originalTopic, error, timestamp, originalMessage
- Что происходит если consumer перезапускается между сообщениями? → Offset сохраняется, обработанные сообщения не дублируются (consumer group commitment)
- Что происходит при очень большом сообщении (>1MB)? → Consumer отклоняет с ошибкой размера, сообщение не теряется
- Что происходит если responseTopic не существует? → Producer падает с TopicNotFoundException, ошибка логируется, consumer продолжает
- Что происходит при null message value (tombstone)? → Consumer пропускает tombstone, не вызывает агента
- Что происходит если Lemonade отвечает с HTTP 500? → OpenCodeAgentAdapter возвращает error, сообщение попадает в DLQ
- Что происходит при concurrent produce из теста? → Consumer обрабатывает последовательно (concurrency: 1), порядок сохраняется
- Что происходит если opencode serve упал mid-processing? → Agent invoke падает с network error, сообщение попадает в DLQ, consumer продолжает

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Тестовая инфраструктура ДОЛЖНА поднимать Redpanda через testcontainers для каждого прогона E2E-тестов
- **FR-002**: Тестовая инфраструктура ДОЛЖНА спавнить изолированный процесс `opencode serve` на отдельном порту, независимый от TUI-сессии пользователя
- **FR-003**: Тестовая инфраструктура ДОЛЖНА проверять доступность порта перед spawn — если порт занят, тест падает с понятной ошибкой
- **FR-004**: Тестовая инфраструктура ДОЛЖНА корректно останавливать opencode serve после тестов (SIGTERM → SIGKILL fallback)
- **FR-005**: Каждый тест ДОЛЖЕН использовать уникальный consumer group ID (суффикс `Date.now()`) для предотвращения конкуренции за offset
- **FR-006**: Consumer для проверки результатов ДОЛЖЕН читать только новые сообщения (`fromBeginning: false`)
- **FR-007**: В проектном конфиге `.opencode/opencode.json` ДОЛЖЕН быть добавлен агент `e2e-responder` с model lemonade и ограниченными permissions
- **FR-008**: E2E-тесты НЕ ДОЛЖНЫ запускаться в CI на каждый PR — только вру��ную (`npm run test:e2e`) или через `workflow_dispatch`
- **FR-009**: Глобальный конфиг пользователя (`~/.config/opencode/opencode.json`) НЕ ДОЛЖЕН модифицироваться тестами. Тест ДОЛЖЕН проверять это через snapshot: сохранить хэш файла до и после тестового прогона — хэши должны совпадать
- **FR-010**: Тестовая инфраструктура ДОЛЖНА создавать все необходимые Kafka-топики до начала тестов
- **FR-011**: `afterAll` ДОЛЖЕН безусловно вызывать cleanup (kill opencode serve, stop Redpanda) — даже если тесты упали
- **FR-012**: E2E-тесты ДОЛЖНЫ работать в sequential режиме (single fork) — один процесс, одна очередь
- **FR-013**: Consumer ДОЛЖЕН корректно обрабатывать невалидный JSON и отправлять в DLQ с описанием ошибки

### Key Entities

- **E2E Test Configuration**: Конфигурация Vitest для E2E (timeout 120s, hook timeout 60s, sequential execution, переменные окружения)
- **OpenCode Process Handle**: Дескриптор управляемого процесса `opencode serve` (baseURL, kill-метод)
- **Plugin Runner**: Обёртка для запуска consumer в контексте теста с управлением lifecycle (start/stop)
- **Kafka Test Utilities**: Набор функций для работы с Kafka в тестах (createTopics, produceMessage, consumeOneMessage)
- **E2E Responder Agent**: Специализированный тестовый агент с предсказуемым поведением (короткие ответы, без инструментов)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Все 8 E2E-тестов (T-E2E-001..008) проходят успешно при наличии работающего Lemonade и Docker/Podman
- **SC-002**: Каждый тест завершается в пределах своего таймаута (базовый 90s, timeout-тест 60s)
- **SC-003**: Процесс `opencode serve` гарантированно останавливается после завершения тестов — `afterAll` проверяет через `lsof -i :PORT` или PID check что порт свободен. При обнаружении zombie — force kill через `SIGKILL` и логирование в stderr
- **SC-004**: Тесты можно запустить одной командой (`npm run test:e2e`) без дополнительной настройки, при наличии предустановленных Lemonade и Docker
- **SC-005**: Результаты тестов воспроизводимы — 3 последовательных прогона дают одинаковый outcome (pass/fail) для каждого теста. Допускается вариация в тексте LLM-ответа, но не в статусе (success/error/timeout)
- **SC-006**: Команда `npm run test:e2e` не влияет на существующие тесты (`npm test`, `npm run test:integration`) — отдельный Vitest-конфиг

## Assumptions

- Lemonade LLM-сервер запущен на `http://localhost:13305` до начала тестов — это ручное предусловие, не автоматизируемое
- Провайдер lemonade настроен в глобальном конфиге `~/.config/opencode/opencode.json` — агент не модифицирует этот конфиг
- Docker или Podman доступен для запуска Redpanda через testcontainers
- `opencode` CLI доступен в PATH для spawn процесса `opencode serve`
- Порт 3001 свободен во время E2E-тестов (или настраиваемый через `OPENCODE_E2E_PORT`)
- Тесты запускаются на self-hosted runner (GitHub Actions) с предустановленным Lemonade
- LLM-модель отвечает достаточно предсказуемо для проверки routing logic (низкий temperature, простой prompt)