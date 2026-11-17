// Pobieranie plików, API GitHub, rozpakowywanie, Java
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const U = require('./util');

const UA = { 'User-Agent': 'CodeManager/1.0 (+https://github.com)' };

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
  return r.text();
}

async function download(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${r.status}): ${url}`);
  const total = +r.headers.get('content-length') || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let done = 0; let last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    done += value.length;
    if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
    if (onProgress && Date.now() - last > 150) { last = Date.now(); onProgress({ done, total, pct: total ? Math.round(done / total * 100) : null }); }
  }
  await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));
  fs.renameSync(tmp, dest);
  if (onProgress) onProgress({ done, total, pct: 100 });
  return dest;
}

async function githubLatest(repo, assetPattern, { allowPrerelease = false } = {}) {
  const rels = allowPrerelease ? await getJSON(`https://api.github.com/repos/${repo}/releases?per_page=15`) : [await getJSON(`https://api.github.com/repos/${repo}/releases/latest`)];
  for (const rel of rels) {
    const asset = (rel.assets || []).find(a => assetPattern.test(a.name));
    if (asset) return { tag: rel.tag_name, name: asset.name, url: asset.browser_download_url, published: rel.published_at };
  }
  throw new Error(`Nie znaleziono pliku pasującego do ${assetPattern} w ${repo}`);
}

function tempFile(name) { const d = path.join(os.tmpdir(), 'codemanager'); fs.mkdirSync(d, { recursive: true }); return path.join(d, Date.now() + '-' + name); }

// Rozpakowanie ZIP z opcjonalnym pominięciem katalogu głównego i kopią zapasową nadpisywanych plików
function extractZip(zipFile, dest, { strip = 0, subdir = null, backupDir = null } = {}) {
  const zip = new AdmZip(zipFile);
  const written = [];
  for (const e of zip.getEntries()) {
    let name = e.entryName.replace(/\\/g, '/');
    if (subdir) { if (!name.startsWith(subdir + '/')) continue; name = name.slice(subdir.length + 1); }
    const parts = name.split('/').slice(strip);
    if (!parts.length || !parts.join('')) continue;
    const rel = parts.join('/');
    if (rel.includes('..')) continue;
    const target = path.join(dest, rel);
    if (e.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (backupDir && U.exists(target)) { const b = path.join(backupDir, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(target, b); }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.getData());
    written.push(rel);
  }
  return written;
}
function zipTopFolder(zipFile) {
  const zip = new AdmZip(zipFile);
  const tops = new Set(zip.getEntries().map(e => e.entryName.replace(/\\/g, '/').split('/')[0]));
  return tops.size === 1 ? [...tops][0] : null;
}

function sevenZipBin() {
  let p = require('7zip-bin').path7za;
  p = p.replace('app.asar', 'app.asar.unpacked');
  try { fs.chmodSync(p, 0o755); } catch { /* */ }
  return p;
}
function extract7z(file, dest, log) {
  return new Promise((res, rej) => {
    fs.mkdirSync(dest, { recursive: true });
    const p = spawn(sevenZipBin(), ['x', '-y', `-o${dest}`, file], { windowsHide: true });
    p.stdout.on('data', d => log && log(String(d)));
    p.on('close', c => c === 0 ? res() : rej(new Error('7-Zip zakończył się kodem ' + c)));
    p.on('error', rej);
  });
}
function extractTar(file, dest) {
  return new Promise((res, rej) => {
    fs.mkdirSync(dest, { recursive: true });
    const flags = /\.xz$/.test(file) ? '-xJf' : '-xzf';
    const p = spawn(require('./servers/scheduler').tarBin(), [flags, file, '-C', dest], { windowsHide: true });
    p.on('close', c => c === 0 ? res() : rej(new Error('tar zakończył się kodem ' + c)));
    p.on('error', rej);
  });
}

// ---------- Java ----------
async function javaVersion(bin) {
  const r = await U.run(bin, ['-version']);
  const out = r.stderr + r.stdout;
  const m = out.match(/version "([^"]+)"/);
  if (!m) return null;
  let v = m[1]; if (v.startsWith('1.')) v = v.split('.')[1];
  return { path: bin, major: parseInt(v, 10), raw: m[1] };
}
async function findJavas(custom) {
  const cands = new Set();
  if (custom) cands.add(custom);
  cands.add('java');
  if (process.env.JAVA_HOME) cands.add(path.join(process.env.JAVA_HOME, 'bin', U.isWin ? 'java.exe' : 'java'));
  const roots = U.isWin
    ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', 'C:\\Program Files\\BellSoft', 'C:\\Program Files\\Amazon Corretto', path.join(U.appData(), '.minecraft', 'runtime')]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', path.join(U.home(), '.sdkman', 'candidates', 'java')];
  for (const r of roots) {
    for (const d of U.walk(r, { maxDepth: 5, maxFiles: 3000, filter: f => /(^|\/)bin\/javaw?(\.exe)?$/i.test(f) && !/javaw/i.test(f) })) cands.add(path.join(r, d));
  }
  const out = [];
  for (const c of cands) { const v = await javaVersion(c); if (v && !out.find(o => o.raw === v.raw && o.path === v.path)) out.push(v); }
  return out;
}
async function pickJava(required, custom) {
  const all = await findJavas(custom);
  const ok = all.filter(j => j.major >= required).sort((a, b) => a.major - b.major);
  return { java: ok[0] || null, all };
}

module.exports = { getJSON, getText, download, githubLatest, tempFile, extractZip, zipTopFolder, extract7z, extractTar, findJavas, pickJava, javaVersion };
