import * as pdfjs from './pdfjs/pdf.min.mjs';

const api = globalThis.browser || globalThis.chrome;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const ASSET = (p) => new URL('./pdfjs/' + p, import.meta.url).href;
const COLORS = { yellow: '#fff176', green: '#a5d6a7', blue: '#90caf9', pink: '#f8bbd0' };
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const parseTags = Tags.parse;
const load = () => api.storage.local.get({ highlights: [], pages: {}, pdfs: {} });
const save = (o) => api.storage.local.set(o);

const S = { pdf: null, fp: '', url: '', meta: null, scale: 1, fit: true, sizes: [], pageEls: [], gen: 0, highlights: [], pending: null };
const editor = { mode: 'new', sel: null, id: null, color: 'yellow' };
let observer = null;

// ---------- small helpers ----------
let toastTimer;
function toast(msg) { $('toast').textContent = msg; $('toast').classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), 3200); }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const displayName = () => S.meta?.title || S.meta?.name || '';

// ---------- opening documents ----------
function closeDoc() {
  S.gen++;
  observer?.disconnect();
  S.pdf?.destroy();
  S.pdf = null; S.pageEls = []; S.sizes = []; S.highlights = [];
  $('pages').textContent = '';
}

async function openBytes(bytes, name, opt = {}) {
  closeDoc();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data: bytes.slice(), cMapUrl: ASSET('cmaps/'), cMapPacked: true,
      standardFontDataUrl: ASSET('standard_fonts/'), wasmUrl: ASSET('wasm/'), iccUrl: ASSET('iccs/'),
    }).promise;
  } catch (e) { toast('無法開啟這份 PDF:' + (e.message || e)); showHome(); return false; }

  const fp = pdf.fingerprints[0];
  if (opt.expectFp && opt.expectFp !== fp) { toast('這不是原本那份 PDF(內容不同),已取消。'); pdf.destroy(); showHome(); return false; }
  const md = await pdf.getMetadata().catch(() => null);
  const title = (md?.info?.Title || '').trim();

  const d = await load();
  const old = d.pdfs[fp];
  const rec = { fp, name, title, pages: pdf.numPages, size: bytes.length, addedAt: old?.addedAt || Date.now(), openedAt: Date.now(), lastPage: old?.lastPage || 1, src: opt.src || old?.src || '', stored: !!old?.stored };
  if (!rec.stored && !opt.fromStore && $('keep').checked) {
    try { await PdfStore.put(fp, { blob: new Blob([bytes], { type: 'application/pdf' }), name }); rec.stored = true; }
    catch { toast('無法保存 PDF 副本(儲存空間不足?),筆記仍會保存。'); }
  }
  d.pdfs[fp] = rec;
  await save({ pdfs: d.pdfs });

  S.pdf = pdf; S.fp = fp; S.url = 'pdf:' + fp; S.meta = rec; S.pending = null;
  S.highlights = d.highlights.filter((h) => h.url === S.url);
  document.title = displayName() + ' — PDF 閱讀筆記';
  $('docname').textContent = displayName();
  $('home').classList.add('hidden');
  await buildPages();
  const pg = pdf.numPages ? Math.min(Math.max(1, opt.page || rec.lastPage || 1), pdf.numPages) : 1;
  const target = opt.hl && S.highlights.find((h) => h.id === opt.hl);
  if (target) jumpTo(target); else scrollToPage(pg);
  renderSide(d.pages[S.url]);
  $('scroller').dispatchEvent(new Event('scroll'));
  return true;
}

async function buildPages() {
  const pdf = S.pdf, gen = S.gen;
  const first = await pdf.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  S.sizes = Array.from({ length: pdf.numPages }, () => ({ w: vp.width, h: vp.height }));
  if (S.fit) S.scale = Math.max(0.4, Math.min(3, ($('scroller').clientWidth - 48) / vp.width));
  const box = $('pages');
  for (let n = 1; n <= pdf.numPages; n++) {
    const p = el('div', 'page'); p.dataset.n = n; p.append(el('div', 'hlLayer'));
    box.append(p); S.pageEls.push(p);
  }
  layoutPages();
  S.pageEls.forEach((_, i) => drawHl(i + 1));
  observe();
  // Learn real page sizes in the background (papers sometimes mix portrait and landscape pages).
  (async () => {
    for (let n = 2; n <= pdf.numPages; n++) {
      if (S.gen !== gen) return;
      try { const v = (await pdf.getPage(n)).getViewport({ scale: 1 }); S.sizes[n - 1] = { w: v.width, h: v.height }; sizePage(n); } catch { return; }
    }
  })();
}

