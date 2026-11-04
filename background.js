/**
 * background.js — 翻译调度：缓存、引擎选择（Chrome 内置 / Google 免费接口 / 自定义 API）。
 */
'use strict';

importScripts('lib/pricing.js');
const Price = (typeof self !== 'undefined' ? self : globalThis).DSBTPrice;

const SETTINGS_KEY = 'dsbt:settings';
const USAGE_KEY = 'dsbt:usage';

const DEFAULTS = {
  enabled: false,
  autoRun: true,
  mode: 'bilingual',
  lang: 'zh',
  engine: 'auto',
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  zhScale: 1,
  pricing: {},
  exportOptions: {
    paper: 'A4',
    fontSize: 16,
    margin: 18,
    includeNotes: true,
    includeOriginal: true
  }
};

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

async function getSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULTS, res ? res[SETTINGS_KEY] || {} : {});
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = Object.assign({}, current, patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function updateBadge() {
  try {
    const s = await getSettings();
    const on = s.enabled === true;
    await chrome.action.setBadgeBackgroundColor({ color: '#8a8e99' });
    await chrome.action.setBadgeText({ text: on ? '译' : '' });
  } catch (e) {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  if (!res || !res[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULTS });
  updateBadge();
  try {
    const maybe = chrome.action.setTitle({ title: 'Gloss · 夹译' });
    if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
  } catch (e) {
    /* ignore */
  }
});

chrome.runtime.onStartup.addListener(() => updateBadge());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) updateBadge();
});

/* ------------------------------------------------------------------ */
/* 缓存（内存 LRU，Service Worker 重启后自动失效）                      */
/* ------------------------------------------------------------------ */

const CACHE_LIMIT = 4000;
const memo = new Map();

function cacheGet(key) {
  if (!memo.has(key)) return undefined;
  const val = memo.get(key);
  memo.delete(key);
  memo.set(key, val);
  return val;
}

function cacheSet(key, value) {
  if (memo.has(key)) memo.delete(key);
  memo.set(key, value);
  if (memo.size > CACHE_LIMIT) {
    const oldest = memo.keys().next().value;
    memo.delete(oldest);
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const LANG_NAMES = {
  zh: ['简体中文', 'Simplified Chinese', 'zh-CN'],
  'zh-Hant': ['繁体中文', 'Traditional Chinese', 'zh-TW'],
  ja: ['日语', 'Japanese', 'ja'],
  ko: ['韩语', 'Korean', 'ko'],
  es: ['西班牙语', 'Spanish', 'es'],
  fr: ['法语', 'French', 'fr'],
  de: ['德语', 'German', 'de'],
  ru: ['俄语', 'Russian', 'ru']
};

function langNames(lang) {
  return LANG_NAMES[lang] || [lang, lang, lang];
}

function normalizeLang(lang) {
  const s = String(lang || 'zh');
  if (/^zh(-|_)?(hant|tw|hk|mo)$/i.test(s)) return 'zh-Hant';
  if (/^zh/i.test(s)) return 'zh';
  const base = s.toLowerCase().split(/[-_]/)[0];
  if (LANG_NAMES[base]) return base;
  return s || 'zh';
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function describeError(err) {
  const msg = String((err && err.message) || err || '未知错误');
  if (/Failed to fetch|NetworkError|load failed/i.test(msg)) return '网络请求失败，可能是网络不通或接口被拦截';
  if (/timeout|超时/i.test(msg)) return '请求超时';
  if (/abort/i.test(msg)) return '请求被中止或超时';
  if (/401|Unauthorized|invalid.*key/i.test(msg)) return 'API Key 无效或未配置';
  if (/402|insufficient|余额/i.test(msg)) return 'API 余额不足';
  if (/429|rate limit/i.test(msg)) return '请求过于频繁，请稍后重试';
  if (/403|Forbidden/i.test(msg)) return '接口拒绝访问（403）';
  if (/user gesture|NotAllowedError/i.test(msg)) return '需要先下载离线翻译包，请在页面右下角点击「下载并启用」';
  return msg;
}

/* ------------------------------------------------------------------ */
/* 引擎：Chrome 内置翻译（离线模型）                                    */
/* ------------------------------------------------------------------ */

let offscreenReady = null;

async function ensureOffscreen() {
  if (typeof chrome.offscreen === 'undefined') throw new Error('当前浏览器不支持 offscreen API');
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: '在后台页面调用 Chrome 内置翻译模型，进行离线双语翻译'
      })
      .finally(() => {
        offscreenReady = null;
      });
  }
  await offscreenReady;
}

