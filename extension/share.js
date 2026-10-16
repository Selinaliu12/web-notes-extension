// Sharing helpers: a standalone HTML page of notes, and a link that carries the notes in the URL fragment.
// Nothing is uploaded anywhere; the link's data lives entirely after the "#" and is never sent to a server.
const Share = (() => {
  const COLORS = { yellow: '#fff176', green: '#a5d6a7', blue: '#90caf9', pink: '#f8bbd0' };
  const COLOR_NAMES = Object.keys(COLORS);
  const PREFIX = '#fn-share=';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };

  // ---------- link encoding ----------
  async function gzip(str) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str));
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  async function gunzip(bytes, limit = 2_000_000) {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('too large'); // guard against decompression bombs
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return new TextDecoder().decode(out);
  }

  const toB64u = (bytes) => { let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64u = (str) => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); };

  // article: { url, title, page: {note, tags} | null, highlights: [...] }
  async function makeLink(article) {
    const payload = {
      v: 1,
      t: article.title,
      n: article.page?.note || '',
      g: article.page?.tags || [],
      h: article.highlights.map((h) => ({ q: h.quote, p: (h.prefix || '').slice(-20), s: (h.suffix || '').slice(0, 20), c: h.comment || '', g: h.tags || [], k: h.color })),
    };
    return article.url.split('#')[0] + PREFIX + toB64u(await gzip(JSON.stringify(payload)));
  }

  // Shared data is untrusted: validate types and cap sizes. It is only ever rendered with textContent.
  function sanitize(o) {
    if (!o || o.v !== 1 || !Array.isArray(o.h)) return null;
    const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
    const tags = (a) => (Array.isArray(a) ? a.slice(0, 20).map((t) => str(t, 40)).filter(Boolean) : []);
    return {
      title: str(o.t, 300),
      note: str(o.n, 5000),
      tags: tags(o.g),
      highlights: o.h.slice(0, 200)
        .filter((h) => h && typeof h.q === 'string' && h.q.length > 0)
        .map((h) => ({ quote: str(h.q, 3000), prefix: str(h.p, 40), suffix: str(h.s, 40), comment: str(h.c, 3000), tags: tags(h.g), color: COLOR_NAMES.includes(h.k) ? h.k : 'yellow' })),
    };
  }

  async function parseHash(hash) {
    const m = (hash || '').startsWith(PREFIX) && hash.slice(PREFIX.length).match(/^[A-Za-z0-9_-]+$/);
    if (!m) return null;
    try { return sanitize(JSON.parse(await gunzip(fromB64u(m[0])))); } catch { return null; }
  }

  // ---------- standalone HTML ----------
  async function buildHtml(articles, heading) {
    const date = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const title = heading || (articles.length === 1 ? articles[0].title : '閱讀筆記');
    const parts = [];
    for (const a of articles) {
      let link = '';
      try { link = await makeLink(a); } catch {}
      const tags = (t) => (t || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join(' ');
      parts.push(`<article>
  <h2><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a></h2>
  <div class="host">${esc(hostOf(a.url))}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">在原文顯示標記(需安裝「網頁筆記」擴充功能)</a>` : ''}</div>
  ${a.page?.note ? `<div class="pn"><b>整頁筆記</b>${esc(a.page.note)}${a.page.tags?.length ? `<div class="tags">${tags(a.page.tags)}</div>` : ''}</div>` : ''}
  ${a.highlights.map((h) => `<div class="hl" style="border-color:${COLORS[h.color] || COLORS.yellow}">
    <p class="q">${esc(h.quote)}</p>
    ${h.comment ? `<p class="c">${esc(h.comment)}</p>` : ''}
    ${h.tags?.length ? `<div class="tags">${tags(h.tags)}</div>` : ''}
  </div>`).join('\n  ')}
</article>`);
    }
    return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f6f8;--card:#fff;--fg:#1d1d1f;--mut:#6e6e73;--line:#e2e2e7;--acc:#0a66d6;--soft:#f0f0f4}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--card:#2a2a2d;--fg:#f2f2f4;--mut:#9a9aa1;--line:#46464b;--acc:#5aa2ff;--soft:#36363a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,"PingFang TC","Noto Sans TC",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 4px}.sub{color:var(--mut);font-size:14px;margin-bottom:24px}
article{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:20px}
h2{font-size:18px;margin:0 0 2px}h2 a{color:inherit;text-decoration:none}h2 a:hover{color:var(--acc);text-decoration:underline}
.host{font-size:13px;color:var(--mut);margin-bottom:12px}.host a{color:var(--acc)}
.pn{background:var(--soft);border-radius:10px;padding:10px 14px;margin-bottom:12px;white-space:pre-wrap}.pn b{display:block;font-size:12px;color:var(--mut)}
.hl{border-left:5px solid;padding:2px 0 2px 14px;margin:14px 0}.q{margin:0;white-space:pre-wrap}.c{margin:6px 0 0;color:var(--mut);white-space:pre-wrap}
.tags{margin-top:4px}.tag{font-size:12px;color:var(--acc)}footer{color:var(--mut);font-size:12px;text-align:center;margin-top:28px}
@media print{body{background:#fff;color:#000}article{break-inside:avoid;border:1px solid #ccc}}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1><div class="sub">${esc(date)} · ${articles.length} 篇文章 · ${articles.reduce((n, a) => n + a.highlights.length, 0)} 則標記</div>
${parts.join('\n')}
<footer>由「網頁筆記」產生。標記的原文段落版權屬原作者,請參考原文連結。</footer>
</div></body></html>`;
  }

  function download(name, text, type = 'text/html') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.html';
    document.body.append(a);
    a.click();
    a.remove();
  }

  return { makeLink, parseHash, buildHtml, download, PREFIX };
})();
