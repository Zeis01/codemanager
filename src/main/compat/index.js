// Dyspozytor sprawdzania zgodności dla gier
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const { byId } = require('../games');
const mc = require('./minecraft');
const unity = require('./unity');
const G = require('./games');
const G2 = require('./games2');
const G3 = require('./games3');
const { toggleByRename } = require('./common');

// Profile (instancje) dla gry – np. instancje Minecrafta lub profile r2modman
function profiles(gameId, info) {
  const game = byId(gameId);
  if (!info || !info.found) return [];
  if (gameId === 'minecraft') return (info.instances || []).map(i => ({ id: i.id, name: i.name, root: i.path, mcVersion: i.mcVersion, loader: i.loader, loaderVersion: i.loaderVersion, launcher: i.launcher }));
  if (game.checker === 'bepinex' || game.checker === 'melonloader') return unity.thunderstoreProfiles(game, info.path);
  return [{ id: 'game', name: 'Folder gry', root: info.path }];
}

// Folder, do którego trafiają mody dodawane przez użytkownika
function modsTarget(gameId, profile, info) {
  const root = profile ? profile.root : info.path;
  switch (byId(gameId).checker) {
    case 'minecraft': return path.join(root, 'mods');
    case 'bepinex': return path.join(root, 'BepInEx', 'plugins');
    case 'melonloader': return path.join(root, 'Mods');
    case 'redloader': return path.join(root, 'Mods');
    case 'peopleplayground': return path.join(root, 'Mods');
    case 'transportfever2': return path.join(root, 'mods');
    case 'garrysmod': return path.join(root, 'garrysmod', 'addons');
    case 'dst': return path.join(root, 'mods');
    case 'gta5': return root;
    case 'ets2': { const d = U.documentsCandidates()[0] || U.documents(); return path.join(d, 'Euro Truck Simulator 2', 'mod'); }
    case 'projectzomboid': return path.join(U.home(), 'Zomboid', 'mods');
    case 'paradox': { const d = U.documentsCandidates()[0] || U.documents(); return path.join(d, 'Paradox Interactive', byId(gameId).paradoxFolder, 'mod'); }
    case 'tmodloader': { const d = U.documentsCandidates()[0] || U.documents(); return path.join(d, 'My Games', 'Terraria', 'tModLoader', 'Mods'); }
    case 'rimworld': return path.join(root, 'Mods');
    case 'stardew': return path.join(root, 'Mods');
    case 'factorio': return path.join(G2.factorioUserDir(root), 'mods');
    case 'bethesda': return path.join(root, 'Data');
    case 'sevendays': return path.join(root, 'Mods');
    case 'cyberpunk': return root;
    case 'witcher3': return path.join(root, 'Mods');
    case 'payday2': return path.join(root, 'mods');
    case 'mysummercar': return path.join(root, 'Mods');
    case 'teardown': return path.join(U.documents(), 'Teardown', 'mods');
    case 'xray': return root;
    case 'files': { const g = byId(gameId); if (g.manual.root) return root; const d = G3.manualDirs(g, { gamePath: root, workshop: [] })[0]; return d || root; }
    default: return root;
  }
}