async function callOffscreen(payload, timeoutMs) {
  await ensureOffscreen();
  const send = () => chrome.runtime.sendMessage(Object.assign({ channel: 'dsbt:offscreen' }, payload));
  const race = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);

  try {
    return await race(send(), timeoutMs || 60000);
  } catch (e) {
    // offscreen 文档可能刚创建、监听器尚未注册，重试一次
    if (/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) {
      await sleep(400);
      return race(send(), timeoutMs || 60000);
    }
    throw e;
  }
}

let availabilityCache = { at: 0, lang: '', value: '' };

async function builtinAvailability(lang, maxAgeMs) {
  const fresh = availabilityCache.lang === lang && Date.now() - availabilityCache.at < (maxAgeMs || 60000);
  if (fresh) return availabilityCache.value;
  let value = 'unsupported';
  try {
    const res = await callOffscreen({ type: 'availability', lang }, 15000);
    value = (res && res.ok && res.availability) || 'unsupported';
  } catch (e) {
    value = 'unsupported';
  }
  availabilityCache = { at: Date.now(), lang, value };
  return value;
}

async function builtinTranslate(texts, lang) {
  const res = await callOffscreen({ type: 'translate', texts, lang }, 180000);
  if (!res || !res.ok) {
    const message = (res && res.error) || 'Chrome 内置翻译不可用';
    const err = new Error(message);
    if (/user gesture|NotAllowedError/i.test(message)) err.needsGesture = true;
    throw err;
  }
  return res.results;
}

/* ------------------------------------------------------------------ */
/* 引擎：Google 免费接口                                               */
/* ------------------------------------------------------------------ */

let googleProbeCache = { at: 0, ok: false };

async function googleTranslateOne(text, lang) {
  const tl = langNames(lang)[2];
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' +
    encodeURIComponent(tl) +
    '&dt=t&q=' +
    encodeURIComponent(text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('Google 接口返回 HTTP ' + r.status);
    const data = await r.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Google 接口返回格式异常');
    return data[0].map((seg) => (Array.isArray(seg) ? seg[0] : '')).join('');
  } finally {
    clearTimeout(timer);
  }
}

async function googleTranslate(texts, lang) {
  const out = await mapPool(texts, 5, async (text) => {
    try {
      return await googleTranslateOne(text, lang);
    } catch (e) {
      return '';
    }
  });
  if (!out.some((x) => x)) throw new Error('Google 翻译不可用（接口无法访问）');
  return out;
}

async function probeGoogle() {
  const now = Date.now();
  if (now - googleProbeCache.at < 10 * 60 * 1000) return googleProbeCache.ok;
  let ok = false;
  try {
    ok = await Promise.race([
      googleTranslateOne('Settings', 'zh').then((r) => !!r),
      sleep(3000).then(() => false)
    ]);
  } catch (e) {
    ok = false;
  }
  googleProbeCache = { at: now, ok };
  return ok;
}

/* ------------------------------------------------------------------ */
/* 引擎：自定义 OpenAI 兼容接口（DeepSeek / 通义 / 本地 Ollama …）      */
/* ------------------------------------------------------------------ */

function chatEndpoint(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未配置 API 地址');
  if (/\/chat\/completions$/i.test(b)) return b;
  return b + '/chat/completions';
}

