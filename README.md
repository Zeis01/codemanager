# CodeManager

Menedżer modów, serwerów i edytor konfiguracji dla gier – w zielonym motywie „Sosnowy las”.

## Uruchomienie

Gotowa wersja: `CodeManager-Setup-x.y.z.exe` (instalator), `CodeManager-Portable-x.y.z.exe` albo `CodeManager-x.y.z-win-x64.zip` (rozpakuj i uruchom `CodeManager.exe`).

Ze źródeł (wymaga Node.js 20+):

```
npm install
npm start          # uruchomienie
npm test           # 71 testów: parsery, checkery, funkcje 1.1 i updater
npm run dist       # instalator, portable i zip (bez publikacji)
npm run release    # to samo + publikacja wydania na GitHub (GH_TOKEN)
```

## Co potrafi

**Znalezione gry** – wykrywa gry z bibliotek Steam (libraryfolders.vdf + appmanifest), Epic Games, Rockstar Launcher, skanuje typowe foldery na dyskach oraz instancje Minecrafta z oficjalnego launchera, Prism/MultiMC, CurseForge, Modrinth App i ATLauncher. Złą lokalizację można zmienić lub uruchomić wykrywanie ponownie.

**Sprawdzanie zgodności modów** (offline, z metadanych modów):

| Gra | Co jest sprawdzane |
|---|---|
| Minecraft (Fabric, Quilt, Forge, NeoForge) | loader, wersja gry i loadera, zależności z zakresami wersji, `breaks`/`incompatible`, duplikaty, mody tylko-klient na serwerze, jar-in-jar; online: Modrinth (aktualizacje, oznaczenie wersji) |
| Project Zomboid | `require`, `incompatible`, Build 41 vs 42, kolejność ładowania, duplikaty ID |
| Euro Truck Simulator 2 | `compatible_versions` w manifest.sii / versions.sii vs wersja gry |
| Sons of the Forest | RedLoader, manifesty, zależności |
| Lethal Company, R.E.P.O., Content Warning | BepInEx 5, zależności Thunderstore z wersjami, duplikaty DLL, log BepInEx, profile r2modman/Thunderstore App/Gale; online: aktualizacje z Thunderstore |
| Schedule I | MelonLoader, mody IL2CPP vs Mono względem gałęzi gry, mody BepInEx w złym folderze |
| People Playground | `GameVersion`, brakujące skrypty, duplikaty |
| Transport Fever 2 | mod.lua, nazwa folderu z wersją, nadpisywanie tych samych plików |
| Hearts of Iron IV | `supported_version`, zależności, aktywne mody (dlc_load.json), konflikty plików |
| Garry's Mod | konflikty plików Lua/zasobów między addonami (foldery i .gma) |
| Don't Starve Together | `dst_compatible`, `api_version`, `mod_dependencies`, flagi klient/serwer |
| GTA V (Legacy i Enhanced) | ScriptHookV vs build gry, ASI Loader, ScriptHookVDotNet, OpenIV |
| Terraria (tModLoader) | wersja tModLoadera w .tmod, `modReferences`, enabled.json |

Pominięte celowo: **Brick Rigs** i **Ready or Not** – ich mody nie mają metadanych pozwalających rzetelnie sprawdzić zgodność.

**Instalatory** – BepInEx 5, MelonLoader, RedLoader, Fabric, Quilt, Forge, NeoForge (z oficjalnych źródeł, z kopią zapasową nadpisywanych plików); tModLoader i Script Hook V przez oficjalne strony.

**Serwery** – Minecraft (Paper, Purpur, Vanilla, Fabric, Quilt, Forge, NeoForge), Arma Reforger, Rust, CS2, DayZ, FiveM, MTA, Terraria (TShock), Valheim, Project Zomboid, Team Fortress 2, BeamMP. Instalacja przez SteamCMD lub oficjalne API, konsola na żywo z wysyłaniem poleceń, aktualizacje, frameworki pluginów (Oxide, Carbon, Metamod, CounterStrikeSharp, SourceMod, BepInExPack Valheim) i sprawdzanie zgodności pluginów/modów/zasobów.

**Edytor** – Monaco (silnik VS Code): drzewo plików, zakładki, wyszukiwanie w plikach, szybkie otwieranie (Ctrl+P), podświetlanie Lua, JSON, TOML, YAML, XML, C#, SourcePawn, Enforce Script (DayZ/Reforger), SQF, Paradox, SII, KeyValues (gameinfo.gi), cfg serwerów, mcfunction i logów; snippety i szablony plików dla każdej gry.

## Wygląd i motywy (1.3)

