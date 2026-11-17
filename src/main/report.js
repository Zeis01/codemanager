// Raport do wysłania (Discord, forum): lista modów, wersje, system i błąd w jednym pliku tekstowym
'use strict';
const os = require('os');

// ścieżki z nazwą użytkownika zamieniamy na %USERPROFILE%, żeby nie zdradzać loginu
function anonymize(text) {
  const home = os.homedir();
  let t = String(text || '');
  if (home && home.length > 3) t = t.split(home).join('%USERPROFILE%').split(home.replace(/\\/g, '/')).join('%USERPROFILE%');
  const user = os.userInfo().username;
  if (user && user.length > 2) t = t.replace(new RegExp(`([\\\\/])${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\\\/])`, 'gi'), '$1<użytkownik>$2');
  return t;
}
const gb = b => (b / 1024 ** 3).toFixed(1) + ' GB';
const cell = s => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\r?\n/g, ' ');

/**
 * opts: { appVersion, electron, target: { kind, name, detail, path }, report (zgodność), analysis (analizator), mods, logTail, file }
 */
function build(opts) {
  const L = [];
  const cpu = (os.cpus()[0] || {}).model || 'nieznany';
  L.push('# Raport CodeManager', '');
  L.push(`- Data: ${new Date().toLocaleString('pl-PL')}`);
  L.push(`- Program: CodeManager ${opts.appVersion || ''}${opts.electron ? ` (Electron ${opts.electron})` : ''}`);
  L.push(`- System: ${os.type()} ${os.release()} (${os.arch()}), procesor: ${cpu.trim()}, RAM: ${gb(os.totalmem())}`);
  if (opts.target) {
    L.push(`- ${opts.target.kind === 'server' ? 'Serwer' : 'Gra'}: ${opts.target.name}${opts.target.detail ? ` – ${opts.target.detail}` : ''}`);
    if (opts.target.path) L.push(`- Folder: ${opts.target.path}`);
  }
  if (opts.report && opts.report.meta) for (const [k, v] of Object.entries(opts.report.meta)) L.push(`- ${k}: ${v}`);
  L.push('');
  if (opts.analysis && opts.analysis.findings) {
    L.push('## Analiza logu', '');
    if (opts.file) L.push(`Plik: ${opts.file}`, '');
    if (!opts.analysis.findings.length) L.push('Nie rozpoznano znanych problemów.');
    for (const f of opts.analysis.findings) {
      L.push(`- [${f.level.toUpperCase()}] ${f.title}${f.mod ? ` (mod: ${f.mod})` : ''}`);
      if (f.why) L.push(`  - Dlaczego: ${f.why}`);
      if (f.fix) L.push(`  - Co zrobić: ${f.fix}`);
    }
    L.push('');
  }
  if (opts.report && opts.report.issues) {
    const iss = opts.report.issues.filter(i => i.level === 'error' || i.level === 'warn');
    L.push(`## Zgodność modów (${opts.report.counts ? `${opts.report.counts.error} błędów, ${opts.report.counts.warn} ostrzeżeń` : iss.length})`, '');
    if (!iss.length) L.push('Brak błędów i ostrzeżeń.');
    for (const i of iss) L.push(`- [${i.level === 'error' ? 'BŁĄD' : 'UWAGA'}] ${i.title}${i.fix ? ` – ${i.fix}` : ''}`);
    L.push('');
  }
  const mods = opts.mods || (opts.report && opts.report.mods) || [];
  if (mods.length) {
    L.push(`## Mody (${mods.length}, włączonych: ${mods.filter(m => m.enabled).length})`, '');
    L.push('| Wł. | Nazwa | Wersja | Źródło |', '| --- | --- | --- | --- |');
    for (const m of mods) L.push(`| ${m.enabled ? '✔' : '–'} | ${cell(m.name)} | ${cell(m.version || '')} | ${cell(m.source || '')} |`);
    L.push('');
  }
  if (opts.logTail) {
    L.push('## Końcówka logu', '', '```', String(opts.logTail).split(/\r?\n/).slice(-80).join('\n'), '```', '');
  }
  return anonymize(L.join('\n'));
}

module.exports = { build, anonymize };
