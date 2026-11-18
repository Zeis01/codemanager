// Parser plików definicji LuaCATS (---@meta, ---@param, ---@class…) używanych przez Lua Language Server.
// Zamienia je na bazę podpowiedzi edytora: { globals, tables, classes, vars, events }.
// Wpis: [rodzaj, sygnatura, typ_wyniku, opis, strona, przestarzały]; rodzaj: f – funkcja, v – zmienna, c – stała, t – tabela
'use strict';

const DOC_MAX = 420;
function cleanDoc(lines) {
  let realm = '';
  const out = [];
  for (let l of lines) {
    const img = l.match(/!\[\(([^)]*)\)\]\([^)]*\)/);
    if (img) { const r = img[1].toLowerCase(); realm = /shared/.test(r) ? 'sh' : /server/.test(r) ? 's' : /client/.test(r) ? 'c' : /menu/.test(r) ? 'm' : realm; }
    l = l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\[View wiki\]\(.*\)$/i, '').replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1').replace(/\*\*/g, '').replace(/<\/?[a-z][^>]*>/gi, '');
    out.push(l.trim());
  }
  let d = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (d.length > DOC_MAX) { const cut = d.slice(0, DOC_MAX); d = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf('\n'), 200)).trim() + ' …'; }
  return { doc: d, realm };
}
const cleanType = t => String(t || '').replace(/\s+/g, ' ').trim();
// główny typ (bez nil, unii, generyków) – do podpowiedzi po kropce dla wyniku
function mainType(t) {
  t = cleanType(t).replace(/\?$/, '');
  if (!t) return '';
  const parts = t.split('|').map(x => x.trim()).filter(x => x && x !== 'nil');
  return parts.length === 1 ? parts[0] : '';
}

