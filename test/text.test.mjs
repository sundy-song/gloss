/**
 * 纯函数单测：node test/text.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../lib/text.js');

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

console.log('isEnglishLike');
test('普通英文句子', () => assert.equal(T.isEnglishLike('Read the documentation to get started.'), true));
test('单个单词', () => assert.equal(T.isEnglishLike('Settings'), true));
test('纯中文', () => assert.equal(T.isEnglishLike('设置'), false));
test('中文为主夹杂英文', () => assert.equal(T.isEnglishLike('这是中文设置页面 settings'), false));
test('英文为主夹杂少量中文', () => assert.equal(T.isEnglishLike('Chrome 扩展安装方法'), false));
test('纯数字', () => assert.equal(T.isEnglishLike('12345'), false));
test('纯符号', () => assert.equal(T.isEnglishLike('—— · ·'), false));
test('单字母太短', () => assert.equal(T.isEnglishLike('a'), false));

console.log('shouldSkip');
test('URL', () => assert.equal(T.shouldSkip('https://example.com/a/b'), true));
test('邮箱', () => assert.equal(T.shouldSkip('hi@example.com'), true));
test('哈希/长 token', () => assert.equal(T.shouldSkip('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b'), true));
test('正常句子不跳过', () => assert.equal(T.shouldSkip('Save changes before leaving'), false));

console.log('normalize');
test('压缩空白', () => assert.equal(T.normalize('  a \n\t b  '), 'a b'));
test('null 安全', () => assert.equal(T.normalize(null), ''));

console.log('chunkText');
test('短文本不切', () => assert.deepEqual(T.chunkText('Hello world.', 100), ['Hello world.']));
test('按句切分且不超长', () => {
  const text = 'First sentence here. Second sentence here. Third sentence here.';
  const chunks = T.chunkText(text, 40);
  assert.ok(chunks.length >= 2);
  chunks.forEach((c) => assert.ok(c.length <= 40, 'chunk too long: ' + c));
  assert.equal(chunks.join(' '), text);
});
test('空文本', () => assert.deepEqual(T.chunkText('', 10), []));

console.log('normalizeLang');
test('zh-CN', () => assert.equal(T.normalizeLang('zh-CN'), 'zh'));
test('zh_CN', () => assert.equal(T.normalizeLang('zh_CN'), 'zh'));
test('zh-TW', () => assert.equal(T.normalizeLang('zh-TW'), 'zh-Hant'));
test('zh-Hant', () => assert.equal(T.normalizeLang('zh-Hant'), 'zh-Hant'));
test('空值默认简体', () => assert.equal(T.normalizeLang(''), 'zh'));


test('isTranslatable：中文目标沿用英文判定', () => {
  assert.equal(T.isTranslatable('Reading documentation is slow.', 'zh'), true);
  assert.equal(T.isTranslatable('这是一段中文，不需要翻译。', 'zh'), false);
});

test('isTranslatable：日 / 韩 / 俄 目标跳过同文字', () => {
  assert.equal(T.isTranslatable('これは日本語の文章です。', 'ja'), false);
  assert.equal(T.isTranslatable('Reading documentation is slow.', 'ja'), true);
  assert.equal(T.isTranslatable('한국어 문장입니다.', 'ko'), false);
  assert.equal(T.isTranslatable('Это русское предложение.', 'ru'), false);
  assert.equal(T.isTranslatable('Reading documentation is slow.', 'ru'), true);
});

test('isTranslatable：西语等拉丁目标一律翻译', () => {
  assert.equal(T.isTranslatable('Leer documentación técnica es lento.', 'es'), true);
  assert.equal(T.isTranslatable('https://example.com/docs', 'es'), false);
  assert.equal(T.isTranslatable('1234 ---', 'es'), false);
});

console.log('\n' + passed + ' tests passed');