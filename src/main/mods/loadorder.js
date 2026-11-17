// Kolejność ładowania: pluginy Bethesdy (plugins.txt) i mody RimWorld (ModsConfig.xml)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const G2 = require('../compat/games2');

function supported(game) { return game.checker === 'bethesda' || game.checker === 'rimworld'; }

/**
 * Stabilne sortowanie topologiczne: każdy element trafia za wszystkie, po których musi się ładować,
 * a poza tym zachowuje dotychczasową kolejność. after(item) → klucze elementów, które muszą być wcześniej.
 */
function topoSort(items, keyOf, after) {
  const key = new Map(items.map((it, i) => [keyOf(it), i]));
  const deps = items.map(it => [...new Set((after(it) || []).map(k => key.get(k)).filter(i => i !== undefined))]);
  const done = new Array(items.length).fill(false);
  const out = []; const cycles = [];
  while (out.length < items.length) {
    let pick = -1;
    for (let i = 0; i < items.length; i++) if (!done[i] && deps[i].every(d => done[d] || d === i)) { pick = i; break; }
    if (pick < 0) { // cykl – bierzemy pierwszy pozostały i zapamiętujemy
      pick = done.findIndex(x => !x); cycles.push(keyOf(items[pick]));
    }
    done[pick] = true; out.push(items[pick]);
  }
  return { items: out, cycles };
}

