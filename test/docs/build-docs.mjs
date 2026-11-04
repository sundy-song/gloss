/**
 * 生成 README 用的截图（真实 HTML/CSS/JS，只把 chrome.* 换成假实现）。
 *
 *   node test/docs/build-docs.mjs
 *
 * 产物：
 *   docs/preview/*.html   —— 可单独用浏览器打开的“预览版”页面
 *   docs/img/*.png        —— README 里引用的截图
 *
 * 需要本机装有 Chrome；脚本用无头模式渲染，不会打开可见窗口。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const previewDir = path.join(root, 'docs', 'preview');
const imgDir = path.join(root, 'docs', 'img');

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(previewDir, { recursive: true });
fs.mkdirSync(imgDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* 演示用的中文译文                                                    */
/* ------------------------------------------------------------------ */

const ZH = {
  'Gloss — read English with Chinese folded in': 'Gloss · 把中文夹进英文里读',
  'bilingual layout': '双语版式',
  'bilingual reading': '双语阅读',
  translation: '翻译',
  documentation: '文档',
  'original sentence': '原句',
  collocation: '搭配',
  collocations: '搭配',
  accessibility: '无障碍',
  'Technical vocabulary': '技术词汇',
  'working memory': '工作记忆',
  'mutation observer': '变更观察器',
  'accessibility tree': '无障碍树',
  'switching tabs': '切换标签页',
  API: '接口',
  'built-in': '内置',
  'A demo page to try the extension, and to see how the bilingual layout behaves.': '用这一页试试扩展，也看看双语版式实际是什么样子。',
  'Get started': '开始使用',
  'Save changes': '保存修改',
  'Export report': '导出报告',
  Pricing: '定价',
  Documentation: '文档',
  'Why bilingual reading works better': '为什么双语阅读更高效',
  'Reading technical documentation in a second language is slow but valuable. A bilingual layout keeps the original sentence in place while placing a translation directly underneath, so you can check a term without losing your position in the text.':
    '用第二语言读技术文档既慢又费力，但收获很大。双语版式把原文留在原位，把译文直接放在下面，你查术语时不会丢掉正在读的位置。',
  'The extension only inserts new elements. It never rewrites the page, which means links, buttons, forms and selection still behave exactly as before.':
    '扩展只插入新元素，从不改写页面，因此链接、按钮、表单和选中行为都和原来完全一样。',
  'What gets translated': '哪些内容会被翻译',
  'Paragraphs, headings, list items and table cells.': '段落、标题、列表项和表格单元格。',
  'Short interface labels such as buttons, tabs and menu entries.': '按钮、标签页、菜单等界面短文字。',
  'Content that appears later, for example after scrolling or switching tabs.': '之后才出现的内容，例如滚动加载或切换标签后出现的文字。',
  Feature: '功能',
  Behaviour: '行为',
  Default: '默认',
  'Display mode': '显示方式',
  'Show the translation below each paragraph, or replace the source text.': '在每段下方显示译文，或直接替换原文。',
  Bilingual: '双语对照',
  'Translation engine': '翻译引擎',
  'Chrome built-in model, Google endpoint, or your own API key.': 'Chrome 内置模型、Google 接口，或你自己的 API Key。',
  Automatic: '自动',
  'Code blocks': '代码块',
  'Left untouched on purpose, so snippets stay copyable.': '有意保持不动，方便复制代码片段。',
  Skipped: '跳过',
  'Configuration example': '配置示例',
  'Code and configuration are skipped by design. This paragraph should still be translated.':
    '代码和配置会被有意跳过，但这一段仍然应该被翻译。',
  'Privacy first': '隐私优先',
  'The offline model never sends page text anywhere.': '离线模型不会把页面文字发到任何地方。',
  'Works with SPAs': '支持单页应用',
  'New content is picked up by a mutation observer.': '新出现的内容会被 MutationObserver 捕获。',
  'One keystroke': '一个快捷键',
  'Press Alt+T to toggle translation on the current tab.': '按 Alt+T 即可在当前标签页开关翻译。',
  'This page is part of the extension package and is not translated on first load until you ask for it.':
    '本页属于扩展包的一部分，在你主动翻译之前不会被翻译。'
};

