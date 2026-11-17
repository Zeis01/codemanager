// Edytor konfiguracji serwera jako formularz: znane ustawienia z opisami po polsku
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

const B = (k, l, d) => ({ k, l, t: 'bool', d });
const N = (k, l, d, min, max) => ({ k, l, t: 'number', d, min, max });
const T = (k, l, d) => ({ k, l, t: 'text', d });
const P = (k, l, d) => ({ k, l, t: 'password', d });
const S = (k, l, o, d) => ({ k, l, t: 'select', o, d });

const SCHEMAS = {
  minecraft: {
    file: () => 'server.properties', format: 'properties', groups: [
      ['Ogólne', [T('motd', 'Opis na liście serwerów (MOTD)', 'Tekst pod nazwą serwera w menu gry wieloosobowej.'), N('max-players', 'Maks. graczy', null, 1, 1000), B('online-mode', 'Tylko oryginalne konta', 'Wyłączenie pozwala wejść bez kupionej gry – każdy może wtedy podszyć się pod dowolny nick.'), B('white-list', 'Biała lista', 'Wpuszcza tylko graczy dodanych do whitelist.json.'), B('enforce-whitelist', 'Wyrzucaj spoza białej listy', 'Po włączeniu białej listy od razu rozłącza graczy, których na niej nie ma.'), N('player-idle-timeout', 'Wyrzucaj nieaktywnych po (min)', '0 = nigdy.', 0, 1440)]],
      ['Rozgrywka', [S('gamemode', 'Tryb gry', [['survival', 'Przetrwanie'], ['creative', 'Kreatywny'], ['adventure', 'Przygoda'], ['spectator', 'Obserwator']]), S('difficulty', 'Poziom trudności', [['peaceful', 'Pokojowy'], ['easy', 'Łatwy'], ['normal', 'Normalny'], ['hard', 'Trudny']]), B('hardcore', 'Hardcore', 'Po śmierci gracz zostaje obserwatorem.'), B('pvp', 'Walka między graczami (PvP)'), B('allow-flight', 'Pozwól latać', 'Potrzebne dla modów/pluginów z lataniem – inaczej gracze są wyrzucani za „latanie”.'), B('allow-nether', 'Nether'), B('spawn-monsters', 'Potwory'), B('enable-command-block', 'Bloki poleceń'), N('spawn-protection', 'Ochrona spawnu (bloki)', 'Promień wokół spawnu, w którym tylko operatorzy mogą budować. 0 = wyłączona.', 0, 1000)]],
      ['Świat', [T('level-name', 'Nazwa folderu świata'), T('level-seed', 'Ziarno świata', 'Działa tylko przy tworzeniu nowego świata.'), S('level-type', 'Typ świata', [['minecraft:normal', 'Normalny'], ['minecraft:flat', 'Płaski'], ['minecraft:large_biomes', 'Duże biomy'], ['minecraft:amplified', 'Wzmocniony']]), N('max-world-size', 'Maks. promień świata', null, 1, 29999984)]],
      ['Wydajność', [N('view-distance', 'Zasięg widzenia (chunki)', 'Mniej = mniejsze obciążenie serwera. Zalecane 8–12.', 2, 32), N('simulation-distance', 'Zasięg symulacji (chunki)', 'Jak daleko od graczy działają moby i farmy.', 2, 32), N('network-compression-threshold', 'Próg kompresji sieci', null, -1, 65535)]],
      ['RCON', [B('enable-rcon', 'Włącz RCON'), N('rcon.port', 'Port RCON', null, 1, 65535), P('rcon.password', 'Hasło RCON')]],
    ],
  },
  projectzomboid: {
    file: s => `Zomboid/Server/${s.settings.servername || 'servertest'}.ini`, format: 'properties', groups: [
      ['Ogólne', [T('PublicName', 'Nazwa serwera'), T('PublicDescription', 'Opis'), B('Public', 'Widoczny na liście serwerów'), N('MaxPlayers', 'Maks. graczy', null, 1, 100), P('Password', 'Hasło serwera'), B('Open', 'Otwarty dla wszystkich', 'Wyłącz, aby wpuszczać tylko graczy z białej listy.'), B('AutoCreateUserInWhiteList', 'Dopisuj nowych graczy do białej listy')]],
      ['Rozgrywka', [B('PVP', 'PvP'), B('SafetySystem', 'System bezpieczeństwa PvP'), B('PauseEmpty', 'Pauza, gdy nikogo nie ma'), B('GlobalChat', 'Czat globalny'), B('SleepAllowed', 'Spanie dozwolone'), B('SleepNeeded', 'Spanie wymagane'), B('PlayerSafehouse', 'Bezpieczne domy graczy'), B('AnnounceDeath', 'Ogłaszaj śmierci'), B('NoFire', 'Wyłącz ogień'), N('HoursForLootRespawn', 'Odnawianie łupów (godz. gry)', '0 = wyłączone.', 0, 10000)]],
      ['Mody', [T('Mods', 'ID modów (oddzielone ;)'), T('WorkshopItems', 'ID przedmiotów Warsztatu (oddzielone ;)'), T('Map', 'Mapy (oddzielone ;)')]],
      ['Serwer', [N('SaveWorldEveryMinutes', 'Zapis świata co (min)', '0 = tylko przy wyłączeniu.', 0, 1440), N('PingLimit', 'Limit pingu (ms)', '0 = bez limitu.', 0, 10000), N('RCONPort', 'Port RCON', null, 1, 65535), P('RCONPassword', 'Hasło RCON')]],
    ],
  },
  terraria: {
    file: () => 'tshock/config.json', format: 'json', groups: [
      ['Ogólne', [T('Settings.ServerName', 'Nazwa serwera'), P('Settings.ServerPassword', 'Hasło serwera'), N('Settings.MaxSlots', 'Maks. graczy', null, 1, 255), N('Settings.ReservedSlots', 'Miejsca zarezerwowane', null, 0, 50), B('Settings.EnableWhitelist', 'Biała lista')]],
      ['Rozgrywka', [N('Settings.SpawnProtectionRadius', 'Ochrona spawnu (kratki)', null, 0, 1000), B('Settings.SpawnProtection', 'Ochrona spawnu'), B('Settings.DisableBuild', 'Zablokuj budowanie'), B('Settings.PvPMode', 'PvP')]],
    ],
  },
  enshrouded: {
    file: () => 'enshrouded_server.json', format: 'json', groups: [
      ['Ogólne', [T('name', 'Nazwa serwera'), P('password', 'Hasło (starsze wersje serwera)'), N('slotCount', 'Maks. graczy', null, 1, 16), N('queryPort', 'Port zapytań', null, 1, 65535)]],
    ],
  },
  palworld: {
    file: s => path.relative(s.path, require('./defs2').palCfgPath(s)).split(path.sep).join('/'), format: 'palworld', groups: [
      ['Ogólne', [T('ServerName', 'Nazwa serwera'), T('ServerDescription', 'Opis'), N('ServerPlayerMaxNum', 'Maks. graczy', null, 1, 32), P('ServerPassword', 'Hasło serwera'), P('AdminPassword', 'Hasło admina')]],
      ['Rozgrywka', [S('Difficulty', 'Trudność', [['None', 'Domyślna'], ['Casual', 'Łatwa'], ['Normal', 'Normalna'], ['Hard', 'Trudna']]), N('ExpRate', 'Mnożnik doświadczenia', null, 0.1, 20), N('PalCaptureRate', 'Szansa złapania', null, 0.5, 2), S('DeathPenalty', 'Kara za śmierć', [['None', 'Brak'], ['Item', 'Przedmioty'], ['ItemAndEquipment', 'Przedmioty i wyposażenie'], ['All', 'Wszystko z Palami']]), B('bEnablePlayerToPlayerDamage', 'Obrażenia między graczami'), B('bEnableFriendlyFire', 'Ogień sojuszniczy')]],
      ['RCON', [B('RCONEnabled', 'Włącz RCON'), N('RCONPort', 'Port RCON', null, 1, 65535)]],
    ],
  },
  beammp: {
    file: () => 'ServerConfig.toml', format: 'toml', groups: [
      ['Ogólne', [T('General.Name', 'Nazwa serwera'), T('General.Description', 'Opis'), N('General.MaxPlayers', 'Maks. graczy', null, 1, 100), N('General.MaxCars', 'Maks. aut na gracza', null, 1, 50), T('General.Map', 'Mapa', 'Np. /levels/gridmap_v2/info.json'), B('General.Private', 'Prywatny (ukryty na liście)'), P('General.AuthKey', 'Klucz serwera (AuthKey)', 'Z keymaster.beammp.com.')]],
    ],
  },
};

