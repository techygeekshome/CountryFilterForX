// Watches the X timeline and replies, looks up where each author's account is based,
// and hides or blurs posts from the countries / regions you ticked.
(() => {
  const R = window.XCF_REGIONS;
  const CACHE_DAYS = 30;
  const CACHE_MAX = 25000;

  let settings = {
    enabled: true,
    mode: 'hide',        // 'hide' | 'blur'
    selected: [],        // region names, countries or exact labels
    useVia: true,        // also match on "Connected via"
    showTags: true,      // small location tag next to names
    allow: []            // handles that are never hidden
  };
  let cache = {};        // handle(lower) -> { h, n, l, v, t, b }
  const failed = new Map(); // handle -> retry-after time
  let dirty = false;
  let myHandle = null;

  // ---------- page bridge ----------
  let reqId = 0;
  const waiting = new Map();
  window.addEventListener('xcf-res', ev => {
    try {
      const { id, res } = JSON.parse(ev.detail);
      const cb = waiting.get(id);
      if (cb) { waiting.delete(id); cb(res); }
    } catch (_) {}
  });
  function ask(type, handle) {
    return new Promise(resolve => {
      const id = ++reqId;
      waiting.set(id, resolve);
      window.dispatchEvent(new CustomEvent('xcf-req', { detail: JSON.stringify({ id, type, handle }) }));
      setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ error: 'timeout' }); } }, 120000);
    });
  }

  // ---------- storage ----------
  function saveSoon() {
    if (dirty) return;
    dirty = true;
    setTimeout(() => {
      dirty = false;
      const keys = Object.keys(cache);
      if (keys.length > CACHE_MAX) {
        keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
        for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
      }
      chrome.storage.local.set({ acc: cache }).catch(() => {});
    }, 3000);
  }

  // Filtered-post counts per location. Increments are batched and merged into
  // storage so several X tabs don't overwrite each other.
  let pendingCounts = {};
  let statsTimer = null;
  function bumpHidden(loc) {
    pendingCounts[loc] = (pendingCounts[loc] || 0) + 1;
    if (statsTimer) return;
    statsTimer = setTimeout(async () => {
      statsTimer = null;
      const add = pendingCounts; pendingCounts = {};
      const day = new Date().toISOString().slice(0, 10);
      try {
        const d = await chrome.storage.local.get('stats');
        let st = d.stats || {};
        if (st.day !== day) st = { ...st, day, hidden: 0, today: {} };
        st.today = st.today || {}; st.total = st.total || {};
        for (const [k, n] of Object.entries(add)) {
          st.today[k] = (st.today[k] || 0) + n;
          st.total[k] = (st.total[k] || 0) + n;
          st.hidden = (st.hidden || 0) + n;
          st.totalHidden = (st.totalHidden || 0) + n;
        }
        if (!st.since) st.since = Date.now();
        await chrome.storage.local.set({ stats: st });
      } catch (_) {}
    }, 2000);
  }

  // ---------- matching ----------
  function verdict(entry) {
    if (!entry || !settings.enabled || !settings.selected.length) return null;
    const allow = settings.allow.map(a => a.toLowerCase().replace(/^@/, ''));
    if (allow.includes(entry.h.toLowerCase())) return null;
    if (myHandle && entry.h.toLowerCase() === myHandle) return null;
    let hit = R.matchesAny(entry.l, settings.selected);
    if (hit) return entry.l;
    if (settings.useVia) {
      const place = R.viaPlace(entry.v);
      if (place && R.matchesAny(place, settings.selected)) return place + ' (via app store)';
    }
    return null;
  }

  // ---------- DOM ----------
  function authorHandle(article) {
    const box = article.querySelector('[data-testid="User-Name"]');
    if (!box) return null;
    for (const a of box.querySelectorAll('a[href^="/"]')) {
      const m = a.getAttribute('href').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m) return m[1];
    }
    return null;
  }

  function findMyHandle() {
    const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const m = a && a.getAttribute('href') && a.getAttribute('href').match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (m) myHandle = m[1].toLowerCase();
  }

  function clear(article) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (cell && cell.dataset.xcfHidden) { cell.style.display = ''; delete cell.dataset.xcfHidden; }
    article.classList.remove('xcf-blurred');
    article.querySelectorAll(':scope > .xcf-cover').forEach(n => n.remove());
    article.querySelectorAll('.xcf-tag').forEach(n => n.remove());
  }

  function tagText(entry) {
    const parts = [];
    if (entry.l) parts.push(entry.l);
    const place = R.viaPlace(entry.v);
    if (place && R.norm(place) !== R.norm(entry.l)) parts.push('via ' + place);
    return parts.join(' · ');
  }

  function addTag(article, entry) {
    if (!settings.showTags) return;
    const text = tagText(entry);
    if (!text) return;
    const box = article.querySelector('[data-testid="User-Name"]');
    if (!box || box.querySelector('.xcf-tag')) return;
    const tag = document.createElement('span');
    tag.className = 'xcf-tag';
    tag.textContent = text;
    tag.title = 'Account based in: ' + (entry.l || 'unknown') + (entry.v ? '\nConnected via: ' + entry.v : '');
    box.appendChild(tag);
  }

  function apply(article) {
    const handle = article.dataset.xcfH;
    if (!handle) return;
    const entry = cache[handle.toLowerCase()];
    clear(article);
    if (!entry) return;
    addTag(article, entry);
    if (article.dataset.xcfShown === handle) return; // user clicked "Show"
    const why = verdict(entry);
    if (!why) return;
    // Never hide the main post you deliberately opened.
    const isFocal = article.getAttribute('tabindex') === '-1' && /\/status\//.test(location.pathname);
    if (isFocal) return;

    if (settings.mode === 'hide') {
      const cell = article.closest('[data-testid="cellInnerDiv"]');
      if (cell) { cell.style.display = 'none'; cell.dataset.xcfHidden = '1'; }
      else article.style.display = 'none';
    } else {
      article.classList.add('xcf-blurred');
      const cover = document.createElement('div');
      cover.className = 'xcf-cover';
      const label = document.createElement('span');
      label.textContent = 'Filtered: ' + why;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Show';
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        article.dataset.xcfShown = handle;
        apply(article);
      });
      cover.append(label, btn);
      article.prepend(cover);
    }
    if (article.dataset.xcfCounted !== handle) { article.dataset.xcfCounted = handle; bumpHidden(why); }
  }

  const waitingArticles = new Map(); // handle(lower) -> Set(article)

  async function resolve(handle) {
    const key = handle.toLowerCase();
    if (cache[key]) return;
    if ((failed.get(key) || 0) > Date.now()) return;
    if (waitingArticles.has(key) && waitingArticles.get(key).__busy) return;
    const set = waitingArticles.get(key) || new Set();
    set.__busy = true;
    waitingArticles.set(key, set);
    const res = await ask('lookup', handle);
    set.__busy = false;
    if (res && res.ok) {
      const old = cache[key] || {};
      cache[key] = { h: res.handle, n: res.name, l: res.loc, v: res.via, t: Date.now(), b: old.b || 0 };
      saveSoon();
    } else if (res && res.error === 'skipped') {
      failed.set(key, Date.now() + 1000);
    } else if (res && res.error === 'ratelimit') {
      failed.set(key, res.until || Date.now() + 300000);
      chrome.storage.local.set({ rl: res.until || Date.now() + 300000 }).catch(() => {});
    } else {
      failed.set(key, Date.now() + (res && res.error === 'notfound' ? 3600000 : 120000));
    }
    for (const art of set) if (art.isConnected && art.dataset.xcfH && art.dataset.xcfH.toLowerCase() === key) apply(art);
    waitingArticles.delete(key);
  }

  // Look accounts up only when their post is on screen or about to be.
  const viewport = new IntersectionObserver(items => {
    for (const it of items) {
      if (!it.isIntersecting) continue;
      const art = it.target;
      const handle = art.dataset.xcfH;
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (cache[key]) { viewport.unobserve(art); art.__xcfWatched = false; art.dataset.xcfDone = '1'; apply(art); continue; }
      resolve(handle).then(() => {
        if (cache[key]) { viewport.unobserve(art); art.__xcfWatched = false; art.dataset.xcfDone = '1'; }
      });
    }
  }, { rootMargin: '400px 0px' });

  // Retry on-screen posts whose lookup was deferred (rate limit, skipped).
  setInterval(() => {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(art => {
      if (art.__xcfWatched) { viewport.unobserve(art); viewport.observe(art); }
    });
  }, 20000);

  function scan(root) {
    if (!settings.enabled) return;
    const arts = root.querySelectorAll ? root.querySelectorAll('article[data-testid="tweet"]') : [];
    for (const art of arts) {
      const handle = authorHandle(art);
      if (!handle) continue;
      if (art.dataset.xcfH !== handle) {
        if (art.dataset.xcfH) { clear(art); delete art.dataset.xcfShown; }
        art.dataset.xcfH = handle;
      } else if (art.dataset.xcfDone === '1') continue;
      const key = handle.toLowerCase();
      const entry = cache[key];
      if (entry && Date.now() - (entry.t || 0) < CACHE_DAYS * 86400000) {
        art.dataset.xcfDone = '1';
        apply(art);
      } else {
        const set = waitingArticles.get(key) || new Set();
        set.add(art);
        waitingArticles.set(key, set);
        if (entry) delete cache[key]; // stale, refresh
        if (!art.__xcfWatched) { art.__xcfWatched = true; viewport.observe(art); }
      }
    }
  }

  function reapplyAll() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(art => {
      if (!settings.enabled) { clear(art); return; }
      if (art.dataset.xcfH) apply(art);
    });
    scan(document);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!myHandle) findMyHandle();
      scan(document);
    });
  });

  // ---------- messages from the account list page ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'xcf-block' && msg.handle) {
      ask('block', msg.handle).then(res => {
        if (res && res.ok) {
          const key = msg.handle.toLowerCase();
          if (cache[key]) { cache[key].b = Date.now(); saveSoon(); }
        }
        reply(res);
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { settings = { ...settings, ...(changes.settings.newValue || {}) }; reapplyAll(); }
    if (changes.acc && changes.acc.newValue && !dirty) {
      // keep blocked marks written by the list page
      const incoming = changes.acc.newValue;
      for (const k of Object.keys(incoming)) if (cache[k] && incoming[k].b) cache[k].b = incoming[k].b;
    }
  });

  chrome.storage.local.get(['settings', 'acc']).then(data => {
    settings = { ...settings, ...(data.settings || {}) };
    cache = data.acc || {};
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan(document);
  });
})();
