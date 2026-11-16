// Analizator błędów (regułowy, bez AI): logi i raporty awarii → zrozumiałe wyjaśnienia i kroki naprawy
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('./util');

// ---------- indeks pakietów Java → mod ----------
function buildPackageIndex(modsDir) {
  const idx = [];
  for (const f of U.listFiles(modsDir).filter(x => /\.jar$/i.test(x))) {
    try {
      const zip = new AdmZip(f);
      const pk = new Map();
      let name = path.basename(f, '.jar');
      const fab = zip.getEntry('fabric.mod.json');
      if (fab) { try { const j = JSON.parse(fab.getData().toString('utf8')); name = j.name || j.id || name; } catch { /* */ } }
      const toml = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml');
      if (toml) { const m = toml.getData().toString('utf8').match(/displayName\s*=\s*"([^"]+)"/); if (m) name = m[1]; }
      for (const e of zip.getEntries()) {
        if (!e.entryName.endsWith('.class') || e.entryName.startsWith('META-INF')) continue;
        const parts = e.entryName.split('/'); parts.pop();
        if (parts.length < 2) continue;
        const key = parts.slice(0, Math.min(parts.length, 3)).join('.');
        pk.set(key, (pk.get(key) || 0) + 1);
      }
      for (const k of pk.keys()) idx.push({ prefix: k, mod: name, file: path.basename(f) });
    } catch { /* uszkodzony jar */ }
  }
  idx.sort((a, b) => b.prefix.length - a.prefix.length);
  return idx;
}
const IGNORED_PKG = /^(java|javax|jdk|sun|com\.sun|net\.minecraft|com\.mojang|net\.fabricmc|org\.quiltmc|net\.minecraftforge|net\.neoforged|cpw\.mods|org\.spongepowered|org\.apache|com\.google|io\.netty|it\.unimi|org\.lwjgl|org\.objectweb|kotlin|org\.slf4j|org\.bukkit|org\.spigotmc|io\.papermc|com\.destroystokyo|System|UnityEngine|Mono|BepInEx|HarmonyLib|MelonLoader|Il2Cpp)/;

