// Skaner bezpieczeństwa modów: szuka w plikach .jar/.dll/.lua/.js/.cs/.py śladów złośliwego kodu
// (kradzież tokenów i haseł, pobieranie i uruchamianie programów, keyloggery, znane backdoory i sygnatury).
// To heurystyka – wynik „podejrzany” nie musi oznaczać wirusa, ale warto sprawdzić źródło moda.
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('../util');

// poziom: danger (prawie na pewno złośliwe), warn (podejrzane), info (warto wiedzieć)
const R = (id, level, title, test, detail) => ({ id, level, title, test, detail });
const has = (...s) => t => s.every(x => (x instanceof RegExp ? x.test(t) : t.includes(x)));
const any = (...s) => t => s.some(x => (x instanceof RegExp ? x.test(t) : t.includes(x)));

const SIGNATURES = [
  // znane kampanie
  R('fractureiser', 'danger', 'Sygnatura złośliwego oprogramowania fractureiser', any('dev/neko/nekoclient', 'files-8ie.pages.dev', '85.217.144.130', '107.189.3.101', 'skyrage'), 'Znany wirus rozprzestrzeniany przez mody Minecrafta w 2023 r. – kradnie konta i hasła. Usuń mod i przeskanuj komputer antywirusem.'),
  R('fivem-cipher', 'danger', 'Znany backdoor FiveM (Cipher / panel zdalnego dostępu)', any(/cipher-panel\.\w+/i, /ciphercheats/i, /keyx\.club/i, /dark-utilities\.\w+/i, /thedreamoffivem/i, /\bfivemsecurity\.\w+\/backdoor/i), 'Zasoby z tym kodem dają obcym pełną kontrolę nad serwerem (zwykle pochodzą z „leaków”).'),
];
const RULES = {
  java: [
    ...SIGNATURES,
    R('webhook', 'danger', 'Wysyła dane na webhook Discorda', any('discord.com/api/webhooks', 'discordapp.com/api/webhooks', 'ptb.discord.com/api/webhooks', 'canary.discord.com/api/webhooks'), 'Mody prawie nigdy nie potrzebują webhooka – to typowy sposób wysyłania skradzionych danych.'),
    R('token', 'danger', 'Dostęp do tokenów Discorda / przeglądarek', any('Local Storage/leveldb', 'Local Storage\\leveldb', 'Login Data', 'discord/Local Storage', 'Network\\Cookies', 'Network/Cookies'), 'Odczyt plików, w których Discord i przeglądarki trzymają sesje i hasła.'),
    R('session', 'danger', 'Odczyt sesji konta Minecraft połączony z wysyłaniem w sieć', t => /getSessionID|func_111286_b|getAccessToken|field_148258_c|launcher_accounts|launcher_profiles/.test(t) && /java\/net\/(URL|HttpURLConnection)|HttpClient|okhttp/.test(t), 'Mod czyta token konta i ma kod sieciowy – tak działają stealery kont.'),
    R('exec', 'warn', 'Uruchamia zewnętrzne programy', any('java/lang/ProcessBuilder', has('java/lang/Runtime', 'exec')), 'Może uruchamiać polecenia systemu. Niektóre mody robią to legalnie (np. otwieranie folderu), ale warto sprawdzić.'),
    R('loader', 'warn', 'Pobiera i wczytuje kod z internetu', t => /java\/net\/URLClassLoader|defineClass/.test(t) && /https?:\/\/(?!maven|repo|github|raw\.githubusercontent|cdn\.modrinth|edge\.forgecdn)[\w.-]+\.[a-z]{2,}/i.test(t), 'Kod wczytywany w trakcie gry z nieznanego adresu omija sprawdzenie przed instalacją.'),
    R('native', 'info', 'Zawiera biblioteki natywne (.dll/.so)', t => /\.(dll|so|dylib)\b/.test(t) && /System\.load|System\.loadLibrary|java\/lang\/System.*load/.test(t), 'Typowe dla modów graficznych i dźwiękowych, ale taki kod nie podlega ograniczeniom Javy.'),
  ],
  native: [
    ...SIGNATURES,
    R('webhook', 'danger', 'Wysyła dane na webhook Discorda', any('discord.com/api/webhooks', 'discordapp.com/api/webhooks')),
    R('token', 'danger', 'Dostęp do tokenów Discorda / haseł przeglądarek', any('Local Storage\\leveldb', 'Local State', 'Login Data', '\\Google\\Chrome\\User Data', '\\discord\\Local Storage')),
    R('keylog', 'danger', 'Przechwytuje klawiaturę w całym systemie', has('SetWindowsHookEx', any('WH_KEYBOARD_LL', 'GetAsyncKeyState')), 'Globalny hak klawiatury – typowe dla keyloggerów (choć używają go też nakładki).'),
    R('download', 'warn', 'Pobiera i uruchamia pliki', has(any('URLDownloadToFile', 'WinHttpOpen', 'InternetOpenUrl'), any('ShellExecute', 'CreateProcess', 'WinExec')), 'Pobieranie połączone z uruchamianiem programów.'),
    R('ps', 'warn', 'Uruchamia ukryte polecenia PowerShell / cmd', any(/powershell(\.exe)?\s+-(e|enc|encodedcommand)\b/i, /-WindowStyle\s+Hidden/i, 'cmd.exe /c start')),
    R('inject', 'info', 'Wstrzykuje kod do innych procesów', has('VirtualAllocEx', 'WriteProcessMemory', 'CreateRemoteThread'), 'Używane przez niektóre loadery modów, ale też przez złośliwe programy.'),
  ],
  lua: [
    ...SIGNATURES,
    R('remote-code', 'danger', 'Pobiera kod z internetu i go wykonuje', t => /PerformHttpRequest|http\.Fetch|HTTP\s*\(/.test(t) && /\b(load|loadstring|RunString|CompileString|RunStringEx)\s*\(/.test(t), 'Klasyczny backdoor: serwer zdalny może wykonać dowolny kod na Twoim serwerze.'),
    R('obfuscated', 'warn', 'Kod jest zaciemniony', t => (t.match(/\\x[0-9a-f]{2}/gi) || []).length > 120 || (t.match(/\\\d{2,3}/g) || []).length > 200 || /string\.char\((\s*\d+\s*,){60,}/.test(t) || /[A-Za-z0-9+/]{1500,}={0,2}/.test(t), 'Uczciwe zasoby rzadko ukrywają kod. Zaciemnianie to częsty sposób na ukrycie backdoora.'),
    R('shell', 'warn', 'Uruchamia polecenia systemu', any(/\bos\.execute\s*\(/, /\bio\.popen\s*\(/), 'Skrypt może uruchamiać programy na komputerze, na którym działa serwer.'),
    R('webhook', 'warn', 'Wysyła dane na webhook Discorda', any('discord.com/api/webhooks', 'discordapp.com/api/webhooks'), 'Często legalne (logi), ale sprawdź, jakie dane są wysyłane.'),
    R('runstring', 'info', 'Wykonuje kod z tekstu', any(/\bRunString\s*\(/, /\bCompileString\s*\(/, /\bloadstring\s*\(/), 'Samo w sobie nie jest groźne, ale w połączeniu z siecią bywa backdoorem.'),
  ],
  script: [
    ...SIGNATURES,
    R('webhook', 'danger', 'Wysyła dane na webhook Discorda', t => /discord(app)?\.com\/api\/webhooks/.test(t) && /(leveldb|Login Data|token|password|cookies)/i.test(t)),
    R('token', 'danger', 'Dostęp do tokenów i haseł', any('Local Storage\\\\leveldb', 'Local Storage/leveldb', 'Login Data', 'Network\\\\Cookies')),
    R('evalb64', 'warn', 'Wykonuje zakodowany kod', any(/eval\s*\(\s*(atob|Buffer\.from)\s*\(/, /exec\s*\(\s*base64\.b64decode/, /exec\s*\(\s*(compile|marshal\.loads|zlib\.decompress)/, /Assembly\.Load\s*\(\s*Convert\.FromBase64String/)),
    R('exec', 'warn', 'Uruchamia programy', any(/child_process['"]?\)?\.(exec|spawn)/, /\bos\.system\s*\(/, /subprocess\.(Popen|call|run)\s*\(/, /Process\.Start\s*\(/), 'Może być legalne, ale warto sprawdzić, co jest uruchamiane.'),
    R('download', 'warn', 'Pobiera pliki z internetu i zapisuje je na dysku', t => /(DownloadFile|urlretrieve|WebClient\(\)\.Download|fetch\(|requests\.get)/.test(t) && /(\.exe|\.bat|\.ps1|\.dll)['"]/.test(t)),
  ],
};
const KIND = f => { const e = path.extname(f).toLowerCase(); if (['.jar', '.zip', '.litemod'].includes(e)) return 'jar'; if (['.dll', '.exe', '.asi', '.so'].includes(e)) return 'native'; if (['.lua', '.luac'].includes(e)) return 'lua'; if (['.js', '.mjs', '.cs', '.py', '.ps1', '.bat', '.vbs'].includes(e)) return 'script'; return null; };

function scanText(text, kind) {
  const out = [];
  for (const r of RULES[kind] || []) { try { if (r.test(text)) out.push({ id: r.id, level: r.level, title: r.title, detail: r.detail || null }); } catch { /* */ } }
  return out;
}
const MAX_FILE = 64 * 1024 * 1024;
// skan jednego pliku; zwraca listę znalezisk z miejscem (plik w archiwum)
function scanFile(file) {
  const kind = KIND(file); if (!kind) return [];
  let st; try { st = fs.statSync(file); } catch { return []; }
  if (st.size > MAX_FILE) return [{ id: 'big', level: 'info', title: 'Plik za duży do przeskanowania', where: path.basename(file) }];
  const out = [];
  const add = (list, where) => { for (const f of list) if (!out.some(o => o.id === f.id)) out.push({ ...f, where }); };
  if (kind === 'jar') {
    let zip; try { zip = new AdmZip(file); } catch { return [{ id: 'broken', level: 'info', title: 'Uszkodzone archiwum – nie można przeskanować', where: path.basename(file) }]; }
    let all = ''; const nested = [];
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const n = e.entryName;
      if (/\.(class|json|txt|properties|cfg|toml|kts?|groovy)$/i.test(n) || /^META-INF\//i.test(n)) { try { all += n + '\n' + e.getData().toString('latin1') + '\n'; } catch { /* */ } if (all.length > 40e6) break; }
      else if (/\.(dll|exe|so)$/i.test(n)) { all += n + '\n'; try { add(scanText(e.getData().toString('latin1'), 'native'), n); } catch { /* */ } }
      else if (/\.jar$/i.test(n)) nested.push(e);
    }
    add(scanText(all, 'java'), path.basename(file));
    for (const e of nested.slice(0, 20)) { try { const z2 = new AdmZip(e.getData()); let t = ''; for (const x of z2.getEntries()) if (/\.class$/i.test(x.entryName)) t += x.getData().toString('latin1'); add(scanText(t, 'java'), e.entryName); } catch { /* */ } }
    return out;
  }
  let text; try { text = fs.readFileSync(file).toString(kind === 'native' ? 'latin1' : 'utf8'); } catch { return []; }
  if (kind === 'native') text += '\n' + Buffer.from(text, 'latin1').toString('utf16le');
  add(scanText(text, kind), path.basename(file));
  return out;
}
// skan modów z raportu (pliki i foldery); onProgress(i, n)
function scanMods(mods, { onProgress } = {}) {
  const results = [];
  const items = mods.filter(m => m.file && U.exists(m.file));
  items.forEach((m, i) => {
    const files = U.isDir(m.file) ? U.walk(m.file, { maxFiles: 4000, filter: r => !!KIND(r) }).map(r => path.join(m.file, r)) : [m.file];
    const found = [];
    for (const f of files) for (const x of scanFile(f)) found.push({ ...x, file: f, where: U.isDir(m.file) ? path.relative(m.file, f) + (x.where && x.where !== path.basename(f) ? ' → ' + x.where : '') : x.where });
    const level = found.some(f => f.level === 'danger') ? 'danger' : found.some(f => f.level === 'warn') ? 'warn' : found.length ? 'info' : 'ok';
    results.push({ name: m.name, file: m.file, key: m.key, level, findings: found, scanned: files.length });
    if (onProgress) onProgress(i + 1, items.length);
  });
  return { results, summary: { scanned: results.length, danger: results.filter(r => r.level === 'danger').length, warn: results.filter(r => r.level === 'warn').length, ok: results.filter(r => r.level === 'ok' || r.level === 'info').length } };
}
// do raportu ze sprawdzania: problemy w formacie Report
function toIssues(res) {
  const out = [];
  for (const r of res.results) for (const f of r.findings) if (f.level !== 'info') out.push({ level: f.level === 'danger' ? 'error' : 'warn', title: `${r.name}: ${f.title}`, mod: r.key || r.file, detail: [f.detail, f.where ? 'Miejsce: ' + f.where : ''].filter(Boolean).join('\n'), fix: f.level === 'danger' ? 'Nie uruchamiaj gry z tym modem. Usuń go i pobierz z oficjalnego źródła (Modrinth, CurseForge, Nexus, Thunderstore).' : 'Sprawdź, skąd pochodzi mod i czy ta funkcja jest opisana przez autora.' });
  return out;
}

module.exports = { scanFile, scanMods, scanText, toIssues, RULES, KIND };
