/**
 * popup.js — 弹出面板：开关、显示方式、引擎配置、当前页统计。
 */
'use strict';

const SETTINGS_KEY = 'dsbt:settings';

const LANG_VALUES = ['zh', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'ru'];
const LANG_LABEL = {
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский'
};

const DEFAULTS = {
  enabled: false,
  autoRun: true,
  mode: 'bilingual',
  lang: 'zh',
  learn: true,
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

const $ = (id) => document.getElementById(id);

const el = {
  enabled: $('enabled'),
  status: $('status'),
  scan: $('scan'),
  clear: $('clear'),
  mode: document.querySelectorAll('input[name="mode"]'),
  lang: $('lang'),
  learn: $('learn'),
  engine: $('engine'),
  custom: $('custom'),
  apiBase: $('apiBase'),
  apiKey: $('apiKey'),
  model: $('model'),
  test: $('test'),
  diag: $('diag'),
  message: $('message'),
  version: $('version'),
  zhScale: $('zhScale'),
  zhScaleOut: $('zhScaleOut'),
  paper: $('paper'),
  fontSize: $('fontSize'),
  fontSizeOut: $('fontSizeOut'),
  margin: $('margin'),
  includeOriginal: $('includeOriginal'),
  includeNotes: $('includeNotes'),
  exportOpen: $('exportOpen'),
  costToday: $('costToday'),
  tokToday: $('tokToday'),
  costTotal: $('costTotal'),
  tokTotal: $('tokTotal'),
  usageModels: $('usageModels'),
  priceModel: $('priceModel'),
  priceIn: $('priceIn'),
  priceOut: $('priceOut'),
  usageRefresh: $('usageRefresh'),
  usageReset: $('usageReset')
};

let settings = Object.assign({}, DEFAULTS);
let activeTab = null;
let statusTimer = 0;

/* ------------------------------------------------------------------ */
/* 基础                                                                */
/* ------------------------------------------------------------------ */

function setMessage(text, isError) {
  el.message.textContent = text || '';
  el.message.classList.toggle('err', !!isError);
}

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.classList.remove('ok', 'err');
  if (kind) el.status.classList.add(kind);
}

async function loadSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  settings = Object.assign({}, DEFAULTS, (res && res[SETTINGS_KEY]) || {});
  renderSettings();
}

function renderSettings() {
  el.enabled.checked = settings.enabled === true;
  el.lang.value = LANG_VALUES.indexOf(settings.lang) >= 0 ? settings.lang : 'zh';
  el.learn.checked = settings.learn !== false;
  el.engine.value = settings.engine || 'auto';
  el.apiBase.value = settings.apiBase || '';
  el.apiKey.value = settings.apiKey || '';
  el.model.value = settings.model || '';

  const mode = settings.mode === 'replace' ? 'replace' : 'bilingual';
  el.mode.forEach((input) => {
    input.checked = input.value === mode;
  });

  el.custom.classList.toggle('hidden', el.engine.value !== 'custom');

  const scale = Number(settings.zhScale);
  el.zhScale.value = String(Number.isFinite(scale) && scale >= 0.8 && scale <= 1.6 ? scale : 1);
  el.zhScaleOut.textContent = Number(el.zhScale.value).toFixed(2) + '×';

  const opts = Object.assign(
    { paper: 'A4', fontSize: 16, margin: 18, includeNotes: true, includeOriginal: true },
    settings.exportOptions || {}
  );
  el.paper.value = opts.paper;
  el.fontSize.value = String(opts.fontSize);
  el.margin.value = String(opts.margin);
  el.includeNotes.checked = opts.includeNotes !== false;
  el.includeOriginal.checked = opts.includeOriginal !== false;
  el.fontSizeOut.textContent = opts.fontSize + 'px';

  renderPriceInputs();
}

