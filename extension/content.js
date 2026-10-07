(() => {
  if (window.__fnLoaded) return;
  window.__fnLoaded = true;

  const api = globalThis.browser || globalThis.chrome;
  const PAGE = location.href.split('#')[0];
  const COLORS = { yellow: '#fff176', green: '#a5d6a7', blue: '#90caf9', pink: '#f8bbd0' };

  // ---------- storage ----------
  const load = () => api.storage.local.get({ highlights: [], pages: {} });
  const save = (obj) => api.storage.local.set(obj);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const parseTags = (s) => [...new Set(s.split(/[,\s,、]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];

  // ---------- text index & anchoring ----------
  function indexText() {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('#fn-root, script, style, noscript, textarea')) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { nodes, text };
  }

  function captureSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const { nodes, text } = indexText();
    let start = -1, end = -1;
    for (const { node, start: s0 } of nodes) {
      if (!range.intersectsNode(node)) continue;
      const len = node.nodeValue.length;
      const a = node === range.startContainer ? range.startOffset : 0;
      const b = node === range.endContainer ? range.endOffset : len;
      if (a >= b) continue;
      if (start < 0) start = s0 + a;
      end = s0 + b;
    }
    if (start < 0) return null;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end - start < 1) return null;
    return {
      start, end,
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 40), start),
      suffix: text.slice(end, end + 40),
      rect: range.getBoundingClientRect(),
    };
  }

  const commonSuffix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
  const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

  function locate(h) {
    const { text } = indexText();
    let best = -1, bestScore = -1, i = -1;
    while ((i = text.indexOf(h.quote, i + 1)) !== -1) {
      const pre = text.slice(Math.max(0, i - h.prefix.length), i);
      const suf = text.slice(i + h.quote.length, i + h.quote.length + h.suffix.length);
      const score = commonSuffix(pre, h.prefix) + commonPrefix(suf, h.suffix);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function paint(mark, color) {
    mark.style.setProperty('background-color', COLORS[color] || COLORS.yellow, 'important');
    mark.style.setProperty('color', 'inherit', 'important');
    mark.style.setProperty('cursor', 'pointer', 'important');
    mark.style.setProperty('padding', '0', 'important');
  }

  function wrapRange(start, end, id, color) {
    const { nodes } = indexText();
    const pieces = [];
    for (const { node, start: s0 } of nodes) {
      const len = node.nodeValue.length;
      const a = Math.max(start, s0) - s0;
      const b = Math.min(end, s0 + len) - s0;
      if (a < b && node.nodeValue.slice(a, b).trim()) pieces.push([node, a, b]);
    }
    for (const [node, a, b] of pieces) {
      const r = document.createRange();
      r.setStart(node, a);
      r.setEnd(node, b);
      const m = document.createElement('mark');
      m.className = 'fn-hl';
      m.dataset.fnId = id;
      paint(m, color);
      r.surroundContents(m);
    }
    return pieces.length > 0;
  }

  const marksOf = (id) => document.querySelectorAll(`mark.fn-hl[data-fn-id="${id}"]`);

  function unwrap(id) {
    marksOf(id).forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  }

  async function syncMarks() {
    const { highlights } = await load();
    const mine = highlights.filter((h) => h.url === PAGE);
    const ids = new Set(mine.map((h) => h.id));
    document.querySelectorAll('mark.fn-hl').forEach((m) => { if (!ids.has(m.dataset.fnId)) unwrap(m.dataset.fnId); });
    let missing = 0;
    for (const h of mine) {
      if (marksOf(h.id).length) { marksOf(h.id).forEach((m) => paint(m, h.color)); continue; }
      const idx = locate(h);
      if (idx >= 0 && wrapRange(idx, idx + h.quote.length, h.id, h.color)) continue;
      missing++;
    }
    return missing;
  }

  // ---------- UI (shadow DOM) ----------
  const host = document.createElement('div');
  host.id = 'fn-root';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }
  .ui { --bg:#fff; --fg:#1d1d1f; --mut:#6e6e73; --line:#e2e2e7; --acc:#0a66d6; --soft:#f4f4f7;
        color: var(--fg); font-size: 14px; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { .ui { --bg:#2a2a2d; --fg:#f2f2f4; --mut:#9a9aa1; --line:#46464b; --acc:#5aa2ff; --soft:#36363a; } }
  button { font: inherit; cursor: pointer; }
  .fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 40px; height: 40px; border-radius: 50%;
         border: 1px solid var(--line); background: var(--bg); color: var(--fg); box-shadow: 0 2px 10px #0003; font-size: 18px; opacity: .55; transition: opacity .15s; }
  .fab:hover { opacity: 1; }
  .selbtn { position: fixed; z-index: 2147483647; display: none; padding: 6px 12px; border-radius: 999px; border: 0;
            background: #1d1d1f; color: #fff; box-shadow: 0 2px 10px #0004; font-size: 13px; }
  .pop { position: fixed; z-index: 2147483647; display: none; width: 300px; padding: 12px; border-radius: 12px; background: var(--bg);
         border: 1px solid var(--line); box-shadow: 0 8px 30px #0003; }
  .quote { font-size: 12px; color: var(--mut); border-left: 3px solid var(--line); padding-left: 8px; margin-bottom: 8px;
           max-height: 3.2em; overflow: hidden; }
  textarea, input[type=text] { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); color: var(--fg);
           padding: 8px; font-size: 14px; resize: vertical; outline: none; }
  textarea:focus, input[type=text]:focus { border-color: var(--acc); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .sw { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; padding: 0; }
  .sw.on { border-color: var(--fg); }
  .sp { flex: 1; }
  .btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--soft); color: var(--fg); }
  .btn.pri { background: var(--acc); border-color: var(--acc); color: #fff; }
  .btn.del { color: #d93025; }
  .side { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483646; width: 340px; max-width: 90vw; display: none; flex-direction: column;
          background: var(--bg); border-left: 1px solid var(--line); box-shadow: -6px 0 24px #0002; }
  .side.open { display: flex; }
  .side header { display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
  .side .body { flex: 1; overflow: auto; padding: 14px; }
  .side h4 { margin: 16px 0 6px; font-size: 12px; color: var(--mut); font-weight: 600; letter-spacing: .04em; }
  .side h4:first-child { margin-top: 0; }
  .item { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
  .item:hover { border-color: var(--acc); }
  .item .q { font-size: 13px; border-left: 4px solid; padding-left: 8px; }
  .item .c { font-size: 13px; margin-top: 4px; color: var(--mut); white-space: pre-wrap; }
  .tag { display: inline-block; font-size: 11px; color: var(--acc); margin-right: 6px; }
  .empty { color: var(--mut); font-size: 13px; }
  .x { border: 0; background: none; color: var(--mut); font-size: 18px; }
</style>
<div class="ui">
  <button class="fab" title="網頁筆記">✎</button>
  <button class="selbtn">✎ 標記 / 筆記</button>
  <div class="pop">
    <div class="quote"></div>
    <textarea rows="3" placeholder="寫下你的想法、疑問、重點…"></textarea>
    <input type="text" class="tags" placeholder="標籤,例如:保險科技 ETF" style="margin-top:8px">
    <div class="row">
      <span class="sws"></span><span class="sp"></span>
      <button class="btn del">刪除</button><button class="btn cancel">取消</button><button class="btn pri save">儲存</button>
    </div>
  </div>
  <aside class="side">
    <header><span style="flex:1">網頁筆記</span><button class="x close">×</button></header>
    <div class="body">
      <h4>本頁筆記</h4>
      <textarea class="pagenote" rows="5" placeholder="這篇文章的整體心得、摘要…"></textarea>
      <input type="text" class="pagetags" placeholder="本頁標籤" style="margin-top:8px">
      <h4>本頁標記 <span class="count"></span></h4>
      <div class="list"></div>
      <div class="row"><button class="btn review">開啟複習頁</button></div>
    </div>
  </aside>
</div>`;
  const $ = (s) => root.querySelector(s);
  const fab = $('.fab'), selbtn = $('.selbtn'), pop = $('.pop'), side = $('.side');
  const ta = pop.querySelector('textarea'), tagsIn = pop.querySelector('.tags');

  const swWrap = $('.sws');
  Object.entries(COLORS).forEach(([name, c]) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.dataset.c = name; b.style.background = c; b.title = name;
    b.onclick = () => { state.color = name; markSwatch(); };
    swWrap.appendChild(b);
  });
  const markSwatch = () => swWrap.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b.dataset.c === state.color));

  const state = { mode: 'new', sel: null, id: null, color: 'yellow' };

  function placeNear(el, rect, w = 300, hEst = 230) {
    const x = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
    let y = rect.bottom + 8;
    if (y + hEst > innerHeight) y = Math.max(8, rect.top - hEst - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function openEditor(mode, rect, init) {
    state.mode = mode; state.sel = init.sel || null; state.id = init.id || null; state.color = init.color || 'yellow';
    pop.querySelector('.quote').textContent = init.quote;
    ta.value = init.comment || '';
    tagsIn.value = (init.tags || []).map((t) => '#' + t).join(' ');
    pop.querySelector('.del').style.display = mode === 'edit' ? '' : 'none';
    markSwatch();
    pop.style.display = 'block';
    placeNear(pop, rect);
    selbtn.style.display = 'none';
    ta.focus();
  }
  const closeEditor = () => { pop.style.display = 'none'; };

  pop.querySelector('.cancel').onclick = closeEditor;
  pop.querySelector('.save').onclick = async () => {
    const comment = ta.value.trim();
    const tags = parseTags(tagsIn.value);
    const data = await load();
    if (state.mode === 'new') {
      const s = state.sel;
      const h = { id: uid(), url: PAGE, title: document.title, quote: s.quote, prefix: s.prefix, suffix: s.suffix,
                  comment, tags, color: state.color, createdAt: Date.now() };
      data.highlights.push(h);
      wrapRange(s.start, s.end, h.id, h.color); // wrap first so the onChanged sync doesn't wrap it twice
      await save({ highlights: data.highlights });
      getSelection().removeAllRanges();
    } else {
      const h = data.highlights.find((x) => x.id === state.id);
      if (h) {
        Object.assign(h, { comment, tags, color: state.color });
        await save({ highlights: data.highlights });
        marksOf(h.id).forEach((m) => paint(m, h.color));
      }
    }
    closeEditor();
    renderSide();
  };
  pop.querySelector('.del').onclick = async () => {
    const data = await load();
    await save({ highlights: data.highlights.filter((x) => x.id !== state.id) });
    unwrap(state.id);
    closeEditor();
    renderSide();
  };

  // selection -> floating button
  let pending = null;
  const inUI = (e) => e.composedPath().includes(host);
  const checkSelection = (e) => {
    if (e && inUI(e)) return;
    setTimeout(() => {
      const s = captureSelection();
      if (!s) { selbtn.style.display = 'none'; return; }
      pending = s;
      selbtn.style.display = 'block';
      placeNear(selbtn, s.rect, 110, 40);
    }, 10);
  };
  document.addEventListener('mouseup', checkSelection);
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) checkSelection(e); });
  document.addEventListener('scroll', () => { selbtn.style.display = 'none'; }, { passive: true });
  selbtn.addEventListener('mousedown', (e) => e.preventDefault());
  selbtn.onclick = () => pending && openEditor('new', pending.rect, { sel: pending, quote: pending.quote });

  document.addEventListener('mousedown', (e) => { if (!inUI(e) && !e.target.closest?.('mark.fn-hl')) closeEditor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });

  // click existing highlight -> edit
  document.addEventListener('click', async (e) => {
    const m = e.target.closest?.('mark.fn-hl');
    if (!m || inUI(e)) return;
    if (!getSelection().isCollapsed) return;
    const { highlights } = await load();
    const h = highlights.find((x) => x.id === m.dataset.fnId);
    if (h) openEditor('edit', m.getBoundingClientRect(), { id: h.id, quote: h.quote, comment: h.comment, tags: h.tags, color: h.color });
  });

  // sidebar
  const noteEl = $('.pagenote'), pageTagsEl = $('.pagetags');
  const toggleSide = () => { side.classList.toggle('open'); if (side.classList.contains('open')) renderSide(); };
  fab.onclick = toggleSide;
  $('.close').onclick = toggleSide;
  $('.review').onclick = () => window.open(api.runtime.getURL('review.html'), '_blank');

  let timer;
  const savePage = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const { pages } = await load();
      const note = noteEl.value.trim(), tags = parseTags(pageTagsEl.value);
      if (!note && !tags.length) delete pages[PAGE];
      else pages[PAGE] = { title: document.title, note, tags, updatedAt: Date.now() };
      await save({ pages });
    }, 400);
  };
  noteEl.addEventListener('input', savePage);
  pageTagsEl.addEventListener('input', savePage);

  async function renderSide() {
    if (!side.classList.contains('open')) return;
    const { highlights, pages } = await load();
    const pg = pages[PAGE];
    if (root.activeElement !== noteEl) noteEl.value = pg?.note || '';
    if (root.activeElement !== pageTagsEl) pageTagsEl.value = (pg?.tags || []).map((t) => '#' + t).join(' ');
    const mine = highlights.filter((h) => h.url === PAGE).sort((a, b) => a.createdAt - b.createdAt);
    $('.count').textContent = mine.length ? `(${mine.length})` : '';
    const list = $('.list');
    list.textContent = '';
    if (!mine.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = '選取文字後按「✎ 標記」即可新增。'; list.appendChild(d); }
    for (const h of mine) {
      const it = document.createElement('div'); it.className = 'item';
      const q = document.createElement('div'); q.className = 'q'; q.style.borderColor = COLORS[h.color]; q.textContent = h.quote.length > 120 ? h.quote.slice(0, 120) + '…' : h.quote;
      it.appendChild(q);
      if (h.comment) { const c = document.createElement('div'); c.className = 'c'; c.textContent = h.comment; it.appendChild(c); }
      if (h.tags?.length) { const t = document.createElement('div'); h.tags.forEach((x) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = '#' + x; t.appendChild(s); }); it.appendChild(t); }
      it.onclick = () => { const m = marksOf(h.id)[0]; if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      list.appendChild(it);
    }
  }

  // ---------- boot ----------
  document.documentElement.appendChild(host);
  [0, 1500, 4000].forEach((ms) => setTimeout(() => syncMarks().then(renderSide), ms));
  api.storage.onChanged.addListener(() => { syncMarks(); renderSide(); });
  api.runtime.onMessage.addListener((msg) => { if (msg?.type === 'toggle-sidebar') toggleSide(); });
})();