function sizePage(n) {
  const p = S.pageEls[n - 1], s = S.sizes[n - 1];
  if (!p) return;
  p.style.width = s.w * S.scale + 'px';
  p.style.height = s.h * S.scale + 'px';
  p.style.setProperty('--total-scale-factor', S.scale);
  p.style.setProperty('--scale-factor', S.scale);
}
function layoutPages() { S.pageEls.forEach((_, i) => sizePage(i + 1)); $('zoomind').textContent = Math.round(S.scale * 100) + '%'; }

function observe() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) { const n = +e.target.dataset.n; e.isIntersecting ? renderPage(n) : cleanPage(n); }
  }, { root: $('scroller'), rootMargin: '800px 0px' });
  S.pageEls.forEach((p) => observer.observe(p));
}

function cleanPage(n) {
  const p = S.pageEls[n - 1];
  if (!p) return;
  p._gen = -1;
  p.querySelector('canvas')?.remove();
  p.querySelector('.textLayer')?.remove();
}

async function renderPage(n) {
  const p = S.pageEls[n - 1], gen = S.gen, scale = S.scale;
  if (!p || p._gen === gen + ':' + scale) return;
  p._gen = gen + ':' + scale;
  const stale = () => S.gen !== gen || S.scale !== scale || p._gen !== gen + ':' + scale || !p.isConnected;
  try {
    const page = await S.pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    S.sizes[n - 1] = { w: viewport.width / scale, h: viewport.height / scale };
    sizePage(n);
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    if (stale()) return;
    p.prepend(canvas);
    const tl = el('div', 'textLayer');
    p.append(tl);
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport }).render();
    if (stale()) tl.remove();
  } catch (e) { if (!/cancel/i.test(String(e?.message))) console.warn('render page', n, e); }
}

// ---------- navigation & zoom ----------
function scrollToPage(n, yFrac = 0) {
  const p = S.pageEls[n - 1];
  if (p) $('scroller').scrollTo({ top: p.offsetTop + p.offsetHeight * yFrac - 60 });
}
function jumpTo(h) {
  scrollToPage(h.page, h.rects[0]?.y || 0);
  setTimeout(() => {
    const items = S.pageEls[h.page - 1]?.querySelectorAll(`.hlLayer i[data-id="${h.id}"]`) || [];
    items.forEach((i) => i.classList.add('flash'));
    setTimeout(() => items.forEach((i) => i.classList.remove('flash')), 1600);
  }, 250);
}
function setScale(s, fit) {
  if (!S.pdf) return;
  const sc = $('scroller'), ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
  S.fit = fit; S.scale = Math.max(0.4, Math.min(4, s)); S.gen++;
  S.pageEls.forEach((_, i) => { cleanPage(i + 1); });
  layoutPages();
  sc.scrollTop = ratio * sc.scrollHeight;
  observe();
}
$('zin').onclick = () => setScale(S.scale * 1.2, false);
$('zout').onclick = () => setScale(S.scale / 1.2, false);
$('zfit').onclick = () => { if (S.pdf) setScale(($('scroller').clientWidth - 48) / S.sizes[0].w, true); };

let scrollRaf = 0, lastPageSave = 0;
$('scroller').addEventListener('scroll', () => {
  if (scrollRaf || !S.pdf) return;
  scrollRaf = requestAnimationFrame(async () => {
    scrollRaf = 0;
    const sc = $('scroller'), mid = sc.scrollTop + sc.clientHeight / 3;
    let cur = 1;
    for (const p of S.pageEls) { if (p.offsetTop <= mid) cur = +p.dataset.n; else break; }
    $('pageind').textContent = `${cur} / ${S.pdf.numPages}`;
    clearTimeout(lastPageSave);
    lastPageSave = setTimeout(async () => {
      if (!S.fp) return;
      const d = await load();
      if (d.pdfs[S.fp] && d.pdfs[S.fp].lastPage !== cur) { d.pdfs[S.fp].lastPage = cur; await save({ pdfs: d.pdfs }); }
    }, 800);
  });
});

