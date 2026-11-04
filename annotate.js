/**
 * annotate.js — 页面批注：荧光笔、下划线、备注、字号。
 *
 * 只跑在顶层框架；批注按网址存 chrome.storage.local，刷新/重开页面自动恢复。
 * 批注锚点记录「元素 XPath + 文本偏移」，并用原文片段做兜底校验。
 */
(function () {
  'use strict';

  if (window.__dsbtAnnoLoaded) return;
  try {
    if (window.top !== window) return;
  } catch (e) {
    return;
  }
  window.__dsbtAnnoLoaded = true;

  const NOTES_KEY = 'dsbt:notes';
  const SETTINGS_KEY = 'dsbt:settings';
  const MAX_RECORDS_PER_PAGE = 500;
  const HOST_ID = 'dsbt-anno-host';

  const HIGHLIGHTS = { yellow: '#ffe9a3', green: '#cdf0d6', pink: '#ffd7de' };
  const SKIP_SELECTOR = '[data-dsbt-block],[data-dsbt-inline],.dsbt-note-pin,#dsbt-hud-host,#dsbt-anno-host';

  const state = {
    records: [],
    enabled: false,
    scale: 1,
    toolbar: null,
    pendingRange: null,
    pendingText: '',
    noteDraft: '',
    hostEl: null
  };

  /* ------------------------------------------------------------------ */
  /* 存储                                                                */
  /* ------------------------------------------------------------------ */

  function pageKey() {
    const u = new URL(location.href);
    return u.origin + u.pathname + u.search;
  }

  function newId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  async function readStore() {
    const res = await chrome.storage.local.get(NOTES_KEY);
    const map = (res && res[NOTES_KEY]) || {};
    return map && typeof map === 'object' ? map : {};
  }

  async function persist() {
    try {
      const map = await readStore();
      const key = pageKey();
      if (state.records.length) map[key] = state.records.slice(-MAX_RECORDS_PER_PAGE);
      else delete map[key];
      const keys = Object.keys(map);
      // 只保留最近 60 个页面的批注，避免无限增长
      if (keys.length > 60) {
        const drop = keys.slice(0, keys.length - 60);
        drop.forEach((k) => delete map[k]);
      }
      await chrome.storage.local.set({ [NOTES_KEY]: map });
    } catch (e) {
      /* 存储失败不影响阅读 */
    }
  }

  /* ------------------------------------------------------------------ */
  /* 文本锚点                                                            */
  /* ------------------------------------------------------------------ */

  function xpathOf(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let index = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) index += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/html/body/' + parts.join('/');
  }

  function resolveXPath(path) {
    if (!path) return null;
    const normalized = path.replace(/^\/html\/body\/?/, '');
    const segments = normalized.split('/').filter(Boolean);
    let node = document.body;
    for (const seg of segments) {
      const m = /^([a-z0-9-]+)\[(\d+)\]$/i.exec(seg);
      if (!m) return null;
      const tag = m[1].toUpperCase();
      const index = Number(m[2]);
      let count = 0;
      let found = null;
      for (const child of node.children) {
        if (child.tagName === tag) {
          count += 1;
          if (count === index) {
            found = child;
            break;
          }
        }
      }
      if (!found) return null;
      node = found;
    }
    return node;
  }

  /** 收集元素内的文本节点（带累计偏移），跳过译文/工具栏/角标 */
  function textNodesOf(root) {
    const out = [];
    let offset = 0;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          out.push({ node: child, start: offset, end: offset + child.nodeValue.length });
          offset += child.nodeValue.length;
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.matches && child.matches(SKIP_SELECTOR)) continue;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        walk(child);
      }
    };
    walk(root);
    return out;
  }

  function domRangeFor(anchorEl, start, end) {
    const nodes = textNodesOf(anchorEl);
    if (!nodes.length) return null;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    for (const item of nodes) {
      if (!startNode && start >= item.start && start <= item.end) {
        startNode = item.node;
        startOffset = start - item.start;
      }
      if (!endNode && end > item.start && end <= item.end) {
        endNode = item.node;
        endOffset = end - item.start;
      }
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch (e) {
      return null;
    }
    return range;
  }

  /* ------------------------------------------------------------------ */
  /* 应用 / 清除批注                                                     */
  /* ------------------------------------------------------------------ */

  const HL_NAMES = ['dsbt-hl-yellow', 'dsbt-hl-green', 'dsbt-hl-pink', 'dsbt-ul'];

  function groupOf(rec) {
    if (rec.kind === 'underline') return 'dsbt-ul';
    const color = HIGHLIGHTS[rec.color] ? rec.color : 'yellow';
    return 'dsbt-hl-' + color;
  }

  function registry() {
    return typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights : null;
  }

  /** 把记录还原成 Range：优先用 XPath + 偏移，失真时退回全文匹配 */
  function rangeFor(rec) {
    const anchorEl = resolveXPath(rec.anchor && rec.anchor.xpath);
    let range = anchorEl ? domRangeFor(anchorEl, rec.anchor.start, rec.anchor.end) : null;
    if (range && rec.anchor.text) {
      const got = range.toString().replace(/\s+/g, ' ').trim();
      const want = String(rec.anchor.text).replace(/\s+/g, ' ').trim();
      if (got !== want) range = null;
    }
    if (!range) {
      const needle = String(rec.anchor && rec.anchor.text ? rec.anchor.text : '').trim();
      if (needle) range = findTextRange(needle);
    }
    return range || null;
  }

  function blockFor(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-dsbt-block')) return el;
      const display = getComputedStyle(el).display;
      if (display && display !== 'inline' && display !== 'inline-block' && display !== 'contents') return el;
      el = el.parentElement;
    }
    return el && el !== document.body ? el : null;
  }

  function findTextRange(needle) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.indexOf(needle) === -1) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent && parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const node = walker.nextNode();
    if (!node) return null;
    const idx = node.nodeValue.indexOf(needle);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + needle.length);
    return range;
  }

  /** 重新计算高亮与笔记卡片；不改动原文任何节点 */
  function paint() {
    const reg = registry();
    if (!reg || typeof Highlight === 'undefined') return 0;
    HL_NAMES.forEach((name) => reg.delete(name));

    const groups = new Map();
    let applied = 0;
    if (state.enabled) {
      state.records.forEach((rec) => {
        const range = rangeFor(rec);
        if (!range) return;
        const name = groupOf(rec);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(range);
        applied += 1;
      });
    }
    groups.forEach((ranges, name) => {
      try {
        reg.set(name, new Highlight(...ranges));
      } catch (e) {
        /* 某些浏览器不支持注册，忽略 */
      }
    });

    renderNotes();
    return applied;
  }

  function renderNotes() {
    document.querySelectorAll('[data-dsbt-note-card]').forEach((el) => el.remove());
    if (!state.enabled) return;
    state.records.forEach((rec) => {
      if (!rec.note) return;
      const range = rangeFor(rec);
      const block = range ? blockFor(range.startContainer) : null;
      if (!block || !block.parentNode) return;

      const card = document.createElement('div');
      card.className = 'dsbt-note-card';
      card.setAttribute('data-dsbt-note-card', rec.id);

      const label = document.createElement('span');
      label.className = 'dsbt-note-label';
      label.textContent = '注';

      const text = document.createElement('p');
      text.textContent = rec.note;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dsbt-note-del';
      del.textContent = '删除';
      del.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeAnnotation(rec.id);
        persist();
      });

      card.appendChild(label);
      card.appendChild(text);
      card.appendChild(del);

      // 卡片放在译文（以及学词词卡）下面，阅读顺序是：原文 → 译文 → 词卡 → 笔记
      let anchor = block;
      for (;;) {
        const next = anchor.nextElementSibling;
        if (!next) break;
        if (next.hasAttribute('data-dsbt-block') || next.hasAttribute('data-dsbt-terms')) {
          anchor = next;
          continue;
        }
        break;
      }
      anchor.insertAdjacentElement('afterend', card);
    });
  }

  function applyAll() {
    return paint();
  }

  function removeAnnotation(id) {
    state.records = state.records.filter((r) => r.id !== id);
    paint();
  }

  /* ------------------------------------------------------------------ */
  /* 选区与工具条                                                        */
  /* ------------------------------------------------------------------ */

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = String(sel.toString() || '').trim();
    if (!text || text.length < 1) return null;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container.nodeType === 1 ? container : container.parentElement;
    if (!el) return null;
    if (el.closest(SKIP_SELECTOR)) return null;
    if (el.closest('#dsbt-hud-host')) return null;
    return { range, text, el };
  }

  function anchorFor(range, el) {
    const nodes = textNodesOf(el);
    let start = -1;
    let end = -1;
    for (const item of nodes) {
      if (start === -1 && item.node === range.startContainer) start = item.start + range.startOffset;
      if (end === -1 && item.node === range.endContainer) end = item.start + range.endOffset;
    }
    if (start === -1 || end === -1) {
      return { xpath: xpathOf(el), start: 0, end: 0, text: String(range.toString() || '') };
    }
    return { xpath: xpathOf(el), start, end, text: String(range.toString() || '') };
  }

  function ensureToolbar() {
    if (state.hostEl && state.hostEl.isConnected) return state.hostEl;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-dsbt-ui', '');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '.bar{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:3px;padding:6px 8px;',
      'background:rgba(255,255,255,.85);border:1px solid rgba(24,26,35,.09);border-radius:16px;',
      'box-shadow:0 16px 40px rgba(16,20,40,.18),0 2px 6px rgba(16,20,40,.06),inset 0 1px 0 rgba(255,255,255,.9);',
      '-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);',
      'font:12px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif;color:#17181c;',
      'transform:translate(-50%,-120%);opacity:0;transition:opacity .12s}',
      '.bar.show{opacity:1}',
      'button{border:0;background:transparent;color:#4b4d55;border-radius:9px;padding:5px 9px;',
      'font:inherit;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}',
      'button:hover{background:rgba(118,122,132,.14);color:#17181c}',
      '.dot{width:17px;height:17px;border-radius:50%;border:1px solid rgba(24,26,35,.1);cursor:pointer;',
      'box-shadow:inset 0 0 0 2px #fff;transition:transform .12s}',
      '.dot:hover{transform:scale(1.1)}',
      '.sep{width:1px;height:16px;background:rgba(24,26,35,.1);margin:0 3px}',
      '.note-box{display:none;position:fixed;z-index:2147483647;width:270px;padding:11px;border-radius:16px;',
      'background:rgba(255,255,255,.9);border:1px solid rgba(24,26,35,.09);',
      'box-shadow:0 18px 44px rgba(16,20,40,.2),inset 0 1px 0 rgba(255,255,255,.9);',
      '-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);',
      'font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}',
      '.note-box.show{display:block}',
      '.note-box textarea{width:100%;height:74px;resize:vertical;border:1px solid rgba(24,26,35,.14);border-radius:10px;',
      'padding:8px;font:inherit;box-sizing:border-box;outline:none;background:#fff;color:#17181c}',
      '.note-box textarea:focus{border-color:rgba(92,96,108,.55);box-shadow:0 0 0 3.5px rgba(92,96,108,.13)}',
      '.note-box .row{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}',
      '.note-box .row button{background:linear-gradient(180deg,#f6f7fa,#dfe2e9);color:#1a1b20;border:1px solid rgba(24,26,35,.12);',
      'border-radius:11px;padding:6px 13px;box-shadow:0 1px 2px rgba(16,20,40,.08),inset 0 1px 0 rgba(255,255,255,.9)}',
      '.note-box .row button:hover{filter:brightness(1.05)}',
      '.note-box .row button.ghost{background:rgba(255,255,255,.9);border:1px solid rgba(24,26,35,.12);color:#17181c;box-shadow:none}',
      '.note-box .row button.ghost:hover{background:#fff}',
      '</style>',
      '<div class="bar" part="bar">',
      '<span class="dot" data-hl="yellow" title="黄色荧光笔" style="background:#ffe9a3"></span>',
      '<span class="dot" data-hl="green" title="绿色荧光笔" style="background:#cdf0d6"></span>',
      '<span class="dot" data-hl="pink" title="粉色荧光笔" style="background:#ffd7de"></span>',
      '<button data-act="underline" title="加下划线">下划线</button>',
      '<button data-act="note" title="给这段加笔记">笔记</button>',
      '<span class="sep"></span>',
      '<button data-act="smaller" title="缩小译文">A-</button>',
      '<button data-act="bigger" title="放大译文">A+</button>',
      '<span class="sep"></span>',
      '<button data-act="remove" title="清除选中范围内的批注">清除</button>',
      '</div>',
      '<div class="note-box"><textarea placeholder="写下你的笔记…（保存后会在页面上显示「注」角标）"></textarea>',
      '<div class="row"><button class="ghost" data-act="cancel">取消</button>',
      '<button data-act="save">保存笔记</button></div></div>'
    ].join('');
    document.documentElement.appendChild(host);

    const bar = shadow.querySelector('.bar');
    const noteBox = shadow.querySelector('.note-box');
    const textarea = shadow.querySelector('textarea');

    bar.addEventListener('mousedown', (e) => e.preventDefault());
    shadow.querySelectorAll('.dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        addRecord('highlight', dot.getAttribute('data-hl'), '');
      });
    });
    shadow.querySelector('[data-act="underline"]').addEventListener('click', () => addRecord('underline', '', ''));
    shadow.querySelector('[data-act="note"]').addEventListener('click', () => {
      noteBox.classList.add('show');
      noteBox.style.left = bar.style.left;
      noteBox.style.top = bar.style.top;
      textarea.value = state.noteDraft || '';
      textarea.focus();
    });
    shadow.querySelector('[data-act="cancel"]').addEventListener('click', () => noteBox.classList.remove('show'));
    shadow.querySelector('[data-act="save"]').addEventListener('click', () => {
      state.noteDraft = textarea.value.trim();
      noteBox.classList.remove('show');
      addRecord('highlight', 'yellow', state.noteDraft, true);
      state.noteDraft = '';
    });
    shadow.querySelector('[data-act="smaller"]').addEventListener('click', () => changeScale(-0.08));
    shadow.querySelector('[data-act="bigger"]').addEventListener('click', () => changeScale(0.08));
    shadow.querySelector('[data-act="remove"]').addEventListener('click', removeAtSelection);

    state.hostEl = host;
    state.toolbar = { host, shadow, bar, noteBox };
    return host;
  }

  function showToolbar(rect) {
    ensureToolbar();
    const { bar } = state.toolbar;
    const x = Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120);
    const y = Math.max(rect.top, 48);
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';
    bar.classList.add('show');
  }

  function hideToolbar() {
    if (!state.toolbar) return;
    state.toolbar.bar.classList.remove('show');
    state.toolbar.noteBox.classList.remove('show');
  }

  function currentSel() {
    const info = selectionInfo();
    if (info) {
      state.lastSel = { range: info.range.cloneRange(), el: info.el };
      return state.lastSel;
    }
    return state.lastSel;
  }

  function addRecord(kind, color, note, keepSelection) {
    const info = currentSel();
    if (!info) return;
    const rec = {
      id: newId(),
      kind,
      color: color || 'yellow',
      note: note || '',
      anchor: anchorFor(info.range, info.el),
      createdAt: Date.now()
    };
    if (!rec.anchor.text) return;
    state.records.push(rec);
    paint();
    persist();
    if (!keepSelection) window.getSelection().removeAllRanges();
    hideToolbar();
  }

  function removeAtSelection() {
    const info = currentSel();
    if (!info) return;
    const sel = info.range;
    const ids = state.records
      .filter((rec) => {
        const range = rangeFor(rec);
        if (!range) return false;
        return (
          sel.compareBoundaryPoints(Range.END_TO_START, range) < 0 &&
          sel.compareBoundaryPoints(Range.START_TO_END, range) > 0
        );
      })
      .map((rec) => rec.id);
    if (ids.length) {
      const drop = new Set(ids);
      state.records = state.records.filter((r) => !drop.has(r.id));
      paint();
      persist();
    }
    window.getSelection().removeAllRanges();
    hideToolbar();
  }

  function changeScale(delta) {
    const next = Math.min(1.6, Math.max(0.8, Math.round((state.scale + delta) * 100) / 100));
    state.scale = next;
    document.documentElement.style.setProperty('--dsbt-zh-scale', String(next));
    try {
      chrome.storage.local.get(SETTINGS_KEY, (res) => {
        const current = (res && res[SETTINGS_KEY]) || {};
        chrome.storage.local.set({ [SETTINGS_KEY]: Object.assign({}, current, { zhScale: next }) });
      });
    } catch (e) {
      /* ignore */
    }
  }

  function onSelectionEnd(ev) {
    if (!state.enabled) return;
    const info = selectionInfo();
    if (info) state.lastSel = { range: info.range.cloneRange(), el: info.el };
    if (!info) {
      hideToolbar();
      return;
    }
    const rect = info.range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    showToolbar(rect);
  }

  ['mouseup', 'keyup'].forEach((type) => {
    document.addEventListener(
      type,
      (ev) => {
        if (ev.type === 'keyup' && !(ev.shiftKey || ev.key === 'Shift')) return;
        setTimeout(() => onSelectionEnd(ev), 10);
      },
      true
    );
  });
  document.addEventListener('mousedown', (ev) => {
    if (state.hostEl && ev.composedPath().includes(state.hostEl)) return;
    hideToolbar();
  }, true);
  window.addEventListener('scroll', hideToolbar, { passive: true });

  /* ------------------------------------------------------------------ */
  /* 启动                                                                */
  /* ------------------------------------------------------------------ */

  async function init() {
    try {
      const res = await chrome.storage.local.get([NOTES_KEY, SETTINGS_KEY]);
      const map = (res && res[NOTES_KEY]) || {};
      state.records = Array.isArray(map[pageKey()]) ? map[pageKey()] : [];
      const settings = (res && res[SETTINGS_KEY]) || {};
      state.enabled = settings.enabled === true;
      const scale = Number(settings.zhScale);
      state.scale = Number.isFinite(scale) && scale >= 0.8 && scale <= 1.6 ? scale : 1;
      document.documentElement.style.setProperty('--dsbt-zh-scale', String(state.scale));
    } catch (e) {
      state.records = [];
    }
    if (state.records.length && state.enabled) {
      applyAll();
      // 动态页面稍后再试一次
      setTimeout(applyAll, 1200);
      setTimeout(applyAll, 3000);
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const next = changes[SETTINGS_KEY].newValue || {};
      const on = next.enabled === true;
      if (on === state.enabled) return;
      state.enabled = on;
      if (on) {
        if (state.records.length) applyAll();
      } else {
        paint();
        hideToolbar();
      }
    });
  } catch (e) {
    /* 扩展重载后旧上下文会抛错，忽略 */
  }

  window.__dsbtAnnotate = {
    list() {
      return state.records.map((r) => ({
        id: r.id,
        kind: r.kind,
        color: r.color,
        note: r.note || '',
        text: (r.anchor && r.anchor.text) || ''
      }));
    },
    count() {
      return state.records.length;
    },
    applyAll,
    clearAll() {
      state.records = [];
      paint();
      persist();
    }
  };

  init();
})();