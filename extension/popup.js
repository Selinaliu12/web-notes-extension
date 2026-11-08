const api = globalThis.browser || globalThis.chrome;

document.getElementById('side').onclick = async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    await api.tabs.sendMessage(tab.id, { type: 'toggle-sidebar' });
    window.close();
  } catch {
    document.getElementById('msg').textContent = '此頁無法使用。請確認已在 Safari 設定中允許這個網站,或重新整理頁面。';
  }
};

document.getElementById('pdf').onclick = async () => {
  await api.tabs.create({ url: api.runtime.getURL('viewer.html') });
  window.close();
};

// If the current tab is a PDF (Chrome's built-in viewer), offer to open it in the annotating viewer.
(async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\/[^#]*\.pdf(\?|#|$)/i.test(tab.url)) {
      const b = document.getElementById('curpdf');
      b.hidden = false;
      b.onclick = async () => {
        await api.tabs.create({ url: api.runtime.getURL('viewer.html') + '?src=' + encodeURIComponent(tab.url) });
        window.close();
      };
    }
  } catch {}
})();

document.getElementById('review').onclick = async () => {
  await api.tabs.create({ url: api.runtime.getURL('review.html') });
  window.close();
};
