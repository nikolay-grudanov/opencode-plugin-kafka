import { JSONPath } from 'jsonpath-plus';
const payloadQuestion = { type: 'question', content: 'What color is the sky?' };
const payloadNotification = { type: 'notification', content: 'hello' };

console.log('=== Тест routing логики ===');

// Симуляция кода из routing.ts
function checkRule(jsonPathExpr, payload) {
  const results = JSONPath({ path: jsonPathExpr, json: payload });
  return results && results.length > 0;
}

// Текущее выражение из теста
const currentExpr = '$.type[?(@=="question")]';
console.log('\nТекущее выражение: $.type[?(@=="question")]');
console.log('payloadQuestion:', checkRule(currentExpr, payloadQuestion));
console.log('payloadNotification:', checkRule(currentExpr, payloadNotification));

// Предложенное выражение
const newExpr = '$[?(@.type=="question")]';
console.log('\nНовое выражение: $[?(@.type=="question")]');
console.log('payloadQuestion:', checkRule(newExpr, payloadQuestion));
console.log('payloadNotification:', checkRule(newExpr, payloadNotification));

// Другой вариант
const altExpr = '$.[?(@.type=="question")]';
console.log('\nАльтернативное: $.[?(@.type=="question")]');
console.log('payloadQuestion:', checkRule(altExpr, payloadQuestion));
console.log('payloadNotification:', checkRule(altExpr, payloadNotification));

// Ещё один вариант
const altExpr2 = '$[?(@.type=="question")]';
console.log('\nВариант с массивом обёрткой:');
const payloadsAsArray = [payloadQuestion];
console.log('payloadQuestion в массиве:', checkRule(altExpr2, payloadsAsArray));