function parse(text, db = { globals: {}, tables: {}, classes: {}, vars: {}, events: {} }) {
  const lines = String(text).split(/\r?\n/);
  let doc = []; let params = []; let ret = []; let cls = null; let deprecated = false; let typeTag = null; let curClass = null;
  const reset = () => { doc = []; params = []; ret = []; cls = null; deprecated = false; typeTag = null; };
  const entry = (kind, sig, rtype, extraDoc) => {
    const { doc: d, realm } = cleanDoc(doc);
    return [kind, sig || '', mainType(rtype) || '', [d, extraDoc].filter(Boolean).join('\n'), realm, deprecated ? 1 : 0];
  };
  const sigOf = (argNames) => {
    const names = argNames.split(',').map(s => s.trim()).filter(Boolean);
    const parts = names.map(n => { if (n === '...') { const p = params.find(x => x.name === '...'); return p ? '...: ' + p.type : '...'; } const p = params.find(x => x.name === n); return p ? `${n}${p.opt ? '?' : ''}: ${p.type}` : n; });
    const r = ret.map(x => x.type).filter(Boolean);
    return '(' + parts.join(', ') + ')' + (r.length ? ': ' + r.join(', ') : '');
  };
  const paramDoc = () => { const t = params.filter(p => p.desc).map(p => `${p.name} – ${p.desc}`).join('\n'); return t.length > 400 ? t.slice(0, 397) + '…' : t; };
  const tableOf = name => (db.tables[name] = db.tables[name] || {});
  const classOf = name => (db.classes[name] = db.classes[name] || { b: '', m: {} });
  const isClass = name => !!db.classes[name];

  let block = null; // otwarta tabela: { name, depth }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    let m;
    if (block && !line.startsWith('---')) {
      // pola tabeli zapisanej w kilku liniach: Name = { pole = 1, Add = function(cb) end, }
      const opens = (line.match(/\{/g) || []).length; const closes = (line.match(/\}/g) || []).length;
      if (block.depth === 1) {
        const owner = block.name; const put = (n, e) => { if (isClass(owner)) classOf(owner).m[n] = e; else tableOf(owner)[n] = e; };
        if ((m = line.match(/^\[?["']?(\w+)["']?\]?\s*=\s*function\s*\(([^)]*)\)/))) { put(m[1], entry('f', sigOf(m[2]), ret[0] && ret[0].type, paramDoc())); reset(); }
        else if ((m = line.match(/^\[?["']?(\w+)["']?\]?\s*=\s*([^,{]*)/))) { const v = m[2].trim(); put(m[1], entry(/^[A-Z0-9_]+$/.test(m[1]) ? 'c' : opens ? 't' : 'v', '', typeTag || '', /^-?[\d.]+$|^".*"$/.test(v) ? '= ' + v : '')); reset(); }
        else if (line && !line.startsWith('--')) reset();
      }
      block.depth += opens - closes;
      if (block.depth <= 0) block = null;
      continue;
    }
    if (line.startsWith('---')) {
      const c = line.replace(/^---\s?/, '');
      if ((m = c.match(/^@param\s+(\.\.\.|[\w]+)(\?)?\s+(\S+(?:\s*\|\s*\S+)*)\s*(.*)$/))) { params.push({ name: m[1], opt: !!m[2] || /\|\s*nil|\?$/.test(m[3]), type: cleanType(m[3]).replace(/\?$/, ''), desc: m[4].replace(/^#\s*/, '').trim() }); continue; }
      if ((m = c.match(/^@return\s+(\S+(?:\s*\|\s*\S+)*)\s*(.*)$/))) { ret.push({ type: cleanType(m[1]), desc: m[2].replace(/^#\s*/, '').trim() }); continue; }
      if ((m = c.match(/^@class\s+(\(\w+\)\s*)?([\w.]+)\s*(?::\s*([\w.]+))?/))) { cls = m[2]; const k = classOf(cls); if (m[3]) k.b = m[3]; const { doc: d } = cleanDoc(doc); if (d) k.d = d; curClass = cls; continue; }
      if ((m = c.match(/^@field\s+(?:(?:public|private|protected|package)\s+)?(\[?["']?[\w]+["']?\]?)(\?)?\s+(\S+(?:\s*\|\s*\S+)*)\s*(.*)$/))) {
        if (curClass) { const name = m[1].replace(/[[\]"']/g, ''); const t = cleanType(m[3]); const fn = t.match(/^fun\((.*)\)(?::\s*(.+))?$/); classOf(curClass).m[name] = fn ? ['f', '(' + fn[1] + ')' + (fn[2] ? ': ' + fn[2] : ''), mainType(fn[2]), m[4].trim(), '', 0] : ['v', '', mainType(t), (t + (m[4] ? ' – ' + m[4].trim() : '')), '', 0]; }
        continue;
      }
      if (/^@deprecated/.test(c)) { deprecated = true; const r = c.replace(/^@deprecated\s*/, ''); if (r) doc.push('Przestarzałe: ' + r); continue; }
      if ((m = c.match(/^@type\s+(.+)$/))) { typeTag = cleanType(m[1]); continue; }
      if (/^@(meta|alias|overload|generic|see|nodiscard|async|cast|diagnostic|module|operator|package|private|protected|source|version|enum|realm|internal|vararg)\b/.test(c)) continue;
      if (/^@/.test(c)) continue;
      doc.push(c);
      continue;
    }
    if (!line) { curClass = null; reset(); continue; }
    // function A.B:C(...) end
    if ((m = line.match(/^(?:local\s+)?function\s+([\w.]+)([.:])(\w+)\s*\(([^)]*)\)/))) {
      const owner = m[1]; const name = m[3];
      const e = entry('f', sigOf(m[4]), ret[0] && ret[0].type, paramDoc());
      if (owner === '_G') db.globals[name] = e;
      else if (m[2] === ':' || isClass(owner)) classOf(owner).m[name] = e; else tableOf(owner)[name] = e;
      reset(); continue;
    }
    if ((m = line.match(/^(?:local\s+)?function\s+(\w+)\s*\(([^)]*)\)/))) {
      db.globals[m[1]] = entry('f', sigOf(m[2]), ret[0] && ret[0].type, paramDoc()); reset(); continue;
    }
    // A.B = function(...)
    if ((m = line.match(/^([\w.]+)\.(\w+)\s*=\s*function\s*\(([^)]*)\)/))) {
      const e = entry('f', sigOf(m[3]), ret[0] && ret[0].type, paramDoc());
      if (isClass(m[1])) classOf(m[1]).m[m[2]] = e; else tableOf(m[1])[m[2]] = e;
      reset(); continue;
    }
    // Name = {} / local Name = {} (tabela lub klasa)
    if ((m = line.match(/^(local\s+)?([\w.]+)\s*=\s*\{\s*\}?/)) && !line.includes('function')) {
      const name = m[2];
      const open = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (cls && cls === name) { /* klasa */ } else if (cls) { classOf(cls); if (!m[1]) db.vars[name] = cls; } else if (!m[1]) {
        if (name.includes('.')) { const o = name.slice(0, name.lastIndexOf('.')); tableOf(o)[name.slice(name.lastIndexOf('.') + 1)] = entry('t', '', '', ''); }
        tableOf(name); const { doc: d } = cleanDoc(doc); if (d) tableOf(name).__doc = d;
      }
      const target = cls && cls !== name ? cls : name;
      reset();
      if (open > 0) block = { name: target, depth: open };
      continue;
    }
    // Alias = A.B  (np. CreateThread = Citizen.CreateThread)
    if ((m = line.match(/^(\w+)\s*=\s*([\w]+)\.(\w+)\s*$/)) && db.tables[m[2]] && db.tables[m[2]][m[3]]) { db.globals[m[1]] = db.tables[m[2]][m[3]]; reset(); continue; }
    // A.B = wartość / Name = wartość
    if ((m = line.match(/^(local\s+)?([\w.]+)\s*=\s*(.+)$/))) {
      const name = m[2]; const val = m[3].trim();
      if (!m[1] && /^[A-Za-z_]\w*$/.test(val) && isClass(val) && !name.includes('.')) { db.vars[name] = val; db.globals[name] = entry('v', '', val, ''); reset(); continue; }
      const kind = /^[A-Z0-9_]+$/.test(name.split('.').pop()) ? 'c' : 'v';
      const valueDoc = /^-?[\d.]+$|^".*"$|^true$|^false$/.test(val) ? '= ' + val : '';
      const e = entry(kind, '', typeTag || '', valueDoc);
      if (name.startsWith('_G.') && !name.slice(3).includes('.')) db.globals[name.slice(3)] = e;
      else if (name.includes('.')) { const o = name.slice(0, name.lastIndexOf('.')); const n = name.slice(name.lastIndexOf('.') + 1); if (isClass(o)) classOf(o).m[n] = e; else tableOf(o)[n] = e; } else if (!m[1]) { db.globals[name] = e; if (typeTag && mainType(typeTag)) db.vars[name] = mainType(typeTag); }
      reset(); continue;
    }
    reset();
  }
  return db;
}

module.exports = { parse, cleanDoc, mainType };
