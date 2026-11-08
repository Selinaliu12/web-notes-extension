const api = globalThis.browser || globalThis.chrome;
const COLORS = { yellow: '#fff176', green: '#a5d6a7', blue: '#90caf9', pink: '#f8bbd0' };
const $ = (id) => document.getElementById(id);
let data = { highlights: [], pages: {}, pdfs: {} };
const activeTags = new Set();
const picked = new Set(); // urls selected for sharing

const load = () => api.storage.local.get({ highlights: [], pages: {}, pdfs: {} });
const isPdf = (u) => u.startsWith('pdf:');
const viewerUrl = (fp, extra = '') => `viewer.html?fp=${encodeURIComponent(fp)}${extra}`;
const fmt = (t) => new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}

function groups() {
  const q = $('q').value.trim().toLowerCase();
  const map = new Map();
  const get = (url, title) => {
    if (!map.has(url)) map.set(url, { url, kind: isPdf(url) ? 'pdf' : 'web', fp: isPdf(url) ? url.slice(4) : '', title: title || url, page: null, hls: [], time: 0 });
    return map.get(url);
  };
  const tagOk = (tags) => [...activeTags].every((t) => (tags || []).includes(t));
  const hit = (...s) => !q || s.some((x) => (x || '').toLowerCase().includes(q));

  for (const h of data.highlights) {
    if (!tagOk(h.tags) || !hit(h.quote, h.comment, h.title, ...(h.tags || []))) continue;
    const g = get(h.url, h.title);
    g.hls.push(h);
    g.time = Math.max(g.time, h.createdAt);
  }
  for (const [url, p] of Object.entries(data.pages)) {
    if (!tagOk(p.tags) || !hit(p.note, p.title, ...(p.tags || []))) continue;
    const g = get(url, p.title);
    g.page = p;
    g.time = Math.max(g.time, p.updatedAt || 0);
  }
  // Opened PDFs show up even without notes, so the list doubles as a "what have I read" record.
  if (!activeTags.size) {
    for (const rec of Object.values(data.pdfs)) {
      if (!hit(rec.title, rec.name)) continue;
      const g = get('pdf:' + rec.fp, rec.title || rec.name);
      g.time = Math.max(g.time, rec.openedAt || 0);
    }
  }
  for (const g of map.values()) if (g.kind === 'pdf' && data.pdfs[g.fp]) { g.rec = data.pdfs[g.fp]; g.title = g.rec.title || g.rec.name || g.title; }
  const srcSel = $('src').value;
  const arr = [...map.values()].filter((g) => srcSel === 'all' || g.kind === srcSel);
  arr.sort((a, b) => ($('sort').value === 'new' ? b.time - a.time : a.time - b.time));
  arr.forEach((g) => g.hls.sort((a, b) => a.createdAt - b.createdAt));
  return arr;
}

function renderChips() {
  const counts = {};
  const add = (tags) => (tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
  data.highlights.forEach((h) => add(h.tags));
  Object.values(data.pages).forEach((p) => add(p.tags));
  const box = $('chips');
  box.textContent = '';
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    const c = el('button', { className: 'chip' + (activeTags.has(t) ? ' on' : ''), textContent: `#${t} ${n}` });
    c.onclick = () => { activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t); render(); };
    box.append(c);
  });
}

function tagSpans(tags) {
  return (tags || []).map((t) => {
    const s = el('span', { className: 'tag', textContent: '#' + t });
    s.onclick = () => { activeTags.add(t); render(); };
    return s;
  });
}

