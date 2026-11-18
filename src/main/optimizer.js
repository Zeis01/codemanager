// Optymalizator wydajności: sprawdza sprzęt, ustawienia Windows i mody, po czym proponuje zmiany
// (pamięć dla Minecrafta, mody wydajnościowe, plan zasilania, tryb gry). Każdą zmianę zatwierdza użytkownik.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const U = require('./util');

const ps = (cmd, timeout = 15000) => new Promise(res => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (e, out) => res(e ? '' : String(out).trim())));
const run = (cmd, args, timeout = 10000) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout }, (e, out) => res(e ? '' : String(out))));

async function hardware(gamePath) {
  const cpus = os.cpus();
  const hw = { ramGB: Math.round(os.totalmem() / 1073741824 * 10) / 10, freeGB: Math.round(os.freemem() / 1073741824 * 10) / 10, cpu: cpus[0] ? cpus[0].model.trim() : '?', cores: cpus.length, gpus: [], disk: null, powerPlan: null, gameMode: null, freeDiskGB: null };
  if (U.isWin) {
    const [gpu, plan, gm] = await Promise.all([
      ps("Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }"),
      run('powercfg', ['/getactivescheme']),
      ps("(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name AutoGameModeEnabled -ErrorAction SilentlyContinue).AutoGameModeEnabled"),
    ]);
    hw.gpus = gpu.split(/\r?\n/).filter(Boolean).map(l => { const [name, ram] = l.split('|'); return { name: name.trim(), vramGB: +ram > 0 ? Math.round(+ram / 1073741824 * 10) / 10 : null }; });
    const m = plan.match(/GUID:\s*([0-9a-f-]+)\s*\((.+)\)/i); if (m) hw.powerPlan = { guid: m[1], name: m[2].trim() };
    hw.gameMode = gm === '' ? null : gm !== '0';
    if (gamePath && /^[A-Za-z]:/.test(gamePath)) {
      const letter = gamePath[0].toUpperCase();
      const d = await ps(`$p = Get-Partition -DriveLetter ${letter} -ErrorAction SilentlyContinue; if ($p) { $d = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq $p.DiskNumber }; $v = Get-Volume -DriveLetter ${letter}; "$($d.MediaType)|$($d.BusType)|$($v.SizeRemaining)|$($v.Size)" }`);
      const [media, bus, free, size] = d.split('|');
      if (media) hw.disk = { letter, type: /SSD/i.test(media) || /NVMe/i.test(bus) ? 'SSD' : /HDD/i.test(media) ? 'HDD' : media, bus };
      if (+size) { hw.freeDiskGB = Math.round(+free / 1073741824); hw.diskSizeGB = Math.round(+size / 1073741824); }
    }
  } else if (gamePath) {
    const out = await run('df', ['-k', gamePath]); const l = out.trim().split('\n')[1]; if (l) { const p = l.split(/\s+/); hw.freeDiskGB = Math.round(+p[3] / 1048576); hw.diskSizeGB = Math.round(+p[1] / 1048576); }
  }
  return hw;
}

