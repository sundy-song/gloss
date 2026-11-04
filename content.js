/**
 * content.js — 找到英文文本块，请求翻译，把中文插到原文下方（双语）。
 *
 * 设计要点：
 *  - 不改动原文（除「仅译文」模式），中文以独立节点插入，随时可整页清除。
 *  - 以「块级归属元素」为单位翻译，保证一段原文对应一段中文，语序不乱。
 *  - 动态内容用 MutationObserver 增量处理；失败不阻塞页面。
 */
(function () {
  'use strict';

  const T = window.DSBTText;
  const TERMS = window.DSBTTerms;
  if (!T) {
    console.warn('[DSBT] lib/text.js 未加载，双语翻译已停用');
    return;
  }
  if (window.__dsbtLoaded) return;
  window.__dsbtLoaded = true;

  const SETTINGS_KEY = 'dsbt:settings';
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
    zhScale: 1
  };

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TT',
    'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'MATH'
  ]);

  /** 这些元素即使 display 是 inline 也当作「界面控件」，单独成块翻译 */
  const CONTROL_TAGS = new Set(['BUTTON', 'A', 'LABEL', 'SUMMARY', 'LEGEND', 'TH', 'CAPTION']);

  const BLOCK_DISPLAYS = new Set([
    'block', 'list-item', 'table-cell', 'table-caption', 'flow-root', 'flex', 'grid'
  ]);

  /** 译文插入位置：追加到元素内部（避免破坏表格/列表结构） */
  const APPEND_INSIDE = new Set(['TD', 'TH', 'LI', 'DT', 'DD']);

  const MAX_TEXT_PER_JOB = 2400;
  const BATCH_SIZE = 10;
  const SCAN_LIMIT = 400;

  const state = {
    settings: Object.assign({}, DEFAULTS),
    enabled: true,
    mode: 'bilingual',
    lang: 'zh',
    running: false,
    stats: { done: 0, inline: 0, failed: 0 },
    needsGesture: false,
    lastError: '',
    lastEngine: '',
    pairs: []
  };

  const appliedOwners = new Set();
  const displayCache = new WeakMap();
  const queuedOwners = new Set();
  const inflightOwners = new Set();
  let queue = [];
  let moreWork = false;
  let generation = 0;
  let scanTimer = 0;
  let hudHost = null;
  let hudTimer = 0;
  let hudHideTimer = 0;

  /* ------------------------------------------------------------------ */
  /* 样式 / 元素形态判断                                                  */
  /* ------------------------------------------------------------------ */

  function displayOf(el) {
    let d = displayCache.get(el);
    if (d) return d;
    let display = '';
    try {
      display = getComputedStyle(el).display || '';
    } catch (e) {
      display = '';
    }
    displayCache.set(el, display);
    return display;
  }

  function isBlockish(el) {
    return BLOCK_DISPLAYS.has(displayOf(el));
  }

  function isControl(el) {
    if (!CONTROL_TAGS.has(el.tagName)) return false;
    if (el.hasAttribute('role')) return true;
    return displayOf(el) !== 'inline';
  }

  function isOwner(el) {
    return isControl(el) || isBlockish(el);
  }

  function findOwner(start) {
    let el = start;
    let depth = 0;
    while (el && depth < 60) {
      if (el === document.body || el === document.documentElement) return null;
      if (SKIP_TAGS.has(el.tagName)) return null;
      if (isOwner(el)) return el;
      el = el.parentElement;
      depth += 1;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 收集待翻译的文本块                                                  */
  /* ------------------------------------------------------------------ */

  function ownTextNodes(owner) {
    const nodes = [];
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          if (child.nodeValue && child.nodeValue.trim()) nodes.push(child);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child === owner) continue;
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (child.hasAttribute('data-dsbt-block') || child.hasAttribute('data-dsbt-inline')) continue;
        if (isBlockish(child) || isControl(child)) continue;
        walk(child);
      }
    };
    walk(owner);
    return nodes;
  }

  function collectJobs(root) {
    const owners = new Map();
    let accepted = 0;
    let capped = false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (accepted > SCAN_LIMIT * 8) {
          capped = true;
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-dsbt-block],[data-dsbt-inline],[data-dsbt-terms],[data-dsbt-note-card],[contenteditable="true"],[contenteditable=""]')) {
          return NodeFilter.FILTER_REJECT;
        }
        const text = node.nodeValue;
        if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
        if (!T.isTranslatable(text, state.lang, { minLength: 2 })) return NodeFilter.FILTER_REJECT;
        if (T.shouldSkip(text)) return NodeFilter.FILTER_REJECT;

        const owner = findOwner(parent);
        if (!owner) return NodeFilter.FILTER_REJECT;
        if (appliedOwners.has(owner) || queuedOwners.has(owner) || inflightOwners.has(owner)) {
          return NodeFilter.FILTER_REJECT;
        }
        accepted += 1;
        if (!owners.has(owner)) owners.set(owner, []);
        owners.get(owner).push(node);
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let n = walker.nextNode();
    while (n) n = walker.nextNode();

    const jobs = [];
    let truncated = false;
    for (const owner of owners.keys()) {
      if (jobs.length >= SCAN_LIMIT) {
        truncated = true;
        break;
      }
      if (!owner.isConnected) continue;
      const nodes = ownTextNodes(owner);
      if (!nodes.length) continue;
      let text = T.normalize(nodes.map((x) => x.nodeValue).join(' '));
      if (!text) continue;
      if (text.length > MAX_TEXT_PER_JOB) text = text.slice(0, MAX_TEXT_PER_JOB);
      if (!T.isTranslatable(text, state.lang, { minLength: 2 })) continue;

      const kind = isControl(owner) && text.length <= 32 ? 'inline' : 'block';
      jobs.push({ owner, nodes, text, kind });
    }
    return { jobs, truncated: truncated || capped };
  }

  /* ------------------------------------------------------------------ */
  /* 插入译文                                                            */
  /* ------------------------------------------------------------------ */

  function zhAttrName() {
    if (state.lang === 'zh-Hant') return 'zh-Hant';
    if (state.lang === 'zh') return 'zh-Hans';
    return state.lang || 'zh-Hans';
  }

  /**
   * 译文插入位置：紧跟在「这段文字的末尾」。
   *
   * 旧逻辑是 owner.insertAdjacentElement('afterend')，一旦 owner 是个容器
   * （比如 <div> 里先有裸文字、后面又跟了一个块级子元素），译文就会被推到
   * 整个容器下面，看起来和原文「串行」。这里改为：
   *  - 找到最后一段文字之后的位置；
   *  - 如果容器后面还有块级兄弟，就地插在文字后面（保持顺序）；
   *  - 否则插在承载这段文字的块元素后面。
   */
  function insertionRef(job) {
    const last = job.nodes[job.nodes.length - 1];
    let ref = last;
    for (;;) {
      const next = ref.nextSibling;
      if (!next) break;
      if (next.nodeType === 1) {
        if (next.hasAttribute('data-dsbt-block') || next.hasAttribute('data-dsbt-inline')) break;
        if (isBlockish(next) || isControl(next)) break;
        ref = next;
        continue;
      }
      if (next.nodeType === 3) {
        if (next.nodeValue && next.nodeValue.trim()) break;
        ref = next;
        continue;
      }
      ref = next;
    }
    return ref;
  }

  function blockAncestorOf(ref, owner) {
    let el = ref.nodeType === 1 ? ref : ref.parentElement;
    while (el && el !== owner && !isBlockish(el) && !isControl(el)) el = el.parentElement;
    return el || owner;
  }

  function hasFollowingBlock(ref) {
    let node = ref.nextSibling;
    while (node) {
      if (node.nodeType === 1 && (isBlockish(node) || isControl(node))) return true;
      node = node.nextSibling;
    }
    return false;
  }

  function makeZhNode(zh, n) {
    const div = document.createElement('div');
    div.className = 'dsbt-zh';
    div.setAttribute('data-dsbt-block', '');
    div.setAttribute('lang', zhAttrName());
    div.textContent = zh;
    if (n != null) div.setAttribute('data-dsbt-n', String(n));
    return div;
  }

  function insertBlock(job, zh) {
    const owner = job.owner;
    const ref = insertionRef(job);
    const div = makeZhNode(zh, job.n);
    const blockEl = blockAncestorOf(ref, owner);

    if (APPEND_INSIDE.has(owner.tagName)) {
      // 表格单元格 / 列表项：译文必须留在内部，否则会破坏表格结构
      if (blockEl !== owner && blockEl.parentNode) blockEl.insertAdjacentElement('afterend', div);
      else owner.appendChild(div);
    } else if (blockEl === owner && hasFollowingBlock(ref)) {
      // 容器里「裸文字 + 后面的块」，就地插在文字之后，避免被推到容器末尾
      owner.insertBefore(div, ref.nextSibling);
    } else if (blockEl === owner) {
      owner.insertAdjacentElement('afterend', div);
    } else if (blockEl.parentNode) {
      blockEl.insertAdjacentElement('afterend', div);
    } else {
      owner.insertAdjacentElement('afterend', div);
    }

    div.addEventListener('mouseenter', () => {
      try {
        blockEl.setAttribute('data-dsbt-hit', '');
      } catch (e) {
        /* ignore */
      }
    });
    div.addEventListener('mouseleave', () => {
      try {
        blockEl.removeAttribute('data-dsbt-hit');
      } catch (e) {
        /* ignore */
      }
    });
    return div;
  }

  function insertInline(owner, zh) {
    const span = document.createElement('span');
    span.className = 'dsbt-zh-inline';
    span.setAttribute('data-dsbt-inline', '');
    span.setAttribute('lang', zhAttrName());
    span.textContent = '（' + zh + '）';
    owner.appendChild(span);
    if (owner.tagName === 'BUTTON' || owner.tagName === 'A' || owner.tagName === 'SUMMARY') {
      owner.setAttribute('data-dsbt-tip', zh);
      if (!owner.getAttribute('title')) owner.setAttribute('title', zh);
    }
    return span;
  }

  function replaceOwnText(owner, nodes, zh) {
    if (!owner.__dsbtSrc) {
      owner.__dsbtSrc = nodes.map((n) => n.nodeValue);
      owner.__dsbtRefs = nodes;
    }
    nodes.forEach((node, i) => {
      node.nodeValue = i === 0 ? zh : '';
    });
  }

  function restoreOwnText(owner) {
    if (!owner.__dsbtSrc) return;
    const refs = owner.__dsbtRefs || [];
    refs.forEach((node, i) => {
      if (node && node.isConnected) node.nodeValue = owner.__dsbtSrc[i];
    });
    delete owner.__dsbtSrc;
    delete owner.__dsbtRefs;
  }

  function applyJob(job, zh) {
    const text = String(zh || '').trim();
    if (!text) return false;
    if (text === job.text) return false;

    if (job.kind === 'inline') {
      insertInline(job.owner, text);
      state.stats.inline += 1;
    } else if (state.mode === 'replace') {
      job.n = state.pairs.length + 1;
      replaceOwnText(job.owner, job.nodes, text);
    } else {
      job.n = state.pairs.length + 1;
      job.zhNode = insertBlock(job, text);
    }
    appliedOwners.add(job.owner);
    state.pairs.push({ n: state.pairs.length + 1, en: job.text, zh: text, kind: job.kind });
    state.stats.done += 1;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 学词层：从原文里挑术语 / 搭配，翻译后贴在译文下面                     */
  /* ------------------------------------------------------------------ */

  const termCache = new Map();
  const termSeen = new Set();
  let termBudget = 12;
  const ownerTerms = new Map();
  const termQueue = [];
  let termRunning = false;

  function learnEnabled() {
    return state.settings && state.settings.learn !== false && !!TERMS;
  }

  function removeTermBoxes() {
    document.querySelectorAll('[data-dsbt-terms]').forEach((el) => el.remove());
    ownerTerms.clear();
  }

  function rememberTerm(owner, text, zh) {
    const list = ownerTerms.get(owner) || [];
    if (list.some((t) => t.text.toLowerCase() === text.toLowerCase())) return;
    list.push({ text, zh });
    ownerTerms.set(owner, list);
  }

  function renderTerms(owner, zhNode) {
    const list = ownerTerms.get(owner);
    if (!list || !list.length) return;
    if (!zhNode || !zhNode.isConnected) return;

    let box = zhNode.nextElementSibling;
    if (!box || !box.hasAttribute('data-dsbt-terms')) {
      box = document.createElement('div');
      box.className = 'dsbt-terms';
      box.setAttribute('data-dsbt-terms', '');
      box.setAttribute('lang', zhAttrName());
      zhNode.insertAdjacentElement('afterend', box);
    }

    box.textContent = '';
    list.slice(0, 6).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'dsbt-term';
      const en = document.createElement('b');
      en.textContent = t.text;
      const zh = document.createElement('i');
      zh.textContent = t.zh;
      chip.appendChild(en);
      chip.appendChild(zh);
      box.appendChild(chip);
    });
  }

  async function runTerms() {
    if (termRunning || !learnEnabled()) return;
    termRunning = true;
    try {
      while (termQueue.length && state.enabled) {
        const batch = termQueue.splice(0, 6);
        const need = batch.filter((t) => !termCache.has(t.key));
        let results = [];
        if (need.length) {
          const res = await requestTranslation(need.map((t) => t.text));
          if (res && res.ok && Array.isArray(res.results)) results = res.results;
          need.forEach((t, i) => {
            const zh = results[i];
            if (zh && String(zh).trim()) termCache.set(t.key, String(zh).trim());
          });
        }
        batch.forEach((t) => {
          const zh = termCache.get(t.key);
          if (!zh) return;
          rememberTerm(t.owner, t.text, zh);
          renderTerms(t.owner, t.zhNode);
        });
      }
    } catch (e) {
      /* 学词失败不影响正文 */
    } finally {
      termRunning = false;
    }
  }

  function queueTerms(job) {
    if (!learnEnabled() || !job.zhNode) return;
    let list = [];
    try {
      list = TERMS.extractCandidates(job.text, { limit: 4 });
    } catch (e) {
      return;
    }
    if (!list.length) return;
    list.forEach((c) => {
      const key = String(c.text || '').toLowerCase();
      if (!key) return;
      if (termCache.has(key) || termSeen.has(key)) return;
      if (termBudget <= 0) return;
      termBudget -= 1;
      termSeen.add(key);
      termQueue.push({ key, text: c.text, owner: job.owner, zhNode: job.zhNode });
    });
    if (ownerTerms.has(job.owner)) renderTerms(job.owner, job.zhNode);
    if (termQueue.length) runTerms();
  }

  function clearAll() {
    generation += 1;
    document.querySelectorAll('[data-dsbt-block],[data-dsbt-inline],[data-dsbt-terms]').forEach((el) => el.remove());
    for (const owner of appliedOwners) {
      try {
        restoreOwnText(owner);
      } catch (e) {
        /* 元素可能已卸载 */
      }
    }
    appliedOwners.clear();
    queuedOwners.clear();
    moreWork = false;
    queue = [];
    inflightOwners.clear();
    state.stats = { done: 0, inline: 0, failed: 0 };
    state.pairs = [];
    state.lastError = '';
    termQueue.length = 0;
    termCache.clear();
    termSeen.clear();
    termBudget = 12;
    ownerTerms.clear();
    updateHud();
  }

  /* ------------------------------------------------------------------ */
  /* 翻译队列                                                            */
  /* ------------------------------------------------------------------ */

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function requestTranslation(texts) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      try {
        chrome.runtime.sendMessage(
          { type: 'dsbt:translate', texts, lang: state.lang },
          (res) => {
            if (chrome.runtime.lastError) {
              finish({ ok: false, error: chrome.runtime.lastError.message || '扩展通信失败' });
              return;
            }
            finish(res || { ok: false, error: '无响应' });
          }
        );
      } catch (e) {
        finish({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      setTimeout(() => finish({ ok: false, error: '翻译超时' }), 120000);
    });
  }

  function enqueueScan(root) {
    if (!state.enabled) return;
    let result;
    try {
      result = collectJobs(root || document.body || document.documentElement);
    } catch (e) {
      console.warn('[DSBT] 扫描失败', e);
      return;
    }
    const jobs = result.jobs;
    if (result.truncated) moreWork = true;
    for (const job of jobs) {
      if (queuedOwners.has(job.owner) || inflightOwners.has(job.owner) || appliedOwners.has(job.owner)) continue;
      queuedOwners.add(job.owner);
      queue.push(job);
    }
    if (queue.length) runQueue();
  }

  async function runQueue() {
    if (state.running || !state.enabled) return;
    const gen = generation;
    state.running = true;
    showHud('');

    try {
      while (state.enabled && queue.length && gen === generation) {
        const batch = queue.splice(0, BATCH_SIZE);
        const texts = batch.map((j) => j.text);
        batch.forEach((j) => inflightOwners.add(j.owner));

        const res = await requestTranslation(texts);
        const dropBatch = () =>
          batch.forEach((job) => {
            inflightOwners.delete(job.owner);
            queuedOwners.delete(job.owner);
          });

        if (gen !== generation) {
          dropBatch();
          break;
        }

        if (res && !res.ok && res.needsGesture) {
          dropBatch();
          state.needsGesture = true;
          updateHud();
          break;
        }

        const results = res && res.ok ? res.results || [] : [];
        if (res && res.ok) state.lastEngine = res.engine || state.lastEngine;
        if (res && !res.ok) {
          state.lastError = res.error || '翻译失败';
          state.stats.failed += batch.length;
        }

        batch.forEach((job, i) => {
          inflightOwners.delete(job.owner);
          queuedOwners.delete(job.owner);
          const zh = results[i];
          if (zh && applyJob(job, zh)) {
            if (state.lastError) state.lastError = '';
            queueTerms(job);
          }
        });

        updateHud();
        await sleep(20);
      }
    } catch (e) {
      state.lastError = String(e && e.message ? e.message : e);
    } finally {
      state.running = false;
      updateHud();
      if (queue.length && state.enabled) setTimeout(runQueue, 300);
      else if (moreWork && state.enabled) {
        moreWork = false;
        scheduleScan(500);
      } else scheduleHudHide();
    }
  }

  function scheduleScan(delay) {
    if (!state.enabled) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => enqueueScan(document.body), delay == null ? 500 : delay);
  }

  /* ------------------------------------------------------------------ */
  /* 页面上的状态提示（HUD）                                             */
  /* ------------------------------------------------------------------ */

  const isTopFrame = (() => {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  })();

  function ensureHud() {
    if (!isTopFrame) return null;
    if (hudHost && hudHost.isConnected) return hudHost;
    hudHost = document.createElement('div');
    hudHost.id = 'dsbt-hud-host';
    const shadow = hudHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<style>',
      '.pill{font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:360px;padding:9px 13px;',
      'border-radius:15px;background:rgba(255,255,255,.82);color:#17181c;',
      'border:1px solid rgba(24,26,35,.1);box-shadow:0 14px 40px rgba(16,20,40,.18),0 2px 6px rgba(16,20,40,.06),inset 0 1px 0 rgba(255,255,255,.9);',
      'backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);',
      'opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;',
      'display:flex;align-items:center;gap:10px;pointer-events:auto}',
      '.pill.show{opacity:1;transform:none}',
      '.pill.err{background:rgba(255,240,238,.95);border-color:rgba(255,69,58,.32);color:#c9271c}',
      '.txt{flex:1;min-width:0}',
      '.btn{flex:0 0 auto;border:0;border-radius:999px;padding:6px 13px;font:inherit;font-size:12px;',
      'background:linear-gradient(180deg,#f6f7fa,#dfe2e9);color:#1a1b20;cursor:pointer;pointer-events:auto;border:1px solid rgba(24,26,35,.12);',
      'box-shadow:0 1px 2px rgba(16,20,40,.08)}',
      '.btn:hover{filter:brightness(1.05)}',
      '.btn[hidden]{display:none}',
      '</style>',
      '<div class="pill"><span class="txt"></span><button class="btn" hidden></button></div>'
    ].join('');
    document.documentElement.appendChild(hudHost);
    shadow.querySelector('.btn').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadBuiltinModel();
    });
    return hudHost;
  }

  function hudParts() {
    const host = ensureHud();
    if (!host) return null;
    const shadow = host.shadowRoot;
    return {
      pill: shadow.querySelector('.pill'),
      txt: shadow.querySelector('.txt'),
      btn: shadow.querySelector('.btn')
    };
  }

  function hideHud() {
    if (!hudHost || !hudHost.isConnected) return;
    const pill = hudHost.shadowRoot.querySelector('.pill');
    if (pill) pill.classList.remove('show');
  }

  function showHud(message, isError) {
    const parts = hudParts();
    if (!parts) return;
    parts.pill.classList.toggle('err', !!isError);
    parts.btn.hidden = true;
    parts.txt.textContent = message || '正在翻译…';
    parts.pill.classList.add('show');
    clearTimeout(hudHideTimer);
  }

  function updateHud() {
    if (!state.enabled) {
      hideHud();
      return;
    }
    if (!hudHost && !state.running && !state.lastError && !state.needsGesture && !queue.length) return;
    const parts = hudParts();
    if (!parts) return;

    parts.btn.hidden = !state.needsGesture;
    if (state.needsGesture) {
      parts.pill.classList.remove('err');
      parts.txt.textContent = '需要先下载离线翻译包（仅一次，几十 MB）';
      parts.btn.textContent = '下载并启用';
      parts.pill.classList.add('show');
      clearTimeout(hudHideTimer);
      return;
    }

    if (state.lastError) {
      parts.pill.classList.add('err');
      parts.txt.textContent = '双语翻译失败：' + state.lastError;
      parts.pill.classList.add('show');
      scheduleHudHide(8000);
      return;
    }

    if (state.running || queue.length) {
      const pending = queue.length + inflightOwners.size;
      parts.pill.classList.remove('err');
      parts.txt.textContent = '双语翻译中… 已完成 ' + state.stats.done + (pending ? ' · 待处理 ' + pending : '');
      parts.pill.classList.add('show');
    }
  }

  function scheduleHudHide(ms) {
    clearTimeout(hudHideTimer);
    hudHideTimer = setTimeout(() => {
      hideHud();
      state.lastError = '';
    }, ms == null ? 2500 : ms);
  }

  function flashHud(message, isError, ms) {
    showHud(message, isError);
    scheduleHudHide(ms || 3000);
  }

  /** 内置翻译模型需要用户手势才能下载：点击 HUD 按钮时执行一次 */
  let downloading = false;

  async function downloadBuiltinModel() {
    if (downloading) return;
    if (typeof Translator === 'undefined') {
      flashHud('当前 Chrome 不支持内置翻译（需要 Chrome 138+）', true, 6000);
      return;
    }
    downloading = true;
    state.needsGesture = false;
    flashHud('正在准备离线翻译包…');
    try {
      const target = state.lang === 'zh-Hant' ? 'zh-Hant' : 'zh';
      const translator = await Translator.create({
        sourceLanguage: 'en',
        targetLanguage: target,
        monitor(m) {
          m.addEventListener('downloadprogress', (event) => {
            const percent = Math.round((event.loaded || 0) * 100);
            flashHud('正在下载离线翻译包 ' + percent + '%');
          });
        }
      });
      translator.destroy();
      flashHud('离线翻译包已就绪，继续翻译', false, 2500);
      clearAll();
      scheduleScan(150);
    } catch (e) {
      const message = String((e && e.message) || e);
      flashHud('离线翻译包下载失败：' + message + '。可改用自定义 API（如 DeepSeek）。', true, 10000);
    } finally {
      downloading = false;
      updateHud();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 设置同步                                                            */
  /* ------------------------------------------------------------------ */

  function applySettings(next, initial) {
    const prev = state.settings;
    const settings = Object.assign({}, DEFAULTS, next || {});
    state.settings = settings;

    const enabled = settings.enabled === true;
    const wasEnabled = prev.enabled === true;
    state.mode = settings.mode === 'replace' ? 'replace' : 'bilingual';
    state.lang = T.normalizeLang(settings.lang);

    const scale = Number(settings.zhScale);
    document.documentElement.style.setProperty(
      '--dsbt-zh-scale',
      String(Number.isFinite(scale) && scale >= 0.8 && scale <= 1.6 ? scale : 1)
    );

    if (!settings.learn) removeTermBoxes();

    const engineChanged = prev.engine !== settings.engine || prev.lang !== settings.lang ||
      prev.mode !== settings.mode || prev.apiBase !== settings.apiBase || prev.apiKey !== settings.apiKey ||
      prev.model !== settings.model;

    if (!enabled) {
      state.enabled = false;
      clearAll();
      return;
    }

    state.enabled = true;
    if (engineChanged) state.needsGesture = false;
    if (!initial && (engineChanged || !wasEnabled)) {
      clearAll();
      scheduleScan(120);
      return;
    }
    if (initial && settings.autoRun !== false) scheduleScan(400);
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(SETTINGS_KEY, (res) => {
        applySettings(res ? res[SETTINGS_KEY] : null, true);
      });
    } catch (e) {
      applySettings(null, true);
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      applySettings(changes[SETTINGS_KEY].newValue, false);
    });
  } catch (e) {
    /* 扩展被重载后旧上下文会抛错，忽略 */
  }

  /* ------------------------------------------------------------------ */
  /* 消息                                                                */
  /* ------------------------------------------------------------------ */

  function statusPayload() {
    return {
      ok: true,
      enabled: state.enabled,
      mode: state.mode,
      lang: state.lang,
      engine: state.lastEngine,
      stats: state.stats,
      pending: queue.length + inflightOwners.size,
      error: state.lastError,
      pairs: state.pairs.length,
      notes: window.__dsbtAnnotate ? window.__dsbtAnnotate.count() : 0,
      url: location.href,
      title: document.title || location.hostname
    };
  }

  /** 导出用的文档模型（导出页据此生成预览 / HTML / PDF） */
  function buildExportModel() {
    const notes = window.__dsbtAnnotate ? window.__dsbtAnnotate.list() : [];
    const noteItems = [];
    const used = new Set();
    const items = state.pairs.map((p) => {
      let note = '';
      for (const n of notes) {
        if (!n.note || used.has(n.id)) continue;
        if (n.text && (p.en.indexOf(n.text) >= 0 || p.zh.indexOf(n.text) >= 0)) {
          note = n.note;
          used.add(n.id);
          break;
        }
      }
      return { en: p.en, zh: p.zh, note };
    });
    notes.forEach((n) => {
      if (!used.has(n.id) && (n.note || n.text)) noteItems.push({ text: n.text, note: n.note || '' });
    });
    return {
      title: document.title || location.hostname,
      url: location.href,
      site: location.hostname,
      createdAt: new Date().toISOString(),
      lang: state.lang,
      items,
      notes: noteItems
    };
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'dsbt:status') {
        sendResponse(statusPayload());
        return;
      }
      if (msg.type === 'dsbt:scan') {
        if (!state.enabled) {
          sendResponse({ ok: false, error: '双语翻译当前已关闭，请先打开开关' });
          return;
        }
        clearTimeout(scanTimer);
        enqueueScan(document.body);
        flashHud('已开始翻译本页', false, 2000);
        sendResponse(statusPayload());
        return;
      }
      if (msg.type === 'dsbt:clear') {
        clearAll();
        flashHud('已清除本页译文', false, 2000);
        sendResponse(statusPayload());
        return;
      }
      if (msg.type === 'dsbt:export') {
        sendResponse({ ok: true, model: buildExportModel() });
        return;
      }
      if (msg.type === 'dsbt:anno:apply') {
        if (window.__dsbtAnnotate) window.__dsbtAnnotate.applyAll();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'dsbt:ping') {
        sendResponse({ ok: true });
      }
    });
  } catch (e) {
    /* ignore */
  }

  /* ------------------------------------------------------------------ */
  /* 动态内容                                                            */
  /* ------------------------------------------------------------------ */

  let moTimer = 0;
  const observer = new MutationObserver((mutations) => {
    if (!state.enabled) return;
    let worth = false;
    for (const m of mutations) {
      if (m.type !== 'childList' || !m.addedNodes.length) continue;
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.id === 'dsbt-hud-host') continue;
        if (node.hasAttribute && (node.hasAttribute('data-dsbt-block') || node.hasAttribute('data-dsbt-inline'))) continue;
        worth = true;
        break;
      }
      if (worth) break;
    }
    if (!worth) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => enqueueScan(document.body), 700);
  });

  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* ignore */
  }

  window.addEventListener('popstate', () => scheduleScan(600), true);
  window.addEventListener('hashchange', () => scheduleScan(600), true);

  loadSettings();
})();