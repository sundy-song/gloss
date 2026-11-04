/**
 * lib/pricing.js 单测：token 估算、价目解析、费用计算与格式化。
 * node test/pricing.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'lib/pricing.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'lib/pricing.js' });
const P = sandbox.DSBTPrice;

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

console.log('token 估算');

test('空字符串为 0', () => {
  assert.equal(P.estimateTokens(''), 0);
  assert.equal(P.estimateTokens(null), 0);
  assert.equal(P.estimateTokens(undefined), 0);
});

test('英文按 4 字符 1 token 估算', () => {
  assert.equal(P.estimateTokens('abcd'), 1);
  assert.equal(P.estimateTokens('abcdefgh'), 2);
  assert.equal(P.estimateTokens('ab'), 1, '不足一个 token 也向上取整');
});

test('中文按 1 字 1 token 估算', () => {
  assert.equal(P.estimateTokens('你好世界'), 4);
});

test('中英混排累加', () => {
  assert.equal(P.estimateTokens('你好abcd'), 5);
});

test('估算值随文本长度单调增长', () => {
  const a = P.estimateTokens('hello');
  const b = P.estimateTokens('hello world, this is a longer sentence');
  assert.ok(b > a);
});

console.log('价目');

test('内置模型有默认价', () => {
  const price = P.resolvePrice('deepseek-chat');
  assert.equal(price.in, 2);
  assert.equal(price.out, 8);
});

test('离线与 Google 免费', () => {
  assert.equal(P.resolvePrice('builtin').in, 0);
  assert.equal(P.resolvePrice('google').out, 0);
});

test('用户覆盖优先', () => {
  const price = P.resolvePrice('deepseek-chat', { 'deepseek-chat': { in: 1, out: 2 } });
  assert.equal(price.in, 1);
  assert.equal(price.out, 2);
});

test('未知模型用兜底价', () => {
  const price = P.resolvePrice('some-unknown-model');
  assert.equal(price.in, P.FALLBACK_PRICE.in);
  assert.equal(price.out, P.FALLBACK_PRICE.out);
});

test('模型带版本后缀也能匹配', () => {
  const price = P.resolvePrice('deepseek-chat-0324');
  assert.equal(price.in, 2);
});

test('非法价格回落到兜底值', () => {
  const price = P.resolvePrice('x', { x: { in: -5, out: 'abc' } });
  assert.equal(price.in, P.FALLBACK_PRICE.in);
  assert.equal(price.out, P.FALLBACK_PRICE.out);
});

console.log('费用');

test('按百万 tokens 计价', () => {
  const cost = P.costOf({ promptTokens: 1e6, completionTokens: 1e6 }, { in: 2, out: 8 });
  assert.equal(cost, 10);
});

test('小额度按比例', () => {
  const cost = P.costOf({ promptTokens: 1000, completionTokens: 0 }, { in: 2, out: 8 });
  assert.ok(Math.abs(cost - 0.002) < 1e-12);
});

test('免费引擎费用为 0', () => {
  assert.equal(P.costOf({ promptTokens: 1e6, completionTokens: 1e6 }, { in: 0, out: 0 }), 0);
});

test('缺失字段按 0 处理', () => {
  assert.equal(P.costOf({}, { in: 2, out: 8 }), 0);
});

console.log('格式化');

test('大数字用万/亿', () => {
  assert.equal(P.formatTokens(12000), '1.2 万');
  assert.equal(P.formatTokens(120000), '12 万');
  assert.equal(P.formatTokens(120000000), '1.20 亿');
  assert.equal(P.formatTokens(42), '42');
});

test('金额自适应小数位', () => {
  assert.equal(P.formatCny(0), '¥0');
  assert.match(P.formatCny(0.00003), /^¥0\.000030$/);
  assert.match(P.formatCny(0.5), /^¥0\.500$/);
  assert.match(P.formatCny(3.14159), /^¥3\.14$/);
});

console.log('\n' + passed + ' tests passed');