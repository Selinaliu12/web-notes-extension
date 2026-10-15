// Minimal Claude client for extension pages. The API key is the user's own, kept in chrome.storage.local.
const AI = (() => {
  const URL = 'https://api.anthropic.com/v1/messages';

  async function request(settings, body) {
    if (!settings.apiKey) throw new Error('尚未設定 API key');
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.status + '';
      try { msg = (await res.json()).error?.message || msg; } catch {}
      throw new Error(msg);
    }
    return res;
  }

  async function complete(settings, { model, system, user, max = 600 }) {
    const res = await request(settings, { model, max_tokens: max, system, messages: [{ role: 'user', content: user }] });
    const data = await res.json();
    return (data.content || []).map((b) => b.text || '').join('').trim();
  }

  // Streams text deltas to onDelta(textSoFar); resolves with the full text.
  async function stream(settings, { model, system, user, max = 2000 }, onDelta) {
    const res = await request(settings, { model, max_tokens: max, stream: true, system, messages: [{ role: 'user', content: user }] });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === 'content_block_delta' && ev.delta?.text) { full += ev.delta.text; onDelta(full); }
          else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream error');
        } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
      }
    }
    return full;
  }

  return { complete, stream };
})();
