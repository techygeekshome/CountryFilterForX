const R = window.XCF_REGIONS;
let acc = {};
let settings = { selected: [], useVia: true };
const $ = id => document.getElementById(id);
const PAGE = 300;
let shown = PAGE;

function matches(e) {
  if (R.matchesAny(e.l, settings.selected)) return true;
  if (settings.useVia) { const p = R.viaPlace(e.v); if (p && R.matchesAny(p, settings.selected)) return true; }
  return false;
}

function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 48) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function fillLocations() {
  const counts = {};
  for (const e of Object.values(acc)) if (e.l) counts[e.l] = (counts[e.l] || 0) + 1;
  const sel = $('loc');
  const cur = sel.value;
  sel.length = 1;
  for (const r of R.REGION_NAMES) sel.add(new Option('Region: ' + r, 'group:' + r));
  for (const [l, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) sel.add(new Option(`${l} (${n})`, 'loc:' + l));
  sel.value = cur;
}

async function block(e, btn) {
  btn.disabled = true; btn.textContent = 'Blocking…';
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  if (!tabs.length) { btn.disabled = false; btn.textContent = 'Block'; alert('Open x.com in a tab first, then try again.'); return; }
  let res = null;
  for (const t of tabs) {
    try { res = await chrome.tabs.sendMessage(t.id, { type: 'xcf-block', handle: e.h }); if (res) break; } catch (_) {}
  }
  if (res && res.ok) {
    e.b = Date.now();
    const d = await chrome.storage.local.get('acc');
    const all = d.acc || {};
    if (all[e.h.toLowerCase()]) { all[e.h.toLowerCase()].b = e.b; await chrome.storage.local.set({ acc: all }); }
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'done', textContent: 'Blocked' }));
  } else {
    btn.disabled = false; btn.textContent = 'Block';
    alert('Could not block @' + e.h + (res && res.error ? ' (' + res.error + ')' : '. Refresh your X tab and try again.'));
  }
}

function render() {
  const q = R.norm($('q').value);
  const loc = $('loc').value;
  const only = $('onlyMatch').checked;
  let list = Object.values(acc);
  if (only) list = list.filter(matches);
  if (loc.startsWith('group:')) {
    const g = loc.slice(6);
    list = list.filter(e => R.matchesEntry(e.l, g) || (settings.useVia && R.matchesEntry(R.viaPlace(e.v), g)));
  } else if (loc.startsWith('loc:')) {
    const l = loc.slice(4);
    list = list.filter(e => e.l === l);
  }
  if (q) list = list.filter(e => R.norm([e.h, e.n, e.l, e.v].join(' ')).includes(q));
  list.sort((a, b) => (b.t || 0) - (a.t || 0));

  $('summary').textContent = `${list.length.toLocaleString()} of ${Object.keys(acc).length.toLocaleString()} accounts` +
    (list.filter(e => e.b).length ? ` · ${list.filter(e => e.b).length} blocked` : '');

  const tb = $('rows'); tb.textContent = '';
  for (const e of list.slice(0, shown)) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    const link = document.createElement('a');
    link.href = 'https://x.com/' + e.h; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = e.n || e.h;
    const h = document.createElement('div'); h.className = 'handle'; h.textContent = '@' + e.h;
    a.append(link, h);
    const l = document.createElement('td'); l.textContent = e.l || 'Not shown';
    if (!e.l) l.className = 'muted';
    const v = document.createElement('td'); v.textContent = e.v || ''; v.className = 'muted';
    const t = document.createElement('td'); t.textContent = ago(e.t); t.className = 'muted';
    const act = document.createElement('td'); act.className = 'act';
    if (e.b) act.appendChild(Object.assign(document.createElement('span'), { className: 'done', textContent: 'Blocked' }));
    else {
      const btn = document.createElement('button'); btn.className = 'btn danger'; btn.textContent = 'Block';
      btn.addEventListener('click', () => block(e, btn));
      act.appendChild(btn);
    }
    tr.append(a, l, v, t, act);
    tb.appendChild(tr);
  }
  if (list.length > shown) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 5;
    const more = document.createElement('button'); more.className = 'btn ghost'; more.textContent = `Show more (${list.length - shown} left)`;
    more.addEventListener('click', () => { shown += PAGE; render(); });
    td.appendChild(more); tr.appendChild(td); tb.appendChild(tr);
  }
}

['q', 'loc', 'onlyMatch'].forEach(id => $(id).addEventListener('input', () => { shown = PAGE; render(); }));

chrome.storage.local.get(['acc', 'settings']).then(d => {
  acc = d.acc || {};
  settings = { ...settings, ...(d.settings || {}) };
  fillLocations();
  render();
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.acc) { acc = c.acc.newValue || {}; fillLocations(); render(); }
  if (c.settings) { settings = { ...settings, ...(c.settings.newValue || {}) }; render(); }
});
