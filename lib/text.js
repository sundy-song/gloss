/**
 * lib/text.js — 纯文本判断工具，content.js 与测试共用。
 * 不依赖 DOM，可在浏览器与 Node 中直接加载。
 */
(function (root) {
  'use strict';

  /** 中日韩字符（含扩展 A、兼容区、日文假名） */
  const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  const LATIN_RE = /[A-Za-z]/g;

  const URL_LIKE_RE = /^(?:https?:\/\/|www\.)\S+$/i;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  /** 只有数字、标点、符号、emoji 的串 */
  const NO_LETTERS_RE = /^[^A-Za-z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+$/;

  function normalize(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function countMatches(re, text) {
    const m = String(text).match(re);
    return m ? m.length : 0;
  }

  /**
   * 是否值得翻译：有拉丁字母、中文占比不高、不是纯符号。
   * 允许混有少量中文（例如 "Chrome 浏览器"）。
   */
  function isEnglishLike(text, options) {
    const opts = options || {};
    const minLength = opts.minLength == null ? 2 : opts.minLength;
    const s = normalize(text);
    if (s.length < minLength) return false;
    if (NO_LETTERS_RE.test(s)) return false;

    const latin = countMatches(LATIN_RE, s);
    const cjk = countMatches(CJK_RE, s);
    if (latin < Math.max(1, minLength >= 2 ? 2 : 1)) return false;
    // 中文比英文还多，说明已经是中文内容
    if (cjk > latin * 0.5) return false;
    return true;
  }

  const KANA_RE = /[\u3040-\u30ff]/g;
  const HANGUL_RE = /[\uac00-\ud7af]/g;
  const CYRILLIC_RE = /[\u0400-\u04ff]/g;
  const LETTER_RE = /[A-Za-z\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g;

  /**
   * 这一段值不值得翻成 lang。
   * - 中文目标：沿用 isEnglishLike（拉丁字母为主、中文占比不高）
   * - 日/韩/俄：源文已经是目标文字时跳过
   * - 拉丁字母语言（西/法/德）：不做同文字判断，交给引擎
   */
  function isTranslatable(text, lang, options) {
    const opts = options || {};
    const s = normalize(text);
    if (s.length < (opts.minLength == null ? 2 : opts.minLength)) return false;
    if (shouldSkip(s)) return false;

    const target = String(lang || 'zh');
    if (/^zh/i.test(target)) return isEnglishLike(s, opts);

    const letters = countMatches(LETTER_RE, s);
    if (letters < 2) return false;

    if (/^ja/i.test(target)) return countMatches(KANA_RE, s) < letters * 0.2;
    if (/^ko/i.test(target)) return countMatches(HANGUL_RE, s) < letters * 0.2;
    if (/^ru/i.test(target)) return countMatches(CYRILLIC_RE, s) < letters * 0.2;
    return true;
  }

  /** 明显不该送去翻译的串：URL、邮箱、纯符号、超长无空格 token（哈希、base64） */
  function shouldSkip(text) {
    const s = normalize(text);
    if (!s) return true;
    if (URL_LIKE_RE.test(s)) return true;
    if (EMAIL_RE.test(s)) return true;
    if (NO_LETTERS_RE.test(s)) return true;

    // 单个超长 token，且没有空格：多半是 id / 哈希 / 代码
    if (s.length >= 32 && s.indexOf(' ') === -1) return true;
    return false;
  }

  /**
   * 把长文本按句末标点切成不超过 limit 的片段，避免单条请求过大。
   * 返回数组；无法切分时原样返回一项。
   */
  function chunkText(text, limit) {
    const max = limit || 900;
    const s = normalize(text);
    if (s.length <= max) return s ? [s] : [];

    const sentences = s.split(/(?<=[.!?;:])\s+/);
    const out = [];
    let buf = '';
    for (const part of sentences) {
      if (!buf) {
        buf = part;
      } else if (buf.length + 1 + part.length <= max) {
        buf += ' ' + part;
      } else {
        out.push(buf);
        buf = part;
      }
      while (buf.length > max) {
        out.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    }
    if (buf) out.push(buf);
    return out.length ? out : [s];
  }

  /** 把目标语言代码统一成扩展内部使用的形式：zh / zh-Hant / ja / ... */
  function normalizeLang(lang) {
    const s = String(lang || '').trim();
    if (!s) return 'zh';
    if (/^zh(-|_)?(hant|tw|hk|mo)$/i.test(s)) return 'zh-Hant';
    if (/^zh/i.test(s)) return 'zh';
    return s;
  }

  const api = {
    CJK_RE,
    LATIN_RE,
    normalize,
    isEnglishLike,
    isTranslatable,
    shouldSkip,
    chunkText,
    normalizeLang,
    countMatches
  };

  root.DSBTText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);