// ---------- Minecraft: pamięć i mody wydajnościowe ----------
const PERF = {
  fabric: [['sodium', 'Sodium', 'Znacznie szybsze renderowanie (często 2–3× więcej FPS).'], ['lithium', 'Lithium', 'Szybsza logika gry i serwera bez zmian w rozgrywce.'], ['ferrite-core', 'FerriteCore', 'Mniejsze zużycie pamięci RAM.'], ['modernfix', 'ModernFix', 'Szybsze uruchamianie i mniej RAM w dużych paczkach.'], ['entityculling', 'Entity Culling', 'Nie rysuje niewidocznych mobów i skrzyń.'], ['immediatelyfast', 'ImmediatelyFast', 'Szybsze rysowanie interfejsu, tekstu i map.']],
  quilt: null,
  neoforge: [['sodium', 'Sodium', 'Od MC 1.21 Sodium działa też na NeoForge.'], ['ferrite-core', 'FerriteCore', 'Mniejsze zużycie pamięci RAM.'], ['modernfix', 'ModernFix', 'Szybsze uruchamianie i mniej RAM w dużych paczkach.'], ['entityculling', 'Entity Culling', 'Nie rysuje niewidocznych mobów i skrzyń.']],
  forge: [['embeddium', 'Embeddium', 'Szybsze renderowanie (wersja Sodium dla Forge).'], ['ferrite-core', 'FerriteCore', 'Mniejsze zużycie pamięci RAM.'], ['modernfix', 'ModernFix', 'Szybsze uruchamianie i mniej RAM w dużych paczkach.'], ['entityculling', 'Entity Culling', 'Nie rysuje niewidocznych mobów i skrzyń.']],
};
PERF.quilt = PERF.fabric;
const MOD_IDS = { sodium: ['sodium'], lithium: ['lithium'], 'ferrite-core': ['ferritecore'], modernfix: ['modernfix'], entityculling: ['entityculling'], immediatelyfast: ['immediatelyfast'], embeddium: ['embeddium', 'rubidium'] };
function recommendedRam(modCount, totalGB) {
  const want = modCount === 0 ? 2 : modCount < 50 ? 4 : modCount < 150 ? 6 : modCount < 300 ? 8 : 10;
  return Math.max(2, Math.min(want, Math.floor(totalGB / 2)));
}
// pamięć ustawiona w launcherze dla instancji
function mcMemory(inst) {
  if (inst.launcher === 'Prism Launcher') {
    const cfg = U.readText(path.join(path.dirname(inst.path), 'instance.cfg'), '');
    const max = +((cfg.match(/^MaxMemAlloc=(\d+)/m) || [])[1]); const over = /^OverrideMemory=true/m.test(cfg);
    return { max: over && max ? max : null, where: 'instance.cfg', global: !over };
  }
  if (inst.launcher === 'Minecraft Launcher') {
    const dot = inst.id === 'mc-default' ? inst.path : null;
    const lpFile = path.join(dot || defaultDotMc(), 'launcher_profiles.json');
    const lp = U.readJSON(lpFile, {});
    const prof = Object.values(lp.profiles || {}).find(p => (p.gameDir && path.resolve(p.gameDir) === path.resolve(inst.path)) || (!p.gameDir && inst.id === 'mc-default' && p.type !== 'latest-snapshot'));
    const m = prof && String(prof.javaArgs || '').match(/-Xmx(\d+)([GgMm])/);
    return { max: m ? (/g/i.test(m[2]) ? +m[1] * 1024 : +m[1]) : 2048, where: 'launcher_profiles.json', default: !(prof && prof.javaArgs) };
  }
  return { max: null, where: null };
}
function defaultDotMc() { return U.isWin ? path.join(U.appData(), '.minecraft') : U.isMac ? path.join(U.home(), 'Library', 'Application Support', 'minecraft') : path.join(U.home(), '.minecraft'); }
function setMcMemory(inst, mb) {
  mb = Math.max(1024, Math.round(+mb));
  if (inst.launcher === 'Prism Launcher') {
    const f = path.join(path.dirname(inst.path), 'instance.cfg'); let t = U.readText(f, '');
    const set = (k, v) => { t = new RegExp(`^${k}=`, 'm').test(t) ? t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : t.replace(/\s*$/, `\n${k}=${v}\n`); };
    set('OverrideMemory', 'true'); set('MaxMemAlloc', mb); set('MinMemAlloc', Math.min(1024, mb));
    fs.writeFileSync(f, t); return f;
  }
  if (inst.launcher === 'Minecraft Launcher') {
    const lpFile = path.join(inst.id === 'mc-default' ? inst.path : defaultDotMc(), 'launcher_profiles.json');
    const lp = U.readJSON(lpFile, null); if (!lp) throw new Error('Nie znaleziono launcher_profiles.json.');
    fs.copyFileSync(lpFile, lpFile + '.cm-backup');
    let n = 0;
    for (const p of Object.values(lp.profiles || {})) {
      const match = (p.gameDir && path.resolve(p.gameDir) === path.resolve(inst.path)) || (inst.id === 'mc-default' && !p.gameDir);
      if (!match) continue;
      const args = String(p.javaArgs || '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M');
      p.javaArgs = /-Xmx\d+[GgMm]/.test(args) ? args.replace(/-Xmx\d+[GgMm]/, `-Xmx${mb}M`) : `-Xmx${mb}M ${args}`;
      n++;
    }
    if (!n) throw new Error('Nie znaleziono profilu tej instalacji w launcherze.');
    fs.writeFileSync(lpFile, JSON.stringify(lp, null, 2)); return lpFile;
  }
  throw new Error('Dla tego launchera zmień pamięć w jego ustawieniach.');
}

