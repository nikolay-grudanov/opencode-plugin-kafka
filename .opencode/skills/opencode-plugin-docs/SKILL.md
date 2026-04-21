---
name: opencode-plugin-docs
description: Справочник по созданию плагинов OpenCode на JavaScript/TypeScript. Содержит полную документацию по структуре плагинов, событиям, хукам, custom tools, зависимостям, примерам кода и архитектурным решениям plugin vs custom tool. Загружай этот skill перед написанием, отладкой или рефакторингом любого OpenCode plugin.
---

# OpenCode Plugin Development Reference

## Что такое плагин OpenCode

Плагин — это **JS/TS-модуль**, который экспортирует одну или несколько plugin-функций.
Каждая функция получает объект контекста и возвращает объект с хуками (hooks).

Плагины позволяют:
- подписываться на события OpenCode (file, session, tool, permission, shell и др.);
- добавлять custom tools;
- изменять поведение компактизации сессии;
- интегрироваться с внешними сервисами.

Документация: https://opencode.ai/docs/plugins/

***

## Расположение файлов

| Уровень | Путь |
|---|---|
| Локальный (проект) | `.opencode/plugins/` |
| Глобальный | `~/.config/opencode/plugins/` |

Файлы загружаются автоматически при старте OpenCode.

### Порядок загрузки
1. Глобальная конфигурация `~/.config/opencode/opencode.json`
2. Конфигурация проекта `opencode.json`
3. Глобальный каталог плагинов `~/.config/opencode/plugins/`
4. Каталог плагинов проекта `.opencode/plugins/`

***

## Загрузка плагинов из npm

В `opencode.json`:
```json
{
  "plugins": [
    "opencode-plugin-name",
    "@scope/opencode-plugin-name"
  ]
}
```

npm-плагины устанавливаются через Bun автоматически при запуске.
Кэш: `~/.cache/opencode/node_modules/`

***

## Базовая структура плагина

```typescript
import type { Plugin } from "opencode-plugin";

export default function myPlugin(context) {
  // context содержит:
  // context.project   — информация о проекте
  // context.directory — текущий рабочий каталог
  // context.worktree  — путь к git worktree
  // context.client    — OpenCode SDK client
  // context.$         — Bun shell API

  return {
    // хуки — подписки на события
  };
}
```

### TypeScript-типы
```typescript
import type { Plugin } from "opencode-plugin";

const plugin: Plugin = (context) => {
  return {};
};

export default plugin;
```

***

## Зависимости (npm в локальных плагинах)

Создай `package.json` в каталоге конфигурации:

```json
{
  "dependencies": {
    "some-package": "^1.0.0"
  }
}
```

OpenCode запустит `bun install` при старте. После этого можно импортировать пакеты в плагинах и custom tools.

***

## Все события (Events)

### Командные события
- `command.executed`

### Файловые события
- `file.edited`
- `file.watcher.updated`

### События установки
- `installation.updated`

### LSP события
- `lsp.client.diagnostics`
- `lsp.updated`

### События сообщений
- `message.part.removed`
- `message.part.updated`
- `message.removed`
- `message.updated`

### События разрешений
- `permission.asked`
- `permission.replied`

### Серверные события
- `server.connected`

### События сессии
- `session.created`
- `session.compacted`
- `session.deleted`
- `session.diff`
- `session.error`
- `session.idle`
- `session.status`
- `session.updated`

### Todo события
- `todo.updated`

### Shell события
- `shell.env`

### Tool события
- `tool.execute.before`
- `tool.execute.after`

### TUI события
- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

***

## Примеры хуков

### Уведомления (macOS)
```typescript
export default function notifyPlugin({ $ }) {
  return {
    "session.idle": async () => {
      await $`osascript -e 'display notification "OpenCode завершил задачу"'`;
    },
  };
}
```

### Защита .env (блокировка чтения)
```typescript
export default function envGuard() {
  return {
    "permission.asked": async ({ tool, args }) => {
      if (tool === "read" && args?.path?.includes(".env")) {
        return { deny: true };
      }
    },
  };
}
```

### Инъекция переменных окружения
```typescript
export default function envInject() {
  return {
    "shell.env": async () => {
      return {
        MY_VAR: "my_value",
        NODE_ENV: "development",
      };
    },
  };
}
```

### Хук компактизации сессии
```typescript
export default function compactPlugin() {
  return {
    "experimental.session.compacting": async ({ context }) => {
      return {
        context: [
          ...context,
          { role: "user", content: "Дополнительный контекст для компактизации." },
        ],
      };
    },
  };
}
```