// ---------- highlights ----------
function drawHl(n) {
  const layer = S.pageEls[n - 1]?.querySelector('.hlLayer');
  if (!layer) return;
  layer.textContent = '';
  for (const h of S.highlights) {
    if (h.page !== n) continue;
    for (const r of h.rects) {
      const i = document.createElement('i');
      i.dataset.id = h.id;
      Object.assign(i.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%', background: COLORS[h.color] || COLORS.yellow });
      layer.append(i);
    }
  }
}

function mergeRects(rs) {
  rs.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines = [];
  for (const r of rs) {
    const ln = lines[lines.length - 1];
    if (ln && Math.abs(r.y + r.h / 2 - ln.cy) < 0.5 * Math.max(r.h, ln.h)) { ln.items.push(r); ln.h = Math.max(ln.h, r.h); } else lines.push({ cy: r.y + r.h / 2, h: r.h, items: [r] });
  }
  const out = [];
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const r of ln.items) {
      if (cur && r.x <= cur.x + cur.w + 0.012) {
        const x2 = Math.max(cur.x + cur.w, r.x + r.w), y1 = Math.min(cur.y, r.y), y2 = Math.max(cur.y + cur.h, r.y + r.h);
        Object.assign(cur, { w: x2 - cur.x, y: y1, h: y2 - y1 });
      } else { cur = { ...r }; out.push(cur); }
    }
  }
  return out;
}

const pageOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.page');

function captureSelection() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const a = pageOf(range.startContainer), b = pageOf(range.endContainer);
  if (!a || !b) return null;
  if (a !== b) { toast('標記請在同一頁內選取;跨頁的段落請分兩次標記。'); return null; }
  const pr = a.getBoundingClientRect();
  const rects = mergeRects([...range.getClientRects()]
    .filter((r) => r.width > 1 && r.height > 2 && r.height < pr.height * 0.15 && r.width < pr.width * 1.02)
    .map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height })));
  const quote = sel.toString().replace(/\s+/g, ' ').trim();
  if (!rects.length || !quote) return null;
  return { page: +a.dataset.n, rects, quote, bounds: range.getBoundingClientRect() };
}

async function createHighlight(s, comment, tags, color) {
  const d = await load();
  const h = { id: uid(), url: S.url, title: displayName(), quote: s.quote, prefix: '', suffix: '', comment, tags, color, createdAt: Date.now(), kind: 'pdf', page: s.page, rects: s.rects };
  d.highlights.push(h);
  await save({ highlights: d.highlights });
  S.highlights.push(h);
  drawHl(s.page);
  renderSide();
  getSelection().removeAllRanges();
}

// ---------- floating toolbar + editor ----------
const selbtn = $('selbtn'), pop = $('pop');
let pending = null;
function placeNear(node, r, w, hEst) {
  const x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let y = r.bottom + 8;
  if (y + hEst > innerHeight) y = Math.max(8, r.top - hEst - 8);
  node.style.left = x + 'px'; node.style.top = y + 'px';
}
const markSwatch = () => $('sws').querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b.dataset.c === editor.color));
Object.entries(COLORS).forEach(([name, c]) => {
  const b = el('button', 'sw'); b.dataset.c = name; b.style.background = c; b.onclick = () => { editor.color = name; markSwatch(); };
  $('sws').append(b);
});

