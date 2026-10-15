const api = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { apiKey: '', fastModel: 'claude-haiku-4-5-20251001', summaryModel: 'claude-sonnet-5-5', translate: true, lang: 'en-US' };

let settings = { ...DEFAULTS };
let session = null; // { id, title, lang, createdAt, updatedAt, segments: [{at, text, zh}], summary }
let rows = [];      // DOM refs per segment
let running = false, recog = null, saveTimer = null;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isChinese = (l) => l.startsWith('zh');
const clock = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour12: false });
const setStatus = (msg, err) => { $('status').textContent = msg || ''; $('status').className = err ? 'err' : ''; };

// ---------- storage ----------
async function loadSettings() {
  const { settings: s } = await api.storage.local.get({ settings: {} });
  settings = { ...DEFAULTS, ...s };
  $('apikey').value = settings.apiKey;
  $('fastModel').value = settings.fastModel;
  $('sumModel').value = settings.summaryModel;
  $('tr').checked = settings.translate;
  $('lang').value = settings.lang;
}
const persistSettings = () => api.storage.local.set({ settings });

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
async function saveNow() {
  if (!session || (!session.segments.length && !session.summary)) return;
  session.updatedAt = Date.now();
  session.title = $('title').value.trim() || session.title;
  const { recordings } = await api.storage.local.get({ recordings: [] });
  const i = recordings.findIndex((r) => r.id === session.id);
  if (i >= 0) recordings[i] = session; else recordings.push(session);
  await api.storage.local.set({ recordings });
}

