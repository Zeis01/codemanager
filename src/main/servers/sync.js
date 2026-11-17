// Synchronizacja klient–serwer: porównanie modów serwera z modami gracza i paczka brakujących
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const { readJar } = require('../parsers/minecraft');
const { parseIni } = require('../parsers/text');

function mcIndex(dir) {
  const out = new Map();
  for (const f of U.listFiles(dir).filter(x => /\.jar$/i.test(x))) {
    const j = readJar(f);
    const e = j.entries[0];
    const id = (e && e.id) || path.basename(f).replace(/\.jar$/i, '').toLowerCase();
    out.set(String(id).toLowerCase(), { id, name: (e && e.name) || path.basename(f), version: e ? String(e.version) : null, env: (e && e.environment) || '*', file: f, plugin: !!j.plugin });
  }
  return out;
}

function compareMaps(server, client, { needed = () => true, onlyClientRisky = () => false } = {}) {
  const missing = []; const mismatch = []; const ok = []; const extra = [];
  for (const [k, s] of server) {
    if (!needed(s)) continue;
    const c = client.get(k);
    if (!c) missing.push(s);
    else if (s.version && c.version && s.version !== c.version) mismatch.push({ ...s, clientVersion: c.version, clientFile: c.file });
    else ok.push(s);
  }
  for (const [k, c] of client) if (!server.has(k) && onlyClientRisky(c)) extra.push(c);
  return { missing, mismatch, ok, extra };
}

function compareMinecraft(serverDir, clientDir) {
  const r = compareMaps(mcIndex(serverDir), mcIndex(clientDir), {
    needed: s => !s.plugin && s.env !== 'server',
    onlyClientRisky: c => c.env === '*' && !c.plugin,
  });
  return { ...r, note: 'Mody oznaczone jako „tylko serwer” są pomijane. Mody tylko-klient (np. minimapa, shadery) nie muszą być na serwerze.' };
}

function thunderIndex(root) {
  const out = new Map();
  for (const d of U.listDirs(path.join(root, 'BepInEx', 'plugins'))) {
    const man = U.readJSON(path.join(d, 'manifest.json'));
    const key = (man && man.name ? man.name : path.basename(d).split('-').slice(1).join('-') || path.basename(d)).toLowerCase();
    out.set(key, { id: key, name: (man && man.name) || path.basename(d), version: man ? man.version_number : null, file: d });
  }
  return out;
}
function compareThunderstore(serverRoot, clientRoot) {
  const r = compareMaps(thunderIndex(serverRoot), thunderIndex(clientRoot), { onlyClientRisky: () => false });
  return { ...r, note: 'Valheim: mody z serwera zwykle muszą być też u graczy (te same wersje). Mody kosmetyczne po stronie klienta nie są tu wymagane.' };
}

function comparePZ(serverIni, clientIds) {
  const ini = parseIni(U.readText(serverIni, '') || '').__root || {};
  const ids = String(ini.Mods || '').split(';').map(s => s.trim().replace(/^\\/, '')).filter(Boolean);
  const ws = String(ini.WorkshopItems || '').split(';').map(s => s.trim()).filter(Boolean);
  const have = new Set(clientIds.map(x => x.toLowerCase()));
  const missing = ids.filter(id => !have.has(id.toLowerCase())).map(id => ({ id, name: id }));
  return { missing, mismatch: [], ok: ids.filter(id => have.has(id.toLowerCase())).map(id => ({ id, name: id })), extra: [], workshop: ws, note: `Serwer używa ${ids.length} modów i ${ws.length} przedmiotów Warsztatu. Steam pobiera mody z Warsztatu automatycznie przy dołączaniu – brakować mogą tylko mody spoza Warsztatu.` };
}

// paczka ZIP z brakującymi plikami (dla znajomego)
function makePack(items, outFile, { inner = 'mods' } = {}) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  for (const it of items) {
    if (!it.file || !U.exists(it.file)) continue;
    if (U.isDir(it.file)) zip.addLocalFolder(it.file, `${inner}/${path.basename(it.file)}`);
    else zip.addLocalFile(it.file, inner);
  }
  zip.addFile('CZYTAJ-MNIE.txt', Buffer.from(`Paczka przygotowana przez CodeManager (${new Date().toLocaleString('pl-PL')}).\r\nSkopiuj zawartość folderu „${inner}” do odpowiedniego folderu gry.\r\n\r\n${items.map(i => `- ${i.name}${i.version ? ' ' + i.version : ''}`).join('\r\n')}\r\n`, 'utf8'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  zip.writeZip(outFile);
  return outFile;
}

// kopiuje brakujące mody do folderu gracza; niezgodne wersje: stara trafia do kopii
function installInto(items, targetDir, backupDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const done = [];
  for (const it of items) {
    if (it.clientFile && U.exists(it.clientFile)) { const b = path.join(backupDir, path.basename(it.clientFile)); fs.mkdirSync(backupDir, { recursive: true }); fs.renameSync(it.clientFile, b); }
    const dest = path.join(targetDir, path.basename(it.file));
    U.copyRecursive(it.file, dest); done.push(dest);
  }
  return done;
}

module.exports = { compareMinecraft, compareThunderstore, comparePZ, makePack, installInto, mcIndex, thunderIndex, compareMaps };
