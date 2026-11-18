// Podpowiedzi podczas pisania (jak w VS Code): Python (moduły z Pythona na komputerze lub wbudowana baza),
// Lua (biblioteka standardowa + funkcje i tabele z pliku); podpowiedzi parametrów i opisy po najechaniu
'use strict';
window.EditorComplete = (function () {
  let M = null; // monaco
  const memo = new Map(); // ścieżka → lista składowych (Python)
  let pyStatus = null; let pyModules = null;

  // ======================= wspólne =======================
  const K = () => M.languages.CompletionItemKind;
  const kindOf = (k, member) => ({ module: K().Module, class: K().Class, function: K().Function, method: K().Function, variable: K().Variable, constant: K().Constant, field: K().Field, keyword: K().Keyword, property: K().Property }[k] || K().Variable);
  const rangeAt = (model, pos) => { const w = model.getWordUntilPosition(pos); return { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn }; };
  const md = (sig, doc, lang) => ({ value: (sig ? '```' + lang + '\n' + sig + '\n```\n' : '') + (doc ? String(doc).replace(/([*_`])/g, '\\$1') : '') });
  const item = (e, range, lang, opts = {}) => {
    const sig = e.s ? e.n + e.s : '';
    const det = e.k === 'module' ? 'moduł' : e.k === 'class' ? (e.s ? 'class ' + e.n + e.s : 'class') : e.s ? (opts.prefix || '') + sig : e.t ? e.t + (e.v ? ' = ' + e.v : '') : e.k === 'keyword' ? 'słowo kluczowe' : '';
    return {
      label: e.n, kind: kindOf(e.k, opts.member), detail: det, documentation: e.d || e.s ? md(e.k === 'function' || e.k === 'class' ? (opts.prefix || '') + sig : '', e.d, lang) : undefined, insertText: e.n, range,
      sortText: (e.n.startsWith('_') ? 'z' : opts.local ? 'a' : 'm') + e.n.toLowerCase(),
    };
  };
  const enabled = () => App.state.settings.editorSuggest !== false;

  // ======================= Python =======================
  const PY_KW = 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'.split(' ');
  const LIT = { '"': '@str', "'": '@str' };
  const db = () => window.PY_DB || { modules: [], members: {} };
  // wbudowana baza: [nazwa, rodzaj (f/c/m/v/k), sygnatura, opis]
  const DBK = { f: 'function', c: 'class', m: 'module', v: 'variable', k: 'constant' };
  function dbMembers(p) {
    const raw = db().members[p];
    if (!raw) return null;
    return raw.map(x => { const k = DBK[x[1]] || 'variable'; return { n: x[0], k, s: k === 'function' || k === 'class' ? x[2] || undefined : undefined, d: x[3] || undefined }; });
  }
  async function pyStat() { if (pyStatus) return pyStatus; try { pyStatus = await window.cm.call('py:status'); } catch { pyStatus = { found: false }; } return pyStatus; }
  async function members(p) {
    if (!p) return null;
    if (memo.has(p)) return memo.get(p);
    let list = null;
    const builtinType = p.startsWith('@');
    const st = await pyStat();
    if (st.found) {
      try { const r = await window.cm.call('py:members', [builtinType ? p.slice(1) : p]); list = r[builtinType ? p.slice(1) : p]; } catch { list = null; }
    }
    if (!list) list = dbMembers(p);
    if (list) list = list.filter(e => !(e.n.startsWith('__') && e.n.endsWith('__')) || e.n === '__init__');
    memo.set(p, list); return list;
  }
  async function moduleList() {
    if (pyModules) return pyModules;
    const st = await pyStat();
    if (st.found) { try { pyModules = await window.cm.call('py:modules'); } catch { pyModules = null; } }
    if (!pyModules) pyModules = db().modules;
    return pyModules;
  }

  // analiza pliku: importy, definicje, klasy, przypisania
  function pyParse(text) {
    const lines = text.split(/\r?\n/);
    const imports = {}; const defs = []; const classes = {}; const vars = {};
    let cls = null;
    lines.forEach((raw, i) => {
      const line = raw.replace(/#.*$/, '');
      const ind = (raw.match(/^\s*/) || [''])[0].length;
      if (cls && line.trim() && ind <= cls.indent) cls = null;
      if (cls && cls.methodIndent != null && line.trim() && ind <= cls.methodIndent && !/^\s*(async\s+)?def\b/.test(line)) cls.methodIndent = null;
      let m;
      if ((m = line.match(/^\s*import\s+(.+)$/))) {
        for (const part of m[1].split(',')) { const mm = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/); if (mm) { if (mm[2]) imports[mm[2]] = mm[1]; else imports[mm[1].split('.')[0]] = mm[1].split('.')[0]; } }
      } else if ((m = line.match(/^\s*from\s+([\w.]+)\s+import\s+\(?([^)]+)\)?/))) {
        if (!m[1].startsWith('.')) for (const part of m[2].split(',')) { const mm = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/); if (mm && mm[1] !== '*') imports[mm[2] || mm[1]] = m[1] + '.' + mm[1]; }
      } else if ((m = line.match(/^(\s*)class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/))) {
        cls = { name: m[2], indent: m[1].length, bases: (m[3] || '').split(',').map(s => s.trim()).filter(Boolean), methods: [], attrs: {}, line: i + 1, doc: docAfter(lines, i) };
        classes[m[2]] = cls;
      } else if ((m = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)?/))) {
        const d = { n: m[2], k: 'function', s: '(' + (m[3] || '').trim() + ')', d: docAfter(lines, i), line: i + 1 };
        if (cls && m[1].length > cls.indent) { d.s = d.s.replace(/^\(\s*(self|cls)\s*,?\s*/, '('); cls.methods.push(d); cls.methodIndent = m[1].length; } else if (!m[1].length) defs.push(d);
      } else if (cls && (m = line.match(/^\s*self\.(\w+)\s*(?::[^=]+)?=\s*(.+)$/))) {
        if (!cls.attrs[m[1]]) cls.attrs[m[1]] = m[2].trim();
      } else if ((m = line.match(/^(\s*)(\w+)\s*(?::\s*([\w.[\]]+))?\s*=\s*(.+)$/)) && !/^\s*(if|elif|while|return)\b/.test(line) && !m[4].startsWith('=')) {
        if (cls && m[1].length > cls.indent && cls.methodIndent == null && !cls.attrs[m[2]]) cls.attrs[m[2]] = m[4].trim();
        if (!vars[m[2]] || !m[1].length) vars[m[2]] = { expr: m[4].trim(), ann: m[3], line: i + 1, top: !m[1].length };
      } else if ((m = line.match(/^\s*with\s+(.+?)\s+as\s+(\w+)\s*:/))) {
        vars[m[2]] = { expr: m[1].trim(), line: i + 1 };
      } else if ((m = line.match(/^\s*for\s+(\w+)\s+in\s+(.+):/))) {
        vars[m[1]] = vars[m[1]] || { expr: null, line: i + 1 };
      }
    });
    return { imports, defs, classes, vars, lines };
  }
  function docAfter(lines, i) { const n = (lines[i + 1] || '').trim(); const m = n.match(/^[rbuRBU]?("""|''')(.*?)(\1)?$/); return m ? m[2].trim() || ((lines[i + 2] || '').trim()) : undefined; }
  function classAt(ctx, lineNo) { let best = null; for (const c of Object.values(ctx.classes)) if (c.line <= lineNo && (!best || c.line > best.line)) { const ind = c.indent; const between = ctx.lines.slice(c.line, lineNo - 1); if (!between.some(l => l.trim() && !/^\s*#/.test(l) && (l.match(/^\s*/)[0].length <= ind))) best = c; } return best; }

  // typ wyrażenia: { path } (moduł/klasa z Pythona), { local } (klasa z pliku) albo null
  const BUILTIN_TYPES = { str: '@str', list: '@list', dict: '@dict', set: '@set', tuple: '@tuple', bytes: '@bytes', int: '@int', float: '@float', bytearray: '@bytearray', frozenset: '@frozenset' };
  function exprType(expr, ctx, depth = 0) {
    if (!expr || depth > 4) return null;
    expr = expr.trim();
    if (/^[rbfuRBFU]{0,2}["']/.test(expr)) return { path: /^[bB]/.test(expr) ? '@bytes' : '@str' };
    if (/^\[/.test(expr)) return { path: '@list' };
    if (/^\{\s*\}$/.test(expr) || /^\{[^}]*:/.test(expr)) return { path: '@dict' };
    if (/^\{/.test(expr)) return { path: '@set' };
    if (/^\(/.test(expr) && /,/.test(expr)) return { path: '@tuple' };
    if (/^-?\d+\.\d*$/.test(expr)) return { path: '@float' };
    if (/^-?\d+$/.test(expr)) return { path: '@int' };
    if (/^open\s*\(/.test(expr)) return { path: /['"][rwax]?b/.test(expr) ? 'io.BufferedReader' : 'io.TextIOWrapper' };
    const m = expr.match(/^([A-Za-z_][\w.]*)\s*(\()?/);
    if (!m) return null;
    const chain = m[1].split('.');
    const call = !!m[2];
    if (chain.length === 1 && BUILTIN_TYPES[chain[0]] && call) return { path: BUILTIN_TYPES[chain[0]] };
    if (chain.length === 1 && ctx.classes[chain[0]] && call) return { local: ctx.classes[chain[0]] };
    const base = resolveChain(chain, ctx, depth + 1);
    if (!base) return null;
    if (base.path && call) {
      // wynik wywołania: instancja klasy (Nazwa z wielkiej litery) albo nieznany wynik funkcji
      const last = chain[chain.length - 1];
      return /^[A-Z]/.test(last) ? { path: base.path } : null;
    }
    return base;
  }
  // a.b.c → typ ostatniego elementu
  function resolveChain(chain, ctx, depth = 0) {
    let head = chain[0]; let rest = chain.slice(1); let cur = null;
    if (head === 'self' || head === 'cls') { const c = ctx.cursorClass; if (!c) return null; cur = { local: c, instance: head === 'self' }; }
    else if (ctx.imports[head]) cur = { path: ctx.imports[head] };
    else if (ctx.classes[head]) cur = { local: ctx.classes[head] };
    else if (BUILTIN_TYPES[head]) cur = { path: BUILTIN_TYPES[head] };
    else if (ctx.vars[head] && ctx.vars[head].expr) {
      if (ctx.vars[head].ann && BUILTIN_TYPES[ctx.vars[head].ann]) cur = { path: BUILTIN_TYPES[ctx.vars[head].ann] };
      else cur = exprType(ctx.vars[head].expr, ctx, depth + 1);
    } else if ((db().modules || []).includes(head) && !ctx.vars[head]) cur = null;
    if (!cur) return null;
    for (const p of rest) {
      if (cur.local) {
        const c = cur.local;
        if (c.attrs[p]) { cur = exprType(c.attrs[p], ctx, depth + 1); if (!cur) return null; continue; }
        return null;
      }
      if (cur.path && cur.path.startsWith('@')) return null;
      cur = { path: cur.path + '.' + p };
    }
    return cur;
  }
  function localMembers(c, ctx, seen = new Set()) {
    if (seen.has(c.name)) return [];
    seen.add(c.name);
    const out = [...c.methods.map(m => ({ ...m, k: 'method' })), ...Object.keys(c.attrs).map(n => ({ n, k: 'field', d: 'self.' + n + ' = ' + c.attrs[n] }))];
    for (const b of c.bases) if (ctx.classes[b]) out.push(...localMembers(ctx.classes[b], ctx, seen));
    return out;
  }
  async function typeMembers(t, ctx) {
    if (!t) return null;
    if (t.local) {
      const own = localMembers(t.local, ctx);
      // klasy bazowe z modułów (np. class Bot(discord.Client))
      for (const b of t.local.bases) { if (ctx.classes[b]) continue; const bt = resolveChain(b.split('.'), ctx); if (bt && bt.path) own.push(...((await members(bt.path)) || [])); }
      return own;
    }
    return members(t.path);
  }

  async function pyComplete(model, pos) {
    if (!enabled()) return { suggestions: [] };
    const lineText = model.getLineContent(pos.lineNumber);
    const before = lineText.slice(0, pos.column - 1);
    if (/#/.test(before.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')) ) return { suggestions: [] };
    const range = rangeAt(model, pos);
    const ctx = pyParse(model.getValue());
    ctx.cursorClass = classAt(ctx, pos.lineNumber);
    let m;
    // import a / import a.b
    if ((m = before.match(/^\s*import\s+(?:[\w.]+\s*,\s*)*([\w.]*)$/)) || (m = before.match(/^\s*from\s+([\w.]*)$/))) {
      const typed = m[1];
      if (typed.includes('.')) { const parent = typed.slice(0, typed.lastIndexOf('.')); const list = ((await members(parent)) || []).filter(e => e.k === 'module'); return { suggestions: list.map(e => item(e, range, 'python')) }; }
      const mods = await moduleList();
      return { suggestions: mods.map(n => item({ n, k: 'module' }, range, 'python')) };
    }
    // from a import x
    if ((m = before.match(/^\s*from\s+([\w.]+)\s+import\s+(?:\(?\s*(?:\w+(?:\s+as\s+\w+)?\s*,\s*)*)(\w*)$/))) {
      const list = (await members(m[1])) || [];
      return { suggestions: list.map(e => item(e, range, 'python')) };
    }
    // obiekt.  (także "tekst".)
    if ((m = before.match(/(["'])(?:\\.|(?!\1).)*\1\.(\w*)$/))) {
      const list = (await members('@str')) || [];
      return { suggestions: list.map(e => item(e, range, 'python', { member: true })) };
    }
    if ((m = before.match(/((?:[A-Za-z_]\w*\s*\.\s*)+)(\w*)$/))) {
      const chain = m[1].split('.').map(s => s.trim()).filter(Boolean);
      const t = resolveChain(chain, ctx);
      const list = await typeMembers(t, ctx);
      if (!list) return { suggestions: [] };
      const prefix = '';
      return { suggestions: list.map(e => item(e, range, 'python', { member: true, prefix, local: !!t.local })) };
    }
    // zwykłe pisanie: słowa kluczowe, wbudowane, importy, definicje z pliku
    const out = [];
    const seen = new Set();
    const push = (e, opts) => { if (seen.has(e.n)) return; seen.add(e.n); out.push(item(e, range, 'python', opts)); };
    for (const d of ctx.defs) push(d, { local: true });
    for (const c of Object.values(ctx.classes)) push({ n: c.name, k: 'class', d: c.doc }, { local: true });
    for (const [n, p] of Object.entries(ctx.imports)) push({ n, k: p.includes('.') && !(await isModulePath(p)) ? 'function' : 'module', d: p }, { local: true });
    for (const [n, v] of Object.entries(ctx.vars)) if (v.line !== pos.lineNumber) push({ n, k: /^[A-Z0-9_]+$/.test(n) ? 'constant' : 'variable', d: v.expr ? n + ' = ' + v.expr.slice(0, 80) : undefined }, { local: true });
    if (ctx.cursorClass) push({ n: 'self', k: 'variable', d: 'instancja klasy ' + ctx.cursorClass.name }, { local: true });
    for (const k of PY_KW) push({ n: k, k: 'keyword' });
    for (const e of (await members('builtins')) || dbMembers('builtins') || []) if (!e.n.startsWith('_')) push(e);
    return { suggestions: out };
  }
  async function isModulePath(p) { const parent = p.slice(0, p.lastIndexOf('.')); const list = await members(parent); const e = list && list.find(x => x.n === p.slice(p.lastIndexOf('.') + 1)); return e ? e.k === 'module' : false; }

  // informacje o wywoływanej funkcji (podpowiedź parametrów, opis po najechaniu)
  async function pyInfo(model, lineNo, chainText) {
    const ctx = pyParse(model.getValue()); ctx.cursorClass = classAt(ctx, lineNo);
    const chain = chainText.split('.').map(s => s.trim()).filter(Boolean);
    if (!chain.length) return null;
    const name = chain[chain.length - 1];
    if (chain.length === 1) {
      const d = ctx.defs.find(x => x.n === name); if (d) return d;
      const c = ctx.classes[name]; if (c) { const init = c.methods.find(x => x.n === '__init__'); return { n: name, k: 'class', s: init ? init.s : '()', d: c.doc }; }
      if (ctx.imports[name]) { const p = ctx.imports[name]; const parent = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : null; if (!parent) return { n: name, k: 'module', d: 'moduł ' + p }; const e = ((await members(parent)) || []).find(x => x.n === p.slice(p.lastIndexOf('.') + 1)); if (e) return e; }
      const b = ((await members('builtins')) || []).find(x => x.n === name); if (b) return b;
      return null;
    }
    const t = resolveChain(chain.slice(0, -1), ctx);
    const list = await typeMembers(t, ctx);
    return list ? list.find(x => x.n === name) || null : null;
  }
  async function pySignature(model, pos) {
    if (!enabled()) return null;
    const text = model.getValueInRange({ startLineNumber: Math.max(1, pos.lineNumber - 10), startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
    // znajdź niezamknięty nawias
    let depth = 0; let i = text.length - 1; let commas = 0;
    for (; i >= 0; i--) { const ch = text[i]; if (ch === ')') depth++; else if (ch === '(') { if (!depth) break; depth--; } else if (ch === ',' && !depth) commas++; }
    if (i < 0) return null;
    const m = text.slice(0, i).match(/([A-Za-z_][\w.]*)\s*$/); if (!m) return null;
    const info = await pyInfo(model, pos.lineNumber, m[1]);
    if (!info || !info.s) return null;
    const inner = info.s.replace(/^\(|\)(\s*->.*)?$/g, '');
    const params = splitParams(inner).filter(p => !/^\s*(self|cls)\s*$/.test(p) && p.trim() !== '/' );
    const label = info.n + '(' + params.join(', ') + ')' + ((info.s.match(/\)\s*(->.*)$/) || [])[1] ? ' ' + info.s.match(/\)\s*(->.*)$/)[1] : '');
    return { value: { signatures: [{ label, documentation: info.d ? { value: info.d } : undefined, parameters: params.map(p => ({ label: p.trim() })) }], activeSignature: 0, activeParameter: Math.min(commas, Math.max(0, params.length - 1)) }, dispose() {} };
  }
  function splitParams(s) { const out = []; let d = 0; let cur = ''; for (const ch of s) { if ('([{'.includes(ch)) d++; if (')]}'.includes(ch)) d--; if (ch === ',' && !d) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  async function pyHover(model, pos) {
    if (!enabled()) return null;
    const w = model.getWordAtPosition(pos); if (!w) return null;
    const line = model.getLineContent(pos.lineNumber);
    const left = line.slice(0, w.endColumn - 1); const m = left.match(/([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_]\w*)*)$/); if (!m) return null;
    if (PY_KW.includes(w.word)) return null;
    const info = await pyInfo(model, pos.lineNumber, m[1].replace(/\s+/g, ''));
    if (!info) return null;
    const head = info.k === 'module' ? '(moduł) ' + info.n : info.k === 'class' ? 'class ' + info.n + (info.s || '') : info.s ? (info.k === 'method' ? '(metoda) ' : 'def ') + info.n + info.s : '(zmienna) ' + info.n + (info.t ? ': ' + info.t : '');
    return { range: new M.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), contents: [{ value: '```python\n' + head + '\n```' }, ...(info.d ? [{ value: String(info.d) }] : [])] };
  }

  // ======================= Lua =======================
  const LUA_KW = 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' ');
  const L = (n, s, d) => ({ n, k: s ? 'function' : 'variable', s, d });
  const LUA_G = [L('print', '(...)', 'Wypisuje wartości.'), L('pairs', '(t)', 'Iterator po wszystkich parach klucz–wartość tabeli.'), L('ipairs', '(t)', 'Iterator po elementach 1..n tabeli.'), L('type', '(v)', 'Nazwa typu wartości: "nil", "number", "string", "table", "function"…'),
    L('tostring', '(v)', 'Zamienia wartość na tekst.'), L('tonumber', '(e [, base])', 'Zamienia tekst na liczbę (nil, gdy się nie da).'), L('require', '(modname)', 'Wczytuje moduł.'), L('pcall', '(f, ...)', 'Wywołuje funkcję w trybie chronionym: ok, wynik_lub_błąd.'),
    L('xpcall', '(f, msgh, ...)', 'pcall z własną obsługą błędu.'), L('error', '(message [, level])', 'Zgłasza błąd.'), L('assert', '(v [, message])', 'Zgłasza błąd, gdy v jest false/nil.'), L('select', '(index, ...)', 'Zwraca argumenty od podanego numeru albo ich liczbę ("#").'),
    L('next', '(t [, index])', 'Następna para klucz–wartość.'), L('rawget', '(t, k)'), L('rawset', '(t, k, v)'), L('rawequal', '(a, b)'), L('rawlen', '(v)'), L('setmetatable', '(t, mt)', 'Ustawia metatablicę.'), L('getmetatable', '(obj)'),
    L('unpack', '(list [, i [, j]])', 'Lua 5.1: rozpakowuje tabelę (w 5.2+ table.unpack).'), L('load', '(chunk [, chunkname [, mode [, env]]])'), L('loadstring', '(string [, chunkname])', 'Lua 5.1'), L('dofile', '([filename])'), L('collectgarbage', '([opt [, arg]])'),
    L('_G', null, 'Tabela zmiennych globalnych.'), L('_VERSION', null, 'Wersja Lua.')];
  const LUA_LIB = {
    string: [L('byte', '(s [, i [, j]])'), L('char', '(...)'), L('find', '(s, pattern [, init [, plain]])', 'Szuka wzorca; zwraca początek i koniec.'), L('format', '(formatstring, ...)', 'Formatowanie jak printf.'), L('gmatch', '(s, pattern)', 'Iterator po dopasowaniach.'), L('gsub', '(s, pattern, repl [, n])', 'Zamienia dopasowania.'), L('len', '(s)'), L('lower', '(s)'), L('upper', '(s)'), L('match', '(s, pattern [, init])'), L('rep', '(s, n [, sep])'), L('reverse', '(s)'), L('sub', '(s, i [, j])', 'Fragment tekstu.'), L('pack', '(fmt, v1, ...)'), L('unpack', '(fmt, s [, pos])'), L('packsize', '(fmt)')],
    table: [L('insert', '(list, [pos,] value)', 'Wstawia element.'), L('remove', '(list [, pos])', 'Usuwa element.'), L('concat', '(list [, sep [, i [, j]]])', 'Łączy elementy w tekst.'), L('sort', '(list [, comp])'), L('unpack', '(list [, i [, j]])'), L('pack', '(...)'), L('move', '(a1, f, e, t [, a2])'), L('getn', '(t)', 'Lua 5.1')],
    math: [L('abs', '(x)'), L('ceil', '(x)'), L('floor', '(x)'), L('sqrt', '(x)'), L('max', '(x, ...)'), L('min', '(x, ...)'), L('random', '([m [, n]])', 'Liczba losowa.'), L('randomseed', '([x [, y]])'), L('sin', '(x)'), L('cos', '(x)'), L('tan', '(x)'), L('asin', '(x)'), L('acos', '(x)'), L('atan', '(y [, x])'), L('exp', '(x)'), L('log', '(x [, base])'), L('fmod', '(x, y)'), L('modf', '(x)'), L('tointeger', '(x)'), L('type', '(x)'), L('ult', '(m, n)'), L('pi'), L('huge'), L('maxinteger'), L('mininteger')],
    os: [L('time', '([table])', 'Czas w sekundach od 1970 r.'), L('clock', '()', 'Czas procesora.'), L('date', '([format [, time]])', 'Data jako tekst lub tabela.'), L('difftime', '(t2, t1)'), L('getenv', '(varname)'), L('remove', '(filename)'), L('rename', '(oldname, newname)'), L('tmpname', '()'), L('exit', '([code [, close]])'), L('execute', '([command])')],
    io: [L('open', '(filename [, mode])', 'Otwiera plik.'), L('read', '(...)'), L('write', '(...)'), L('lines', '([filename, ...])'), L('close', '([file])'), L('input', '([file])'), L('output', '([file])'), L('popen', '(prog [, mode])'), L('tmpfile', '()'), L('type', '(obj)'), L('stdin'), L('stdout'), L('stderr')],
    coroutine: [L('create', '(f)'), L('resume', '(co [, val1, ...])'), L('yield', '(...)'), L('status', '(co)'), L('wrap', '(f)'), L('isyieldable', '()'), L('running', '()'), L('close', '(co)')],
    utf8: [L('char', '(...)'), L('codes', '(s)'), L('codepoint', '(s [, i [, j]])'), L('len', '(s [, i [, j]])'), L('offset', '(s, n [, i])'), L('charpattern')],
    debug: [L('traceback', '([thread,] [message [, level]])'), L('getinfo', '([thread,] f [, what])'), L('getlocal', '([thread,] f, local)'), L('sethook', '([thread,] hook, mask [, count])'), L('gethook', '([thread])')],
  };
  function luaParse(text) {
    const funcs = []; const tables = {}; const locals = {};
    const add = (t, e) => { (tables[t] = tables[t] || new Map()).set(e.n, e); };
    text.split(/\r?\n/).forEach((line, i) => {
      line = line.replace(/--.*$/, '');
      let m;
      if ((m = line.match(/^\s*(local\s+)?function\s+([\w.]+)([.:])(\w+)\s*\(([^)]*)\)/))) add(m[2], { n: m[4], k: m[3] === ':' ? 'method' : 'function', s: '(' + m[5] + ')', colon: m[3] === ':', line: i + 1 });
      else if ((m = line.match(/^\s*(local\s+)?function\s+(\w+)\s*\(([^)]*)\)/))) funcs.push({ n: m[2], k: 'function', s: '(' + m[3] + ')', line: i + 1 });
      else if ((m = line.match(/^\s*([\w.]+)\.(\w+)\s*=\s*function\s*\(([^)]*)\)/))) add(m[1], { n: m[2], k: 'function', s: '(' + m[3] + ')', line: i + 1 });
      else if ((m = line.match(/^\s*([\w.]+)\.(\w+)\s*=\s*(.+)$/))) add(m[1], { n: m[2], k: 'field', d: m[3].trim().slice(0, 80), line: i + 1 });
      if ((m = line.match(/^\s*local\s+([\w\s,]+?)\s*=\s*(.+)$/))) m[1].split(',').forEach(n => { n = n.trim(); if (n) locals[n] = { expr: m[2].trim(), line: i + 1 }; });
      else if ((m = line.match(/^\s*local\s+([\w\s,]+)$/))) m[1].split(',').forEach(n => { n = n.trim(); if (n) locals[n] = { expr: null, line: i + 1 }; });
      else if ((m = line.match(/^\s*(\w+)\s*=\s*(\{.*|.+)$/)) && !/==/.test(line)) locals[m[1]] = locals[m[1]] || { expr: m[2].trim(), line: i + 1, global: true };
      for (const fm of line.matchAll(/function\s*\(([^)]*)\)/g)) fm[1].split(',').forEach(n => { n = n.trim(); if (n && n !== '...') locals[n] = locals[n] || { expr: null, line: i + 1, param: true }; });
      // pola w konstruktorze tabeli w jednej linii: T = { a = 1, b = function() }
      if ((m = line.match(/^\s*(?:local\s+)?(\w+)\s*=\s*\{(.*)\}\s*$/))) for (const f of m[2].matchAll(/(\w+)\s*=\s*(function\s*\(([^)]*)\))?/g)) add(m[1], f[2] ? { n: f[1], k: 'function', s: '(' + f[3] + ')' } : { n: f[1], k: 'field' });
    });
    return { funcs, tables, locals };
  }
  function luaComplete(model, pos) {
    if (!enabled()) return { suggestions: [] };
    const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    if (/--/.test(before.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) return { suggestions: [] };
    const range = rangeAt(model, pos);
    const ctx = luaParse(model.getValue());
    let m;
    if ((m = before.match(/(["'])(?:\\.|(?!\1).)*\1\s*:(\w*)$/)) || ((m = before.match(/([\w.]+)\s*:(\w*)$/)) && ctx.locals[m[1]] && /^["']/.test(ctx.locals[m[1]].expr || ''))) {
      return { suggestions: LUA_LIB.string.map(e => item({ ...e, s: e.s && e.s.replace(/^\(s,?\s*/, '(') }, range, 'lua', { member: true })) };
    }
    if ((m = before.match(/([A-Za-z_][\w.]*)\s*([.:])(\w*)$/))) {
      const obj = m[1]; const colon = m[2] === ':';
      const out = [];
      if (LUA_LIB[obj] && !colon) out.push(...LUA_LIB[obj].map(e => item(e, range, 'lua', { member: true })));
      if (obj === 'string' && colon) return { suggestions: [] };
      const own = ctx.tables[obj];
      if (own) for (const e of own.values()) if (!colon || e.k !== 'field') out.push(item(e, range, 'lua', { member: true, local: true }));
      return { suggestions: out };
    }
    const out = []; const seen = new Set();
    const push = (e, o) => { if (seen.has(e.n)) return; seen.add(e.n); out.push(item(e, range, 'lua', o)); };
    for (const f of ctx.funcs) push(f, { local: true });
    for (const [n, v] of Object.entries(ctx.locals)) if (v.line !== pos.lineNumber) push({ n, k: ctx.tables[n] ? 'module' : 'variable', d: v.expr ? n + ' = ' + v.expr.slice(0, 80) : undefined }, { local: true });
    for (const n of Object.keys(ctx.tables)) if (!n.includes('.')) push({ n, k: 'module' }, { local: true });
    for (const k of LUA_KW) push({ n: k, k: 'keyword' });
    for (const e of LUA_G) push(e);
    for (const n of Object.keys(LUA_LIB)) push({ n, k: 'module', d: 'biblioteka standardowa Lua' });
    return { suggestions: out };
  }
  function luaFind(model, lineNo, chainText) {
    const ctx = luaParse(model.getValue());
    const mm = chainText.match(/^(?:([\w.]+)[.:])?(\w+)$/); if (!mm) return null;
    const [, obj, name] = mm;
    if (obj) return (LUA_LIB[obj] || []).find(e => e.n === name) || (ctx.tables[obj] && ctx.tables[obj].get(name)) || null;
    return ctx.funcs.find(f => f.n === name) || LUA_G.find(e => e.n === name) || null;
  }
  function luaSignature(model, pos) {
    if (!enabled()) return null;
    const text = model.getValueInRange({ startLineNumber: Math.max(1, pos.lineNumber - 6), startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
    let depth = 0; let i = text.length - 1; let commas = 0;
    for (; i >= 0; i--) { const ch = text[i]; if (ch === ')') depth++; else if (ch === '(') { if (!depth) break; depth--; } else if (ch === ',' && !depth) commas++; }
    if (i < 0) return null;
    const m = text.slice(0, i).match(/([A-Za-z_][\w.]*(?:[.:]\w+)?)\s*$/); if (!m) return null;
    const e = luaFind(model, pos.lineNumber, m[1]); if (!e || !e.s) return null;
    const params = splitParams(e.s.replace(/^\(|\)$/g, ''));
    return { value: { signatures: [{ label: e.n + e.s, documentation: e.d, parameters: params.map(p => ({ label: p })) }], activeSignature: 0, activeParameter: Math.min(commas, Math.max(0, params.length - 1)) }, dispose() {} };
  }
  function luaHover(model, pos) {
    if (!enabled()) return null;
    const w = model.getWordAtPosition(pos); if (!w || LUA_KW.includes(w.word)) return null;
    const left = model.getLineContent(pos.lineNumber).slice(0, w.endColumn - 1); const m = left.match(/([A-Za-z_][\w.]*(?:[.:]\w+)?)$/); if (!m) return null;
    const e = luaFind(model, pos.lineNumber, m[1]); if (!e) return null;
    return { range: new M.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), contents: [{ value: '```lua\n' + (e.s ? 'function ' + m[1].replace(/\w+$/, '') + e.n + e.s : e.n) + '\n```' }, ...(e.d ? [{ value: e.d }] : [])] };
  }

  function register(monaco) {
    M = monaco;
    monaco.languages.registerCompletionItemProvider('python', { triggerCharacters: ['.', ' '], provideCompletionItems: (model, pos, c) => {
      // spacja wyzwala tylko po „import” / „from x import”
      if (c.triggerCharacter === ' ' && !/^\s*(import|from\s+[\w.]+\s+import|from)\s+$/.test(model.getLineContent(pos.lineNumber).slice(0, pos.column - 1))) return { suggestions: [] };
      return pyComplete(model, pos);
    } });
    monaco.languages.registerSignatureHelpProvider('python', { signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [','], provideSignatureHelp: (model, pos) => pySignature(model, pos) });
    monaco.languages.registerHoverProvider('python', { provideHover: (model, pos) => pyHover(model, pos) });
    monaco.languages.registerCompletionItemProvider('lua', { triggerCharacters: ['.', ':'], provideCompletionItems: (model, pos) => luaComplete(model, pos) });
    monaco.languages.registerSignatureHelpProvider('lua', { signatureHelpTriggerCharacters: ['(', ','], provideSignatureHelp: (model, pos) => luaSignature(model, pos) });
    monaco.languages.registerHoverProvider('lua', { provideHover: (model, pos) => luaHover(model, pos) });
  }
  function reset() { memo.clear(); pyStatus = null; pyModules = null; }

  return { register, reset, pyParse, resolveChain, exprType, luaParse, _pyComplete: pyComplete, _luaComplete: luaComplete, _setMonaco: m => { M = m; } };
})();