function parseJsonLoose(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {
        /* fallthrough */
      }
    }
    return null;
  }
}

async function customTranslate(texts, lang, settings) {
  const endpoint = chatEndpoint(settings.apiBase);
  const names = langNames(lang);
  const target = names[0] + '（' + names[1] + '）';
  const system =
    'You are a precise translation engine used inside a browser extension. ' +
    'Translate every string of the input JSON array into ' + target + '. ' +
    'Some strings are single terms or short collocations; translate them as a dictionary would, ' +
    'giving the most common meaning in that field rather than a full sentence. ' +
    'Keep code identifiers, URLs, e-mail addresses, numbers and product names unchanged. ' +
    'Preserve the original meaning and tone; do not add explanations. ' +
    'Return ONLY a JSON object like {"translations":["…","…"]} with exactly the same number of items in the same order.';

  const body = {
    model: settings.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify({ texts }) }
    ],
    stream: false,
    response_format: { type: 'json_object' }
  };

  async function request(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (settings.apiKey || '')
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw new Error('HTTP ' + r.status + (detail ? ' — ' + detail.slice(0, 200) : ''));
      }
      return r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  let data;
  try {
    data = await request(body);
  } catch (e) {
    // 某些兼容接口不支持 response_format，去掉后重试
    if (/400|response_format|json_object/i.test(String(e.message))) {
      const fallback = Object.assign({}, body);
      delete fallback.response_format;
      data = await request(fallback);
    } else {
      throw e;
    }
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = parseJsonLoose(content);
  const list = parsed && (Array.isArray(parsed) ? parsed : parsed.translations);
  if (!Array.isArray(list)) throw new Error('接口返回内容不是预期的 JSON 数组');
  const out = texts.map((_, i) => (typeof list[i] === 'string' ? list[i] : ''));
  if (!out.some(Boolean)) throw new Error('接口未返回译文');
  return { results: out, usage: (data && data.usage) || null, model: body.model };
}

/* ------------------------------------------------------------------ */
/* 引擎调度                                                            */
/* ------------------------------------------------------------------ */

async function resolveEngine(settings) {
  if (settings.engine && settings.engine !== 'auto') return settings.engine;
  const lang = normalizeLang(settings.lang);

  // 已下载的内置模型优先：离线、免费、不出本机
  const avail = await builtinAvailability(lang);
  if (avail === 'available') return 'builtin';
  // 用户配了自己的 Key，说明网络/合规上更可控，优先用它
  if (settings.apiKey && settings.apiBase) return 'custom';
  if (await probeGoogle()) return 'google';
  // 还没下载模型：走内置，由页面里的按钮触发一次性下载
  return 'builtin';
}

async function translateWith(engine, texts, lang, settings) {
  if (engine === 'builtin') {
    return { results: await builtinTranslate(texts, lang), usage: null, model: 'builtin' };
  }
  if (engine === 'google') {
    return { results: await googleTranslate(texts, lang), usage: null, model: 'google' };
  }
  if (engine === 'custom') return customTranslate(texts, lang, settings);
  throw new Error('未知翻译引擎：' + engine);
}

