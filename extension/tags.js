// 標籤處理:讓「＃保險科技」「#保險科技」「保險科技」「#保險科技#ETF」都被當成同一個標籤、正確分開。
// - 全形(＃、ＥＴＦ)轉半形;# 與空白、逗號、頓號、分號都當作分隔
// - 比對時不分大小寫(ETF 與 etf 視為相同),顯示時保留第一次出現的寫法
globalThis.Tags = (() => {
  const norm = (s) => String(s ?? '').normalize('NFKC');
  const show = (t) => norm(t).replace(/^#+/, '').trim();
  const key = (t) => show(t).toLowerCase();
  const parse = (s) => {
    const seen = new Set(), out = [];
    for (const raw of norm(s).split(/[#\s,;、]+/)) {
      const t = raw.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(t);
    }
    return out;
  };
  return { parse, key, show };
})();