const DEMO_ITEMS = [
  ['Gloss — read English with Chinese folded in', 'Gloss · 把中文夹进英文里读'],
  ['A demo page to try the extension, and to see how the bilingual layout behaves.', '用这一页试试扩展，也看看双语版式实际是什么样子。'],
  ['Why bilingual reading works better', '为什么双语阅读更高效'],
  [
    'Reading technical documentation in a second language is slow but valuable. A bilingual layout keeps the original sentence in place while placing a translation directly underneath, so you can check a term without losing your position in the text.',
    '用第二语言读技术文档既慢又费力，但收获很大。双语版式把原文留在原位，把译文直接放在下面，你查术语时不会丢掉正在读的位置。'
  ],
  [
    'The extension only inserts new elements. It never rewrites the page, which means links, buttons, forms and selection still behave exactly as before.',
    '扩展只插入新元素，从不改写页面，因此链接、按钮、表单和选中行为都和原来完全一样。'
  ],
  ['What gets translated', '哪些内容会被翻译'],
  ['Paragraphs, headings, list items and table cells.', '段落、标题、列表项和表格单元格。'],
  ['Short interface labels such as buttons, tabs and menu entries.', '按钮、标签页、菜单等界面短文字。'],
  ['Content that appears later, for example after scrolling or switching tabs.', '之后才出现的内容，例如滚动加载或切换标签后出现的文字。'],
  ['Display mode', '显示方式'],
  ['Show the translation below each paragraph, or replace the source text.', '在每段下方显示译文，或直接替换原文。'],
  ['Translation engine', '翻译引擎'],
  ['Chrome built-in model, Google endpoint, or your own API key.', 'Chrome 内置模型、Google 接口，或你自己的 API Key。'],
  ['Code blocks', '代码块'],
  ['Left untouched on purpose, so snippets stay copyable.', '有意保持不动，方便复制代码片段。'],
  ['Privacy first', '隐私优先'],
  ['The offline model never sends page text anywhere.', '离线模型不会把页面文字发到任何地方。'],
  ['Works with SPAs', '支持单页应用'],
  ['New content is picked up by a mutation observer.', '新出现的内容会被 MutationObserver 捕获。']
];

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function fixPaths(html) {
  return html.replace(/(href|src)="([^"]+)"/g, (full, attr, value) => {
    if (/^(https?:|file:|data:|#|\/)/.test(value) || value.startsWith('..')) return full;
    return attr + '="../../' + value + '"';
  });
}

function write(name, html) {
  fs.writeFileSync(path.join(previewDir, name), html, 'utf8');
  return path.join(previewDir, name);
}

const chromeStub = `
  <script>
  window.chrome = {
    runtime: {
      id: 'docs-preview',
      lastError: null,
      getURL: function (p) { return p; },
      getManifest: function () { return { version: '1.1.0' }; },
      sendMessage: function (msg, cb) {
        var out = window.__runtimeReplies ? window.__runtimeReplies(msg) : { ok: true };
        if (typeof cb === 'function') setTimeout(function () { cb(out); }, 0);
        return Promise.resolve(out);
      },
      onMessage: {
        addListener: function (fn) {
          window.__msgListeners = window.__msgListeners || [];
          window.__msgListeners.push(fn);
        }
      }
    },
    storage: {
      local: {
        get: function (key, cb) {
          var all = window.__storageReplies ? window.__storageReplies() : {};
          var out;
          if (key == null) out = all;
          else if (typeof key === 'string') { out = {}; out[key] = all[key]; }
          else { out = {}; (key || []).forEach(function (k) { out[k] = all[k]; }); }
          if (typeof cb === 'function') setTimeout(function () { cb(out); }, 0);
          return Promise.resolve(out);
        },
        set: function (obj, cb) {
          if (typeof cb === 'function') setTimeout(function () { cb(); }, 0);
          return Promise.resolve();
        }
      },
      session: {
        get: function (key, cb) {
          var all = window.__sessionReplies ? window.__sessionReplies() : {};
          var out = typeof key === 'string' ? (function () { var o = {}; o[key] = all[key]; return o; })() : all;
          if (typeof cb === 'function') setTimeout(function () { cb(out); }, 0);
          return Promise.resolve(out);
        },
        set: function () { return Promise.resolve(); }
      },
      onChanged: { addListener: function () {} }
    }
  };
  </script>
`;

