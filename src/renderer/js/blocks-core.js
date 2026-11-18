// Edytor bloczkowy (jak Blueprint w Unreal Engine / Scratch): biblioteka bloczków, sprawdzanie połączeń
// i konwersja na kod tekstowy (Lua – ogólna, FiveM, Garry's Mod, BeamMP; Python; JavaScript).
// Działa w przeglądarce (window.BlocksCore) i w Node (testy).
'use strict';
(function (root) {
  // ---------- typy pinów ----------
  const TYPES = {
    exec: { name: 'przepływ', color: '#e8e9eb' }, number: { name: 'liczba', color: '#4fc1ff' }, string: { name: 'tekst', color: '#e06c9f' },
    boolean: { name: 'prawda/fałsz', color: '#e5534b' }, any: { name: 'dowolny', color: '#a5a8ad' }, player: { name: 'gracz', color: '#57c785' }, list: { name: 'lista', color: '#d9a23a' },
  };
  function compatible(from, to) {
    if (from === 'exec' || to === 'exec') return from === to;
    if (from === to || to === 'any' || from === 'any') return true;
    if (to === 'string' && (from === 'number' || from === 'boolean')) return 'convert';
    if (from === 'player' && to === 'number') return true; // gracz to identyfikator liczbowy
    return false;
  }

  // ---------- pomocnicze generatora ----------
  const strLit = (s) => JSON.stringify(String(s)).replace(/[\u2028\u2029]/g, ' ');
  const ident = s => String(s || 'x').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'x';
  const ops = { lua: { and: 'and', or: 'or', not: 'not ', neq: '~=', concat: '..', nil: 'nil', true: 'true', false: 'false' }, python: { and: 'and', or: 'or', not: 'not ', neq: '!=', concat: '+', nil: 'None', true: 'True', false: 'False' }, js: { and: '&&', or: '||', not: '!', neq: '!==', concat: '+', nil: 'null', true: 'true', false: 'false' } };
  const toStr = (e, t) => (t === 'lua' ? `tostring(${e})` : t === 'python' ? `str(${e})` : `String(${e})`);

  // ---------- biblioteka bloczków ----------
  // kind: event (start przepływu), action (wejście/wyjście przepływu), pure (tylko dane), flow (rozgałęzienia)
  // gen(ctx): ctx.in(id) – wyrażenie wejścia, ctx.t – język, ctx.p – profil, ctx.body(outId) – kod gałęzi, ctx.out(id) – nazwa zmiennej wyjścia
  const L = [];
  const def = (d) => { L.push({ cat: 'Inne', color: '#5a6170', inputs: [], outputs: [], ...d }); };
  const I = (id, name, type, extra = {}) => ({ id, name, type, ...extra });

  // ===== Zdarzenia =====
  def({ type: 'ev.start', cat: 'Zdarzenia', kind: 'event', title: 'Na starcie', color: '#b33a3a', outputs: [I('then', '', 'exec')], help: 'Uruchamia się raz, gdy skrypt startuje.',
    gen: c => c.t === 'lua' && c.p === 'fivem' ? `CreateThread(function()\n${c.body('then', 1)}\nend)` : c.t === 'lua' && c.p === 'gmod' ? `hook.Add("Initialize", ${strLit(c.uid('init'))}, function()\n${c.body('then', 1)}\nend)` : c.t === 'lua' && c.p === 'beammp' ? `function ${c.fn('onInit')}()\n${c.body('then', 1)}\nend\nMP.RegisterEvent("onInit", "${c.fn('onInit')}")` : c.t === 'js' ? `(async () => {\n${c.body('then', 1)}\n})();` : c.body('then', 0) });
  def({ type: 'ev.interval', cat: 'Zdarzenia', kind: 'event', title: 'Co pewien czas', color: '#b33a3a', inputs: [I('sec', 'co (sekund)', 'number', { value: 60, literalOnly: true })], outputs: [I('then', '', 'exec')], help: 'Powtarza akcje co podaną liczbę sekund.',
    profiles: { lua: ['fivem', 'redm', 'gmod', 'beammp'], python: true, js: true },
    gen: c => {
      const s = +c.lit('sec') || 60;
      if (c.t === 'lua' && (c.p === 'fivem' || c.p === 'redm')) return `CreateThread(function()\n  while true do\n    Wait(${Math.round(s * 1000)})\n${c.body('then', 2)}\n  end\nend)`;
      if (c.t === 'lua' && c.p === 'gmod') return `timer.Create(${strLit(c.uid('timer'))}, ${s}, 0, function()\n${c.body('then', 1)}\nend)`;
      if (c.t === 'lua' && c.p === 'beammp') return `function ${c.fn('onTimer')}()\n${c.body('then', 1)}\nend\nMP.RegisterEvent("${c.fn('timerEvent')}", "${c.fn('onTimer')}")\nMP.CreateEventTimer("${c.fn('timerEvent')}", ${Math.round(s * 1000)})`;
      if (c.t === 'python') { c.need('import threading'); return `def ${c.fn('co_czas')}():\n${c.body('then', 1)}\n    threading.Timer(${s}, ${c.fn('co_czas')}).start()\n\n${c.fn('co_czas')}()`; }
      return `setInterval(async () => {\n${c.body('then', 1)}\n}, ${Math.round(s * 1000)});`;
    } });
  // FiveM / RedM
  def({ type: 'fivem.command', cat: 'FiveM', kind: 'event', title: 'Komenda czatu', color: '#f40552', inputs: [I('name', 'nazwa', 'string', { value: 'hello', literalOnly: true })], outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player'), I('args', 'argumenty', 'list')], profiles: { lua: ['fivem', 'redm'] }, help: 'RegisterCommand – gracz wpisuje /nazwa.',
    gen: c => `RegisterCommand(${strLit(c.lit('name'))}, function(source, args, raw)\n  local ${c.out('player')} = source\n  local ${c.out('args')} = args\n${c.body('then', 1)}\nend, false)` });
  def({ type: 'fivem.join', cat: 'FiveM', kind: 'event', title: 'Gracz dołączył', color: '#f40552', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player')], profiles: { lua: ['fivem', 'redm'] }, realm: 'server',
    gen: c => `AddEventHandler("playerJoining", function()\n  local ${c.out('player')} = source\n${c.body('then', 1)}\nend)` });
  def({ type: 'fivem.drop', cat: 'FiveM', kind: 'event', title: 'Gracz wyszedł', color: '#f40552', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player'), I('reason', 'powód', 'string')], profiles: { lua: ['fivem', 'redm'] }, realm: 'server',
    gen: c => `AddEventHandler("playerDropped", function(reason)\n  local ${c.out('player')} = source\n  local ${c.out('reason')} = reason\n${c.body('then', 1)}\nend)` });
  def({ type: 'fivem.netevent', cat: 'FiveM', kind: 'event', title: 'Zdarzenie sieciowe', color: '#f40552', inputs: [I('name', 'nazwa', 'string', { value: 'mojzasob:zdarzenie', literalOnly: true })], outputs: [I('then', '', 'exec'), I('player', 'nadawca', 'player'), I('data', 'dane', 'any')], profiles: { lua: ['fivem', 'redm'] },
    gen: c => `RegisterNetEvent(${strLit(c.lit('name'))}, function(data)\n  local ${c.out('player')} = source\n  local ${c.out('data')} = data\n${c.body('then', 1)}\nend)` });
  def({ type: 'fivem.chat', cat: 'FiveM', kind: 'action', title: 'Wiadomość na czacie', color: '#f40552', inputs: [I('player', 'do gracza (-1 = wszyscy)', 'player', { value: -1 }), I('author', 'autor', 'string', { value: 'Serwer' }), I('text', 'tekst', 'string', { value: 'Witaj!' })], profiles: { lua: ['fivem', 'redm'] }, realm: 'server',
    gen: c => `TriggerClientEvent("chat:addMessage", ${c.in('player')}, { args = { ${c.in('author')}, ${c.in('text')} } })` });
  def({ type: 'fivem.name', cat: 'FiveM', kind: 'pure', title: 'Nazwa gracza', color: '#f40552', inputs: [I('player', 'gracz', 'player')], outputs: [I('name', 'nazwa', 'string')], profiles: { lua: ['fivem', 'redm'] }, gen: c => `GetPlayerName(${c.in('player')})` });
  def({ type: 'fivem.count', cat: 'FiveM', kind: 'pure', title: 'Liczba graczy', color: '#f40552', outputs: [I('n', 'liczba', 'number')], profiles: { lua: ['fivem', 'redm'] }, realm: 'server', gen: () => '#GetPlayers()' });
  def({ type: 'fivem.kick', cat: 'FiveM', kind: 'action', title: 'Wyrzuć gracza', color: '#f40552', inputs: [I('player', 'gracz', 'player'), I('reason', 'powód', 'string', { value: 'Wyrzucony' })], profiles: { lua: ['fivem', 'redm'] }, realm: 'server', gen: c => `DropPlayer(${c.in('player')}, ${c.in('reason')})` });
  def({ type: 'fivem.trigger', cat: 'FiveM', kind: 'action', title: 'Wyślij zdarzenie do gracza', color: '#f40552', inputs: [I('name', 'zdarzenie', 'string', { value: 'mojzasob:zdarzenie' }), I('player', 'gracz (-1 = wszyscy)', 'player', { value: -1 }), I('data', 'dane', 'any', { optional: true })], profiles: { lua: ['fivem', 'redm'] }, realm: 'server', gen: c => `TriggerClientEvent(${c.in('name')}, ${c.in('player')}${c.has('data') ? ', ' + c.in('data') : ''})` });
  def({ type: 'fivem.notify', cat: 'FiveM', kind: 'action', title: 'Powiadomienie na ekranie', color: '#f40552', inputs: [I('text', 'tekst', 'string', { value: 'Cześć!' })], profiles: { lua: ['fivem'] }, realm: 'client',
    gen: c => `BeginTextCommandThefeedPost("STRING")\nAddTextComponentSubstringPlayerName(${c.in('text')})\nEndTextCommandThefeedPostTicker(false, false)` });
  // Garry's Mod
  def({ type: 'gmod.spawn', cat: "Garry's Mod", kind: 'event', title: 'Gracz się odrodził', color: '#1e90ff', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player')], profiles: { lua: ['gmod'] },
    gen: c => `hook.Add("PlayerSpawn", ${strLit(c.uid('spawn'))}, function(ply)\n  local ${c.out('player')} = ply\n${c.body('then', 1)}\nend)` });
  def({ type: 'gmod.join', cat: "Garry's Mod", kind: 'event', title: 'Gracz wszedł pierwszy raz', color: '#1e90ff', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player')], profiles: { lua: ['gmod'] },
    gen: c => `hook.Add("PlayerInitialSpawn", ${strLit(c.uid('join'))}, function(ply)\n  local ${c.out('player')} = ply\n${c.body('then', 1)}\nend)` });
  def({ type: 'gmod.say', cat: "Garry's Mod", kind: 'event', title: 'Komenda na czacie (!nazwa)', color: '#1e90ff', inputs: [I('name', 'komenda', 'string', { value: '!hello', literalOnly: true })], outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player'), I('text', 'cała wiadomość', 'string')], profiles: { lua: ['gmod'] },
    gen: c => `hook.Add("PlayerSay", ${strLit(c.uid('say'))}, function(ply, text)\n  if string.lower(string.Split(text, " ")[1] or "") ~= ${strLit(String(c.lit('name')).toLowerCase())} then return end\n  local ${c.out('player')} = ply\n  local ${c.out('text')} = text\n${c.body('then', 1)}\n  return ""\nend)` });
  def({ type: 'gmod.print', cat: "Garry's Mod", kind: 'action', title: 'Wiadomość dla wszystkich', color: '#1e90ff', inputs: [I('text', 'tekst', 'string', { value: 'Witaj!' })], profiles: { lua: ['gmod'] }, gen: c => `PrintMessage(HUD_PRINTTALK, ${c.in('text')})` });
  def({ type: 'gmod.chatprint', cat: "Garry's Mod", kind: 'action', title: 'Wiadomość do gracza', color: '#1e90ff', inputs: [I('player', 'gracz', 'player'), I('text', 'tekst', 'string', { value: 'Cześć!' })], profiles: { lua: ['gmod'] }, gen: c => `${c.in('player')}:ChatPrint(${c.in('text')})` });
  def({ type: 'gmod.nick', cat: "Garry's Mod", kind: 'pure', title: 'Nick gracza', color: '#1e90ff', inputs: [I('player', 'gracz', 'player')], outputs: [I('name', 'nick', 'string')], profiles: { lua: ['gmod'] }, gen: c => `${c.in('player')}:Nick()` });
  def({ type: 'gmod.health', cat: "Garry's Mod", kind: 'action', title: 'Ustaw zdrowie', color: '#1e90ff', inputs: [I('player', 'gracz', 'player'), I('hp', 'zdrowie', 'number', { value: 100 })], profiles: { lua: ['gmod'] }, gen: c => `${c.in('player')}:SetHealth(${c.in('hp')})` });
  def({ type: 'gmod.give', cat: "Garry's Mod", kind: 'action', title: 'Daj broń', color: '#1e90ff', inputs: [I('player', 'gracz', 'player'), I('weapon', 'klasa broni', 'string', { value: 'weapon_crowbar' })], profiles: { lua: ['gmod'] }, gen: c => `${c.in('player')}:Give(${c.in('weapon')})` });
  def({ type: 'gmod.count', cat: "Garry's Mod", kind: 'pure', title: 'Liczba graczy', color: '#1e90ff', outputs: [I('n', 'liczba', 'number')], profiles: { lua: ['gmod'] }, gen: () => 'player.GetCount()' });
  // BeamMP
  def({ type: 'beammp.join', cat: 'BeamMP', kind: 'event', title: 'Gracz dołączył', color: '#f7931e', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player')], profiles: { lua: ['beammp'] },
    gen: c => `function ${c.fn('onPlayerJoin')}(player_id)\n  local ${c.out('player')} = player_id\n${c.body('then', 1)}\nend\nMP.RegisterEvent("onPlayerJoin", "${c.fn('onPlayerJoin')}")` });
  def({ type: 'beammp.chat', cat: 'BeamMP', kind: 'event', title: 'Wiadomość na czacie', color: '#f7931e', outputs: [I('then', '', 'exec'), I('player', 'gracz', 'player'), I('text', 'wiadomość', 'string')], profiles: { lua: ['beammp'] },
    gen: c => `function ${c.fn('onChatMessage')}(player_id, player_name, message)\n  local ${c.out('player')} = player_id\n  local ${c.out('text')} = message\n${c.body('then', 1)}\nend\nMP.RegisterEvent("onChatMessage", "${c.fn('onChatMessage')}")` });
  def({ type: 'beammp.send', cat: 'BeamMP', kind: 'action', title: 'Wiadomość na czacie', color: '#f7931e', inputs: [I('player', 'do gracza (-1 = wszyscy)', 'player', { value: -1 }), I('text', 'tekst', 'string', { value: 'Witaj!' })], profiles: { lua: ['beammp'] }, gen: c => `MP.SendChatMessage(${c.in('player')}, ${c.in('text')})` });
  def({ type: 'beammp.name', cat: 'BeamMP', kind: 'pure', title: 'Nazwa gracza', color: '#f7931e', inputs: [I('player', 'gracz', 'player')], outputs: [I('name', 'nazwa', 'string')], profiles: { lua: ['beammp'] }, gen: c => `MP.GetPlayerName(${c.in('player')})` });
  def({ type: 'beammp.count', cat: 'BeamMP', kind: 'pure', title: 'Liczba graczy', color: '#f7931e', outputs: [I('n', 'liczba', 'number')], profiles: { lua: ['beammp'] }, gen: () => 'MP.GetPlayerCount()' });
  def({ type: 'beammp.kick', cat: 'BeamMP', kind: 'action', title: 'Wyrzuć gracza', color: '#f7931e', inputs: [I('player', 'gracz', 'player'), I('reason', 'powód', 'string', { value: 'Wyrzucony' })], profiles: { lua: ['beammp'] }, gen: c => `MP.DropPlayer(${c.in('player')}, ${c.in('reason')})` });

  // ===== Przepływ =====
  def({ type: 'flow.if', cat: 'Przepływ', kind: 'flow', title: 'Jeżeli', color: '#5a6170', inputs: [I('exec', '', 'exec'), I('cond', 'warunek', 'boolean')], outputs: [I('then', 'tak', 'exec'), I('else', 'nie', 'exec')],
    gen: c => { const T = c.body('then', 1), E = c.body('else', 1); if (c.t === 'lua') return `if ${c.in('cond')} then\n${T}${E.trim() ? `\nelse\n${E}` : ''}\nend`; if (c.t === 'python') return `if ${c.in('cond')}:\n${T || c.pad(1) + 'pass'}${E.trim() ? `\nelse:\n${E}` : ''}`; return `if (${c.in('cond')}) {\n${T}\n}${E.trim() ? ` else {\n${E}\n}` : ''}`; },
    after: 'none' });
  def({ type: 'flow.for', cat: 'Przepływ', kind: 'flow', title: 'Powtórz (od – do)', color: '#5a6170', inputs: [I('exec', '', 'exec'), I('from', 'od', 'number', { value: 1 }), I('to', 'do', 'number', { value: 10 })], outputs: [I('loop', 'dla każdego', 'exec'), I('i', 'numer', 'number'), I('done', 'potem', 'exec')],
    gen: c => { const v = c.out('i'); const B = c.body('loop', 1); if (c.t === 'lua') return `for ${v} = ${c.in('from')}, ${c.in('to')} do\n${B}\nend\n${c.body('done', 0)}`; if (c.t === 'python') return `for ${v} in range(${c.in('from')}, ${c.in('to')} + 1):\n${B || c.pad(1) + 'pass'}\n${c.body('done', 0)}`; return `for (let ${v} = ${c.in('from')}; ${v} <= ${c.in('to')}; ${v}++) {\n${B}\n}\n${c.body('done', 0)}`; },
    after: 'none' });
  def({ type: 'flow.foreach', cat: 'Przepływ', kind: 'flow', title: 'Dla każdego elementu listy', color: '#5a6170', inputs: [I('exec', '', 'exec'), I('list', 'lista', 'list')], outputs: [I('loop', 'dla każdego', 'exec'), I('item', 'element', 'any'), I('done', 'potem', 'exec')],
    gen: c => { const v = c.out('item'); const B = c.body('loop', 1); if (c.t === 'lua') return `for _, ${v} in ipairs(${c.in('list')}) do\n${B}\nend\n${c.body('done', 0)}`; if (c.t === 'python') return `for ${v} in ${c.in('list')}:\n${B || c.pad(1) + 'pass'}\n${c.body('done', 0)}`; return `for (const ${v} of ${c.in('list')}) {\n${B}\n}\n${c.body('done', 0)}`; },
    after: 'none' });
  def({ type: 'flow.while', cat: 'Przepływ', kind: 'flow', title: 'Dopóki', color: '#5a6170', inputs: [I('exec', '', 'exec'), I('cond', 'warunek', 'boolean')], outputs: [I('loop', 'powtarzaj', 'exec'), I('done', 'potem', 'exec')],
    gen: c => { const B = c.body('loop', 1); if (c.t === 'lua') return `while ${c.in('cond')} do\n${B}\nend\n${c.body('done', 0)}`; if (c.t === 'python') return `while ${c.in('cond')}:\n${B || c.pad(1) + 'pass'}\n${c.body('done', 0)}`; return `while (${c.in('cond')}) {\n${B}\n}\n${c.body('done', 0)}`; },
    after: 'none' });
  def({ type: 'flow.seq', cat: 'Przepływ', kind: 'flow', title: 'Po kolei', color: '#5a6170', inputs: [I('exec', '', 'exec')], outputs: [I('a', '1.', 'exec'), I('b', '2.', 'exec'), I('c', '3.', 'exec')], gen: c => [c.body('a', 0), c.body('b', 0), c.body('c', 0)].filter(s => s.trim()).join('\n'), after: 'none' });
  def({ type: 'flow.wait', cat: 'Przepływ', kind: 'action', title: 'Czekaj', color: '#5a6170', inputs: [I('exec', '', 'exec'), I('sec', 'sekund', 'number', { value: 1 })], outputs: [I('then', '', 'exec')],
    profiles: { lua: ['fivem', 'redm', 'gmod'], python: true, js: true },
    gen: c => {
      if (c.t === 'lua' && c.p === 'gmod') return `timer.Simple(${c.in('sec')}, function()\n${c.body('then', 1)}\nend)`;
      if (c.t === 'lua') return `Wait(math.floor(${c.in('sec')} * 1000))\n${c.body('then', 0)}`;
      if (c.t === 'python') { c.need('import time'); return `time.sleep(${c.in('sec')})\n${c.body('then', 0)}`; }
      return `await new Promise(r => setTimeout(r, ${c.in('sec')} * 1000));\n${c.body('then', 0)}`;
    }, after: 'none' });

  // ===== Akcje ogólne =====
  def({ type: 'act.print', cat: 'Akcje', kind: 'action', title: 'Wypisz', color: '#3d7a5c', inputs: [I('exec', '', 'exec'), I('value', 'wartość', 'any', { value: 'Witaj, świecie!' })], outputs: [I('then', '', 'exec')], gen: c => (c.t === 'js' ? `console.log(${c.in('value')});` : `print(${c.in('value')})`) });
  def({ type: 'act.input', cat: 'Akcje', kind: 'action', title: 'Zapytaj użytkownika', color: '#3d7a5c', inputs: [I('exec', '', 'exec'), I('prompt', 'pytanie', 'string', { value: 'Jak masz na imię? ' })], outputs: [I('then', '', 'exec'), I('answer', 'odpowiedź', 'string')], profiles: { lua: ['lua'], python: true, js: true },
    gen: c => { const v = c.out('answer'); if (c.t === 'python') return `${v} = input(${c.in('prompt')})`; if (c.t === 'lua') return `io.write(${c.in('prompt')})\nlocal ${v} = io.read()`; c.need("const readline = require('readline/promises');"); return `const ${v} = await (async () => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(${c.in('prompt')}); rl.close(); return a; })();`; } });
  def({ type: 'var.set', cat: 'Zmienne', kind: 'action', title: 'Ustaw zmienną', color: '#8a5cb8', inputs: [I('exec', '', 'exec'), I('name', 'zmienna', 'string', { value: 'licznik', literalOnly: true, varName: true }), I('value', 'wartość', 'any', { value: 0 })], outputs: [I('then', '', 'exec')],
    gen: c => { const n = c.var(c.lit('name')); return c.t === 'js' ? `${n} = ${c.in('value')};` : `${n} = ${c.in('value')}`; } });
  def({ type: 'var.add', cat: 'Zmienne', kind: 'action', title: 'Zwiększ zmienną', color: '#8a5cb8', inputs: [I('exec', '', 'exec'), I('name', 'zmienna', 'string', { value: 'licznik', literalOnly: true, varName: true }), I('by', 'o', 'number', { value: 1 })], outputs: [I('then', '', 'exec')],
    gen: c => { const n = c.var(c.lit('name')); return c.t === 'lua' ? `${n} = ${n} + ${c.in('by')}` : c.t === 'python' ? `${n} += ${c.in('by')}` : `${n} += ${c.in('by')};`; } });
  def({ type: 'var.get', cat: 'Zmienne', kind: 'pure', title: 'Wartość zmiennej', color: '#8a5cb8', inputs: [I('name', 'zmienna', 'string', { value: 'licznik', literalOnly: true, varName: true })], outputs: [I('value', 'wartość', 'any')], gen: c => c.var(c.lit('name')) });

  // ===== Wartości =====
  def({ type: 'lit.number', cat: 'Wartości', kind: 'pure', title: 'Liczba', color: '#2c6e8f', inputs: [I('v', '', 'number', { value: 0, literalOnly: true })], outputs: [I('out', '', 'number')], gen: c => String(+c.lit('v') || 0) });
  def({ type: 'lit.text', cat: 'Wartości', kind: 'pure', title: 'Tekst', color: '#8f2c5c', inputs: [I('v', '', 'string', { value: 'tekst', literalOnly: true })], outputs: [I('out', '', 'string')], gen: c => strLit(c.lit('v'), c.t) });
  def({ type: 'lit.bool', cat: 'Wartości', kind: 'pure', title: 'Prawda / fałsz', color: '#8f2c2c', inputs: [I('v', '', 'boolean', { value: true, literalOnly: true })], outputs: [I('out', '', 'boolean')], gen: c => (c.lit('v') ? ops[c.t].true : ops[c.t].false) });
  def({ type: 'math.random', cat: 'Matematyka', kind: 'pure', title: 'Losowa liczba', color: '#2c6e8f', inputs: [I('min', 'od', 'number', { value: 1 }), I('max', 'do', 'number', { value: 6 })], outputs: [I('out', '', 'number')],
    gen: c => { if (c.t === 'lua') return `math.random(${c.in('min')}, ${c.in('max')})`; if (c.t === 'python') { c.need('import random'); return `random.randint(${c.in('min')}, ${c.in('max')})`; } return `(Math.floor(Math.random() * ((${c.in('max')}) - (${c.in('min')}) + 1)) + (${c.in('min')}))`; } });
  const bin = (type, title, sym, outT = 'number', inT = 'number') => def({ type, cat: outT === 'boolean' && inT !== 'boolean' ? 'Porównania' : inT === 'boolean' ? 'Logika' : 'Matematyka', kind: 'pure', title, color: outT === 'boolean' ? '#8f2c2c' : '#2c6e8f', inputs: [I('a', 'A', inT, { value: inT === 'boolean' ? true : 0 }), I('b', 'B', inT, { value: inT === 'boolean' ? false : 0 })], outputs: [I('out', '', outT)], gen: c => `(${c.in('a')} ${typeof sym === 'function' ? sym(c.t) : sym} ${c.in('b')})` });
  bin('math.add', 'Dodaj (A + B)', '+'); bin('math.sub', 'Odejmij (A − B)', '-'); bin('math.mul', 'Pomnóż (A × B)', '*'); bin('math.div', 'Podziel (A ÷ B)', '/');
  bin('math.mod', 'Reszta z dzielenia', t => (t === 'lua' ? '%' : '%'));
  bin('cmp.eq', 'Równe (A = B)', t => (t === 'js' ? '===' : '=='), 'boolean', 'any'); bin('cmp.neq', 'Różne (A ≠ B)', t => ops[t].neq, 'boolean', 'any');
  bin('cmp.gt', 'Większe (A > B)', '>', 'boolean'); bin('cmp.lt', 'Mniejsze (A < B)', '<', 'boolean'); bin('cmp.gte', 'Większe lub równe', '>=', 'boolean'); bin('cmp.lte', 'Mniejsze lub równe', '<=', 'boolean');
  bin('logic.and', 'I (oba prawdziwe)', t => ops[t].and, 'boolean', 'boolean'); bin('logic.or', 'LUB (jeden prawdziwy)', t => ops[t].or, 'boolean', 'boolean');
  def({ type: 'logic.not', cat: 'Logika', kind: 'pure', title: 'NIE (zaprzeczenie)', color: '#8f2c2c', inputs: [I('a', '', 'boolean', { value: true })], outputs: [I('out', '', 'boolean')], gen: c => `(${ops[c.t].not}${c.in('a')})` });
  def({ type: 'math.round', cat: 'Matematyka', kind: 'pure', title: 'Zaokrąglij', color: '#2c6e8f', inputs: [I('a', '', 'number', { value: 0 })], outputs: [I('out', '', 'number')], gen: c => (c.t === 'lua' ? `math.floor(${c.in('a')} + 0.5)` : c.t === 'python' ? `round(${c.in('a')})` : `Math.round(${c.in('a')})`) });

  // ===== Tekst =====
  def({ type: 'text.join', cat: 'Tekst', kind: 'pure', title: 'Połącz teksty', color: '#8f2c5c', inputs: [I('a', 'A', 'string', { value: 'Witaj, ' }), I('b', 'B', 'string', { value: 'świecie' })], outputs: [I('out', '', 'string')], gen: c => `(${c.in('a')} ${ops[c.t].concat} ${c.in('b')})` });
  def({ type: 'text.len', cat: 'Tekst', kind: 'pure', title: 'Długość tekstu', color: '#8f2c5c', inputs: [I('a', '', 'string', { value: '' })], outputs: [I('out', '', 'number')], gen: c => (c.t === 'lua' ? `#${c.in('a')}` : c.t === 'python' ? `len(${c.in('a')})` : `${c.in('a')}.length`) });
  def({ type: 'text.upper', cat: 'Tekst', kind: 'pure', title: 'Wielkie litery', color: '#8f2c5c', inputs: [I('a', '', 'string', { value: '' })], outputs: [I('out', '', 'string')], gen: c => (c.t === 'lua' ? `string.upper(${c.in('a')})` : c.t === 'python' ? `${c.in('a')}.upper()` : `${c.in('a')}.toUpperCase()`) });
  def({ type: 'text.contains', cat: 'Tekst', kind: 'pure', title: 'Zawiera tekst', color: '#8f2c2c', inputs: [I('a', 'tekst', 'string', { value: '' }), I('b', 'szukany', 'string', { value: '' })], outputs: [I('out', '', 'boolean')], gen: c => (c.t === 'lua' ? `(string.find(${c.in('a')}, ${c.in('b')}, 1, true) ~= nil)` : c.t === 'python' ? `(${c.in('b')} in ${c.in('a')})` : `${c.in('a')}.includes(${c.in('b')})`) });
  def({ type: 'text.tostring', cat: 'Tekst', kind: 'pure', title: 'Zamień na tekst', color: '#8f2c5c', inputs: [I('a', '', 'any', { value: 0 })], outputs: [I('out', '', 'string')], gen: c => toStr(c.in('a'), c.t) });
  def({ type: 'list.get', cat: 'Listy', kind: 'pure', title: 'Element listy', color: '#a87b1f', inputs: [I('list', 'lista', 'list'), I('i', 'numer (od 1)', 'number', { value: 1 })], outputs: [I('out', '', 'any')], gen: c => (c.t === 'lua' ? `${c.in('list')}[${c.in('i')}]` : `${c.in('list')}[(${c.in('i')}) - 1]`) });
  def({ type: 'list.len', cat: 'Listy', kind: 'pure', title: 'Długość listy', color: '#a87b1f', inputs: [I('list', 'lista', 'list')], outputs: [I('out', '', 'number')], gen: c => (c.t === 'lua' ? `#${c.in('list')}` : c.t === 'python' ? `len(${c.in('list')})` : `${c.in('list')}.length`) });
  def({ type: 'comment', cat: 'Inne', kind: 'note', title: 'Komentarz', color: '#45484f', inputs: [I('text', '', 'string', { value: 'Opis…', literalOnly: true, multiline: true })] });

  const BY = Object.fromEntries(L.map(n => [n.type, n]));
  const isExecIn = n => n.kind === 'action' || n.kind === 'flow';
  // automatyczne piny przepływu dla akcji
  for (const n of L) {
    if (n.kind === 'action' && !n.inputs.some(i => i.type === 'exec')) n.inputs.unshift(I('exec', '', 'exec'));
    if (n.kind === 'action' && !n.outputs.some(o => o.type === 'exec')) n.outputs.unshift(I('then', '', 'exec'));
  }
  function available(nodeDef, target, profile) {
    if (!nodeDef.profiles) return true;
    const p = nodeDef.profiles[target];
    if (p === true) return true;
    if (!p) return false;
    return p.includes(target === 'lua' ? (profile || 'lua') : profile);
  }
  function library(target, profile) { return L.filter(n => available(n, target, profile)); }

  // ---------- graf: pomocnicze ----------
  const pinOf = (g, ref, dir) => { const n = g.nodes.find(x => x.id === ref.node); if (!n) return null; const d = BY[n.type]; if (!d) return null; return (dir === 'out' ? d.outputs : d.inputs).find(p => p.id === ref.pin) || null; };
  function canConnect(g, from, to) {
    if (from.node === to.node) return { ok: false, reason: 'Nie można połączyć bloczka z samym sobą.' };
    const a = pinOf(g, from, 'out'); const b = pinOf(g, to, 'in');
    if (!a || !b) return { ok: false, reason: 'Połącz wyjście (prawa strona) z wejściem (lewa strona).' };
    const c = compatible(a.type, b.type);
    if (!c) return { ok: false, reason: a.type === 'exec' || b.type === 'exec' ? 'Biała strzałka (przepływ) łączy się tylko z białą strzałką.' : `Typy się nie zgadzają: ${TYPES[a.type].name} → ${TYPES[b.type].name}.` };
    if (b.literalOnly) return { ok: false, reason: 'To pole przyjmuje tylko wpisaną wartość.' };
    // cykl danych
    if (a.type !== 'exec' && reaches(g, to.node, from.node)) return { ok: false, reason: 'To połączenie utworzy pętlę (bloczek zależałby od samego siebie).' };
    return { ok: true, convert: c === 'convert' };
  }
  // czy z węzła start (przez wyjścia danych) da się dojść do target
  function reaches(g, start, target, seen = new Set()) {
    if (start === target) return true; if (seen.has(start)) return false; seen.add(start);
    for (const l of g.links) if (l.from.node === start) { const p = pinOf(g, l.from, 'out'); if (p && p.type !== 'exec' && reaches(g, l.to.node, target, seen)) return true; }
    return false;
  }
  // dodaje połączenie, zastępując poprzednie tam, gdzie dozwolone jest tylko jedno
  function connect(g, from, to) {
    const r = canConnect(g, from, to); if (!r.ok) return r;
    const a = pinOf(g, from, 'out');
    g.links = g.links.filter(l => !(l.to.node === to.node && l.to.pin === to.pin) && !(a.type === 'exec' && l.from.node === from.node && l.from.pin === from.pin));
    g.links.push({ from: { ...from }, to: { ...to } });
    return r;
  }

  // ---------- sprawdzanie grafu ----------
  function validate(g) {
    const out = []; const add = (level, node, msg, pin) => out.push({ level, node, pin: pin || null, msg });
    const target = g.target || 'lua'; const profile = g.profile || 'lua';
    for (const n of g.nodes) {
      const d = BY[n.type]; if (!d) { add('error', n.id, `Nieznany bloczek „${n.type}”.`); continue; }
      if (d.kind === 'note') continue;
      if (!available(d, target, profile)) add('error', n.id, `„${d.title}” nie działa w wybranym języku/grze (${target}${target === 'lua' ? ' / ' + profile : ''}).`);
      if (d.realm && g.realm && d.realm !== g.realm && (profile === 'fivem' || profile === 'redm')) add('error', n.id, `„${d.title}” działa tylko po stronie ${d.realm === 'server' ? 'serwera' : 'klienta'} – zmień stronę skryptu albo usuń bloczek.`);
      for (const p of d.inputs) {
        const links = g.links.filter(l => l.to.node === n.id && l.to.pin === p.id);
        if (p.type === 'exec') continue;
        if (links.length > 1) add('error', n.id, `Wejście „${p.name || p.id}” ma kilka połączeń – zostaw jedno.`, p.id);
        const lit = n.values && n.values[p.id] !== undefined ? n.values[p.id] : p.value;
        if (!links.length && !p.optional && (lit === undefined || lit === null || (lit === '' && p.type !== 'string'))) add('error', n.id, `Wejście „${p.name || p.id}” jest puste – podłącz wartość albo ją wpisz.`, p.id);
        if (!links.length && p.type === 'player' && (lit === undefined || lit === '')) add('error', n.id, `Podłącz gracza do „${p.name}”.`, p.id);
        if (!links.length && (p.type === 'list') && !p.optional) add('error', n.id, `Podłącz listę do „${p.name}”.`, p.id);
        if (!links.length && p.type === 'number' && lit !== undefined && lit !== '' && isNaN(+lit)) add('error', n.id, `„${p.name || p.id}” musi być liczbą.`, p.id);
        if (p.varName && !/^[A-Za-z_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*$/.test(String(lit || ''))) add('error', n.id, 'Nazwa zmiennej może zawierać tylko litery, cyfry i _ (nie zaczynaj od cyfry).', p.id);
        for (const l of links) { const a = pinOf(g, l.from, 'out'); if (!a) { add('error', n.id, 'Połączenie z nieistniejącym bloczkiem.', p.id); continue; } if (!compatible(a.type, p.type)) add('error', n.id, `Złe połączenie: ${TYPES[a.type].name} → ${TYPES[p.type].name} („${p.name || p.id}”).`, p.id); }
      }
      for (const p of d.outputs) if (p.type === 'exec' && g.links.filter(l => l.from.node === n.id && l.from.pin === p.id).length > 1) add('error', n.id, `Wyjście przepływu „${p.name || p.id}” może prowadzić tylko do jednego bloczka – użyj „Po kolei”.`, p.id);
      if (d.kind === 'event' && !g.links.some(l => l.from.node === n.id && pinOf(g, l.from, 'out') && pinOf(g, l.from, 'out').type === 'exec')) add('warn', n.id, `Zdarzenie „${d.title}” nie uruchamia żadnej akcji.`);
      if (d.kind === 'pure' && !g.links.some(l => l.from.node === n.id)) add('warn', n.id, `Wynik bloczka „${d.title}” nie jest nigdzie użyty.`);
      // dane z gałęzi, która nie wykonała się wcześniej
      for (const l of g.links.filter(x => x.to.node === n.id)) {
        const src = g.nodes.find(x => x.id === l.from.node); const sd = src && BY[src.type];
        if (sd && sd.kind !== 'pure' && pinOf(g, l.from, 'out') && pinOf(g, l.from, 'out').type !== 'exec' && isExecIn(d) && !execBefore(g, src.id, n.id)) add('error', n.id, `„${d.title}” używa wyniku „${sd.title}”, który nie wykona się wcześniej w tym samym przepływie.`);
      }
    }
    // osiągalność akcji ze zdarzeń
    const reached = new Set();
    const walk = id => { if (reached.has(id)) return; reached.add(id); for (const l of g.links) if (l.from.node === id && pinOf(g, l.from, 'out') && pinOf(g, l.from, 'out').type === 'exec') walk(l.to.node); };
    for (const n of g.nodes) if (BY[n.type] && BY[n.type].kind === 'event') walk(n.id);
    for (const n of g.nodes) { const d = BY[n.type]; if (d && isExecIn(d) && !reached.has(n.id)) add('warn', n.id, `„${d.title}” nigdy się nie wykona – połącz jego białe wejście ze zdarzeniem lub inną akcją.`); }
    // pętle przepływu
    for (const n of g.nodes) if (BY[n.type] && isExecIn(BY[n.type]) && execBefore(g, n.id, n.id, true)) add('error', n.id, 'Przepływ wraca do tego samego bloczka – do powtarzania użyj bloczków „Powtórz” lub „Dopóki”.');
    if (!g.nodes.some(n => BY[n.type] && BY[n.type].kind === 'event')) add('warn', null, 'Dodaj zdarzenie (np. „Na starcie”) – od niego zaczyna się wykonywanie.');
    return out;
  }
  // czy węzeł a wykonuje się przed b w łańcuchu przepływu (b osiągalny z a przez strzałki)
  function execBefore(g, a, b, strict) {
    const seen = new Set(); const stack = [a];
    while (stack.length) { const id = stack.pop(); for (const l of g.links) if (l.from.node === id) { const p = pinOf(g, l.from, 'out'); if (!p || p.type !== 'exec') continue; if (l.to.node === b) return true; if (!seen.has(l.to.node)) { seen.add(l.to.node); stack.push(l.to.node); } } }
    if (strict) return false;
    // zdarzenie z wyjściami danych (np. gracz) jest „przed” całym swoim łańcuchem; to samo pętla dla swojego ciała
    return false;
  }

  // ---------- generator kodu ----------
  function generate(g) {
    const t = g.target || 'lua'; const p = t === 'lua' ? (g.profile || 'lua') : t;
    const issues = validate(g).filter(i => i.level === 'error');
    const needs = new Set(); const vars = new Set(); const fnNames = new Map(); let uidN = 0;
    const shortId = new Map(g.nodes.map((n, i) => [n.id, i + 1]));
    const outName = (n, pinId) => ident(`${pinId}${shortId.get(n.id) || ''}`);
    const pad = k => '  '.repeat(k).replace(/  /g, t === 'python' ? '    ' : '  ');
    const indent = (code, k) => (code ? code.split('\n').map(l => (l ? pad(k) + l : l)).join('\n') : '');
    const nodeById = id => g.nodes.find(x => x.id === id);
    const genNode = (n, visiting = new Set()) => {
      const d = BY[n.type];
      if (visiting.has(n.id)) return ops[t].nil;
      const ctx = {
        t, p, pad,
        need: s => needs.add(s),
        lit: id => { const v = n.values && n.values[id] !== undefined ? n.values[id] : (d.inputs.find(x => x.id === id) || {}).value; return v; },
        has: id => g.links.some(l => l.to.node === n.id && l.to.pin === id) || (n.values && n.values[id] !== undefined && n.values[id] !== ''),
        in: id => {
          const l = g.links.find(x => x.to.node === n.id && x.to.pin === id);
          const pin = d.inputs.find(x => x.id === id) || { type: 'any' };
          if (l) {
            const src = nodeById(l.from.node); const sd = src && BY[src.type]; if (!sd) return ops[t].nil;
            const sp = sd.outputs.find(o => o.id === l.from.pin) || { type: 'any' };
            let expr = sd.kind === 'pure' ? genNode(src, new Set([...visiting, n.id])) : outName(src, l.from.pin);
            if (compatible(sp.type, pin.type) === 'convert') expr = toStr(expr, t);
            return expr;
          }
          const v = n.values && n.values[id] !== undefined ? n.values[id] : pin.value;
          if (pin.type === 'number' || pin.type === 'player') return String(v === '' || v == null ? 0 : +v);
          if (pin.type === 'boolean') return v ? ops[t].true : ops[t].false;
          if (pin.type === 'string') return strLit(v == null ? '' : v, t);
          if (pin.type === 'any') return typeof v === 'number' || (v !== '' && v != null && !isNaN(+v) && /^-?\d+(\.\d+)?$/.test(String(v))) ? String(+v) : typeof v === 'boolean' ? (v ? ops[t].true : ops[t].false) : strLit(v == null ? '' : v, t);
          return ops[t].nil;
        },
        out: pinId => outName(n, pinId),
        var: name => { const v = ident(name); vars.add(v); return t === 'lua' && p !== 'lua' ? v : v; },
        uid: base => `cm_${base}_${n.id}`.replace(/[^A-Za-z0-9_]/g, '_'),
        fn: base => { const k = base + '|' + n.id; if (!fnNames.has(k)) fnNames.set(k, `${base}_${++uidN}`); return fnNames.get(k); },
        body: (pinId, k) => {
          const l = g.links.find(x => x.from.node === n.id && x.from.pin === pinId);
          if (!l) return '';
          return indent(chain(nodeById(l.to.node), new Set([...visiting, n.id])), k);
        },
      };
      return d.gen ? d.gen(ctx) : '';
    };
    // kod łańcucha akcji zaczynający się od węzła n
    const chain = (n, visiting = new Set()) => {
      if (!n || visiting.has(n.id)) return '';
      const d = BY[n.type]; if (!d) return '';
      const v2 = new Set([...visiting, n.id]);
      const code = genNode(n, visiting);
      if (d.after === 'none' || d.kind === 'flow') return code;
      // akcje: po wykonaniu idź dalej wyjściem „then”
      const next = g.links.find(x => x.from.node === n.id && x.from.pin === 'then');
      const rest = next ? chain(nodeById(next.to.node), v2) : '';
      return [code, rest].filter(s => s && s.trim()).join('\n');
    };
    const events = g.nodes.filter(n => BY[n.type] && BY[n.type].kind === 'event');
    const blocks = events.sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(n => genNode(n));
    const header = [];
    const comment = t === 'python' ? '#' : t === 'js' ? '//' : '--';
    header.push(`${comment} Wygenerowano w edytorze bloczkowym CodeManager${g.name ? ` – ${g.name}` : ''}`);
    if (issues.length) header.push(`${comment} UWAGA: schemat ma błędy (${issues.length}) – kod może nie działać.`);
    const pre = [...needs];
    const varDecl = [...vars].map(v => {
      const init = (g.vars || []).find(x => ident(x.name) === v);
      const val = init && init.value !== undefined && init.value !== '' ? (isNaN(+init.value) ? strLit(init.value, t) : String(+init.value)) : '0';
      return t === 'lua' ? `local ${v} = ${val}` : t === 'python' ? `${v} = ${val}` : `let ${v} = ${val};`;
    });
    let body = blocks.filter(s => s && s.trim()).join('\n\n');
    // Python: zmienne globalne w funkcjach (co pewien czas)
    if (t === 'python' && vars.size) body = body.replace(/^(\s*)def (\w+)\(\):\n/gm, (m, sp, name) => `${m}${sp}    global ${[...vars].join(', ')}\n`);
    if (t === 'js' && /await /.test(body) && !/\(async \(\) =>|setInterval\(async/.test(body)) body = `(async () => {\n${indent(body, 1)}\n})();`;
    return { code: [...header, ...(pre.length ? ['', ...pre] : []), ...(varDecl.length ? ['', ...varDecl] : []), '', body, ''].join('\n').replace(/\n{3,}/g, '\n\n'), errors: issues.length, language: t === 'js' ? 'javascript' : t };
  }

  // ---------- nowy graf i przykłady ----------
  let idc = 0;
  const newId = () => 'n' + Date.now().toString(36) + (idc++).toString(36);
  function addNode(g, type, x, y, values) { const d = BY[type]; if (!d) throw new Error('Nieznany bloczek ' + type); const n = { id: newId(), type, x: Math.round(x), y: Math.round(y), values: { ...(values || {}) } }; g.nodes.push(n); return n; }
  function empty(target = 'lua', profile = 'lua') { return { version: 1, name: '', target, profile, realm: 'server', nodes: [], links: [], vars: [] }; }
  const EXAMPLES = {
    'fivem-hello': { title: 'FiveM: komenda /witaj', make: () => { const g = empty('lua', 'fivem'); const e = addNode(g, 'fivem.command', 40, 60, { name: 'witaj' }); const n = addNode(g, 'fivem.name', 60, 260); const j = addNode(g, 'text.join', 300, 240, { a: 'Witaj, ' }); const c = addNode(g, 'fivem.chat', 560, 60, { author: 'Serwer' }); connect(g, { node: e.id, pin: 'then' }, { node: c.id, pin: 'exec' }); connect(g, { node: e.id, pin: 'player' }, { node: n.id, pin: 'player' }); connect(g, { node: n.id, pin: 'name' }, { node: j.id, pin: 'b' }); connect(g, { node: j.id, pin: 'out' }, { node: c.id, pin: 'text' }); connect(g, { node: e.id, pin: 'player' }, { node: c.id, pin: 'player' }); return g; } },
    'gmod-welcome': { title: "Garry's Mod: powitanie gracza", make: () => { const g = empty('lua', 'gmod'); const e = addNode(g, 'gmod.join', 40, 60); const nk = addNode(g, 'gmod.nick', 60, 240); const j = addNode(g, 'text.join', 300, 220, { a: 'Na serwer wchodzi ' }); const pr = addNode(g, 'gmod.print', 560, 60); connect(g, { node: e.id, pin: 'then' }, { node: pr.id, pin: 'exec' }); connect(g, { node: e.id, pin: 'player' }, { node: nk.id, pin: 'player' }); connect(g, { node: nk.id, pin: 'name' }, { node: j.id, pin: 'b' }); connect(g, { node: j.id, pin: 'out' }, { node: pr.id, pin: 'text' }); return g; } },
    'python-dice': { title: 'Python: rzut kostką 5 razy', make: () => { const g = empty('python'); const e = addNode(g, 'ev.start', 40, 60); const f = addNode(g, 'flow.for', 260, 60, { from: 1, to: 5 }); const r = addNode(g, 'math.random', 260, 300, { min: 1, max: 6 }); const j = addNode(g, 'text.join', 520, 300, { a: 'Wyrzucono: ' }); const pr = addNode(g, 'act.print', 760, 60); connect(g, { node: e.id, pin: 'then' }, { node: f.id, pin: 'exec' }); connect(g, { node: f.id, pin: 'loop' }, { node: pr.id, pin: 'exec' }); connect(g, { node: r.id, pin: 'out' }, { node: j.id, pin: 'b' }); connect(g, { node: j.id, pin: 'out' }, { node: pr.id, pin: 'value' }); return g; } },
  };

  const api = { TYPES, LIBRARY: L, BY, compatible, available, library, canConnect, connect, validate, generate, addNode, empty, EXAMPLES, newId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BlocksCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
