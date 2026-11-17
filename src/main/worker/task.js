// Wątek roboczy: ciężkie operacje na plikach (sprawdzanie modów, wykrywanie gier, wyszukiwanie)
// wykonywane poza procesem głównym, żeby okno programu nie przycinało się.
'use strict';
const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const ops = {
  check: ({ gameId, info, profile, settings }) => require('../compat').check(gameId, info, profile, settings),
  detect: ({ config }) => require('../detect').detectAll(config),
  steamRoots: async ({ steamPath }) => ((await require('../detect').steamApps(steamPath)).roots || []),
  serverCheck: ({ server }) => require('../servers/check').check(server),
  conflicts: ({ game, mods, registry }) => require('../mods/conflicts').forGame(game, mods, registry),
  dupes: ({ mods }) => require('../mods/dupes').find(mods),
  search: ({ root, q }) => {
    const U = require('../util'); const ql = q.toLowerCase();
    return U.walk(root, { maxFiles: 30000, filter: r => !/(^|\/)(node_modules|\.git|steamapps|Cache|cache)\//.test(r) }).filter(r => r.toLowerCase().includes(ql)).slice(0, 200).map(r => ({ rel: r, path: path.join(root, r) }));
  },
  grep: ({ root, q }) => {
    const U = require('../util'); const out = []; const ql = q.toLowerCase();
    for (const r of U.walk(root, { maxFiles: 8000, filter: f => /\.(lua|json|cfg|ini|txt|cs|sp|inc|xml|yml|yaml|toml|js|ts|properties|sqf|cpp|hpp|c|h|sii|gi|mcfunction|conf|md|ltx|script)$/i.test(f) })) {
      const full = path.join(root, r); let t; try { if (fs.statSync(full).size > 2e6) continue; t = fs.readFileSync(full, 'utf8'); } catch { continue; }
      t.split(/\r?\n/).forEach((l, i) => { if (out.length < 500 && l.toLowerCase().includes(ql)) out.push({ rel: r, path: full, line: i + 1, text: l.trim().slice(0, 200) }); });
      if (out.length >= 500) break;
    }
    return out;
  },
  dirSize: ({ paths }) => {
    const U = require('../util'); let s = 0;
    for (const p of paths) { if (!U.exists(p)) continue; if (U.isFile(p)) { s += fs.statSync(p).size; continue; } for (const r of U.walk(p, { maxFiles: 200000 })) { try { s += fs.statSync(path.join(p, r)).size; } catch { /* */ } } }
    return s;
  },
  pkgIndex: ({ modsDir }) => require('../analyzer').buildPackageIndex(modsDir),
  syncMinecraft: ({ serverDir, clientDir }) => require('../servers/sync').compareMinecraft(serverDir, clientDir),
  syncThunder: ({ serverRoot, clientRoot }) => require('../servers/sync').compareThunderstore(serverRoot, clientRoot),
  ping: () => 'pong',
};

parentPort.on('message', async ({ id, op, args }) => {
  try {
    if (!ops[op]) throw new Error('Nieznana operacja: ' + op);
    parentPort.postMessage({ id, ok: true, data: await ops[op](args || {}) });
  } catch (e) { parentPort.postMessage({ id, ok: false, error: e && e.message ? e.message : String(e) }); }
});