const translateStub = `
  <script>
  window.__ZH = ${JSON.stringify(ZH)};
  window.__ZH_LOW = {};
  Object.keys(window.__ZH).forEach(function (k) { window.__ZH_LOW[k.toLowerCase()] = window.__ZH[k]; });
  window.chrome.runtime.sendMessage = function (msg, cb) {
    var texts = (msg && msg.texts) || [];
    var results = texts.map(function (t) {
      var key = String(t).trim();
      return window.__ZH[key] || window.__ZH_LOW[key.toLowerCase()] || ('（演示译文）' + key.slice(0, 18));
    });
    setTimeout(function () { if (typeof cb === 'function') cb({ ok: true, results: results, engine: 'docs' }); }, 5);
  };
  window.chrome.storage.local.get = function (key, cb) {
    var out = { 'dsbt:settings': { enabled: true, autoRun: true, mode: 'bilingual', lang: 'zh', learn: true, zhScale: 1 } };
    if (typeof cb === 'function') setTimeout(function () { cb(out); }, 0);
    return Promise.resolve(out);
  };
  </script>
`;

/* ------------------------------------------------------------------ */
/* 1) 页面 + 译文（编号、悬停高亮）                                     */
/* ------------------------------------------------------------------ */

const demo = read('test/demo.html');
const demoBase = fixPaths(demo.replace('</body>', '')).replace('</html>', '');

const hoverScript = `
  <script>
    (function () {
      var ticks = 0;
      function finish() {
        var blocks = Array.prototype.slice.call(document.querySelectorAll('[data-dsbt-n]'));
        // 悬停一段译文 -> 对应英文段落出现高亮描边
        var candidates = blocks.filter(function (b) {
          var prev = b.previousElementSibling;
          return prev && prev.tagName === 'P' && prev.textContent.length > 120;
        });
        var hot = candidates[0] || blocks[3];
        if (hot) {
          var owner = hot.previousElementSibling;
          if (owner) owner.setAttribute('data-dsbt-hit', '');
        }
        var hot = document.querySelector('[data-dsbt-hit]');
        document.documentElement.setAttribute('data-docs-info', JSON.stringify({
          zh: document.querySelectorAll('.dsbt-zh').length,
          numbered: document.querySelectorAll('[data-dsbt-n]').length,
          hit: hot ? hot.tagName : null,
          hitRect: hot ? hot.getBoundingClientRect().toJSON() : null,
          hud: (function () { var h = document.getElementById('dsbt-hud-host'); return h ? h.textContent : null; })(),
          visibility: document.visibilityState,
          loaded: !!window.__dsbtLoaded,
          status: window.__status,
          textApi: typeof window.DSBTText,
          sampleEnglish: (function () {
            try { return window.DSBTText.isEnglishLike('Reading technical documentation in a second language', { minLength: 2 }); } catch (e) { return 'err:' + e.message; }
          })(),
          listeners: (window.__msgListeners || []).length,
          enabled: (function () { try { return window.__dbgEnabled; } catch (e) { return null; } })(),
          errs: window.__errs || [],
          viewport: { w: innerWidth, h: innerHeight }
        }));
        document.documentElement.setAttribute('data-docs-ready', '1');
      }
      window.__status = null;
      function ask(type) {
        (window.__msgListeners || []).forEach(function (fn) {
          try {
            fn({ type: type }, {}, function (res) { if (type === 'dsbt:status') window.__status = res; });
          } catch (e) { window.__errs.push(type + ': ' + e.message); }
        });
      }
      setTimeout(function () { ask('dsbt:scan'); }, 1200);
      setTimeout(function () { ask('dsbt:status'); }, 4000);

      var timer = setInterval(function () {
        ticks += 1;
        if (document.querySelectorAll('.dsbt-zh').length >= 16) {
          clearInterval(timer);
          setTimeout(finish, 400);
        } else if (ticks > 90) {
          clearInterval(timer);
          finish();
        }
      }, 120);
    })();
  </script>
`;

