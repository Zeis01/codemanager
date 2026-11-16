// Wspólne narzędzia systemu plików i procesów
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function readText(p, fallback = null) {
  try {
    let t = fs.readFileSync(p, 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return t;
  } catch { return fallback; }
}
function readJSON(p, fallback = null) {
  const t = readText(p);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch {
    // tolerancja: komentarze i przecinki na końcu
    try {
      const cleaned = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch { return fallback; }
  }
}
function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
function listDirs(p) { return listDir(p).filter(d => d.isDirectory()).map(d => path.join(p, d.name)); }
function listFiles(p, exts) {
  return listDir(p).filter(d => d.isFile() && (!exts || exts.some(e => d.name.toLowerCase().endsWith(e))))
    .map(d => path.join(p, d.name));
}
// Rekurencyjne listowanie (z limitem), zwraca ścieżki względne
function walk(root, { maxFiles = 20000, maxDepth = 12, filter } = {}) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length && out.length < maxFiles) {
    const [dir, depth] = stack.pop();
    for (const d of listDir(dir)) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < maxDepth) stack.push([full, depth + 1]); }
      else if (d.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (!filter || filter(rel)) out.push(rel);
      }
    }
  }
  return out;
}
function firstExisting(list) { return list.find(exists) || null; }
function home() { return os.homedir(); }
function documents() {
  // Na Windows dokumenty mogą być przekierowane (OneDrive)
  const candidates = [];
  if (isWin) {
    if (process.env.OneDrive) candidates.push(path.join(process.env.OneDrive, 'Documents'), path.join(process.env.OneDrive, 'Dokumenty'));
    candidates.push(path.join(home(), 'Documents'), path.join(home(), 'Dokumenty'));
  } else {
    candidates.push(path.join(home(), 'Documents'), path.join(home(), 'Dokumenty'));
  }
  return firstExisting(candidates) || path.join(home(), 'Documents');
}
function documentsCandidates() {
  const c = [];
  if (process.env.OneDrive) c.push(path.join(process.env.OneDrive, 'Documents'), path.join(process.env.OneDrive, 'Dokumenty'));
  c.push(path.join(home(), 'Documents'), path.join(home(), 'Dokumenty'));
  return c.filter(exists);
}
function appData() { return process.env.APPDATA || (isMac ? path.join(home(), 'Library', 'Application Support') : path.join(home(), '.config')); }
function localAppData() { return process.env.LOCALAPPDATA || appData(); }

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function regQuery(key, value) {
  if (!isWin) return null;
  const args = ['query', key];
  if (value) args.push('/v', value); else args.push('/ve');
  const r = await run('reg', args);
  if (!r.ok) return null;
  const line = r.stdout.split(/\r?\n/).find(l => /REG_(SZ|EXPAND_SZ|DWORD)/.test(l));
  if (!line) return null;
  const m = line.match(/REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/);
  return m ? m[1].trim() : null;
}

// Porównanie wersji "luźnych" (1.20.1, 0.15.11+build, 2024.5.3)
function parseVer(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/^v/i, '');
  const [main, pre] = s.split(/-(.*)/s);
  const nums = main.split('+')[0].split('.').map(x => { const n = parseInt(x, 10); return isNaN(n) ? 0 : n; });
  return { nums, pre: pre || null, raw: s };
}
function cmpVer(a, b) {
  const A = parseVer(a), B = parseVer(b);
  if (!A || !B) return 0;
  const n = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < n; i++) {
    const x = A.nums[i] || 0, y = B.nums[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre < B.pre ? -1 : A.pre > B.pre ? 1 : 0;
  return 0;
}

function safeName(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'serwer'; }

function copyRecursive(src, dst, { backupDir, rootForBackup } = {}) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const d of fs.readdirSync(src)) copyRecursive(path.join(src, d), path.join(dst, d), { backupDir, rootForBackup });
  } else {
    if (backupDir && exists(dst)) {
      const rel = path.relative(rootForBackup || path.dirname(dst), dst);
      const b = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(dst, b);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

module.exports = {
  isWin, isMac, exists, isDir, isFile, readText, readJSON, writeJSON, listDir, listDirs, listFiles, walk,
  firstExisting, home, documents, documentsCandidates, appData, localAppData, run, regQuery, parseVer, cmpVer,
  safeName, copyRecursive,
};
