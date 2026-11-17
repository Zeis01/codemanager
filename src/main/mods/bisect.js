// Szukanie winowajcy metodą bisekcji: połowa podejrzanych modów wyłączona, użytkownik sprawdza grę
'use strict';
const U = require('../util');
const { normKey } = require('./store');

function split(s) { const a = s.suspects.slice(0, Math.ceil(s.suspects.length / 2)); return { on: a, off: s.suspects.slice(a.length) }; }

function start(mods, { keepOn = [] } = {}) {
  const enabled = mods.filter(m => m.enabled && m.toggleable);
  const keep = new Set(keepOn.map(k => String(k).toLowerCase()));
  const all = enabled.map(m => ({ key: normKey(m), name: m.name }));
  const suspects = all.filter(m => !keep.has(m.key)).map(m => m.key);
  if (suspects.length < 2) throw new Error('Do szukania potrzeba co najmniej 2 włączonych modów, które można wyłączać.');
  const s = { startedAt: Date.now(), original: mods.filter(m => m.toggleable).map(m => ({ key: normKey(m), name: m.name, enabled: !!m.enabled })), names: Object.fromEntries(all.map(m => [m.key, m.name])), suspects, cleared: [], keep: [...keep], round: 1, history: [] };
  s.test = split(s);
  return s;
}

// stan włączenia modów do sprawdzenia w bieżącej rundzie
function desired(s) {
  const want = new Map(s.original.map(m => [m.key, m.enabled]));
  if (s.done) return want;
  for (const k of s.test.off) want.set(k, false);
  for (const k of s.test.on) want.set(k, true);
  return want;
}

function answer(s, problem) {
  if (s.done) return s;
  const n = { ...s, history: [...s.history, { round: s.round, on: s.test.on.length, off: s.test.off.length, problem }] };
  if (problem) { n.cleared = [...s.cleared, ...s.test.off]; n.suspects = s.test.on; }
  else { n.cleared = [...s.cleared, ...s.test.on]; n.suspects = s.test.off; }
  n.round = s.round + 1;
  if (n.suspects.length <= 1) { n.done = true; n.culprit = n.suspects[0] || null; n.test = { on: [], off: [] }; }
  else n.test = split(n);
  return n;
}
function roundsLeft(s) { return s.done ? 0 : Math.ceil(Math.log2(Math.max(1, s.suspects.length))); }

// lista przełączeń, aby dopasować obecne mody do żądanego stanu
function changes(mods, want) {
  const out = [];
  for (const m of mods) { if (!m.toggleable) continue; const w = want.get(normKey(m)); if (w !== undefined && w !== !!m.enabled) out.push(m); }
  return out;
}

class BisectStore {
  constructor(file) { this.file = file; this.data = U.readJSON(file, {}); }
  get(k) { return this.data[k] || null; }
  set(k, s) { if (s) this.data[k] = s; else delete this.data[k]; U.writeJSON(this.file, this.data); return s; }
}

module.exports = { start, answer, desired, changes, roundsLeft, BisectStore };