// ---------- formaty ----------
const boolOut = (fmt, v) => (fmt === 'palworld' ? (v ? 'True' : 'False') : v ? 'true' : 'false');
function parseBool(v) { return /^(true|1|yes|on)$/i.test(String(v).trim()); }
function getPath(o, k) { return k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o); }
function setPath(o, k, v) { const ps = k.split('.'); let a = o; ps.slice(0, -1).forEach(p => { if (!a[p] || typeof a[p] !== 'object') a[p] = {}; a = a[p]; }); a[ps[ps.length - 1]] = v; }
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function palSplit(inner) { const out = []; let cur = '', qq = false, depth = 0; for (const ch of inner) { if (ch === '"') qq = !qq; if (!qq && ch === '(') depth++; if (!qq && ch === ')') depth--; if (ch === ',' && !qq && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; }
function palInner(t) { const i = t.indexOf('OptionSettings=('); if (i < 0) return null; let d = 0, j = i + 'OptionSettings='.length, qq = false; for (; j < t.length; j++) { const ch = t[j]; if (ch === '"') qq = !qq; if (qq) continue; if (ch === '(') d++; if (ch === ')') { d--; if (!d) break; } } return { start: i + 'OptionSettings=('.length, end: j }; }

function readValues(fmt, text) {
  const out = {};
  if (fmt === 'properties') for (const l of text.split(/\r?\n/)) { const m = l.match(/^\s*([^#;=\s][^=]*?)\s*=(.*)$/); if (m) out[m[1]] = m[2].trim(); }
  else if (fmt === 'json') {
    let j = null;
    try { j = JSON.parse(text); } catch { try { j = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch { j = null; } }
    if (!j || typeof j !== 'object') throw new Error('Plik JSON zawiera błąd – popraw go w edytorze.');
    return { __json: j };
  } else if (fmt === 'palworld') { const r = palInner(text); if (r) for (const p of palSplit(text.slice(r.start, r.end))) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim().replace(/^"|"$/g, ''); } }
  else if (fmt === 'toml') { let sec = ''; for (const l of text.split(/\r?\n/)) { const s = l.match(/^\s*\[([^\]]+)\]/); if (s) { sec = s[1].trim(); continue; } const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/); if (m) out[(sec ? sec + '.' : '') + m[1]] = m[2].replace(/^"(.*)"$/, '$1'); } }
  return out;
}

function read(server) {
  const sc = SCHEMAS[server.type]; if (!sc) return null;
  const rel = sc.file(server); const file = path.join(server.path, rel);
  const text = U.readText(file);
  const raw = text == null ? {} : readValues(sc.format, text);
  const val = f => (sc.format === 'json' ? getPath(raw.__json || {}, f.k) : raw[f.k]);
  const groups = sc.groups.map(([title, fields]) => ({ title, fields: fields.map(f => { const v = val(f); return { ...f, value: v === undefined ? null : f.t === 'bool' ? parseBool(v) : String(v), present: v !== undefined }; }) }));
  return { file, rel, exists: text != null, format: sc.format, groups };
}

function applyText(fmt, text, changes) {
  if (fmt === 'json') {
    const j = readValues('json', text || '{}').__json;
    for (const [k, v] of Object.entries(changes)) setPath(j, k, v);
    return JSON.stringify(j, null, 2) + '\n';
  }
  let t = text || '';
  if (fmt === 'properties') {
    const nl = t.includes('\r\n') ? '\r\n' : '\n';
    for (const [k, v] of Object.entries(changes)) {
      const re = new RegExp(`^(\\s*${escRe(k)}\\s*=).*$`, 'm');
      const sv = typeof v === 'boolean' ? boolOut(fmt, v) : String(v).replace(/\r?\n/g, ' ');
      t = re.test(t) ? t.replace(re, `$1${sv}`) : t + (t && !t.endsWith('\n') ? nl : '') + `${k}=${sv}${nl}`;
    }
    return t;
  }
  if (fmt === 'palworld') {
    if (!palInner(t)) t = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n';
    const r = palInner(t); const parts = palSplit(t.slice(r.start, r.end));
    const map = new Map(parts.map(p => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1)]; }));
    const quoted = new Set(['ServerName', 'ServerDescription', 'AdminPassword', 'ServerPassword', 'PublicIP', 'Region', 'BanListURL']);
    for (const [k, v] of Object.entries(changes)) map.set(k, typeof v === 'boolean' ? boolOut(fmt, v) : quoted.has(k) ? `"${String(v).replace(/"/g, '')}"` : String(v));
    return t.slice(0, r.start) + [...map].map(([k, v]) => `${k}=${v}`).join(',') + t.slice(r.end);
  }
  if (fmt === 'toml') {
    const lines = t.split(/\r?\n/);
    for (const [k, v] of Object.entries(changes)) {
      const [sec, key] = k.includes('.') ? [k.slice(0, k.lastIndexOf('.')), k.slice(k.lastIndexOf('.') + 1)] : ['', k];
      const sv = typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      let cur = ''; let done = false; let secEnd = -1;
      for (let i = 0; i < lines.length; i++) {
        const s = lines[i].match(/^\s*\[([^\]]+)\]/); if (s) { if (cur === sec && secEnd < 0) secEnd = i; cur = s[1].trim(); continue; }
        const m = lines[i].match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*?)(\s*#.*)?$/);
        if (m && cur === sec && m[2] === key) { lines[i] = `${m[1]}${m[2]}${m[3]}${sv}${m[5] || ''}`; done = true; break; }
      }
      if (!done) { const si = lines.findIndex(l => new RegExp(`^\\s*\\[${escRe(sec)}\\]`).test(l)); if (si < 0) lines.push(`[${sec}]`, `${key} = ${sv}`); else lines.splice(secEnd > si ? secEnd : lines.length, 0, `${key} = ${sv}`); }
    }
    return lines.join('\n');
  }
  throw new Error('Nieznany format');
}

function write(server, values) {
  const sc = SCHEMAS[server.type]; if (!sc) throw new Error('Ten serwer nie ma formularza konfiguracji.');
  const fields = new Map(sc.groups.flatMap(g => g[1]).map(f => [f.k, f]));
  const changes = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.get(k); if (!f) continue;
    if (f.t === 'bool') changes[k] = !!v;
    else if (f.t === 'number') { if (v === '' || v == null) continue; const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) throw new Error(`${f.l}: to nie jest liczba`); if (f.min != null && n < f.min) throw new Error(`${f.l}: minimum ${f.min}`); if (f.max != null && n > f.max) throw new Error(`${f.l}: maksimum ${f.max}`); changes[k] = sc.format === 'json' || sc.format === 'toml' ? n : String(v).replace(',', '.'); }
    else changes[k] = String(v ?? '');
  }
  const file = path.join(server.path, sc.file(server));
  const text = U.readText(file);
  if (text != null) fs.copyFileSync(file, file + '.bak');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, applyText(sc.format, text, changes));
  return { file, changed: Object.keys(changes).length };
}

module.exports = { read, write, applyText, readValues, SCHEMAS, supported: t => !!SCHEMAS[t] };
