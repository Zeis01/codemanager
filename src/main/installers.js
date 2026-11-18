// Instalatory modloaderów (gry)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const N = require('./net');
const { bepinexInfo, melonInfo } = require('./compat/unity');

const LOADERS = [
  { id: 'bepinex5', name: 'BepInEx 5', games: ['lethalcompany', 'repo', 'contentwarning', 'subnautica', 'subnauticabz'], desc: 'Uniwersalny loader dla gier Unity (Mono). Pobierany z GitHub (BepInEx/BepInEx).', kind: 'folder' },
  { id: 'melonloader', name: 'MelonLoader', games: ['schedule1', 'phasmophobia', 'cms2021'], desc: 'Loader dla gier Unity (IL2CPP i Mono). Pobierany z GitHub (LavaGang/MelonLoader).', kind: 'folder' },
  { id: 'redloader', name: 'RedLoader', games: ['sotf'], desc: 'Loader modów dla Sons of the Forest. Pobierany z GitHub (ToniMacaroni/RedLoader).', kind: 'folder' },
  { id: 'fabric', name: 'Fabric', games: ['minecraft'], desc: 'Lekki loader modów Minecraft. Instalator z meta.fabricmc.net.', kind: 'minecraft' },
  { id: 'quilt', name: 'Quilt', games: ['minecraft'], desc: 'Fork Fabric zgodny z większością modów Fabric.', kind: 'minecraft' },
  { id: 'forge', name: 'Forge', games: ['minecraft'], desc: 'Klasyczny loader modów Minecraft (files.minecraftforge.net).', kind: 'minecraft' },
  { id: 'neoforge', name: 'NeoForge', games: ['minecraft'], desc: 'Następca Forge dla MC 1.20.2+ (maven.neoforged.net).', kind: 'minecraft' },
  { id: 'tmodloader', name: 'tModLoader', games: ['terraria'], desc: 'Darmowy dodatek w Steam – instalowany przez klienta Steam.', kind: 'link', url: 'steam://install/1281930' },
  { id: 'skse', name: 'SKSE64', games: ['skyrimse'], desc: 'Skyrim Script Extender – wymagany przez większość modów z wtyczkami DLL. Pobierany z skse.silverlock.org (wersja dobierana do gry).', kind: 'folder' },
  { id: 'f4se', name: 'F4SE', games: ['fallout4'], desc: 'Fallout 4 Script Extender – pobierany z f4se.silverlock.org (wersja dobierana do gry).', kind: 'folder' },
  { id: 'bepinex6', name: 'BepInEx 6 (IL2CPP)', games: ['amongus'], desc: 'BepInExPack przygotowany dla Among Us – pobierany z Thunderstore (BepInEx/BepInExPack_AmongUs).', kind: 'folder' },
  { id: 'lumafly', name: 'Modding API (Lumafly)', games: ['hollowknight'], desc: 'Modding API instaluje się przez menedżer Lumafly – CodeManager otworzy jego stronę.', kind: 'link', url: 'https://themulhima.github.io/Lumafly/' },
  { id: 'rml', name: 'Raft Mod Loader', games: ['raft'], desc: 'Raft Mod Loader pobierzesz z raftmodding.com – CodeManager otworzy stronę.', kind: 'link', url: 'https://www.raftmodding.com/loader' },
  { id: 'asiloader', name: 'Ultimate ASI Loader', games: ['gtasa', 'gta4'], desc: 'Wczytuje mody .asi. Pobierany z GitHub (ThirteenAG/Ultimate-ASI-Loader) jako dinput8.dll.', kind: 'folder' },
  { id: 'cleo', name: 'CLEO', games: ['gtasa'], desc: 'Biblioteka skryptów CLEO dla GTA SA 1.0 US – CodeManager otworzy cleo.li.', kind: 'link', url: 'https://cleo.li/' },
  { id: 'fusionfix', name: 'FusionFix', games: ['gta4'], desc: 'Poprawki GTA IV (Complete Edition). Pobierany z GitHub (ThirteenAG/GTAIV.EFLC.FusionFix).', kind: 'folder' },
  { id: 'scripthookv', name: 'Script Hook V', games: ['gta5'], desc: 'Licencja zabrania redystrybucji – CodeManager otworzy oficjalną stronę dev-c.com.', kind: 'link', url: 'https://www.dev-c.com/gtav/scripthookv/' },
];

