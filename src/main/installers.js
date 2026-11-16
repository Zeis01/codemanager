// Instalatory modloaderów (gry)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const N = require('./net');
const { bepinexInfo, melonInfo } = require('./compat/unity');

const LOADERS = [
  { id: 'bepinex5', name: 'BepInEx 5', games: ['lethalcompany', 'repo', 'contentwarning'], desc: 'Uniwersalny loader dla gier Unity (Mono). Pobierany z GitHub (BepInEx/BepInEx).', kind: 'folder' },
  { id: 'melonloader', name: 'MelonLoader', games: ['schedule1'], desc: 'Loader dla gier Unity (IL2CPP i Mono). Pobierany z GitHub (LavaGang/MelonLoader).', kind: 'folder' },
  { id: 'redloader', name: 'RedLoader', games: ['sotf'], desc: 'Loader modów dla Sons of the Forest. Pobierany z GitHub (ToniMacaroni/RedLoader).', kind: 'folder' },
  { id: 'fabric', name: 'Fabric', games: ['minecraft'], desc: 'Lekki loader modów Minecraft. Instalator z meta.fabricmc.net.', kind: 'minecraft' },
  { id: 'quilt', name: 'Quilt', games: ['minecraft'], desc: 'Fork Fabric zgodny z większością modów Fabric.', kind: 'minecraft' },
  { id: 'forge', name: 'Forge', games: ['minecraft'], desc: 'Klasyczny loader modów Minecraft (files.minecraftforge.net).', kind: 'minecraft' },
  { id: 'neoforge', name: 'NeoForge', games: ['minecraft'], desc: 'Następca Forge dla MC 1.20.2+ (maven.neoforged.net).', kind: 'minecraft' },
  { id: 'tmodloader', name: 'tModLoader', games: ['terraria'], desc: 'Darmowy dodatek w Steam – instalowany przez klienta Steam.', kind: 'link', url: 'steam://install/1281930' },
  { id: 'scripthookv', name: 'Script Hook V', games: ['gta5'], desc: 'Licencja zabrania redystrybucji – CodeManager otworzy oficjalną stronę dev-c.com.', kind: 'link', url: 'https://www.dev-c.com/gtav/scripthookv/' },
];

function backupDir(userData, tag) { return path.join(userData, 'backups', tag + '-' + new Date().toISOString().replace(/[:.]/g, '-')); }

function status(id, root) {
  if (!root) return { installed: false };
  if (id === 'bepinex5') { const b = bepinexInfo(root); return { installed: b.installed, version: b.version }; }
  if (id === 'melonloader') { const m = melonInfo(root); return { installed: m.installed, version: m.version }; }
  if (id === 'redloader') return { installed: U.isDir(path.join(root, '_RedLoader')) };
  if (id === 'tmodloader') return { installed: U.exists(path.join(root, 'tModLoader.dll')) };
  if (id === 'scripthookv') return { installed: U.exists(path.join(root, 'ScriptHookV.dll')) };
  return { installed: null };
}

function runJava(java, args, cwd, log) {
  return new Promise((res, rej) => {
    log(`> ${java} ${args.join(' ')}`);
    const p = spawn(java, args, { cwd, windowsHide: true });
    p.stdout.on('data', d => log(String(d).trimEnd()));
    p.stderr.on('data', d => log(String(d).trimEnd()));
    p.on('close', c => c === 0 ? res() : rej(new Error('Instalator zakończył się kodem ' + c)));
    p.on('error', rej);
  });
}

// Różne wersje instalatorów używają różnych nazw flag – próbujemy kolejno
async function runFlags(java, jar, flags, dir, log) {
  let lastErr;
  for (const f of flags) {
    try { await runJava(java, ['-jar', jar, f, dir], dir, log); return; } catch (e) { lastErr = e; log(`Flaga ${f} nie zadziałała, próbuję kolejnej…`); }
  }
  throw lastErr;
}

async function latestMaven(metaUrl) {
  const xml = await N.getText(metaUrl);
  const rel = xml.match(/<release>([^<]+)<\/release>/) || xml.match(/<latest>([^<]+)<\/latest>/);
  return rel ? rel[1] : null;
}

async function forgeVersion(mc) {
  const j = await N.getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  return j.promos[`${mc}-recommended`] || j.promos[`${mc}-latest`] || null;
}
async function neoforgeVersion(mc) {
  const parts = mc.split('.');
  if (U.cmpVer(mc, '1.20.2') < 0) throw new Error('NeoForge dla tej wersji nie istnieje (wymagane MC 1.20.2+).');
  // MC 1.21.1 -> 21.1.x, MC 1.21 -> 21.0.x; od 2025 r. także schemat 26.1.x dla MC 26.1
  const prefix = parts[0] === '1' ? `${parts[1]}.${parts[2] || 0}.` : `${parts[0]}.${parts[1] || 0}.`;
  const j = await N.getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  const list = (j.versions || []).filter(v => v.startsWith(prefix));
  const stable = list.filter(v => !/beta|alpha/i.test(v));
  return (stable.length ? stable : list).sort(U.cmpVer).pop() || null;
}
async function fabricLatest() {
  const loaders = await N.getJSON('https://meta.fabricmc.net/v2/versions/loader');
  const inst = await N.getJSON('https://meta.fabricmc.net/v2/versions/installer');
  return { loader: (loaders.find(l => l.stable) || loaders[0]).version, installer: (inst.find(i => i.stable) || inst[0]) };
}

