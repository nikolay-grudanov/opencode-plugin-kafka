# Quickstart: 002-core-refinements — Type System Update

## Overview

После рефакторинга типы `Rule`, `PluginConfig`, `Payload` экспортируются из `src/schemas/index.ts` через `z.infer<>`.

## Import Types

```typescript
// Импорт типов из schemas (новый способ)
import type { Rule, PluginConfig, Payload } from './schemas/index.js';

// Раньше (удалённый способ):
// import type { Rule } from './core/types.js';
```

## Type Derivation

Типы автоматически синхронизированы со схемами валидации:

```typescript
import { RuleSchema } from './schemas/index.js';
import type { Rule } from './schemas/index.js';

// Rule === z.infer<typeof RuleSchema>
const rule: Rule = {
  name: 'my-rule',
  topic: 'security',
  agent: 'code-agent',
};
```

## Configuration Example

```typescript
import { parseConfig } from './core/config.js';

const config = parseConfig({
  topics: ['security', 'audit'],
  rules: [
    {
      name: 'security-check',
      topic: 'security',
      agent: 'sec-agent',
      command: 'check',
      prompt_field: '$.payload.message',
    },
    {
      name: 'audit-process',
      topic: 'audit',
      agent: 'audit-agent',
      condition: '$.level == "error"',
    },
  ],
});
```

## buildPrompt with Primitives

```typescript
import { buildPrompt } from './core/prompt.js';

// Числа
const prompt1 = buildPrompt({ count: 42 }, { name: 'r', topic: 't', agent: 'a', prompt_field: '$.count' });
// Returns: "42"

// Булевы значения
const prompt2 = buildPrompt({ active: true }, { name: 'r', topic: 't', agent: 'a', prompt_field: '$.active' });
// Returns: "true"

// С командой
const prompt3 = buildPrompt({ count: 0 }, { name: 'r', topic: 't', agent: 'a', command: 'process', prompt_field: '$.count' });
// Returns: "/process 0"

// BigInt (String() конвертирует корректно)
const prompt4 = buildPrompt({ id: BigInt(123) }, { name: 'r', topic: 't', agent: 'a', prompt_field: '$.id' });
// Returns: "123"
```

## Topic Coverage Validation

`parseConfig` проверяет, что все топики покрыты правилами:

```typescript
try {
  const config = parseConfig({
    topics: ['security', 'audit'],  // audit не покрыт правилами
    rules: [
      { name: 'r', topic: 'security', agent: 'a' },
    ],
  });
} catch (e) {
  // Error: "Topics without rules: audit"
  console.error(e.message);
}
```

## Removing types.ts

Старый файл `src/core/types.ts` удалён. Все типы теперь происходят от Zod-схем.

Если вы видите ошибку `Cannot find module '../core/types'`, обновите импорт:
```typescript
// Заменить
import type { Rule } from '../core/types';
// На
import type { Rule } from '../schemas';
```
