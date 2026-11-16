// Zakresy wersji: Fabric/Quilt (semver-like), Maven (Forge/NeoForge), wzorce "1.50.*"
'use strict';
const { cmpVer } = require('../util');

function wildcardMatch(pattern, version) {
  const p = String(pattern).trim();
  if (p === '*' || p === '') return true;
  const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/x/gi, '\\d+') + '$', 'i');
  return re.test(String(version));
}

// Fabric: ">=1.20 <1.21", "~1.20.1", "^0.15", "1.20.x", "1.20.1 || 1.20.2", "*"
function matchSemverRange(range, version) {
  if (range == null) return true;
  if (Array.isArray(range)) return range.length === 0 || range.some(r => matchSemverRange(r, version));
  const r = String(range).trim();
  if (r === '*' || r === '') return true;
  return r.split('||').some(alt => alt.trim().split(/\s+/).filter(Boolean).every(part => matchPart(part, version)));
}
function matchPart(part, v) {
  const m = part.match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
  if (!m) return true;
  const op = m[1] || '=';
  let ver = m[2];
  if (/[x*]/i.test(ver)) {
    if (op === '=' ) return wildcardMatch(ver, v) || cmpVer(v, ver.replace(/\.[x*].*$/i, '')) === 0;
    ver = ver.replace(/\.[x*].*$/i, '');
  }
  const c = cmpVer(v, ver);
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    case '=': {
      // "1.20" w Fabricu oznacza dokładnie 1.20; ale 1.20 == 1.20.0
      return c === 0;
    }
    case '~': { // ~1.20.1 => >=1.20.1 <1.21
      const n = ver.split('.'); const up = n.length > 1 ? `${n[0]}.${+n[1] + 1}` : `${+n[0] + 1}`;
      return c >= 0 && cmpVer(v, up) < 0;
    }
    case '^': { const n = ver.split('.'); const up = `${+n[0] + 1}`; const up0 = n[0] === '0' && n[1] ? `0.${+n[1] + 1}` : up; return c >= 0 && cmpVer(v, up0) < 0; }
  }
  return true;
}

// Maven: "[1.20,1.21)", "[47,)", "(,1.20.1]", "[1.20.1]", "1.20.1" (miękkie -> >=), wiele zakresów po przecinku
function matchMavenRange(range, version) {
  if (range == null) return true;
  const r = String(range).trim();
  if (r === '' || r === '*') return true;
  if (!/[[\]()]/.test(r)) return cmpVer(version, r) >= 0;
  const ranges = r.match(/[[(][^\])]*[\])]/g) || [];
  return ranges.some(seg => {
    const lo = seg[0], hi = seg[seg.length - 1];
    const inner = seg.slice(1, -1);
    if (!inner.includes(',')) return cmpVer(version, inner.trim()) === 0;
    const [a, b] = inner.split(',').map(s => s.trim());
    if (a) { const c = cmpVer(version, a); if (lo === '[' ? c < 0 : c <= 0) return false; }
    if (b) { const c = cmpVer(version, b); if (hi === ']' ? c > 0 : c >= 0) return false; }
    return true;
  });
}

// Opis zakresu po polsku do komunikatów
function describeRange(r) {
  if (r == null) return 'dowolna';
  if (Array.isArray(r)) return r.join(' lub ');
  return String(r);
}

module.exports = { wildcardMatch, matchSemverRange, matchMavenRange, describeRange };