async function saveSettings(patch) {
  settings = Object.assign({}, settings, patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  el.custom.classList.toggle('hidden', el.engine.value !== 'custom');
}

/* ------------------------------------------------------------------ */
/* 页面通信                                                             */
/* ------------------------------------------------------------------ */

async function findActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function ensureContentScript(tab) {
  if (!tab || tab.id == null) return false;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'dsbt:ping' });
    if (res && res.ok) return true;
  } catch (e) {
    /* 页面尚未注入 */
  }
  const inject = async (allFrames) => {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames }, files: ['content.css'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames },
      files: ['lib/text.js', 'content.js']
    });
  };

  try {
    await inject(true);
    await new Promise((r) => setTimeout(r, 250));
    return true;
  } catch (e) {
    // 某些 iframe 不允许注入，退回到只注入主框架
    try {
      await inject(false);
      await new Promise((r) => setTimeout(r, 250));
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function refreshStatus() {
  if (!activeTab || activeTab.id == null) {
    setStatus('请切换到普通网页后使用', 'err');
    return;
  }
  const url = activeTab.url || '';
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(url) || /^https?:\/\/chromewebstore\.google\.com/i.test(url)) {
    setStatus('浏览器内置页面或扩展商店不允许注入脚本，请换一个普通网页', 'err');
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'dsbt:status' });
    if (!res || !res.ok) {
      setStatus('本页脚本未就绪，点击「翻译本页」即可启动', '');
      return;
    }
    const done = res.stats ? res.stats.done : 0;
    const langLabel = LANG_LABEL[res.lang] || LANG_LABEL.zh;
    if (res.error) setStatus('翻译失败：' + res.error, 'err');
    else if (!settings.enabled) setStatus('默认关闭 · 打开右上角开关，或点「翻译本页」', '');
    else if (res.pending > 0) setStatus('正在翻译… 已完成 ' + done + ' 处', '');
    else if (done > 0) setStatus('已插入 ' + done + ' 处' + langLabel + '译文', 'ok');
    else setStatus('暂未翻译；点击「翻译本页」开始', '');
  } catch (e) {
    setStatus('本页脚本未就绪，点击「翻译本页」即可启动', '');
  }
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

el.enabled.addEventListener('change', async () => {
  await saveSettings({ enabled: el.enabled.checked });
  const tab = await findActiveTab();
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'dsbt:status' }).catch(() => {});
  }
  setTimeout(refreshStatus, 200);
});

el.mode.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    saveSettings({ mode: input.value });
  });
});

el.lang.addEventListener('change', () => saveSettings({ lang: el.lang.value }));
el.learn.addEventListener('change', () => saveSettings({ learn: el.learn.checked }));
el.engine.addEventListener('change', () => saveSettings({ engine: el.engine.value }));

let apiTimer = 0;
function bindApiInput(input, key) {
  input.addEventListener('input', () => {
    clearTimeout(apiTimer);
    apiTimer = setTimeout(() => saveSettings({ [key]: input.value.trim() }), 300);
  });
}
bindApiInput(el.apiBase, 'apiBase');
bindApiInput(el.apiKey, 'apiKey');
bindApiInput(el.model, 'model');

el.scan.addEventListener('click', async () => {
  setMessage('');
  const tab = await findActiveTab();
  if (!tab) {
    setStatus('没有可用的标签页', 'err');
    return;
  }
  if (!settings.enabled) {
    await saveSettings({ enabled: true });
    el.enabled.checked = true;
    await new Promise((r) => setTimeout(r, 150));
  }
  const ok = await ensureContentScript(tab);
  if (!ok) {
    setStatus('无法注入脚本，请刷新页面后重试（浏览器内置页面不支持）', 'err');
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'dsbt:scan' });
    if (res && res.ok === false) setStatus(res.error || '翻译失败', 'err');
    else setStatus('已开始翻译本页…', '');
  } catch (e) {
    setStatus('与本页通信失败，请刷新页面后重试', 'err');
  }
  setTimeout(refreshStatus, 800);
});

