/**
 * background.js 逻辑测试：在 Node 里用假的 chrome.* 与 fetch 跑真实代码。
 * node test/background.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

/* ---------------- 假 chrome ---------------- */

let store = {};

function createChrome() {
  const listeners = { onMessage: [], onInstalled: [], onStartup: [], onChanged: [] };
  return {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          return Object.assign({}, store);
        },
        async set(obj) {
          const changed = {};
          for (const [k, v] of Object.entries(obj)) {
            changed[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          listeners.onChanged.forEach((fn) => fn(changed, 'local'));
        }
      },
      session: {
        async get(key) {
          return { [key]: store['session:' + key] };
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store['session:' + k] = v;
        }
      },
      onChanged: { addListener: (fn) => listeners.onChanged.push(fn) }
    },
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + p,
      onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
      onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
      onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
      lastError: null
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    },
    commands: { onCommand: { addListener: () => {} } },
    tabs: {
      query: async () => [],
      sendMessage: async () => {},
      create: async (opts) => {
        createTabCalls.push(opts);
        return { id: 1 };
      }
    },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {
        throw new Error('不应在本次测试中创建 offscreen 文档');
      }
    }
  };
}

/* ---------------- 假 fetch ---------------- */

let fetchCalls = [];
let createTabCalls = [];
let fetchImpl = async () => {
  throw new Error('fetch not stubbed');
};

const fakeFetch = async (url, init) => {
  fetchCalls.push({ url, init });
  return fetchImpl(url, init);
};

function loadBackground() {
  store = {
    'dsbt:settings': {
      enabled: true,
      mode: 'bilingual',
      lang: 'zh',
      engine: 'custom',
      apiBase: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model'
    }
  };
  fetchCalls = [];
  createTabCalls = [];
  const sandbox = {
    chrome: createChrome(),
    fetch: fakeFetch,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL
  };
  vm.createContext(sandbox);
  // background.js 用 importScripts 加载 lib/pricing.js
  sandbox.importScripts = (name) => {
    const file = path.join(root, name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: name });
  };
  vm.runInContext(source, sandbox, { filename: 'background.js' });
  return sandbox;
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
    process.exitCode = 1;
  }
}

// vm 上下文里的数组/对象与主上下文原型不同，用 JSON 比较值
function same(actual, expected, msg) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);
}

function customResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify(payload) } }]
      };
    }
  };
}

console.log('custom 引擎');

await test('翻译多条并保持顺序', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const texts = JSON.parse(body.messages[1].content).texts;
    return customResponse({ translations: texts.map((t) => '译:' + t) });
  };
  const res = await ctx.handleTranslate({ texts: ['Hello', 'Save changes'] });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.engine, 'custom');
  same(res.results, ['译:Hello', '译:Save changes']);
});

await test('去重：相同文本只请求一次', async () => {
  const ctx = loadBackground();
  let sent = null;
  fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent = JSON.parse(body.messages[1].content).texts;
    return customResponse({ translations: sent.map((t) => '译:' + t) });
  };
  const res = await ctx.handleTranslate({ texts: ['Same', 'Same', 'Other'] });
  same(sent, ['Same', 'Other']);
  same(res.results, ['译:Same', '译:Same', '译:Other']);
});

await test('缓存：第二次不再发请求', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const texts = JSON.parse(JSON.parse(init.body).messages[1].content).texts;
    return customResponse({ translations: texts.map((t) => '译:' + t) });
  };
  await ctx.handleTranslate({ texts: ['Cached text'] });
  const before = fetchCalls.length;
  const res = await ctx.handleTranslate({ texts: ['Cached text'] });
  assert.equal(fetchCalls.length, before, '第二次不应再请求');
  same(res.results, ['译:Cached text']);
});

await test('API 401 时返回中文错误', async () => {
  const ctx = loadBackground();
  fetchImpl = async () => ({
    ok: false,
    status: 401,
    async text() {
      return 'Unauthorized';
    }
  });
  const res = await ctx.handleTranslate({ texts: ['Hello'] });
  assert.equal(res.ok, false);
  assert.match(res.error, /Key|401|拒绝/);
});

await test('接口返回被代码块包裹的 JSON 也能解析', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const texts = JSON.parse(JSON.parse(init.body).messages[1].content).texts;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '```json\n' + JSON.stringify({ translations: texts.map((t) => '译:' + t) }) + '\n```' } }]
        };
      }
    };
  };
  const res = await ctx.handleTranslate({ texts: ['Wrapped'] });
  assert.equal(res.ok, true);
  same(res.results, ['译:Wrapped']);
});

await test('接口少返回条目时用空串补齐而不报错', async () => {
  const ctx = loadBackground();
  fetchImpl = async () => customResponse({ translations: ['只有一个'] });
  const res = await ctx.handleTranslate({ texts: ['A', 'B'] });
  assert.equal(res.ok, true);
  assert.equal(res.results[0], '只有一个');
  assert.equal(res.results[1], '');
});

