import { JSONPath } from 'jsonpath-plus';
const payloadQuestion = { type: 'question', content: 'What color is the sky?' };
const payloadNotification = { type: 'notification', content: 'hello' };

function checkRule(jsonPathExpr, payload) {
  const results = JSONPath({ path: jsonPathExpr, json: payload });
  return { results, matched: results && results.length > 0 };
}

console.log('=== Расширенный тест ===');
const tests = [
  ['$.type', 'базовый path'],
  ['$', 'корень'],
  ['$.*', 'все значения'],
  ['$.*.*', 'все вложенные'],
  ['$.*.[0]', 'первый элемент'],
  ['$.type[*]', 'type массив'],
  ['$.type[@]', 'type по индексу'],
  ['$.type[0]', 'type[0]'],
  ['@', 'at root'],
  ['@.type', 'at type'],
  ['$..type', 'recursive type'],
  ['$[0]', 'индекс 0'],
  ['$[-1:]', 'последний'],
  ['$[0:1]', 'срез'],
  ['$.type', 'type field'],
  ['$.content', 'content field'],
  ['$.type,$.content', 'несколько полей'],
];

for (const [expr, desc] of tests) {
  try {
    const rQ = checkRule(expr, payloadQuestion);
    const rN = checkRule(expr, payloadNotification);
    const matchQ = rQ.matched ? '✓' : '✗';
    const matchN = rN.matched ? '✓' : '✗';
    console.log(`"${expr}" (${desc}):`);
    console.log(`  Q: ${JSON.stringify(rQ.results).slice(0,50)} → ${matchQ}`);
    console.log(`  N: ${JSON.stringify(rN.results).slice(0,50)} → ${matchN}`);
  } catch (e) {
    console.log(`"${expr}": ERROR ${e.message}`);
  }
}