Полная замена промпта компактизации:
```typescript
export default function compactPlugin() {
  return {
    "experimental.session.compacting": async () => {
      return {
        prompt: "Кастомный промпт для компактизации сессии.",
      };
    },
  };
}
```

### Логирование (правильный способ)
```typescript
export default function logPlugin({ client }) {
  return {
    "tool.execute.before": async ({ tool, args }) => {
      client.app.log("info", `Tool called: ${tool}`, { args });
    },
  };
}
```

Уровни логов: `debug`, `info`, `warn`, `error`.
Используй `client.app.log()` вместо `console.log`.

***

## Custom Tools внутри плагина

Плагины могут добавлять custom tools через хелпер `tool`:

```typescript
import { tool } from "opencode-plugin";
import { z } from "zod";

export default function myPlugin({ client }) {
  return {
    tools: [
      tool({
        description: "Возвращает текущее время",
        args: z.object({}),
        execute: async () => {
          return new Date().toISOString();
        },
      }),
    ],
  };
}
```

Параметры `tool()`:
- `description` — что делает инструмент (обязательно, конкретно и action-oriented)
- `args` — Zod-схема аргументов
- `execute` — функция выполнения

***

## Custom Tools (отдельные файлы)

Кроме плагинов, инструменты можно определять отдельно в `.opencode/tools/` или `~/.config/opencode/tools/`.

Документация: https://opencode.ai/docs/custom-tools/

```typescript
// .opencode/tools/database.ts
import { tool } from "opencode";
import { z } from "zod";

export default tool({
  description: "Query the database",
  args: z.object({
    query: z.string().describe("SQL query to execute"),
  }),
  execute: async ({ query }, context) => {
    // context.directory — рабочая директория
    // context.worktree  — git worktree
    return `Result: ${query}`;
  },
});
```

Несколько инструментов в файле:
```typescript
// .opencode/tools/math.ts
export const add = tool({
  description: "Add two numbers",
  args: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a + b,
});

export const multiply = tool({
  description: "Multiply two numbers",
  args: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a * b,
});
// Создаёт инструменты: math_add и math_multiply
```

***

## Plugin vs Custom Tool — когда что использовать

| Нужно | Решение |
|---|---|
| Перехватить событие (file, session, tool, permission) | Plugin + hook |
| Добавить функцию для вызова LLM без lifecycle | Custom Tool |
| Несколько инструментов с общим состоянием/клиентом | Plugin с tools[] |
| Простой вызов внешнего скрипта/CLI | Custom Tool |
| Реагировать на изменение файлов | Plugin + `file.edited` |
| Внедрить ENV для всех shell-процессов | Plugin + `shell.env` |
| Блокировать/изменять tool вызовы | Plugin + `tool.execute.before` |

***

## Bun Shell API ($)

Доступен в контексте плагина как `context.$`:

```typescript
export default function myPlugin({ $ }) {
  return {
    "session.idle": async () => {
      const result = await $`echo "Hello from shell"`;
      return result.stdout;
    },
  };
}
```

***

## Архитектурные правила

1. **Не смешивай** hook wiring, business logic и shell side-effects в одной функции.
2. **Явно описывай** все side-effects (filesystem, network, shell).
3. **Не переопределяй** встроенные tools без явной причины.
4. **Используй** `client.app.log()` для логирования, не `console.log`.
5. **Называй** tools коротко и action-oriented.
6. **Разделяй** плагины по ответственности — один плагин, одна задача.
7. **Используй TypeScript** для типобезопасности и автодополнения.

***

## Экосистема и примеры сообщества

- Экосистема плагинов: https://opencode.ai/docs/ecosystem/
- Примеры плагинов: https://opencode.ai/docs/plugins/#examples

***

## SDK-документация

- SDK overview: https://opencode.ai/docs/sdk
- Plugin types: импортируй из `opencode-plugin`
- Bun Shell: https://bun.sh/docs/runtime/shell

***

## Ключевые ссылки

- Документация плагинов: https://opencode.ai/docs/plugins/
- Custom tools: https://opencode.ai/docs/custom-tools/
- Agents docs: https://opencode.ai/docs/agents/
- Skills docs: https://opencode.ai/docs/skills/
- Permissions: https://opencode.ai/docs/permissions/
- Ecosystem: https://opencode.ai/docs/ecosystem/
- GitHub OpenCode: https://github.com/opencode-ai/opencode