function newSession() {
  const d = new Date();
  session = { id: uid(), title: '', lang: $('lang').value, createdAt: Date.now(), updatedAt: Date.now(), segments: [], summary: '' };
  $('title').placeholder = `錄音 ${d.toLocaleDateString('zh-TW')} ${d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- transcript UI ----------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

function addRow(seg) {
  const list = $('list');
  list.querySelector('.empty')?.remove();
  const box = el('div', 'seg');
  const t = el('div', 't', clock(seg.at)), en = el('div', 'en', seg.text), zh = el('div', 'zh', seg.zh || '');
  box.append(t, en, zh);
  list.insertBefore(box, $('interim'));
  rows.push({ box, en, zh });
  list.scrollTop = list.scrollHeight;
}

function renderAll() {
  const list = $('list');
  list.textContent = '';
  rows = [];
  const interim = el('div'); interim.id = 'interim';
  list.append(interim);
  if (!session.segments.length) list.insertBefore(el('div', 'empty', '按「開始錄音」,對著麥克風說話或播放要記錄的內容。'), interim);
  session.segments.forEach(addRow);
  $('title').value = session.title || '';
  $('lang').value = session.lang || 'en-US';
  renderSummary(session.summary);
}

// ---------- translation ----------
async function translateSeg(i) {
  const seg = session.segments[i], row = rows[i];
  if (!settings.translate || isChinese(session.lang) || !row) return;
  if (!settings.apiKey) { row.zh.textContent = '(設定 API key 後即可即時翻譯)'; return; }
  row.zh.textContent = '翻譯中…';
  const ctx = session.segments.slice(Math.max(0, i - 3), i).map((s) => s.text).join(' ');
  try {
    seg.zh = await AI.complete(settings, {
      model: settings.fastModel,
      max: 500,
      system: '你是即時口譯。把使用者提供的逐字稿片段翻成自然、精準的繁體中文(台灣用語)。逐字稿來自語音辨識,可能有辨識錯誤,請依上下文合理判斷。財經、保險、投資專有名詞使用台灣通用譯名,必要時在括號保留英文原文。只輸出譯文,不要加說明。',
      user: (ctx ? `前文(僅供理解語境,不要翻譯):${ctx}\n\n` : '') + `請翻譯:${seg.text}`,
    });
    row.zh.textContent = seg.zh;
    saveSoon();
  } catch (e) {
    row.zh.textContent = `(翻譯失敗:${e.message})`;
  }
}

// ---------- speech recognition ----------
function startRecog() {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) { setStatus('這個瀏覽器不支援語音辨識,請使用 Chrome。', true); return false; }
  recog = new SR();
  recog.lang = session.lang;
  recog.continuous = true;
  recog.interimResults = true;
  recog.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i], text = r[0].transcript.trim();
      if (r.isFinal) {
        if (!text) continue;
        const seg = { at: Date.now(), text, zh: '' };
        session.segments.push(seg);
        addRow(seg);
        translateSeg(session.segments.length - 1);
        saveSoon();
      } else interim += r[0].transcript;
    }
    $('interim').textContent = interim;
    $('list').scrollTop = $('list').scrollHeight;
  };
  recog.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setStatus('麥克風權限被拒絕。請點網址列左側的圖示,允許使用麥克風後重試。', true); running = false; syncButton(); }
    else if (e.error === 'network') setStatus('語音辨識需要網路連線,請檢查網路。', true);
    else setStatus('語音辨識錯誤:' + e.error, true);
  };
  // Chrome ends continuous recognition after silence or ~1 min; restart while the user still wants to record.
  recog.onend = () => { $('interim').textContent = ''; if (running) setTimeout(() => { if (running) { try { recog.start(); } catch {} } }, 250); };
  try { recog.start(); } catch (e) { setStatus('無法啟動:' + e.message, true); return false; }
  return true;
}

function syncButton() {
  $('rec').textContent = running ? '停止錄音' : '開始錄音';
  $('rec').classList.toggle('on', running);
  $('lang').disabled = running;
}

$('rec').onclick = async () => {
  if (running) {
    running = false; recog?.stop(); syncButton(); setStatus('已停止,已自動儲存。'); await saveNow();
    return;
  }
  if (!session) newSession();
  session.lang = $('lang').value;
  setStatus(settings.apiKey ? '' : '尚未設定 API key:目前只做轉錄,設定後可即時翻譯與 AI 整理(右上 ⚙)。');
  running = true;
  if (!startRecog()) running = false;
  syncButton();
};

// ---------- summary ----------
function renderSummary(md) {
  const box = $('summary');
  box.textContent = '';
  let ul = null;
  for (const raw of (md || '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    if (bullet) { if (!ul) { ul = el('ul'); box.append(ul); } const li = el('li'); inline(li, bullet[1]); ul.append(li); continue; }
    ul = null;
    if (/^#{1,4}\s/.test(line)) box.append(el('h3', '', line.replace(/^#+\s*/, '')));
    else if (line.trim()) { const p = el('p'); inline(p, line); box.append(p); }
  }
}
function inline(node, text) {
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) { const b = el('strong', '', part.slice(2, -2)); node.append(b); }
    else if (part) node.append(document.createTextNode(part));
  });
}

$('sum').onclick = async () => {
  if (!session || !session.segments.length) { $('sumst').textContent = '還沒有內容可整理'; return; }
  if (!settings.apiKey) { $('sumst').textContent = '請先在 ⚙ 設定 API key'; $('settings').classList.add('open'); return; }
  const transcript = session.segments.map((s) => `[${clock(s.at)}] ${s.text}`).join('\n');
  $('sum').disabled = true; $('sumst').textContent = '整理中…';
  try {
    const out = await AI.stream(settings, {
      model: settings.summaryModel,
      max: 2500,
      system: '你是專精保險科技、財富管理與投資的研究助理,服務對象是正在學習這些領域的讀者。根據使用者提供的語音辨識逐字稿,用繁體中文(台灣用語)整理。逐字稿可能有辨識錯誤或口語贅詞,請合理校正,但不要編造內容;不確定的地方標註「(待確認)」。輸出 Markdown,依序包含:\n## 一句話摘要\n## 重點整理(3–8 點條列,每點精簡)\n## 關鍵數字與名詞(數字、公司、產品、專有名詞,附一句白話解釋)\n## 值得追問或查證的地方\n不要輸出投資建議。',
      user: `標題:${$('title').value || session.title || '(未命名)'}\n原文語言:${session.lang}\n\n逐字稿:\n${transcript}`,
    }, (partial) => renderSummary(partial));
    session.summary = out;
    await saveNow();
    $('sumst').textContent = '完成,已儲存';
  } catch (e) { $('sumst').textContent = '整理失敗:' + e.message; }
  $('sum').disabled = false;
};

$('copy').onclick = async () => { await navigator.clipboard.writeText(session?.summary || ''); $('sumst').textContent = '已複製'; };

// ---------- export ----------
$('export').onclick = () => {
  if (!session) return;
  const title = $('title').value.trim() || session.title || $('title').placeholder;
  const lines = [`# ${title}`, `> ${new Date(session.createdAt).toLocaleString('zh-TW')}`, ''];
  if (session.summary) lines.push('## AI 重點整理', '', session.summary, '');
  lines.push('## 逐字稿', '');
  session.segments.forEach((s) => { lines.push(`- **${clock(s.at)}** ${s.text}`); if (s.zh) lines.push(`  - ${s.zh}`); });
  const a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
  a.download = `${title}.md`; document.body.append(a); a.click(); a.remove();
};

// ---------- settings ----------
$('gear').onclick = () => $('settings').classList.toggle('open');
$('saveset').onclick = async () => {
  settings.apiKey = $('apikey').value.trim();
  settings.fastModel = $('fastModel').value.trim() || DEFAULTS.fastModel;
  settings.summaryModel = $('sumModel').value.trim() || DEFAULTS.summaryModel;
  await persistSettings();
  $('settings').classList.remove('open');
  setStatus('設定已儲存。');
};
$('tr').onchange = () => { settings.translate = $('tr').checked; persistSettings(); };
$('lang').onchange = () => { settings.lang = $('lang').value; persistSettings(); };
$('title').addEventListener('input', saveSoon);
addEventListener('beforeunload', () => { running = false; recog?.abort(); saveNow(); });

// ---------- boot ----------
(async () => {
  await loadSettings();
  const id = new URLSearchParams(location.search).get('id');
  if (id) {
    const { recordings } = await api.storage.local.get({ recordings: [] });
    session = recordings.find((r) => r.id === id) || null;
  }
  if (!session) newSession();
  renderAll();
})();