const annotateScript = `
  <script>
    (function () {
      function waitFor(pred, fn) {
        var ticks = 0;
        var t = setInterval(function () {
          ticks += 1;
          if (pred()) { clearInterval(t); setTimeout(fn, 120); }
          else if (ticks > 110) { clearInterval(t); fn(); }
        }, 100);
      }
      function textNodeWith(snippet) {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue && node.nodeValue.indexOf(snippet) !== -1) return node;
        }
        return null;
      }
      function selectSnippet(snippet, length) {
        var node = textNodeWith(snippet);
        if (!node) return false;
        var start = node.nodeValue.indexOf(snippet);
        var range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + Math.min(length || snippet.length, node.nodeValue.length - start));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
      function bar() {
        var host = document.getElementById('dsbt-anno-host');
        return host && host.shadowRoot;
      }
      function shotReady() {
        var root = bar();
        var tb = root && root.querySelector('.bar');
        var pop = root && root.querySelector('.note-box');
        var r = tb ? tb.getBoundingClientRect() : null;
        var p = pop ? pop.getBoundingClientRect() : null;
        var ta = root && root.querySelector('textarea');
        document.documentElement.setAttribute('data-docs-info', JSON.stringify({
          zh: document.querySelectorAll('.dsbt-zh').length,
          marks: (function () {
            var hl = window.CSS && CSS.highlights && CSS.highlights.get('dsbt-hl-yellow');
            return hl ? hl.size : 0;
          })(),
          notes: document.querySelectorAll('[data-dsbt-note-card]').length,
          toolbarShown: !!(tb && tb.getBoundingClientRect().height),
          toolbarRect: r ? r.toJSON() : null,
          noteShown: !!(pop && p && p.height),
          noteRect: p ? p.toJSON() : null,
          noteValue: ta ? ta.value : '',
          viewport: { w: innerWidth, h: innerHeight }
        }));
        document.documentElement.setAttribute('data-docs-ready', '1');
      }

      waitFor(function () {
        return document.querySelectorAll('.dsbt-zh').length >= 16 && bar();
      }, function () {
        // 先高亮第一段的一句
        if (selectSnippet('Reading technical documentation in a second language is slow but valuable.', 62)) {
          setTimeout(function () {
            var root = bar();
            var dot = root && root.querySelector('.dot[data-hl="yellow"]');
            if (dot) dot.click();

            // 再选中第二段一句，打开笔记气泡
            setTimeout(function () {
              if (selectSnippet('It never rewrites the page', 27)) {
                setTimeout(function () {
                  var r = bar();
                  var noteBtn = r && r.querySelector('[data-act="note"]');
                  if (noteBtn) noteBtn.click();
                  setTimeout(function () {
                    var box = r && r.querySelector('textarea');
                    if (box) {
                      box.value = '重点：只插入节点，不改写页面';
                      box.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    var save = r && r.querySelector('[data-act="save"]');
                    if (save) save.click();
                    setTimeout(shotReady, 400);
                  }, 200);
                }, 260);
              } else {
                shotReady();
              }
            }, 420);
          }, 320);
        } else {
          shotReady();
        }
      });
    })();
  </script>
`;