function blameFromStack(text, pkgIndex) {
  const counts = new Map();
  const frames = [...text.matchAll(/^\s*at\s+([\w$.]+)\.[\w$<>]+\(/gm)].map(m => m[1]).slice(0, 400);
  for (const fr of frames) {
    if (IGNORED_PKG.test(fr)) continue;
    const hit = pkgIndex.find(p => fr.startsWith(p.prefix + '.') || fr === p.prefix);
    if (hit) counts.set(hit.mod, (counts.get(hit.mod) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------- reguły ----------
// Każda reguła: re (wyrażenie), level, f(m, text) → { title, why, fix, mod?, action? }
const R = [];
const rule = (id, re, level, f) => R.push({ id, re, level, f });

// Java / Minecraft
rule('java-version', /UnsupportedClassVersionError[^\n]*class file version (\d+)/, 'error', m => { const need = +m[1] - 44; return { title: `Mod lub serwer wymaga nowszej Javy (Java ${need})`, why: 'Program został zbudowany dla nowszej wersji Javy niż ta, która go uruchamia.', fix: `Zainstaluj Javę ${need} (np. Eclipse Temurin z adoptium.net) i wybierz ją w ustawieniach launchera lub serwera.` }; });
rule('java-requires', /(?:requires|needs) (?:Java|java) (\d+)/i, 'error', m => ({ title: `Potrzebna jest Java ${m[1]}`, why: 'Uruchomiona wersja Javy jest za stara dla tej wersji gry lub loadera.', fix: `Zainstaluj Javę ${m[1]} i ustaw ją w launcherze / ustawieniach serwera.` }));
rule('oom', /java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime|Could not reserve enough space for object heap/, 'error', () => ({ title: 'Zabrakło pamięci RAM dla gry', why: 'Gra lub serwer chciały użyć więcej pamięci, niż zostało przydzielone (albo komputer ma jej za mało).', fix: 'Zwiększ przydział RAM (np. do 6–8 GB w launcherze lub w ustawieniach serwera). Przy dużych paczkach modów zamknij inne programy. Nie przydzielaj więcej niż ~70% pamięci komputera.' }));
rule('fabric-missing', /Mod '([^']+)' \(([^)]+)\) [\d.\w+-]* requires (?:version [^ ]+ of |any version of |version ([^ ]+) or later of )?(?:mod )?'?([^',\n]+?)'? \(([\w-]+)\)?,? which is missing/g, 'error', m => ({ title: `Mod „${m[1]}” potrzebuje moda „${m[4] || m[5]}”, którego nie masz`, why: 'Niektóre mody działają tylko razem z innymi (bibliotekami).', fix: `Doinstaluj „${m[4] || m[5]}” w wersji pasującej do Twojej gry.`, mod: m[1], action: { type: 'modrinth-dep', modId: m[5] || m[4] } }));
rule('fabric-missing2', /requires (?:version [^ ]+ of |any version of )?([\w\s'-]+?) \(([\w-]+)\), which is missing!/g, 'error', m => ({ title: `Brakuje moda „${m[1].trim()}”`, why: 'Jeden z modów wymaga tej biblioteki, a nie ma jej w folderze mods.', fix: `Zainstaluj „${m[1].trim()}”.`, action: { type: 'modrinth-dep', modId: m[2] } }));
rule('fabric-wrongver', /Mod '([^']+)' \(([^)]+)\) [^\n]*requires version ([^ ]+) of (?:mod )?'?([^'(\n]+?)'? \(([\w-]+)\), but only the wrong version is present: ([^!\n]+)/g, 'error', m => ({ title: `„${m[1]}” wymaga innej wersji „${m[4].trim()}”`, why: `Masz zainstalowaną wersję ${m[6].trim()}, a mod potrzebuje ${m[3]}.`, fix: m[5] === 'minecraft' ? `Ten mod jest dla innej wersji gry. Pobierz wersję „${m[1]}” dla Twojej wersji Minecrafta.` : `Zaktualizuj lub zmień wersję „${m[4].trim()}”.`, mod: m[1], action: m[5] === 'minecraft' ? null : { type: 'modrinth-dep', modId: m[5] } }));
rule('fabric-breaks', /Mod '([^']+)' \(([^)]+)\)[^\n]* is incompatible with[^\n]*'([^']+)' \(([^)]+)\)/g, 'error', m => ({ title: `„${m[1]}” nie działa razem z „${m[3]}”`, why: 'Autorzy oznaczyli te mody jako niezgodne – razem psują grę.', fix: `Wyłącz jeden z nich (np. „${m[3]}”).`, mod: m[1] }));
rule('dup-mods', /DuplicateModsFoundException|Found duplicate mods|Duplicate mods found|Mod ID '([\w-]+)' from mod files: ([^\n]+)/, 'error', m => ({ title: 'Ten sam mod jest zainstalowany dwa razy', why: 'W folderze mods są dwie wersje tego samego moda – gra nie wie, której użyć.' + (m[2] ? ` Pliki: ${m[2]}` : ''), fix: 'Usuń starszą kopię (zostaw najnowszą). Użyj zakładki Zgodność, aby zobaczyć duplikaty.' }));
rule('mixin', /Mixin \[([\w.-]+?)(?:\.mixins?)?\.json:([\w.$]+)\] from mod ([\w-]+) failed|mixin\.injection\.throwables\.InvalidInjectionException[^\n]*?([\w-]+)\.mixins?\.json/g, 'error', m => ({ title: `Mod „${m[3] || m[4] || m[1]}” nie pasuje do gry lub innego moda`, why: 'Mod próbuje zmienić kod gry w miejscu, które wygląda inaczej – zwykle to zła wersja moda albo konflikt z innym modem zmieniającym to samo.', fix: `Zaktualizuj „${m[3] || m[4] || m[1]}” do wersji dla Twojej wersji gry. Jeśli to nie pomoże – wyłącz go i sprawdź, czy gra startuje.`, mod: m[3] || m[4] || m[1] }));
rule('client-on-server', /(?:Attempted to load class net\/minecraft\/client|Cannot load class net\.minecraft\.client|net\/minecraft\/client\/[\w/]+ for invalid dist DEDICATED_SERVER|invalid dist DEDICATED_SERVER)/, 'error', () => ({ title: 'Na serwerze jest mod przeznaczony tylko dla gracza (klienta)', why: 'Niektóre mody (np. minimapy, shadery, menu) działają tylko w grze, nie na serwerze.', fix: 'Usuń mody tylko-klienckie z folderu mods serwera. Zakładka Zgodność serwera wskaże, które to.' }));
rule('noclassdef', /(?:NoClassDefFoundError|ClassNotFoundException): ([\w/.$]+)/g, 'error', m => ({ title: 'Brakuje części wymaganej przez jeden z modów', why: `Mod odwołuje się do „${m[1].replace(/\//g, '.')}”, którego nie ma – zwykle oznacza to brakującą bibliotekę lub mod dla innej wersji gry.`, fix: 'Sprawdź zakładkę Zgodność – pokaże brakujące zależności. Upewnij się, że wszystkie mody są dla tej samej wersji gry i loadera.' }));
rule('nosuchmethod', /NoSuchMethodError: ['"]?([^'"\n]+)/g, 'error', m => ({ title: 'Mod jest dla innej wersji gry lub biblioteki', why: `Mod wywołuje funkcję, która nie istnieje w Twojej wersji („${m[1].slice(0, 120)}”).`, fix: 'Zaktualizuj mody (przycisk „Aktualizuj wszystko”) albo zmień je na wersje dla Twojej wersji gry.' }));
rule('forge-modloading', /Mod File: ([^\n]+)\n\s*Failure message: ([^\n]+)/g, 'error', m => ({ title: `Mod ${path.basename(m[1].trim())} nie wczytał się`, why: m[2].trim(), fix: 'Zaktualizuj ten mod lub usuń go, jeśli nie jest potrzebny.', mod: path.basename(m[1].trim()) }));
rule('forge-missing', /Missing or unsupported mandatory dependencies:([\s\S]*?)(?:\n\n|\n[A-Z])/g, 'error', m => { const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean); return { title: 'Brakuje wymaganych modów', why: lines.slice(0, 8).join('; '), fix: 'Doinstaluj wymienione mody w wersjach pasujących do gry.' }; });
rule('forge-modid-req', /Mod ID: '([\w-]+)', Requested by: '([\w-]+)', Expected range: '([^']+)', Actual version: '([^']+)'/g, 'error', m => ({ title: `„${m[2]}” wymaga „${m[1]}” w wersji ${m[3]}`, why: m[4] === '[MISSING]' ? `„${m[1]}” nie jest zainstalowany.` : `Masz wersję ${m[4]}.`, fix: `Zainstaluj właściwą wersję „${m[1]}”.`, mod: m[2], action: m[1] !== 'minecraft' && m[1] !== 'forge' && m[1] !== 'neoforge' ? { type: 'modrinth-dep', modId: m[1] } : null }));
rule('eula', /You need to agree to the EULA/, 'error', () => ({ title: 'Nie zaakceptowano licencji EULA', why: 'Serwer Minecraft nie wystartuje bez akceptacji licencji Mojang.', fix: 'Otwórz eula.txt w folderze serwera i zmień eula=false na eula=true.' }));
rule('paper-api', /Could not load '([^']+)' in folder '[^']+'[\s\S]{0,200}?(?:Unsupported API version ([\d.]+)|UnknownDependencyException: (?:Unknown\/missing dependency plugins: )?\[?([^\]\n]+))/g, 'error', m => ({ title: `Plugin ${path.basename(m[1])} się nie wczytał`, why: m[2] ? `Wymaga nowszego serwera (API ${m[2]}).` : `Brakuje pluginu: ${m[3]}.`, fix: m[2] ? 'Zaktualizuj serwer albo pobierz starszą wersję pluginu.' : `Dodaj plugin ${m[3]} do folderu plugins.`, mod: path.basename(m[1]) }));
rule('ticking', /Ticking (entity|block entity|world|player)[\s\S]{0,400}?(?:Entity Type: ([\w:]+)|Block type: ID #?([\w:]+)|Name: ([\w:]+))/, 'error', m => ({ title: `Gra wyłączyła się przez ${m[1] === 'entity' ? 'stworzenie / byt' : m[1] === 'block entity' ? 'blok' : 'świat'} ${m[2] || m[3] || m[4] || ''}`.trim(), why: 'Jeden obiekt w świecie powoduje błąd przy każdej aktualizacji gry. Zwykle pochodzi z moda.', fix: `Zaktualizuj mod dodający „${m[2] || m[3] || m[4] || 'ten obiekt'}”. Jeśli to nie pomoże, zrób kopię świata i usuń obiekt (np. poleceniem /kill) albo wyłącz mod.` }));
rule('render-gl', /(?:GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|OpenGL 3\.2 or higher|EXCEPTION_ACCESS_VIOLATION[\s\S]{0,300}(?:atio6axx|ig\d+icd|nvoglv))/, 'error', () => ({ title: 'Problem ze sterownikiem karty graficznej', why: 'Karta graficzna lub jej sterownik nie obsługują tego, czego wymaga gra, albo sterownik jest nieaktualny.', fix: 'Zaktualizuj sterownik karty graficznej ze strony producenta (NVIDIA / AMD / Intel). W laptopach ustaw grę na kartę dedykowaną.' }));
rule('access-violation', /EXCEPTION_ACCESS_VIOLATION|Segmentation fault|SIGSEGV/, 'warn', () => ({ title: 'Gra uległa awarii na poziomie systemu', why: 'Najczęściej przyczyną jest sterownik grafiki, nakładka (Discord/Overwolf/RivaTuner) albo mod z kodem natywnym.', fix: 'Zaktualizuj sterowniki, wyłącz nakładki i spróbuj uruchomić grę bez modów, dokładając je partiami.' }));

// .NET / Unity (BepInEx, MelonLoader, SMAPI, tModLoader, RimWorld)
rule('bep-missing-dep', /Could not load \[([^\]]+)\] because it has missing dependencies: ([^\n]+)/g, 'error', m => ({ title: `Mod „${m[1].replace(/\s[\d.]+$/, '')}” potrzebuje innego moda`, why: `Brakuje: ${m[2].trim()}.`, fix: `Zainstaluj brakującą paczkę (${m[2].trim()}) – w menedżerze Thunderstore lub przyciskiem poniżej.`, mod: m[1] }));
rule('bep-incompat', /Could not load \[([^\]]+)\] because it (?:is incompatible with|requires) ([^\n]+)/g, 'error', m => ({ title: `Mod „${m[1]}” nie może się wczytać`, why: m[2].trim(), fix: 'Usuń niezgodny mod albo zaktualizuj oba mody.', mod: m[1] }));
rule('bep-skip', /Skipping \[([^\]]+)\] because a newer version exists/g, 'warn', m => ({ title: `Mod „${m[1]}” jest zainstalowany dwa razy`, why: 'BepInEx wczytał tylko nowszą kopię.', fix: 'Usuń starszą kopię moda, aby uniknąć pomyłek.', mod: m[1] }));
rule('missingmethod', /(MissingMethodException|MissingFieldException|TypeLoadException): ([^\n]+)/g, 'error', m => ({ title: 'Mod jest przestarzały względem gry', why: `Gra została zaktualizowana i mod odwołuje się do czegoś, czego już nie ma (${m[2].trim().slice(0, 140)}).`, fix: 'Zaktualizuj mody („Aktualizuj wszystko”). Jeśli aktualizacji nie ma – poczekaj na nią albo wyłącz mod.' }));
rule('assembly', /Could not load file or assembly '([^',]+)/g, 'error', m => ({ title: `Brakuje biblioteki „${m[1]}”`, why: 'Mod potrzebuje dodatkowego pliku DLL (biblioteki), którego nie ma.', fix: `Zainstaluj mod-bibliotekę zawierającą ${m[1]} (sprawdź wymagania moda na jego stronie).` }));
rule('melon-incompat', /\[([^\]]+)\] is (?:incompatible|not compatible) with (?:the current )?(Game|game version|Unity|MelonLoader)/g, 'error', m => ({ title: `Mod „${m[1]}” nie pasuje do ${/melon/i.test(m[2]) ? 'wersji MelonLoadera' : 'tej wersji gry'}`, why: 'Autor oznaczył mod jako działający z inną wersją.', fix: 'Pobierz aktualną wersję moda.', mod: m[1] }));
rule('melon-deps', /- '([^']+)' is missing the following dependencies:\s*\n((?:\s+- [^\n]+\n?)+)/g, 'error', m => ({ title: `Mod „${m[1]}” potrzebuje innych modów`, why: 'Brakuje: ' + m[2].replace(/\s+-\s+/g, ', ').replace(/^, /, '').trim(), fix: 'Doinstaluj brakujące mody do folderu Mods.', mod: m[1] }));
rule('il2cpp-mono', /(?:Il2CppInterop|Il2Cpp)[^\n]*(?:not found|Could not load)|Mono\.Cecil[^\n]*Il2Cpp/, 'error', () => ({ title: 'Mod jest dla innej wersji gry (IL2CPP / Mono)', why: 'Gra ma dwie gałęzie (np. główną i „alternate”), a mody są kompilowane osobno dla każdej.', fix: 'Pobierz wersję moda dla swojej gałęzi gry lub przełącz gałąź w Steam (Właściwości → Wersje beta).' }));
rule('smapi-skip', /Skipped mods[\s\S]*?(?:\n\s+- ([^\n]+?) because ([^\n]+))+/g, 'error', m => ({ title: 'SMAPI pominął niektóre mody', why: `${m[1]} – ${m[2]}`, fix: 'Sprawdź listę w logu SMAPI; zwykle trzeba zaktualizować mod lub doinstalować zależność.' }));
rule('smapi-line', /^(?:\[[^\]\n]*\])?\s+- ([^\n]+?) because (it needs|it requires|it's no longer compatible|the mod is marked as|it has no|it requires a newer version)([^\n]*)/gm, 'error', m => ({ title: `SMAPI nie wczytał moda „${m[1]}”`, why: ({ 'it needs': 'Potrzebuje innych modów:', 'it requires': 'Wymaga:', "it's no longer compatible": 'Mod nie działa już z tą wersją gry.', 'the mod is marked as': 'Mod jest oznaczony jako', 'it has no': 'Mod jest niekompletny – brak', 'it requires a newer version': 'Wymaga nowszej wersji' }[m[2]] || m[2]) + m[3], fix: m[2] === 'it needs' ? 'Doinstaluj brakujące mody (np. z Nexus Mods).' : 'Zaktualizuj ten mod lub SMAPI.', mod: m[1] }));
rule('rimworld-dep', /\[([^\]]+)\] (?:requires|needs) ([^\n]+?) to be loaded/g, 'error', m => ({ title: `„${m[1]}” wymaga „${m[2]}”`, why: 'Brakuje moda-zależności albo jest wczytywany w złej kolejności.', fix: 'Włącz zależność i ustaw ją wyżej na liście modów.', mod: m[1] }));
rule('rimworld-xml', /XML error: ([^\n]+?) in file ([^\n]+)/g, 'warn', m => ({ title: 'Błąd w pliku moda RimWorld', why: `${m[1].slice(0, 120)} (${path.basename(m[2])})`, fix: 'Najczęściej mod jest dla innej wersji RimWorld – zaktualizuj go lub wyłącz.' }));
rule('tml-ref', /(?:Missing mod|The following mods are missing): ([^\n]+?) required by ([^\n]+)/g, 'error', m => ({ title: `Mod „${m[2]}” potrzebuje „${m[1]}”`, why: 'Zależność nie jest zainstalowana albo jest wyłączona.', fix: 'Zasubskrybuj i włącz zależność w Warsztacie.', mod: m[2] }));
rule('factorio-dep', /Failed to load mods: ([^\n]+)/g, 'error', m => ({ title: 'Factorio nie wczytało modów', why: m[1].trim(), fix: 'Włącz lub zaktualizuj wymienione mody (menu Mody w grze lub zakładka Zgodność).' }));
rule('pz-lua', /(?:ERROR: General[^\n]*)?(?:ExceptionLogger|LuaManager)[^\n]*?(?:attempted index|non-table|Object tried to call nil)[^\n]*?(\w+\.lua)/g, 'warn', m => ({ title: 'Błąd skryptu w modzie Project Zomboid', why: `Plik ${m[1]} wywołał błąd – mod może być niezgodny z wersją gry lub innym modem.`, fix: 'Sprawdź, który mod zawiera ten plik, i zaktualizuj go lub wyłącz.' }));

// Serwery
rule('port', /(?:Address already in use|BindException|Failed to bind to port|Only one usage of each socket address|EADDRINUSE|could not bind|Port [\d]+ is already in use|FAILED TO BIND TO PORT)/i, 'error', () => ({ title: 'Port serwera jest już zajęty', why: 'Inny program (często drugi uruchomiony serwer) używa tego samego portu.', fix: 'Zatrzymaj drugi serwer albo zmień port w ustawieniach serwera.' }));
rule('perm', /(?:Permission denied|Access is denied|UnauthorizedAccessException|EACCES|EPERM)/, 'error', () => ({ title: 'Brak uprawnień do pliku lub folderu', why: 'System nie pozwolił zapisać/odczytać pliku – folder może być chroniony (np. Program Files) albo plik jest otwarty w innym programie.', fix: 'Przenieś serwer do folderu użytkownika (np. Dokumenty), zamknij programy używające plików, ewentualnie dodaj wyjątek w antywirusie.' }));
rule('disk', /(?:No space left on device|There is not enough space on the disk|ENOSPC)/, 'error', () => ({ title: 'Brak miejsca na dysku', why: 'Dysk jest pełny, więc nie da się zapisać plików.', fix: 'Zwolnij miejsce (usuń stare kopie zapasowe, logi) i spróbuj ponownie.' }));
rule('steam-login', /(?:Login Failure: (?:Invalid Password|Rate Limit Exceeded|No Connection)|ERROR! Failed to install app '\d+' \(No subscription\)|Missing configuration|Invalid Platform)/, 'error', m => ({ title: 'SteamCMD nie mógł pobrać plików', why: /subscription/.test(m[0]) ? 'To konto nie posiada gry wymaganej do pobrania serwera.' : /Rate Limit/.test(m[0]) ? 'Zbyt wiele prób logowania.' : /Invalid Password/.test(m[0]) ? 'Nieprawidłowe hasło Steam.' : 'Problem z połączeniem lub konfiguracją SteamCMD.', fix: /Rate/.test(m[0]) ? 'Odczekaj 30–60 minut i spróbuj ponownie.' : 'Sprawdź login/hasło i połączenie z internetem, potem kliknij Aktualizuj.' }));
rule('steam-disk', /Error! App '\d+' state is 0x(?:202|602|402)/, 'error', () => ({ title: 'SteamCMD przerwał instalację', why: 'Najczęściej brak miejsca na dysku albo problem z zapisem plików.', fix: 'Zwolnij miejsce na dysku i kliknij Aktualizuj ponownie.' }));
rule('oxide-compile', /Error while compiling:? (\w+)(?:\.cs)?(?: - | )?([^\n]*)/g, 'error', m => ({ title: `Plugin Rust „${m[1]}” się nie kompiluje`, why: m[2] ? `Szczegóły: ${m[2].trim().slice(0, 160)}` : 'Kod pluginu nie pasuje do aktualnej wersji Rusta lub Oxide.', fix: 'Pobierz najnowszą wersję pluginu z umod.org / codefling. Po aktualizacji Rusta zainstaluj ponownie Oxide/Carbon.', mod: m[1] }));
rule('oxide-missing', /(\w+) (?:is referencing|requires) (?:the )?(\w+) plugin which is not loaded/gi, 'error', m => ({ title: `Plugin „${m[1]}” wymaga pluginu „${m[2]}”`, why: 'Zależność nie jest zainstalowana.', fix: `Dodaj ${m[2]}.cs do folderu pluginów.`, mod: m[1] }));
rule('fivem-res', /Couldn't (?:start|find) resource ([\w-]+)/g, 'error', m => ({ title: `FiveM nie znalazł zasobu „${m[1]}”`, why: 'server.cfg próbuje uruchomić zasób, którego nie ma w folderze resources (albo ma inną nazwę folderu).', fix: `Dodaj zasób ${m[1]} lub usuń linię „ensure ${m[1]}” z server.cfg.` }));
rule('fivem-license', /(?:No license key was specified|license key[^\n]*(?:invalid|not valid))/i, 'error', () => ({ title: 'Brak lub zły klucz licencji FiveM', why: 'Serwer FiveM wymaga darmowego klucza z portal.cfx.re.', fix: 'Wygeneruj klucz na portal.cfx.re i wpisz go w server.cfg (sv_licenseKey).' }));
rule('sm-fail', /\[SM\] (?:Failed to load plugin|Unable to load plugin) "([^"]+)": ([^\n]+)/g, 'error', m => ({ title: `Plugin SourceMod „${m[1]}” się nie wczytał`, why: m[2].trim(), fix: /native/i.test(m[2]) ? 'Plugin wymaga rozszerzenia lub innego pluginu – doinstaluj je.' : 'Zaktualizuj plugin lub SourceMod.', mod: m[1] }));
rule('dayz-key', /(?:Player [^\n]* kicked[^\n]*Modified data|signature check|Wrong signature for file)([^\n]*)/i, 'error', () => ({ title: 'Gracze są wyrzucani z powodu niezgodnych modów (podpisy)', why: 'Serwer nie ma klucza .bikey jednego z modów albo gracz ma inną wersję moda.', fix: 'Skopiuj klucze .bikey wszystkich modów do folderu keys serwera i zaktualizuj mody na serwerze.' }));
rule('arma-dep', /(?:Dependency|Addon) '?([^'\n]+?)'? (?:not found|is missing|cannot be loaded)/gi, 'error', m => ({ title: `Brakuje dodatku „${m[1]}”`, why: 'Jeden z modów wymaga innego moda z Warsztatu.', fix: 'Dodaj brakujący mod do listy mods w config.json.' }));
rule('vcredist', /(?:VCRUNTIME140(?:_1)?\.dll|MSVCP140\.dll|api-ms-win-crt[^\s]*\.dll)[^\n]*(?:not found|was not found|missing)/i, 'error', () => ({ title: 'Brakuje pakietu Microsoft Visual C++', why: 'Gra lub serwer potrzebuje bibliotek systemowych Microsoft, których nie ma na komputerze.', fix: 'Zainstaluj „Microsoft Visual C++ Redistributable 2015–2022 (x64)” ze strony Microsoft i uruchom ponownie.' }));
rule('dotnet', /(?:You must install or update \.NET|The framework 'Microsoft\.NETCore\.App', version '([\d.]+)'|It was not possible to find any compatible framework version)/, 'error', m => ({ title: `Brakuje środowiska .NET${m[1] ? ' ' + m[1] : ''}`, why: 'Program wymaga środowiska Microsoft .NET.', fix: `Zainstaluj .NET${m[1] ? ' ' + m[1].split('.')[0] : ''} Runtime ze strony dotnet.microsoft.com.` }));

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

function analyzeText(text, { pkgIndex = [] } = {}) {
  const findings = [];
  const seen = new Set();
  for (const r of R) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
    let m; let n = 0;
    while ((m = re.exec(text)) && n < 12) {
      n++;
      const f = r.f(m, text);
      const key = r.id + '|' + f.title;
      const dupAction = f.action && f.action.modId && findings.some(x => x.action && x.action.modId && x.action.modId.toLowerCase() === f.action.modId.toLowerCase());
      if (!seen.has(key) && !dupAction) {
        seen.add(key);
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const lineEnd = text.indexOf('\n', m.index + m[0].length);
        findings.push({ level: r.level, rule: r.id, ...f, evidence: text.slice(lineStart, lineEnd < 0 ? undefined : Math.min(lineEnd, lineStart + 400)).trim() });
      }
      if (!r.re.flags.includes('g')) break;
    }
  }
  // Minecraft crash report: podejrzane mody
  const sus = text.match(/Suspected Mods?:\s*([^\n]+(?:\n\t[^\n]+)*)/);
  if (sus && !/None|Unknown/i.test(sus[1].split('\n')[0])) {
    const mods = sus[1].split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
    findings.push({ level: 'error', rule: 'suspected', title: `Najbardziej podejrzany mod: ${mods[0].replace(/\s*\(.*$/, '')}`, why: 'Raport awarii Minecrafta wskazuje ten mod jako źródło problemu' + (mods.length > 1 ? ` (także: ${mods.slice(1).join(', ')})` : '') + '.', fix: 'Zaktualizuj ten mod. Jeśli problem wraca – wyłącz go i zgłoś błąd autorowi, dołączając raport.', mod: mods[0] });
  }
  const desc = text.match(/^Description: ([^\n]+)/m);
  // winowajca ze śladu stosu
  if (pkgIndex.length) {
    const blame = blameFromStack(text, pkgIndex);
    if (blame.length) findings.push({ level: findings.some(f => f.level === 'error') ? 'warn' : 'error', rule: 'stack', title: `W śladzie błędu najczęściej pojawia się mod „${blame[0][0]}”`, why: `Kod tego moda wystąpił ${blame[0][1]}× w miejscu awarii${blame[1] ? `, a także „${blame[1][0]}” (${blame[1][1]}×)` : ''}. To mocna wskazówka, że to on powoduje problem.`, fix: `Zaktualizuj „${blame[0][0]}” albo tymczasowo go wyłącz i sprawdź, czy gra się uruchamia.`, mod: blame[0][0] });
  }
  if (!findings.length && desc) findings.push({ level: 'warn', rule: 'desc', title: 'Gra zgłosiła awarię', why: `Opis z raportu: „${desc[1]}”. Nie rozpoznano typowej przyczyny.`, fix: 'Spróbuj zaktualizować mody i loader. Jeśli to nie pomoże, wyłączaj mody partiami (połowa na raz), aż znajdziesz winowajcę.' });
  // ogólna liczba błędów
  const errCount = (text.match(/\b(ERROR|FATAL|Exception)\b/g) || []).length;
  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return { findings, stats: { lines: text.split('\n').length, errorLines: errCount } };
}

