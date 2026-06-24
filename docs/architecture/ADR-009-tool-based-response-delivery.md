# ADR-009: Tool-Based Response Delivery — замена polling на event-driven hook + custom tool

## Статус

**Принято** — 2026-06-24. Реализация: spec-009-tool-based-response-delivery.

**Supersedes** (частично): ADR-005 (Event Hooks) §"Вариант 1: session.idle hook" и §"Принятое решение — НЕ использовать event hooks". Ранее отвергнутые варианты пересмотрены в свете новой информации (live debug 2026-06-24 обнаружил официальный `@opencode-ai/plugin` v1.16.2).

## Контекст

Спецификации 003 (kafka-consumer), 005 (ci-integration), 006 (opencode-sdk-integration) и 008 (e2e-opencode-real-process) построены на архитектуре **synchronous blocking polling**:

1. Kafka consumer принимает сообщение
2. `OpenCodeAgentAdapter.invoke()` создаёт OpenCode сессию, вызывает `session.prompt()`
3. **Polling loop** 30 секунд дёргает `session.messages()` пытаясь найти `role: 'assistant'` сообщение
4. Если нашёл — публикует в response topic. Если нет — TimeoutError → DLQ
5. Offset коммитится

Проблема обнаружена 2026-06-24 при живой отладке (`opencode web` + реальная Kafka):

- **Polling хронически не находит ответ** даже когда LLM корректно отработала (видны `stream providerID=...` → `exiting loop`). 5 из 8 e2e тестов упали именно с `No response received after 30 polling attempts`.
- **Latency взрыв**: каждое Kafka сообщение блокирует consumer минимум на 30s, даже если LLM ответила за 5s. Throughput ≤ 2 msg/min на один partition.
- **Скрытая бага #3** (DLQ topic mismatch — `dlq.ts:106` пишет в `opencode.prompts-dlq` вместо `opencode.dlq`) была **скрыта** именно потому что polling падал раньше, чем DLQ пытался что-то записать. Полировка polling-механики без смены архитектуры только усугубит положение — нужны будут ещё более длинные таймауты, и ошибка проявится с другой стороны.

Корень причины: ADR-005 §Вариант 1 отверг `session.idle` hook в 2026-04-23 со словами *"Очень сложная координация состояния"*, *"Нарушает No-State Consumer принцип"*. Это было **обоснованное решение для OpenCode SDK, который на тот момент не предоставлял plugin API**. ADR-006 §5 закрепил это как "НЕ использовать event hooks (пустой объект hooks)".

## Новый факт: `@opencode-ai/plugin` v1.16.2

Live debugging 2026-06-24 обнаружил, что OpenCode CLI 1.17.9 несёт встроенный npm-пакет `@opencode-ai/plugin@1.16.2` (расположен в `/home/gna/.npm-global/lib/node_modules/@opencode-ai/plugin/`). Этот пакет предоставляет **официальный plugin API**, который мы ранее не использовали. Ключевые возможности (цитаты из `dist/index.d.ts`):

```typescript
// Event bus (строки 175-177)
event?: (input: { event: Event }) => Promise<void>
// где Event — union из 30+ типов включая:
//   "session.idle"          { sessionID: string }
//   "message.part.updated"  { part: Part; delta?: string }
//   "message.updated"       { info: Message }
//   "session.error"         { sessionID: string; error?: ... }

// Custom tools (строки 179-181)
tool?: { [key: string]: ToolDefinition }
// где ToolDefinition (из dist/tool.d.ts):
//   tool({ description, args: ZodSchema, execute(args, ctx) })

// Экспериментальный hook для перехвата готового текста (строки 306-312)
"experimental.text.complete"?: (input: {
    sessionID: string; messageID: string; partID: string;
}, output: { text: string }) => Promise<void>
```

Этот API меняет картину:

1. **Нет polling** — `session.idle` event сигнализирует "сессия завершила работу". Никаких 30-секундных циклов.
2. **Нет state mapping Kafka↔session** — каждое Kafka сообщение по-прежнему создаёт **новую** сессию (Constitution IV сохранён), и OpenCode сам присылает `session.idle` для неё. Tool registration привязывается к моменту boot плагина, а не к сообщению.
3. **Custom tool даёт агенту явный контроль** — LLM сам решает когда ответ готов и вызывает `send_to_kafka(response)`. Это снимает race condition "polling пропустил момент стрима".

## Рассмотренные альтернативы

### Вариант 1: Оставить polling, починить race conditions (отвергнут)

**Описание**: Исправить `pollForResponse()` чтобы он читал `session.messages()` чаще (каждые 100ms), начинал polling **до** `session.prompt()` чтобы не пропустить момент стрима, и использовал `event-message-part-updated` через SDK SSE-клиент вместо polling.

**Плюсы**:
- Минимальные изменения в коде
- Не требует новых зависимостей

**Минусы**:
- Корень архитектуры остаётся прежним — синхронный blocking
- Latency floor остаётся ≥ время стрима LLM + overhead polling
- Race conditions не устраняются принципиально — просто становятся реже
- DLQ topic mismatch (bug #3) остаётся скрытым
- ADR-005 останется формально верным, но фактически workaround-ом для несуществующей проблемы

**Вердикт**: Не решает проблему, отложенная техдолговая бомба.

### Вариант 2: Tool-based response delivery (ВЫБРАН)

**Описание**: Plugin регистрирует один custom tool per rule (FR-1 из spec-009). На каждое Kafka сообщение создаётся новая сессия (без изменений), `session.prompt()` отправляет промпт с явным указанием вызвать `send_to_kafka(response)` когда ответ готов. LLM вызывает tool, tool handler публикует в response topic. Параллельно plugin подписан на `event: "session.idle"` — если tool не вызван за `safetyNetTimeoutMs` → DLQ.

**Плюсы**:
- Устраняет polling и связанный 30s latency floor
- Устраняет race conditions (LLM явно сигналит "ответ готов")
- Агент контролирует момент ответа (может досрочно завершить, может продолжить думать)
- Multi-turn готов архитектурно (можно добавить tool "lookup_next_kafka_message" в следующей спеке)
- Surface'ит баг #3 (DLQ topic) — без polling DLQ становится primary error path
- Соответствует Constitution IV: state per-session в closure, не в module-level Map
- Backwards compat: existing `kafka-router.json` configs работают с дефолтами из FR-3

**Минусы**:
- Требует OpenCode ≥ 1.16 (сейчас в проде 1.17.9 — ок)
- LLM может забыть вызвать tool — нужен safety net (US2)
- `experimental.text.complete` помечен experimental — риск слома в будущем, использовать только как fallback

**Вердикт**: Единственный вариант, который **устраняет** корень проблемы, а не его симптомы.

### Вариант 3: Гибрид — polling + tool (отвергнут)

**Описание**: Регистрировать tool, но если tool не вызван за 5 секунд — fallback на polling.

**Плюсы**:
- Совместимость с LLM, которые не вызывают tool
- Latency floor меньше чем 30s

**Минусы**:
- Двойная кодовая база для одного и того же результата
- Polling остаётся — race conditions тоже
- Усложняет тестирование (два пути → 2x тестов)
- Не устраняет bug #3

**Вердикт**: Компромисс, который не даёт преимуществ ни одного варианта.

## Принятое решение

**Вариант 2: Tool-based response delivery.** Реализация — spec-009.

**Пересмотр ADR-005**: Вариант 1 "session.idle hook" изначально отвергнут по причине "сложная координация состояния". С появлением `@opencode-ai/plugin` v1.16.2 эта координация становится **бесплатной**: `event` hook доставляет события с уже готовым `sessionID`, и per-session closure для state (FR-4) живёт только в обработчике одного события, не в module-level Map. ADR-005 §"Принятое решение" остаётся верным для **исходного контекста** (отсутствие plugin API), но неприменимо к текущему OpenCode 1.17.9.

**Пересмотр ADR-006 §5** (Event Hooks: НЕ используем): отменяется. Plugin теперь возвращает `Hooks = { event, tool, 'session.error' }` — три hook'а вместо одного.

**Пересмотр Constitution Principle IV (No-State Consumer)**: остаётся в силе без изменений. Per-session state (FR-4 spec-009) живёт в closure, не в module scope; живёт ≤ `maxSessionMs` (default 300s); удаляется после `session.idle` или timeout. Это **scoped ephemeral state**, не "stateful consumer". Если в будущем потребуется cross-session state (multi-turn Kafka), это будет **отдельный spec** с явным обоснованием нарушения принципа.

## Следствия

### Положительные

1. **Latency** — с 30s+ до времени стрима LLM + ~100ms (tool execution).
2. **Throughput** — теоретически ×N где N = среднее количество сообщений, обрабатываемых за время одного стрима (зависит от LLM).
3. **Reliability** — bug #3 (DLQ topic) становится видимым и чинится в spec-009 FR-3.
4. **Расширяемость** — multi-turn Kafka, message lookup, streaming deltas — всё становится тривиальным расширением через дополнительные tools.
5. **Соответствие официальному API** — используем то, для чего OpenCode 1.16+ плагины и проектировались.
6. **Соответствие Constitution IV** — через scoped ephemeral state в closure.

### Отрицательные

1. **LLM может забыть вызвать tool** — нужен safety net (US2 spec-009). Mitigated by `requireToolCall: true` default + DLQ fallback.
2. **Зависимость от OpenCode SDK ≥ 1.16** — старые версии OpenCode не загрузят tool hooks. Mitigated NFR-1 fallback to polling для старых SDK.
3. **`experimental.text.complete` помечен experimental** — может исчезнуть. Mitigated: US2 `fallbackToTextCapture: true` опционален; без него работаем только с tool calls.

### Несовместимости

- **Backward compat с kafka-router.json**: сохранена (NFR-3). Старые конфиги работают с дефолтами.
- **Backward compat с OpenCode < 1.16**: graceful degradation — plugin логирует warning и работает в polling mode.
- **Несовместимость с spec-008 e2e тестами**: да, требуется переписать тесты (это часть spec-009 US4).

## Реализация

Главные файлы:
- `src/opencode/tool-handler.ts` (новый) — `createSendToKafkaTool(rule, producer)`, возвращает `ToolDefinition`.
- `src/opencode/OpenCodeAgentAdapter.ts` (правка) — убрать `pollForResponse()`, `invoke()` становится тонкой обёрткой.
- `src/kafka/dlq.ts:106` (правка) — брать DLQ topic из `parsedConfig.dlqTopic` а не из env.
- `src/index.ts` (правка) — возвращать `Hooks = { tool: {...}, event: handleSessionEvent, 'session.error': ... }`.
- `src/schemas/index.ts` (правка) — добавить `requireToolCall`, `fallbackToTextCapture`, `safetyNetTimeoutMs`, `maxSessionMs` в `RuleV003Schema`.
- `tests/unit/opencode/tool-handler.test.ts` (новый) — ≥90% coverage.
- `tests/e2e/helpers/perTestTopics.ts` (новый) — per-test DLQ топики.

Полный план в `specs/009-tool-based-response-delivery/plan.md` (после `/speckit.plan`).

## Когда НЕ применять это решение

Если OpenCode SDK упадёт ниже 1.16 — откатить на polling mode (NFR-3 fallback). Этот случай должен быть покрыт в graceful-degradation handler.

Если в будущем OpenCode введёт нативный синхронный `session.promptAndWait()` API — пересмотреть ADR-009 в пользу этого API.