// Script Extendery Bethesdy: strona silverlock.org podaje archiwa .7z dla kolejnych wersji gry
const SE = {
  skse: { site: 'https://skse.silverlock.org/', re: /beta\/(skse64_\d+_\d+_\d+(?:_gog)?\.7z)/gi, loader: 'skse64_loader.exe', dll: /^skse64_\d+_\d+_\d+\.dll$/i, exe: 'SkyrimSE.exe', legacy: [['1.5.97', 'skse64_2_00_20.7z']] },
  f4se: { site: 'https://f4se.silverlock.org/', re: /beta\/(f4se_\d+_\d+_\d+\.7z)/gi, loader: 'f4se_loader.exe', dll: /^f4se_\d+_\d+_\d+\.dll$/i, exe: 'Fallout4.exe', legacy: [['1.10.163', 'f4se_0_06_23.7z']] },
};
function pickSeArchive(html, se, gameVersion, gog) {
  const all = [...new Set([...String(html).matchAll(se.re)].map(m => m[1]))];
  const legacy = gameVersion && se.legacy.find(([v]) => gameVersion.startsWith(v));
  if (legacy && all.includes(legacy[1])) return legacy[1];
  return all.find(n => gog ? /_gog\.7z$/i.test(n) : !/_gog\.7z$/i.test(n)) || all[0] || null;
}
async function installScriptExtender(id, root, log, progress, userData) {
  const se = SE[id];
  if (!root || !U.exists(path.join(root, se.exe))) throw new Error('W folderze gry nie ma ' + se.exe);
  const gv = (require('./parsers/binary').peVersion(path.join(root, se.exe)) || {}).file || null;
  const gog = U.exists(path.join(root, 'Galaxy64.dll')) || U.listFiles(root).some(f => /^goggame-/i.test(path.basename(f)));
  log(`Wersja gry: ${gv || 'nieznana'}${gog ? ' (GOG)' : ''}`);
  const html = await N.getText(se.site);
  const name = pickSeArchive(html, se, gv, gog);
  if (!name) throw new Error('Nie znaleziono archiwum na ' + se.site + ' – pobierz je ręcznie.');
  log(`Pobieranie ${name}…`);
  const arch = await N.download(se.site + 'beta/' + name, N.tempFile(name), progress);
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cm-se-'));
  try {
    await N.extract7z(arch, tmp, log);
    const top = U.walk(tmp, { maxDepth: 3 }).find(r => path.basename(r).toLowerCase() === se.loader);
    if (!top) throw new Error('Archiwum ma nieoczekiwaną zawartość.');
    const src = path.join(tmp, path.dirname(top));
    const bdir = backupDir(userData, id);
    let n = 0;
    for (const f of U.listFiles(src).filter(f => /\.(exe|dll)$/i.test(f))) { const dst = path.join(root, path.basename(f)); if (U.exists(dst)) { fs.mkdirSync(bdir, { recursive: true }); fs.copyFileSync(dst, path.join(bdir, path.basename(f))); } fs.copyFileSync(f, dst); n++; }
    if (U.isDir(path.join(src, 'Data'))) U.copyRecursive(path.join(src, 'Data'), path.join(root, 'Data'), { backupDir: bdir, rootForBackup: root });
    log(`✔ Skopiowano ${n} plików do folderu gry. Uruchamiaj grę przez ${se.loader} (CodeManager robi to sam przy „Uruchom”).`);
    return { ok: true, version: name.replace(/\.7z$/, '') };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(arch, { force: true }); }
}

function backupDir(userData, tag) { return path.join(userData, 'backups', tag + '-' + new Date().toISOString().replace(/[:.]/g, '-')); }