el.clear.addEventListener('click', async () => {
  const tab = await findActiveTab();
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'dsbt:clear' });
    setStatus('已清除本页译文', 'ok');
  } catch (e) {
    setStatus('本页没有可清除的译文', '');
  }
});

el.test.addEventListener('click', async () => {
  el.test.disabled = true;
  setMessage('正在测试翻译引擎…');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'dsbt:test',
      text: 'Read the documentation to get started.',
      lang: settings.lang
    });
    if (res && res.ok) {
      setMessage('引擎：' + res.engine + '　译文：' + res.text, false);
    } else {
      setMessage('失败：' + ((res && res.error) || '未知错误'), true);
    }
  } catch (e) {
    setMessage('失败：' + String(e && e.message ? e.message : e), true);
  } finally {
    el.test.disabled = false;
  }
});

el.diag.addEventListener('click', async () => {
  el.diag.disabled = true;
  setMessage('正在检测…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'dsbt:diagnose' });
    if (!res || !res.ok) {
      setMessage('检测失败：' + ((res && res.error) || '未知错误'), true);
      return;
    }
    const builtinMap = {
      available: '已就绪',
      downloadable: '可下载（首次需联网）',
      downloading: '下载中',
      unavailable: '不可用',
      unsupported: '不支持（需 Chrome 138+）'
    };
    setMessage(
      '当前引擎：' + res.engine + '\n' +
      'Chrome 内置：' + (builtinMap[res.builtin] || res.builtin) + '\n' +
      'Google 接口：' + (res.google ? '可访问' : '不可访问') + '\n' +
      '自定义 API：' + (res.custom ? '已配置（' + (res.model || '') + '）' : '未配置'),
      false
    );
  } catch (e) {
    setMessage('检测失败：' + String(e && e.message ? e.message : e), true);
  } finally {
    el.diag.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* 标签页                                                              */
/* ------------------------------------------------------------------ */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  ['translate', 'export', 'usage'].forEach((n) => {
    const panel = $('panel-' + n);
    if (panel) panel.classList.toggle('hidden', n !== name);
  });
  if (name === 'usage') refreshUsage();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ------------------------------------------------------------------ */
/* 字号                                                                */
/* ------------------------------------------------------------------ */

let scaleTimer = 0;
el.zhScale.addEventListener('input', () => {
  el.zhScaleOut.textContent = Number(el.zhScale.value).toFixed(2) + '×';
  clearTimeout(scaleTimer);
  scaleTimer = setTimeout(() => saveSettings({ zhScale: Number(el.zhScale.value) }), 200);
});

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

function exportOptions() {
  return {
    paper: el.paper.value,
    fontSize: Number(el.fontSize.value),
    margin: Number(el.margin.value),
    includeNotes: el.includeNotes.checked,
    includeOriginal: el.includeOriginal.checked
  };
}

function syncExportOptions() {
  el.fontSizeOut.textContent = el.fontSize.value + 'px';
  saveSettings({ exportOptions: exportOptions() });
}

[el.paper, el.fontSize, el.margin, el.includeOriginal, el.includeNotes].forEach((input) => {
  input.addEventListener('input', syncExportOptions);
  input.addEventListener('change', syncExportOptions);
});

el.exportOpen.addEventListener('click', async () => {
  el.exportOpen.disabled = true;
  setMessage('正在收集本页译文…');
  try {
    const tab = await findActiveTab();
    if (!tab || tab.id == null) {
      setMessage('请先切到要导出的网页', true);
      return;
    }
    const ok = await ensureContentScript(tab);
    if (!ok) {
      setMessage('无法读取页面内容，请刷新页面后重试', true);
      return;
    }
    let model = null;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'dsbt:export' });
      if (res && res.ok) model = res.model;
    } catch (e) {
      model = null;
    }
    if (!model) {
      setMessage('读取本页译文失败，请刷新页面后重试', true);
      return;
    }
    if (!Array.isArray(model.items) || !model.items.length) {
      setMessage('这一页还没有译文：先点「翻译本页」，再回来导出', true);
      return;
    }
    const opened = await chrome.runtime.sendMessage({
      type: 'dsbt:export:open',
      model,
      options: exportOptions()
    });
    if (opened && opened.ok) {
      setMessage('已打开导出预览');
      window.close();
    } else {
      setMessage('打开导出页失败：' + ((opened && opened.error) || '未知错误'), true);
    }
  } catch (e) {
    setMessage('导出失败：' + String((e && e.message) ? e.message : e), true);
  } finally {
    el.exportOpen.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* 用量                                                                */
/* ------------------------------------------------------------------ */

const Price = window.DSBTPrice;

function fmtTokens(n) {
  return Price ? Price.formatTokens(n) : String(Math.round(Number(n) || 0));
}

function fmtCny(n) {
  return Price ? Price.formatCny(n) : '¥' + Number(n || 0).toFixed(3);
}

function renderUsageRow(model, bucket, cost) {
  const row = document.createElement('div');
  row.className = 'usage-row';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = model;
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = fmtCny(cost) + ' · ' + fmtTokens((bucket.prompt || 0) + (bucket.completion || 0)) + ' tok';
  row.appendChild(name);
  row.appendChild(num);
  return row;
}

function renderUsage(res) {
  if (!res || !res.ok) {
    setMessage('读取用量失败：' + ((res && res.error) || '未知错误'), true);
    return;
  }
  const today = res.today || { prompt: 0, completion: 0, requests: 0, cost: 0 };
  const total = res.total || { prompt: 0, completion: 0, requests: 0, cost: 0 };
  el.costToday.textContent = fmtCny(today.cost);
  el.tokToday.textContent = fmtTokens((today.prompt || 0) + (today.completion || 0)) + ' tokens · ' + (today.requests || 0) + ' 次';
  el.costTotal.textContent = fmtCny(total.cost);
  el.tokTotal.textContent = fmtTokens((total.prompt || 0) + (total.completion || 0)) + ' tokens · ' + (total.requests || 0) + ' 次';

  el.usageModels.textContent = '';
  const models = (res.models || []).filter((m) => m && m.bucket && m.bucket.requests);
  if (!models.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有翻译记录';
    el.usageModels.appendChild(empty);
    return;
  }
  models.sort((a, b) => (b.bucket.requests || 0) - (a.bucket.requests || 0));
  models.forEach((m) => el.usageModels.appendChild(renderUsageRow(m.model, m.bucket, m.cost)));
}

async function refreshUsage() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'dsbt:usage:get' });
    renderUsage(res);
  } catch (e) {
    setMessage('读取用量失败：' + String((e && e.message) ? e.message : e), true);
  }
}

