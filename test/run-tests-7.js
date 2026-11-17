// Testy wersji 1.6.2: przeglądanie Nexus Mods ze stronami, Warsztat Steam (node test/run-tests-7.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test7-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

t('Nexus: przeglądanie bez klucza, strony i sortowanie', async () => {
  const nx = require('../src/main/online/nexus');
  let sent;
  const fake = async (url, o) => { sent = { url, h: o.headers, b: JSON.parse(o.body) }; return res({ data: { mods: { totalCount: 95, nodes: [{ modId: 7, name: 'SkyUI', summary: 'UI', version: '5.2', author: 'sch', thumbnailUrl: 'https://x/t.jpg', endorsements: 10, downloads: 99, updatedAt: '2026-01-02T00:00:00Z', adultContent: false }] } } }); };
  const r = await nx.browse('skyrimspecialedition', { page: 3, perPage: 20, sort: 'downloads' }, fake);
  assert(/v2\/graphql$/.test(sent.url)); assert(!sent.h.apikey);
  assert.strictEqual(sent.b.variables.offset, 40); assert.strictEqual(sent.b.variables.count, 20);
  assert.deepStrictEqual(sent.b.variables.sort, [{ downloads: { direction: 'DESC' } }]);
  assert.strictEqual(sent.b.variables.filter.gameDomainName[0].value, 'skyrimspecialedition'); assert(!sent.b.variables.filter.name);
  assert.strictEqual(r.total, 95); assert.strictEqual(r.page, 3);
  assert.strictEqual(r.items[0].url, 'https://www.nexusmods.com/skyrimspecialedition/mods/7'); assert.strictEqual(r.items[0].picture, 'https://x/t.jpg');
  await nx.browse('skyrimspecialedition', { text: 'sky ui' }, fake);
  assert.strictEqual(sent.b.variables.filter.name[0].value, 'sky ui'); assert.strictEqual(sent.b.variables.offset, 0);
  await assert.rejects(nx.browse('x', {}, async () => res({ errors: [{ message: 'Bad filter' }] })), /Bad filter/);
  assert.strictEqual(nx.bbToText('[b]Hej[/b]<br>[list][*]a[/list] &amp;'), 'Hej\n• a &');
});

t('Warsztat: rozpoznawanie linków i numerów', () => {
  const ws = require('../src/main/online/workshop');
  assert.strictEqual(ws.parseId('https://steamcommunity.com/sharedfiles/filedetails/?id=2489310436&searchtext='), '2489310436');
  assert.strictEqual(ws.parseId('steamcommunity.com/workshop/filedetails/?l=polish&id=123456789'), '123456789');
  assert.strictEqual(ws.parseId(' 2489310436 '), '2489310436');
  assert.strictEqual(ws.parseId('abc'), null); assert.strictEqual(ws.parseId('12'), null);
});

t('Warsztat: szczegóły przedmiotów bez klucza, z pamięcią podręczną', async () => {
  const ws = require('../src/main/online/workshop');
  let calls = 0, body;
  const fake = async (url, o) => { calls++; body = new URLSearchParams(o.body); return res({ response: { publishedfiledetails: [{ publishedfileid: '900000001', result: 1, title: 'Mod A', file_description: 'opis', preview_url: 'https://p/a.jpg', file_size: '2048', time_updated: 1700000000, subscriptions: 5, consumer_app_id: 108600, tags: [{ tag: 'Map' }] }, { publishedfileid: '900000002', result: 9 }] } }); };
  const d = await ws.details(['900000001', '900000002', 'zły'], fake);
  assert.strictEqual(body.get('itemcount'), '2'); assert.strictEqual(body.get('publishedfileids[1]'), '900000002');
  assert.deepStrictEqual(Object.keys(d), ['900000001']);
  assert.strictEqual(d['900000001'].updated, 1700000000000); assert.deepStrictEqual(d['900000001'].tags, ['Map']); assert.strictEqual(d['900000001'].appid, 108600);
  await ws.details(['900000001'], fake); assert.strictEqual(calls, 1);
});