const errTrap = `<script>
  window.__errs = [];
  window.addEventListener('error', function (e) { window.__errs.push(String(e.message || e.error)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__errs.push('reject: ' + String(e.reason && e.reason.message ? e.reason.message : e.reason));
  });
</script>`;

const contentCss = '<link rel="stylesheet" href="../../content.css" />';

write('demo-bilingual.html', demoBase + errTrap + contentCss + chromeStub + translateStub +
  '<script src="../../lib/text.js"></script><script src="../../lib/terms.js"></script><script src="../../content.js"></script>' +
  hoverScript + '</body></html>');

write('demo-annotate.html', demoBase + errTrap + contentCss + chromeStub + translateStub +
  '<script src="../../lib/text.js"></script><script src="../../lib/terms.js"></script><script src="../../content.js"></script>' +
  '<script src="../../annotate.js"></script>' + annotateScript + '</body></html>');

/* ------------------------------------------------------------------ */
/* 2) 导出页                                                            */
/* ------------------------------------------------------------------ */

const exportHtml = fixPaths(read('export.html'));
const exportModel = {
  title: 'Bilingual Translator — Demo Page',
  url: 'http://127.0.0.1:8777/test/demo.html',
  site: '127.0.0.1',
  createdAt: '2026-11-04T08:10:00.000Z',
  items: DEMO_ITEMS.map(([en, zh], i) => ({
    en,
    zh,
    n: i + 1,
    note: i === 3 ? '这段是全文重点：双语版式不打断阅读位置' : ''
  })),
  notes: [{ text: 'It never rewrites the page', note: '重点：只插入节点，不改写页面' }]
};

const exportStub = `
  <script>
    window.__sessionReplies = function () {
      return { 'dsbt:export': ${JSON.stringify({ model: exportModel, options: { paper: 'A4', fontSize: 16, margin: 18, includeNotes: true, includeOriginal: true } })} };
    };
    window.__storageReplies = function () { return {}; };
  </script>
  ${chromeStub}
`;

const exportAfter = `
  <script>
    setTimeout(function () {
      var iframe = document.getElementById('preview');
      document.documentElement.setAttribute('data-docs-info', JSON.stringify({
        meta: document.getElementById('meta').textContent,
        srcdocLength: iframe ? (iframe.srcdoc || '').length : 0,
        paperLabel: document.getElementById('paperLabel').textContent,
        message: document.getElementById('message').textContent,
        frameRect: iframe ? iframe.getBoundingClientRect().toJSON() : null,
        viewport: { w: innerWidth, h: innerHeight }
      }));
      document.documentElement.setAttribute('data-docs-ready', '1');
    }, 1200);
  </script>
`;

write('export.html',
  exportHtml.replace('<script src="../../lib/report.js"></script>', exportStub + '<script src="../../lib/report.js"></script>')
    .replace('</body>', exportAfter + '</body>'));

/* ------------------------------------------------------------------ */
/* 3) 弹窗（用量面板）                                                   */
/* ------------------------------------------------------------------ */

const popupHtml = fixPaths(read('popup.html'));

const usage = {
  ok: true,
  today: { prompt: 4820, completion: 1960, requests: 9, cost: 0.0253 },
  total: { prompt: 26140, completion: 11380, requests: 46, cost: 0.1434 },
  byDay: {},
  models: [
    { model: 'deepseek-chat', bucket: { prompt: 26140, completion: 11380, requests: 46 }, price: { in: 2, out: 8 }, cost: 0.1434 },
    { model: 'google', bucket: { prompt: 3800, completion: 0, requests: 3 }, price: { in: 0, out: 0 }, cost: 0 }
  ],
  engines: {},
  pricing: {},
  defaults: {},
  updatedAt: Date.now()
};

const settings = {
  enabled: true,
  autoRun: true,
  mode: 'bilingual',
  lang: 'zh',
  learn: true,
  engine: 'auto',
  zhScale: 1,
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  pricing: {},
  exportOptions: { paper: 'A4', fontSize: 16, margin: 18, includeNotes: true, includeOriginal: true }
};