await test('请求体包含目标语言与模型名', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const texts = JSON.parse(JSON.parse(init.body).messages[1].content).texts;
    return customResponse({ translations: texts.map(() => '中文') });
  };
  await ctx.handleTranslate({ texts: ['Hello'], lang: 'zh-Hant' });
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.model, 'test-model');
  assert.match(body.messages[0].content, /繁体|Traditional/);
  assert.equal(fetchCalls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer sk-test');
});

await test('parseJsonLoose 容错', async () => {
  const ctx = loadBackground();
  same(ctx.parseJsonLoose('前言 {"a":1} 后记'), { a: 1 });
  assert.equal(ctx.parseJsonLoose('完全不是 JSON'), null);
});

await test('chatEndpoint 处理已带路径的地址', async () => {
  const ctx = loadBackground();
  assert.equal(ctx.chatEndpoint('https://x.com/v1/'), 'https://x.com/v1/chat/completions');
  assert.equal(ctx.chatEndpoint('https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions');
  assert.throws(() => ctx.chatEndpoint(''));
});

console.log('\n用量统计');

await test('翻译后记录 token 与花费', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const texts = JSON.parse(JSON.parse(init.body).messages[1].content).texts;
    return customResponse({ translations: texts.map((t) => '译:' + t) });
  };
  await ctx.handleTranslate({ texts: ['Hello world', 'Save changes'] });
  const usage = store['dsbt:usage'];
  assert.ok(usage, '应写入用量');
  assert.equal(usage.total.requests, 1);
  assert.ok(usage.total.prompt > 0, 'prompt token 应大于 0');
  assert.ok(usage.total.completion > 0, 'completion token 应大于 0');
  assert.ok(usage.total.cost > 0, '自定义模型应产生费用');
  assert.ok(usage.byModel['test-model'], '应记录到具体模型');
  assert.ok(usage.byEngine.custom, '应记录到引擎');
});

await test('接口返回 usage 时以官方数字为准', async () => {
  const ctx = loadBackground();
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
        choices: [{ message: { content: JSON.stringify({ translations: ['中文'] }) } }]
      };
    }
  });
  await ctx.handleTranslate({ texts: ['Hello'] });
  const usage = store['dsbt:usage'];
  assert.equal(usage.total.prompt, 1000);
  assert.equal(usage.total.completion, 200);
  // test-model 不在价目表里，用兜底价 2 / 8 元每百万
  const expected = (1000 / 1e6) * 2 + (200 / 1e6) * 8;
  assert.ok(Math.abs(usage.total.cost - expected) < 1e-9, 'cost=' + usage.total.cost);
});

await test('命中缓存不重复计费', async () => {
  const ctx = loadBackground();
  fetchImpl = async (url, init) => {
    const texts = JSON.parse(JSON.parse(init.body).messages[1].content).texts;
    return customResponse({ translations: texts.map((t) => '译:' + t) });
  };
  await ctx.handleTranslate({ texts: ['Hello'] });
  const first = store['dsbt:usage'].total.requests;
  await ctx.handleTranslate({ texts: ['Hello'] });
  assert.equal(store['dsbt:usage'].total.requests, first, '第二次全命中缓存，不应新增请求');
});

await test('usageSummary 汇总今日与模型明细', async () => {
  const ctx = loadBackground();
  fetchImpl = async () => customResponse({ translations: ['中文'] });
  await ctx.handleTranslate({ texts: ['Hello'] });
  const summary = await ctx.usageSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.today.requests, 1);
  assert.equal(summary.total.requests, 1);
  assert.ok(Array.isArray(summary.models) && summary.models.length >= 1);
  assert.ok(summary.models[0].cost > 0);
});

await test('自定义单价会改变估算金额', async () => {
  const ctx = loadBackground();
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        usage: { prompt_tokens: 1e6, completion_tokens: 0 },
        choices: [{ message: { content: JSON.stringify({ translations: ['中文'] }) } }]
      };
    }
  });
  store['dsbt:settings'].pricing = { 'test-model': { in: 10, out: 30 } };
  await ctx.handleTranslate({ texts: ['Hello'] });
  // completion 未给数字时按字符估算，允许极小误差
  assert.ok(Math.abs(store['dsbt:usage'].total.cost - 10) < 0.01, 'cost=' + store['dsbt:usage'].total.cost);
});

console.log('\n导出');

await test('导出页会拿到模型与选项，并打开新标签页', async () => {
  const ctx = loadBackground();
  const model = { title: 'Demo', items: [{ en: 'Hello', zh: '你好' }] };
  const res = await ctx.openExport({ model, options: { paper: 'A5', fontSize: 18 } });
  assert.equal(res.ok, true);
  const saved = store['session:dsbt:export'];
  assert.ok(saved && saved.model, '应写入 session 存储');
  assert.equal(saved.model.items.length, 1);
  assert.equal(saved.options.paper, 'A5');
  assert.equal(createTabCalls.length, 1);
  assert.match(createTabCalls[0].url, /export\.html$/);
});

console.log('\n' + passed + ' tests passed');