# QuickStart: Kafka Router Plugin Core

**Feature**: 001-kafka-router
**Date**: 2026-04-21

## Installation

```bash
npm install zod jsonpath-plus
npm install --save-dev vitest @types/node
```

## Usage

### 1. Parse Configuration

```typescript
import { parseConfig } from './src/core/config';
import type { PluginConfig } from './src/core/types';

const rawJson = {
  topics: ['security', 'tasks'],
  rules: [
    {
      name: 'critical-security',
      topic: 'security',
      agent: 'security-agent',
      condition: '$.vulnerabilities[?(@.severity=="CRITICAL")]',
      command: 'analyze',
      prompt_field: '$.vulnerabilities'
    },
    {
      name: 'audit-task',
      topic: 'tasks',
      agent: 'code-agent',
      command: 'audit',
      prompt_field: '$.task_text'
    }
  ]
};

const config: PluginConfig = parseConfig(rawJson);
console.log(config.topics); // ['security', 'tasks']
```

### 2. Match Rule for Message

```typescript
import { matchRule } from './src/core/routing';

const message = {
  vulnerabilities: [
    { severity: 'CRITICAL', id: 'CVE-2024-0001', description: 'Remote code execution' }
  ]
};

const matched = matchRule(message, 'security', config.rules);
if (matched) {
  console.log(`Matched rule: ${matched.name}`);
  console.log(`Agent: ${matched.agent}`);
  // Agent: security-agent
}
```

### 3. Build Prompt for Agent

```typescript
import { buildPrompt } from './src/core/prompt';

const prompt = buildPrompt(message, matched!);
console.log(prompt);
// "/analyze [{"severity":"CRITICAL","id":"CVE-2024-0001","description":"Remote code execution"}]"
```

### 4. Complete Flow

```typescript
import { parseConfig, matchRule, buildPrompt } from './src/core';

function processMessage(rawJson: string, message: unknown) {
  const config = parseConfig(JSON.parse(rawJson));
  const topic = determineTopic(message); // Извлекается из Kafka metadata

  const rule = matchRule(message, topic, config.rules);
  if (!rule) {
    console.log('No matching rule found');
    return;
  }

  const prompt = buildPrompt(message, rule);
  console.log(`Prompt for ${rule.agent}: ${prompt}`);

  // Передаём prompt в OpenCode agent session
  // await client.sessions.create({ agentId: rule.agent, prompt });
}
```

## Testing

```bash
# Run unit tests
npx vitest

# Run with coverage
npx vitest --coverage

# Run specific test file
npx vitest tests/unit/routing.test.ts
```

## Project Structure

```
src/
├── core/
│   ├── config.ts    # parseConfig + schemas
│   ├── routing.ts   # matchRule
│   ├── prompt.ts    # buildPrompt
│   └── types.ts     # TypeScript interfaces
├── schemas/
│   └── index.ts     # Zod schemas export
└── index.ts         # Public API
```

## Edge Cases

| Scenario | Input | Result |
|----------|-------|--------|
| No matching rule | message without CRITICAL vulnerability | `null` from matchRule |
| Catch-all rule | rule without condition | Always matches |
| Missing prompt_field | defaults to `"$"` | Full payload |
| Object as field value | `{ details: { a: 1 } }` | JSON stringified |
| Empty payload | `{}` | Fallback: `"Process this payload"` |