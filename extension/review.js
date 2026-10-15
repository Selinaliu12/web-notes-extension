const api = globalThis.browser || globalThis.chrome;
const COLORS = { yellow: '#fff176', green: '#a5d6a7', blue: '#90caf9', pink: '#f8bbd0' };
const $ = (id) => document.getElementById(id);
let data = { highlights: [], pages: {}, recordings: [] };
const activeTags = new Set();

const load = () => api.storage.local.get({ highlights: [], pages: {}, recordings: [] });
const fmt = (t) => new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}

function groups() {
  if ($('type').value === 'rec') return [];
  const q = $('q').value.trim().toLowerCase();
  const map = new Map();
  const get = (url, title) => {
    if (!map.has(url)) map.set(url, { url, title: title || url, page: null, hls: [], time: 0 });
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
  const arr = [...map.values()];
  arr.sort((a, b) => ($('sort').value === 'new' ? b.time - a.time : a.time - b.time));
  arr.forEach((g) => g.hls.sort((a, b) => a.createdAt - b.createdAt));
  return arr;
}


const clock = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour12: false });
function recordings() {
  if ($('type').value === 'hl' || activeTags.size) return [];
  const q = $('q').value.trim().toLowerCase();
  const arr = data.recordings.filter((r) => !q || [r.title, r.summary, ...r.segments.flatMap((s) => [s.text, s.zh])].some((x) => (x || '').toLowerCase().includes(q)));
  arr.sort((a, b) => ($('sort').value === 'new' ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));
  return arr;
}
function recCard(r) {
  const card = el('div', { className: 'art' });
  card.append(
    el('h2', { textContent: '🎙 ' + (r.title || '未命名錄音') }),
    el('div', { className: 'host', textContent: `${fmt(r.createdAt)} · ${r.segments.length} 段` }),
  );
  if (r.summary) card.append(el('div', { className: 'pn' }, el('b', { textContent: 'AI 重點整理' }), r.summary));
  const d = el('details', {}, el('summary', { textContent: '逐字稿' }));
  const body = el('div', { className: 'rtext' });
  r.segments.forEach((s) => { body.append(`[${clock(s.at)}] ${s.text}\n`); if (s.zh) body.append(el('span', { className: 'zh', textContent: s.zh + '\n' })); });
  d.append(body);
  const del = el('button', { textContent: '刪除' });
  del.onclick = async () => {
    if (!confirm('刪除這份錄音紀錄?')) return;
    const cur = await load();
    await api.storage.local.set({ recordings: cur.recordings.filter((x) => x.id !== r.id) });
    data = await load(); render();
  };
  card.append(d, el('div', { className: 'acts' }, el('a', { href: 'record.html?id=' + r.id, target: '_blank', textContent: '開啟 / 繼續 / 整理' }), del));
  return card;
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
  const list = $('list');
  list.textContent = '';
  const gs = groups();
  const nh = gs.reduce((n, g) => n + g.hls.length, 0);
  const rs = recordings();
  $('stat').textContent = `${gs.length} 篇文章 · ${nh} 則標記 · ${rs.length} 份錄音`;
  rs.forEach((r) => list.append(recCard(r)));
  if (!gs.length && !rs.length) {
    list.append(el('div', { className: 'empty', textContent: data.highlights.length || Object.keys(data.pages).length || data.recordings.length ? '沒有符合的筆記' : '還沒有筆記。到任何網頁選取文字,按「✎ 標記」開始吧!' }));
    return;
  }
  for (const g of gs) {
    const card = el('div', { className: 'art' });
    card.append(
      el('h2', {}, el('a', { href: g.url, target: '_blank', rel: 'noopener', textContent: g.title })),
      el('div', { className: 'host', textContent: `${hostOf(g.url)} · ${fmt(g.time)}` }),
    );
    if (g.page) {
      const pn = el('div', { className: 'pn' }, el('b', { textContent: '整頁筆記' }), g.page.note || '');
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
        el('div', { className: 'meta' }, fmt(h.createdAt), ...tagSpans(h.tags), del),
      );
      card.append(box);
    }
    list.append(card);
  }
}

function toMarkdown() {
  const out = ['# 網頁筆記匯出', `> 匯出日期:${fmt(Date.now())}`, ''];
  for (const g of groups()) {
    out.push(`## [${g.title}](${g.url})`, '');
    if (g.page?.note) out.push(g.page.note.split('\n').map((l) => '> ' + l).join('\n'), '');
    if (g.page?.tags?.length) out.push(g.page.tags.map((t) => '#' + t).join(' '), '');
    for (const h of g.hls) {
      out.push(`- ${h.quote.replace(/\n/g, ' ')}`);
      if (h.comment) out.push(`  - 📝 ${h.comment.replace(/\n/g, ' ')}`);
      if (h.tags?.length) out.push(`  - ${h.tags.map((t) => '#' + t).join(' ')}`);
    }
    out.push('');
  }
  for (const r of recordings()) {
    out.push(`## 🎙 ${r.title || '未命名錄音'}`, '');
    if (r.summary) out.push(r.summary, '');
    r.segments.forEach((x) => { out.push(`- ${x.text}`); if (x.zh) out.push(`  - ${x.zh}`); });
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
$('type').onchange = render;
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
    const rids = new Set(cur.recordings.map((x) => x.id));
    const recs = [...cur.recordings, ...(inc.recordings || []).filter((x) => !rids.has(x.id))];
    await api.storage.local.set({ highlights: hls, recordings: recs, pages: { ...(inc.pages || {}), ...cur.pages } });
    data = await load();
    render();
  } catch { alert('檔案格式不正確'); }
  e.target.value = '';
};

api.storage.onChanged.addListener(async () => { data = await load(); render(); });
load().then((d) => { data = d; render(); });