// główna analiza: sugestie z poziomem i (opcjonalnie) akcją do wykonania
function suggest({ hw, game, report, instance }) {
  const out = [];
  const add = (level, title, detail, action) => out.push({ level, title, detail, action: action || null });
  if (hw.ramGB && hw.ramGB < 8) add('warn', `Mało pamięci RAM (${hw.ramGB} GB)`, 'Większość nowszych gier i paczek modów potrzebuje co najmniej 8 GB. Zamknij przeglądarkę i inne programy przed grą.');
  if (hw.freeGB != null && hw.ramGB && hw.freeGB / hw.ramGB < 0.2) add('info', `Wolne tylko ${hw.freeGB} GB RAM`, 'Inne programy zajmują dużo pamięci – zamknij je przed uruchomieniem gry.');
  if (hw.powerPlan && /oszcz|saver|zrównoważ|balanced/i.test(hw.powerPlan.name)) add('info', `Plan zasilania: ${hw.powerPlan.name}`, 'Plan „Wysoka wydajność” nie obniża taktowania procesora w trakcie gry. Na laptopie podłącz zasilacz.', { type: 'powerplan', label: 'Włącz wysoką wydajność' });
  if (hw.gameMode === false) add('info', 'Tryb gry Windows jest wyłączony', 'Tryb gry nadaje grze wyższy priorytet i wstrzymuje aktualizacje w tle.', { type: 'gamemode', label: 'Włącz tryb gry' });
  if (hw.disk && hw.disk.type === 'HDD') add('warn', `Gra jest na dysku HDD (${hw.disk.letter}:)`, 'Przeniesienie gry na SSD skraca wczytywanie i usuwa przycięcia przy doczytywaniu świata.');
  if (hw.freeDiskGB != null && hw.diskSizeGB && hw.freeDiskGB / hw.diskSizeGB < 0.1) add('warn', `Prawie pełny dysk (wolne ${hw.freeDiskGB} GB)`, 'Gdy na dysku jest mniej niż 10% miejsca, system i gra zwalniają. Zwolnij miejsce (np. Ustawienia → System → Pamięć).');
  if (game && game.id === 'minecraft' && instance) {
    const mods = (report && report.mods || []).filter(m => m.enabled);
    const ids = new Set(mods.map(m => String(m.id || '').toLowerCase()));
    const mem = mcMemory(instance);
    const rec = recommendedRam(mods.length, hw.ramGB || 8);
    if (mem.max) {
      if (mem.max < rec * 1024 - 256) add('warn', `Za mało pamięci dla Minecrafta: ${Math.round(mem.max / 1024 * 10) / 10} GB`, `Przy ${mods.length} modach zalecane jest ${rec} GB. Za mało pamięci powoduje przycięcia i „Out of memory”.`, { type: 'mcram', mb: rec * 1024, label: `Ustaw ${rec} GB` });
      else if (mem.max > Math.max(rec + 4, (hw.ramGB || 16) * 0.75) * 1024) add('info', `Dużo pamięci dla Minecrafta: ${Math.round(mem.max / 1024)} GB`, `Zbyt duża pamięć wydłuża przerwy na sprzątanie pamięci (lagi co kilka sekund). Zalecane: ${rec} GB.`, { type: 'mcram', mb: rec * 1024, label: `Ustaw ${rec} GB` });
    } else if (instance.launcher !== 'Prism Launcher' && instance.launcher !== 'Minecraft Launcher') add('info', `Zalecana pamięć: ${rec} GB`, `Ustaw ją w ustawieniach ${instance.launcher}.`);
    const loader = instance.loader;
    if (ids.has('optifine') && (ids.has('sodium') || ids.has('embeddium'))) add('error', 'OptiFine razem z Sodium/Embeddium', 'Te mody się wykluczają – zostaw Sodium (+ Iris do shaderów).');
    for (const [slug, name, why] of (PERF[loader] || [])) {
      if ((MOD_IDS[slug] || [slug]).some(i => ids.has(i))) continue;
      if (slug === 'sodium' && loader === 'neoforge' && instance.mcVersion && U.cmpVer(instance.mcVersion, '1.21') < 0) continue;
      add('info', `Mod wydajnościowy: ${name}`, why, { type: 'modrinth', id: slug, label: 'Zainstaluj' });
    }
    if (ids.has('distanthorizons')) add('info', 'Distant Horizons zwiększa zużycie pamięci', 'Przy dużym zasięgu LOD przydzielaj co najmniej 6–8 GB RAM.');
    if (!loader || loader === 'vanilla') add('info', 'Vanilla bez modów wydajnościowych', 'Zainstaluj Fabric (zakładka Modloader) i Sodium – to najprostszy sposób na więcej FPS.');
  }
  if (game && game.checker === 'bethesda') {
    const names = new Set((report && report.mods || []).map(m => String(m.name || '').toLowerCase()));
    if (game.id === 'skyrimse' && ![...names].some(n => /engine fixes/.test(n))) add('info', 'SSE Engine Fixes', 'Naprawia wycieki pamięci i przyspiesza wczytywanie zapisów.', { type: 'url', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/17230', label: 'Otwórz Nexus' });
    if ((report && report.mods || []).length > 250) add('info', 'Bardzo dużo pluginów', 'Rozważ scalenie mniejszych pluginów (ESL) – skraca wczytywanie.');
  }
  if (report && (report.mods || []).filter(m => m.enabled).length > 0 && hw.ramGB && hw.ramGB <= 8 && game && game.id !== 'minecraft') add('info', 'Ciężkie mody graficzne', 'Na 8 GB RAM wyłącz paczki tekstur 4K i ENB, jeśli gra przycina.');
  if (!out.length) add('ok', 'Nie znaleziono nic do poprawy', 'Sprzęt i ustawienia wyglądają dobrze.');
  return out;
}

async function applyAction(action, { instance } = {}) {
  if (action.type === 'powerplan') { if (!U.isWin) throw new Error('Tylko w Windows.'); const r = await run('powercfg', ['/setactive', 'SCHEME_MIN']); return 'Ustawiono plan zasilania „Wysoka wydajność”.' + (r === '' ? '' : ''); }
  if (action.type === 'gamemode') { if (!U.isWin) throw new Error('Tylko w Windows.'); await ps("New-Item -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name AutoGameModeEnabled -Value 1 -Type DWord"); return 'Włączono tryb gry.'; }
  if (action.type === 'mcram') { const f = setMcMemory(instance, action.mb); return `Ustawiono ${Math.round(action.mb / 1024)} GB w ${path.basename(f)}. Uruchom ponownie launcher.`; }
  throw new Error('Tę akcję wykonuje okno programu.');
}

module.exports = { hardware, suggest, applyAction, recommendedRam, mcMemory, setMcMemory, PERF };
