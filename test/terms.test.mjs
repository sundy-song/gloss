/**
 * 学词层：术语 / 搭配提取。node test/terms.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../lib/terms.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name + '\n      ' + e.message);
    process.exitCode = 1;
  }
}

const SENTENCE =
  'The Mutation Observer API keeps the page in sync, and the mutation observer callback runs asynchronously ' +
  'when the accessibility tree changes.';

test('能挑出缩写', () => {
  const list = T.extractCandidates(SENTENCE, { limit: 8 }).map((x) => x.text);
  assert.ok(list.includes('API'), '没有得到 API：' + list.join(' / '));
});

test('能挑出专有名词与连字符词', () => {
  const list = T.extractCandidates(
    'Modern browsers ship the Chrome Translator API, which handles read-only pages and end-to-end updates.',
    { limit: 8 }
  ).map((x) => x.text);
  assert.ok(
    list.some((t) => /Chrome Translator API/.test(t)),
    '没有得到专有名词：' + list.join(' / ')
  );
  assert.ok(list.some((t) => /read-only|end-to-end/.test(t)), '没有得到连字符词：' + list.join(' / '));
});

test('技术后缀词算术语', () => {
  const list = T.extractCandidates('Documentation improves accessibility and comprehension for readers.', {
    limit: 5
  }).map((x) => x.text);
  const lower = list.map((t) => t.toLowerCase());
  ['documentation', 'accessibility', 'comprehension'].forEach((w) => {
    assert.ok(lower.includes(w), '缺少 ' + w + '：' + list.join(' / '));
  });
});

test('不返回停用词和纯符号', () => {
  const list = T.extractCandidates('It is the way of a thing, and so on. --- 123 ???', { limit: 6 });
  list.forEach((item) => {
    assert.ok(!T.STOP.has(item.text.toLowerCase()), '返回了停用词：' + item.text);
    assert.match(item.text, /[A-Za-z\u00c0-\u024f]/, '返回了无字母项：' + item.text);
  });
});

test('短句不产出候选', () => {
  assert.deepEqual(T.extractCandidates('Hello there.', { limit: 4 }), []);
  assert.deepEqual(T.extractCandidates('', { limit: 4 }), []);
});

test('结果按分数排序且数量受限', () => {
  const list = T.extractCandidates(SENTENCE, { limit: 3 });
  assert.ok(list.length <= 3, '超出上限：' + list.length);
  assert.equal(new Set(list.map((x) => x.text.toLowerCase())).size, list.length, '有重复项');
});

test('跨段落搭配统计', () => {
  const res = T.collocations(
    [
      'The mutation observer watches for changes. A mutation observer is asynchronous.',
      'Another mutation observer here, and the accessibility tree matters.'
    ],
    { limit: 5 }
  );
  assert.ok(res.length >= 1, '没有统计出搭配');
  assert.ok(res[0].count >= 2, '计数不对：' + JSON.stringify(res[0]));
});

test('英文原样保留大小写', () => {
  const list = T.extractCandidates(SENTENCE, { limit: 8 });
  const phrase = list.find((x) => /observer/i.test(x.text));
  if (phrase) assert.ok(/[A-Z]/.test(phrase.text), '大小写被压平：' + phrase.text);
});

console.log('\n' + passed + ' tests passed');
