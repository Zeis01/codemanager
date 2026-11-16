// Definicje obsługiwanych gier (mod manager)
'use strict';

const GAMES = [
  {
    id: 'minecraft', name: 'Minecraft', short: 'MC', color: '#62b246', appIds: [], checker: 'minecraft',
    loaders: ['fabric', 'forge', 'neoforge', 'quilt'],
    desc: 'Mody Fabric, Quilt, Forge i NeoForge: zależności, wersja gry, loader, konflikty, mody tylko-klient.',
    multiInstance: true,
  },
  {
    id: 'projectzomboid', name: 'Project Zomboid', short: 'PZ', color: '#b33a3a', appIds: [108600], exe: ['ProjectZomboid64.exe', 'projectzomboid.sh'],
    checker: 'projectzomboid', workshop: 108600,
    desc: 'mod.info: zależności (require), niezgodności, Build 41 / 42, duplikaty ID.',
  },
  {
    id: 'ets2', name: 'Euro Truck Simulator 2', short: 'ETS2', color: '#2f80ed', appIds: [227300], exe: ['bin/win_x64/eurotrucks2.exe', 'bin/linux_x64/eurotrucks2'],
    checker: 'ets2', workshop: 227300,
    desc: 'manifest.sii / versions.sii: zgodność z wersją gry, uszkodzone paczki.',
  },
  {
    id: 'sotf', name: 'Sons of the Forest', short: 'SotF', color: '#6b8e23', appIds: [1326470], exe: ['SonsOfTheForest.exe'],
    checker: 'redloader', loaders: ['redloader'],
    desc: 'RedLoader: obecność loadera, manifesty modów, zależności.',
  },
  {
    id: 'lethalcompany', name: 'Lethal Company', short: 'LC', color: '#e0a526', appIds: [1966720], exe: ['Lethal Company.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'lethal-company', r2: ['LethalCompany'],
    desc: 'BepInEx 5 + paczki Thunderstore: zależności, wersje, duplikaty, profile r2modman.',
  },
  {
    id: 'repo', name: 'R.E.P.O.', short: 'REPO', color: '#d9534f', appIds: [3241660], exe: ['REPO.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'repo', r2: ['REPO'],
    desc: 'BepInEx 5 + paczki Thunderstore: zależności, wersje, duplikaty, profile r2modman.',
  },
  {
    id: 'contentwarning', name: 'Content Warning', short: 'CW', color: '#f2c94c', appIds: [2881650], exe: ['Content Warning.exe'],
    checker: 'bepinex', loaders: ['bepinex5'], thunderstore: 'content-warning', r2: ['ContentWarning'],
    desc: 'BepInEx 5 + paczki Thunderstore. Uwaga: gra ma też natywne mody Steam Workshop.',
  },
  {
    id: 'schedule1', name: 'Schedule I', short: 'S1', color: '#27ae60', appIds: [3164500], exe: ['Schedule I.exe'],
    checker: 'melonloader', loaders: ['melonloader'], thunderstore: 'schedule-i', r2: ['ScheduleI'],
    desc: 'MelonLoader: zgodność modów IL2CPP / Mono z gałęzią gry, wersja loadera, zależności.',
  },
  {
    id: 'peopleplayground', name: 'People Playground', short: 'PPG', color: '#9b59b6', appIds: [1118200], exe: ['People Playground.exe'],
    checker: 'peopleplayground', workshop: 1118200,
    desc: 'mod.json: wersja gry (GameVersion), brakujące skrypty i pliki.',
  },
  {
    id: 'transportfever2', name: 'Transport Fever 2', short: 'TF2', color: '#e67e22', appIds: [1066780], exe: ['TransportFever2.exe', 'TransportFever2'],
    checker: 'transportfever2', workshop: 1066780,
    desc: 'mod.lua: struktura i wersja modu, nadpisywanie tych samych plików przez różne mody.',
  },
  {
    id: 'hoi4', name: 'Hearts of Iron IV', short: 'HOI4', color: '#8e7c5a', appIds: [394360], exe: ['hoi4.exe', 'hoi4'],
    checker: 'paradox', workshop: 394360, paradoxFolder: 'Hearts of Iron IV',
    desc: 'Deskryptory .mod: supported_version, zależności, konflikty plików między modami.',
  },
  {
    id: 'garrysmod', name: "Garry's Mod", short: 'GMod', color: '#1e90ff', appIds: [4000], exe: ['hl2.exe', 'gmod.exe', 'bin/win64/gmod.exe'],
    checker: 'garrysmod', workshop: 4000,
    desc: 'Addony (foldery i .gma): konflikty plików Lua/zasobów, uszkodzone addony.',
  },
  {
    id: 'dst', name: "Don't Starve Together", short: 'DST', color: '#7f6a4d', appIds: [322330], exe: ['bin64/dontstarve_steam_x64.exe', 'bin/dontstarve_steam.exe'],
    checker: 'dst', workshop: 322330,
    desc: 'modinfo.lua: dst_compatible, api_version, zależności (mod_dependencies), klient/serwer.',
  },
  {
    id: 'gta5', name: 'Grand Theft Auto V', short: 'GTA V', color: '#2ecc71', appIds: [271590, 3240220], exe: ['GTA5.exe', 'GTA5_Enhanced.exe', 'PlayGTAV.exe'],
    checker: 'gta5', epic: /grand theft auto v/i, loaders: ['scripthookv'],
    desc: 'ScriptHookV vs wersja gry, ASI Loader, ScriptHookVDotNet, OpenIV mods.',
  },
  {
    id: 'terraria', name: 'Terraria (tModLoader)', short: 'TML', color: '#3fa34d', appIds: [1281930, 105600], exe: ['tModLoader.exe', 'tModLoader.dll', 'Terraria.exe'],
    checker: 'tmodloader', loaders: ['tmodloader'], workshop: 1281930,
    desc: 'Pliki .tmod: wersja tModLoadera, zależności (modReferences), duplikaty.',
  },
  {
    id: 'rimworld', name: 'RimWorld', short: 'RW', color: '#c9a66b', appIds: [294100], exe: ['RimWorldWin64.exe', 'RimWorldLinux', 'RimWorldWin.exe'],
    checker: 'rimworld', workshop: 294100, nexus: 'rimworld',
    desc: 'About.xml: wersje gry, zależności, kolejność ładowania (loadAfter/loadBefore), niezgodności, Harmony.',
  },
  {
    id: 'stardew', name: 'Stardew Valley', short: 'SDV', color: '#7cb342', appIds: [413150], exe: ['Stardew Valley.exe', 'StardewValley', 'Stardew Valley.dll'],
    checker: 'stardew', loaders: ['smapi'], nexus: 'stardewvalley',
    desc: 'SMAPI: wersja API i gry, zależności, pakiety zawartości, duplikaty, aktualizacje z Nexus (UpdateKeys).',
  },
  {
    id: 'factorio', name: 'Factorio', short: 'FAC', color: '#e39827', appIds: [427520], exe: ['bin/x64/factorio.exe', 'bin/x64/factorio'],
    checker: 'factorio', extraPaths: ['C:\\Program Files\\Factorio'],
    desc: 'info.json: factorio_version, zależności (wymagane, opcjonalne, niezgodne), wersje; aktualizacje z portalu modów.',
  },
  {
    id: 'skyrimse', name: 'Skyrim Special Edition', short: 'SSE', color: '#9aa7b0', appIds: [489830], exe: ['SkyrimSE.exe'],
    checker: 'bethesda', loaders: ['skse'], nexus: 'skyrimspecialedition',
    desc: 'Mastery pluginów (.esp/.esm/.esl), kolejność ładowania, limity pluginów, SKSE vs wersja gry, Address Library.',
  },
  {
    id: 'fallout4', name: 'Fallout 4', short: 'FO4', color: '#4b8f3a', appIds: [377160], exe: ['Fallout4.exe'],
    checker: 'bethesda', loaders: ['f4se'], nexus: 'fallout4',
    desc: 'Mastery pluginów, kolejność ładowania, limity pluginów, F4SE vs wersja gry, Address Library.',
  },
  {
    id: 'sevendays', name: '7 Days to Die', short: '7D', color: '#a33d2b', appIds: [251570], exe: ['7DaysToDie.exe', '7DaysToDie.x86_64'],
    checker: 'sevendays', nexus: '7daystodie',
    desc: 'ModInfo.xml, struktura folderów, duplikaty, mody DLL wymagające wyłączenia EAC.',
  },
];

// Gry z listy użytkownika, których nie dodano (brak możliwości rzetelnego sprawdzenia zgodności)
const UNSUPPORTED = [
  { name: 'Brick Rigs', reason: 'Mody z Warsztatu nie mają metadanych o wersji gry ani zależnościach – nie da się rzetelnie sprawdzić zgodności.' },
  { name: 'Cities: Skylines (I i II)', reason: 'Mody nie deklarują wersji gry ani zależności w czytelny sposób (C:S II używa zamkniętego Paradox Mods).' },
  { name: 'Ready or Not', reason: 'Mody to paczki .pak/IoStore (UE5) bez manifestu; wykrycie konfliktów wymaga rozpakowania szyfrowanych indeksów silnika.' },
];

module.exports = { GAMES, UNSUPPORTED, byId: id => GAMES.find(g => g.id === id) };
