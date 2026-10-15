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

document.getElementById('rec').onclick = async () => {
  await api.windows.create({ url: api.runtime.getURL('record.html'), type: 'popup', width: 480, height: 820 });
  window.close();
};

document.getElementById('review').onclick = async () => {
  await api.tabs.create({ url: api.runtime.getURL('review.html') });
  window.close();
};