t('Warsztat: wyszukiwanie wymaga klucza, strony i sortowanie', async () => {
  const ws = require('../src/main/online/workshop');
  await assert.rejects(ws.search(108600, {}), /klucz Steam Web API/);
  let q;
  const fake = async url => { q = new URL(url).searchParams; return res({ response: { total: 41, publishedfiledetails: [{ publishedfileid: '900000003', result: 1, title: 'B' }] } }); };
  const r = await ws.search(108600, { key: 'K', page: 2, perPage: 20, sort: 'updated' }, fake);
  assert.strictEqual(q.get('appid'), '108600'); assert.strictEqual(q.get('page'), '2'); assert.strictEqual(q.get('query_type'), '21'); assert.strictEqual(q.get('return_details'), 'true');
  assert.strictEqual(r.total, 41); assert.strictEqual(r.items[0].title, 'B');
  await ws.search(108600, { key: 'K', text: 'mapa', sort: 'updated' }, fake); assert.strictEqual(q.get('query_type'), '12'); assert.strictEqual(q.get('search_text'), 'mapa');
  await assert.rejects(ws.search(1, { key: 'K' }, async () => res({}, 403)), /odrzucił klucz/);
});

t('Warsztat: kopiowanie pobranego przedmiotu do folderu modów gry', () => {
  const ws = require('../src/main/online/workshop');
  const item = path.join(root, 'item');
  w(path.join(item, 'mods', 'Hydrocraft', 'mod.info'), 'name=Hydrocraft'); w(path.join(item, 'a.gma')); w(path.join(item, 'x.tmod')); w(path.join(item, 'y.scs')); w(path.join(item, 'descriptor.mod'), 'name="Big"\npath="stary"\n');
  const dst = n => path.join(root, 'dst-' + n);
  const pz = ws.installItem({ checker: 'projectzomboid' }, item, '1', dst('pz'));
  assert.deepStrictEqual(pz.map(p => path.basename(p)), ['Hydrocraft']); assert(fs.existsSync(path.join(dst('pz'), 'Hydrocraft', 'mod.info')));
  assert.strictEqual(path.basename(ws.installItem({ checker: 'dst' }, item, '5', dst('dst'))[0]), 'workshop-5');
  assert.strictEqual(path.basename(ws.installItem({ checker: 'garrysmod' }, item, '6', dst('gm'))[0]), '6_a.gma');
  assert.strictEqual(path.basename(ws.installItem({ checker: 'tmodloader' }, item, '7', dst('tm'))[0]), 'x.tmod');
  assert.strictEqual(path.basename(ws.installItem({ checker: 'ets2' }, item, '8', dst('ets'))[0]), '8_y.scs');
  assert.strictEqual(path.basename(ws.installItem({ checker: 'transportfever2' }, item, '9', dst('tf'))[0]), 'workshop_9_1');
  ws.installItem({ checker: 'paradox' }, item, '10', dst('px'));
  const desc = fs.readFileSync(path.join(dst('px'), 'ugc_10.mod'), 'utf8');
  assert(/name="Big"/.test(desc)); assert(!/stary/.test(desc)); assert(/remote_file_id="10"/.test(desc)); assert(/path=".*ugc_10"/.test(desc));
  assert(fs.existsSync(path.join(ws.installItem({ checker: 'files' }, item, '11', dst('def'))[0], 'a.gma')));
  assert.throws(() => ws.installItem({ checker: 'tmodloader' }, path.join(root, 'dst-pz'), '12', dst('none')), /nie zawiera/);
});

t('Warsztat: rozpoznanie modów z Warsztatu w raporcie i nieaktualne kopie', () => {
  const ws = require('../src/main/online/workshop');
  const rep = ws.annotate({ mods: [{ file: 'C:\\Steam\\steamapps\\workshop\\content\\108600\\2489310436\\mods\\X' }, { file: '/s/steamapps/workshop/content/4000/123456789' }, { source: 'Warsztat #987654321' }, { file: '/inne/mod.jar' }] });
  assert.deepStrictEqual(rep.mods.map(m => m.workshopId), ['2489310436', '123456789', '987654321', undefined]);
  const f = w(path.join(root, 'loc', 'a', 'b.txt')); const past = new Date(Date.now() - 86400000); fs.utimesSync(f, past, past);
  const m = ws.localMtime(path.join(root, 'loc')); assert(m > 0); assert.strictEqual(ws.localMtime(path.join(root, 'brak')), 0);
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 4).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
