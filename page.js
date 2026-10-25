// Runs inside x.com itself (MAIN world) so requests use your normal logged-in session.
// It looks up "About this account" data and, only when you click Block, blocks an account.
(() => {
  if (window.__xcfPage) return;
  window.__xcfPage = true;

  // Public bearer token used by the x.com web app itself.
  const WEB_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  let queryId = 'XRqGa7EeokUU5kppkh13EA'; // AboutAccountQuery (updated automatically if X changes it)
  let captured = null;

  const KEEP = ['authorization', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type', 'x-twitter-client-language'];

  function capture(url, rawHeaders) {
    try {
      url = String(url || '');
      if (!url.includes('/i/api/')) return;
      const m = url.match(/graphql\/([\w-]+)\/AboutAccountQuery/);
      if (m) queryId = m[1];
      if (!rawHeaders) return;
      const h = {};
      if (rawHeaders instanceof Headers) rawHeaders.forEach((v, k) => { h[k.toLowerCase()] = v; });
      else if (Array.isArray(rawHeaders)) rawHeaders.forEach(([k, v]) => { h[String(k).toLowerCase()] = v; });
      else for (const k of Object.keys(rawHeaders)) h[k.toLowerCase()] = rawHeaders[k];
      if (!h.authorization || !h['x-csrf-token']) return;
      const keep = {};
      for (const k of KEEP) if (h[k]) keep[k] = h[k];
      captured = keep;
    } catch (_) { /* ignore */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      capture(url, (init && init.headers) || (input instanceof Request ? input.headers : null));
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  const XO = XMLHttpRequest.prototype;
  const origOpen = XO.open, origSet = XO.setRequestHeader, origSend = XO.send;
  XO.open = function (method, url) { this.__xcfUrl = url; this.__xcfH = {}; return origOpen.apply(this, arguments); };
  XO.setRequestHeader = function (k, v) { try { if (this.__xcfH) this.__xcfH[k] = v; } catch (_) {} return origSet.apply(this, arguments); };
  XO.send = function () { try { capture(this.__xcfUrl, this.__xcfH); } catch (_) {} return origSend.apply(this, arguments); };

  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function headers() {
    const token = csrf();
    const h = captured ? { ...captured } : {
      'authorization': WEB_BEARER,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session'
    };
    if (token) h['x-csrf-token'] = token; // always use the live cookie value
    if (!h['x-csrf-token']) return null;
    return h;
  }

  // ---------- lookup queue (gentle on X's rate limit) ----------
  const MAX_CONCURRENT = 1;
  const GAP_MS = 1200;
  let active = 0, lastStart = 0, rateLimitedUntil = 0;
  const queue = [];
  const pending = new Map();

  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      if (Date.now() < rateLimitedUntil) { setTimeout(pump, Math.min(rateLimitedUntil - Date.now() + 50, 60000)); return; }
      const wait = lastStart + GAP_MS - Date.now();
      if (wait > 0) { setTimeout(pump, wait); return; }
      // Newest first (what you are looking at now). Drop old backlog so the
      // 50-per-15-minutes allowance isn't spent on posts you scrolled past.
      while (queue.length > 25) queue.shift()(true);
      const job = queue.pop();
      active++; lastStart = Date.now();
      job().finally(() => { active--; pump(); });
    }
  }

  function lookup(handle) {
    const key = handle.toLowerCase();
    if (pending.has(key)) return pending.get(key);
    const p = new Promise(resolve => {
      queue.push(async (skipped) => {
        if (skipped) return resolve({ error: 'skipped' });
        if (Date.now() < rateLimitedUntil) return resolve({ error: 'ratelimit', until: rateLimitedUntil });
        const h = headers();
        if (!h) return resolve({ error: 'auth' });
        const vars = encodeURIComponent(JSON.stringify({ screenName: handle }));
        try {
          const r = await origFetch.call(window, `/i/api/graphql/${queryId}/AboutAccountQuery?variables=${vars}`, {
            method: 'GET', credentials: 'include', headers: { ...h, 'accept-language': 'en-US,en;q=0.9' }
          });
          if (r.status === 429) {
            const reset = Number(r.headers.get('x-rate-limit-reset')) * 1000;
            rateLimitedUntil = reset > Date.now() ? reset : Date.now() + 5 * 60 * 1000;
            return resolve({ error: 'ratelimit', until: rateLimitedUntil });
          }
          // X allows about 50 lookups per 15 minutes. Stop just before the
          // limit instead of hitting it.
          const left = Number(r.headers.get('x-rate-limit-remaining'));
          const resetAt = Number(r.headers.get('x-rate-limit-reset')) * 1000;
          if (Number.isFinite(left) && left <= 1 && resetAt > Date.now()) rateLimitedUntil = resetAt;
          if (r.status === 401 || r.status === 403) { captured = null; return resolve({ error: 'auth' }); }
          if (!r.ok) return resolve({ error: r.status === 404 ? 'notfound' : 'network' });
          const data = await r.json();
          const user = data && data.data && data.data.user_result_by_screen_name && data.data.user_result_by_screen_name.result;
          if (!user) return resolve({ error: 'notfound' });
          const sn = (user.core && user.core.screen_name) || handle;
          if (sn.toLowerCase() !== key) return resolve({ error: 'mismatch' });
          const about = user.about_profile || {};
          resolve({
            ok: true,
            handle: sn,
            name: (user.core && user.core.name) || '',
            loc: about.account_based_in || '',
            via: about.source || ''
          });
        } catch (e) {
          resolve({ error: 'network' });
        }
      });
      pump();
    }).finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }

  async function block(handle) {
    const h = headers();
    if (!h) return { error: 'auth' };
    try {
      const r = await origFetch.call(window, '/i/api/1.1/blocks/create.json', {
        method: 'POST', credentials: 'include',
        headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'screen_name=' + encodeURIComponent(handle)
      });
      if (r.status === 429) return { error: 'ratelimit' };
      if (!r.ok) return { error: 'http ' + r.status };
      return { ok: true };
    } catch (e) {
      return { error: 'network' };
    }
  }

  window.addEventListener('xcf-req', async ev => {
    let req;
    try { req = JSON.parse(ev.detail); } catch (_) { return; }
    let res;
    if (req.type === 'lookup') res = await lookup(req.handle);
    else if (req.type === 'block') res = await block(req.handle);
    else return;
    window.dispatchEvent(new CustomEvent('xcf-res', { detail: JSON.stringify({ id: req.id, res }) }));
  });
})();
