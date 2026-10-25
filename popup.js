const R = window.XCF_REGIONS;
const DEFAULTS = { enabled: true, mode: 'hide', selected: [], useVia: true, showTags: true, allow: [] };
let s = { ...DEFAULTS };
let acc = {};
let stats = {};
let range = 'today';

const $ = id => document.getElementById(id);
function note(box, text) { const n = document.createElement('span'); n.className = 'muted'; n.style.fontSize = '13px'; n.textContent = text; box.appendChild(n); }

function save() { chrome.storage.local.set({ settings: s }); render(); }

function toggle(name) {
  const i = s.selected.findIndex(x => R.norm(x) === R.norm(name));
  if (i >= 0) s.selected.splice(i, 1); else s.selected.push(name);
  save();
}

function chip(text, on, onClick, count) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.textContent = text;
  if (count) { const n = document.createElement('span'); n.className = 'n'; n.textContent = count; b.appendChild(n); }
  b.addEventListener('click', onClick);
  return b;
}

const isOn = name => s.selected.some(x => R.norm(x) === R.norm(name));

function render() {
  $('enabled').checked = s.enabled;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
  $('useVia').checked = s.useVia;
  $('showTags').checked = s.showTags;
  if (document.activeElement !== $('allow')) $('allow').value = s.allow.map(a => '@' + a.replace(/^@/, '')).join(', ');

  const sel = $('selected'); sel.textContent = '';
  for (const name of s.selected) sel.appendChild(chip(name, true, () => toggle(name)));

  const reg = $('regions'); reg.textContent = '';
  for (const name of R.REGION_NAMES) reg.appendChild(chip(name, isOn(name), () => toggle(name)));

  // Locations actually seen, most common first (includes "via" places too).
  const counts = {};
  for (const e of Object.values(acc)) {
    if (e.l) counts[e.l] = (counts[e.l] || 0) + 1;
  }
  const seen = $('seen'); seen.textContent = '';
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40);
  if (!top.length) { note(seen, 'Scroll X for a bit and the places will appear here.'); }
  for (const [loc, n] of top) seen.appendChild(chip(loc, isOn(loc), () => toggle(loc), n));

  renderResults();
  renderCounts();
}

function renderResults() {
  const q = R.norm($('search').value);
  const res = $('results'); res.textContent = '';
  if (!q) return;
  const hits = R.COUNTRIES.filter(c => R.norm(c).includes(q)).slice(0, 12);
  for (const c of hits) res.appendChild(chip(c, isOn(c), () => toggle(c)));
  if (!hits.length) note(res, 'No match.');
}

function renderCounts() {
  document.querySelectorAll('#range button').forEach(b => b.classList.toggle('on', b.dataset.r === range));
  const today = new Date().toISOString().slice(0, 10);
  const src = range === 'today' ? (stats.day === today ? stats.today : null) : stats.total;
  const rows = Object.entries(src || {}).sort((a, b) => b[1] - a[1]);
  const box = $('counts'); box.textContent = '';
  if (!rows.length) {
    note(box, 'Nothing filtered ' + (range === 'today' ? 'today' : 'yet') + '.');
    return;
  }
  const max = rows[0][1];
  const total = rows.reduce((t, r) => t + r[1], 0);
  for (const [loc, n] of rows.slice(0, 12)) {
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = loc; name.title = loc;
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = Math.max(4, n / max * 100) + '%'; bar.appendChild(fill);
    const num = document.createElement('span'); num.className = 'num'; num.textContent = n.toLocaleString();
    row.append(name, bar, num); box.appendChild(row);
  }
  const tot = document.createElement('div'); tot.className = 'row muted'; tot.style.marginTop = '4px';
  const tl = document.createElement('span'); tl.textContent = 'Total';
  const tn = document.createElement('span'); tn.className = 'num'; tn.style.width = 'auto'; tn.textContent = total.toLocaleString();
  tot.append(tl, tn);
  box.appendChild(tot);
}
document.querySelectorAll('#range button').forEach(b => b.addEventListener('click', () => { range = b.dataset.r; renderCounts(); }));

$('enabled').addEventListener('change', e => { s.enabled = e.target.checked; save(); });
document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => { s.mode = b.dataset.mode; save(); }));
$('useVia').addEventListener('change', e => { s.useVia = e.target.checked; save(); });
$('showTags').addEventListener('change', e => { s.showTags = e.target.checked; save(); });
$('search').addEventListener('input', renderResults);
$('allow').addEventListener('change', e => {
  s.allow = e.target.value.split(/[\s,]+/).map(x => x.replace(/^@/, '').trim()).filter(Boolean);
  save();
});
$('openList').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.local.get(['settings', 'acc', 'stats', 'rl']).then(d => {
  s = { ...DEFAULTS, ...(d.settings || {}) };
  acc = d.acc || {};
  const today = new Date().toISOString().slice(0, 10);
  stats = d.stats || {};
  const hidden = stats.day === today ? (stats.hidden || 0) : 0;
  $('stats').textContent = `${Object.keys(acc).length.toLocaleString()} accounts checked · ${hidden} posts filtered today`;
  if (d.rl && d.rl > Date.now()) {
    $('rl').hidden = false;
    $('rl').textContent = `X allows about 50 new account checks every 15 minutes, so it's paused until ${new Date(d.rl).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Accounts already checked are still filtered.`;
  }
  render();
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.stats) { stats = c.stats.newValue || {}; renderCounts(); }
});