async function handleTranslate(msg) {
  const texts = Array.isArray(msg.texts) ? msg.texts.map((t) => String(t == null ? '' : t)) : [];
  if (!texts.length) return { ok: true, results: [], engine: 'none' };

  const settings = await getSettings();
  const lang = normalizeLang(msg.lang || settings.lang);

  let engine;
  try {
    engine = await resolveEngine(settings);
  } catch (e) {
    return { ok: false, error: describeError(e), engine: 'none' };
  }

  const results = new Array(texts.length).fill('');
  const missing = [];
  texts.forEach((text, i) => {
    const hit = cacheGet(engine + '|' + lang + '|' + text);
    if (hit !== undefined) results[i] = hit;
    else missing.push(i);
  });

  if (missing.length) {
    const unique = [];
    const seen = new Set();
    for (const i of missing) {
      const t = texts[i];
      if (!t || seen.has(t)) continue;
      seen.add(t);
      unique.push(t);
    }

    let payload;
    try {
      payload = await translateWith(engine, unique, lang, settings);
    } catch (e) {
      return { ok: false, error: describeError(e), engine, needsGesture: !!(e && e.needsGesture) };
    }

    const out = payload.results;
    const map = new Map();
    unique.forEach((t, i) => {
      const zh = String((out && out[i]) || '').trim();
      if (zh) {
        map.set(t, zh);
        cacheSet(engine + '|' + lang + '|' + t, zh);
      }
    });
    missing.forEach((i) => {
      const zh = map.get(texts[i]);
      if (zh) results[i] = zh;
    });

    try {
      await recordUsage({
        engine,
        model: payload.model || settings.model || engine,
        inputs: unique,
        outputs: out,
        usage: payload.usage,
        settings
      });
    } catch (e) {
      /* 统计失败不影响翻译本身 */
    }
  }

  return { ok: true, results, engine };
}

async function diagnose() {
  const settings = await getSettings();
  const lang = normalizeLang(settings.lang);
  const availability = await builtinAvailability(lang);
  const googleOk = await probeGoogle();
  return {
    ok: true,
    engine: await resolveEngine(settings).catch(() => 'none'),
    builtin: availability,
    google: googleOk,
    custom: Boolean(settings.apiKey && settings.apiBase),
    model: settings.model,
    apiBase: settings.apiBase
  };
}

/* ------------------------------------------------------------------ */
/* Token 用量与花费统计                                                 */
/* ------------------------------------------------------------------ */

const USAGE_DAYS_KEPT = 60;

function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function emptyBucket() {
  return { requests: 0, prompt: 0, completion: 0, cost: 0 };
}

function addInto(bucket, add) {
  bucket.requests += add.requests || 0;
  bucket.prompt += add.prompt || 0;
  bucket.completion += add.completion || 0;
  bucket.cost += add.cost || 0;
  return bucket;
}

async function readUsage() {
  const res = await chrome.storage.local.get(USAGE_KEY);
  const raw = (res && res[USAGE_KEY]) || {};
  return {
    version: 1,
    total: Object.assign(emptyBucket(), raw.total || {}),
    byDay: raw.byDay && typeof raw.byDay === 'object' ? raw.byDay : {},
    byModel: raw.byModel && typeof raw.byModel === 'object' ? raw.byModel : {},
    byEngine: raw.byEngine && typeof raw.byEngine === 'object' ? raw.byEngine : {},
    updatedAt: raw.updatedAt || 0
  };
}

/**
 * 记录一次翻译请求的 token 与花费。
 * 优先用接口返回的 usage，缺失时按字符估算；单价取用户覆盖值或内置参考价。
 */
async function recordUsage({ engine, model, inputs, outputs, usage, settings }) {
  const settingsNow = settings || (await getSettings());
  const inputText = (inputs || []).join('\n');
  const outputText = (outputs || []).map((x) => String(x == null ? '' : x)).join('\n');

  const promptTokens =
    usage && Number(usage.prompt_tokens) > 0 ? Number(usage.prompt_tokens) : Price.estimateTokens(inputText);
  const completionTokens =
    usage && Number(usage.completion_tokens) > 0
      ? Number(usage.completion_tokens)
      : Price.estimateTokens(outputText);

  const price = Price.resolvePrice(model, settingsNow.pricing);
  const cost = Price.costOf({ promptTokens, completionTokens }, price);
  const entry = { requests: 1, prompt: promptTokens, completion: completionTokens, cost };

  const u = await readUsage();
  addInto(u.total, entry);
  const day = todayKey();
  if (!u.byDay[day]) u.byDay[day] = emptyBucket();
  addInto(u.byDay[day], entry);
  if (!u.byModel[model]) u.byModel[model] = emptyBucket();
  addInto(u.byModel[model], entry);
  if (!u.byEngine[engine]) u.byEngine[engine] = emptyBucket();
  addInto(u.byEngine[engine], entry);

  const days = Object.keys(u.byDay).sort();
  if (days.length > USAGE_DAYS_KEPT) {
    days.slice(0, days.length - USAGE_DAYS_KEPT).forEach((d) => delete u.byDay[d]);
  }
  u.updatedAt = Date.now();
  await chrome.storage.local.set({ [USAGE_KEY]: u });
  return u;
}

