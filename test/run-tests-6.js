// Testy wersji 1.6: wątki robocze, pamięć podręczna, ostrzeżenia, polecane mody, zasoby/shadery, alarmy (node test/run-tests-6.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test6-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };

t('wątki robocze: operacje poza procesem głównym i zapasowe wykonanie', async () => {
  const { Pool } = require('../src/main/worker/pool');
  const p = new Pool({ size: 2 });
  try {
    assert.strictEqual(await p.run('ping'), 'pong');
    w(path.join(root, 'srch', 'a', 'config.toml'), 'port = 1\nszukany = tak'); w(path.join(root, 'srch', 'b.txt'), 'nic');
    const [names, grep] = await Promise.all([p.run('search', { root: path.join(root, 'srch'), q: 'config' }), p.run('grep', { root: path.join(root, 'srch'), q: 'szukany' })]);
    assert.deepStrictEqual(names.map(x => x.rel), ['a/config.toml']); assert.strictEqual(grep[0].line, 2);
    assert.strictEqual(await p.run('dirSize', { paths: [path.join(root, 'srch')] }), 'port = 1\nszukany = tak'.length + 3);
    await assert.rejects(p.run('brak'), /Nieznana operacja/);
    const det = await p.run('detect', { config: { settings: { steamPath: path.join(root, 'nosteam') }, games: {} } });
    assert(det.games && det.games.minecraft !== undefined);
  } finally { p.close(); }
  const bad = new Pool({ file: path.join(root, 'nie-ma.js') });
  assert.strictEqual(await bad.run('ping', {}, () => 'w procesie głównym'), 'w procesie głównym');
  bad.close();
});
t('pamięć podręczna plików .jar: ponowny odczyt tylko po zmianie, wynik niezależny od modyfikacji', () => {
  const AdmZip = require('adm-zip');
  const make = (f, v) => { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'abc', version: v }))); z.writeZip(f); };
  const f = path.join(root, 'abc.jar'); make(f, '1.0');
  const { readJar } = require('../src/main/parsers/minecraft');
  const a = readJar(f); a.entries[0].version = 'zmienione';
  assert.strictEqual(readJar(f).entries[0].version, '1.0');
  make(f, '2.0.0'); const tm = new Date(Date.now() + 5000); fs.utimesSync(f, tm, tm);
  assert.strictEqual(readJar(f).entries[0].version, '2.0.0');
});
t('polecane mody: reguły i zestaw podstawowy bez już zainstalowanych', () => {
  const r = require('../src/main/mods/recommend');
  const c = r.candidates(new Set(['sodium', 'fabric-api', 'lithium-fabric-0.11']), 'fabric').map(x => x.slug);
  assert(c.includes('iris') && c.includes('ferrite-core'));
  assert(!c.includes('sodium') && !c.includes('lithium'));
  assert(r.candidates(new Set(), 'paper').some(x => x.slug === 'luckperms'));
  assert(!r.candidates(new Set(['create']), 'fabric').some(x => x.slug === 'jei'));
});
t('paczki zasobów: włączanie w options.txt, kolejność i shadery (Iris / OptiFine)', () => {
  const mp = require('../src/main/mods/mcpacks');
  const mc = path.join(root, 'mc');
  w(path.join(mc, 'options.txt'), 'fov:0.0\nresourcePacks:["vanilla","file/Old.zip"]\nincompatibleResourcePacks:[]\n');
  const AdmZip = require('adm-zip'); const z = new AdmZip(); z.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 34, description: '§aŁadna paczka' } })));
  fs.mkdirSync(path.join(mc, 'resourcepacks'), { recursive: true }); z.writeZip(path.join(mc, 'resourcepacks', 'Nowa.zip')); z.writeZip(path.join(mc, 'resourcepacks', 'Old.zip'));
  let l = mp.list(mc); assert.strictEqual(l.packs.find(p => p.name === 'Nowa.zip').description, 'Ładna paczka'); assert(l.packs.find(p => p.name === 'Old.zip').enabled);
  mp.togglePack(mc, 'Nowa.zip', true);
  assert.deepStrictEqual(mp.optList(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8'), 'resourcePacks'), ['vanilla', 'file/Old.zip', 'file/Nowa.zip']);
  mp.movePack(mc, 'Nowa.zip', -1);
  assert.deepStrictEqual(mp.optList(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8'), 'resourcePacks'), ['vanilla', 'file/Nowa.zip', 'file/Old.zip']);
  assert(/^fov:0\.0$/m.test(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8')));
  w(path.join(mc, 'mods', 'iris-1.7.jar')); w(path.join(mc, 'shaderpacks', 'BSL.zip'));
  mp.setShader(mc, 'BSL.zip'); l = mp.list(mc);
  assert.strictEqual(l.shaderEngine, 'iris'); assert.strictEqual(l.activeShader, 'BSL.zip'); assert(l.shaders[0].active);
  mp.setShader(mc, null); assert.strictEqual(mp.list(mc).activeShader, null);
  const of = path.join(root, 'of'); w(path.join(of, 'optionsshaders.txt'), 'shaderPack=OFF\n');
  mp.setShader(of, 'Sildurs.zip'); assert.strictEqual(mp.list(of).activeShader, 'Sildurs.zip');
});
t('ostrzeżenie przed instalacją: niezgodności z Modrinth (w obie strony) i nadpisywane pliki', async () => {
  const pre = require('../src/main/mods/precheck');
  const fakeMr = {
    versions: async () => [{ id: 'v2', project_id: 'NEW', version_number: '2.0', version_type: 'release', dependencies: [{ project_id: 'OPT', dependency_type: 'incompatible' }] }],
    installedIndex: async () => ({ projects: new Map([['OPT', { file: '/m/optifabric.jar', version: { id: 'o1', dependencies: [] } }], ['OLD', { file: '/m/old.jar', version: { id: 'x', dependencies: [{ project_id: 'NEW', dependency_type: 'incompatible' }] } }], ['NEW', { file: '/m/new-1.jar', version: { id: 'v1', version_number: '1.0', dependencies: [] } }]]) }),
    projectsInfo: async () => [{ id: 'OPT', title: 'OptiFabric' }, { id: 'OLD', title: 'Stary Mod' }],
  };
  const r = await pre.modrinth('NEW', { modsDir: '/m' }, fakeMr);
  assert.strictEqual(r.warnings.filter(x => x.level === 'error').length, 2);
  assert(r.warnings.some(x => /OptiFabric/.test(x.text)) && r.warnings.some(x => /Stary Mod/.test(x.text)) && r.warnings.some(x => /Zastąpi/.test(x.text)));
  const ov = pre.overlaps(['MyMod/Data/textures/armor/iron.dds', 'MyMod/readme.txt', 'MyMod/Data/meshes/new.nif'], [{ name: 'Armor HD', files: ['Data/textures/armor/iron.dds'] }]);
  assert.deepStrictEqual(ov.map(o => [o.mod, o.count]), [['Armor HD', 1]]);
  const AdmZip = require('adm-zip'); const z = new AdmZip(); z.addFile('x/Data/textures/armor/iron.dds', Buffer.from('a')); const zf = path.join(root, 'm.zip'); z.writeZip(zf);
  assert.deepStrictEqual(await pre.listArchive(zf), ['x/Data/textures/armor/iron.dds']);
  assert.deepStrictEqual(pre.flattenPreview({ children: [{ type: 'directory', name: 'Data', path: 'Data', children: [{ type: 'file', name: 'a.esp', path: 'Data/a.esp' }] }] }), ['Data/a.esp']);
});
t('alarm zasobów: powiadomienie po przekroczeniu przez zadany czas, raz do spadku', () => {
  const { Monitor } = require('../src/main/servers/monitor');
  const alarms = [];
  const m = new Monitor({ mgr: { procs: new Map(), servers: [{ id: 's', alarm: { enabled: true, cpu: 80, ramMB: 1000, minutes: 2 } }] }, emit: () => {} });
  m.onAlarm = (id, a) => alarms.push(a.kind);
  const t0 = 1e12; const pt = (min, cpu, memMB) => m.checkAlarm('s', { t: t0 + min * 60000, cpu, mem: memMB * 1048576 });
  pt(0, 95, 500); pt(1, 95, 500); assert.deepStrictEqual(alarms, []);
  pt(2, 95, 1500); assert.deepStrictEqual(alarms, ['cpu']);
  pt(3, 95, 1500); pt(4, 95, 1500); assert.deepStrictEqual(alarms, ['cpu', 'mem']);
  pt(5, 10, 100); pt(6, 99, 100); pt(8, 99, 100); assert.deepStrictEqual(alarms, ['cpu', 'mem', 'cpu']);
});
t('blokada wersji i kolekcje z tagów w notatkach', () => {
  const { Notes } = require('../src/main/mods/store');
  const n = new Notes(path.join(root, 'n.json'));
  n.setLock('mc', { id: 'Sodium' }, true); n.set('mc', { id: 'sodium' }, { tags: ['klient'], note: '' }); n.set('mc', { id: 'iris' }, { tags: ['klient'], note: '' });
  assert.deepStrictEqual(n.locked('mc'), ['sodium']); assert.deepStrictEqual(n.withTag('mc', 'klient').sort(), ['iris', 'sodium']);
  n.set('mc', { id: 'sodium' }, { tags: [], note: '' }); assert(n.forGame('mc').sodium.lock, 'blokada zostaje po usunięciu tagów');
  n.setLock('mc', { id: 'sodium' }, false); assert(!n.forGame('mc').sodium);
});
t('powiadomienie o alarmie ma czytelny opis', () => {
  const { message } = require('../src/main/notify');
  assert(/procesor 95% \(limit 80%\) od 5 min/.test(message('alarm', { name: 'S' }, { kind: 'cpu', value: 95, limit: 80, minutes: 5 })));
  assert(/pamięć 2048 MB \(limit 1000 MB\)/.test(message('alarm', { name: 'S' }, { kind: 'mem', value: 2048 * 1048576, limit: 1000, minutes: 5 })));
});

t('AI: zapytania do Anthropic, OpenAI-zgodnych i Gemini oraz czytelne błędy', async () => {
  const ai = require('../src/main/ai');
  const calls = [];
  const fake = reply => async (url, o) => { calls.push({ url, h: o.headers, b: o.body ? JSON.parse(o.body) : null }); return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; };
  const msg = { system: 'S', messages: [{ role: 'user', content: 'pytanie' }] };
  assert.strictEqual(await ai.chat(ai.cfg({ ai: { provider: 'anthropic' } }), 'k1', msg, fake({ content: [{ type: 'text', text: 'odp A' }] })), 'odp A');
  assert(calls[0].url.endsWith('/v1/messages') && calls[0].h['x-api-key'] === 'k1' && calls[0].b.system === 'S' && calls[0].b.model === 'claude-sonnet-5-5');
  assert.strictEqual(await ai.chat(ai.cfg({ ai: { provider: 'openrouter', model: 'x/y' } }), 'k2', msg, fake({ choices: [{ message: { content: 'odp B' } }] })), 'odp B');
  assert(calls[1].url === 'https://openrouter.ai/api/v1/chat/completions' && calls[1].h.authorization === 'Bearer k2' && calls[1].b.messages[0].role === 'system');
  assert.strictEqual(await ai.chat(ai.cfg({ ai: { provider: 'gemini' } }), 'k3', { ...msg, messages: [...msg.messages, { role: 'assistant', content: 'a' }] }, fake({ candidates: [{ content: { parts: [{ text: 'odp C' }] } }] })), 'odp C');
  assert(/models\/gemini-2\.5-flash:generateContent$/.test(calls[2].url) && calls[2].b.contents[1].role === 'model');
  assert.strictEqual(await ai.chat(ai.cfg({ ai: { provider: 'ollama' } }), null, msg, fake({ choices: [{ message: { content: 'lokalnie' } }] })), 'lokalnie');
  assert(!calls[3].h.authorization && calls[3].url.startsWith('http://localhost:11434/v1'));
  await assert.rejects(ai.chat(ai.cfg({ ai: { provider: 'openai' } }), null, msg, fake({})), /Brak klucza/);
  await assert.rejects(ai.chat(ai.cfg({ ai: { provider: 'openai' } }), 'zly', msg, async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } }) })), /Incorrect API key.*klucz API/);
  await assert.rejects(ai.chat(ai.cfg({ ai: { provider: 'custom' } }), null, msg, fake({})), /adres serwera/);
  const list = await ai.models(ai.cfg({ ai: { provider: 'gemini' } }), 'k', fake({ models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }));
  assert.deepStrictEqual(list, ['gemini-x']);
});
t('AI: fragment logu zawiera błędy z całego pliku i końcówkę, w granicach limitu', () => {
  const ai = require('../src/main/ai');
  const log = Array.from({ length: 5000 }, (_, i) => (i === 1200 ? 'java.lang.NullPointerException: boom' : `linia ${i}`)).join('\n');
  const ex = ai.logExcerpt(log, 14000);
  assert(ex.includes('NullPointerException') && ex.includes('linia 4999') && ex.length <= 14020);
  const p = ai.logPrompt({ target: 'Minecraft', log: 'ERROR x', findings: [{ level: 'error', title: 'Brak Fabric API' }], mods: [{ name: 'Sodium', version: '0.5', enabled: true }] });
  assert(/Brak Fabric API/.test(p) && /Sodium 0\.5/.test(p));
  assert(/English/.test(ai.system('en')) && /po polsku/.test(ai.system('pl')));
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 4).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
