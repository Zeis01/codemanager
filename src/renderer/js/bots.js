// Kreator botów Discord (w stylu Discord Bot Maker): komendy, zdarzenia, akcje bez programowania
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  let meta = null; let bots = []; let curId = null; let section = 'commands'; let dirty = false; let saveT = null;

  const TARGET = [['user', 'Autor komendy / osoba ze zdarzenia'], ['option:', 'Osoba z opcji komendy…'], ['', 'ID użytkownika…']];
  const AF = {
    reply: [['text', 'Treść odpowiedzi', 'area'], ['ephemeral', 'Widoczna tylko dla autora (komendy /)', 'check']],
    randomReply: [['texts', 'Odpowiedzi – jedna w wierszu, bot losuje', 'area']],
    send: [['channelId', 'ID kanału', 'text'], ['text', 'Treść', 'area']],
    embed: [['channelId', 'ID kanału (puste = odpowiedź na komendę)', 'text'], ['title', 'Tytuł', 'text'], ['description', 'Opis', 'area'], ['color', 'Kolor paska', 'color'], ['image', 'Obraz (adres URL)', 'text'], ['thumbnail', 'Miniatura (adres URL)', 'text'], ['footer', 'Stopka', 'text']],
    dm: [['target', 'Do kogo', 'target'], ['text', 'Treść', 'area']],
    react: [['emoji', 'Emoji (np. 👍)', 'text']],
    deleteMessage: [],
    addRole: [['target', 'Komu', 'target'], ['roleId', 'ID roli', 'text']],
    removeRole: [['target', 'Komu', 'target'], ['roleId', 'ID roli', 'text']],
    kick: [['target', 'Kogo', 'target'], ['reason', 'Powód', 'text']],
    ban: [['target', 'Kogo', 'target'], ['reason', 'Powód', 'text'], ['deleteDays', 'Usuń wiadomości z ostatnich dni (0–7)', 'number']],
    timeout: [['target', 'Kogo', 'target'], ['minutes', 'Na ile minut', 'number'], ['reason', 'Powód', 'text']],
    setVar: [['name', 'Zmienna', 'text'], ['value', 'Wartość', 'text']],
    incVar: [['name', 'Zmienna', 'text'], ['by', 'O ile (domyślnie 1)', 'number']],
    wait: [['seconds', 'Sekundy', 'number']],
    condition: [['left', 'Wartość', 'text'], ['op', 'Porównanie', 'select', [['==', 'jest równe'], ['!=', 'jest różne'], ['>', 'większe niż'], ['<', 'mniejsze niż'], ['contains', 'zawiera tekst'], ['hasRole', 'autor ma rolę (ID)'], ['isAdmin', 'autor jest administratorem'], ['chance', 'szansa % (losowo)']]], ['right', 'Z czym', 'text']],
    cmServer: [['serverId', 'Serwer gry', 'server'], ['action', 'Akcja', 'select', [['start', 'uruchom'], ['stop', 'zatrzymaj'], ['restart', 'zrestartuj'], ['command', 'wyślij polecenie do konsoli'], ['backup', 'zrób kopię zapasową']]], ['command', 'Polecenie (dla „wyślij polecenie”, np. say {args})', 'text'], ['confirm', 'Odpowiedz wynikiem', 'checkOn']],
    cmStatus: [['channelId', 'ID kanału (puste = odpowiedź)', 'text']],
    httpRequest: [['method', 'Metoda', 'select', [['GET', 'GET'], ['POST', 'POST']]], ['url', 'Adres', 'text'], ['body', 'Treść JSON (dla POST)', 'area'], ['path', 'Pole z odpowiedzi JSON (np. data.name)', 'text'], ['saveAs', 'Zapisz wynik do zmiennej', 'text']],
    log: [['text', 'Tekst do logu', 'text']],
  };
  const GROUPS = [['Wiadomości', ['reply', 'randomReply', 'send', 'embed', 'dm', 'react', 'deleteMessage']], ['Moderacja', ['addRole', 'removeRole', 'kick', 'ban', 'timeout']], ['Logika i dane', ['condition', 'setVar', 'incVar', 'wait', 'httpRequest', 'log']], ['Serwery gier (CodeManager)', ['cmServer', 'cmStatus']]];
  const PH = '{user} {user.name} {option:nazwa} {args} {arg:1} {var:nazwa} {random:1-6} {time} {date} {server.name} {member.count} {game.server} {game.player} {game.players} {result}';

  const TEMPLATES = {
    game: { name: 'Bot serwera gry', desc: 'Status, start, stop i restart serwera z Discorda; powiadomienia o graczach.', make: sid => ({ commands: [
      { name: 'status', type: 'slash', description: 'Stan serwerów gry', actions: [{ type: 'cmStatus' }] },
      { name: 'start', type: 'slash', description: 'Uruchom serwer', permission: 'admin', actions: [{ type: 'cmServer', serverId: sid, action: 'start' }] },
      { name: 'stop', type: 'slash', description: 'Zatrzymaj serwer', permission: 'admin', actions: [{ type: 'cmServer', serverId: sid, action: 'stop' }] },
      { name: 'restart', type: 'slash', description: 'Zrestartuj serwer', permission: 'admin', actions: [{ type: 'cmServer', serverId: sid, action: 'restart' }] },
      { name: 'say', type: 'slash', description: 'Wiadomość na serwerze gry', permission: 'admin', options: [{ name: 'tekst', type: 'string', description: 'Co napisać', required: true }], actions: [{ type: 'cmServer', serverId: sid, action: 'command', command: 'say {option:tekst}' }] },
    ], events: [{ event: 'cm:playerJoin', actions: [{ type: 'send', channelId: '', text: '🟢 **{game.player}** wszedł na {game.server} (graczy: {game.players})' }] }, { event: 'cm:serverCrash', actions: [{ type: 'send', channelId: '', text: '⚠️ Serwer **{game.server}** się wyłączył!' }] }] }) },
    welcome: { name: 'Powitania', desc: 'Wiadomość powitalna i rola dla nowych osób.', make: () => ({ commands: [], events: [{ event: 'memberJoin', actions: [{ type: 'send', channelId: '', text: 'Witaj {user} na **{server.name}**! Jesteś {member.count}. osobą 🎉' }, { type: 'dm', target: 'user', text: 'Cześć {user.name}! Przeczytaj regulamin na serwerze.' }] }, { event: 'memberLeave', actions: [{ type: 'send', channelId: '', text: '👋 {user.name} opuścił serwer.' }] }] }) },
    fun: { name: 'Zabawa', desc: 'Kostka, magiczna kula i licznik.', make: () => ({ commands: [
      { name: 'kostka', type: 'slash', description: 'Rzuć kostką', actions: [{ type: 'reply', text: '🎲 {user.name} wyrzucił **{random:1-6}**' }] },
      { name: 'kula', type: 'slash', description: 'Zadaj pytanie magicznej kuli', options: [{ name: 'pytanie', type: 'string', description: 'Twoje pytanie', required: true }], actions: [{ type: 'randomReply', texts: 'Tak.\nNie.\nRaczej tak.\nWątpię.\nZapytaj później.\nZdecydowanie!' }] },
      { name: 'licznik', type: 'prefix', description: 'Zwiększa licznik', actions: [{ type: 'incVar', name: 'licznik' }, { type: 'reply', text: 'Licznik: **{var:licznik}**' }] },
    ], events: [] }) },
    mod: { name: 'Moderacja', desc: 'Wyrzucanie, wyciszanie i filtr słów.', make: () => ({ commands: [
      { name: 'wycisz', type: 'slash', description: 'Wycisz użytkownika', permission: 'admin', options: [{ name: 'kto', type: 'user', description: 'Kogo', required: true }, { name: 'minuty', type: 'integer', description: 'Na ile minut', required: true }], actions: [{ type: 'timeout', target: 'option:kto', minutes: '{option:minuty}' }, { type: 'reply', text: '🔇 {option:kto} wyciszony na {option:minuty} min.' }] },
      { name: 'wyrzuc', type: 'slash', description: 'Wyrzuć użytkownika', permission: 'admin', options: [{ name: 'kto', type: 'user', description: 'Kogo', required: true }], actions: [{ type: 'kick', target: 'option:kto' }, { type: 'reply', text: '👢 Wyrzucono {option:kto}.' }] },
    ], events: [{ event: 'message', contains: 'brzydkie-słowo', actions: [{ type: 'deleteMessage' }, { type: 'dm', target: 'user', text: 'Twoja wiadomość została usunięta – nie używaj tego słowa.' }] }] }) },
  };

  const cur = () => bots.find(b => b.id === curId);
  const editable = b => ({ name: b.name, guildId: b.guildId, prefix: b.prefix, commands: b.commands, events: b.events, vars: b.vars, appId: b.appId, description: b.description });
  function queueSave() { dirty = true; clearTimeout(saveT); saveT = setTimeout(saveNow, 600); const s = $('[data-saved]'); if (s) s.textContent = 'Zapisywanie…'; }
  async function saveNow() { const b = cur(); if (!b || !dirty) return; clearTimeout(saveT); dirty = false; try { const r = await window.cm.call('bots:update', b.id, editable(b)); Object.assign(b, { status: r.status }); const s = $('[data-saved]'); if (s) s.textContent = 'Zapisano'; } catch (e) { toast(e.message, 'error'); } }

  async function render(el) {
    meta = meta || await api('bots:meta');
    meta.servers = (await api('bots:meta')).servers;
    bots = await api('bots:list');
    if (!curId || !cur()) curId = bots[0] && bots[0].id;
    el.innerHTML = `<div class="bots"><aside class="bots-side"><div class="bots-side-h"><h2>Boty Discord</h2><button class="btn sm primary" data-new>${icon('plus')}Nowy</button></div><div class="bots-list"></div>
      <p class="dim bots-help">Bot działa, dopóki działa CodeManager. Żeby chodził całą dobę na innym komputerze lub hostingu, użyj „Eksportuj projekt” (discord.js).</p></aside><section class="bots-main"></section></div>`;
    $('[data-new]', el).onclick = () => newBot(el);
    drawList(el); drawMain(el);
    App.leaveGuard = () => { saveNow(); return true; };
  }
  function drawList(el) {
    const list = $('.bots-list', el); list.innerHTML = '';
    if (!bots.length) { list.innerHTML = '<p class="dim" style="padding:10px">Nie masz jeszcze botów.</p>'; return; }
    for (const b of bots) {
      const it = h(`<button class="bot-item ${b.id === curId ? 'active' : ''}"><span class="dot ${b.status}"></span><span class="grow">${esc(b.name)}<small>${App.plural((b.commands || []).length, 'komenda', 'komendy', 'komend')} · ${App.plural((b.events || []).length, 'zdarzenie', 'zdarzenia', 'zdarzeń')}</small></span></button>`);
      it.onclick = async () => { await saveNow(); curId = b.id; drawList(el); drawMain(el); };
      list.appendChild(it);
    }
  }
  const STATUS = { online: ['ok', 'online'], connecting: ['warn', 'łączenie…'], offline: ['', 'offline'], error: ['error', 'błąd'] };
  function drawMain(el) {
    const main = $('.bots-main', el); const b = cur();
    if (!b) { main.innerHTML = `<div class="empty" style="margin-top:60px"><h2>Utwórz pierwszego bota</h2><p>Komendy, odpowiedzi, moderacja i sterowanie serwerami gier – bez pisania kodu.</p><button class="btn primary" data-n>${icon('plus')}Nowy bot</button></div>`; $('[data-n]', main).onclick = () => newBot(el); return; }
    const st = STATUS[b.status] || STATUS.offline;
    main.innerHTML = `<div class="bot-head"><div class="grow"><input class="bot-name" value="${esc(b.name)}" aria-label="Nazwa bota"><div class="row" style="gap:8px"><span class="chip ${st[0]}">${st[1]}</span>${b.error ? `<span class="err-text">${esc(b.error)}</span>` : ''}<span class="dim" data-saved></span></div></div>
        ${b.status === 'online' || b.status === 'connecting' ? `<button class="btn" data-stop>${icon('stop')}Zatrzymaj</button>` : `<button class="btn primary" data-start>${icon('play')}Uruchom</button>`}
        <button class="btn" data-export title="Projekt Node.js (discord.js) do uruchomienia na hostingu">${icon('download')}Eksportuj projekt</button><button class="btn ghost icon danger" data-del title="Usuń bota">${icon('trash')}</button></div>
      <div class="tabs"><button data-sec="commands">Komendy (${(b.commands || []).length})</button><button data-sec="events">Zdarzenia (${(b.events || []).length})</button><button data-sec="vars">Zmienne</button><button data-sec="settings">Ustawienia${b.hasToken ? '' : ' <span class="chip warn">brak tokenu</span>'}</button><button data-sec="log">Log</button></div>
      <div class="bot-body"></div>`;
    $$('[data-sec]', main).forEach(x => { x.classList.toggle('active', x.dataset.sec === section); x.onclick = () => { section = x.dataset.sec; drawMain(el); }; });
    $('.bot-name', main).oninput = e => { b.name = e.target.value; queueSave(); };
    $('.bot-name', main).onchange = () => drawList(el);
    const s1 = $('[data-start]', main); if (s1) s1.onclick = async () => { await saveNow(); if (!b.hasToken) { section = 'settings'; drawMain(el); toast('Najpierw wklej token bota', 'warn'); return; } b.status = 'connecting'; drawMain(el); try { await window.cm.call('bots:start', b.id); } catch (e) { b.status = 'error'; b.error = e.message; drawMain(el); } };
    const s2 = $('[data-stop]', main); if (s2) s2.onclick = async () => { await api('bots:stop', b.id); b.status = 'offline'; drawMain(el); drawList(el); };
    $('[data-export]', main).onclick = async () => { await saveNow(); const p = await api('bots:export', b.id); if (p) toast('Wyeksportowano projekt – instrukcja w README.md'); };
    $('[data-del]', main).onclick = async () => { if (!(await App.confirmBox('Usunąć bota?', `<b>${esc(b.name)}</b> i wszystkie jego komendy zostaną usunięte.`, 'Usuń', true))) return; await api('bots:remove', b.id); curId = null; render(el.closest('.view') || el); };
    const body = $('.bot-body', main);
    ({ commands: secCommands, events: secEvents, vars: secVars, settings: secSettings, log: secLog })[section](body, b, el);
  }

  // ---------- komendy ----------
  function secCommands(body, b, el) {
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">Komendy z ukośnikiem (/kostka) pokazują się w Discordzie z podpowiedziami. Komendy z prefiksem (${esc(b.prefix || '!')}kostka) wymagają włączenia „Message Content Intent” w portalu Discord.</p><button class="btn sm primary" data-add>${icon('plus')}Dodaj komendę</button></div><div class="cmd-list"></div>`;
    const list = $('.cmd-list', body);
    (b.commands || []).forEach((c, i) => list.appendChild(cmdCard(c, i, b, () => secCommands(body, b, el), el)));
    if (!(b.commands || []).length) list.innerHTML = '<div class="empty" style="padding:28px"><h2>Brak komend</h2><p>Dodaj komendę albo zacznij od szablonu (przycisk „Nowy” → szablon).</p></div>';
    $('[data-add]', body).onclick = () => { b.commands = b.commands || []; b.commands.push({ name: 'nowa' + (b.commands.length + 1), type: 'slash', description: '', permission: 'everyone', options: [], actions: [{ type: 'reply', text: 'Cześć {user}!' }], _open: true }); queueSave(); secCommands(body, b, el); drawList(el); };
  }
  function cmdCard(c, i, b, redraw, el) {
    const card = h(`<div class="cmd ${c._open ? 'open' : ''}"><div class="cmd-h"><span class="cmd-name mono">${c.type === 'prefix' ? esc(b.prefix || '!') : '/'}${esc(c.name)}</span><span class="dim grow">${esc(c.description || '')}</span>${c.permission === 'admin' ? '<span class="chip warn">admin</span>' : c.permission && c.permission !== 'everyone' ? '<span class="chip">rola</span>' : ''}<span class="dim">${App.plural((c.actions || []).length, 'akcja', 'akcje', 'akcji')}</span><button class="btn sm ghost icon" data-dup title="Duplikuj">⧉</button><button class="btn sm ghost icon danger" data-rm title="Usuń">${icon('trash')}</button></div><div class="cmd-b"></div></div>`);
    $('.cmd-h', card).onclick = e => { if (e.target.closest('button')) return; c._open = !c._open; card.classList.toggle('open', c._open); };
    $('[data-rm]', card).onclick = () => { b.commands.splice(i, 1); queueSave(); redraw(); drawList(el); };
    $('[data-dup]', card).onclick = () => { const x = JSON.parse(JSON.stringify(c)); x.name += '2'; b.commands.splice(i + 1, 0, x); queueSave(); redraw(); };
    const cb = $('.cmd-b', card);
    cb.innerHTML = `<div class="grid three" style="gap:10px"><div class="field"><label>Nazwa (małe litery, bez spacji)</label><input class="input mono" data-f="name" value="${esc(c.name)}"></div>
      <div class="field"><label>Rodzaj</label><select class="input" data-f="type"><option value="slash">komenda z ukośnikiem /</option><option value="prefix" ${c.type === 'prefix' ? 'selected' : ''}>komenda z prefiksem ${esc(b.prefix || '!')}</option></select></div>
      <div class="field"><label>Kto może używać</label><select class="input" data-f="permission"><option value="everyone">każdy</option><option value="admin" ${c.permission === 'admin' ? 'selected' : ''}>administratorzy (Zarządzanie serwerem)</option><option value="role" ${c.permission && !['everyone', 'admin'].includes(c.permission) ? 'selected' : ''}>osoby z rolą…</option></select></div></div>
      <div class="field ${c.permission && !['everyone', 'admin'].includes(c.permission) ? '' : 'hidden'}" data-rolef><label>ID roli</label><input class="input mono" data-role value="${esc(c.permission && !['everyone', 'admin', 'role'].includes(c.permission) ? c.permission : '')}"></div>
      <div class="field"><label>Opis (widoczny w Discordzie)</label><input class="input" data-f="description" value="${esc(c.description || '')}" maxlength="100"></div>
      ${c.type === 'prefix' ? '<p class="dim" style="font-size:12.5px">Słowa po komendzie: {args} (wszystkie), {arg:1}, {arg:2}…</p>' : '<div data-opts></div>'}
      <h4 class="act-title">Akcje – wykonywane po kolei</h4><div data-acts></div>`;
    $$('[data-f]', cb).forEach(inp => inp.onchange = inp.oninput = () => {
      let v = inp.value; if (inp.dataset.f === 'name') { v = v.toLowerCase().replace(/[^a-z0-9_ąćęłńóśźż-]/g, '').slice(0, 32); }
      if (inp.dataset.f === 'permission') { $('[data-rolef]', cb).classList.toggle('hidden', v !== 'role'); if (v === 'role') v = $('[data-role]', cb).value || 'role'; }
      c[inp.dataset.f] = v; queueSave();
      if (inp.dataset.f === 'type' && inp.type !== 'text') redraw();
      if (inp.dataset.f === 'name') $('.cmd-name', card).textContent = (c.type === 'prefix' ? b.prefix || '!' : '/') + v;
    });
    $('[data-role]', cb).oninput = e => { c.permission = e.target.value.trim() || 'role'; queueSave(); };
    const opts = $('[data-opts]', cb); if (opts) optionsEditor(opts, c);
    actionsEditor($('[data-acts]', cb), c.actions = c.actions || [], { cmd: c });
    return card;
  }
  function optionsEditor(box, c) {
    c.options = c.options || [];
    box.innerHTML = `<h4 class="act-title">Opcje komendy <span class="dim">(np. /wycisz <i>kto</i> <i>minuty</i>; w tekstach: {option:nazwa})</span></h4><div class="opt-rows"></div><button class="btn sm ghost" data-ao>${icon('plus')}Dodaj opcję</button>`;
    const rows = $('.opt-rows', box);
    c.options.forEach((o, i) => {
      const r = h(`<div class="opt-row"><input class="input mono" data-k="name" value="${esc(o.name)}" placeholder="nazwa"><select class="input" data-k="type">${[['string', 'tekst'], ['integer', 'liczba całkowita'], ['number', 'liczba'], ['boolean', 'tak/nie'], ['user', 'użytkownik'], ['channel', 'kanał'], ['role', 'rola']].map(([v, n]) => `<option value="${v}" ${o.type === v ? 'selected' : ''}>${n}</option>`).join('')}</select><input class="input" data-k="description" value="${esc(o.description || '')}" placeholder="opis"><label class="check"><input type="checkbox" data-k="required" ${o.required ? 'checked' : ''}><span>wymagana</span></label><button class="btn sm ghost icon danger" data-x>${icon('x')}</button></div>`);
      $$('[data-k]', r).forEach(inp => inp.onchange = inp.oninput = () => { o[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.dataset.k === 'name' ? inp.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') : inp.value; queueSave(); });
      $('[data-x]', r).onclick = () => { c.options.splice(i, 1); queueSave(); optionsEditor(box, c); };
      rows.appendChild(r);
    });
    $('[data-ao]', box).onclick = () => { c.options.push({ name: 'opcja' + (c.options.length + 1), type: 'string', description: '', required: true }); queueSave(); optionsEditor(box, c); };
  }

  // ---------- akcje (z zagnieżdżonymi warunkami) ----------
  function actionsEditor(box, actions, ctx, depth = 0) {
    box.innerHTML = ''; box.classList.add('acts');
    actions.forEach((a, i) => box.appendChild(actionRow(a, i, actions, () => actionsEditor(box, actions, ctx, depth), ctx, depth)));
    const add = h(`<div class="act-add"><select class="input"><option value="">+ Dodaj akcję…</option>${GROUPS.map(([g, ids]) => `<optgroup label="${esc(g)}">${ids.map(id => `<option value="${id}">${esc(meta.actions[id])}</option>`).join('')}</optgroup>`).join('')}</select></div>`);
    $('select', add).onchange = e => { const t = e.target.value; if (!t) return; const a = { type: t }; if (t === 'condition') { a.op = '=='; a.then = []; a.else = []; } if (t === 'cmServer') { a.serverId = (meta.servers[0] || {}).id || ''; a.action = 'start'; } if (t === 'reply') a.text = ''; actions.push(a); queueSave(); actionsEditor(box, actions, ctx, depth); };
    box.appendChild(add);
  }
  function actionRow(a, i, actions, redraw, ctx, depth) {
    const row = h(`<div class="act"><div class="act-h"><span class="act-n">${i + 1}</span><b class="grow">${esc(meta.actions[a.type] || a.type)}</b><button class="btn sm ghost icon" data-mv="-1" title="Wyżej" ${i ? '' : 'disabled'}>↑</button><button class="btn sm ghost icon" data-mv="1" title="Niżej" ${i < actions.length - 1 ? '' : 'disabled'}>↓</button><button class="btn sm ghost icon danger" data-x title="Usuń">${icon('x')}</button></div><div class="act-f"></div></div>`);
    $$('[data-mv]', row).forEach(bt => bt.onclick = () => { const j = i + +bt.dataset.mv; [actions[i], actions[j]] = [actions[j], actions[i]]; queueSave(); redraw(); });
    $('[data-x]', row).onclick = () => { actions.splice(i, 1); queueSave(); redraw(); };
    const f = $('.act-f', row);
    for (const [key, label, kind, opts] of AF[a.type] || []) {
      let html;
      const v = a[key] == null ? '' : a[key];
      if (kind === 'area') html = `<textarea class="input" rows="2" data-k="${key}" placeholder="${key === 'texts' ? 'Odpowiedź 1\nOdpowiedź 2' : ''}">${esc(v)}</textarea>`;
      else if (kind === 'check' || kind === 'checkOn') html = `<label class="check"><input type="checkbox" data-k="${key}" ${(kind === 'checkOn' ? v !== false : !!v) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
      else if (kind === 'select') html = `<select class="input" data-k="${key}">${opts.map(([o, n]) => `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      else if (kind === 'server') html = meta.servers.length ? `<select class="input" data-k="${key}">${meta.servers.map(s => `<option value="${esc(s.id)}" ${v === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : '<span class="dim">Najpierw utwórz serwer w zakładce Serwery.</span>';
      else if (kind === 'color') html = `<input type="color" data-k="${key}" value="${esc(v || '#2f9e5b')}">`;
      else if (kind === 'target') {
        const optUsers = ((ctx.cmd && ctx.cmd.options) || []).filter(o => o.type === 'user');
        const mode = !v || v === 'user' ? 'user' : String(v).startsWith('option:') ? 'option' : 'id';
        html = `<div class="inline-input"><select class="input" data-tm><option value="user" ${mode === 'user' ? 'selected' : ''}>autor / osoba ze zdarzenia</option>${optUsers.map(o => `<option value="option:${esc(o.name)}" ${v === 'option:' + o.name ? 'selected' : ''}>z opcji „${esc(o.name)}”</option>`).join('')}<option value="id" ${mode === 'id' ? 'selected' : ''}>podane ID…</option></select><input class="input mono ${mode === 'id' ? '' : 'hidden'}" data-tid value="${mode === 'id' ? esc(v) : ''}" placeholder="ID lub {var:x}"></div>`;
      } else html = `<input class="input ${/Id$|url|image|thumbnail|path/.test(key) ? 'mono' : ''}" data-k="${key}" value="${esc(v)}" ${kind === 'number' ? 'inputmode="numeric"' : ''}>`;
      const fl = h(`<div class="field ${kind === 'area' ? 'wide' : ''}">${kind === 'check' || kind === 'checkOn' ? '' : `<label>${esc(label)}</label>`}${html}</div>`);
      f.appendChild(fl);
    }
    $$('[data-k]', f).forEach(inp => inp.onchange = inp.oninput = () => { a[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; queueSave(); });
    const tm = $('[data-tm]', f); if (tm) { const tid = $('[data-tid]', f); tm.onchange = () => { tid.classList.toggle('hidden', tm.value !== 'id'); a.target = tm.value === 'id' ? tid.value : tm.value; queueSave(); }; tid.oninput = () => { a.target = tid.value; queueSave(); }; }
    if (a.type === 'condition' && depth < 3) {
      a.then = a.then || []; a.else = a.else || [];
      const br = h('<div class="cond"><div><span class="cond-l yes">jeżeli tak</span><div data-then></div></div><div><span class="cond-l no">w przeciwnym razie</span><div data-else></div></div></div>');
      actionsEditor($('[data-then]', br), a.then, ctx, depth + 1); actionsEditor($('[data-else]', br), a.else, ctx, depth + 1);
      f.appendChild(br);
    }
    return row;
  }

  // ---------- zdarzenia ----------
  function secEvents(body, b, el) {
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">Zdarzenia uruchamiają akcje same: ktoś dołączył do Discorda, gracz wszedł na serwer gry, serwer padł… Zdarzenia z serwerów gier działają, gdy serwer jest uruchomiony w CodeManagerze.</p><button class="btn sm primary" data-add>${icon('plus')}Dodaj zdarzenie</button></div><div class="cmd-list"></div>`;
    const list = $('.cmd-list', body);
    (b.events || []).forEach((ev, i) => {
      const card = h(`<div class="cmd ${ev._open !== false ? 'open' : ''}"><div class="cmd-h"><span class="cmd-name">${esc(meta.events[ev.event] || ev.event)}</span><span class="grow"></span><span class="dim">${App.plural((ev.actions || []).length, 'akcja', 'akcje', 'akcji')}</span><button class="btn sm ghost icon danger" data-rm>${icon('trash')}</button></div><div class="cmd-b">
        <div class="field"><label>Kiedy</label><select class="input" data-ev>${Object.entries(meta.events).map(([k, n]) => `<option value="${k}" ${ev.event === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        ${ev.event === 'message' ? `<div class="field"><label>Wiadomość zawiera tekst (puste = każda wiadomość)</label><input class="input" data-cont value="${esc(ev.contains || '')}"></div>` : ''}
        <h4 class="act-title">Akcje</h4><div data-acts></div></div></div>`);
      $('.cmd-h', card).onclick = e => { if (e.target.closest('button')) return; ev._open = ev._open === false; card.classList.toggle('open', ev._open !== false); };
      $('[data-rm]', card).onclick = () => { b.events.splice(i, 1); queueSave(); secEvents(body, b, el); drawList(el); };
      $('[data-ev]', card).onchange = e => { ev.event = e.target.value; queueSave(); secEvents(body, b, el); };
      const cont = $('[data-cont]', card); if (cont) cont.oninput = () => { ev.contains = cont.value; queueSave(); };
      actionsEditor($('[data-acts]', card), ev.actions = ev.actions || [], { event: ev });
      list.appendChild(card);
    });
    if (!(b.events || []).length) list.innerHTML = '<div class="empty" style="padding:28px"><h2>Brak zdarzeń</h2><p>Np. „Gracz wszedł na serwer gry” → „Wyślij na kanał”.</p></div>';
    $('[data-add]', body).onclick = () => { b.events = b.events || []; b.events.push({ event: 'memberJoin', actions: [{ type: 'send', channelId: '', text: 'Witaj {user}!' }] }); queueSave(); secEvents(body, b, el); drawList(el); };
  }
  function secVars(body, b) {
    const vars = b.vars || {};
    body.innerHTML = `<p class="muted" style="margin-top:0">Zmienne pamiętają liczby i teksty między uruchomieniami bota (np. licznik, punkty). W tekstach wstawisz je jako {var:nazwa}.</p>
      <table class="table"><thead><tr><th>Nazwa</th><th>Wartość</th><th style="width:60px"></th></tr></thead><tbody>${Object.entries(vars).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td><input class="input" data-v="${esc(k)}" value="${esc(v)}"></td><td><button class="btn sm ghost icon danger" data-d="${esc(k)}">${icon('x')}</button></td></tr>`).join('') || '<tr><td colspan="3" class="dim">Brak zmiennych – powstaną same przy akcji „Ustaw zmienną”.</td></tr>'}</tbody></table>
      <button class="btn sm" data-add style="margin-top:10px">${icon('plus')}Dodaj zmienną</button>
      <h3 style="margin:22px 0 8px">Wstawki do tekstów</h3><div class="ph-list">${PH.split(' ').map(p => `<code>${esc(p)}</code>`).join('')}</div>`;
    $$('[data-v]', body).forEach(i => i.oninput = () => { vars[i.dataset.v] = isNaN(+i.value) || i.value === '' ? i.value : +i.value; b.vars = vars; queueSave(); });
    $$('[data-d]', body).forEach(x => x.onclick = () => { delete vars[x.dataset.d]; b.vars = vars; queueSave(); secVars(body, b); });
    $('[data-add]', body).onclick = async () => { const n = await App.promptBox('Nowa zmienna', 'Nazwa', ''); if (!n) return; vars[n.trim()] = 0; b.vars = vars; queueSave(); secVars(body, b); };
  }
  function inviteUrl(b) {
    if (!b.appId) return null;
    const perms = [2n, 4n, 64n, 1024n, 2048n, 8192n, 16384n, 65536n, 268435456n, 1099511627776n].reduce((a, x) => a | x, 0n);
    return `https://discord.com/oauth2/authorize?client_id=${b.appId}&scope=bot+applications.commands&permissions=${perms}`;
  }
  function secSettings(body, b, el) {
    const inv = inviteUrl(b);
    body.innerHTML = `<div class="grid two" style="align-items:start"><div>
      <div class="field"><label>Token bota</label><div class="inline-input"><input class="input mono" type="password" data-token placeholder="${b.hasToken ? '•••••••• (zapisany, zaszyfrowany)' : 'wklej token z Discord Developer Portal'}"><button class="btn" data-st>Zapisz token</button></div><span class="hint">Token jest szyfrowany na tym komputerze. Nikomu go nie pokazuj – kto go ma, steruje botem.</span></div>
      <div class="field"><label>ID serwera Discord (opcjonalnie)</label><input class="input mono" data-k="guildId" value="${esc(b.guildId || '')}" placeholder="np. 123456789012345678"><span class="hint">Z ID komendy / pojawiają się od razu na tym serwerze. Bez ID są globalne (Discord odświeża je do godziny).</span></div>
      <div class="field"><label>Prefiks komend tekstowych</label><input class="input mono" data-k="prefix" value="${esc(b.prefix || '!')}" style="width:100px"></div>
      ${inv ? `<div class="field"><label>Link zaproszenia bota na serwer</label><div class="inline-input"><input class="input mono" readonly value="${esc(inv)}"><button class="btn" data-inv>Otwórz</button></div></div>` : ''}
      </div><div class="panel guide"><h3 style="margin-top:0">Jak utworzyć bota</h3><ol>
        <li>Otwórz <a href="#" data-portal>Discord Developer Portal</a> → <b>New Application</b>, nadaj nazwę.</li>
        <li>Zakładka <b>Bot</b> → <b>Reset Token</b> → skopiuj token i wklej obok.</li>
        <li>Na tej samej stronie włącz <b>Server Members Intent</b> (powitania) i <b>Message Content Intent</b> (komendy z prefiksem, filtr wiadomości).</li>
        <li>Po zapisaniu tokenu pojawi się link zaproszenia – otwórz go i wybierz swój serwer.</li>
        <li>Kliknij <b>Uruchom</b>. Gotowe!</li></ol>
        <p class="dim" style="font-size:12.5px;margin-bottom:0">Włącz tryb dewelopera w Discordzie (Ustawienia → Zaawansowane), aby kopiować ID kanałów, ról i serwera prawym przyciskiem.</p></div></div>`;
    $('[data-st]', body).onclick = async () => {
      const t = $('[data-token]', body).value.trim(); if (!t) return;
      let appId = b.appId; try { appId = atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')); if (!/^\d{15,22}$/.test(appId)) appId = b.appId; } catch { /* */ }
      const r = await api('bots:update', b.id, { token: t, appId }); Object.assign(b, { hasToken: r.hasToken, appId }); toast('Zapisano token'); drawMain(el);
    };
    $$('[data-k]', body).forEach(i => i.oninput = () => { b[i.dataset.k] = i.value.trim(); queueSave(); });
    $('[data-portal]', body).onclick = e => { e.preventDefault(); api('shell:external', 'https://discord.com/developers/applications'); };
    const ib = $('[data-inv]', body); if (ib) ib.onclick = () => api('shell:external', inv);
  }
  async function secLog(body, b) {
    const lines = await api('bots:log', b.id);
    body.innerHTML = `<div class="console bot-log">${lines.map(l => `<div class="${/✖|błąd|error/i.test(l) ? 'err' : /✔|online|zalogowano/i.test(l) ? 'ok' : ''}">${esc(l)}</div>`).join('') || '<div class="dim">Log jest pusty – uruchom bota.</div>'}</div>`;
    const con = $('.console', body); con.scrollTop = con.scrollHeight;
  }

  async function newBot(el) {
    const body = h(`<div><div class="field"><label>Nazwa bota</label><input class="input" data-n value="Mój bot"></div><label class="muted" style="display:block;margin:12px 0 6px">Zacznij od</label>
      <div class="tpl-grid"><label class="tpl"><input type="radio" name="tpl" value="" checked><b>Pusty bot</b><span>Same komendy, które dodasz.</span></label>${Object.entries(TEMPLATES).map(([k, t]) => `<label class="tpl"><input type="radio" name="tpl" value="${k}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></label>`).join('')}</div></div>`);
    modal({ title: 'Nowy bot Discord', wide: true, body, actions: [{ label: 'Anuluj' }, { label: 'Utwórz', primary: true, onClick: async () => {
      const id = await api('bots:create', $('[data-n]', body).value.trim() || 'Mój bot');
      const tpl = TEMPLATES[$('input[name=tpl]:checked', body).value];
      if (tpl) await api('bots:update', id, tpl.make((meta.servers[0] || {}).id || ''));
      curId = id; section = tpl ? 'commands' : 'settings';
      setTimeout(() => render(el.closest('.view') || el), 0);
    } }] });
  }

  window.cm.on('bot:status', d => { const b = bots.find(x => x.id === d.id); if (!b) return; b.status = d.status; if (d.status === 'online') b.error = null; if (App.current() === 'bots') { const v = $('.bots'); if (v) { drawList(v.parentNode); if (d.id === curId && section !== 'commands' && section !== 'events') drawMain(v.parentNode); else { const chip = $('.bot-head .chip', v); if (chip && d.id === curId) { const st = STATUS[d.status] || STATUS.offline; chip.className = 'chip ' + st[0]; chip.textContent = st[1]; } } } } });
  window.cm.on('bot:log', d => { if (App.current() !== 'bots' || d.id !== curId || section !== 'log') return; const con = $('.bot-log'); if (!con) return; con.appendChild(h(`<div class="${/✖|błąd/i.test(d.line) ? 'err' : ''}">${esc(d.line)}</div>`)); con.scrollTop = con.scrollHeight; if (/✖/.test(d.line)) { const b = cur(); if (b) b.error = d.line.replace(/^\[[^\]]+\]\s*✖?\s*/, ''); } });

  const botSt = {};
  const recount = () => { App.state.botsOnline = Object.values(botSt).filter(x => x === 'online').length; if (App.renderRail) App.renderRail(); };
  window.cm.on('bot:status', d => { botSt[d.id] = d.status; recount(); });
  document.addEventListener('DOMContentLoaded', () => setTimeout(async () => { try { for (const b of await window.cm.call('bots:list')) botSt[b.id] = b.status; recount(); } catch { /* */ } }, 5000));
  App.views.bots = { crumb: () => '<b>Boty Discord</b>', render: el => render(el) };
})();
