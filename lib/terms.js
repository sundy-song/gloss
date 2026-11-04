/**
 * lib/terms.js — 从英文句子里挑出「值得记一下」的词和搭配。
 *
 * 只做本地启发式判断，不联网、不花钱：
 *  - 缩写（API、HTTP、MV3）
 *  - 专有名词（Mutation Observer、Chrome Translator API）
 *  - 连字符复合词（read-only、end-to-end）
 *  - 技术后缀词（documentation、accessibility、asynchronous）
 *  - 长词（低频、通常就是领域词）
 *  - 段落内反复出现的实词二元组（好的搭配）
 *
 * 挑出来之后由 content.js 统一送去翻译，显示成「词 · 译文」的小卡片。
 */
(function (root) {
  'use strict';

  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done',
    'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'into', 'about', 'over',
    'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her',
    'i', 'me', 'my', 'us', 'not', 'no', 'so', 'such', 'very', 'more', 'most', 'much', 'many',
    'some', 'any', 'all', 'each', 'every', 'both', 'either', 'neither', 'also', 'just', 'only',
    'there', 'here', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose',
    'while', 'because', 'though', 'although', 'however', 'therefore', 'instead', 'still', 'yet',
    'one', 'two', 'three', 'first', 'second', 'next', 'last', 'other', 'another', 'same',
    'make', 'made', 'makes', 'get', 'gets', 'got', 'use', 'uses', 'used', 'using', 'see', 'seen',
    'like', 'want', 'need', 'needs', 'keep', 'keeps', 'take', 'takes', 'give', 'gives', 'put',
    'thing', 'things', 'way', 'ways', 'part', 'parts', 'time', 'times', 'people', 'work', 'works'
  ]);

  const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

  function clean(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'“”‘’(\[]+/, '')
      .replace(/[\s"'“”‘’.,;:!?)\]]+$/, '')
      .trim();
  }

  function words(text) {
    return String(text || '').match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g) || [];
  }

  function isContentWord(w) {
    const low = String(w || '').toLowerCase();
    if (low.length < 3) return false;
    if (STOP.has(low)) return false;
    return true;
  }

  function sentenceStarts(text) {
    const starts = new Set();
    const re = /(^|[.!?]\s+)([A-Za-z])/g;
    let m;
    while ((m = re.exec(text))) starts.add(m.index + m[1].length);
    return starts;
  }

  /** 单个段落里挑候选，按分数排序，最多 limit 个 */
  function extractCandidates(text, opts) {
    const limit = Math.max(1, (opts && opts.limit) || 6);
    const src = String(text || '');
    if (!src || src.length < 12) return [];
    if (CJK.test(src) && words(src).length < 4) return [];

    const found = new Map();
    const push = (raw, kind, score) => {
      const value = clean(raw);
      if (!value || value.length < 2) return;
      if (words(value).length === 0) return;
      if (STOP.has(value.toLowerCase())) return;
      if (value.length > 42) return;
      if (/^[A-Z]{1,2}\d+$/.test(value) || /^[A-Z]\d$/.test(value)) return;
      const key = value.toLowerCase();
      const prev = found.get(key);
      if (prev) {
        prev.score = Math.max(prev.score, score);
        if (kind === 'phrase') prev.kind = 'phrase';
        return;
      }
      found.set(key, { text: value, kind, score });
    };

    // 缩写：API / HTTP / MV3 / GPT-4
    (src.match(/\b[A-Z][A-Z0-9]{1,6}(?:-[A-Z0-9]+)?\b/g) || []).forEach((t) => {
      if (/^[A-Z]$/.test(t)) return;
      if (t === 'I' || t === 'A') return;
      push(t, 'acronym', 34);
    });

    // 专有名词：连续 2–4 个首字母大写词，排除句首
    const starts = sentenceStarts(src);
    const capRe = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})\b/g;
    let cm;
    while ((cm = capRe.exec(src))) {
      const idx = cm.index;
      let atStart = false;
      for (const s of starts) if (Math.abs(idx - s) <= 1) atStart = true;
      if (atStart) continue;
      push(cm[1], 'phrase', 30);
    }

    // 连字符复合词
    (src.match(/\b[a-z]{2,}(?:-[a-z]{2,}){1,2}\b/g) || []).forEach((t) => {
      if (!isContentWord(t.split('-')[0])) return;
      push(t, 'compound', 26);
    });

    // 技术后缀词
    (src.match(/\b[a-zA-Z]{7,}(?:tion|sion|ment|ity|ness|ology|graphy|ics|esis|ance|ence|ism|ular|ative)\b/g) || [])
      .forEach((t) => {
        if (!isContentWord(t)) return;
        push(t, 'term', 22);
      });

    // 长词
    (src.match(/\b[a-zA-Z]{11,}\b/g) || []).forEach((t) => {
      if (!isContentWord(t)) return;
      push(t, 'term', 16);
    });

    // 形容词 + 名词：bilingual layout、working memory、technical documentation
    const adjNoun = /\b([a-zA-Z]{5,}(?:al|ive|ous|ic|ary|ular|ent|ant|able|ible|ing))\s+([a-z]{3,})\b/g;
    let an;
    while ((an = adjNoun.exec(src))) {
      if (!isContentWord(an[2]) || STOP.has(an[2])) continue;
      if (STOP.has(an[1].toLowerCase())) continue;
      push(an[1] + ' ' + an[2], 'collocation', 18);
    }

    // 段落内出现两次以上的实词二元组，当作搭配
    const raw = words(src);
    const ws = raw.map((w) => w.toLowerCase());
    const seen = new Map();
    for (let i = 0; i < ws.length - 1; i += 1) {
      if (!isContentWord(ws[i]) || !isContentWord(ws[i + 1])) continue;
      const key = ws[i] + ' ' + ws[i + 1];
      const item = seen.get(key);
      if (item) item.count += 1;
      else seen.set(key, { count: 1, text: raw[i] + ' ' + raw[i + 1] });
    }
    seen.forEach((item, key) => {
      if (item.count < 2) return;
      push(item.text || key, 'collocation', 12 + item.count);
    });

    return Array.from(found.values())
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
      .slice(0, limit)
      .map(({ text: t, kind }) => ({ text: t, kind }));
  }

  /** 全页重复出现的 2–3 词搭配（跨段落），用来抓「这一页一直在说的东西」 */
  function collocations(texts, opts) {
    const limit = Math.max(1, (opts && opts.limit) || 12);
    const minCount = (opts && opts.minCount) || 2;
    const counts = new Map();
    (texts || []).forEach((text) => {
      const raw = words(text);
      const ws = raw.map((w) => w.toLowerCase());
      for (let n = 2; n <= 3; n += 1) {
        for (let i = 0; i + n <= ws.length; i += 1) {
          const gram = ws.slice(i, i + n);
          if (!isContentWord(gram[0]) || !isContentWord(gram[n - 1])) continue;
          if (gram.some((w) => !isContentWord(w))) continue;
          const key = gram.join(' ');
          const item = counts.get(key);
          if (item) item.count += 1;
          else counts.set(key, { count: 1, text: raw.slice(i, i + n).join(' ') });
        }
      }
    });
    return Array.from(counts.values())
      .filter((item) => item.count >= minCount)
      .sort((a, b) => b.count - a.count || a.text.length - b.text.length)
      .slice(0, limit)
      .map((item) => ({ text: item.text, count: item.count }));
  }

  const api = { extractCandidates, collocations, STOP, isContentWord };

  root.DSBTTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
