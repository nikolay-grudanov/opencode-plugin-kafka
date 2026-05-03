import { JSONPath } from 'jsonpath-plus';
import { matchRuleV003 } from './dist/core/routing.js';

const payloadQuestion = { type: 'question', content: 'What color is the sky?' };
const payloadNotification = { type: 'notification', content: 'hello' };

// Тест как в unit-тестах: вложенный массив с условием
const payloadArray = {
  messages: [
    { type: 'question', content: 'What color?' },
    { type: 'notification', content: 'hello' }
  ]
};

const rule = {
  name: 'e2e-routing-rule',
  jsonPath: '$.messages[?(@.type=="question")]',
  promptTemplate: '${$.content}',
  agentId: 'test-agent',
  responseTopic: 'response',
  timeoutMs: 120000,
  concurrency: 1,
};

console.log('=== Тест matchRuleV003 ===');
console.log('Rule:', rule.jsonPath);
console.log('Payload1 (question):', payloadQuestion);
console.log('Payload2 (notification):', payloadNotification);
console.log('Payload3 (array):', payloadArray);

const result1 = matchRuleV003(payloadQuestion, [rule]);
const result2 = matchRuleV003(payloadNotification, [rule]);
const result3 = matchRuleV003(payloadArray, [rule]);

console.log('\nРезультат для question:', result1?.name ?? 'null');
console.log('Результат для notification:', result2?.name ?? 'null');
console.log('Результат для array:', result3?.name ?? 'null');

// Тест JSONPath напрямую для каждого payload
console.log('\n--- JSONPath напрямую ---');
const jp1 = JSONPath({ path: rule.jsonPath, json: payloadQuestion });
const jp2 = JSONPath({ path: rule.jsonPath, json: payloadNotification });
const jp3 = JSONPath({ path: rule.jsonPath, json: payloadArray });
console.log('JSONPath для question:', jp1);
console.log('JSONPath для notification:', jp2);
console.log('JSONPath для array:', jp3);

// Тест простого пути
console.log('\n--- Простой путь $.messages[0].type ---');
const simpleResult = JSONPath({ path: '$.messages[0].type', json: payloadArray });
console.log('$.messages[0].type:', simpleResult);

// Тест: можно ли проверить скалярное значение в JSONPath
console.log('\n--- Проверка скалярного значения ---');
const scalarRule = {
  name: 'scalar-test',
  jsonPath: '$..type[?(@ == "question")]',
  promptTemplate: 'Test',
  agentId: 'test-agent',
  responseTopic: 'response',
  timeoutMs: 120000,
  concurrency: 1,
};
const scalarJp1 = JSONPath({ path: scalarRule.jsonPath, json: payloadQuestion });
const scalarJp2 = JSONPath({ path: scalarRule.jsonPath, json: payloadNotification });
console.log('$..type[?(@ == "question")] для question:', scalarJp1);
console.log('$..type[?(@ == "question")] для notification:', scalarJp2);

// Еще тесты
console.log('\n--- Дополнительные тесты JSONPath ---');
const tests = [
  { path: '$..type', json: payloadQuestion },
  { path: '$..type', json: payloadNotification },
  { path: '$.type', json: payloadQuestion },
];
for (const t of tests) {
  console.log(`Path: ${t.path}, JSON:`, JSON.stringify(t.json), '=>', JSONPath({ path: t.path, json: t.json }));
}