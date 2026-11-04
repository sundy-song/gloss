/**
 * offscreen.js — 在隐藏页面里调用 Chrome 内置翻译模型（Translator API，Chrome 138+）。
 * 优点：离线、免费、文本不出本机（首次需要联网下载语言模型）。
 */
'use strict';

const sessions = new Map();
let chain = Promise.resolve();

function candidateTargets(lang) {
  return lang === 'zh-Hant' ? ['zh-Hant', 'zh-TW'] : ['zh', 'zh-Hans'];
}

function supported() {
  return typeof Translator !== 'undefined' && Translator && typeof Translator.create === 'function';
}

async function availabilityFor(lang) {
  if (!supported()) return 'unsupported';
  const targets = candidateTargets(lang);
  let result = 'unavailable';
  for (const target of targets) {
    try {
      const value = await Translator.availability({ sourceLanguage: 'en', targetLanguage: target });
      if (value === 'available' || value === 'downloading' || value === 'downloadable') return value;
      result = value || result;
    } catch (e) {
      result = result === 'unavailable' ? 'unsupported' : result;
    }
  }
  return result;
}

async function createSession(lang) {
  if (sessions.has(lang)) return sessions.get(lang);
  if (!supported()) throw new Error('当前 Chrome 不支持内置翻译（需要 Chrome 138 及以上）');

  let lastError = null;
  for (const target of candidateTargets(lang)) {
    try {
      const value = await Translator.availability({ sourceLanguage: 'en', targetLanguage: target });
      if (value === 'unavailable') continue;

      const translator = await Translator.create({
        sourceLanguage: 'en',
        targetLanguage: target,
        monitor(m) {
          m.addEventListener('downloadprogress', (event) => {
            try {
              console.log('[DSBT] 内置模型下载进度', Math.round((event.loaded || 0) * 100) + '%');
            } catch (e) {
              /* ignore */
            }
          });
        }
      });
      sessions.set(lang, translator);
      return translator;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('内置翻译模型不可用（可能需要联网下载语言包）');
}

async function translateTexts(texts, lang) {
  const translator = await createSession(lang);
  const results = [];
  for (const text of texts) {
    const value = String(text || '').trim();
    if (!value) {
      results.push('');
      continue;
    }
    try {
      results.push(await translator.translate(value));
    } catch (e) {
      results.push('');
    }
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.channel !== 'dsbt:offscreen') return;

  if (msg.type === 'availability') {
    availabilityFor(msg.lang || 'zh')
      .then((availability) => sendResponse({ ok: true, availability }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  if (msg.type === 'translate') {
    const texts = Array.isArray(msg.texts) ? msg.texts : [];
    chain = chain
      .then(() => translateTexts(texts, msg.lang || 'zh'))
      .then((results) => sendResponse({ ok: true, results }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
});