const popupStub = `
  <script>
    window.__storageReplies = function () { return { 'dsbt:settings': ${JSON.stringify(settings)} }; };
    window.__runtimeReplies = function (msg) {
      if (msg && msg.type === 'dsbt:usage:get') return ${JSON.stringify(usage)};
      if (msg && msg.type === 'dsbt:usage:reset') return ${JSON.stringify({ ...usage, today: { prompt: 0, completion: 0, requests: 0, cost: 0 }, total: { prompt: 0, completion: 0, requests: 0, cost: 0 }, models: [] })};
      if (msg && msg.type === 'dsbt:diagnose') return { ok: true, lines: [] };
      return { ok: true };
    };
  </script>
  ${chromeStub}
  <script>
    window.chrome.tabs = {
      query: function () {
        return Promise.resolve([{ id: 1, url: 'https://example.com/guide/getting-started', title: 'Getting started – Example Docs' }]);
      },
      sendMessage: function (tabId, msg) {
        if (msg && msg.type === 'dsbt:ping') return Promise.resolve({ ok: true });
        if (msg && msg.type === 'dsbt:status') {
          return Promise.resolve({
            ok: true, pairs: 36, notes: 2, url: 'https://example.com/guide/getting-started',
            title: 'Getting started – Example Docs', state: 'done', engine: 'custom'
          });
        }
        return Promise.resolve({ ok: true });
      },
      create: function () { return Promise.resolve({}); }
    };
    window.chrome.scripting = { executeScript: function () { return Promise.resolve([]); }, insertCSS: function () { return Promise.resolve([]); } };
  </script>
`;

const popupAfter = `
  <script>
    setTimeout(function () {
      var btn = document.querySelector('[data-tab="usage"]');
      if (btn) btn.click();
      setTimeout(function () {
        document.documentElement.setAttribute('data-docs-info', JSON.stringify({
          tab: (document.querySelector('.tab.active') || {}).textContent,
          costToday: document.getElementById('costToday').textContent,
          tokToday: document.getElementById('tokToday').textContent,
          costTotal: document.getElementById('costTotal').textContent,
          tokTotal: document.getElementById('tokTotal').textContent,
          rows: Array.prototype.map.call(document.querySelectorAll('.usage-row'), function (r) { return r.textContent; }),
          panelVisible: getComputedStyle(document.getElementById('panel-usage')).display,
          scrollHeight: document.documentElement.scrollHeight,
          contentBottom: (function () {
            var f = document.querySelector('footer');
            return f ? Math.ceil(f.getBoundingClientRect().bottom) : document.documentElement.scrollHeight;
          })(),
          viewport: { w: innerWidth, h: innerHeight }
        }));
        document.documentElement.setAttribute('data-docs-ready', '1');
      }, 500);
    }, 700);
  </script>
`;

write('popup.html',
  popupHtml.replace('<script src="../../lib/pricing.js"></script>', popupStub + '<script src="../../lib/pricing.js"></script>')
    .replace('</body>', popupAfter + '</body>'));

/* ------------------------------------------------------------------ */
/* 4) 截图                                                              */
/* ------------------------------------------------------------------ */

function shoot(file, out, width, height, budget) {
  const target = path.join(imgDir, out);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=' + width + ',' + height,
    '--virtual-time-budget=' + (budget || 12000),
    '--screenshot=' + target,
    'file://' + file
  ], { stdio: 'ignore' });
  return target;
}

function measure(file) {
  const html = execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=400,700',
    '--virtual-time-budget=6000',
    '--dump-dom',
    'file://' + file
  ], { encoding: 'utf8' });
  const m = html.match(/data-docs-info="([^"]+)"/);
  if (!m) return null;
  const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}


