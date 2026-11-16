// Definicje obsługiwanych gier (mod manager)
'use strict';

const GAMES = [
  {
    id: 'minecraft', compat: 'full', name: 'Minecraft', short: 'MC', color: '#62b246', appIds: [], checker: 'minecraft',
    loaders: ['fabric', 'forge', 'neoforge', 'quilt'],
    desc: 'Mody Fabric, Quilt, Forge i NeoForge: zależności, wersja gry, loader, konflikty, mody tylko-klient.',
    multiInstance: true,
  },
  {
    id: 'projectzomboid', compat: 'full', name: 'Project Zomboid', short: 'PZ', color: '#b33a3a', appIds: [108600], exe: ['ProjectZomboid64.exe', 'projectzomboid.sh'],
    checker: 'projectzomboid', workshop: 108600,
    desc: 'mod.info: zależności (require), niezgodności, Build 41 / 42, duplikaty ID.',
  },
  {
    id: 'ets2', compat: 'full', name: 'Euro Truck Simulator 2', short: 'ETS2', color: '#2f80ed', appIds: [227300], exe: ['bin/win_x64/eurotrucks2.exe', 'bin/linux_x64/eurotrucks2'],
    checker: 'ets2', workshop: 227300,
    desc: 'manifest.sii / versions.sii: zgodność z wersją gry, uszkodzone paczki.',
  },
  {
    id: 'sotf', compat: 'basic', name: 'Sons of the Forest', short: 'SotF', color: '#6b8e23', appIds: [1326470], exe: ['SonsOfTheForest.exe'],
    checker: 'redloader', loaders: ['redloader'],
    desc: 'RedLoader: obecność loadera, manifesty modów, zależności.',
  },
  {
    id: 'lethalcompany', compat: 'full', name: 'Lethal Company', short: 'LC', color: '#e0a526', appIds: [1966720], exe: ['Lethal Company.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'lethal-company', r2: ['LethalCompany'],
    desc: 'BepInEx 5 + paczki Thunderstore: zależności, wersje, duplikaty, profile r2modman.',
  },
  {
    id: 'repo', compat: 'full', name: 'R.E.P.O.', short: 'REPO', color: '#d9534f', appIds: [3241660], exe: ['REPO.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'repo', r2: ['REPO'],
    desc: 'BepInEx 5 + paczki Thunderstore: zależności, wersje, duplikaty, profile r2modman.',
  },
  {
    id: 'contentwarning', compat: 'full', name: 'Content Warning', short: 'CW', color: '#f2c94c', appIds: [2881650], exe: ['Content Warning.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'content-warning', r2: ['ContentWarning'],
    desc: 'BepInEx 5 + paczki Thunderstore. Uwaga: gra ma też natywne mody Steam Workshop.',
  },
  {
    id: 'schedule1', compat: 'basic', name: 'Schedule I', short: 'S1', color: '#27ae60', appIds: [3164500], exe: ['Schedule I.exe'],
    checker: 'melonloader', loaders: ['melonloader'], thunderstore: 'schedule-i', r2: ['ScheduleI'],
    desc: 'MelonLoader: zgodność modów IL2CPP / Mono z gałęzią gry, wersja loadera, zależności.',
  },
  {
    id: 'peopleplayground', compat: 'basic', name: 'People Playground', short: 'PPG', color: '#9b59b6', appIds: [1118200], exe: ['People Playground.exe'],
    checker: 'peopleplayground', workshop: 1118200,
    desc: 'mod.json: wersja gry (GameVersion), brakujące skrypty i pliki.',
  },
  {
    id: 'transportfever2', compat: 'basic', name: 'Transport Fever 2', short: 'TF2', color: '#e67e22', appIds: [1066780], exe: ['TransportFever2.exe', 'TransportFever2'],
    checker: 'transportfever2', workshop: 1066780,
    desc: 'mod.lua: struktura i wersja modu, nadpisywanie tych samych plików przez różne mody.',
  },
  {
    id: 'hoi4', compat: 'full', name: 'Hearts of Iron IV', short: 'HOI4', color: '#8e7c5a', appIds: [394360], exe: ['hoi4.exe', 'hoi4'],
    checker: 'paradox', workshop: 394360, paradoxFolder: 'Hearts of Iron IV',
    desc: 'Deskryptory .mod: supported_version, zależności, konflikty plików między modami.',
  },
  {
    id: 'garrysmod', compat: 'basic', name: "Garry's Mod", short: 'GMod', color: '#1e90ff', appIds: [4000], exe: ['hl2.exe', 'gmod.exe', 'bin/win64/gmod.exe'],
    checker: 'garrysmod', workshop: 4000,
    desc: 'Addony (foldery i .gma): konflikty plików Lua/zasobów, uszkodzone addony.',
  },
  {
    id: 'dst', compat: 'full', name: "Don't Starve Together", short: 'DST', color: '#7f6a4d', appIds: [322330], exe: ['bin64/dontstarve_steam_x64.exe', 'bin/dontstarve_steam.exe'],
    checker: 'dst', workshop: 322330,
    desc: 'modinfo.lua: dst_compatible, api_version, zależności (mod_dependencies), klient/serwer.',
  },
  {
    id: 'gta5', compat: 'basic', name: 'Grand Theft Auto V', short: 'GTA V', color: '#2ecc71', appIds: [271590, 3240220], exe: ['GTA5.exe', 'GTA5_Enhanced.exe', 'PlayGTAV.exe'],
    checker: 'gta5', epic: /grand theft auto v/i, loaders: ['scripthookv'],
    desc: 'ScriptHookV vs wersja gry, ASI Loader, ScriptHookVDotNet, OpenIV mods.',
  },
  {
    id: 'terraria', compat: 'full', name: 'Terraria (tModLoader)', short: 'TML', color: '#3fa34d', appIds: [1281930, 105600], exe: ['tModLoader.exe', 'tModLoader.dll', 'Terraria.exe'],
    checker: 'tmodloader', loaders: ['tmodloader'], workshop: 1281930,
    desc: 'Pliki .tmod: wersja tModLoadera, zależności (modReferences), duplikaty.',
  },
  {
    id: 'rimworld', compat: 'full', name: 'RimWorld', short: 'RW', color: '#c9a66b', appIds: [294100], exe: ['RimWorldWin64.exe', 'RimWorldLinux', 'RimWorldWin.exe'],
    checker: 'rimworld', workshop: 294100, nexus: 'rimworld',
    desc: 'About.xml: wersje gry, zależności, kolejność ładowania (loadAfter/loadBefore), niezgodności, Harmony.',
  },
  {
    id: 'stardew', compat: 'full', name: 'Stardew Valley', short: 'SDV', color: '#7cb342', appIds: [413150], exe: ['Stardew Valley.exe', 'StardewValley', 'Stardew Valley.dll'],
    checker: 'stardew', loaders: ['smapi'], nexus: 'stardewvalley',
    desc: 'SMAPI: wersja API i gry, zależności, pakiety zawartości, duplikaty, aktualizacje z Nexus (UpdateKeys).',
  },
  {
    id: 'factorio', compat: 'full', name: 'Factorio', short: 'FAC', color: '#e39827', appIds: [427520], exe: ['bin/x64/factorio.exe', 'bin/x64/factorio'],
    checker: 'factorio', extraPaths: ['C:\\Program Files\\Factorio'],
    desc: 'info.json: factorio_version, zależności (wymagane, opcjonalne, niezgodne), wersje; aktualizacje z portalu modów.',
  },
  {
    id: 'skyrimse', compat: 'full', name: 'Skyrim Special Edition', short: 'SSE', color: '#9aa7b0', appIds: [489830], exe: ['SkyrimSE.exe'],
    checker: 'bethesda', loaders: ['skse'], nexus: 'skyrimspecialedition',
    desc: 'Mastery pluginów (.esp/.esm/.esl), kolejność ładowania, limity pluginów, SKSE vs wersja gry, Address Library.',
  },
  {
    id: 'fallout4', compat: 'full', name: 'Fallout 4', short: 'FO4', color: '#4b8f3a', appIds: [377160], exe: ['Fallout4.exe'],
    checker: 'bethesda', loaders: ['f4se'], nexus: 'fallout4',
    desc: 'Mastery pluginów, kolejność ładowania, limity pluginów, F4SE vs wersja gry, Address Library.',
  },
  {
    id: 'sevendays', compat: 'basic', name: '7 Days to Die', short: '7D', color: '#a33d2b', appIds: [251570], exe: ['7DaysToDie.exe', '7DaysToDie.x86_64'],
    checker: 'sevendays', nexus: '7daystodie',
    desc: 'ModInfo.xml, struktura folderów, duplikaty, mody DLL wymagające wyłączenia EAC.',
  },
  {
    id: 'cyberpunk2077', compat: 'full', name: 'Cyberpunk 2077', short: 'CP77', color: '#e6d03b', appIds: [1091500], exe: ['bin/x64/Cyberpunk2077.exe'], epic: /cyberpunk 2077/i,
    checker: 'cyberpunk', nexus: 'cyberpunk2077',
    desc: 'Frameworki i ich wymagania: CET, RED4ext, redscript, TweakXL, ArchiveXL, Codeware, REDmod; błędy z logów frameworków.',
  },
  {
    id: 'witcher3', compat: 'full', name: 'Wiedźmin 3: Dziki Gon', short: 'W3', color: '#b8433a', appIds: [292030], exe: ['bin/x64/witcher3.exe', 'bin/x64_dx12/witcher3.exe'], epic: /witcher 3/i,
    checker: 'witcher3', nexus: 'witcher3',
    desc: 'Konflikty skryptów między modami (Script Merger), mods.settings, wersja klasyczna i next-gen.',
  },
  {
    id: 'payday2', compat: 'basic', name: 'PAYDAY 2', short: 'PD2', color: '#4a7fb5', appIds: [218620], exe: ['payday2_win32_release.exe'],
    checker: 'payday2', nexus: 'payday2',
    desc: 'SuperBLT i BeardLib: obecność, poprawność mod.txt, zależności, duplikaty, błędy z logów BLT.',
  },
  {
    id: 'mysummercar', compat: 'basic', name: 'My Summer Car', short: 'MSC', color: '#c7b14a', appIds: [516750], exe: ['mysummercar.exe'],
    checker: 'mysummercar', nexus: 'mysummercar',
    desc: 'MSCLoader: obecność loadera, mody i biblioteki we właściwych folderach, duplikaty, błędy z logu.',
  },
  {
    id: 'teardown', compat: 'basic', name: 'Teardown', short: 'TD', color: '#d9813b', appIds: [1167630], exe: ['teardown.exe'],
    checker: 'teardown', workshop: 1167630, nexus: 'teardown',
    desc: 'Mody lokalne i z Warsztatu: info.txt, pliki startowe, duplikaty.',
  },
  {
    id: 'stalkersoc', compat: 'basic', name: 'S.T.A.L.K.E.R.: Shadow of Chernobyl', short: 'SoC', color: '#8a8a5c', appIds: [4500], exe: ['bin/XR_3DA.exe', 'bin/xrEngine.exe'],
    checker: 'xray', nexus: 'stalkershadowofchernobyl',
    desc: 'Folder gamedata i ustawienie fsgame.ltx, które pozwala grze wczytać mody.',
  },
  {
    id: 'stalkercs', compat: 'basic', name: 'S.T.A.L.K.E.R.: Clear Sky', short: 'CS', color: '#6f8a9a', appIds: [20510], exe: ['bin/xrEngine.exe'],
    checker: 'xray', nexus: 'stalkerclearsky',
    desc: 'Folder gamedata i ustawienie fsgame.ltx, które pozwala grze wczytać mody.',
  },
  {
    id: 'stalkercop', compat: 'basic', name: 'S.T.A.L.K.E.R.: Call of Pripyat', short: 'CoP', color: '#7d6f5a', appIds: [41700], exe: ['bin/xrEngine.exe'],
    checker: 'xray', nexus: 'stalkercallofpripyat',
    desc: 'Folder gamedata i ustawienie fsgame.ltx, które pozwala grze wczytać mody.',
  },
  // ---- tylko instalacja ręczna (bez sprawdzania zgodności) ----
  {
    id: 'stalker2', compat: 'none', name: 'S.T.A.L.K.E.R. 2: Heart of Chornobyl', short: 'S2', color: '#5d7f5a', appIds: [1643320], exe: ['Stalker2.exe', 'Stalker2/Binaries/Win64/Stalker2-Win64-Shipping.exe'],
    checker: 'files', nexus: 'stalker2heartofchornobyl', manual: { dirs: ['Stalker2/Content/Paks/~mods'], kind: 'pak' },
    desc: 'Mody .pak w folderze ~mods. Sprawdzanie zgodności niedostępne – paczki UE5 nie mają metadanych.',
  },
  {
    id: 'mywintercar', compat: 'none', name: 'My Winter Car', short: 'MWC', color: '#7fa6c9', appIds: [4164420], exe: ['mywintercar.exe'],
    checker: 'files', nexus: 'mywintercar', manual: { dirs: ['Mods'], kind: 'any', root: true },
    desc: 'Instalacja modów z Nexus Mods lub ręcznie. Sprawdzanie zgodności niedostępne.',
  },
  {
    id: 'metro2033redux', compat: 'none', name: 'Metro 2033 Redux', short: 'M33', color: '#6b6b6b', appIds: [286690], exe: ['metro.exe'],
    checker: 'files', nexus: 'metro2033redux', manual: { dirs: [], kind: 'registry', root: true },
    desc: 'Mody kopiowane do folderu gry. Sprawdzanie zgodności niedostępne.',
  },
  {
    id: 'metrolastlightredux', compat: 'none', name: 'Metro: Last Light Redux', short: 'MLL', color: '#5f6b73', appIds: [287390], exe: ['metro.exe'],
    checker: 'files', nexus: 'metrolastlightredux', manual: { dirs: [], kind: 'registry', root: true },
    desc: 'Mody kopiowane do folderu gry. Sprawdzanie zgodności niedostępne.',
  },
  {
    id: 'metroexodus', compat: 'none', name: 'Metro Exodus', short: 'MEX', color: '#7a6a55', appIds: [412020], exe: ['MetroExodus.exe'], epic: /metro exodus/i,
    checker: 'files', nexus: 'metroexodus', manual: { dirs: [], kind: 'registry', root: true },
    desc: 'Mody kopiowane do folderu gry. Sprawdzanie zgodności niedostępne.',
  },
  {
    id: 'payday3', compat: 'none', name: 'PAYDAY 3', short: 'PD3', color: '#3f6fa0', appIds: [1272080], exe: ['PAYDAY3.exe', 'PAYDAY3Client.exe'],
    checker: 'files', nexus: 'payday3', manual: { dirs: ['PAYDAY3/Content/Paks/~mods'], kind: 'pak' },
    desc: 'Mody .pak w folderze ~mods. Sprawdzanie zgodności niedostępne – paczki UE nie mają metadanych.',
  },
  {
    id: 'readyornot', compat: 'none', name: 'Ready or Not', short: 'RoN', color: '#4f5d6e', appIds: [1144200], exe: ['ReadyOrNot.exe'],
    checker: 'files', nexus: 'readyornot', manual: { dirs: ['ReadyOrNot/Content/Paks/~mods'], kind: 'pak' },
    desc: 'Mody .pak w folderze ~mods. Sprawdzanie zgodności niedostępne – paczki UE5 nie mają metadanych.',
  },
  {
    id: 'brickrigs', compat: 'none', name: 'Brick Rigs', short: 'BR', color: '#c9573b', appIds: [552100], exe: ['BrickRigs.exe'],
    checker: 'files', workshop: 552100, manual: { dirs: ['workshop'], kind: 'folders', readOnly: true },
    desc: 'Mody z Warsztatu Steam. Sprawdzanie zgodności niedostępne – mody nie mają metadanych o wersji gry.',
  },
  {
    id: 'citiesskylines', compat: 'none', name: 'Cities: Skylines', short: 'C:S', color: '#3d9bd6', appIds: [255710], exe: ['Cities.exe'],
    checker: 'files', workshop: 255710, nexus: 'citiesskylines', manual: { dirs: ['%LOCALAPPDATA%/Colossal Order/Cities_Skylines/Addons/Mods', 'workshop'], kind: 'folders' },
    desc: 'Mody lokalne i z Warsztatu. Sprawdzanie zgodności niedostępne.',
  },
  {
    id: 'citiesskylines2', compat: 'none', name: 'Cities: Skylines II', short: 'CS2', color: '#2f86c4', appIds: [949230], exe: ['Cities2.exe'],
    checker: 'files', nexus: 'citiesskylines2', manual: { dirs: ['%LOCALLOW%/Colossal Order/Cities Skylines II/Mods'], kind: 'folders' },
    desc: 'Mody lokalne. Sprawdzanie zgodności niedostępne (Paradox Mods nie udostępnia metadanych zgodności).',
  },
];

// Wszystkie gry są obsługiwane; gry bez sprawdzania zgodności mają compat: 'none'
const UNSUPPORTED = [];

module.exports = { GAMES, UNSUPPORTED, byId: id => GAMES.find(g => g.id === id) };