/**
 * opts: { root, mcVersion, java, userData, side: 'client'|'server' }
 */
async function install(id, opts, log, progress) {
  const { root } = opts;
  if (id === 'bepinex5' || id === 'melonloader' || id === 'redloader') {
    if (!root || !U.isDir(root)) throw new Error('Nieprawidłowy folder gry');
    let rel;
    if (id === 'bepinex5') rel = await N.githubLatest('BepInEx/BepInEx', U.isWin ? /^BepInEx_(win_)?x64_5\.[\d.]+\.zip$/i : /^BepInEx_(unix|linux_x64)_5\.[\d.]+\.zip$/i);
    if (id === 'melonloader') rel = await N.githubLatest('LavaGang/MelonLoader', /^MelonLoader\.x64\.zip$/i);
    if (id === 'redloader') rel = await N.githubLatest('ToniMacaroni/RedLoader', /\.zip$/i);
    log(`Pobieranie ${rel.name} (${rel.tag})…`);
    const tmp = await N.download(rel.url, N.tempFile(rel.name), progress);
    const bdir = backupDir(opts.userData, id);
    const written = N.extractZip(tmp, root, { backupDir: bdir });
    log(`Rozpakowano ${written.length} plików do ${root}`);
    if (U.isDir(bdir)) log(`Kopia nadpisanych plików: ${bdir}`);
    fs.rmSync(tmp, { force: true });
    if (id === 'bepinex5') { fs.mkdirSync(path.join(root, 'BepInEx', 'plugins'), { recursive: true }); log('Uruchom grę raz, aby BepInEx utworzył pliki konfiguracyjne.'); }
    if (id === 'melonloader') { fs.mkdirSync(path.join(root, 'Mods'), { recursive: true }); log('Pierwsze uruchomienie gry potrwa dłużej – MelonLoader generuje biblioteki.'); }
    if (id === 'redloader') fs.mkdirSync(path.join(root, 'Mods'), { recursive: true });
    return { ok: true, version: rel.tag };
  }

  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(id)) {
    const mc = opts.mcVersion; if (!mc) throw new Error('Podaj wersję Minecrafta');
    const java = opts.java || 'java';
    const side = opts.side || 'client';
    const dir = root;
    fs.mkdirSync(dir, { recursive: true });
    if (side === 'client' && !U.exists(path.join(dir, 'launcher_profiles.json')) && (id === 'forge' || id === 'neoforge' || id === 'fabric')) {
      fs.writeFileSync(path.join(dir, 'launcher_profiles.json'), JSON.stringify({ profiles: {} }, null, 2));
    }
    if (id === 'fabric') {
      const f = await fabricLatest();
      const jar = await N.download(f.installer.url, N.tempFile(`fabric-installer-${f.installer.version}.jar`), progress);
      if (side === 'client') await runJava(java, ['-jar', jar, 'client', '-dir', dir, '-mcversion', mc, '-loader', f.loader], dir, log);
      else await runJava(java, ['-jar', jar, 'server', '-dir', dir, '-mcversion', mc, '-loader', f.loader, '-downloadMinecraft'], dir, log);
      return { ok: true, version: f.loader };
    }
    if (id === 'quilt') {
      const v = await latestMaven('https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml');
      const jar = await N.download(`https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${v}/quilt-installer-${v}.jar`, N.tempFile(`quilt-installer-${v}.jar`), progress);
      if (side === 'client') await runJava(java, ['-jar', jar, 'install', 'client', mc, `--install-dir=${dir}`], dir, log);
      else await runJava(java, ['-jar', jar, 'install', 'server', mc, '--download-server', `--install-dir=${dir}`], dir, log);
      return { ok: true, version: v };
    }
    if (id === 'forge') {
      const v = await forgeVersion(mc); if (!v) throw new Error('Brak Forge dla Minecraft ' + mc);
      const full = `${mc}-${v}`;
      const jar = await N.download(`https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`, N.tempFile(`forge-${full}-installer.jar`), progress);
      try { await runFlags(java, jar, side === 'client' ? ['--installClient'] : ['--installServer'], dir, log); }
      catch (e) { if (side !== 'client') throw e; log('Instalacja w trybie wiersza poleceń nie powiodła się – otwieram okno instalatora Forge…'); spawn(java, ['-jar', jar], { detached: true }); }
      return { ok: true, version: v };
    }
    if (id === 'neoforge') {
      const v = await neoforgeVersion(mc); if (!v) throw new Error('Brak NeoForge dla Minecraft ' + mc);
      const jar = await N.download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`, N.tempFile(`neoforge-${v}-installer.jar`), progress);
      try { await runFlags(java, jar, side === 'client' ? ['--install-client', '--installClient'] : ['--install-server', '--installServer'], dir, log); }
      catch (e) { if (side !== 'client') throw e; log('Otwieram okno instalatora NeoForge…'); spawn(java, ['-jar', jar], { detached: true }); }
      return { ok: true, version: v };
    }
  }
  throw new Error('Nieznany instalator: ' + id);
}

module.exports = { LOADERS, install, status, forgeVersion, neoforgeVersion, fabricLatest, latestMaven, runJava, runFlags };
