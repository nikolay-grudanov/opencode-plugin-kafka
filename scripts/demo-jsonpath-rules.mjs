/**
 * Демонстрация: 3 сценария отработки JSONPath правил
 * 
 * Сценарий 1: Сообщение НЕ отрабатывает (jsonPath не match)
 * Сценарий 2: Только промт (дефолтный агент)  
 * Сценарий 3: Все поля заполнены (полный флоу с агентом)
 * 
 * Запуск: node scripts/demo-jsonpath-rules.mjs
 */

import { JSONPath } from 'jsonpath-plus';

// Правила маршрутизации (как в kafka-router.json)
const rules = [
  {
    name: 'critical-alerts',
    jsonPath: '$.alerts[?(@.severity=="CRITICAL" || @.severity=="HIGH")]',
    promptTemplate: '🚨 CRITICAL ALERT: ${$.alerts}',
    agentId: 'sec-agent',
    responseTopic: 'opencode.responses',
    timeoutMs: 60000,
    concurrency: 2,
  },
  {
    name: 'generic-process',
    jsonPath: '$',
    promptTemplate: 'Process message: ${$.message}',
    agentId: null, // Не указан — дефолтный
    responseTopic: null,
    timeoutMs: 30000,
    concurrency: 1,
  },
];

// Дефолтный агент
const DEFAULT_AGENT = 'default-agent';

// Функция matching правил (аналог routing.ts)
function matchRule(payload, rulesList) {
  for (const rule of rulesList) {
    const results = JSONPath({ path: rule.jsonPath, json: payload });
    if (results && results.length > 0) {
      return { rule, matched: true };
    }
  }
  return { rule: null, matched: false };
}

// Функция генерации промта с подстановкой значений
function buildPrompt(rule, payload) {
  let prompt = rule.promptTemplate;
  const matches = [...prompt.matchAll(/\$\{([^}]+)\}/g)];
  
  for (const [full, expr] of matches) {
    const value = JSONPath({ path: expr, json: payload });
    const replacement = Array.isArray(value) 
      ? JSON.stringify(value, null, 2) 
      : String(value);
    prompt = prompt.replace(full, replacement);
  }
  
  return prompt;
}

// Эмуляция вызова агента
async function invokeAgent(prompt, agentId) {
  console.log(`\n  🔄 Invoking agent: ${agentId || DEFAULT_AGENT}`);
  console.log(`  📝 Prompt preview: ${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}`);
  
  await new Promise(r => setTimeout(r, 100));
  
  return {
    success: true,
    agentId: agentId || DEFAULT_AGENT,
    response: `[Mock] Processed by ${agentId || DEFAULT_AGENT}`,
  };
}

// Создание демо-топиков
async function ensureTopics() {
  const { execSync } = await import('child_process');
  const topics = ['demo.rules-input', 'demo.rules-output', 'demo.rules-dlq'];
  
  for (const topic of topics) {
    try {
      execSync(
        `docker exec opencode-kafka /opt/kafka/bin/kafka-topics.sh --create --topic ${topic} --partitions 1 --replication-factor 1 --bootstrap-server localhost:9092 2>/dev/null`,
        { stdio: 'pipe' }
      );
      console.log(`  ✓ Created: ${topic}`);
    } catch {}
  }
}

