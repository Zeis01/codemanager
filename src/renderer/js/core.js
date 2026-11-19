// Rdzeń interfejsu: helpery DOM, ikony, toasty, modale, stan
'use strict';
window.App = window.App || {};

const ICONS = {
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  stepover: '<path d="M4 12a8 8 0 0 1 15-3.5M19 4v5h-5"/><circle cx="12" cy="18" r="2"/>',
  stepin: '<path d="M12 3v11m0 0-4-4m4 4 4-4"/><circle cx="12" cy="19" r="2"/>',
  stepout: '<path d="M12 15V4m0 0L8 8m4-4 4 4"/><circle cx="12" cy="19" r="2"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5M2 13v3M22 13v3"/>',
  blocks: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h3a2 2 0 0 1 2 2v5"/><circle cx="15" cy="14" r=".6"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.7-8.9A6 6 0 0 1 17.8 8 4.5 4.5 0 0 1 17 18H7Z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M9 4.5 10 7M15 4.5 14 7M7 12H3M21 12h-4M7 16.5l-3 1.5M17 16.5l3 1.5M7 8.5 4 7M17 8.5 20 7"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  container: '<rect x="3" y="7" width="18" height="12" rx="1.5"/><path d="M7 7v12M11 7v12M15 7v12M19 7v12M8 3h8l2 4H6l2-4Z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z"/>',
  games: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01"/>',
  server: '<rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  download: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16m0 5v-5h-5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5Z"/>',
  folderOpen: '<path d="M3 18V6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h7.8A1.5 1.5 0 0 1 20 8.7V10M3 18l2.6-6.8A1.5 1.5 0 0 1 7 10.2h14l-3 8.3H3Z"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/><path d="M14 3v5h5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.7L16 9.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12.5 15H17"/>',
  puzzle: '<path d="M9 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.5a2 2 0 1 1 0 4H17v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H6a1 1 0 0 1-1-1v-3H3.5"/><path d="M5 10V7a1 1 0 0 1 1-1h3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  save: '<path d="M5 3h11l3 3v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V3Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  newfile: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  template: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M9 9v11.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  update: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M21 4v8h-8"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3.5-3.5L4 12l1.5-1.5a4 4 0 0 0 5-5L14.5 6.5Z" transform="rotate(0)"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 17 11"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  profile: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
  import: '<path d="M12 15V3m0 12-4.5-4.5M12 15l4.5-4.5M5 21h14"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
};
function icon(name, cls = '') { return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function toast(msg, type = 'ok', ms = 4200) {
  const el = h(`<div class="toast ${type}">${esc(msg)}</div>`);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function api(ch, ...args) {
  try { return await window.cm.call(ch, ...args); }
  catch (e) { toast(e.message, 'error', 7000); throw e; }
}
async function apiQuiet(ch, ...args) { return window.cm.call(ch, ...args); }

function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="btn ghost icon sm" data-x title="Zamknij">${icon('x')}</button></header>
    <div class="body"></div><footer></footer></div></div>`);
  const bodyEl = $('.body', back);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('[data-x]', back).onclick = close;
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  const foot = $('footer', back);
  for (const a of actions) {
    const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`);
    b.onclick = async () => {
      if (!a.onClick) return close();
      b.disabled = true;
      try { const r = await a.onClick({ close, body: bodyEl, button: b }); if (r !== false) close(); }
      catch (e) { if (e && e.message) toast(e.message, 'error', 7000); }
      finally { b.disabled = false; }
    };
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  $('#modalRoot').appendChild(back);
  setTimeout(() => { const f = $('input, select, textarea', bodyEl); if (f) f.focus(); }, 30);
  return { close, body: bodyEl, el: back };
}

function confirmBox(title, text, okLabel = 'Potwierdź', danger = false) {
  return new Promise(res => {
    let done = false;
    modal({ title, body: `<p class="muted" style="margin:0">${text}</p>`, onClose: () => { if (!done) res(false); },
      actions: [{ label: 'Anuluj' }, { label: okLabel, primary: !danger, danger, onClick: () => { done = true; res(true); } }] });
  });
}
function promptBox(title, label, def = '') {
  return new Promise(res => {
    let val = null;
    const m = modal({ title, body: `<div class="field"><label>${esc(label)}</label><input class="input" value="${esc(def)}"></div>`, onClose: () => res(val),
      actions: [{ label: 'Anuluj' }, { label: 'OK', primary: true, onClick: ({ body }) => { val = $('input', body).value; } }] });
    $('input', m.body).addEventListener('keydown', e => { if (e.key === 'Enter') { val = e.target.value; m.close(); } });
  });
}

// Zadanie z dziennikiem (instalatory)
function jobModal(title) {
  const jobId = 'j' + Date.now();
  const body = h(`<div><p class="muted" style="margin:0 0 10px" data-st>Trwa…</p><div class="progress indet"><i></i></div><div class="joblog"></div></div>`);
  const m = modal({ title, body, actions: [{ label: 'Zamknij' }] });
  const log = $('.joblog', body); const bar = $('.progress', body);
  const off1 = window.cm.on('job:log', d => { if (d.jobId === jobId) { log.textContent += d.line + '\n'; log.scrollTop = log.scrollHeight; } });
  const off2 = window.cm.on('job:progress', d => { if (d.jobId === jobId && d.pct != null) { bar.classList.remove('indet'); $('i', bar).style.width = d.pct + '%'; } });
  return {
    jobId,
    done(msg, ok = true) { off1(); off2(); bar.classList.remove('indet'); $('i', bar).style.width = '100%'; $('i', bar).style.background = ok ? '' : 'var(--coral)'; $('[data-st]', body).textContent = msg; },
    log(line) { log.textContent += line + '\n'; },
    close: m.close,
  };
}

