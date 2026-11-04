/**
 * lib/pricing.js — Token 估算与费用计算（人民币 / 每百万 tokens）。
 *
 * 单价为「参考价」，用户可在弹窗里改成自己实际结算的价格；
 * 内置引擎（Chrome 离线模型）与 Google 免费接口不产生费用。
 *
 * 同时被 background.js（importScripts）与弹窗/导出页（<script>）使用。
 */
(function (root) {
  'use strict';

  /** 单位：元 / 百万 tokens（in = 输入，out = 输出） */
  const DEFAULT_PRICES = {
    'deepseek-chat': { in: 2, out: 8 },
    'deepseek-reasoner': { in: 4, out: 16 },
    'gpt-4o-mini': { in: 1.1, out: 4.4 },
    'gpt-4o': { in: 18, out: 72 },
    'qwen-plus': { in: 0.8, out: 2 },
    'qwen-turbo': { in: 0.3, out: 0.6 },
    'moonshot-v1-8k': { in: 2, out: 10 },
    'glm-4-flash': { in: 0, out: 0 },
    'claude-3-5-haiku': { in: 6, out: 24 },
    builtin: { in: 0, out: 0 },
    google: { in: 0, out: 0 }
  };

  const FALLBACK_PRICE = { in: 2, out: 8 };

  function normalisePrice(p) {
    const input = Number(p && p.in);
    const output = Number(p && p.out);
    return {
      in: Number.isFinite(input) && input >= 0 ? input : FALLBACK_PRICE.in,
      out: Number.isFinite(output) && output >= 0 ? output : FALLBACK_PRICE.out
    };
  }

  /** 找到某模型的价格；优先用用户覆盖值 */
  function resolvePrice(model, overrides) {
    const key = String(model || '').trim();
    const table = overrides && typeof overrides === 'object' ? overrides : {};
    if (table[key]) return normalisePrice(table[key]);
    if (DEFAULT_PRICES[key]) return normalisePrice(DEFAULT_PRICES[key]);
    // 模糊匹配：deepseek-chat-xxx 也算 deepseek-chat
    for (const name of Object.keys(DEFAULT_PRICES)) {
      if (key && key.indexOf(name) === 0) return normalisePrice(DEFAULT_PRICES[name]);
    }
    for (const name of Object.keys(table)) {
      if (key && key.indexOf(name) === 0) return normalisePrice(table[name]);
    }
    return normalisePrice(FALLBACK_PRICE);
  }

  const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

  /**
   * 粗略估算 token：中日韩字符按 1 token/字，其余按 4 字符/token。
   * 误差通常在 ±20% 以内，用于成本预估足够。
   */
  function estimateTokens(text) {
    const s = String(text == null ? '' : text);
    let cjk = 0;
    let other = 0;
    for (const ch of s) {
      if (CJK_RE.test(ch)) cjk += 1;
      else other += 1;
    }
    return Math.ceil(cjk + other / 4);
  }

  /** 一次请求的花费（元） */
  function costOf(tokens, price) {
    const p = normalisePrice(price);
    const input = Number(tokens && tokens.promptTokens) || 0;
    const output = Number(tokens && tokens.completionTokens) || 0;
    return (input / 1e6) * p.in + (output / 1e6) * p.out;
  }

  function formatTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
    if (v >= 1e4) return (v / 1e4).toFixed(v >= 1e5 ? 0 : 1) + ' 万';
    return String(Math.round(v));
  }

  function formatCny(n) {
    const v = Number(n) || 0;
    if (v === 0) return '¥0';
    if (v < 0.0001) return '¥' + v.toFixed(6);
    if (v < 0.01) return '¥' + v.toFixed(4);
    if (v < 1) return '¥' + v.toFixed(3);
    if (v < 10) return '¥' + v.toFixed(2);
    return '¥' + v.toFixed(1);
  }

  const api = {
    DEFAULT_PRICES,
    FALLBACK_PRICE,
    normalisePrice,
    resolvePrice,
    estimateTokens,
    costOf,
    formatTokens,
    formatCny
  };

  root.DSBTPrice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);