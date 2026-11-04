/**
 * lib/report.js — 把双语对照结果渲染成「可转发 / 可打印」的独立 HTML。
 *
 * 生成物完全自包含（内联样式、无外链），直接发邮件、存 U 盘、发微信都能打开；
 * @page 规则让浏览器打印时按所选纸张出 PDF。
 */
(function (root) {
  'use strict';

  /** 纸张尺寸（毫米） */
  const PAPERS = {
    A4: { w: 210, h: 297, label: 'A4（210 × 297 mm）' },
    A5: { w: 148, h: 210, label: 'A5（148 × 210 mm）' },
    B5: { w: 176, h: 250, label: 'B5（176 × 250 mm）' },
    Letter: { w: 215.9, h: 279.4, label: 'Letter（8.5 × 11 in）' }
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function paperOf(name) {
    return PAPERS[name] || PAPERS.A4;
  }

  function normalizeOptions(options) {
    const o = options || {};
    const paperName = PAPERS[o.paper] ? o.paper : 'A4';
    const fontSize = Math.min(24, Math.max(11, Number(o.fontSize) || 16));
    const margin = Math.min(40, Math.max(8, Number(o.margin) || 18));
    return {
      paper: paperName,
      fontSize,
      margin,
      includeNotes: o.includeNotes !== false,
      includeOriginal: o.includeOriginal !== false
    };
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderItems(model, opts) {
    const items = Array.isArray(model && model.items) ? model.items : [];
    return items
      .map((item, i) => {
        const en = String((item && item.en) || '').trim();
        const zh = String((item && item.zh) || '').trim();
        if (!zh && !(opts.includeOriginal && en)) return '';
        const parts = [];
        parts.push('<section class="pair">');
        parts.push('<div class="num">' + (i + 1) + '</div>');
        parts.push('<div class="body">');
        if (opts.includeOriginal && en) {
          parts.push('<p class="en" lang="en">' + escapeHtml(en) + '</p>');
        }
        if (zh) {
          parts.push('<p class="zh" lang="zh-CN">' + escapeHtml(zh) + '</p>');
        }
        if (opts.includeNotes && item && item.note) {
          parts.push('<p class="note"><span class="note-label">笔记</span>' + escapeHtml(item.note) + '</p>');
        }
        parts.push('</div></section>');
        return parts.join('');
      })
      .join('\n');
  }

  function renderLooseNotes(model, opts) {
    const notes = Array.isArray(model && model.notes) ? model.notes : [];
    const list = notes.filter((n) => n && (n.note || n.text));
    if (!opts.includeNotes || !list.length) return '';
    return (
      '<section class="loose-notes"><h2>页内笔记（' + list.length + '）</h2><ol>' +
      list
        .map((n) => {
          const quote = String(n.text || '').trim();
          const body = String(n.note || '').trim();
          return (
            '<li>' + (quote ? '<q>' + escapeHtml(quote.slice(0, 240)) + '</q>' : '') +
            (body ? '<span>' + escapeHtml(body) + '</span>' : '') + '</li>'
          );
        })
        .join('') +
      '</ol></section>'
    );
  }

  function buildReportHtml(model, options) {
    const m = model || {};
    const opts = normalizeOptions(options || m.options);
    const paper = paperOf(opts.paper);
    const items = Array.isArray(m.items) ? m.items : [];
    const count = items.filter((it) => it && String(it.zh || '').trim()).length;
    const title = String(m.title || '').trim() || '双语对照阅读';
    const url = String(m.url || '').trim();
    const site = String(m.site || '').trim();
    const metaBits = [site, url ? url.replace(/^https?:\/\//, '') : '', formatDate(m.createdAt), count + ' 段']
      .filter(Boolean);

    const css = [
      ':root{--paper-w:' + paper.w + 'mm;--pad:' + opts.margin + 'mm;--fs:' + opts.fontSize + 'px}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0;background:#e9ebf1;color:#17181c}',
      'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased}',
      '.page{width:var(--paper-w);margin:24px auto;background:#fff;padding:var(--pad);',
      'box-shadow:0 1px 2px rgba(16,20,40,.06),0 18px 48px rgba(16,20,40,.14),inset 0 0 0 1px rgba(24,26,35,.05);font-size:var(--fs);line-height:1.68}',
      'header.doc{border-bottom:1px solid #e2e5ee;padding-bottom:10px;margin-bottom:18px}',
      'header.doc h1{margin:0 0 6px;font-size:calc(var(--fs) * 1.5);font-weight:600;line-height:1.24;letter-spacing:-.02em}',
      'header.doc .meta{font-size:calc(var(--fs) * .72);color:#8b8d95;word-break:break-all}',
      'header.doc .meta span+span::before{content:" · ";color:#c3c6cf}',
      'section.pair{display:flex;gap:10px;margin:0 0 14px;break-inside:avoid;page-break-inside:avoid}',
      'section.pair .num{flex:0 0 auto;width:1.9em;padding-top:.15em;text-align:right;',
      'font-size:calc(var(--fs) * .66);color:#9a9ca4;font-variant-numeric:tabular-nums}',
      'section.pair .body{flex:1 1 auto;min-width:0}',
      'p.en{margin:0;color:#17181c}',
      'p.zh{margin:.18em 0 0;padding-left:.6em;border-left:2px solid rgba(96,100,112,.35);color:#3f424b}',
      'p.note{margin:.3em 0 0;padding:.38em .55em;background:#f4f5f8;border-left:3px solid rgba(96,100,112,.5);border-radius:6px;',
      'font-size:calc(var(--fs) * .8);color:#33414f;white-space:pre-wrap}',
      'p.note .note-label{display:inline-block;margin-right:.4em;padding:0 .35em;border-radius:3px;',
      'background:#3a3c44;color:#fff;font-size:.82em}',
      'section.loose-notes{margin-top:26px;padding-top:14px;border-top:1px solid #e2e5ee}',
      'section.loose-notes h2{margin:0 0 8px;font-size:calc(var(--fs) * .9);font-weight:600;color:#17181c}',
      'section.loose-notes ol{margin:0;padding-left:1.2em;font-size:calc(var(--fs) * .82);color:#3f424b}',
      'section.loose-notes li{margin:0 0 .5em}',
      'section.loose-notes q{display:block;color:#8b8d95;font-style:italic}',
      'footer.doc{margin-top:26px;padding-top:10px;border-top:1px solid #e2e5ee;',
      'font-size:calc(var(--fs) * .68);color:#9a9ca4;display:flex;justify-content:space-between;gap:12px}',
      'footer.doc a{color:#4a4c55;text-decoration:none}',
      '@page{size:' + opts.paper + ';margin:' + opts.margin + 'mm}',
      '@media print{html,body{background:#fff}.page{width:auto;margin:0;box-shadow:none;padding:0;',
      'max-width:none}section.pair{padding-bottom:2px}}',
      '@media (max-width:640px){.page{width:auto;margin:0;padding:14px;box-shadow:none}}'
    ].join('');

    return [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(title) + ' · 双语对照</title>',
      '<style>' + css + '</style></head><body>',
      '<main class="page">',
      '<header class="doc"><h1>' + escapeHtml(title) + '</h1>',
      '<div class="meta">' + metaBits.map((b) => '<span>' + escapeHtml(b) + '</span>').join('') + '</div></header>',
      renderItems(m, opts),
      renderLooseNotes(m, opts),
      '<footer class="doc"><span>Gloss · 夹译 — 原文保留</span>' +
        (url ? '<span><a href="' + escapeHtml(url) + '">查看原文</a></span>' : '<span></span>') +
        '</footer>',
      '</main></body></html>'
    ].join('\n');
  }

  function buildMarkdown(model) {
    const m = model || {};
    const items = Array.isArray(m.items) ? m.items : [];
    const title = String(m.title || '').trim() || '双语对照阅读';
    const lines = ['# ' + title, ''];
    const meta = [m.site, m.url].filter(Boolean);
    if (meta.length) lines.push('> ' + meta.join(' · '), '');
    items.forEach((item, i) => {
      const en = String((item && item.en) || '').trim();
      const zh = String((item && item.zh) || '').trim();
      if (!zh && !en) return;
      if (en) lines.push(en);
      if (zh) lines.push('**' + zh + '**');
      if (item && item.note) lines.push('> 笔记：' + item.note);
      lines.push('');
      if (i === items.length - 1) lines.push('');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  const api = { PAPERS, paperOf, normalizeOptions, buildReportHtml, buildMarkdown, escapeHtml, formatDate };
  root.DSBTReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);