- Domyślny motyw **Klasyczny**: szare tło i zielone wyróżnienia. Wbudowane są też: Grafit, Jasny, Nocny, Leśny i Wysoki kontrast (Ustawienia → Wygląd).
- **Własne motywy**: pliki `nazwa.theme.json` w folderze motywów (przycisk „Folder motywów”). Wystarczy podać kolory do zmiany – reszta pochodzi z motywu bazowego (`"extends"`). Zmiany są widoczne od razu po zapisaniu pliku. Opis wszystkich kluczy jest w `README.txt` w folderze motywów, a przykład w `czerwony.theme.json`.
- **Ikony gier** są pobierane z pamięci podręcznej biblioteki Steam, z pliku .exe gry albo (gdy gra nie jest zainstalowana, np. dla serwerów) z grafik Steam, które są zapisywane lokalnie.
- Plik .exe i instalator mają ikonę taką jak w aplikacji.

## Aktualizacje z GitHub (1.2)

CodeManager sprawdza nowe wydania na GitHub przy starcie i co 6 godzin (Ustawienia → Aktualizacje programu):

- **Instalator** (`CodeManager-Setup-x.y.z.exe`) – aktualizacja przez electron-updater: pobranie w tle, instalacja od razu albo przy zamknięciu.
- **Portable** i **ZIP** – CodeManager pobiera nowy plik z wydania, sprawdza sumę SHA-256 podaną przez GitHub, zamyka się, podmienia pliki i uruchamia ponownie.
- Wydania są pobierane z publicznego repozytorium [Zeis01/codemanager](https://github.com/Zeis01/codemanager/releases) – nic nie trzeba konfigurować.

### Jak publikować wydania

```
git add .
git commit -m "Opis zmian"
npm version patch
git push --follow-tags
```

Workflow `.github/workflows/release.yml` zbuduje instalator, wersję portable i ZIP i opublikuje je jako wydanie na GitHub.

## Nowości w wersji 1.1

- **Modrinth** – wyszukiwanie i instalacja modów/pluginów z automatycznym pobieraniem zależności, aktualizacja wszystkiego jednym przyciskiem (stare wersje trafiają do kopii), import paczek **.mrpack** (nowa instancja lub serwer).
- **Nexus Mods** – połączenie kluczem API (szyfrowany), przeglądanie i wyszukiwanie, pliki modów, instalacja (Premium: bezpośrednio; konto darmowe: obsługa linków `nxm://` z przycisku „Mod Manager Download”), inteligentna instalacja archiwów (Stardew, Skyrim/Fallout Data, BepInEx…), sprawdzanie aktualizacji (także po UpdateKeys w SMAPI).
- **Thunderstore** – instalacja paczek z zależnościami w układzie r2modman, aktualizacja jednym przyciskiem, import profili **r2modman** (kod udostępniania lub plik .r2z).
- **Analizator błędów** – ponad 50 reguł dla Minecrafta, Javy, BepInEx, MelonLoadera, SMAPI, RimWorld, Factorio, tModLoadera, serwerów (Rust/Oxide, SourceMod, FiveM, DayZ, Arma, SteamCMD) i problemów systemowych. Mapuje ślad stosu na konkretny mod, wyjaśnia „dlaczego” i „co zrobić” prostym językiem, a wiele problemów naprawia przyciskiem.
- **Naprawy jednym kliknięciem** w raporcie zgodności (brakujące zależności, zła wersja moda, duplikaty, brak loadera, klucze DayZ, gameinfo.gi CS2…) oraz „Napraw automatycznie”.
- **Profile modów** – zapisz zestaw włączonych modów i przełączaj jednym kliknięciem.
- **Serwery** – automatyczne kopie zapasowe światów (z rotacją i przywracaniem), zaplanowane restarty z ostrzeżeniem graczy, restart po awarii, zdalna konsola **RCON** (Source RCON, Rust WebRCON, FiveM) także dla serwerów zdalnych.
- **Nowe serwery**: Palworld, ARK (Ascended i Evolved), Satisfactory (sprawdzanie modów SML), Enshrouded, Space Engineers, proxy Velocity i BungeeCord.
- **Nowe gry**: RimWorld (wersje, zależności, kolejność ładowania), Stardew Valley (SMAPI), Factorio (zależności + aktualizacje z portalu), Skyrim SE i Fallout 4 (mastery, kolejność, limity, SKSE/F4SE, Address Library), 7 Days to Die.

## Uwagi

- Serwer DayZ wymaga konta Steam z grą (SteamCMD poprosi o hasło/kod Steam Guard w konsoli).
- Serwer MTA na Windows kopiowany jest z instalacji MTA:SA (opcja „Dedicated server”).
- FiveM i BeamMP wymagają kluczy (portal.cfx.re, keymaster.beammp.com).
- Minecraft wymaga Javy (1.20.5+ → Java 21).
