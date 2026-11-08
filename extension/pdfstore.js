// Optional local copies of imported PDFs (IndexedDB), keyed by the PDF's content fingerprint.
// Notes and highlights live in chrome.storage.local; this only holds the file itself so it can be reopened later.
const PdfStore = (() => {
  const open = () => new Promise((resolve, reject) => {
    const r = indexedDB.open('webnotes-pdf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => { db.close(); resolve(req.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  };
  return {
    put: (fp, rec) => run('readwrite', (s) => s.put(rec, fp)),
    get: (fp) => run('readonly', (s) => s.get(fp)),
    del: (fp) => run('readwrite', (s) => s.delete(fp)),
  };
})();