function openEditor(mode, rect, init) {
  Object.assign(editor, { mode, sel: init.sel || null, id: init.id || null, color: init.color || 'yellow' });
  pop.querySelector('.quote').textContent = init.quote;
  pop.querySelector('textarea').value = init.comment || '';
  pop.querySelector('.tags').value = (init.tags || []).map((t) => '#' + t).join(' ');
  pop.querySelector('.del').style.display = mode === 'edit' ? '' : 'none';
  markSwatch();
  pop.style.display = 'block';
  placeNear(pop, rect, 300, 250);
  selbtn.style.display = 'none';
  pop.querySelector('textarea').focus();
}
const closeEditor = () => { pop.style.display = 'none'; };
pop.querySelector('.cancel').onclick = closeEditor;
pop.querySelector('.save').onclick = async () => {
  const comment = pop.querySelector('textarea').value.trim(), tags = parseTags(pop.querySelector('.tags').value);
  if (editor.mode === 'new') await createHighlight(editor.sel, comment, tags, editor.color);
  else {
    const d = await load(), h = d.highlights.find((x) => x.id === editor.id);
    if (h) {
      Object.assign(h, { comment, tags, color: editor.color });
      await save({ highlights: d.highlights });
      const mine = S.highlights.find((x) => x.id === h.id);
      if (mine) { Object.assign(mine, { comment, tags, color: editor.color }); drawHl(mine.page); }
    }
  }
  closeEditor(); renderSide();
};
pop.querySelector('.del').onclick = async () => {
  const d = await load();
  await save({ highlights: d.highlights.filter((x) => x.id !== editor.id) });
  const gone = S.highlights.find((x) => x.id === editor.id);
  S.highlights = S.highlights.filter((x) => x.id !== editor.id);
  if (gone) drawHl(gone.page);
  closeEditor(); renderSide();
};

const checkSelection = () => setTimeout(() => {
  const s = captureSelection();
  if (!s) { selbtn.style.display = 'none'; return; }
  pending = s; selbtn.style.display = 'flex'; placeNear(selbtn, s.bounds, 240, 40);
}, 10);
$('scroller').addEventListener('mouseup', checkSelection);
document.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) checkSelection(); });
$('scroller').addEventListener('scroll', () => { selbtn.style.display = 'none'; }, { passive: true });
selbtn.addEventListener('mousedown', (e) => e.preventDefault());
$('qh').onclick = async () => { if (!pending) return; selbtn.style.display = 'none'; await createHighlight(pending, '', [], 'yellow'); };
$('qc').onclick = () => pending && openEditor('new', pending.bounds, { sel: pending, quote: pending.quote });

