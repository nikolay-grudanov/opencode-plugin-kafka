/**
 * Демонстрация: 3 кейса обработки сообщений Kafka плагином
 * 
 * Кейс 1: Агент вызван, ответ не отправляется (нет responseTopic)
 * Кейс 2: Агент вызван, ответ отправляется в responseTopic
 * Кейс 3: Агент вызван, ошибка отправляется в DLQ
 * 
 * Запуск: node scripts/demo-agent-cases.mjs
 */

import { JSONPath } from 'jsonpath-plus';

// Все правила для различных типов сообщений
const rules = [
  {
    name: 'log-rule',
    jsonPath: '$.action',
    promptTemplate: 'Log: ${$.message}',
    agentId: 'logger-agent',
    responseTopic: null, // ← НЕТ responseTopic
    timeoutMs: 30000,
    concurrency: 1,
  },
  {
    name: 'process-rule',
    jsonPath: '$.type',
    promptTemplate: 'Process: ${$.data}',
    agentId: 'processor-agent',
    responseTopic: 'demo.responses', // ← Есть responseTopic
    timeoutMs: 60000,
    concurrency: 1,
  },
];

// Эмуляция агента
async function invokeAgent(prompt, agentId) {
  console.log('  🔄 Agent.invoke(prompt, agentId=' + agentId + ')');
  await new Promise(r => setTimeout(r, 30));
  
  // Симуляция ошибки для case 3
  if (agentId === 'error-agent') {
    return {
      success: false,
      status: 'timeout',
      agentId,
      sessionId: 'session-' + Date.now(),
      response: null,
      errorMessage: 'Connection timeout after 30s',
      executionTimeMs: 30000,
    };
  }
  
  return {
    success: true,
    status: 'success',
    agentId: agentId || 'default-agent',
    sessionId: 'session-' + Date.now(),
    response: '[Mock] Processed by ' + (agentId || 'default-agent'),
    errorMessage: null,
    executionTimeMs: 100,
  };
}

// Отправка в Kafka
async function sendToKafka(topic, data) {
  console.log('  📤 → Kafka topic: ' + topic);
  console.log('     ' + JSON.stringify(data).substring(0, 80) + '...');
  await new Promise(r => setTimeout(r, 20));
  return true;
}

// Отправка в DLQ
async function sendToDLQ(message, error) {
  console.log('  📤 → DLQ (demo.dlq)');
  console.log('     Original: ' + message.substring(0, 50) + '...');
  console.log('     Error: ' + error.message);
  await new Promise(r => setTimeout(r, 20));
  return true;
}

// Функция matching
function matchRule(payload, rulesList) {
  for (const rule of rulesList) {
    const results = JSONPath({ path: rule.jsonPath, json: payload });
    if (results && results.length > 0) {
      return { rule, matched: true };
    }
  }
  return { rule: null, matched: false };
}

// Генерация промта
function buildPrompt(rule, payload) {
  let prompt = rule.promptTemplate;
  const matches = [...prompt.matchAll(/\$\{([^}]+)\}/g)];
  for (const [full, expr] of matches) {
    const value = JSONPath({ path: expr, json: payload });
    prompt = prompt.replace(full, JSON.stringify(value));
  }
  return prompt;
}