function check(gameId, info, profile, settings = {}) {
  const game = byId(gameId);
  if (!info || !info.found) throw new Error('Gra nie została znaleziona – wskaż jej lokalizację.');
  const ctx = { game, info, gamePath: info.path, workshop: info.workshop || [], settings, root: profile ? profile.root : info.path, profileName: profile ? profile.name : 'Folder gry' };
  switch (game.checker) {
    case 'minecraft': {
      const p = profile || profiles(gameId, info)[0];
      if (!p) throw new Error('Brak instancji Minecrafta');
      return mc.checkMods({ modsDir: path.join(p.root, 'mods'), mcVersion: settings.mcVersion || p.mcVersion, loader: settings.loader || p.loader, loaderVersion: settings.loaderVersion || p.loaderVersion, side: 'client', title: p.name });
    }
    case 'bepinex': return unity.checkBepInEx({ ...ctx, title: game.name, expectMajor: 5 });
    case 'melonloader': return unity.checkMelonLoader({ ...ctx, title: game.name });
    case 'redloader': return unity.checkRedLoader({ ...ctx, title: game.name });
    case 'projectzomboid': return G.checkProjectZomboid(ctx);
    case 'ets2': return G.checkETS2(ctx);
    case 'peopleplayground': return G.checkPeoplePlayground(ctx);
    case 'transportfever2': return G.checkTransportFever(ctx);
    case 'paradox': return G.checkParadox(ctx);
    case 'garrysmod': return G.checkGarrysMod(ctx);
    case 'dst': return G.checkDST(ctx);
    case 'gta5': return G.checkGTA5(ctx);
    case 'tmodloader': return G.checkTModLoader(ctx);
    case 'rimworld': return G2.checkRimWorld(ctx);
    case 'stardew': return G2.checkStardew(ctx);
    case 'factorio': return G2.checkFactorio(ctx);
    case 'bethesda': return G2.checkBethesda(ctx);
    case 'sevendays': return G2.checkSevenDays(ctx);
    case 'cyberpunk': return G3.checkCyberpunk(ctx);
    case 'witcher3': return G3.checkWitcher3(ctx);
    case 'payday2': return G3.checkPayday2(ctx);
    case 'mysummercar': return G3.checkMySummerCar(ctx);
    case 'teardown': return G3.checkTeardown(ctx);
    case 'xray': return G3.checkXray(ctx);
    case 'files': return G3.checkFiles({ ...ctx, nexusInstalls: settings.__nexus || [] });
  }
  throw new Error('Brak sprawdzania dla tej gry');
}

async function online(gameId, info, profile, settings = {}) {
  const game = byId(gameId);
  if (game.checker === 'minecraft') {
    const p = profile || profiles(gameId, info)[0];
    return mc.modrinthCheck({ modsDir: path.join(p.root, 'mods'), mcVersion: settings.mcVersion || p.mcVersion, loader: settings.loader || p.loader });
  }
  if (game.checker === 'bepinex') return unity.thunderstoreOnline({ root: profile ? profile.root : info.path });
  if (game.checker === 'factorio') { const gi = U.readJSON(path.join(info.path, 'data', 'base', 'info.json'), {}); return G2.factorioUpdates(info.path, settings.gameVersion || gi.version); }
  return [{ level: 'info', title: 'Sprawdzanie online nie jest dostępne dla tej gry.' }];
}

// Przełączanie moda
function toggle(mod, ctx = {}) {
  if (mod.toggle === 'rimworld') { G2.rimToggle(mod.id, !mod.enabled); return mod.file; }
  if (mod.toggle === 'w3settings') { G3.w3Toggle(mod.id, !mod.enabled); return mod.file; }
  if (mod.toggle === 'group') {
    for (const f of mod.files || []) { const t = /\.disabled$/i.test(f) ? f.slice(0, -9) : f + '.disabled'; if (mod.enabled ? !/\.disabled$/i.test(f) : /\.disabled$/i.test(f)) fs.renameSync(f, t); }
    return mod.file;
  }
  if (mod.toggle === 'factorio') { G2.factorioToggle(ctx.gamePath, mod.id, !mod.enabled); return mod.file; }
  if (mod.toggle === 'plugins-txt') { G2.pluginsTxtToggle(ctx.gameId, mod.name, !mod.enabled); return mod.file; }
  if (mod.toggle === 'dotfolder') {
    const dir = path.dirname(mod.file); const b = path.basename(mod.file);
    const target = path.join(dir, b.startsWith('.') ? b.replace(/^\.+/, '') : '.' + b);
    fs.renameSync(mod.file, target); return target;
  }
  if (mod.toggle === 'dllold') {
    const p = mod.file;
    if (U.isDir(p)) {
      const dlls = U.walk(p, { filter: r => /\.dll(\.old)?$/i.test(r) });
      const enable = dlls.some(d => /\.old$/i.test(d)) && !dlls.some(d => /\.dll$/i.test(d));
      for (const d of dlls) {
        const full = path.join(p, d);
        if (enable && /\.old$/i.test(d)) fs.renameSync(full, full.slice(0, -4));
        if (!enable && /\.dll$/i.test(d)) fs.renameSync(full, full + '.old');
      }
      return p;
    }
    if (/\.old$/i.test(p)) { fs.renameSync(p, p.slice(0, -4)); return p.slice(0, -4); }
    fs.renameSync(p, p + '.old'); return p + '.old';
  }
  return toggleByRename(mod.file);
}

module.exports = { profiles, modsTarget, check, online, toggle };