// ---------- translate (Chrome's on-device Translator API: text never leaves the browser) ----------
const LANGS = [['zh-Hant', '繁體中文'], ['zh', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
               ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']];
const trBox = $('tr'), trOut = $('trout'), trLang = $('trlang'), trCopy = $('trcopy'), trSave = $('trsave');
LANGS.forEach(([v, n]) => trLang.append(new Option(n, v)));
let trTarget = 'zh-Hant', trText = '', trResult = '', trSel = null, trRun = 0;
api.storage.local.get({ translateTo: 'zh-Hant' }).then((v) => {
  if (LANGS.some(([c]) => c === v.translateTo)) trTarget = v.translateTo;
  trLang.value = trTarget;
});
const closeTr = () => { trBox.style.display = 'none'; trRun++; };
const trShow = (msg, result = '') => {
  trResult = result; trOut.textContent = msg; trOut.classList.toggle('msg', !result);
  trCopy.disabled = trSave.disabled = !result;
};
const guessLang = (t) => /[\u3040-\u30ff]/.test(t) ? 'ja' : /[\uac00-\ud7af]/.test(t) ? 'ko' : /[\u4e00-\u9fff]/.test(t) ? 'zh' : 'en';
async function detectLang(text) {
  try {
    if (globalThis.LanguageDetector) {
      const top = (await (await LanguageDetector.create()).detect(text))[0];
      if (top && top.detectedLanguage && top.detectedLanguage !== 'und') return top.detectedLanguage;
    }
  } catch {}
  return guessLang(text);
}
async function runTranslate() {
  const run = ++trRun, stale = () => run !== trRun;
  if (!globalThis.Translator) return trShow('此瀏覽器不支援內建翻譯(需要 Chrome 138 以上)。');
  trShow('翻譯中…');
  try {
    const source = await detectLang(trText);
    if (stale()) return;
    const base = (l) => l.split('-')[0];
    if (source === trTarget || (base(source) === base(trTarget) && base(source) !== 'zh')) return trShow('原文已經是這個語言了,請在上方改選其他語言。');
    const pair = { sourceLanguage: source, targetLanguage: trTarget };
    const avail = await Translator.availability(pair);
    if (stale()) return;
    if (avail === 'unavailable') return trShow(`Chrome 目前不支援「${source} → ${trTarget}」的翻譯。`);
    if (avail !== 'available') trShow('正在下載語言包(第一次使用需要一點時間)…');
    const t = await Translator.create({
      ...pair,
      monitor(m) { m.addEventListener('downloadprogress', (e) => { if (!stale()) trShow(`正在下載語言包… ${Math.round(e.loaded * 100)}%`); }); },
    });
    const out = await t.translate(trText);
    if (!stale()) trShow(out, out);
  } catch (err) {
    if (!stale()) trShow('翻譯失敗:' + (err?.message || err));
  }
}
function openTranslate(s) {
  closeEditor(); selbtn.style.display = 'none';
  trSel = s;
  trText = s.quote.length > 3000 ? s.quote.slice(0, 3000) : s.quote;
  $('trsrc').textContent = s.quote;
  trLang.value = trTarget;
  trBox.style.display = 'block';
  placeNear(trBox, s.bounds, 320, 220);
  runTranslate();
}
trLang.onchange = () => { trTarget = trLang.value; api.storage.local.set({ translateTo: trTarget }); runTranslate(); };
$('trclose').onclick = closeTr;
trCopy.onclick = async () => {
  try { await navigator.clipboard.writeText(trResult); trCopy.textContent = '已複製'; } catch { trCopy.textContent = '複製失敗'; }
  setTimeout(() => { trCopy.textContent = '複製'; }, 1200);
};
trSave.onclick = () => {
  const s = trSel, comment = trResult;
  if (!s || !comment) return;
  closeTr();
  openEditor('new', s.bounds, { sel: s, quote: s.quote, comment });
};
$('qt').onclick = () => pending && openTranslate(pending);

document.addEventListener('mousedown', (e) => {
  if (!trBox.contains(e.target) && !selbtn.contains(e.target)) closeTr();
  if (!pop.contains(e.target) && !selbtn.contains(e.target)) closeEditor();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeEditor(); closeTr(); } });

$('scroller').addEventListener('click', (e) => {
  if (!getSelection().isCollapsed) return;
  const pg = e.target.closest?.('.page');
  if (!pg) return;
  const r = pg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height, n = +pg.dataset.n;
  const hit = [...S.highlights].reverse().find((h) => h.page === n && h.rects.some((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h));
  if (hit) openEditor('edit', new DOMRect(e.clientX, e.clientY, 0, 0), hit);
});

// ---------- sidebar ----------
let noteTimer;
async function renderSide(page) {
  if (page === undefined) page = (await load()).pages[S.url];
  if (document.activeElement !== $('docnote')) $('docnote').value = page?.note || '';
  if (document.activeElement !== $('doctags')) $('doctags').value = (page?.tags || []).map((t) => '#' + t).join(' ');
  const list = $('hllist');
  list.textContent = '';
  const mine = [...S.highlights].sort((a, b) => a.page - b.page || (a.rects[0]?.y || 0) - (b.rects[0]?.y || 0));
  $('count').textContent = mine.length ? `(${mine.length})` : '';
  if (!mine.length) list.append(el('div', 'empty', '選取文字後按「🖍 標記」或「💬 註解」。'));
  for (const h of mine) {
    const it = el('div', 'item');
    const ed = el('button', 'ed', '✎');
    ed.onclick = (e) => { e.stopPropagation(); openEditor('edit', it.getBoundingClientRect(), h); };
    const head = el('div'); head.append(el('span', 'pg', 'p.' + h.page), ed);
    const q = el('div', 'q', h.quote.length > 140 ? h.quote.slice(0, 140) + '…' : h.quote); q.style.borderColor = COLORS[h.color] || COLORS.yellow;
    it.append(head, q);
    if (h.comment) it.append(el('div', 'c', h.comment));
    if (h.tags?.length) { const t = el('div'); h.tags.forEach((x) => t.append(el('span', 'tag', '#' + x))); it.append(t); }
    it.onclick = () => jumpTo(h);
    list.append(it);
  }
}
function saveDocNote() {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(async () => {
    if (!S.url) return;
    const d = await load(), note = $('docnote').value.trim(), tags = parseTags($('doctags').value);
    if (!note && !tags.length) delete d.pages[S.url];
    else d.pages[S.url] = { title: displayName(), note, tags, updatedAt: Date.now(), kind: 'pdf' };
    await save({ pages: d.pages });
  }, 400);
}
$('docnote').addEventListener('input', saveDocNote);
$('doctags').addEventListener('input', saveDocNote);
$('sidebtn').onclick = () => $('side').classList.toggle('hidden');

// ---------- home / library ----------
async function showHome(msg) {
  $('home').classList.remove('hidden');
  $('docname').textContent = ''; $('pageind').textContent = '';
  if (msg) toast(msg);
  const d = await load();
  const box = $('recent');
  box.textContent = '';
  const recs = Object.values(d.pdfs).sort((a, b) => b.openedAt - a.openedAt);
  if (recs.length) box.append(el('h4', '', '最近的文獻'));
  for (const r of recs) {
    const n = d.highlights.filter((h) => h.url === 'pdf:' + r.fp).length;
    const it = el('div', 'it');
    it.append(el('span', 'n', '📄 ' + (r.title || r.name)), el('small', '', `${r.pages} 頁 · ${n} 則標記${r.stored ? '' : ' · 無副本'}`));
    it.onclick = () => openByFp(r.fp);
    box.append(it);
  }
}

async function openByFp(fp, opt = {}) {
  const d = await load(), rec = d.pdfs[fp];
  if (!rec) return showHome('找不到這份文獻的紀錄');
  const stored = await PdfStore.get(fp).catch(() => null);
  if (stored?.blob) return openBytes(new Uint8Array(await stored.blob.arrayBuffer()), rec.name, { ...opt, expectFp: fp, fromStore: true });
  if (rec.src) { try { return await openFromSrc(rec.src, { ...opt, expectFp: fp }); } catch {} }
  S.pending = { fp, ...opt };
  showHome();
  toast(`本機沒有「${rec.title || rec.name}」的副本。請選擇原本的 PDF 檔,筆記會自動接上。`);
}

async function openFromSrc(src, opt = {}) {
  const origin = new URL(src).origin + '/*';
  let res;
  try { res = await fetch(src, { credentials: 'include' }); }
  catch {
    const ok = await api.permissions?.contains({ origins: [origin] }).catch(() => false);
    if (ok) throw new Error('fetch failed');
    askAuth(src, origin, opt);
    throw new Error('need permission');
  }
  if (!res.ok) { showHome(); toast(`下載失敗(${res.status})。若網站需要登入,請先把 PDF 下載到電腦,再拖進來。`); throw new Error('http ' + res.status); }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') { showHome(); toast('這個連結不是 PDF 檔。'); throw new Error('not pdf'); }
  const name = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'document.pdf');
  return openBytes(bytes, name, { ...opt, src });
}

function askAuth(src, origin, opt) {
  showHome();
  $('authbox').hidden = false;
  $('authmsg').textContent = `要讀取 ${new URL(src).hostname} 上的 PDF,需要你授權這個網站(只授權這一個網站)。`;
  $('authbtn').onclick = async () => {
    const ok = await api.permissions.request({ origins: [origin] }).catch(() => false);
    if (!ok) return toast('未授權。你也可以先下載 PDF,再拖進來。');
    $('authbox').hidden = true;
    openFromSrc(src, opt).catch(() => {});
  };
}

async function handleFile(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const p = S.pending;
  await openBytes(bytes, file.name, p ? { expectFp: p.fp, page: p.page, hl: p.hl } : {});
}
$('openbtn').onclick = () => $('file').click();
$('file').onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };
let dragDepth = 0;
addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('drop').classList.add('on'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('drop').classList.remove('on');
  const f = [...(e.dataTransfer?.files || [])].find((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name));
  if (f) handleFile(f); else toast('請拖入 PDF 檔。');
});

api.storage.onChanged.addListener(async (ch) => {
  if (!S.url || !ch.highlights) return;
  const d = await load();
  const before = S.highlights.map((h) => h.page);
  S.highlights = d.highlights.filter((h) => h.url === S.url);
  new Set([...before, ...S.highlights.map((h) => h.page)]).forEach(drawHl);
  renderSide();
});

// ---------- boot ----------
(async () => {
  const q = new URLSearchParams(location.search);
  const opt = { page: +q.get('page') || undefined, hl: q.get('hl') || undefined };
  if (q.get('fp')) return openByFp(q.get('fp'), opt);
  if (q.get('src')) { try { return await openFromSrc(q.get('src'), opt); } catch { return; } }
  showHome();
})();