function headline(findings) {
  const e = findings.filter(f => f.level === 'error');
  if (!findings.length) return { tone: 'ok', text: 'Nie znaleziono znanych problemów w tym logu.', sub: 'Jeśli gra nadal się wyłącza, wybierz inny log (np. raport awarii) albo uruchom sprawdzanie zgodności modów.' };
  if (!e.length) return { tone: 'warn', text: 'Gra działa, ale log zawiera ostrzeżenia.', sub: 'Nie są krytyczne, ale warto je przejrzeć.' };
  const top = e[0];
  return { tone: 'error', text: top.title, sub: e.length > 1 ? `Znaleziono ${e.length} problemów. Zacznij od pierwszego – często pozostałe są jego skutkiem.` : 'To najprawdopodobniej główna przyczyna.' };
}

// Streszczenie raportu zgodności po ludzku
function summarizeReport(rep) {
  const errs = rep.issues.filter(i => i.level === 'error');
  const warns = rep.issues.filter(i => i.level === 'warn');
  const fixable = rep.issues.filter(i => i.action);
  let text, tone;
  if (!errs.length && !warns.length) { tone = 'ok'; text = 'Wszystko wygląda dobrze – mody powinny ze sobą współpracować.'; }
  else if (!errs.length) { tone = 'warn'; text = `Gra powinna działać, ale jest ${warns.length} rzeczy, na które warto zwrócić uwagę.`; }
  else { tone = 'error'; text = errs.length === 1 ? 'Jest jeden problem, który może zepsuć grę.' : `Jest ${errs.length} problemów, które mogą zepsuć grę.`; }
  const groups = {};
  for (const i of errs) { const k = /wymaga|potrzebuje|brak/i.test(i.title) ? 'missing' : /dla .*profil|loader|IL2CPP|Mono|Forge|Fabric/i.test(i.title) ? 'wrongtype' : /wersj|Minecraft \d|starszy|nowszy/i.test(i.title) ? 'version' : /Zduplikowany|dwukrotnie|×/i.test(i.title) ? 'dup' : 'other'; (groups[k] = groups[k] || []).push(i); }
  const steps = [];
  if (groups.missing) steps.push(`Doinstaluj brakujące mody (${groups.missing.length}).`);
  if (groups.wrongtype) steps.push(`Wymień mody przeznaczone dla innego loadera lub wersji gry (${groups.wrongtype.length}).`);
  if (groups.version) steps.push(`Zaktualizuj mody niepasujące do wersji gry (${groups.version.length}).`);
  if (groups.dup) steps.push('Usuń zduplikowane mody.');
  if (groups.other) steps.push(`Przejrzyj pozostałe błędy (${groups.other.length}).`);
  return { tone, text, steps, fixable: fixable.length };
}

