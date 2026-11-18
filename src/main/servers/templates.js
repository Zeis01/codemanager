// Szablony serwerów: gotowe zestawy (silnik + mody/pluginy/frameworki) instalowane po utworzeniu serwera
'use strict';

const TEMPLATES = [
  { id: 'mc-fabric-perf', type: 'minecraft', variant: 'fabric', ram: 4096, name: 'Minecraft Fabric – wydajność', desc: 'Fabric z modami przyspieszającymi serwer bez zmian w rozgrywce: Lithium, FerriteCore, Krypton, C2ME, ModernFix i spark do pomiarów.', steps: [{ modrinth: ['fabric-api', 'lithium', 'ferrite-core', 'krypton', 'c2me-fabric', 'modernfix', 'spark'] }] },
  { id: 'mc-fabric-pregen', type: 'minecraft', variant: 'fabric', ram: 6144, name: 'Minecraft Fabric – wydajność + Chunky', desc: 'Jak wyżej, plus Chunky do wygenerowania mapy przed wpuszczeniem graczy (mniej lagów przy eksploracji).', steps: [{ modrinth: ['fabric-api', 'lithium', 'ferrite-core', 'krypton', 'modernfix', 'spark', 'chunky'] }] },
  { id: 'mc-paper-basic', type: 'minecraft', variant: 'paper', ram: 4096, name: 'Minecraft Paper – podstawowe pluginy', desc: 'Paper z LuckPerms (uprawnienia), ViaVersion (wejście z nowszych wersji gry), Chunky i spark.', steps: [{ modrinth: ['luckperms', 'viaversion', 'chunky', 'spark'], type: 'plugin' }] },
  { id: 'mc-neoforge-perf', type: 'minecraft', variant: 'neoforge', ram: 6144, name: 'Minecraft NeoForge – pod paczki modów', desc: 'NeoForge z FerriteCore, ModernFix i spark – dobra baza pod większe paczki modów.', steps: [{ modrinth: ['ferrite-core', 'modernfix', 'spark'] }] },
  { id: 'valheim-bepinex', type: 'valheim', name: 'Valheim + BepInEx', desc: 'Serwer Valheim z BepInEx, gotowy na mody z Thunderstore.', steps: [{ framework: 'bepinex-valheim' }] },
  { id: 'rust-oxide', type: 'rust', name: 'Rust + Oxide (uMod)', desc: 'Serwer Rust z Oxide – najpopularniejszy framework pluginów.', steps: [{ framework: 'oxide' }] },
  { id: 'rust-carbon', type: 'rust', name: 'Rust + Carbon', desc: 'Serwer Rust z Carbon – szybszy następca Oxide, zgodny z większością pluginów uMod.', steps: [{ framework: 'carbon' }] },
  { id: 'cs2-css', type: 'cs2', name: 'CS2 + Metamod + CounterStrikeSharp', desc: 'Serwer Counter-Strike 2 gotowy na pluginy CounterStrikeSharp.', steps: [{ framework: 'metamod2' }, { framework: 'counterstrikesharp' }] },
  { id: 'l4d2-sourcemod', type: 'l4d2', name: 'L4D2 + Metamod + SourceMod', desc: 'Serwer Left 4 Dead 2 z SourceMod.', steps: [{ framework: 'metamod112' }, { framework: 'sourcemod' }] },
  { id: 'unturned-rocket', type: 'unturned', name: 'Unturned + RocketMod', desc: 'Serwer Unturned z wbudowanym RocketMod.', steps: [{ framework: 'rocketmod' }] },
  { id: 'unturned-openmod', type: 'unturned', name: 'Unturned + OpenMod', desc: 'Serwer Unturned z OpenMod.', steps: [{ framework: 'openmod' }] },
  { id: 'tf2-sourcemod', type: 'tf2', name: 'TF2 + Metamod + SourceMod', desc: 'Serwer Team Fortress 2 z SourceMod.', steps: [{ framework: 'metamod112' }, { framework: 'sourcemod' }] },
];

const byId = id => TEMPLATES.find(t => t.id === id);

/**
 * Wykonuje kroki szablonu po instalacji serwera.
 * deps: { servers (ServerManager), modrinth, log(serverId, line), backupRoot }
 */
async function runSteps(t, server, deps) {
  const log = l => deps.servers.log(server.id, l);
  log(`=== Szablon: ${t.name} ===`);
  for (const step of t.steps) {
    if (step.framework) {
      try { await deps.servers.installFramework(server.id, step.framework); } catch (e) { log('⚠ ' + e.message); }
    }
    if (step.modrinth) {
      const plugin = step.type === 'plugin';
      const modsDir = require('path').join(server.path, plugin ? 'plugins' : 'mods');
      for (const slug of step.modrinth) {
        try {
          const r = await deps.modrinth.install(slug, { modsDir, mcVersion: server.version, loader: server.variant, log, backupRoot: deps.backupRoot });
          if (!r.length) log(`✔ ${slug} – już jest`);
        } catch (e) { log(`⚠ ${slug}: ${e.message}`); }
      }
    }
  }
  log('✔ Szablon zastosowany. Uruchom serwer, aby wczytał mody.');
}

module.exports = { TEMPLATES, byId, runSteps };
