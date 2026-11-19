// Edytor w stylu VS Code (Monaco)
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  const P = () => window.cm.path;
  const X = () => App.edExt || {};
  const S = {
    root: null, monaco: null, editor: null, el: null, tabs: [], active: null, side: 'explorer', expanded: new Set(), sel: null, loading: null, sideOpen: true,
  };

  function loadMonaco() {
    if (S.loading) return S.loading;
    S.loading = new Promise((res, rej) => {
      const base = window.cm.monacoBase;
      window.MonacoEnvironment = {
        getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${base}/'};importScripts('${base}/vs/base/worker/workerMain.js');`)}`,
      };
      const sc = document.createElement('script');
      sc.src = base + '/vs/loader.js';
      sc.onload = () => {
        window.require.config({ paths: { vs: base + '/vs' } });
        window.require(['vs/editor/editor.main'], () => {
          S.monaco = window.monaco; EditorLangs.register(window.monaco); Themes.applyMonaco(window.monaco);
          // baza podpowiedzi Pythona wczytywana dopiero z edytorem
          const db = document.createElement('script'); db.src = 'js/editor-pydb.js'; document.head.appendChild(db);
          EditorComplete.register(window.monaco);
          res(window.monaco);
        }, rej);
      };
      sc.onerror = () => rej(new Error('Nie udało się wczytać edytora Monaco'));
      document.head.appendChild(sc);
    });
    return S.loading;
  }

  // ---------- budowa widoku (raz) ----------
  function build() {
    const el = h(`<div class="editor">
      <div class="ed-act">
        <button data-side="explorer" title="Eksplorator (Ctrl+Shift+E)">${icon('file')}</button>
        <button data-side="search" title="Szukaj w plikach (Ctrl+Shift+F)">${icon('search')}</button>
        <button data-side="places" title="Foldery gier i serwerów">${icon('layers')}</button>
        <button data-side="templates" title="Szablony plików">${icon('template')}</button>
        <button data-side="git" title="Git – zmiany i commity">${icon('branch')}</button>
        <button data-side="debug" title="Debugowanie (F5)">${icon('bug')}</button>
        <button data-side="ai" title="Asystent AI (Ctrl+I)">${icon('sparkle')}</button>
      </div>
      <div class="ed-side"></div>
      <div class="ed-main">
        <div class="ed-tabs"></div>
        <div class="ed-crumbs"></div>
        <div class="ed-host"><div class="ed-welcome"><div><h2>Edytor CodeManager</h2><p>Otwórz folder gry lub serwera, aby edytować pliki konfiguracyjne i skrypty.</p>
          <button class="btn primary" data-openfolder>${icon('folderOpen')}Otwórz folder</button>
          <div class="keys"><span class="kbd">Ctrl+S</span><span>Zapisz</span><span class="kbd">Ctrl+P</span><span>Szybkie otwieranie pliku</span><span class="kbd">Ctrl+Shift+F</span><span>Szukaj w plikach</span><span class="kbd">Ctrl+F / Ctrl+H</span><span>Znajdź / zamień</span><span class="kbd">Ctrl+Spacja</span><span>Podpowiedzi i snippety</span><span class="kbd">Alt+Shift+F</span><span>Formatuj (JSON)</span></div></div></div></div>
        <div class="ed-status"><span data-st-file>Brak pliku</span><span class="grow"></span><button data-st-diff title="Porównaj z wersją zapisaną na dysku">Porównaj</button><button data-st-tree title="Podgląd struktury pliku (JSON, TOML, YAML, INI)">Struktura</button><span data-st-prob></span><span data-st-pos></span><button data-st-git class="hidden" title="Gałąź Git – kliknij, aby otworzyć panel Git"></button><button data-st-lsp class="hidden" title="Serwer języka"></button><button data-st-luaapi class="hidden" title="Podpowiedzi Lua dla gry – kliknij, aby zmienić"></button><button data-st-lang title="Zmień język"></button><span data-st-enc></span><span data-st-eol></span></div>
      </div></div>`);
    S.el = el;
    $$('[data-side]', el).forEach(b => b.onclick = () => { if (S.side === b.dataset.side && S.sideOpen) { S.sideOpen = false; } else { S.side = b.dataset.side; S.sideOpen = true; } renderSide(); });
    $('[data-openfolder]', el).onclick = openFolderDialog;
    $('[data-st-lang]', el).onclick = pickLanguage;
    $('[data-st-luaapi]', el).onclick = pickLuaApi;
    $('[data-st-tree]', el).onclick = structurePreview;
    $('[data-st-diff]', el).onclick = () => { const t = S.tabs.find(x => x.path === S.active); if (t && !t.untitled) diffWithDisk(t); };
    return el;
  }

  async function openFolderDialog() { const p = await api('dialog:folder', 'Otwórz folder w edytorze', S.root || undefined); if (p) { S.root = p; S.expanded = new Set([p]); S.side = 'explorer'; S.sideOpen = true; renderSide(); } }

  // ---------- panel boczny ----------
  function renderSide() {
    const el = S.el;
    el.classList.toggle('noside', !S.sideOpen);
    $$('[data-side]', el).forEach(b => b.classList.toggle('active', S.sideOpen && b.dataset.side === S.side));
    const side = $('.ed-side', el); side.innerHTML = '';
    if (!S.sideOpen) { if (S.editor) S.editor.layout(); return; }
    if (S.side === 'explorer') sideExplorer(side);
    if (S.side === 'search') sideSearch(side);
    if (S.side === 'places') sidePlaces(side);
    if (S.side === 'templates') sideTemplates(side);
    if (X().sides && X().sides[S.side]) X().sides[S.side](side);
    setTimeout(() => S.editor && S.editor.layout(), 0);
  }

  function fileIconColor(name) {
    const e = name.split('.').pop().toLowerCase();
    return { lua: '#6cb6d9', json: '#e7c27a', cs: '#7ee2a8', sp: '#f0a17a', inc: '#f0a17a', cfg: '#9fd3c7', ini: '#9fd3c7', toml: '#c79bd9', yml: '#e78f8f', yaml: '#e78f8f', xml: '#f0a17a', txt: '#8fae9b', jar: '#ee6c5e', dll: '#8fae9b', log: '#5f8a72', c: '#79c6e8', mod: '#c7b37a' }[e] || '#6a8a77';
  }

  function sideExplorer(side) {
    side.innerHTML = `<div class="side-head"><span title="${esc(S.root || '')}">${S.root ? esc(P().basename(S.root)) : 'Eksplorator'}</span>
      <button class="btn ghost sm icon" data-a="newfile" title="Nowy plik">${icon('newfile')}</button><button class="btn ghost sm icon" data-a="newdir" title="Nowy folder">${icon('folder')}</button>
      <button class="btn ghost sm icon" data-a="refresh" title="Odśwież">${icon('refresh')}</button><button class="btn ghost sm icon" data-a="open" title="Otwórz folder">${icon('folderOpen')}</button></div><div class="side-body"><div class="tree"></div></div>`;
    $('.side-head', side).onclick = e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'open') openFolderDialog();
      if (a.dataset.a === 'refresh') renderSide();
      if (a.dataset.a === 'newfile') newEntry(targetDir(), false);
      if (a.dataset.a === 'newdir') newEntry(targetDir(), true);
    };
    const tree = $('.tree', side);
    if (!S.root) { tree.innerHTML = `<div style="padding:14px" class="muted">Nie otwarto folderu.<br><br><button class="btn sm primary" data-o>${icon('folderOpen')}Otwórz folder</button></div>`; $('[data-o]', tree).onclick = openFolderDialog; return; }
    renderTree(tree, S.root, 0);
  }
  function targetDir() { if (!S.sel) return S.root; return S.sel.dir ? S.sel.path : P().dirname(S.sel.path); }

  async function renderTree(container, dir, depth) {
    let items = [];
    try { items = await App.apiQuiet('fs:readDir', dir); } catch (e) { container.appendChild(h(`<div class="dim" style="padding-left:${depth * 12 + 22}px;font-size:12px">${esc(e.message)}</div>`)); return; }
    for (const it of items) {
      const open = S.expanded.has(it.path);
      const node = h(`<div class="node ${open ? 'open' : ''} ${S.active === it.path ? 'sel' : ''}" style="padding-left:${depth * 12 + 6}px" title="${esc(it.path)}">
        <span class="tw">${it.dir ? icon('chevron') : ''}</span>
        <span class="fi">${it.dir ? `<svg viewBox="0 0 24 24" stroke="none" style="opacity:${open ? 1 : .85}"><path class="folder"  d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5Z"/></svg>` : `<svg viewBox="0 0 24 24" fill="none" stroke="${fileIconColor(it.name)}" stroke-width="1.8"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/></svg>`}</span>
        <span class="lbl">${esc(it.name)}</span></div>`);
      container.appendChild(node);
      const kids = h('<div></div>');
      container.appendChild(kids);
      if (it.dir && open) renderTree(kids, it.path, depth + 1);
      node.onclick = () => {
        S.sel = it; $$('.tree .node', S.el).forEach(n => n.classList.remove('sel')); node.classList.add('sel');
        if (it.dir) { if (S.expanded.has(it.path)) { S.expanded.delete(it.path); node.classList.remove('open'); kids.innerHTML = ''; } else { S.expanded.add(it.path); node.classList.add('open'); renderTree(kids, it.path, depth + 1); } }
        else openFile(it.path);
      };
      node.oncontextmenu = e => { e.preventDefault(); S.sel = it; ctxMenu(e.clientX, e.clientY, it); };
    }
  }

  function ctxMenu(x, y, it) {
    $$('.ctx-menu').forEach(m => m.remove());
    const dir = it.dir ? it.path : P().dirname(it.path);
    const m = h(`<div class="ctx-menu" style="left:${x}px;top:${y}px">
      <button data-a="newfile">Nowy plik</button><button data-a="newdir">Nowy folder</button><hr>
      ${it.dir ? '' : `<button data-a="cmpbase">Wybierz do porównania</button>${S.compareBase && S.compareBase !== it.path ? `<button data-a="cmpwith">Porównaj z „${esc(P().basename(S.compareBase))}”</button>` : ''}<button data-a="cmppick">Porównaj z plikiem…</button><hr>`}
      <button data-a="rename">Zmień nazwę</button><button data-a="copy">Kopiuj ścieżkę</button><button data-a="show">Pokaż w eksploratorze</button>${it.dir ? '<button data-a="root">Otwórz jako folder główny</button>' : ''}<hr>
      <button data-a="del" style="color:var(--coral)">Przenieś do kosza</button></div>`);
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(); if (r.bottom > innerHeight) m.style.top = (innerHeight - r.height - 8) + 'px';
    const close = () => { m.remove(); document.removeEventListener('mousedown', out); };
    const out = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out), 0);
    m.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return; close();
      const act = a.dataset.a;
      if (act === 'newfile') newEntry(dir, false);
      if (act === 'newdir') newEntry(dir, true);
      if (act === 'copy') { navigator.clipboard.writeText(it.path); toast('Skopiowano ścieżkę'); }
      if (act === 'cmpbase') { S.compareBase = it.path; toast(`Wybrano ${it.name} – kliknij prawym inny plik i wybierz „Porównaj”`); }
      if (act === 'cmpwith') diffFiles(S.compareBase, it.path);
      if (act === 'cmppick') { const f = (await api('dialog:files', 'Wybierz plik do porównania'))[0]; if (f) diffFiles(it.path, f); }
      if (act === 'show') api('shell:show', it.path);
      if (act === 'root') { S.root = it.path; S.expanded = new Set(); renderSide(); }
      if (act === 'rename') {
        const nn = await App.promptBox('Zmień nazwę', 'Nowa nazwa', it.name); if (!nn || nn === it.name) return;
        const np = P().join(P().dirname(it.path), nn); await api('fs:rename', it.path, np);
        const t = S.tabs.find(x => x.path === it.path); if (t) { t.path = np; t.name = nn; renderTabs(); }
        renderSide();
      }
      if (act === 'del') { if (await App.confirmBox('Przenieść do kosza?', `<span class="path">${esc(it.path)}</span>`, 'Przenieś', true)) { await api('fs:trash', it.path); const t = S.tabs.find(x => x.path === it.path); if (t) closeTab(t, true); renderSide(); } }
    };
  }

  async function newEntry(dir, isDir, content, name) {
    if (!dir) { toast('Najpierw otwórz folder', 'warn'); return; }
    const n = name || await App.promptBox(isDir ? 'Nowy folder' : 'Nowy plik', 'Nazwa', ''); if (!n) return;
    const p = P().join(dir, n);
    if (await App.apiQuiet('fs:exists', p)) { toast('Taki plik już istnieje', 'warn'); if (!isDir) openFile(p); return; }
    if (isDir) await api('fs:mkdir', p); else await api('fs:writeFile', p, content || '', false);
    S.expanded.add(dir); renderSide();
    if (!isDir) openFile(p);
  }

  function sideSearch(side) {
    side.innerHTML = `<div class="side-head"><span>Szukaj w plikach</span></div><div style="padding:0 10px 8px"><input class="input" placeholder="Szukana fraza…" data-q><div class="row" style="margin-top:6px"><label class="check" style="font-size:12.5px"><input type="checkbox" data-names>Tylko nazwy plików</label></div></div><div class="side-body search-res"></div>`;
    const q = $('[data-q]', side); const res = $('.search-res', side);
    if (!S.root) { res.innerHTML = '<p class="muted" style="padding:10px 14px">Najpierw otwórz folder.</p>'; return; }
    let timer;
    const run = async () => {
      const v = q.value.trim(); if (v.length < 2) { res.innerHTML = ''; return; }
      res.innerHTML = '<div style="padding:10px 14px" class="muted">Szukam…</div>';
      const names = $('[data-names]', side).checked;
      const hits = await App.apiQuiet(names ? 'fs:search' : 'fs:grep', S.root, v).catch(() => []);
      res.innerHTML = hits.length ? '' : '<div style="padding:10px 14px" class="muted">Brak wyników.</div>';
      for (const hit of hits) {
        const d = h(`<div class="hit"><div class="f">${esc(hit.rel)}${hit.line ? `<span class="dim">:${hit.line}</span>` : ''}</div>${hit.text ? `<div class="t">${esc(hit.text)}</div>` : ''}</div>`);
        d.onclick = () => openFile(hit.path, hit.line);
        res.appendChild(d);
      }
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
    $('[data-names]', side).onchange = run;
    q.focus();
  }

  function sidePlaces(side) {
    side.innerHTML = `<div class="side-head"><span>Foldery gier i serwerów</span></div><div class="side-body quick-folders"></div>`;
    const body = $('.side-body', side);
    const det = App.state.detected;
    const add = (label, path, badge) => { const b = h(`<button title="${esc(path)}">${badge}<span>${esc(label)}</span></button>`); b.onclick = () => { S.root = path; S.expanded = new Set(); S.side = 'explorer'; renderSide(); }; body.appendChild(b); };
    body.appendChild(h('<div class="dim" style="padding:4px 14px;font-size:12px">Gry</div>'));
    if (det) for (const g of App.state.defs.games) {
      const i = det.games[g.id]; if (!i || !i.found) continue;
      if (g.id === 'minecraft') i.instances.forEach(inst => add(inst.name, inst.path, App.gameBadge(g)));
      else add(g.name, i.path, App.gameBadge(g));
    }
    body.appendChild(h('<div class="dim" style="padding:10px 14px 4px;font-size:12px">Serwery</div>'));
    for (const s of App.state.servers) add(s.name, s.path, App.gameBadge({ color: s.color, short: (s.typeName || '?').slice(0, 2), name: s.name }));
    if (!App.state.servers.length) body.appendChild(h('<div class="dim" style="padding:2px 14px;font-size:12.5px">Brak serwerów</div>'));
  }

  function sideTemplates(side) {
    side.innerHTML = `<div class="side-head"><span>Szablony plików</span></div><div class="side-body quick-folders"></div>`;
    const body = $('.side-body', side);
    body.appendChild(h('<p class="dim" style="padding:0 14px;font-size:12px;margin:0 0 8px">Tworzy nowy plik ze szkieletem w zaznaczonym folderze. W każdym pliku możesz też użyć Ctrl+Spacja, aby wstawić snippet.</p>'));
    for (const t of EditorLangs.TEMPLATES) {
      const b = h(`<button>${icon('template')}<span><span style="display:block">${esc(t.game)}</span><span class="dim mono" style="font-size:11px">${esc(t.name)}</span></span></button>`);
      b.onclick = async () => {
        const raw = (EditorLangs.SNIPS[t.lang] || {})[t.snippet] || '';
        const text = raw.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{?\d+\}?/g, '');
        if (!S.root) { await openUntitled(t.name, text); return; }
        const n = await App.promptBox('Nowy plik z szablonu', 'Nazwa pliku', t.name); if (!n) return;
        newEntry(targetDir(), false, text, n);
      };
      body.appendChild(b);
    }
  }

  // ---------- profil podpowiedzi Lua (FiveM, BeamMP, Garry's Mod…) ----------
  async function updateLuaApi(t) {
    const b = $('[data-st-luaapi]', S.el);
    if (!t || t.model.getLanguageId() !== 'lua' || !window.EditorComplete) { b.classList.add('hidden'); return; }
    const pr = await EditorComplete.profileFor(t.model);
    const meta = EditorComplete.LUA_PROFILES.find(x => x.id === pr.id);
    b.textContent = 'API Lua: ' + (meta ? meta.name.replace(/\s*\(.*\)$/, '') : 'czysta Lua');
    b.title = `Podpowiedzi Lua: ${meta ? meta.name : 'tylko biblioteka standardowa'} (${pr.how}). Kliknij, aby zmienić.`;
    b.classList.remove('hidden');
    if (meta) EditorComplete.loadProfile(pr.id).then(db => { if (!db && meta.local) b.title += ' – nie znaleziono plików gry.'; });
  }
  async function pickLuaApi() {
    const t = S.tabs.find(x => x.path === S.active); if (!t) return;
    const cur = await EditorComplete.profileFor(t.model);
    const dir = t.untitled ? null : P().dirname(t.path);
    const ovr = t.untitled ? null : EditorComplete.overrideFor(t.path);
    const opts = [{ id: '', name: 'Automatycznie (wykrywanie po plikach i treści)' }, { id: 'lua', name: 'Czysta Lua (bez API gry)' }, ...EditorComplete.LUA_PROFILES];
    const body = h(`<div><p class="muted" style="margin-top:0">Wybierz grę, dla której edytor ma podpowiadać funkcje. Teraz: <b>${esc((EditorComplete.LUA_PROFILES.find(x => x.id === cur.id) || { name: 'czysta Lua' }).name)}</b> (${esc(cur.how)}).</p>
      <div class="luaapi-list">${opts.map(o => `<label class="check"><input type="radio" name="luaapi" value="${o.id}" ${(ovr || '') === o.id ? 'checked' : ''}><span>${esc(o.name)}</span></label>`).join('')}</div>
      ${dir ? `<p class="dim" style="font-size:12.5px;margin-bottom:0">Wybór zostanie zapamiętany dla folderu <span class="mono">${esc(dir)}</span> i jego podfolderów. Domyślne zachowanie zmienisz w Ustawieniach → Edytor.</p>` : ''}</div>`);
    modal({ title: 'Podpowiedzi Lua dla gry', body, actions: [{ label: 'Anuluj' }, { label: 'Zastosuj', primary: true, onClick: () => {
      const v = ($('input[name=luaapi]:checked', body) || {}).value || '';
      if (dir) EditorComplete.setOverride(dir, v || null);
      updateLuaApi(t); toast(v ? 'Podpowiedzi: ' + opts.find(o => o.id === v).name : 'Podpowiedzi: wykrywanie automatyczne');
    } }] });
  }

  // ---------- zakładki i pliki ----------
  async function ensureEditor() {
    if (S.editor) return S.editor;
    const monaco = await loadMonaco();
    const host = $('.ed-host', S.el);
    const box = h('<div style="position:absolute;inset:0"></div>'); host.appendChild(box);
    const st = App.state.settings;
    S.editor = monaco.editor.create(box, {
      theme: 'codemanager', automaticLayout: true, fontFamily: "'JBMono', 'Cascadia Code', Consolas, monospace", fontSize: st.editorFontSize || 14, fontLigatures: true,
      minimap: { enabled: st.editorMinimap !== false }, wordWrap: st.editorWrap ? 'on' : 'off', smoothScrolling: true, cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
      quickSuggestions: st.editorSuggest === false ? false : { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: st.editorSuggest !== false,
      wordBasedSuggestions: 'matchingDocuments', suggest: { preview: true, showWords: true, showStatusBar: true, insertMode: 'replace' }, parameterHints: { enabled: st.editorSuggest !== false },
      renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, guides: { bracketPairs: true }, stickyScroll: { enabled: true }, padding: { top: 8 }, scrollBeyondLastLine: false,
    });
    App.applyEditorSettings = () => { const x = App.state.settings; const on = x.editorSuggest !== false; S.editor.updateOptions({ fontSize: x.editorFontSize || 14, minimap: { enabled: x.editorMinimap !== false }, wordWrap: x.editorWrap ? 'on' : 'off', quickSuggestions: on ? { other: true, comments: false, strings: false } : false, suggestOnTriggerCharacters: on, parameterHints: { enabled: on } }); };
    S.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save());
    S.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => { const t = S.tabs.find(x => x.path === S.active); if (t) closeTab(t); });
    S.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, quickOpen);
    S.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => { S.side = 'search'; S.sideOpen = true; renderSide(); });
    S.editor.onDidChangeCursorPosition(e => { $('[data-st-pos]', S.el).textContent = `Wiersz ${e.position.lineNumber}, kol. ${e.position.column}`; });
    monaco.editor.onDidChangeMarkers(() => updateProblems());
    if (X().editorReady) X().editorReady(monaco, S.editor);
    return S.editor;
  }
  function updateProblems() {
    const t = S.tabs.find(x => x.path === S.active); const el = $('[data-st-prob]', S.el);
    if (!t || !S.monaco) { el.textContent = ''; return; }
    const mk = S.monaco.editor.getModelMarkers({ resource: t.model.uri });
    const e = mk.filter(m => m.severity === 8).length, w = mk.filter(m => m.severity === 4).length;
    el.innerHTML = e || w ? `⊗ ${e}  ⚠ ${w}` : '';
  }

  async function openFile(path, line, opts = {}) {
    await ensureEditor();
    let t = S.tabs.find(x => x.path === path);
    if (!t) {
      let data;
      if (opts.create) data = { content: '', bom: false, eol: 'LF' };
      else { try { data = await App.apiQuiet('fs:readFile', path); } catch (e) { toast(e.message, 'error'); return; } }
      const lang = EditorLangs.languageFor(path);
      const uri = S.monaco.Uri.file(path);
      const model = S.monaco.editor.getModel(uri) || S.monaco.editor.createModel(data.content, lang, uri);
      model.setValue(data.content);
      t = { path, name: P().basename(path), model, bom: data.bom, eol: data.eol, saved: model.getAlternativeVersionId(), view: null, isNew: !!opts.create };
      model.onDidChangeContent(() => { renderTabs(); validate(t); if (X().changed) X().changed(t); if (App.state.settings.editorAutosave) { clearTimeout(t.auto); t.auto = setTimeout(() => save(t), 1000); } });
      validate(t, 0);
      S.tabs.push(t);
      if (X().opened) X().opened(t);
    }
    activate(t);
    if (line) { S.editor.revealLineInCenter(line); S.editor.setPosition({ lineNumber: line, column: 1 }); }
    S.editor.focus();
  }
  async function openUntitled(name, text) {
    await ensureEditor();
    const n = S.tabs.filter(t => t.untitled).length + 1;
    const path = `bez-nazwy-${n}/${name}`;
    const model = S.monaco.editor.createModel(text, EditorLangs.languageFor(name));
    const t = { path, name: name + ' (niezapisany)', model, untitled: true, saved: -1, eol: 'LF' };
    model.onDidChangeContent(() => renderTabs());
    S.tabs.push(t); activate(t);
  }

  function activate(t) {
    const cur = S.tabs.find(x => x.path === S.active);
    if (cur && cur !== t) cur.view = S.editor.saveViewState();
    S.active = t.path;
    S.editor.setModel(t.model);
    if (t.view) S.editor.restoreViewState(t.view);
    const w = $('.ed-welcome', S.el); if (w) w.classList.add('hidden');
    renderTabs(); updateStatus(); updateProblems();
  }
  function isDirty(t) { return t.model.getAlternativeVersionId() !== t.saved; }
  function renderTabs() {
    const bar = $('.ed-tabs', S.el); bar.innerHTML = '';
    for (const t of S.tabs) {
      const el = h(`<div class="ed-tab ${t.path === S.active ? 'active' : ''} ${isDirty(t) ? 'dirty' : ''}" title="${esc(t.path)}"><span style="width:8px;height:8px;border-radius:2px;background:${fileIconColor(t.name)}"></span>${esc(t.name)}<span class="x" title="Zamknij (Ctrl+W)">${icon('x')}</span></div>`);
      el.onclick = e => { if (e.target.closest('.x')) closeTab(t); else activate(t); };
      el.onauxclick = e => { if (e.button === 1) closeTab(t); };
      bar.appendChild(el);
    }
    const act = S.tabs.find(x => x.path === S.active);
    $('.ed-crumbs', S.el).textContent = act ? (S.root && act.path.startsWith(S.root) ? P().relative(S.root, act.path).split(/[\\/]/).join('  ›  ') : act.path) : '';
  }
  async function closeTab(t, force) {
    if (!force && isDirty(t)) {
      const choice = await new Promise(res => modal({ title: `Zapisać zmiany w ${t.name}?`, body: '<p class="muted" style="margin:0">Jeśli nie zapiszesz, zmiany zostaną utracone.</p>', onClose: () => res('cancel'),
        actions: [{ label: 'Anuluj', onClick: () => res('cancel') }, { label: 'Nie zapisuj', danger: true, onClick: () => res('discard') }, { label: 'Zapisz', primary: true, onClick: () => res('save') }] }));
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(t))) return;
    }
    const i = S.tabs.indexOf(t);
    S.tabs.splice(i, 1);
    if (X().closed) X().closed(t);
    t.model.dispose();
    if (S.active === t.path) {
      const next = S.tabs[i] || S.tabs[i - 1];
      if (next) activate(next); else { S.active = null; S.editor.setModel(null); const w = $('.ed-welcome', S.el); if (w) w.classList.remove('hidden'); renderTabs(); updateStatus(); }
    } else renderTabs();
  }
  async function save(tab) {
    const t = tab || S.tabs.find(x => x.path === S.active); if (!t) return false;
    if (t.untitled) {
      const p = await api('dialog:saveAs', P().join(S.root || '', t.name.replace(' (niezapisany)', ''))); if (!p) return false;
      t.path = p; t.name = P().basename(p); t.untitled = false; S.active = p;
    }
    // walidacja JSON przed zapisem – ostrzeżenie, nie blokada
    if (t.model.getLanguageId() === 'json') {
      const errs = S.monaco.editor.getModelMarkers({ resource: t.model.uri }).filter(m => m.severity === 8);
      if (errs.length) toast(`Uwaga: plik JSON ma ${errs.length} błąd(ów) składni (wiersz ${errs[0].startLineNumber}).`, 'warn', 6000);
    }
    let text = t.model.getValue();
    if (t.eol === 'CRLF') text = text.replace(/\r?\n/g, '\r\n');
    try { await App.apiQuiet('fs:writeFile', t.path, text, t.bom); } catch (e) { toast('Nie zapisano: ' + e.message, 'error'); return false; }
    t.saved = t.model.getAlternativeVersionId(); t.isNew = false;
    renderTabs(); updateStatus();
    if (X().saved) X().saved(t);
    return true;
  }
  // ---------- walidacja TOML / YAML (parsery z procesu głównego) ----------
  function validate(t, delay = 450) {
    const lang = t.model.getLanguageId(); if (!['toml', 'yaml'].includes(lang)) return;
    clearTimeout(t.vt);
    t.vt = setTimeout(async () => {
      if (t.model.isDisposed()) return;
      const errs = await App.apiQuiet('fs:validate', lang, t.model.getValue()).catch(() => []);
      if (t.model.isDisposed()) return;
      S.monaco.editor.setModelMarkers(t.model, 'cm-validate', errs.map(e => ({ severity: e.warn ? 4 : 8, message: e.msg, startLineNumber: e.line, startColumn: e.col, endLineNumber: e.line, endColumn: e.col + 1 })));
    }, delay);
  }

  // ---------- podgląd struktury ----------
  function treeHtml(v, depth = 0) {
    if (v === null || typeof v !== 'object') return `<span class="tv ${typeof v}">${esc(typeof v === 'string' ? `"${v}"` : String(v))}</span>`;
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    if (!entries.length) return `<span class="dim">${Array.isArray(v) ? '[ ]' : '{ }'}</span>`;
    return `<div class="tree-v">${entries.map(([k, x]) => x !== null && typeof x === 'object' ? `<details ${depth < 1 ? 'open' : ''}><summary><span class="tk">${esc(k)}</span> <span class="dim">${Array.isArray(x) ? `[${x.length}]` : `{${Object.keys(x).length}}`}</span></summary>${treeHtml(x, depth + 1)}</details>` : `<div><span class="tk">${esc(k)}</span>: ${treeHtml(x, depth + 1)}</div>`).join('')}</div>`;
  }
  async function structurePreview() {
    const t = S.tabs.find(x => x.path === S.active); if (!t) return;
    const lang = t.model.getLanguageId();
    try {
      const data = await App.apiQuiet('fs:parse', lang === 'srccfg' ? 'ini' : lang, t.model.getValue());
      const clean = data && data.__root && Object.keys(data).length === 1 ? data.__root : data;
      modal({ title: `Struktura: ${t.name}`, wide: true, body: `<div class="struct">${treeHtml(clean)}</div>` });
    } catch (e) { toast(e.message, 'warn', 6000); }
  }

  // ---------- porównywanie plików (diff) ----------
  async function showDiff(left, right, titleL, titleR, lang) {
    await ensureEditor();
    const host = $('.ed-host', S.el);
    $$('.ed-diff', host).forEach(x => { if (x._dispose) x._dispose(); x.remove(); });
    const box = h(`<div class="ed-diff"><div class="ed-diff-h"><span class="mono">${esc(titleL)}</span><span class="dim">↔</span><span class="mono">${esc(titleR)}</span><span class="grow"></span><span class="dim" data-cnt></span><button class="btn sm" data-x>${icon('x')}Zamknij porównanie</button></div><div class="ed-diff-b"></div></div>`);
    host.appendChild(box);
    const m1 = S.monaco.editor.createModel(left, lang), m2 = S.monaco.editor.createModel(right, lang);
    const de = S.monaco.editor.createDiffEditor($('.ed-diff-b', box), { theme: 'codemanager', automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: true, fontSize: App.state.settings.editorFontSize || 14, fontFamily: "'JBMono', 'Cascadia Code', Consolas, monospace" });
    de.setModel({ original: m1, modified: m2 });
    de.onDidUpdateDiff(() => { const ch = de.getLineChanges() || []; $('[data-cnt]', box).textContent = ch.length ? App.plural(ch.length, 'zmiana', 'zmiany', 'zmian') : 'Pliki są identyczne'; });
    box._dispose = () => { de.dispose(); m1.dispose(); m2.dispose(); };
    $('[data-x]', box).onclick = () => { box._dispose(); box.remove(); };
  }
  async function diffFiles(a, b) {
    try {
      const [x, y] = await Promise.all([App.apiQuiet('fs:readFile', a), App.apiQuiet('fs:readFile', b)]);
      showDiff(x.content, y.content, P().basename(a), P().basename(b), EditorLangs.languageFor(a));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function diffWithDisk(t) {
    try { const d = await App.apiQuiet('fs:readFile', t.path); showDiff(d.content, t.model.getValue(), `${t.name} (na dysku)`, `${t.name} (w edytorze)`, t.model.getLanguageId()); }
    catch (e) { toast(e.message, 'error'); }
  }
  App.editorDiff = diffFiles;

  function updateStatus() {
    const t = S.tabs.find(x => x.path === S.active);
    $('[data-st-file]', S.el).textContent = t ? (isDirty(t) ? '● ' : '') + t.name : 'Brak pliku';
    $('[data-st-lang]', S.el).textContent = t ? t.model.getLanguageId() : '';
    updateLuaApi(t);
    if (X().status) X().status(t);
    $('[data-st-enc]', S.el).textContent = t ? (t.bom ? 'UTF-8 z BOM' : 'UTF-8') : '';
    $('[data-st-eol]', S.el).textContent = t ? t.eol : '';
    if (!t) { $('[data-st-pos]', S.el).textContent = ''; }
  }
  function pickLanguage() {
    const t = S.tabs.find(x => x.path === S.active); if (!t) return;
    const langs = S.monaco.languages.getLanguages().map(l => l.id).sort();
    const m = modal({ title: 'Język pliku', body: `<select class="input" size="12">${langs.map(l => `<option ${l === t.model.getLanguageId() ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`,
      actions: [{ label: 'Anuluj' }, { label: 'Ustaw', primary: true, onClick: ({ body }) => { S.monaco.editor.setModelLanguage(t.model, $('select', body).value); updateStatus(); validate(t, 0); } }] });
    $('select', m.body).style.height = '280px';
  }
  async function quickOpen() {
    if (!S.root) { toast('Najpierw otwórz folder', 'warn'); return; }
    const body = h(`<div><input class="input" placeholder="Nazwa pliku…"><div class="search-res" style="max-height:360px;overflow:auto;margin-top:8px"></div></div>`);
    const m = modal({ title: 'Szybkie otwieranie', body });
    const inp = $('input', body); const res = $('.search-res', body);
    let timer; let first = null;
    inp.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
      const v = inp.value.trim(); if (!v) { res.innerHTML = ''; return; }
      const hits = await App.apiQuiet('fs:search', S.root, v).catch(() => []);
      res.innerHTML = ''; first = hits[0] || null;
      hits.slice(0, 60).forEach(hit => { const d = h(`<div class="hit"><div class="f">${esc(P().basename(hit.rel))}</div><div class="t">${esc(hit.rel)}</div></div>`); d.onclick = () => { m.close(); openFile(hit.path); }; res.appendChild(d); });
    }, 200); };
    inp.onkeydown = e => { if (e.key === 'Enter' && first) { m.close(); openFile(first.path); } };
  }

  document.addEventListener('keydown', e => {
    if (App.current() !== 'editor') return;
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); quickOpen(); }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); S.side = 'search'; S.sideOpen = true; renderSide(); }
    if (e.key === 'Escape') { const d = S.el && $('.ed-diff', S.el); if (d) { d._dispose(); d.remove(); } }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); S.side = 'explorer'; S.sideOpen = true; renderSide(); }
  });
  window.addEventListener('beforeunload', e => { if (S.tabs.some(isDirty)) { e.returnValue = false; } });

  App.ed = { S, openFile, openUntitled, renderSide, renderTabs, activate, ensureEditor, showDiff, save };
  App.views.editor = {
    full: true,
    crumb: () => '<b>Edytor</b>',
    async render(el, params) {
      if (!S.el) build();
      el.appendChild(S.el);
      if (params.folder && params.folder !== S.root) { S.root = params.folder; S.expanded = new Set(); S.side = 'explorer'; S.sideOpen = true; }
      renderSide(); renderTabs(); updateStatus();
      if (S.editor) setTimeout(() => S.editor.layout(), 0);
      try { await loadMonaco(); } catch (e) { toast(e.message, 'error'); return; }
      if (params.file) openFile(params.file, null, { create: params.create });
      else if (S.tabs.length) { await ensureEditor(); }
    },
    leave() { if (S.el && S.el.parentNode) S.el.parentNode.removeChild(S.el); },
  };
})();
