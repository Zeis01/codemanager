// Kopie zapasowe zapisów gier (save'ów) – osobno od modów
'use strict';
const path = require('path');
const U = require('../util');

const LL = () => path.join(U.home(), 'AppData', 'LocalLow');
const DOCS = () => U.documentsCandidates().length ? U.documentsCandidates() : [U.documents()];
const inDocs = (...p) => DOCS().map(d => path.join(d, ...p));
const SAVED = () => path.join(U.home(), 'Saved Games');

// kandydaci na foldery zapisów (pierwszy istniejący z każdej grupy)
const SAVES = {
  skyrimse: () => [inDocs('My Games', 'Skyrim Special Edition', 'Saves')],
  fallout4: () => [inDocs('My Games', 'Fallout4', 'Saves')],
  witcher3: () => [inDocs('The Witcher 3', 'gamesaves')],
  cyberpunk2077: () => [[path.join(SAVED(), 'CD Projekt Red', 'Cyberpunk 2077')]],
  projectzomboid: () => [[path.join(U.home(), 'Zomboid', 'Saves')]],
  terraria: () => [inDocs('My Games', 'Terraria', 'tModLoader', 'Players'), inDocs('My Games', 'Terraria', 'tModLoader', 'Worlds'), inDocs('My Games', 'Terraria', 'Players'), inDocs('My Games', 'Terraria', 'Worlds')],
  stardew: () => [[path.join(U.appData(), 'StardewValley', 'Saves')]],
  rimworld: () => [[path.join(LL(), 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Saves')]],
  factorio: () => [[path.join(U.appData(), 'Factorio', 'saves')]],
  lethalcompany: () => [[path.join(LL(), 'ZeekerssRBLX', 'Lethal Company')]],
  repo: () => [[path.join(LL(), 'semiwork', 'Repo', 'saves')]],
  dst: () => [inDocs('Klei', 'DoNotStarveTogether')],
  ets2: () => [inDocs('Euro Truck Simulator 2', 'profiles')],
  hoi4: () => [inDocs('Paradox Interactive', 'Hearts of Iron IV', 'save games')],
  sevendays: () => [[path.join(U.appData(), '7DaysToDie', 'Saves')]],
  gta5: () => [inDocs('Rockstar Games', 'GTA V', 'Profiles'), inDocs('Rockstar Games', 'GTAV Enhanced', 'Profiles')],
  sotf: () => [[path.join(LL(), 'Endnight', 'SonsOfTheForest', 'Saves')]],
  schedule1: () => [[path.join(LL(), 'TVGS', 'Schedule I', 'Saves')]],
  mysummercar: () => [[path.join(LL(), 'Amistech', 'My Summer Car')]],
  mywintercar: () => [[path.join(LL(), 'Amistech', 'My Winter Car')]],
  teardown: () => [[path.join(U.localAppData(), 'Teardown')]],
  stalker2: () => [[path.join(U.localAppData(), 'Stalker2', 'Saved', 'Steam', 'SaveGames'), path.join(U.localAppData(), 'Stalker2', 'Saved', 'SaveGames')]],
  metroexodus: () => [[path.join(SAVED(), 'metro exodus')]],
  payday3: () => [[path.join(U.localAppData(), 'PAYDAY3', 'Saved', 'SaveGames')]],
  readyornot: () => [[path.join(U.localAppData(), 'ReadyOrNot', 'Saved', 'SaveGames')]],
  citiesskylines: () => [[path.join(U.localAppData(), 'Colossal Order', 'Cities_Skylines', 'Saves')]],
  citiesskylines2: () => [[path.join(LL(), 'Colossal Order', 'Cities Skylines II', 'Saves')]],
  stalkersoc: g => [[path.join(g, '_appdata_', 'savedgames'), 'C:\\Users\\Public\\Documents\\STALKER-SHOC\\savedgames', ...inDocs('STALKER-SHOC', 'savedgames')]],
  stalkercs: g => [[path.join(g, '_appdata_', 'savedgames'), 'C:\\Users\\Public\\Documents\\STALKER-STCS\\savedgames']],
  stalkercop: g => [[path.join(g, '_appdata_', 'savedgames'), 'C:\\Users\\Public\\Documents\\STALKER-COP\\savedgames']],
  contentwarning: () => [[path.join(LL(), 'Landfall Games', 'Content Warning')]],
};

/**
 * Foldery zapisów gry. ctx: { gamePath, profileRoot (Minecraft), steamRoots, appid, userdata }
 */
function paths(game, ctx = {}) {
  if (game.id === 'minecraft') return ctx.profileRoot ? [path.join(ctx.profileRoot, 'saves')].filter(U.isDir) : [];
  if (game.id === 'transportfever2') return (ctx.userdata || []).map(d => path.join(d, 'local', 'save')).filter(U.isDir);
  const fn = SAVES[game.id];
  const out = [];
  if (fn) for (const group of fn(ctx.gamePath || '')) { const p = group.find(U.isDir); if (p && !out.includes(p)) out.push(p); }
  // zapasowo: zapisy w chmurze Steam (userdata/<konto>/<appid>/remote)
  if (!out.length && ctx.appid) for (const r of ctx.steamRoots || []) for (const u of U.listDirs(path.join(r, 'userdata'))) { const p = path.join(u, String(ctx.appid), 'remote'); if (U.isDir(p)) out.push(p); }
  return out;
}

module.exports = { paths, SAVES };
