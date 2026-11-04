/**
 * export.js — 导出页：选择纸张 / 字号 / 页边距，实时预览，下载 HTML 或打印成 PDF。
 */
'use strict';

const Report = window.DSBTReport;
const $ = (id) => document.getElementById(id);

const el = {
  meta: $('meta'),
  paper: $('paper'),
  fontSize: $('fontSize'),
  fontSizeOut: $('fontSizeOut'),
  margin: $('margin'),
  includeOriginal: $('includeOriginal'),
  includeNotes: $('includeNotes'),
  download: $('download'),
  print: $('print'),
  markdown: $('markdown'),
  message: $('message'),
  preview: $('preview'),
  paperLabel: $('paperLabel')
};

let model = { items: [], notes: [] };
let options = { paper: 'A4', fontSize: 16, margin: 18, includeNotes: true, includeOriginal: true };

function setMessage(text, isError) {
  el.message.textContent = text || '';
  el.message.classList.toggle('err', !!isError);
}

function currentOptions() {
  return {
    paper: el.paper.value,
    fontSize: Number(el.fontSize.value),
    margin: Number(el.margin.value),
    includeNotes: el.includeNotes.checked,
    includeOriginal: el.includeOriginal.checked
  };
}

function render() {
  options = currentOptions();
  el.preview.srcdoc = Report.buildReportHtml(model, options);
  const paper = Report.paperOf(options.paper);
  el.paperLabel.textContent = options.paper + ' · ' + paper.w + ' × ' + paper.h + ' mm';
  el.preview.style.maxWidth = Math.round((paper.w / 25.4) * 96) + 'px';
  el.fontSizeOut.textContent = options.fontSize + 'px';
}

function fileStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

function safeName(text) {
  return String(text || '双语对照')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || '双语对照';
}

function downloadHtml() {
  const html = Report.buildReportHtml(model, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName(model.title) + '-' + fileStamp() + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setMessage('已发起下载：' + a.download + '（若浏览器提示「允许下载多个文件」，点允许即可）', false);
}

function printDoc() {
  const win = el.preview.contentWindow;
  if (!win) {
    setMessage('预览还没准备好，请稍等再试', true);
    return;
  }
  try {
    win.focus();
    win.print();
    setMessage('已打开打印窗口，选择「另存为 PDF」即可按 ' + options.paper + ' 导出', false);
  } catch (e) {
    setMessage('打印失败：' + String((e && e.message) || e), true);
  }
}

async function copyMarkdown() {
  const md = Report.buildMarkdown(model);
  try {
    await navigator.clipboard.writeText(md);
    setMessage('Markdown 已复制到剪贴板', false);
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = md;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      setMessage('Markdown 已复制到剪贴板', false);
    } catch (e2) {
      setMessage('复制失败，请手动选择预览内容复制', true);
    }
    area.remove();
  }
}

function bind() {
  ['paper', 'fontSize', 'margin', 'includeOriginal', 'includeNotes'].forEach((key) => {
    el[key].addEventListener('input', render);
    el[key].addEventListener('change', render);
  });
  el.download.addEventListener('click', downloadHtml);
  el.print.addEventListener('click', printDoc);
  el.markdown.addEventListener('click', copyMarkdown);
}

async function load() {
  let data = null;
  try {
    const res = await chrome.storage.session.get('dsbt:export');
    data = res && res['dsbt:export'];
  } catch (e) {
    data = null;
  }
  if (!data || !data.model) {
    el.meta.textContent = '没有可导出的内容';
    setMessage('请先在网页上点击「翻译本页」，再回到扩展面板选择「导出」。', true);
    el.preview.srcdoc =
      '<body style="font:14px/1.7 -apple-system,PingFang SC,sans-serif;color:#7b8698;padding:40px">还没有译文可导出。</body>';
    return;
  }
  model = data.model;
  options = Object.assign(options, data.options || {});

  el.paper.value = options.paper;
  el.fontSize.value = String(options.fontSize);
  el.margin.value = String(options.margin);
  el.includeNotes.checked = options.includeNotes !== false;
  el.includeOriginal.checked = options.includeOriginal !== false;

  const items = Array.isArray(model.items) ? model.items : [];
  const notes = Array.isArray(model.notes) ? model.notes : [];
  const withNote = items.filter((it) => it && it.note).length;
  el.meta.textContent =
    items.length + ' 段对照 · 笔记 ' + (notes.length + withNote) + ' 条 · ' + (model.site || '');
  render();
  if (!items.length) setMessage('这一页还没有译文，请先在网页上翻译本页。', true);
}

bind();
load();