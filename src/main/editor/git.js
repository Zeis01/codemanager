// Git w edytorze: zmiany, porównanie z ostatnim commitem, commit, push/pull, historia, gałęzie.
// Korzysta z programu git zainstalowanego w systemie (git-scm.com).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function git(args, cwd, { input, timeout = 60000 } = {}) {
  return new Promise((res, rej) => {
    const p = execFile('git', args, { cwd, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (e, out, err) => {
      if (e) { const msg = String(err || e.message).trim(); return rej(new Error(/ENOENT|not recognized|nie jest rozpoznawane/i.test(msg) || e.code === 'ENOENT' ? 'Git nie jest zainstalowany (git-scm.com).' : msg.split('\n').filter(Boolean).slice(-3).join('\n'))); }
      res(String(out));
    });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}
async function available() { try { return { ok: true, version: (await git(['--version'], process.cwd())).trim() }; } catch (e) { return { ok: false, error: e.message }; } }
async function root(dir) { try { return path.resolve((await git(['rev-parse', '--show-toplevel'], dir)).trim()); } catch { return null; } }

// git status --porcelain=v1 -z
function parseStatus(out) {
  const parts = out.split('\0'); const files = []; let branch = null, ahead = 0, behind = 0, upstream = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; if (!p) continue;
    if (p.startsWith('## ')) { const m = p.slice(3).match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?$/); if (m) { branch = m[1].replace(/^No commits yet on /, ''); upstream = m[2] || null; ahead = +m[3] || 0; behind = +m[4] || 0; } continue; }
    const x = p[0], y = p[1]; const file = p.slice(3);
    let orig = null; if (x === 'R' || x === 'C') orig = parts[++i];
    files.push({ path: file, orig, index: x, work: y, staged: x !== ' ' && x !== '?', untracked: x === '?', conflict: x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D') });
  }
  return { branch, upstream, ahead, behind, files };
}
async function status(dir) { const r = await root(dir); if (!r) return { repo: false }; return { repo: true, root: r, ...parseStatus(await git(['status', '--porcelain=v1', '-b', '-z', '-uall'], r)) }; }
// Windows: krótkie nazwy (RUNNER~1), wielkość liter dysku i ukośniki – ścieżki porównujemy po rozwinięciu
const real = p => { try { return fs.realpathSync.native(p); } catch { const d = path.dirname(p); return d === p ? path.resolve(p) : path.join(real(d), path.basename(p)); } };
const rel1 = (r, f) => path.relative(real(r), real(f)).split(path.sep).join('/');
async function headContent(r, file) { const rel = rel1(r, file); try { return await git(['show', 'HEAD:' + rel], r); } catch { return ''; } }
async function log(r, n = 60) {
  const out = await git(['log', `-n${n}`, '--date=relative', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e'], r).catch(() => '');
  return out.split('\x1e').map(l => l.trim()).filter(Boolean).map(l => { const [hash, short, author, date, subject] = l.split('\x1f'); return { hash, short, author, date, subject }; });
}
async function branches(r) { const out = await git(['branch', '--format=%(HEAD)%(refname:short)'], r).catch(() => ''); return out.split('\n').filter(Boolean).map(l => ({ name: l.slice(1), current: l[0] === '*' })); }
const rels = (r, files) => files.map(f => rel1(r, f));
const api = {
  available, root, status, headContent, log, branches, parseStatus,
  init: dir => git(['init'], dir),
  stage: (r, files) => git(['add', '--', ...rels(r, files)], r),
  stageAll: r => git(['add', '-A'], r),
  unstage: (r, files) => git(['reset', '-q', 'HEAD', '--', ...rels(r, files)], r).catch(() => git(['rm', '--cached', '-q', '--', ...rels(r, files)], r)),
  discard: (r, files) => git(['checkout', '--', ...rels(r, files)], r),
  commit: async (r, message, { all, author } = {}) => { if (!String(message || '').trim()) throw new Error('Wpisz opis zmian (commit message).'); const args = ['commit', '-F', '-']; if (all) args.splice(1, 0, '-a'); if (author && author.name && author.email) args.unshift('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`); return git(args, r, { input: message }); },
  push: r => git(['push'], r, { timeout: 180000 }).catch(async e => { if (/no upstream|has no upstream/i.test(e.message)) { const b = (await status(r)).branch; return git(['push', '-u', 'origin', b], r, { timeout: 180000 }); } throw e; }),
  pull: r => git(['pull', '--ff-only'], r, { timeout: 180000 }),
  fetch: r => git(['fetch', '--prune'], r, { timeout: 120000 }),
  checkout: (r, branch, create) => git(create ? ['checkout', '-b', branch] : ['checkout', branch], r),
  diffFile: (r, file, staged) => git(['diff', ...(staged ? ['--cached'] : []), '--', rel1(r, file)], r),
  show: (r, hash) => git(['show', '--stat', '--format=%H%n%an <%ae>%n%ad%n%n%B', hash], r),
  remote: r => git(['remote', '-v'], r).then(o => o.split('\n').filter(Boolean)[0] || '').catch(() => ''),
  setRemote: (r, url) => git(['remote', 'add', 'origin', url], r).catch(() => git(['remote', 'set-url', 'origin', url], r)),
};
module.exports = api;
