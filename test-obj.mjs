import { JSONPath } from 'jsonpath-plus';

const payloadQuestion = { type: 'question', content: 'What color is the sky?' };
const payloadNotification = { type: 'notification', content: 'hello' };

function checkRule(jsonPathExpr, payload) {
  const results = JSONPath({ path: jsonPathExpr, json: payload });
  return { raw: results, matched: results && results.length > 0 };
}

console.log('=== Тест для объекта type ===');

const tests = [
  // Что работает для объекта
  ['$.type', 'получить type'],
  ['$[0]', 'индекс 0 от объекта'],  // не работает
  ['$[?(@.type)]', 'filter по полю объекта'],  // не работает
  ['$.*[0]', 'первый символ всех значений'],
  ['$.type[0]', 'первый символ type'],

  // Обернуть в массив
  ['$[?(@.type=="question")]', 'filter на корне'],
  ['$[?(true)]', 'filter always true'],

  // Как обойти - через условие в коде
  // Но JSONPath filter не работает для объектов
];

for (const [expr, desc] of tests) {
  try {
    const rQ = checkRule(expr, payloadQuestion);
    const rN = checkRule(expr, payloadNotification);
    console.log(`"${expr}" (${desc}):`);
    console.log(`  Q: ${JSON.stringify(rQ.raw).slice(0,60)} → ${rQ.matched}`);
    console.log(`  N: ${JSON.stringify(rN.raw).slice(0,60)} → ${rN.matched}`);
  } catch (e) {
    console.log(`"${expr}": ERROR ${e.message}`);
  }
}

// Вывод: для простой фильтрации по полю объекта нужно:
// 1. Использовать $.type (получить значение)
// 2. Проверить в коде: if (result === "question")
// ИЛИ
// 3. Использовать jsonPath: '$.*[?(@=="question")]' (не работает)
// 4. Изменить структуру payload на массив

console.log('\n=== Вывод ===');
console.log('Чтобы матчить по type объекта, нужно:');
console.log('1. jsonPath: "$.type"');
console.log('2. Проверка: if (results[0] === "question")');

// Или менять payload на массив
console.log('\nДля массива работает: $[?(@.type=="question")]');