function render() {
  renderChips();
  syncShare();
  const list = $('list');
  list.textContent = '';
  const gs = groups();
  const nh = gs.reduce((n, g) => n + g.hls.length, 0);
  const npdf = gs.filter((g) => g.kind === 'pdf').length;
  $('stat').textContent = `${gs.length} 份(網頁 ${gs.length - npdf} · PDF ${npdf}) · ${nh} 則標記`;
  if (gs.length && $('view').value === 'overview') { renderOverview(gs, list); return; }
  if (!gs.length) {
    list.append(el('div', { className: 'empty', textContent: data.highlights.length || Object.keys(data.pages).length || Object.keys(data.pdfs).length ? '沒有符合的筆記' : '還沒有筆記。到任何網頁選取文字,或從工具列開啟 PDF 閱讀器開始吧!' }));
    return;
  }
  for (const g of gs) {
    const card = el('div', { className: 'art' });
    const pick = el('input', { type: 'checkbox', checked: picked.has(g.url), title: '選取以分享' });
    pick.onchange = () => { pick.checked ? picked.add(g.url) : picked.delete(g.url); syncShare(); };
    const linkBtn = el('button', { textContent: '🔗 複製連結', title: '對方需安裝本擴充功能,用連結開啟原文即可匯入' });
    linkBtn.onclick = async () => {
      const link = await Share.makeLink(articleOf(g));
      try { await navigator.clipboard.writeText(link); linkBtn.textContent = '已複製'; } catch { prompt('請複製這個連結:', link); }
      setTimeout(() => { linkBtn.textContent = '🔗 複製連結'; }, 1500);
    };
    Object.assign(linkBtn.style, { border: '0', background: 'none', color: 'var(--acc)', cursor: 'pointer', font: 'inherit', padding: '0' });
    card.dataset.url = g.url;
    if (g.kind === 'pdf') {
      const host = el('div', { className: 'host', textContent: `PDF${g.rec ? ` · ${g.rec.pages} 頁` : ''} · ${fmt(g.time)}` });
      if (g.rec?.src) host.append(' · ', el('a', { href: g.rec.src, target: '_blank', rel: 'noopener', textContent: '原始連結' }));
      const cleanBtn = g.rec?.stored ? el('button', { className: 'hostbtn', textContent: '清除副本', title: '刪除本機保存的 PDF 檔以節省空間,筆記保留' }) : null;
      if (cleanBtn) cleanBtn.onclick = async () => {
        if (!confirm('刪除本機保存的 PDF 副本?筆記會保留,之後重新開啟時需再選一次檔案。')) return;
        await PdfStore.del(g.fp).catch(() => {});
        const cur = await load(); if (cur.pdfs[g.fp]) { cur.pdfs[g.fp].stored = false; await api.storage.local.set({ pdfs: cur.pdfs }); }
      };
      const rmBtn = el('button', { className: 'hostbtn warn', textContent: '移除文獻' });
      rmBtn.onclick = async () => {
        if (!confirm('移除這份文獻?會一併刪除它的所有標記、筆記與本機副本,無法復原。')) return;
        await PdfStore.del(g.fp).catch(() => {});
        const cur = await load(); delete cur.pdfs[g.fp]; delete cur.pages['pdf:' + g.fp];
        await api.storage.local.set({ pdfs: cur.pdfs, pages: cur.pages, highlights: cur.highlights.filter((x) => x.url !== 'pdf:' + g.fp) });
      };
      host.append(el('button', { className: 'hostbtn', textContent: '開啟閱讀器', onclick: () => open(viewerUrl(g.fp)) }));
      if (cleanBtn) host.append(cleanBtn);
      host.append(rmBtn);
      card.append(el('h2', {}, pick, ' ', el('span', { className: 'badge', textContent: 'PDF' }), el('a', { href: viewerUrl(g.fp), target: '_blank', textContent: g.title })), host);
    } else card.append(
      el('h2', {}, pick, ' ', el('span', { className: 'badge web', textContent: '網頁' }), el('a', { href: g.url, target: '_blank', rel: 'noopener', textContent: g.title })),
      el('div', { className: 'host', textContent: `${hostOf(g.url)} · ${fmt(g.time)} ` }, linkBtn),
    );
    if (g.page) {
      const pn = el('div', { className: 'pn' }, el('b', { textContent: g.kind === 'pdf' ? '文獻筆記' : '整頁筆記' }), g.page.note || '');
      if (g.page.tags?.length) pn.append(el('div', { className: 'meta' }, ...tagSpans(g.page.tags)));
      card.append(pn);
    }
    for (const h of g.hls) {
      const box = el('div', { className: 'hl' });
      box.style.borderColor = COLORS[h.color] || COLORS.yellow;
      const c = el('div', { className: 'c', textContent: h.comment || '(點此新增註解)', contentEditable: 'plaintext-only' });
      if (!h.comment) c.style.fontStyle = 'italic';
      c.onfocus = () => { if (!h.comment) { c.textContent = ''; c.style.fontStyle = ''; } };
      c.onblur = async () => {
        const v = c.textContent.trim();
        if (v === (h.comment || '')) { if (!v) { c.textContent = '(點此新增註解)'; c.style.fontStyle = 'italic'; } return; }
        h.comment = v;
        const cur = await load();
        const t = cur.highlights.find((x) => x.id === h.id);
        if (t) { t.comment = v; await api.storage.local.set({ highlights: cur.highlights }); }
      };
      const del = el('button', { className: 'del', textContent: '刪除' });
      del.onclick = async () => {
        if (!confirm('刪除這則標記?')) return;
        const cur = await load();
        await api.storage.local.set({ highlights: cur.highlights.filter((x) => x.id !== h.id) });
        data = await load();
        render();
      };
      box.append(
        el('p', { className: 'q', textContent: h.quote }),
        c,
        el('div', { className: 'meta' }, fmt(h.createdAt), ...(g.kind === 'pdf' ? [el('a', { className: 'pglink', href: viewerUrl(g.fp, `&page=${h.page}&hl=${h.id}`), target: '_blank', textContent: `第 ${h.page} 頁 ↗` })] : []), ...tagSpans(h.tags), del),
      );
      card.append(box);
    }
    list.append(card);
  }
}