// ═══════════════════════════════════════════════════════════════════
// КЕЙС 1: Агент вызван, ответ НЕ отправляется в Kafka
// ═══════════════════════════════════════════════════════════════════
async function case1_noResponseTopic() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  КЕЙС 1: Агент вызван, но ответ НЕ отправляется          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const payload = {
    action: 'LOG',
    message: 'User logged in',
    user: 'admin@example.com',
    timestamp: Date.now(),
  };
  
  console.log('\n📥 Input: ' + JSON.stringify(payload));
  console.log('\n📋 Rule:');
  console.log('   name: "log-rule"');
  console.log('   jsonPath: "$.action"');
  console.log('   promptTemplate: "Log: ${$.message}"');
  console.log('   agentId: "logger-agent"');
  console.log('   responseTopic: null  ← ОТСУТСТВУЕТ!');
  
  const result = matchRule(payload, rules);
  
  if (result.matched && result.rule.name === 'log-rule') {
    const rule = result.rule;
    console.log('\n✅ Matched: ' + rule.name);
    console.log('   agentId: ' + rule.agentId);
    console.log('   responseTopic: ' + (rule.responseTopic || 'null → ответ только в логах'));
    
    const prompt = buildPrompt(rule, payload);
    console.log('\n📝 Prompt: ' + prompt);
    
    console.log('\n⏳ Invoking agent...');
    const agentResult = await invokeAgent(prompt, rule.agentId);
    
    console.log('\n✅ Agent finished: ' + agentResult.status);
    console.log('   response: ' + agentResult.response);
    
    // КЛЮЧЕВАЯ ЛОГИКА: responseTopic = null → не отправляем в Kafka
    if (!rule.responseTopic) {
      console.log('\n⚠️  responseTopic = null');
      console.log('   → Ответ НЕ отправляется в Kafka');
      console.log('   → Только логируется');
    }
    
    console.log('\n📊 Flow: Message → Agent → (logs only) → commit');
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// КЕЙС 2: Агент вызван, ответ отправляется в responseTopic
// ═══════════════════════════════════════════════════════════════════
async function case2_successWithResponse() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  КЕЙС 2: Агент вызван, ответ → responseTopic            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const payload = {
    type: 'process',
    data: { orderId: 'ORD-123', amount: 999.99 },
    correlationId: 'corr-001',
    timestamp: Date.now(),
  };
  
  console.log('\n📥 Input: ' + JSON.stringify(payload));
  console.log('\n📋 Rule:');
  console.log('   name: "process-rule"');
  console.log('   jsonPath: "$.type"');
  console.log('   promptTemplate: "Process: ${$.data}"');
  console.log('   agentId: "processor-agent"');
  console.log('   responseTopic: "demo.responses"  ← ЕСТЬ!');
  
  const result = matchRule(payload, rules);
  
  if (result.matched && result.rule.name === 'process-rule') {
    const rule = result.rule;
    console.log('\n✅ Matched: ' + rule.name);
    console.log('   agentId: ' + rule.agentId);
    console.log('   responseTopic: ' + rule.responseTopic);
    
    const prompt = buildPrompt(rule, payload);
    console.log('\n📝 Prompt: ' + prompt);
    
    console.log('\n⏳ Invoking agent...');
    const agentResult = await invokeAgent(prompt, rule.agentId);
    
    console.log('\n✅ Agent finished: ' + agentResult.status);
    console.log('   response: ' + agentResult.response);
    
    // КЛЮЧЕВАЯ ЛОГИКА: success && responseTopic → отправляем
    if (agentResult.success && rule.responseTopic) {
      await sendToKafka(rule.responseTopic, {
        correlationId: payload.correlationId,
        sessionId: agentResult.sessionId,
        ruleName: rule.name,
        agentId: agentResult.agentId,
        response: agentResult.response,
        status: agentResult.status,
        timestamp: new Date().toISOString(),
      });
      console.log('\n✅ Response sent to Kafka!');
    }
    
    console.log('\n📊 Flow: Message → Agent → Response → Kafka → commit');
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// КЕЙС 3: Агент вернул ошибку → отправляется в DLQ
// ═══════════════════════════════════════════════════════════════════
async function case3_errorDLQ() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  КЕЙС 3: Агент ошибся → отправляется в DLQ               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const payload = {
    type: 'process',
    data: { orderId: 'ORD-456', amount: 1234.56 },
    correlationId: 'corr-002',
    timestamp: Date.now(),
  };
  
  console.log('\n📥 Input: ' + JSON.stringify(payload));
  console.log('\n📋 Rule:');
  console.log('   name: "process-rule" (с responseTopic)');
  console.log('   agentId: "error-agent"  ← СИМУЛЯЦИЯ ОШИБКИ!');
  
  const result = matchRule(payload, rules);
  
  if (result.matched) {
    const rule = { ...result.rule, agentId: 'error-agent' }; // Принудительно ошибка
    console.log('\n✅ Matched: ' + rule.name);
    console.log('   agentId: ' + rule.agentId + ' (симуляция timeout)');
    console.log('   responseTopic: ' + rule.responseTopic);
    
    const prompt = buildPrompt(rule, payload);
    console.log('\n📝 Prompt: ' + prompt);
    
    console.log('\n⏳ Invoking agent (ожидаем ошибку)...');
    const agentResult = await invokeAgent(prompt, rule.agentId);
    
    console.log('\n❌ Agent finished: ' + agentResult.status);
    console.log('   error: ' + agentResult.errorMessage);
    
    // КЛЮЧЕВАЯ ЛОГИКА: не success → отправляем в DLQ
    if (!agentResult.success) {
      const error = new Error('Agent invoke failed: ' + agentResult.errorMessage + ' (status: ' + agentResult.status + ')');
      await sendToDLQ(JSON.stringify(payload), error);
      console.log('\n✅ Error sent to DLQ!');
    }
    
    console.log('\n📊 Flow: Message → Agent → (error) → DLQ → commit');
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// Главный запуск
// ═══════════════════════════════════════════════════════════════════
async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Kafka Plugin — Демонстрация обработки сообщений      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await case1_noResponseTopic();
  await case2_successWithResponse();
  await case3_errorDLQ();
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        СВОДКА СЦЕНАРИЕВ                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │ Кейс │ Условие                          │ Действие         │');
  console.log('  ├──────────────────────────────────────────────────────────────┤');
  console.log('  │  1   │ responseTopic = null            │ logs only        │');
  console.log('  │  2   │ success && responseTopic != null│ → responseTopic  │');
  console.log('  │  3   │ error/timeout                  │ → DLQ            │');
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Код в consumer.ts (строки 472-529):');
  console.log('  ');
  console.log('    if (agentResult.status === "success") {');
  console.log('      if (matchedRule.responseTopic) {');
  console.log('        await sendResponse(...);  // → Kafka');
  console.log('      }');
  console.log('    } else {');
  console.log('      await sendToDlq(...);       // → DLQ');
  console.log('    }');
  console.log('');
  console.log('✅ Демо завершено!\n');
}

run().catch(console.error);