async function usageSummary() {
  const settingsNow = await getSettings();
  const u = await readUsage();
  const day = todayKey();
  const today = Object.assign(emptyBucket(), u.byDay[day] || {});
  const models = Object.keys(u.byModel).map((name) => {
    const price = Price.resolvePrice(name, settingsNow.pricing);
    return {
      model: name,
      bucket: u.byModel[name],
      price,
      // 用当前单价重算，改价后历史金额也会跟着更新
      cost: Price.costOf({ promptTokens: u.byModel[name].prompt, completionTokens: u.byModel[name].completion }, price)
    };
  });
  return {
    ok: true,
    today,
    total: u.total,
    byDay: u.byDay,
    models,
    engines: u.byEngine,
    pricing: settingsNow.pricing || {},
    defaults: Price.DEFAULT_PRICES,
    updatedAt: u.updatedAt
  };
}

/* ------------------------------------------------------------------ */
/* 导出：把文档模型交给导出页                                          */
/* ------------------------------------------------------------------ */

async function openExport(payload) {
  const settingsNow = await getSettings();
  const options = Object.assign({}, settingsNow.exportOptions, (payload && payload.options) || {});
  await chrome.storage.local.set({ [SETTINGS_KEY]: Object.assign({}, settingsNow, { exportOptions: options }) });
  await chrome.storage.session.set({ 'dsbt:export': { model: payload.model || {}, options, at: Date.now() } });
  await chrome.tabs.create({ url: chrome.runtime.getURL('export.html') });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.channel === 'dsbt:offscreen') return; // 交给 offscreen 处理

  if (msg.type === 'dsbt:translate') {
    handleTranslate(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e), engine: 'none' }));
    return true;
  }

  if (msg.type === 'dsbt:diagnose') {
    diagnose()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }

  if (msg.type === 'dsbt:test') {
    handleTranslate({ texts: [msg.text || 'Settings'], lang: (msg && msg.lang) || 'zh' })
      .then((res) => sendResponse({ ok: res.ok, engine: res.engine, text: res.ok ? res.results[0] : '', error: res.error }))
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }

  if (msg.type === 'dsbt:usage:get') {
    usageSummary()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }

  if (msg.type === 'dsbt:usage:reset') {
    chrome.storage.local
      .set({ [USAGE_KEY]: null })
      .then(() => usageSummary())
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }

  if (msg.type === 'dsbt:export:open') {
    openExport(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }

  if (msg.type === 'dsbt:settings:get') {
    getSettings().then(sendResponse);
    return true;
  }

  if (msg.type === 'dsbt:settings:set') {
    setSettings(msg.patch || {})
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: describeError(e) }));
    return true;
  }
});

/* ------------------------------------------------------------------ */
/* 快捷键                                                              */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return;
  if (command === 'toggle-translate') {
    const s = await getSettings();
    await setSettings({ enabled: s.enabled !== true });
    return;
  }
  if (command === 'rescan-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'dsbt:scan' }).catch(() => {});
    return;
  }
  if (command === 'export-page') {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'dsbt:export' }).catch(() => null);
    if (res && res.ok && res.model && Array.isArray(res.model.items) && res.model.items.length) {
      await openExport({ model: res.model }).catch(() => {});
    } else {
      try {
        await chrome.action.setBadgeBackgroundColor({ color: '#b26a00' });
        await chrome.action.setBadgeText({ text: '无译文' });
        setTimeout(() => updateBadge(), 1600);
      } catch (e) {
        /* ignore */
      }
    }
  }
});