function gameBadge(g, size) {
  const sh = g.short || (g.name || '?').slice(0, 2);
  const dim = size ? `width:${size}px;height:${size}px;` : '';
  const ic = g.iconData || (App.state.icons && App.state.icons.games && App.state.icons.games[g.id]);
  const src = ic && (ic.icon || ic.iconCover);
  if (src) return `<div class="badge-game img" data-fb="${esc(sh)}" data-color="${esc(g.color || '')}" style="${dim}"><img src="${esc(src)}" alt="" draggable="false"></div>`;
  return `<div class="badge-game ${sh.length > 3 ? 'long' : ''}" style="background:${g.color || 'var(--accent-strong)'};${dim}">${esc(sh)}</div>`;
}
// nieudane wczytanie ikony → litery na kolorowym tle
document.addEventListener('error', e => {
  const img = e.target; if (!img || img.tagName !== 'IMG') return;
  const b = img.parentNode; if (!b || !b.classList || !b.classList.contains('badge-game')) return;
  b.classList.remove('img'); b.style.background = b.dataset.color || 'var(--accent-strong)'; b.textContent = b.dataset.fb || '?';
  if ((b.dataset.fb || '').length > 3) b.classList.add('long');
}, true);

function issueIcon(l) { return icon({ error: 'error', warn: 'alert', info: 'info', ok: 'ok' }[l] || 'info', 'ic'); }
function renderIssues(issues, target, onFixed) {
  const wrap = h('<div class="issues"></div>');
  for (const i of issues) {
    const el = h(`<div class="issue ${i.level}">${issueIcon(i.level)}<div>
      <div class="t">${esc(i.title)}</div>
      ${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}
      ${i.fix ? `<div class="fix">${esc(i.fix)}</div>` : ''}
      ${i.files && i.files.length ? `<div class="files">${i.files.map(esc).join('<br>')}</div>` : ''}
      ${i.url || (i.action && target) ? `<div class="row" style="margin-top:8px">${i.action && target ? `<button class="btn sm primary" data-fix>${icon('wrench')}${esc(i.action.label || 'Napraw')}</button>` : ''}${i.url ? `<button class="btn sm" data-url="${esc(i.url)}">${icon('globe')}Otwórz stronę</button>` : ''}</div>` : ''}
    </div></div>`);
    const fb = el.querySelector('[data-fix]');
    if (fb) fb.onclick = () => App.fix(i.action, target, () => { fb.disabled = true; fb.innerHTML = icon('check') + 'Naprawiono'; onFixed && onFixed(); });
    wrap.appendChild(el);
  }
  wrap.addEventListener('click', e => { const a = e.target.closest('[data-url]'); if (a) { e.preventDefault(); api('shell:external', a.dataset.url); } });
  return wrap;
}
// Zadanie w tle z oknem postępu; fn(jobId) zwraca Promise
async function runJob(title, fn, { doneMsg } = {}) {
  const job = jobModal(title);
  try { const r = await fn(job.jobId); job.done(typeof doneMsg === 'function' ? doneMsg(r) : (doneMsg || 'Gotowe.')); return r; }
  catch (e) { job.log('✖ ' + e.message); job.done('Nie udało się: ' + e.message, false); return null; }
}
async function fix(action, target, after) {
  if (action.type === 'open') { api('shell:external', action.url); return; }
  const r = await runJob(action.label || 'Naprawa', jobId => window.cm.call('fix:run', jobId, action, target), { doneMsg: 'Naprawa zakończona. Sprawdź zgodność ponownie.' });
  if (r !== null && after) after(r);
}
function healthBar(mods) {
  const order = ['error', 'warn', 'ok', 'disabled'];
  const total = mods.length || 1;
  const counts = {}; mods.forEach(m => { counts[m.status] = (counts[m.status] || 0) + 1; });
  return `<div class="healthbar" title="Stan modów">${order.filter(o => counts[o]).map(o => `<i class="${o}" style="flex:${counts[o] / total}"></i>`).join('')}</div>`;
}
function fmtSize(b) { if (b == null) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
function timeAgo(t) { if (!t) return 'nigdy'; const s = (Date.now() - t) / 1000; if (s < 60) return 'przed chwilą'; if (s < 3600) return Math.floor(s / 60) + ' min temu'; if (s < 86400) return Math.floor(s / 3600) + ' godz. temu'; return new Date(t).toLocaleDateString('pl-PL'); }

function plural(n, one, few, many) { const n10 = n % 10, n100 = n % 100; return `${n} ${n === 1 ? one : (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) ? few : many}`; }
const STAR_TIP = 'Najlepsza zgodność: pełne sprawdzanie zależności, wersji i konfliktów';
function compatMark(g) {
  if (g.compat === 'full') return `<span class="star" title="${STAR_TIP}">★</span>`;
  return '';
}
// Stan globalny
App.state = { defs: null, detected: null, reports: {}, servers: [], settings: {} };
Object.assign(App, { compatMark, STAR_TIP, runJob, fix, plural, icon, esc, h, $, $$, toast, api, apiQuiet, modal, confirmBox, promptBox, jobModal, gameBadge, renderIssues, healthBar, fmtSize, timeAgo });