function renderOverview(gs, list) {
  const t = el('table', { className: 'ov' });
  t.append(el('thead', {}, el('tr', {}, el('th', { textContent: '來源 / 標題' }), el('th', { className: 'num', textContent: '標記' }), el('th', { className: 'num', textContent: '最近' }), el('th', { textContent: '標籤' }))));
  const tb = el('tbody');
  for (const g of gs) {
    const tags = [...new Set([...(g.page?.tags || []), ...g.hls.flatMap((h) => h.tags || [])])];
    const a = el('a', { href: g.kind === 'pdf' ? viewerUrl(g.fp) : g.url, target: '_blank', rel: 'noopener', textContent: g.title });
    const more = el('button', { className: 'hostbtn', textContent: '看筆記' });
    more.onclick = () => { $('view').value = 'cards'; render(); document.querySelector(`.art[data-url="${CSS.escape(g.url)}"]`)?.scrollIntoView({ block: 'start' }); };
    tb.append(el('tr', {},
      el('td', {}, el('span', { className: 'badge' + (g.kind === 'pdf' ? '' : ' web'), textContent: g.kind === 'pdf' ? 'PDF' : '網頁' }), a, ' ', more),
      el('td', { className: 'num', textContent: String(g.hls.length) }),
      el('td', { className: 'num', textContent: fmt(g.time) }),
      el('td', {}, ...tagSpans(tags)),
    ));
  }
  t.append(tb);
  list.append(t);
}

const articleOf = (g) => ({ url: g.url, title: g.title, page: g.page, highlights: g.hls });
function syncShare() {
  $('share').textContent = `📤 分享所選 (${picked.size})`;
  $('share').disabled = picked.size === 0;
}
$('share').onclick = async () => {
  const arts = groups().filter((g) => picked.has(g.url)).map(articleOf);
  if (!arts.length) return;
  Share.download(`閱讀筆記-${new Date().toISOString().slice(0, 10)}`, await Share.buildHtml(arts));
};

function toMarkdown() {
  const out = ['# 網頁筆記匯出', `> 匯出日期:${fmt(Date.now())}`, ''];
  for (const g of groups()) {
    out.push(g.kind === 'pdf' ? `## 📄 ${g.title} (PDF)` : `## [${g.title}](${g.url})`, '');
    if (g.page?.note) out.push(g.page.note.split('\n').map((l) => '> ' + l).join('\n'), '');
    if (g.page?.tags?.length) out.push(g.page.tags.map((t) => '#' + t).join(' '), '');
    for (const h of g.hls) {
      out.push(`- ${g.kind === 'pdf' ? `(p.${h.page}) ` : ''}${h.quote.replace(/\n/g, ' ')}`);
      if (h.comment) out.push(`  - 📝 ${h.comment.replace(/\n/g, ' ')}`);
      if (h.tags?.length) out.push(`  - ${h.tags.map((t) => '#' + t).join(' ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

$('q').oninput = render;
$('sort').onchange = render;
$('src').onchange = render;
$('view').onchange = render;
$('export').onclick = () => download(`網頁筆記-${new Date().toISOString().slice(0, 10)}.md`, toMarkdown(), 'text/markdown');
$('backup').onclick = () => download(`網頁筆記備份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
$('restore').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const inc = JSON.parse(await f.text());
    const cur = await load();
    const ids = new Set(cur.highlights.map((h) => h.id));
    const hls = [...cur.highlights, ...(inc.highlights || []).filter((h) => !ids.has(h.id))];
    await api.storage.local.set({ highlights: hls, pdfs: { ...Object.fromEntries(Object.entries(inc.pdfs || {}).map(([k, v]) => [k, { ...v, stored: false }])), ...cur.pdfs }, pages: { ...(inc.pages || {}), ...cur.pages } });
    data = await load();
    render();
  } catch { alert('檔案格式不正確'); }
  e.target.value = '';
};

api.storage.onChanged.addListener(async () => { data = await load(); render(); });
load().then((d) => { data = d; render(); });
