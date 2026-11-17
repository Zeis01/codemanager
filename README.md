# CodeManager

Menedżer modów i serwerów ze sprawdzaniem zgodności modów za pomocą metadanych o dużej liczbie gier która jest stale rozszerzana.

## Uruchomienie

- Wejdź do zakładki Releases
- Pobierz i uruchom jedną z nich: `CodeManager-Setup-x.y.z.exe` (instalator), `CodeManager-Portable-x.y.z.exe` albo `CodeManager-x.y.z-win-x64.zip` (rozpakuj i uruchom `CodeManager.exe`).

## Co potrafi

Wykrywa gry z bibliotek Steam (libraryfolders.vdf + appmanifest), Epic Games, Rockstar Launcher, skanuje dysk w poszukiwaniu folderów z grami oraz instancje Minecrafta z oficjalnego launchera, Prism/MultiMC, CurseForge, Modrinth App i ATLauncher. Lokalizacje są wykrywane automatycznie, jeśli wykryło złą lokalizacje folderu można zmienić lub uruchomić wykrywanie ponownie.

**Sprawdzanie zgodności modów** (offline, z metadanych modów):

| Gra | Co jest sprawdzane |
|---|---|
| Minecraft (Fabric, Quilt, Forge, NeoForge) | loader, wersja gry i loadera, zależności z zakresami wersji, `breaks`/`incompatible`, duplikaty, mody tylko-klient na serwerze, jar-in-jar; online: Modrinth (aktualizacje, oznaczenie wersji) |
| Project Zomboid | `require`, `incompatible`, Build 41 vs 42, kolejność ładowania, duplikaty ID |
| Euro Truck Simulator 2 | `compatible_versions` w manifest.sii / versions.sii i wersja gry |
| Sons of the Forest | RedLoader, manifesty, zależności |
| Lethal Company, R.E.P.O., Content Warning | BepInEx 5, zależności Thunderstore z wersjami, duplikaty DLL, log BepInEx, profile r2modman/Thunderstore/Gale, aktualizacje z Thunderstore |
| Schedule I | MelonLoader, mody IL2CPP vs Mono, mody BepInEx w złym folderze |
| People Playground | `GameVersion`, brakujące skrypty, duplikaty |
| Transport Fever 2 | mod.lua, nazwa folderu z wersją, nadpisywanie tych samych plików |
| Hearts of Iron IV | `supported_version`, zależności, aktywne mody (dlc_load.json), konflikty plików |
| Garry's Mod | konflikty plików Lua/zasobów między addonami (foldery i .gma) |
| Don't Starve Together | `dst_compatible`, `api_version`, `mod_dependencies`, flagi klient/serwer |
| GTA V (Legacy i Enhanced) | ScriptHookV vs build gry, ASI Loader, ScriptHookVDotNet, OpenIV |
| Terraria (tModLoader) | wersja tModLoadera w .tmod, `modReferences`, enabled.json |

**Instalatory** – BepInEx 5, MelonLoader, RedLoader, Fabric, Quilt, Forge, NeoForge (z oficjalnych źródeł, z kopią zapasową nadpisywanych plików); tModLoader i Script Hook V przez oficjalne strony.

**Serwery** – Minecraft (Paper, Purpur, Vanilla, Fabric, Quilt, Forge, NeoForge), Arma Reforger, Rust, CS2, DayZ, FiveM, MTA, Terraria (TShock), Valheim, Project Zomboid, Team Fortress 2, BeamMP. Instalacja przez SteamCMD lub oficjalne API, konsola na żywo z wysyłaniem poleceń, aktualizacje, frameworki pluginów (Oxide, Carbon, Metamod, CounterStrikeSharp, SourceMod, BepInExPack Valheim) i sprawdzanie zgodności pluginów/modów/zasobów.

**Edytor** – Monaco: Edytuj pliki jak w Visual Studio Code.

## Uwagi

- Serwer DayZ wymaga konta Steam z grą (SteamCMD poprosi o hasło/kod Steam Guard w konsoli).
- Serwer MTA na Windows kopiowany jest z instalacji MTA:SA (opcja „Dedicated server”).
- FiveM i BeamMP wymagają kluczy (portal.cfx.re, keymaster.beammp.com).
- Minecraft wymaga Javy (1.20.5+ → Java 21).