// ---------------- Bethesda ----------------
function bethesdaRead(game, gamePath) {
  const B = G2.BETHESDA[game.id];
  const data = path.join(gamePath, 'Data');
  const files = U.listFiles(data).filter(f => /\.(esp|esm|esl)$/i.test(f));
  const present = new Map(files.map(f => [path.basename(f).toLowerCase(), f]));
  const lo = G2.readLoadOrder(game.id);
  const items = [];
  const push = (name, active, base) => {
    const f = present.get(name.toLowerCase()); if (!f || items.find(x => x.key === name.toLowerCase())) return;
    let h = {}; try { h = G2.readPluginHeader(f); } catch { h = {}; }
    items.push({ key: name.toLowerCase(), name: path.basename(f), active: !!active, base: !!base, locked: !!base, master: !!h.master || /\.esm$/i.test(f), light: !!h.light || /\.esl$/i.test(f), after: (h.masters || []).map(m => m.toLowerCase()), kind: h.light || /\.esl$/i.test(f) ? 'ESL' : (h.master || /\.esm$/i.test(f)) ? 'ESM' : 'ESP' });
  };
  B.base.forEach(b => push(b, true, true));
  files.map(f => path.basename(f)).filter(n => /^cc\w+\.es[lm]$/i.test(n)).sort().forEach(n => push(n, true, true));
  (lo || []).forEach(e => push(e.name, e.active, false));
  files.map(f => path.basename(f)).sort((a, b) => a.localeCompare(b)).forEach(n => push(n, false, false));
  return { kind: 'bethesda', file: G2.pluginsTxt(game.id), exists: !!lo, items, hint: 'Mastery (ESM/ESL) ładują się przed zwykłymi pluginami, a każdy plugin po swoich masterach. Pliki gry i Creation Club są zablokowane na górze.' };
}
function bethesdaSort(items) {
  const base = items.filter(i => i.base);
  const masters = items.filter(i => !i.base && i.master);
  const rest = items.filter(i => !i.base && !i.master);
  const r = topoSort([...masters, ...rest], i => i.key, i => i.after);
  // master nie może trafić za zwykły plugin – po sortowaniu wypychamy mastery w górę z zachowaniem kolejności
  const sorted = [...r.items.filter(i => i.master), ...r.items.filter(i => !i.master)];
  return { items: [...base, ...sorted], cycles: r.cycles };
}
function bethesdaProblems(items) {
  const pos = new Map(items.map((it, i) => [it.key, i]));
  const out = [];
  items.forEach((it, i) => {
    if (!it.active) return;
    for (const m of it.after) {
      if (!pos.has(m)) out.push(`${it.name}: brak mastera ${m}`);
      else if (pos.get(m) > i) out.push(`${it.name} jest przed swoim masterem ${items[pos.get(m)].name}`);
      else if (!items[pos.get(m)].active) out.push(`${it.name}: master ${items[pos.get(m)].name} jest wyłączony`);
    }
  });
  return out;
}
function bethesdaWrite(game, items) {
  const f = G2.pluginsTxt(game.id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (U.exists(f)) fs.copyFileSync(f, f + '.bak');
  const lines = ['# Plik zapisany przez CodeManager', ...items.filter(i => !i.base).map(i => (i.active ? '*' : '') + i.name)];
  fs.writeFileSync(f, lines.join('\r\n') + '\r\n');
  return f;
}

// ---------------- RimWorld ----------------
const HARMONY = 'brrainz.harmony';
function rimRead(game, gamePath, workshop) {
  const mods = G2.rimReadMods(gamePath, workshop || []).filter(m => m.id);
  const act = G2.rimActive();
  const byId = new Map(mods.map(m => [m.id, m]));
  const items = [];
  const push = (id, active) => {
    const k = id.replace(/_steam$/, ''); const m = byId.get(k); if (items.find(x => x.key === k)) return;
    items.push({ key: k, raw: id, name: m ? m.name : id, active, locked: false, missing: !m, after: m ? [...m.after, ...m.deps.map(d => d.id)] : [], before: m ? m.before : [], kind: m ? m.source : 'brak' });
  };
  ((act && act.active) || []).forEach(id => push(id, true));
  mods.filter(m => !items.find(x => x.key === m.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(m => push(m.id, false));
  return { kind: 'rimworld', file: G2.rimConfigPath(), exists: !!act, items, hint: 'Harmony i gra podstawowa ładują się pierwsze, potem DLC, a reszta według loadAfter / loadBefore i zależności z About.xml.' };
}
function rimSort(items) {
  const rank = it => (it.key === HARMONY ? 0 : it.key === 'ludeon.rimworld' ? 1 : /^ludeon\.rimworld\./.test(it.key) ? 2 : 3);
  const active = items.filter(i => i.active);
  const inactive = items.filter(i => !i.active);
  const ordered = active.slice().sort((a, b) => rank(a) - rank(b) || active.indexOf(a) - active.indexOf(b));
  // loadBefore X == X ładuje się po tym modzie
  const extraAfter = new Map();
  for (const it of ordered) for (const b of it.before || []) { if (!extraAfter.has(b)) extraAfter.set(b, []); extraAfter.get(b).push(it.key); }
  const r = topoSort(ordered, i => i.key, i => (rank(i) < 3 ? ordered.filter(o => rank(o) < rank(i)).map(o => o.key) : [...i.after, ...(extraAfter.get(i.key) || []), ...ordered.filter(o => rank(o) < 3).map(o => o.key)]));
  return { items: [...r.items, ...inactive], cycles: r.cycles };
}
function rimProblems(items) {
  const act = items.filter(i => i.active); const pos = new Map(act.map((it, i) => [it.key, i]));
  const out = [];
  act.forEach((it, i) => {
    if (it.missing) out.push(`${it.name}: moda nie ma na dysku`);
    for (const a of it.after) if (pos.has(a) && pos.get(a) > i) out.push(`${it.name} powinien być po ${act[pos.get(a)].name}`);
    for (const b of it.before || []) if (pos.has(b) && pos.get(b) < i) out.push(`${it.name} powinien być przed ${act[pos.get(b)].name}`);
  });
  return out;
}
function rimWrite(items) {
  const f = G2.rimConfigPath(); const t = U.readText(f);
  if (!t) throw new Error('Nie znaleziono ModsConfig.xml – uruchom grę raz.');
  const block = `<activeMods>\n${items.filter(i => i.active).map(i => `    <li>${i.raw || i.key}</li>`).join('\n')}\n  </activeMods>`;
  fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f, /<activeMods>[\s\S]*?<\/activeMods>/i.test(t) ? t.replace(/<activeMods>[\s\S]*?<\/activeMods>/i, block) : t.replace(/<\/ModsConfigData>/i, `  ${block}\n</ModsConfigData>`));
  return f;
}

// ---------------- wspólne API ----------------
function get(game, info) {
  let r;
  if (game.checker === 'bethesda') { r = bethesdaRead(game, info.path); r.problems = bethesdaProblems(r.items); }
  else if (game.checker === 'rimworld') { r = rimRead(game, info.path, info.workshop); r.problems = rimProblems(r.items); }
  else throw new Error('Ta gra nie ma kolejności ładowania do ustawienia.');
  return r;
}
function autoSort(game, items) {
  const r = game.checker === 'bethesda' ? bethesdaSort(items) : rimSort(items);
  return { ...r, problems: game.checker === 'bethesda' ? bethesdaProblems(r.items) : rimProblems(r.items) };
}
function save(game, items) {
  // elementy zablokowane zawsze zostają na swoich miejscach na górze
  const locked = items.filter(i => i.locked); const rest = items.filter(i => !i.locked);
  const list = [...locked, ...rest];
  return game.checker === 'bethesda' ? bethesdaWrite(game, list) : rimWrite(list);
}
function problems(game, items) { return game.checker === 'bethesda' ? bethesdaProblems(items) : rimProblems(items); }

module.exports = { supported, get, autoSort, save, problems, topoSort, bethesdaSort, rimSort };