// ---------- gdzie szukać logów ----------
function newest(files) { return files.filter(U.isFile).map(f => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t).map(x => x.f); }
function logCandidates({ gameId, root, docs = [], appData, localLow }) {
  const c = [];
  const add = (label, file) => { if (file && U.isFile(file)) c.push({ label, path: file, mtime: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }); };
  if (!root) return c;
  switch (gameId) {
    case 'minecraft':
      newest(U.listFiles(path.join(root, 'crash-reports'), ['.txt'])).slice(0, 3).forEach(f => add('Raport awarii', f));
      add('Ostatni log gry', path.join(root, 'logs', 'latest.log'));
      add('Log debugowania', path.join(root, 'logs', 'debug.log'));
      newest(U.listFiles(root).filter(f => /hs_err_pid\d+\.log$/.test(f))).slice(0, 1).forEach(f => add('Awaria Javy', f));
      break;
    case 'lethalcompany': case 'repo': case 'contentwarning':
      add('Log BepInEx', path.join(root, 'BepInEx', 'LogOutput.log')); add('Log BepInEx', path.join(root, 'BepInEx', 'LogOutput.txt')); break;
    case 'schedule1': add('Log MelonLoadera', path.join(root, 'MelonLoader', 'Latest.log')); break;
    case 'sotf': add('Log RedLoadera', path.join(root, '_RedLoader', 'Latest.log')); break;
    case 'stardew': add('Log SMAPI', path.join(appData, 'StardewValley', 'ErrorLogs', 'SMAPI-latest.txt')); add('Awaria SMAPI', path.join(appData, 'StardewValley', 'ErrorLogs', 'SMAPI-crash.txt')); break;
    case 'rimworld': add('Log gry (Player.log)', path.join(localLow, 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Player.log')); break;
    case 'factorio': add('Log Factorio', path.join(appData, 'Factorio', 'factorio-current.log')); add('Log Factorio', path.join(root, 'factorio-current.log')); break;
    case 'projectzomboid': add('Konsola gry', path.join(U.home(), 'Zomboid', 'console.txt')); break;
    case 'terraria': for (const d of docs) { add('Log tModLoadera', path.join(d, 'My Games', 'Terraria', 'tModLoader', 'Logs', 'client.log')); } break;
    case 'dst': for (const d of docs) add('Log klienta', path.join(d, 'Klei', 'DoNotStarveTogether', 'client_log.txt')); break;
    case 'skyrimse': for (const d of docs) { add('Log SKSE', path.join(d, 'My Games', 'Skyrim Special Edition', 'SKSE', 'skse64.log')); newest(U.listFiles(path.join(d, 'My Games', 'Skyrim Special Edition', 'SKSE'), ['.log']).filter(f => /crash/i.test(f))).slice(0, 2).forEach(f => add('Raport awarii', f)); } break;
    case 'fallout4': for (const d of docs) { add('Log F4SE', path.join(d, 'My Games', 'Fallout4', 'F4SE', 'f4se.log')); newest(U.listFiles(path.join(d, 'My Games', 'Fallout4', 'F4SE'), ['.log']).filter(f => /crash/i.test(f))).slice(0, 2).forEach(f => add('Raport awarii', f)); } break;
    case 'sevendays': newest(U.listFiles(path.join(appData, '7DaysToDie', 'logs'), ['.txt', '.log'])).slice(0, 2).forEach(f => add('Log gry', f)); break;
    case 'garrysmod': add('Konsola', path.join(root, 'garrysmod', 'console.log')); break;
    case 'gta5': add('Log ScriptHookV', path.join(root, 'ScriptHookV.log')); add('Log SHVDN', path.join(root, 'ScriptHookVDotNet.log')); add('Log ASI Loadera', path.join(root, 'asiloader.log')); break;
  }
  return c;
}

function readTail(file, max = 3 * 1024 * 1024) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  const len = Math.min(st.size, max); const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
  return buf.toString('utf8');
}

module.exports = { analyzeText, headline, summarizeReport, buildPackageIndex, blameFromStack, logCandidates, readTail, RULE_COUNT: () => R.length };