function currentModelName() {
  return String(settings.model || 'deepseek-chat').trim() || 'deepseek-chat';
}

function renderPriceInputs() {
  const name = currentModelName();
  el.priceModel.textContent = name;
  const price = Price ? Price.resolvePrice(name, settings.pricing || {}) : { in: 0, out: 0 };
  el.priceIn.value = String(price.in);
  el.priceOut.value = String(price.out);
}

function savePrice() {
  const name = currentModelName();
  const table = Object.assign({}, settings.pricing || {});
  table[name] = { in: Math.max(0, Number(el.priceIn.value) || 0), out: Math.max(0, Number(el.priceOut.value) || 0) };
  saveSettings({ pricing: table }).then(() => refreshUsage());
}

el.priceIn.addEventListener('change', savePrice);
el.priceOut.addEventListener('change', savePrice);
el.usageRefresh.addEventListener('click', refreshUsage);
el.usageReset.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'dsbt:usage:reset' });
  renderUsage(res);
  setMessage('用量已清零');
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

(async function init() {
  el.version.textContent = 'v' + chrome.runtime.getManifest().version;
  await loadSettings();
  activeTab = await findActiveTab();
  await refreshStatus();
  statusTimer = setInterval(refreshStatus, 1500);
  window.addEventListener('unload', () => clearInterval(statusTimer));
})();