async function run() {
  console.log('\n📡 JSONPath Rule Matching — Демонстрация');
  console.log('═'.repeat(60));

  // === СЛУЧАЙ 1: jsonPath НЕ match ===
  console.log('\n🅰️ СЛУЧАЙ 1: Сообщение НЕ отрабатывает (no match)');
  console.log('─'.repeat(60));
  
  const msg1 = {
    type: 'security-check',
    alerts: [{ severity: 'LOW', msg: 'Minor issue detected' }],
    timestamp: Date.now(),
  };
  
  console.log('📥 Input:', JSON.stringify(msg1, null, 2));
  console.log('\n📋 Правило:');
  console.log('   jsonPath: "$.alerts[?(@.severity==CRITICAL || @.severity==HIGH)]"');
  console.log('   Ожидает: severity = CRITICAL или HIGH');
  console.log('   Факт: severity = LOW');
  
  const result1 = matchRule(msg1, rules);
  
  if (!result1.matched) {
    console.log('\n❌ РЕЗУЛЬТАТ: NO MATCH — правило не сработало!');
    console.log('   → Сообщение отклоняется (не передаётся агенту)');
    console.log('   → Может быть отправлено в DLQ для анализа');
    console.log('   → DLQ topic: demo.rules-dlq');
  }

  // === СЛУЧАЙ 2: Дефолтный агент ===
  console.log('\n\n🅱️ СЛУЧАЙ 2: Только промт (дефолтный агент)');
  console.log('─'.repeat(60));
  
  const msg2 = {
    type: 'info',
    message: 'User logged in',
    user: 'john@example.com',
    timestamp: Date.now(),
  };
  
  console.log('📥 Input:', JSON.stringify(msg2, null, 2));
  console.log('\n📋 Правило:');
  console.log('   jsonPath: "$" (match всех сообщений)');
  console.log('   promptTemplate: "Process message: ${$.message}"');
  console.log('   agentId: (не указан) -> DEFAULT_AGENT');
  console.log('   responseTopic: (не указан)');
  
  const result2 = matchRule(msg2, rules);
  
  if (result2.matched) {
    const rule = result2.rule;
    console.log('\n✅ РЕЗУЛЬТАТ: MATCHED');
    console.log(`   Rule name: ${rule.name}`);
    console.log(`   Agent: ${DEFAULT_AGENT} (дефолт, agentId не указан)`);
    console.log(`   Timeout: ${rule.timeoutMs}ms`);
    
    const prompt = buildPrompt(rule, msg2);
    console.log('\n📝 Сгенерированный промт:');
    console.log(prompt);
    
    const agentResult = await invokeAgent(prompt, rule.agentId);
    console.log(`\n✅ Ответ агента: ${agentResult.response}`);
    console.log('   → responseTopic не указан — ответ только в логах');
  }

  // === СЛУЧАЙ 3: Полный флоу ===
  console.log('\n\n🅾️ СЛУЧАЙ 3: Все поля заполнены (полный флоу)');
  console.log('─'.repeat(60));
  
  const msg3 = {
    type: 'security-check',
    alerts: [
      { severity: 'CRITICAL', msg: 'SQL Injection!', url: '/api/users' },
      { severity: 'HIGH', msg: 'XSS vulnerability', url: '/api/posts' },
    ],
    timestamp: Date.now(),
  };
  
  console.log('📥 Input:', JSON.stringify(msg3, null, 2));
  console.log('\n📋 Правило (полное):');
  console.log('   name: "critical-alerts"');
console.log('   jsonPath: "$.alerts[?(@.severity==CRITICAL || @.severity==HIGH)]"');
  console.log('   promptTemplate: "🚨 CRITICAL ALERT: ${$.alerts}"');
  console.log('   agentId: "sec-agent"');
  console.log('   responseTopic: "opencode.responses"');
  console.log('   timeoutMs: 60000');
  console.log('   concurrency: 2');
  
  const result3 = matchRule(msg3, rules);
  
  if (result3.matched) {
    const rule = result3.rule;
    console.log('\n✅ РЕЗУЛЬТАТ: MATCHED');
    console.log(`   Rule: ${rule.name}`);
    console.log('   Agent: ' + rule.agentId + ' (конкретный агент)');
    console.log(`   Timeout: ${rule.timeoutMs}ms, concurrency: ${rule.concurrency}`);
    console.log(`   Response topic: ${rule.responseTopic}`);
    
    const prompt = buildPrompt(rule, msg3);
    console.log('\n📝 Сгенерированный промт:');
    console.log(prompt);
    
    console.log('\n⏳ Вызов агента...');
    const agentResult = await invokeAgent(prompt, rule.agentId);
    
    console.log('\n✅ Обработка завершена:');
    console.log(`   Agent: ${agentResult.agentId}`);
    console.log(`   Response: ${agentResult.response}`);
    console.log(`   Success: ${agentResult.success}`);
    
    console.log(`\n📤 Ответ отправлен в Kafka: topic=${rule.responseTopic}`);
    console.log('   { originalTopic, inputMessage, agentId, response, timestamp }');
  }

  // === Сводка ===
  console.log('\n' + '═'.repeat(60));
  console.log('📊 СВОДКА JSONPath Rule Matching:');
  console.log('   ┌─────────────────────┬────────────┬──────────┬─────────────┐');
  console.log('   │ Случай              │ Matched    │ Agent    │ Response    │');
  console.log('   ├─────────────────────┼────────────┼──────────┼─────────────┤');
  console.log('   │ 🅰️ no match (LOW)   │ ❌ NO      │ —        │ → DLQ       │');
  console.log('   │ 🅱️ default agent    │ ✅ YES     │ default  │ logs only   │');
  console.log('   │ 🅾️ full params      │ ✅ YES     │ sec-agent│ → response  │');
  console.log('   └─────────────────────┴────────────┴──────────┴─────────────┘');
  console.log('\n✅ Демо завершено!\n');
}

run().catch(console.error);