function status(id, root) {
  if (!root) return { installed: false };
  if (id === 'bepinex5') { const b = bepinexInfo(root); return { installed: b.installed, version: b.version }; }
  if (id === 'melonloader') { const m = melonInfo(root); return { installed: m.installed, version: m.version }; }
  if (id === 'redloader') return { installed: U.isDir(path.join(root, '_RedLoader')) };
  if (id === 'bepinex6') { const b = bepinexInfo(root); return { installed: b.installed, version: b.version }; }
  if (id === 'lumafly') { const m = U.firstExisting([path.join(root, 'hollow_knight_Data', 'Managed', 'Assembly-CSharp.dll')]); return { installed: m ? !!require('./parsers/binary').fileContains(m, ['ModHooks']).ModHooks : false }; }
  if (id === 'asiloader') { const r = U.exists(path.join(root, 'GTAIV', 'GTAIV.exe')) ? path.join(root, 'GTAIV') : root; return { installed: ['dinput8.dll', 'vorbisHooked.dll', 'xlive.dll'].some(f => U.exists(path.join(r, f))) }; }
  if (id === 'cleo') return { installed: U.exists(path.join(root, 'cleo.asi')) };
  if (id === 'fusionfix') { const r = U.exists(path.join(root, 'GTAIV', 'GTAIV.exe')) ? path.join(root, 'GTAIV') : root; return { installed: U.listFiles(path.join(r, 'plugins')).some(f => /fusionfix\.asi$/i.test(f)) }; }
  if (id === 'rml') return { installed: null };
  if (id === 'tmodloader') return { installed: U.exists(path.join(root, 'tModLoader.dll')) };
  if (id === 'scripthookv') return { installed: U.exists(path.join(root, 'ScriptHookV.dll')) };
  if (id === 'skse' || id === 'f4se') { const se = SE[id]; const dll = U.listFiles(root).map(f => path.basename(f)).find(f => se.dll.test(f)); return { installed: U.exists(path.join(root, se.loader)), version: dll ? dll.match(/_(\d+_\d+_\d+)\.dll$/i)[1].replace(/_/g, '.') : null }; }
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
  if (id === 'skse' || id === 'f4se') return installScriptExtender(id, root, log, progress, opts.userData);
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

  if (id === 'bepinex6') {
    const j = await N.getJSON('https://thunderstore.io/api/experimental/package/BepInEx/BepInExPack_AmongUs/');
    log(`Pobieranie BepInExPack_AmongUs ${j.latest.version_number}…`);
    const tmp = await N.download(j.latest.download_url, N.tempFile('BepInExPack_AmongUs.zip'), progress);
    const names = new (require('adm-zip'))(tmp).getEntries().map(e => e.entryName.replace(/\\/g, '/'));
    const core = names.find(n => /(^|\/)BepInEx\/core\//.test(n)); const sub = core ? core.slice(0, core.indexOf('BepInEx/core/')).replace(/\/$/, '') : '';
    const written = N.extractZip(tmp, root, { subdir: sub || null, backupDir: backupDir(opts.userData, id) });
    fs.mkdirSync(path.join(root, 'BepInEx', 'plugins'), { recursive: true });
    log(`Rozpakowano ${written.length} plików. Uruchom grę raz – BepInEx 6 wygeneruje biblioteki (to potrwa).`);
    return { ok: true, version: j.latest.version_number };
  }
  if (id === 'asiloader' || id === 'fusionfix') {
    const r = U.exists(path.join(root, 'GTAIV', 'GTAIV.exe')) ? path.join(root, 'GTAIV') : root;
    const rel = id === 'asiloader' ? await N.githubLatest('ThirteenAG/Ultimate-ASI-Loader', /^Ultimate-ASI-Loader\.zip$/i) : await N.githubLatest('ThirteenAG/GTAIV.EFLC.FusionFix', /^GTAIV\.EFLC\.FusionFix\.zip$/i);
    log(`Pobieranie ${rel.name} (${rel.tag})…`);
    const tmp = await N.download(rel.url, N.tempFile(rel.name), progress);
    const bdir = backupDir(opts.userData, id);
    if (id === 'asiloader') {
      const z = new (require('adm-zip'))(tmp); const e = z.getEntries().find(x => /dinput8\.dll$/i.test(x.entryName));
      if (!e) throw new Error('W archiwum nie ma dinput8.dll.');
      const t = path.join(r, 'dinput8.dll'); if (U.exists(t)) { fs.mkdirSync(bdir, { recursive: true }); fs.copyFileSync(t, path.join(bdir, 'dinput8.dll')); }
      fs.writeFileSync(t, e.getData()); fs.mkdirSync(path.join(r, 'scripts'), { recursive: true });
      log('Zainstalowano dinput8.dll. Mody .asi wrzucaj do folderu gry lub scripts.');
    } else { const w = N.extractZip(tmp, r, { backupDir: bdir }); log(`Rozpakowano ${w.length} plików FusionFix.`); }
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

module.exports = { pickSeArchive, SE, LOADERS, install, status, forgeVersion, neoforgeVersion, fabricLatest, latestMaven, runJava, runFlags };