const termsScript = `
  <script>
    (function () {
      var ticks = 0;
      function trim() {
        var heads = Array.prototype.slice.call(document.querySelectorAll('.wrap > h2'));
        var head = heads.filter(function (h) { return /terms and collocations/i.test(h.textContent); })[0];
        if (!head) return null;
        var wrap = head.parentElement;
        Array.prototype.slice.call(wrap.children).forEach(function (el) {
          if (el === head) return;
          var after = head.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (!after) el.remove();
        });
        return head;
      }
      function ready() {
        var chips = document.querySelectorAll('.dsbt-term');
        var first = chips[0];
        var r = first ? first.getBoundingClientRect() : null;
        document.documentElement.setAttribute('data-docs-info', JSON.stringify({
          chips: chips.length,
          zh: document.querySelectorAll('.dsbt-zh').length,
          firstChip: r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) } : null,
          terms: Array.prototype.map.call(chips, function (c) { return c.textContent; })
        }));
        document.documentElement.setAttribute('data-docs-ready', '1');
      }
      var timer = setInterval(function () {
        ticks += 1;
        if (document.querySelectorAll('.dsbt-term').length >= 4) {
          var head = trim();
          if (head) {
            clearInterval(timer);
            setTimeout(ready, 400);
          }
        }
        if (ticks > 90) {
          clearInterval(timer);
          ready();
        }
      }, 120);
    })();
  </script>
`;

write('demo-terms.html', demoBase + errTrap + contentCss + chromeStub + translateStub +
  '<script src="../../lib/text.js"></script><script src="../../lib/terms.js"></script><script src="../../content.js"></script>' +
  termsScript + '</body></html>');

const popupPanelAfter = `
  <script>
    setTimeout(function () {
      var t = document.querySelector('[data-tab="translate"]');
      if (t) t.click();
      setTimeout(function () {
        document.documentElement.setAttribute('data-docs-info', JSON.stringify({
          tab: (document.querySelector('.tab.active') || {}).textContent,
          contentBottom: Math.round(document.querySelector('footer').getBoundingClientRect().bottom),
          errs: (window.__errs || []).slice(0, 3)
        }));
      }, 500);
    }, 700);
  </script>
`;

write('popup-panel.html',
  popupHtml.replace('<script src="../../lib/pricing.js"></script>', popupStub + '<script src="../../lib/pricing.js"></script>')
    .replace('</body>', popupPanelAfter + '</body>'));

const popupPanelInfo = measure(path.join(previewDir, 'popup-panel.html'));
const popupPanelHeight = Math.min(1400, Math.max(420, Math.round((popupPanelInfo && popupPanelInfo.contentBottom) || 600) + 6));

const popupInfo = measure(path.join(previewDir, 'popup.html'));
const popupHeight = Math.min(1400, Math.max(420, Math.round((popupInfo && popupInfo.contentBottom) || 600) + 6));

const shots = [
  shoot(path.join(previewDir, 'popup-panel.html'), '00-panel.png', 400, popupPanelHeight),
  shoot(path.join(previewDir, 'demo-bilingual.html'), '01-bilingual.png', 960, 1100),
  shoot(path.join(previewDir, 'demo-annotate.html'), '02-annotate.png', 960, 1000, 16000),
  shoot(path.join(previewDir, 'export.html'), '03-export.png', 1280, 860),
  shoot(path.join(previewDir, 'popup.html'), '04-usage.png', 400, popupHeight),
  shoot(path.join(previewDir, 'demo-terms.html'), '05-terms.png', 1200, 820, 20000)
];

// 截图是 2x 像素密度，缩到适合 README 的宽度，减小体积
for (const shot of shots) {
  const width = Number(execFileSync('sips', ['-g', 'pixelWidth', shot], { encoding: 'utf8' }).match(/(\d+)\s*$/m)[1]);
  if (width > 1400) {
    execFileSync('sips', ['--resampleWidth', '1000', shot], { stdio: 'ignore' });
  }
}

for (const s of shots) {
  const kb = Math.round(fs.statSync(s).size / 1024);
  console.log(path.relative(root, s) + '  ' + kb + ' KB');
}