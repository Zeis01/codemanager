// Generator baz podpowiedzi Lua dla gier (src/renderer/lua-api/<gra>.json.gz).
// Źródła (pobierz do jednego folderu i podaj go jako argument):
//   git clone https://github.com/tf-framework/fivem-lls-addon
//   git clone -b lua-language-server-addon https://github.com/luttje/glua-api-snippets glua
//   git clone -b addon https://github.com/demiurgeQuantified/UmbrellaAddon umbrella
//   git clone https://github.com/LuaCATS/dontstarve
//   git clone https://github.com/Ierdna100/StormworksAddonLua
//   git clone https://github.com/BeamMP/Docs beammp-docs
//   curl -o rdr3.json https://raw.githubusercontent.com/alloc8or/rdr3-nativedb-data/master/natives.json
//   npm pack @citizenfx/client @citizenfx/server typed-factorio mtasa-lua-types (rozpakowane)
// Użycie: node tools/lua-api/build.js /tmp/luaapi
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const L = require('../../src/main/editor/luacats');

const SRC = process.argv[2] || '/tmp/luaapi';
const OUT = path.join(__dirname, '..', '..', 'src', 'renderer', 'lua-api');
fs.mkdirSync(OUT, { recursive: true });
const walk = (d, re) => { const out = []; if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walk(p, re)); else if (re.test(e.name)) out.push(p); } return out.sort(); };
const glob1 = re => fs.readdirSync(SRC).filter(n => re.test(n)).map(n => path.join(SRC, n))[0];
const newDb = () => ({ globals: {}, tables: {}, classes: {}, vars: {}, events: {} });
const DOC_MAX = 420;
const trimDoc = d => { d = String(d || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(); if (d.length <= DOC_MAX) return d; const c = d.slice(0, DOC_MAX); return c.slice(0, Math.max(c.lastIndexOf('. ') + 1, 200)).trim() + ' …'; };
const tsType = t => String(t || '').replace(/\bundefined\b/g, 'nil').replace(/\s+/g, ' ').trim();
const mainTs = t => { t = tsType(t).replace(/^readonly\s+/, ''); const p = splitBar(t).map(x => x.trim()).filter(x => x && x !== 'nil' && x !== 'void'); return p.length === 1 ? p[0].slice(0, 90) : ''; };

// ---------- JSDoc + deklaracje TypeScript (natives CFX, MTA) ----------
function parseJsDoc(block) {
  const lines = block.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(l => l.replace(/^\s*\*\s?/, ''));
  const desc = []; const params = {}; let ret = ''; let see = '';
  let cur = null;
  for (const l of lines) {
    let m;
    if ((m = l.match(/^@param\s+(\w+)\s*(.*)$/))) { cur = params[m[1]] = m[2]; cur = m[1]; continue; }
    if ((m = l.match(/^@returns?\s*(.*)$/))) { ret = m[1]; cur = '@r'; continue; }
    if ((m = l.match(/^@see\s+(.*)$/))) { see = m[1]; cur = null; continue; }
    if (/^@/.test(l)) { cur = null; continue; }
    if (cur && cur !== '@r') params[cur] += ' ' + l.trim(); else if (cur === '@r') ret += ' ' + l.trim(); else desc.push(l);
  }
  const clean = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1').replace(/\{@link\s+([^}|]+?)(?:\s+[^}]*)?\}/g, '$1').replace(/\{@linkplain\s+\S+\s+([^}]+)\}/g, '$1').replace(/\\$/gm, '').replace(/\*\*/g, '').trim();
  return { desc: clean(desc.join('\n')), params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, clean(v)])), ret: clean(ret), see };
}
// declare function Name(params): ret;  /  export declare function name(...): ret;
function parseTsFunctions(text, onFn) {
  const re = /(\/\*\*[\s\S]*?\*\/)\s*(?:export\s+)?declare\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*:\s*([^;\n]+);?/g;
  let m;
  while ((m = re.exec(text))) {
    const jd = parseJsDoc(m[1]);
    const params = splitTop(m[3]).map(p => p.trim()).filter(p => p && !/^this\s*:/.test(p)).map(p => { const mm = p.match(/^(\.\.\.)?(\w+)(\?)?\s*:\s*([\s\S]+)$/); return mm ? { name: (mm[1] || '') + mm[2], opt: !!mm[3], type: tsType(mm[4]) } : { name: p, type: '' }; });
    onFn({ name: m[2], params, ret: tsType(m[4]), jd });
  }
}
function splitBar(s) { const out = []; let d = 0; let cur = ''; for (const ch of s) { if ('([{<'.includes(ch)) d++; if (')]}>'.includes(ch)) d--; if (ch === '|' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function splitTop(s) { const out = []; let d = 0; let cur = ''; for (const ch of s) { if ('([{<'.includes(ch)) d++; if (')]}>'.includes(ch)) d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; }
const luaSig = (params, ret) => '(' + params.map(p => `${p.name}${p.opt ? '?' : ''}: ${p.type.replace(/\s+/g, ' ').slice(0, 60)}`).join(', ') + ')' + (ret && ret !== 'void' ? ': ' + ret.replace(/\s+/g, ' ').slice(0, 80) : '');
const fnEntry = (f, realm) => ['f', luaSig(f.params, f.ret), mainTs(f.ret), trimDoc([f.jd.desc, ...f.params.filter(p => f.jd.params[p.name.replace(/^\.\.\./, '')]).map(p => `${p.name} – ${f.jd.params[p.name.replace(/^\.\.\./, '')]}`)].filter(Boolean).join('\n')), realm, /deprecated/i.test(f.jd.desc.slice(0, 60)) ? 1 : 0];

function mergeRealm(db, name, e) {
  const prev = db.globals[name];
  if (prev && prev[4] && e[4] && prev[4] !== e[4]) { prev[4] = 'sh'; return; }
  if (!prev) db.globals[name] = e;
}
function luacatsDir(dir, db, realmFor) {
  for (const f of walk(dir, /\.lua$/)) {
    const before = new Set(Object.keys(db.globals));
    L.parse(fs.readFileSync(f, 'utf8'), db);
    const realm = realmFor ? realmFor(f) : '';
    if (realm) for (const k of Object.keys(db.globals)) if (!before.has(k) && !db.globals[k][4]) db.globals[k][4] = realm;
  }
  return db;
}
function save(id, meta, db) {
  // usuń puste tabele, skróć opisy
  for (const t of Object.keys(db.tables)) if (!Object.keys(db.tables[t]).filter(k => k !== '__doc').length && !db.globals[t]) delete db.tables[t];
  const json = JSON.stringify({ id, ...meta, built: new Date().toISOString().slice(0, 10), ...db });
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(path.join(OUT, id + '.json.gz'), gz);
  const count = Object.keys(db.globals).length + Object.values(db.tables).reduce((a, t) => a + Object.keys(t).length, 0) + Object.values(db.classes).reduce((a, c) => a + Object.keys(c.m).length, 0);
  console.log(`${id}: ${count} pozycji, ${Object.keys(db.events).length} zdarzeń, ${(json.length / 1024).toFixed(0)} KB → ${(gz.length / 1024).toFixed(0)} KB gz`);
  return count;
}

// ---------- FiveM ----------
const CFX_EVENTS_SERVER = {
  playerConnecting: ['(name: string, setKickReason: function, deferrals: table)', 'Gracz łączy się z serwerem. source = tymczasowy identyfikator gracza. deferrals pozwala opóźnić wejście (defer, update, done).'],
  playerJoining: ['(oldId: string)', 'Gracz dołączył do serwera (po playerConnecting). source = identyfikator gracza.'],
  playerDropped: ['(reason: string)', 'Gracz opuścił serwer. source = identyfikator gracza.'],
  onResourceStart: ['(resourceName: string)', 'Zasób został uruchomiony (po stronie serwera i klienta).'],
  onResourceStarting: ['(resourceName: string)', 'Zasób zaraz się uruchomi – można anulować przez CancelEvent().'],
  onResourceStop: ['(resourceName: string)', 'Zasób został zatrzymany.'],
  onServerResourceStart: ['(resourceName: string)', 'Zasób uruchomiony po stronie serwera.'],
  onServerResourceStop: ['(resourceName: string)', 'Zasób zatrzymany po stronie serwera.'],
  playerEnteredScope: ['(data: { player: string, for: string })', 'Gracz pojawił się w zasięgu (OneSync) innego gracza.'],
  playerLeftScope: ['(data: { player: string, for: string })', 'Gracz wyszedł z zasięgu (OneSync) innego gracza.'],
  entityCreating: ['(handle: number)', 'Encja jest tworzona (OneSync) – CancelEvent() blokuje utworzenie.'],
  entityCreated: ['(handle: number)', 'Encja została utworzona (OneSync).'],
  entityRemoved: ['(handle: number)', 'Encja została usunięta (OneSync).'],
  chatMessage: ['(source: number, author: string, text: string)', 'Wiadomość czatu (zasób chat).'],
  explosionEvent: ['(sender: number, ev: table)', 'Gracz wywołał eksplozję – CancelEvent() ją blokuje.'],
  weaponDamageEvent: ['(sender: number, data: table)', 'Obrażenia od broni zgłoszone przez klienta – CancelEvent() je blokuje.'],
  startProjectileEvent: ['(sender: number, data: table)', 'Wystrzelono pocisk.'],
  ptFxEvent: ['(sender: number, data: table)', 'Klient utworzył efekt cząsteczkowy.'],
  giveWeaponEvent: ['(sender: number, data: table)', 'Klient próbuje dać broń.'],
  removeWeaponEvent: ['(sender: number, data: table)', 'Klient próbuje zabrać broń.'],
  removeAllWeaponsEvent: ['(sender: number, data: table)', 'Klient próbuje zabrać wszystkie bronie.'],
  clearPedTasksEvent: ['(sender: number, data: table)', 'Klient czyści zadania postaci.'],
  rconCommand: ['(commandName: string, args: table)', 'Polecenie wpisane przez RCON.'],
  onResourceListRefresh: ['()', 'Odświeżono listę zasobów (refresh).'],
};
const CFX_EVENTS_CLIENT = {
  onClientResourceStart: ['(resourceName: string)', 'Zasób uruchomiony po stronie klienta.'],
  onClientResourceStop: ['(resourceName: string)', 'Zasób zatrzymany po stronie klienta.'],
  gameEventTriggered: ['(name: string, args: table)', 'Zdarzenie silnika gry (np. CEventNetworkEntityDamage).'],
  populationPedCreating: ['(x: number, y: number, z: number, model: number, setters: table)', 'Gra tworzy postać przechodnia – CancelEvent() blokuje.'],
  onResourceStart: CFX_EVENTS_SERVER.onResourceStart, onResourceStop: CFX_EVENTS_SERVER.onResourceStop,
  'baseevents:onPlayerDied': ['(killerType: number, coords: table)', 'Zasób baseevents: gracz zginął.'],
  'baseevents:onPlayerKilled': ['(killerId: number, data: table)', 'Zasób baseevents: gracz został zabity.'],
  'baseevents:enteredVehicle': ['(vehicle: number, seat: number, displayName: string)', 'Zasób baseevents: gracz wsiadł do pojazdu.'],
  'baseevents:leftVehicle': ['(vehicle: number, seat: number, displayName: string)', 'Zasób baseevents: gracz wysiadł z pojazdu.'],
};
function cfxRuntime(db, gtaOnly) {
  const base = path.join(SRC, 'fivem-lls-addon', 'addon', 'library', 'cfx-runtime');
  luacatsDir(base, db, f => (/[\\/]client[\\/]/.test(f) ? 'c' : /[\\/]server[\\/]/.test(f) ? 's' : ''));
  if (!gtaOnly) delete db.tables.natives_aliases;
}
function addEvents(db, map, realm) { for (const [n, [s, d]] of Object.entries(map)) db.events[n] = db.events[n] ? { ...db.events[n], r: 'sh' } : { s, d, r: realm }; }
function buildFivem() {
  const db = newDb();
  cfxRuntime(db);
  const cl = glob1(/^citizenfx-client/); const sv = glob1(/^citizenfx-server/);
  parseTsFunctions(fs.readFileSync(path.join(cl, 'package', 'natives_universal.d.ts'), 'utf8'), f => mergeRealm(db, f.name, fnEntry(f, 'c')));
  parseTsFunctions(fs.readFileSync(path.join(sv, 'package', 'natives_server.d.ts'), 'utf8'), f => mergeRealm(db, f.name, fnEntry(f, 's')));
  addEvents(db, CFX_EVENTS_SERVER, 's'); addEvents(db, CFX_EVENTS_CLIENT, 'c');
  db.eventFns = ['AddEventHandler', 'RegisterNetEvent', 'RegisterServerEvent', 'TriggerEvent', 'TriggerServerEvent', 'TriggerClientEvent', 'TriggerLatentServerEvent', 'TriggerLatentClientEvent'];
  return save('fivem', { name: 'FiveM (GTA V)', source: 'Natywne funkcje: @citizenfx/client i @citizenfx/server (docs.fivem.net/natives), środowisko Lua CFX: fivem-lls-addon' }, db);
}

// ---------- RedM ----------
const pascal = s => s.toLowerCase().replace(/(^|_)([a-z0-9])/g, (_, a, b) => b.toUpperCase());
const RDR_T = t => ({ int: 'integer', float: 'number', BOOL: 'boolean', 'const char*': 'string', 'char*': 'string', void: '', Hash: 'Hash', Any: 'any', Vector3: 'vector3' }[t] !== undefined ? { int: 'integer', float: 'number', BOOL: 'boolean', 'const char*': 'string', 'char*': 'string', void: '', Hash: 'Hash', Any: 'any', Vector3: 'vector3' }[t] : t);
function buildRedm() {
  const db = newDb();
  cfxRuntime(db);
  const nat = JSON.parse(fs.readFileSync(path.join(SRC, 'rdr3.json'), 'utf8'));
  for (const [ns, list] of Object.entries(nat)) {
    for (const [hash, n] of Object.entries(list)) {
      const name = n.name && !n.name.startsWith('_0x') ? pascal(n.name.replace(/^_/, '')) : 'N_' + hash.toLowerCase();
      const params = (n.params || []).map(p => ({ name: p.name, type: RDR_T(p.type) }));
      const ret = RDR_T(n.return_type);
      const e = ['f', '(' + params.map(p => `${p.name}: ${p.type}`).join(', ') + ')' + (ret ? ': ' + ret : ''), '', trimDoc([(n.comment || '').replace(/\n{2,}/g, '\n'), `${ns} · ${hash}`].filter(Boolean).join('\n')), ns === 'BUILTIN' ? 'sh' : 'c', 0];
      if (!db.globals[name]) db.globals[name] = e;
    }
  }
  const sv = glob1(/^citizenfx-server/);
  parseTsFunctions(fs.readFileSync(path.join(sv, 'package', 'natives_server.d.ts'), 'utf8'), f => mergeRealm(db, f.name, fnEntry(f, 's')));
  addEvents(db, CFX_EVENTS_SERVER, 's'); addEvents(db, { onClientResourceStart: CFX_EVENTS_CLIENT.onClientResourceStart, onClientResourceStop: CFX_EVENTS_CLIENT.onClientResourceStop, gameEventTriggered: CFX_EVENTS_CLIENT.gameEventTriggered }, 'c');
  db.eventFns = ['AddEventHandler', 'RegisterNetEvent', 'RegisterServerEvent', 'TriggerEvent', 'TriggerServerEvent', 'TriggerClientEvent'];
  return save('redm', { name: 'RedM (RDR2)', source: 'Natywne funkcje RDR2: alloc8or/rdr3-nativedb-data, natywne funkcje serwera CFX: @citizenfx/server, środowisko Lua CFX: fivem-lls-addon' }, db);
}

// ---------- BeamMP ----------
function mdSections(text, level) {
  const out = []; const re = new RegExp(`^#{${level}}\\s+(.+)$`, 'gm'); let m; const marks = [];
  while ((m = re.exec(text))) marks.push({ title: m[1].trim(), at: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) { const next = text.slice(marks[i].end).search(/^#{1,6}\s/m); out.push({ title: marks[i].title, body: text.slice(marks[i].end, next < 0 ? undefined : marks[i].end + next).trim() }); }
  return out;
}
const mdText = b => b.replace(/```[\s\S]*?```/g, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/`([^`]+)`/g, '$1').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^!!!.*$/gm, '').replace(/^\s{4}/gm, '').trim();
function buildBeammp() {
  const db = newDb();
  const sref = fs.readFileSync(path.join(SRC, 'beammp-docs', 'docs', 'en', 'scripting', 'server', 'latest-server-reference.md'), 'utf8');
  for (const s of [...mdSections(sref, 4), ...mdSections(sref, 5)]) {
    const t = s.title.replace(/^`|`$/g, '').replace(/`[^`]*$/, '');
    let m;
    if ((m = t.match(/^(\w+)\.(\w+)\s*\(([^)]*)\)\s*(?:->\s*(.+))?$/))) {
      (db.tables[m[1]] = db.tables[m[1]] || {})[m[2]] = ['f', '(' + m[3].replace(/\s*\(since[^)]*\)/g, '') + ')' + (m[4] ? ': ' + m[4].trim() : ''), '', trimDoc(mdText(s.body)), 's', 0];
    } else if ((m = t.match(/^(\w+)\.(\w+)\s*->\s*(.+)$/))) {
      (db.tables[m[1]] = db.tables[m[1]] || {})[m[2]] = ['v', '', '', trimDoc(m[3] + '\n' + mdText(s.body)), 's', 0];
    } else if ((m = t.match(/^(\w+)\s*\(([^)]*)\)/)) && !/\./.test(t)) {
      db.globals[m[1]] = ['f', '(' + m[2] + ')', '', trimDoc(mdText(s.body)), 's', 0];
    } else if ((m = t.match(/^(on\w+)$/))) {
      db.events[m[1]] = { s: '', d: trimDoc(mdText(s.body)), r: 's' };
    }
  }
  // Util.Log* „et al”
  if (db.tables.Util) for (const n of ['LogInfo', 'LogWarn', 'LogError', 'LogDebug']) db.tables.Util[n] = db.tables.Util[n] || ['f', '(...)', '', 'Zapisuje wiadomość do logu serwera z odpowiednim poziomem (od v3.3.0).', 's', 0];
  // MP.Settings – stałe
  db.tables.MP = db.tables.MP || {};
  for (const [n, v] of Object.entries({ Debug: 0, Private: 1, MaxCars: 2, MaxPlayers: 3, Map: 4, Name: 5, Description: 6, InformationPacket: 7 })) (db.tables['MP.Settings'] = db.tables['MP.Settings'] || {})[n] = ['c', '', '', '= ' + v + ' (do MP.Set)', 's', 0];
  // klient (BeamNG + BeamMP)
  const cref = fs.readFileSync(path.join(SRC, 'beammp-docs', 'docs', 'en', 'API documentation', 'Client-Side.md'), 'utf8');
  const toc = {}; let mod = null;
  for (const line of cref.split('\n')) { let m; if ((m = line.match(/^###\s+(MP\w+)/))) mod = m[1]; else if ((m = line.match(/^\s*-\s+\[([^\]]+)\]/)) && mod) toc[m[1].trim().toLowerCase()] = mod; else if (/^---/.test(line)) break; }
  let curMod = null; let curObj = null;
  const lines = cref.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    if ((m = lines[i].match(/^##\s+(.+)$/))) { curMod = toc[m[1].trim().toLowerCase()] || curMod; curObj = null; continue; }
    if ((m = lines[i].match(/^###\s+(\w+) Object Methods/))) { curObj = m[1]; continue; }
    if ((m = lines[i].match(/^#{3,4}\s+`([\w.:]+)\(([^)]*)\)`/))) {
      let j = i + 1; const body = []; while (j < lines.length && !/^#{1,4}\s/.test(lines[j])) body.push(lines[j++]);
      const doc = trimDoc(mdText(body.join('\n')));
      const name = m[1];
      if (name.includes(':')) { const [o, fn] = name.split(':'); const cls = (curObj || o).replace(/^\w/, c => c.toUpperCase()); (db.classes['BeamMP' + cls] = db.classes['BeamMP' + cls] || { b: '', m: {} }).m[fn] = ['f', '(' + m[2] + ')', '', doc, 'c', 0]; }
      else if (curMod) (db.tables[curMod] = db.tables[curMod] || {})[name.replace(/^\w+\./, '')] = ['f', '(' + m[2] + ')', '', doc, 'c', 0];
    }
  }
  db.eventFns = ['MP.RegisterEvent', 'MP.TriggerLocalEvent', 'MP.TriggerGlobalEvent', 'MP.CreateEventTimer', 'MP.CancelEventTimer', 'AddEventHandler', 'TriggerServerEvent'];
  return save('beammp', { name: 'BeamMP (BeamNG.drive)', source: 'Dokumentacja BeamMP (BeamMP/Docs): skrypty serwera 3.x i API klienta' }, db);
}

// ---------- Garry's Mod ----------
function buildGmod() {
  const db = luacatsDir(path.join(SRC, 'glua', 'library'), newDb());
  // zdarzenia: metody GM (hook.Add("PlayerSpawn", …))
  for (const [n, e] of Object.entries((db.classes.GM || { m: {} }).m)) db.events[n] = { s: e[1], d: e[3], r: e[4] };
  for (const [n, e] of Object.entries((db.classes.SANDBOX || { m: {} }).m)) if (!db.events[n]) db.events[n] = { s: e[1], d: e[3], r: e[4] };
  db.eventFns = ['hook.Add', 'hook.Remove', 'hook.Run', 'hook.Call', 'gamemode.Call'];
  db.vars = { ...db.vars, GAMEMODE: 'GM', GM: 'GM', ENT: 'ENT', SWEP: 'SWEP', TOOL: 'TOOL', EFFECT: 'EFFECT', PANEL: 'PANEL' };
  db.guess = { ply: 'Player', player: 'Player', pl: 'Player', target: 'Player', attacker: 'Entity', ent: 'Entity', entity: 'Entity', self: 'Entity', wep: 'Weapon', weapon: 'Weapon', veh: 'Vehicle', vehicle: 'Vehicle', pnl: 'Panel', panel: 'Panel', frame: 'DFrame', npc: 'NPC', phys: 'PhysObj', dmginfo: 'CTakeDamageInfo', trace: 'table', vec: 'Vector', pos: 'Vector', ang: 'Angle', col: 'Color', color: 'Color' };
  return save('gmod', { name: "Garry's Mod", source: 'Wiki Garry\'s Mod (wiki.facepunch.com) przez glua-api-snippets' }, db);
}

// ---------- MTA:SA ----------
function buildMta() {
  const db = newDb();
  const base = path.join(glob1(/^mta$/) || path.join(SRC, 'mta'), 'package');
  for (const [side, realm] of [['server', 's'], ['client', 'c'], ['shared', 'sh']]) {
    for (const f of walk(path.join(base, side, 'function'), /\.d\.ts$/)) parseTsFunctions(fs.readFileSync(f, 'utf8'), fn => mergeRealm(db, fn.name, fnEntry(fn, realm)));
    for (const f of walk(path.join(base, side, 'event'), /\.d\.ts$/)) {
      const t = fs.readFileSync(f, 'utf8');
      const re = /(\/\*\*[\s\S]*?\*\/)?\s*export interface (\w+) extends GenericEventHandler \{\s*name: EventNames\.\w+;\s*function: \(\s*this: void,?\s*([\s\S]*?)\)\s*=>/g;
      let m;
      while ((m = re.exec(t))) { const name = m[2].replace(/^On/, 'on'); const jd = m[1] ? parseJsDoc(m[1]) : { desc: '' }; const args = splitTop(m[3]).map(s => s.trim()).filter(Boolean).join(', '); db.events[name] = db.events[name] ? { ...db.events[name], r: 'sh' } : { s: '(' + args + ')', d: trimDoc(jd.desc), r: realm }; }
    }
  }
  db.globals.root = ['v', '', 'Element', 'Główny element drzewa (root) – wszystkie elementy.', 'sh', 0];
  db.globals.resourceRoot = ['v', '', 'Element', 'Element główny bieżącego zasobu.', 'sh', 0];
  db.globals.resource = ['v', '', 'Resource', 'Bieżący zasób.', 'sh', 0];
  db.globals.localPlayer = ['v', '', 'Player', 'Lokalny gracz (tylko klient).', 'c', 0];
  db.globals.guiRoot = ['v', '', 'Element', 'Element główny GUI (tylko klient).', 'c', 0];
  for (const v of ['source', 'client', 'eventName', 'sourceResource', 'sourceResourceRoot']) db.globals[v] = ['v', '', '', 'Zmienna dostępna w funkcji obsługi zdarzenia.', 'sh', 0];
  db.eventFns = ['addEventHandler', 'removeEventHandler', 'triggerEvent', 'triggerClientEvent', 'triggerServerEvent', 'triggerLatentClientEvent', 'triggerLatentServerEvent', 'addEvent', 'cancelEvent'];
  return save('mta', { name: 'MTA:SA', source: 'Wiki MTA (wiki.multitheftauto.com) przez mtasa-lua-types' }, db);
}

// ---------- Project Zomboid ----------
function buildPz() {
  const db = newDb();
  luacatsDir(path.join(SRC, 'umbrella', 'library', 'Events'), db);
  luacatsDir(path.join(SRC, 'umbrella', 'library', 'Candle'), db);
  luacatsDir(path.join(SRC, 'umbrella', 'library', 'Lua'), db);
  // klasy Javy bez opisów, żeby baza nie była ogromna – zostają sygnatury
  for (const c of Object.values(db.classes)) for (const e of Object.values(c.m)) if (e[3] && e[3].length > 160) e[3] = e[3].slice(0, 157) + '…';
  for (const n of Object.keys(db.tables.Events || {})) if (n !== '__doc') db.events[n] = { s: '', d: (db.tables.Events[n] || [])[3] || '', r: '' };
  db.eventFns = [];
  db.guess = { player: 'IsoPlayer', playerObj: 'IsoPlayer', character: 'IsoGameCharacter', item: 'InventoryItem', square: 'IsoGridSquare', sq: 'IsoGridSquare', inv: 'ItemContainer', inventory: 'ItemContainer', zombie: 'IsoZombie', vehicle: 'BaseVehicle', cell: 'IsoCell' };
  return save('pz', { name: 'Project Zomboid', source: 'Umbrella (demiurgeQuantified/UmbrellaAddon) – API Javy, zdarzenia i Lua gry' }, db);
}

// ---------- Don't Starve Together ----------
function buildDst() {
  const db = luacatsDir(path.join(SRC, 'dontstarve'), newDb());
  db.guess = { inst: 'EntityScript', player: 'EntityScript', doer: 'EntityScript', target: 'EntityScript' };
  return save('dst', { name: "Don't Starve Together", source: 'LuaCATS/dontstarve' }, db);
}

// ---------- Stormworks ----------
function buildStormworks() {
  const db = luacatsDir(path.join(SRC, 'StormworksAddonLua', 'library'), newDb());
  return save('stormworks', { name: 'Stormworks (dodatki)', source: 'Ierdna100/StormworksAddonLua (API dodatków Stormworks)' }, db);
}

// ---------- Factorio ----------
function parseTsInterfaces(text, db) {
  const lines = text.split('\n');
  let cur = null; let depth = 0; let jdoc = ''; let collecting = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const t = line.trim();
    let m;
    if (!cur) {
      if ((m = t.match(/^export interface (\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w<>, ]+?))?\s*\{$/))) { cur = { name: m[1], b: (m[2] || '').split(',')[0].replace(/<.*$/, '').trim() }; depth = 1; db.classes[cur.name] = db.classes[cur.name] || { b: cur.b, m: {} }; jdoc = ''; }
      continue;
    }
    if (collecting !== null) { collecting += ' ' + t; if (balanced(collecting)) { addMember(collecting, jdoc); collecting = null; jdoc = ''; } continue; }
    if (t.startsWith('/**')) { let b = t; while (!b.includes('*/') && i + 1 < lines.length) b += '\n' + lines[++i]; jdoc = b; continue; }
    if (t === '}' && depth === 1) { cur = null; continue; }
    if (depth === 1 && t && !t.startsWith('//')) {
      if (balanced(t)) { addMember(t, jdoc); jdoc = ''; } else collecting = t;
    }
  }
  function balanced(s) { let d = 0; for (const ch of s) { if ('({['.includes(ch)) d++; if (')}]'.includes(ch)) d--; } return d === 0 && !/[,(|&]$/.test(s.trim()); }
  function addMember(s, jd) {
    s = s.replace(/\s+/g, ' ').trim();
    const doc = jd ? parseJsDoc(jd) : { desc: '', params: {} };
    let m;
    if ((m = s.match(/^(?:readonly\s+)?(\w+)(\?)?\s*:\s*(.+)$/)) && !/^\w+\s*\(/.test(s)) {
      const type = tsType(m[3]);
      db.classes[cur.name].m[m[1]] = ['v', '', mainTs(type), trimDoc((type.length < 100 ? type + '\n' : '') + doc.desc), '', 0];
    } else if ((m = s.match(/^(?:get\s+)?(\w+)\s*(?:<[^>]*>)?\s*\((.*)\)\s*:\s*(.+)$/))) {
      const params = splitTop(m[2]).map(p => p.trim()).filter(Boolean).map(p => { const mm = p.match(/^(\.\.\.)?(\w+)(\?)?\s*:\s*([\s\S]+)$/); return mm ? { name: (mm[1] || '') + mm[2], opt: !!mm[3], type: tsType(mm[4]).length > 50 ? 'table' : tsType(mm[4]) } : { name: p, type: '' }; });
      const isGetter = /^get\s/.test(s);
      db.classes[cur.name].m[m[1]] = isGetter ? ['v', '', mainTs(m[3]), trimDoc(doc.desc), '', 0] : fnEntry({ name: m[1], params, ret: tsType(m[3]), jd: doc }, '');
    }
  }
}
function parseDefines(text, db) {
  const lines = text.split('\n'); const stack = []; let inDefines = false;
  for (const line of lines) {
    const t = line.trim(); let m;
    if (!inDefines) { if (/^namespace defines \{/.test(t)) { inDefines = true; stack.push('defines'); } continue; }
    if ((m = t.match(/^(?:namespace|enum)\s+(\w+)\s*\{/))) { const parent = stack.join('.'); (db.tables[parent] = db.tables[parent] || {})[m[1]] = ['t', '', '', '', '', 0]; stack.push(m[1]); db.tables[stack.join('.')] = db.tables[stack.join('.')] || {}; continue; }
    if (t === '}') { stack.pop(); if (!stack.length) break; continue; }
    if ((m = t.match(/^(?:const\s+)?(\w+)\s*(?:[:=][^,]*)?,?$/)) && stack.length && !t.startsWith('*') && !t.startsWith('/')) (db.tables[stack.join('.')] = db.tables[stack.join('.')] || {})[m[1]] = ['c', '', '', stack.join('.') + '.' + m[1], '', 0];
  }
}
function buildFactorio() {
  const db = newDb();
  const base = path.join(glob1(/^typed-factorio/), 'package');
  parseTsInterfaces(fs.readFileSync(path.join(base, 'runtime', 'generated', 'classes.d.ts'), 'utf8'), db);
  parseDefines(fs.readFileSync(path.join(base, 'runtime', 'generated', 'defines.d.ts'), 'utf8'), db);
  const gf = fs.readFileSync(path.join(base, 'runtime', 'generated', 'global-functions.d.ts'), 'utf8');
  const re = /(\/\*\*[\s\S]*?\*\/)\s*function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^\n]+)/g; let m;
  while ((m = re.exec(gf))) { const params = splitTop(m[3]).map(p => { const mm = p.trim().match(/^(\w+)(\?)?\s*:\s*(.+)$/); return mm ? { name: mm[1], opt: !!mm[2], type: tsType(mm[3]) } : { name: p.trim(), type: '' }; }).filter(p => p.name); db.globals[m[2]] = fnEntry({ name: m[2], params, ret: tsType(m[4]), jd: parseJsDoc(m[1]) }, ''); }
  Object.assign(db.vars, { game: 'LuaGameScript', script: 'LuaBootstrap', remote: 'LuaRemote', commands: 'LuaCommandProcessor', rendering: 'LuaRendering', rcon: 'LuaRCON', prototypes: 'LuaPrototypes', helpers: 'LuaHelpers' });
  for (const [n, c] of Object.entries(db.vars)) db.globals[n] = ['v', '', c, `Obiekt globalny (${c}).`, '', 0];
  db.globals.storage = ['t', '', '', 'Tabela zapisywana razem z grą (dawniej global).', '', 0];
  db.globals.data = ['t', '', '', 'Etap danych: data:extend{…}, data.raw[…].', '', 0];
  db.globals.settings = ['t', '', '', 'Ustawienia moda: settings.startup / global / player.', '', 0];
  db.globals.mods = ['t', '', '', 'Aktywne mody i ich wersje (etap danych).', '', 0];
  db.globals.serpent = ['t', '', '', 'Biblioteka serpent (serializacja tabel).', '', 0];
  db.tables.serpent = { block: ['f', '(t: table, opts?: table): string', 'string', 'Wielowierszowy zapis tabeli.', '', 0], line: ['f', '(t: table, opts?: table): string', 'string', 'Jednowierszowy zapis tabeli.', '', 0], dump: ['f', '(t: table, opts?: table): string', 'string', 'Zapis tabeli jako kod Lua.', '', 0], load: ['f', '(s: string, opts?: table)', '', 'Wczytanie tabeli z tekstu.', '', 0] };
  db.dot = true; // Factorio wywołuje metody kropką (game.print), nie dwukropkiem
  return save('factorio', { name: 'Factorio', source: 'Oficjalne API (lua-api.factorio.com) przez typed-factorio' }, db);
}

const only = process.argv[3];
const builders = { fivem: buildFivem, redm: buildRedm, beammp: buildBeammp, gmod: buildGmod, mta: buildMta, pz: buildPz, dst: buildDst, stormworks: buildStormworks, factorio: buildFactorio };
for (const [id, fn] of Object.entries(builders)) if (!only || only === id) { try { fn(); } catch (e) { console.error(id, e.stack); } }
