# CodeManager

Menedżer modów, serwerów i edytor konfiguracji dla gier – w zielonym motywie „Sosnowy las”.

## Uruchomienie

Gotowa wersja: `CodeManager-Setup-x.y.z.exe` (instalator), `CodeManager-Portable-x.y.z.exe` albo `CodeManager-x.y.z-win-x64.zip` (rozpakuj i uruchom `CodeManager.exe`).

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

## Nowe gry (1.4)

Gry oznaczone ★ mają najlepsze sprawdzanie zgodności (zależności, wersje, konflikty).

| Gra | Zakres |
|---|---|
| ★ Cyberpunk 2077 | frameworki i ich wymagania (CET, RED4ext, redscript, TweakXL, ArchiveXL, Codeware, REDmod), błędy z logów |
| ★ Wiedźmin 3 | konflikty skryptów między modami (Script Merger), mods.settings |
| PAYDAY 2 | SuperBLT, BeardLib, poprawność mod.txt, duplikaty, log BLT |
| My Summer Car | MSCLoader, mody i biblioteki we właściwych folderach |
| Teardown | info.txt, pliki startowe, duplikaty |
| S.T.A.L.K.E.R.: SoC / CS / CoP | gamedata i ustawienie fsgame.ltx |

**Instalacja ręczna** (bez sprawdzania zgodności – mody można instalować z Nexus Mods lub archiwum oraz włączać i wyłączać): S.T.A.L.K.E.R. 2, My Winter Car, Metro 2033 Redux, Metro: Last Light Redux, Metro Exodus, PAYDAY 3, Ready or Not, Brick Rigs, Cities: Skylines, Cities: Skylines II.

## Wygląd i motywy (1.3)

- Domyślny motyw **Klasyczny**: szare tło i zielone wyróżnienia. Wbudowane są też: Grafit, Jasny, Nocny, Leśny i Wysoki kontrast (Ustawienia → Wygląd).
- **Własne motywy**: pliki `nazwa.theme.json` w folderze motywów (przycisk „Folder motywów”). Wystarczy podać kolory do zmiany – reszta pochodzi z motywu bazowego (`"extends"`). Zmiany są widoczne od razu po zapisaniu pliku. Opis wszystkich kluczy jest w `README.txt` w folderze motywów, a przykład w `czerwony.theme.json`.
- **Ikony gier** są pobierane z pamięci podręcznej biblioteki Steam, z pliku .exe gry albo (gdy gra nie jest zainstalowana, np. dla serwerów) z grafik Steam, które są zapisywane lokalnie.
- Plik .exe i instalator mają ikonę taką jak w aplikacji.

## Uwagi

- Serwer DayZ wymaga konta Steam z grą (SteamCMD poprosi o hasło/kod Steam Guard w konsoli).
- Serwer MTA na Windows kopiowany jest z instalacji MTA:SA (opcja „Dedicated server”).
- FiveM i BeamMP wymagają kluczy (portal.cfx.re, keymaster.beammp.com).
- Minecraft wymaga Javy (1.20.5+ → Java 21).
