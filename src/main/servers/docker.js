// Uruchamianie serwerów w kontenerach Dockera: izolacja, limity RAM i CPU, łatwe przenoszenie.
// Pliki serwera zostają w jego folderze (montowany jako /data), więc kopie i edytor działają jak zwykle.
'use strict';
const path = require('path');
const { execFile } = require('child_process');

// obrazy domyślne: serwery Javy działają w każdym systemie; pozostałe wymagają plików serwera dla Linuksa
const DEFAULT_IMAGE = { minecraft: 'eclipse-temurin:21-jre', mcproxy: 'eclipse-temurin:21-jre' };
const imageFor = s => (s.docker && s.docker.image) || DEFAULT_IMAGE[s.type] || '';
const toPosix = p => p.split(path.sep).join('/');

function available(run = execFile) {
  return new Promise(res => run('docker', ['version', '--format', '{{.Server.Version}}'], { windowsHide: true, timeout: 8000 }, (e, out) => res(e ? { ok: false, error: /not recognized|ENOENT|nie jest rozpoznawane/i.test(String(e.message)) ? 'Docker nie jest zainstalowany.' : 'Docker nie działa – uruchom Docker Desktop.' } : { ok: true, version: String(out).trim() })));
}

// st: { cmd, args, cwd, env } z definicji typu serwera; ports: [{ port, proto }]
function buildRun(s, st, ports = []) {
  const image = imageFor(s);
  if (!image) throw new Error('Wybierz obraz Dockera dla tego serwera (np. obraz z plikami serwera dla Linuksa).');
  const d = s.docker || {};
  const inside = p => { const rel = path.relative(s.path, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? '/data/' + toPosix(rel) : rel === '' ? '/data' : null; };
  let cmd = st.cmd;
  const mapped = path.isAbsolute(cmd) ? inside(cmd) : null;
  if (mapped) cmd = mapped; else if (/java(w)?(\.exe)?$/i.test(path.basename(cmd))) cmd = 'java'; else if (path.isAbsolute(cmd)) throw new Error('Program serwera leży poza jego folderem – nie da się go uruchomić w kontenerze.');
  const args = (st.args || []).map(a => (typeof a === 'string' && path.isAbsolute(a) && inside(a)) ? inside(a) : a);
  const out = ['run', '--rm', '-i', '--name', containerName(s), '-v', `${s.path}:/data`, '-w', inside(st.cwd || s.path) || '/data'];
  for (const p of ports) out.push('-p', `${p.port}:${p.port}/${String(p.proto || 'tcp').toLowerCase()}`);
  if (+d.memory > 0) out.push('--memory', `${+d.memory}m`);
  if (+d.cpus > 0) out.push('--cpus', String(+d.cpus));
  for (const [k, v] of Object.entries(st.env || {})) out.push('-e', `${k}=${v}`);
  if (d.extra) out.push(...String(d.extra).split(/\s+/).filter(Boolean));
  out.push(image, cmd, ...args);
  return { cmd: 'docker', args: out, cwd: s.path };
}
const containerName = s => 'cm-' + String(s.id).replace(/[^a-zA-Z0-9_.-]/g, '');
function stats(s, run = execFile) {
  return new Promise(res => run('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}};{{.MemUsage}}', containerName(s)], { windowsHide: true, timeout: 8000 }, (e, out) => {
    if (e) return res(null);
    const [cpu, mem] = String(out).trim().split(';');
    const m = (mem || '').match(/([\d.]+)\s*([KMG]i?B)/i); const mult = { kib: 1 / 1024, kb: 1 / 1024, mib: 1, mb: 1, gib: 1024, gb: 1024 };
    res({ cpu: parseFloat(cpu) || 0, memMB: m ? +m[1] * (mult[m[2].toLowerCase()] || 1) : 0 });
  }));
}

module.exports = { available, buildRun, containerName, stats, imageFor, DEFAULT_IMAGE };
