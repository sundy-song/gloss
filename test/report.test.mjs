/**
 * lib/report.js 单测：导出的 HTML / Markdown 结构、转义、纸张与笔记。
 * node test/report.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'lib/report.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'lib/report.js' });
const R = sandbox.DSBTReport;

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

const model = {
  title: 'Getting started with the API',
  url: 'https://example.com/docs/start',
  site: 'example.com',
  createdAt: '2026-11-04T08:00:00.000Z',
  items: [
    { en: 'Read the documentation to get started.', zh: '阅读文档以开始使用。' },
    { en: 'Save <changes> & reload.', zh: '保存并重新加载。', note: '这里说的重载是刷新页面' }
  ],
  notes: [{ text: 'Read the documentation', note: '重点' }]
};

console.log('HTML 结构');

test('生成完整 HTML 文档', () => {
  const html = R.buildReportHtml(model, { paper: 'A4', fontSize: 16, margin: 18 });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>$/);
  assert.match(html, /<meta charset="utf-8">/);
});

test('包含标题与来源', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('Getting started with the API'));
  assert.ok(html.includes('example.com'));
});

test('每段中英对照都在文档里', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('Read the documentation to get started.'));
  assert.ok(html.includes('阅读文档以开始使用。'));
  assert.ok(html.includes('保存并重新加载。'));
});

test('默认保留原文，可关闭', () => {
  const withEn = R.buildReportHtml(model, {});
  assert.ok(withEn.includes('Read the documentation'));
  const withoutEn = R.buildReportHtml(model, { includeOriginal: false });
  assert.ok(!withoutEn.includes('Read the documentation to get started.'));
  assert.ok(withoutEn.includes('阅读文档以开始使用。'));
});

test('HTML 特殊字符被转义', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('Save &lt;changes&gt; &amp; reload.'));
  assert.ok(!html.includes('Save <changes>'));
});

test('笔记随段落导出，也能关闭', () => {
  const html = R.buildReportHtml(model, { includeNotes: true });
  assert.ok(html.includes('这里说的重载是刷新页面'));
  const off = R.buildReportHtml(model, { includeNotes: false });
  assert.ok(!off.includes('这里说的重载是刷新页面'));
});

test('零散笔记单独成节', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('页内笔记'));
  assert.ok(html.includes('重点'));
});

test('段落带连续编号', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('<div class="num">1</div>'));
  assert.ok(html.includes('<div class="num">2</div>'));
});

console.log('纸张与排版');

test('@page 使用所选纸张和边距', () => {
  const html = R.buildReportHtml(model, { paper: 'A5', margin: 12 });
  assert.ok(html.includes('@page{size:A5;margin:12mm}'));
});

test('纸张宽度写进版心变量', () => {
  const a4 = R.buildReportHtml(model, { paper: 'A4' });
  const b5 = R.buildReportHtml(model, { paper: 'B5' });
  assert.ok(a4.includes('--paper-w:210mm'));
  assert.ok(b5.includes('--paper-w:176mm'));
});

test('未知纸张回落到 A4', () => {
  const html = R.buildReportHtml(model, { paper: 'A3' });
  assert.ok(html.includes('size:A4'));
});

test('字号与边距被限制在合理区间', () => {
  const opts = R.normalizeOptions({ fontSize: 100, margin: 200 });
  assert.equal(opts.fontSize, 24);
  assert.equal(opts.margin, 40);
  const low = R.normalizeOptions({ fontSize: 1, margin: 1 });
  assert.equal(low.fontSize, 11);
  assert.equal(low.margin, 8);
  // 0 视为未设置，使用默认 18mm
  assert.equal(R.normalizeOptions({ margin: 0 }).margin, 18);
});

test('打印时隐藏阴影、保留分页规则', () => {
  const html = R.buildReportHtml(model, {});
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes('break-inside:avoid'));
});

test('空内容也能生成不报错', () => {
  const html = R.buildReportHtml({ title: '', items: [] }, {});
  assert.match(html, /双语对照/);
});

console.log('Markdown');

test('生成 Markdown 对照', () => {
  const md = R.buildMarkdown(model);
  assert.ok(md.startsWith('# Getting started with the API'));
  assert.ok(md.includes('Read the documentation to get started.'));
  assert.ok(md.includes('**阅读文档以开始使用。**'));
  assert.ok(md.includes('> 笔记：这里说的重载是刷新页面'));
});

test('Markdown 保留来源链接', () => {
  const md = R.buildMarkdown(model);
  assert.ok(md.includes('https://example.com/docs/start'));
});

console.log('\n' + passed + ' tests passed');