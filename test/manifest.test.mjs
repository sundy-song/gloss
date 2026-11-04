/**
 * 静态检查：manifest 合法性、引用文件齐全、JS 可解析、图标可用。
 * node test/manifest.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p));
const exists = (p) => fs.existsSync(path.join(root, p));

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

const manifest = JSON.parse(read('manifest.json').toString('utf8'));

console.log('manifest');

test('MV3 且必填字段齐全', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name && manifest.name.length <= 75);
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  assert.ok(manifest.description);
  assert.ok(manifest.description.length <= 132, 'description 过长');
});

test('权限均为已知项', () => {
  const known = new Set(['storage', 'offscreen', 'activeTab', 'scripting', 'tabs', 'unlimitedStorage']);
  for (const p of manifest.permissions || []) assert.ok(known.has(p), '未知权限: ' + p);
});

test('content script 文件存在且顺序正确', () => {
  for (const cs of manifest.content_scripts || []) {
    assert.ok(cs.matches && cs.matches.length, '缺少 matches');
    assert.ok(cs.js && cs.js.length, '缺少 js');
    for (const f of cs.js) assert.ok(exists(f), '缺少脚本: ' + f);
    for (const f of cs.css || []) assert.ok(exists(f), '缺少样式: ' + f);
  }
});

test('background / popup / icons 文件存在', () => {
  assert.ok(manifest.background && manifest.background.service_worker);
  assert.ok(exists(manifest.background.service_worker));
  assert.ok(manifest.action && manifest.action.default_popup);
  assert.ok(exists(manifest.action.default_popup));
  for (const [size, file] of Object.entries(manifest.icons || {})) {
    assert.ok(exists(file), '缺少图标 ' + size + ': ' + file);
  }
});

test('快捷键只使用受支持的组合', () => {
  const allowed = new Set(['Ctrl', 'Alt', 'Command', 'MacCtrl', 'Shift']);
  for (const [name, cmd] of Object.entries(manifest.commands || {})) {
    const key = cmd.suggested_key || {};
    for (const combo of [key.default, key.mac].filter(Boolean)) {
      const parts = combo.split('+');
      assert.ok(parts.length >= 2, name + ' 需要修饰键');
      const modifiers = parts.slice(0, -1);
      modifiers.forEach((m) => assert.ok(allowed.has(m), name + ' 非法修饰键: ' + m));
    }
  }
});

console.log('图标');

function pngSize(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', '不是 PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('每个图标尺寸与声明一致', () => {
  for (const [size, file] of Object.entries(manifest.icons || {})) {
    const dim = pngSize(read(file));
    assert.equal(dim.width, Number(size), file + ' 宽度不符');
    assert.equal(dim.height, Number(size), file + ' 高度不符');
  }
});

console.log('脚本语法');

test('所有 JS 均可解析', () => {
  const files = ['background.js', 'content.js', 'offscreen.js', 'popup.js', 'lib/text.js'];
  for (const f of files) {
    const src = read(f).toString('utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f + ' 语法错误');
  }
});

test('popup.html 引用的资源存在', () => {
  const html = read('popup.html').toString('utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    if (/^https?:/.test(ref)) continue;
    assert.ok(exists(ref), '缺少资源: ' + ref);
  }
});

test('offscreen.html 引用的脚本存在', () => {
  const html = read('offscreen.html').toString('utf8');
  const refs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) assert.ok(exists(ref), '缺少资源: ' + ref);
});

console.log('v1.1 新增文件');

test('批注脚本已注册且只在顶层框架运行', () => {
  const entry = manifest.content_scripts.find((cs) => (cs.js || []).includes('annotate.js'));
  assert.ok(entry, 'manifest 里应包含 annotate.js');
  assert.equal(entry.all_frames, false);
  assert.ok(exists('annotate.js'));
});

test('导出页与依赖齐全', () => {
  ['export.html', 'export.js', 'export.css', 'lib/report.js', 'lib/pricing.js'].forEach((f) => {
    assert.ok(exists(f), f + ' 不存在');
  });
});

test('export.html 引用了报告与导出脚本', () => {
  const html = read('export.html').toString('utf8');
  assert.match(html, /lib\/report\.js/);
  assert.match(html, /export\.js/);
  assert.match(html, /export\.css/);
});

test('popup 引用 pricing 脚本并包含三个面板', () => {
  const html = read('popup.html').toString('utf8');
  assert.match(html, /lib\/pricing\.js/);
  ['panel-translate', 'panel-export', 'panel-usage'].forEach((id) => {
    assert.ok(html.includes(id), '缺少 ' + id);
  });
});

test('样式包含编号、批注与打印规则', () => {
  const css = read('content.css').toString('utf8');
  ['data-dsbt-n', '::highlight(dsbt-hl-yellow)', '::highlight(dsbt-ul)', 'dsbt-note-card', 'dsbt-term', '@media print'].forEach((token) => {
    assert.ok(css.includes(token), 'content.css 缺少 ' + token);
  });
});

test('批注不再改动页面节点（CSS Custom Highlight API）', () => {
  const js = read('annotate.js').toString('utf8');
  assert.ok(!/insertNode|extractContents|splitText/.test(js), '批注脚本仍在拆分文本节点');
  assert.match(js, /CSS\.highlights/, '没有使用 CSS.highlights');
  assert.match(js, /new Highlight\(/, '没有注册 Highlight');
  assert.match(js, /dsbt-note-card/, '笔记卡片未实现');
});

test('学词层：术语提取与词卡样式', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/terms.js')), '缺少 lib/terms.js');
  const cs = JSON.parse(read('manifest.json').toString('utf8')).content_scripts[0].js;
  assert.ok(cs.indexOf('lib/terms.js') === cs.indexOf('content.js') - 1, 'terms.js 必须在 content.js 之前加载');
  const js = read('content.js').toString('utf8');
  ['extractCandidates', 'data-dsbt-terms', 'dsbt-term'].forEach((token) => {
    assert.ok(js.includes(token), 'content.js 缺少 ' + token);
  });
});

test('版本号已升级到 1.3', () => {
  assert.match(manifest.version, /^1\.3\./);
});

test('品牌名统一为 Gloss', () => {
  assert.ok(manifest.name.includes('Gloss'), 'manifest name 未使用 Gloss');
  assert.equal(manifest.short_name, 'Gloss');
  const popup = read('popup.html').toString('utf8');
  assert.ok(popup.includes('gloss'), 'popup 里没有新品牌名');
  assert.ok(!/双语阅读/.test(popup), 'popup 里还残留旧名称');
});

test('默认关闭：用户不点开关就不会翻译', () => {
  const content = read('content.js').toString('utf8');
  assert.match(content, /const DEFAULTS = \{\s*enabled: false/, 'content.js 默认值不是关闭');
  const bg = read('background.js').toString('utf8');
  assert.match(bg, /const DEFAULTS = \{\s*enabled: false/, 'background.js 默认值不是关闭');
  const popupJs = read('popup.js').toString('utf8');
  assert.match(popupJs, /enabled: false/, 'popup.js 默认值不是关闭');
});

test('批注在关闭状态下不生效', () => {
  const annotate = read('annotate.js').toString('utf8');
  assert.match(annotate, /if \(!state\.enabled\) return/, '批注未按开关拦截');
});

console.log('\n' + passed + ' tests passed');