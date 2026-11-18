// Edytor: serwery języka (LSP – Lua, Python, C#, Java) i panel Git
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  const P = () => window.cm.path;
  const LSP_LANG = { lua: 'lua', python: 'python', csharp: 'csharp', java: 'java' };
  const LSP_SHORT = { lua: 'LuaLS', python: 'Pyright', csharp: 'csharp-ls', java: 'JDT LS' };
  let monaco = null; let lspStatus = null; let gitCache = null;
  const ed = () => App.ed;
  const tabByModel = m => ed().S.tabs.find(t => t.model === m);
  const lspOn = () => App.state.settings.lspEnabled !== false;

  async function loadStatus(force) { if (!lspStatus || force) lspStatus = await App.apiQuiet('lsp:status').catch(() => ({})); return lspStatus; }
  App.lspStatus = loadStatus;

  function rootFor(t) { const S = ed().S; return S.root && t.path.startsWith(S.root) ? S.root : P().dirname(t.path); }
  async function lspInfo(t) {
    const lang = LSP_LANG[t.model.getLanguageId()];
    if (!lang || t.untitled) return null;
    let profile = '';
    if (lang === 'lua' && window.EditorComplete) { try { profile = (await EditorComplete.profileFor(t.model)).id || ''; } catch { /* */ } }
    return { lang, root: rootFor(t), profile };
  }

  // ---------- pozycje i zakresy LSP <-> Monaco ----------
  const toPos = p => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const toRange = r => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
  const docId = t => ({ uri: t.lspUri });
  async function ensureModel(uri) {
    const u = monaco.Uri.parse(uri);
    let m = monaco.editor.getModel(u); if (m) return m;
    try { const d = await App.apiQuiet('fs:readFile', u.fsPath); m = monaco.editor.getModel(u) || monaco.editor.createModel(d.content, EditorLangs.languageFor(u.fsPath), u); } catch { /* plik niedostępny */ }
    return m;
  }
  const toLocation = async l => { const uri = l.targetUri || l.uri; const range = l.targetSelectionRange || l.range; await ensureModel(uri); return { uri: monaco.Uri.parse(uri), range: toRange(range) }; };
  const KIND = { 1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', 5: 'Field', 6: 'Variable', 7: 'Class', 8: 'Interface', 9: 'Module', 10: 'Property', 11: 'Unit', 12: 'Value', 13: 'Enum', 14: 'Keyword', 15: 'Snippet', 16: 'Color', 17: 'File', 18: 'Reference', 19: 'Folder', 20: 'EnumMember', 21: 'Constant', 22: 'Struct', 23: 'Event', 24: 'Operator', 25: 'TypeParameter' };
  const mdOf = c => { if (!c) return ''; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.map(mdOf).join('\n\n'); if (c.kind) return c.value; if (c.language) return '```' + c.language + '\n' + c.value + '\n```'; return c.value || ''; };

  async function req(t, method, params) {
    if (!t || !t.lsp || !t.lspUri) return null;
    try { return await window.cm.call('lsp:request', t.lsp.lang, t.lsp.root, t.lsp.profile, method, params); } catch { return null; }
  }

  function registerProviders() {
    const langs = Object.keys(LSP_LANG);
    for (const lang of langs) {
      monaco.languages.registerHoverProvider(lang, { provideHover: async (model, pos) => { const t = tabByModel(model); const r = await req(t, 'textDocument/hover', { textDocument: docId(t), position: toPos(pos) }); if (!r || !r.contents) return null; const v = mdOf(r.contents); return v ? { contents: [{ value: v }], range: r.range ? toRange(r.range) : undefined } : null; } });
      monaco.languages.registerDefinitionProvider(lang, { provideDefinition: async (model, pos) => { const t = tabByModel(model); const r = await req(t, 'textDocument/definition', { textDocument: docId(t), position: toPos(pos) }); if (!r) return null; return Promise.all((Array.isArray(r) ? r : [r]).map(toLocation)); } });
      monaco.languages.registerReferenceProvider(lang, { provideReferences: async (model, pos) => { const t = tabByModel(model); const r = await req(t, 'textDocument/references', { textDocument: docId(t), position: toPos(pos), context: { includeDeclaration: true } }); return r ? Promise.all(r.map(toLocation)) : null; } });
      monaco.languages.registerDocumentFormattingEditProvider(lang, { provideDocumentFormattingEdits: async (model, opts) => { const t = tabByModel(model); const r = await req(t, 'textDocument/formatting', { textDocument: docId(t), options: { tabSize: opts.tabSize, insertSpaces: opts.insertSpaces } }); return (r || []).map(e => ({ range: toRange(e.range), text: e.newText })); } });
      monaco.languages.registerRenameProvider(lang, {
        provideRenameEdits: async (model, pos, newName) => {
          const t = tabByModel(model); const r = await req(t, 'textDocument/rename', { textDocument: docId(t), position: toPos(pos), newName });
          if (!r) return { edits: [], rejectReason: 'Serwer języka nie może zmienić tej nazwy.' };
          const changes = { ...(r.changes || {}) }; for (const dc of r.documentChanges || []) if (dc.textDocument) changes[dc.textDocument.uri] = (changes[dc.textDocument.uri] || []).concat(dc.edits);
          const open = []; const edits = [];
          for (const [uri, list] of Object.entries(changes)) { const m = monaco.editor.getModel(monaco.Uri.parse(uri)); if (!m) continue; open.push(uri); for (const e of list) edits.push({ resource: m.uri, textEdit: { range: toRange(e.range), text: e.newText }, versionId: undefined }); }
          const closed = Object.keys(changes).filter(u => !open.includes(u));
          if (closed.length) { const done = await App.apiQuiet('lsp:applyEdit', { changes }, open).catch(() => []); if (done.length) toast(`Zmieniono nazwę także w ${App.plural(done.length, 'zamkniętym pliku', 'zamkniętych plikach', 'zamkniętych plikach')}`); }
          return { edits };
        },
      });
      // C# i Java nie mają własnych podpowiedzi – pełne podpowiedzi biorą z serwera języka
      if (lang === 'csharp' || lang === 'java') {
        monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: ['.', ':', '<', '@'],
          provideCompletionItems: async (model, pos) => {
            const t = tabByModel(model); const r = await req(t, 'textDocument/completion', { textDocument: docId(t), position: toPos(pos) }); if (!r) return { suggestions: [] };
            const items = Array.isArray(r) ? r : r.items || []; const w = model.getWordUntilPosition(pos);
            const def = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
            return { incomplete: !!r.isIncomplete, suggestions: items.slice(0, 400).map(i => ({ label: i.label, kind: monaco.languages.CompletionItemKind[KIND[i.kind] || 'Text'], detail: i.detail, documentation: i.documentation ? { value: mdOf(i.documentation) } : undefined, insertText: (i.textEdit && i.textEdit.newText) || i.insertText || i.label, insertTextRules: i.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : 0, range: i.textEdit && i.textEdit.range ? toRange(i.textEdit.range) : def, sortText: i.sortText, filterText: i.filterText })) };
          },
        });
        monaco.languages.registerSignatureHelpProvider(lang, {
          signatureHelpTriggerCharacters: ['(', ','],
          provideSignatureHelp: async (model, pos) => { const t = tabByModel(model); const r = await req(t, 'textDocument/signatureHelp', { textDocument: docId(t), position: toPos(pos) }); if (!r || !r.signatures || !r.signatures.length) return null; return { value: { signatures: r.signatures.map(s => ({ label: s.label, documentation: s.documentation ? { value: mdOf(s.documentation) } : undefined, parameters: (s.parameters || []).map(p => ({ label: p.label, documentation: p.documentation ? { value: mdOf(p.documentation) } : undefined })) })), activeSignature: r.activeSignature || 0, activeParameter: r.activeParameter || 0 }, dispose() {} }; },
        });
      }
    }
    // Ctrl+klik do innego pliku otwiera go w nowej karcie
    if (monaco.editor.registerEditorOpener) monaco.editor.registerEditorOpener({ openCodeEditor(_src, resource, sel) { const line = sel && (sel.startLineNumber || sel.lineNumber); ed().openFile(resource.fsPath, line); return true; } });
  }

  window.cm.on('lsp:diagnostics', d => {
    if (!monaco) return;
    const m = monaco.editor.getModel(monaco.Uri.parse(d.uri)); if (!m) return;
    const sev = { 1: 8, 2: 4, 3: 2, 4: 1 };
    monaco.editor.setModelMarkers(m, 'lsp', d.diagnostics.map(x => ({ severity: sev[x.severity || 1], message: x.message + (x.code ? ` (${x.code})` : ''), source: x.source, startLineNumber: x.range.start.line + 1, startColumn: x.range.start.character + 1, endLineNumber: x.range.end.line + 1, endColumn: x.range.end.character + 1 })));
  });

  async function lspOpen(t) {
    if (!lspOn()) return;
    const info = await lspInfo(t); if (!info) return;
    const st = (await loadStatus())[info.lang]; t.lspState = st && st.installed ? 'starting' : 'missing';
    updateLspBtn(t);
    if (!st || !st.installed) return;
    t.lsp = info;
    try { t.lspUri = await window.cm.call('lsp:open', info.lang, info.root, info.profile, t.path, t.model.getValue(), t.model.getLanguageId()); t.lspState = 'on'; }
    catch (e) { t.lsp = null; t.lspState = 'error'; t.lspError = e.message; }
    updateLspBtn(t);
  }
  function updateLspBtn(t) {
    const S = ed().S; const b = S.el && $('[data-st-lsp]', S.el); if (!b) return;
    const act = S.tabs.find(x => x.path === S.active);
    if (!act || act !== t && t) { if (!act || !act.lspState) { b.classList.add('hidden'); return; } t = act; }
    if (!t || !t.lspState) { b.classList.add('hidden'); return; }
    const lang = LSP_LANG[t.model.getLanguageId()]; b.classList.remove('hidden');
    b.textContent = { on: `✓ ${LSP_SHORT[lang]}`, starting: `${LSP_SHORT[lang]}…`, missing: `Zainstaluj ${LSP_SHORT[lang]}`, error: `✖ ${LSP_SHORT[lang]}` }[t.lspState] || '';
    b.title = { on: 'Serwer języka działa: błędy na żywo, F12 – definicja, Shift+F12 – odwołania, F2 – zmiana nazwy, Alt+Shift+F – formatowanie', missing: 'Zainstaluj serwer języka, aby mieć sprawdzanie błędów, przejście do definicji i zmianę nazw w całym projekcie', error: t.lspError || '' }[t.lspState] || '';
    b.onclick = async () => {
      if (t.lspState === 'missing') { const ok = await installLsp(lang); if (ok) lspOpen(t); }
      else if (t.lspState === 'error') { toast(t.lspError || 'Serwer języka nie działa', 'error', 9000); lspOpen(t); }
      else App.go('settings', { section: 'lsp' });
    };
  }
  async function installLsp(lang) {
    const st = (await loadStatus())[lang];
    const r = await App.runJob(`Instalacja: ${st ? st.name : lang}`, jobId => window.cm.call('lsp:install', jobId, lang), { doneMsg: 'Zainstalowano. Edytor uruchomi serwer języka przy otwieraniu plików.' });
    await loadStatus(true); return r !== null;
  }
  App.installLsp = installLsp;

  // ---------- Git ----------
  async function gitStatus() { const S = ed().S; if (!S.root) return null; try { gitCache = await window.cm.call('git:status', S.root); } catch { gitCache = { repo: false }; } gitCache.dir = S.root; updateGitBtn(); return gitCache; }
  function updateGitBtn() {
    const S = ed().S; const b = S.el && $('[data-st-git]', S.el); if (!b) return;
    if (!gitCache || !gitCache.repo) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = `⎇ ${gitCache.branch || '?'}${gitCache.files.length ? ' •' + gitCache.files.length : ''}${gitCache.ahead ? ' ↑' + gitCache.ahead : ''}${gitCache.behind ? ' ↓' + gitCache.behind : ''}`;
    b.onclick = () => { S.side = 'git'; S.sideOpen = true; ed().renderSide(); };
  }
  const fileState = f => (f.conflict ? ['C', 'konflikt', 'error'] : f.untracked ? ['U', 'nowy', 'ok'] : ({ M: ['M', 'zmieniony', 'warn'], A: ['A', 'dodany', 'ok'], D: ['D', 'usunięty', 'error'], R: ['R', 'przeniesiony', 'info'] }[f.staged ? f.index : f.work] || [f.work || f.index, '', '']));
  async function sideGit(side) {
    const S = ed().S;
    side.innerHTML = `<div class="side-head"><span>Git</span><button class="btn ghost sm icon" data-a="refresh" title="Odśwież">${icon('refresh')}</button><button class="btn ghost sm icon" data-a="log" title="Historia commitów">${icon('clock')}</button></div><div class="side-body git-side"><div class="muted" style="padding:12px">Wczytywanie…</div></div>`;
    $('[data-a=refresh]', side).onclick = () => sideGit(side);
    $('[data-a=log]', side).onclick = () => gitLog();
    const body = $('.side-body', side);
    if (!S.root) { body.innerHTML = '<p class="muted" style="padding:12px">Otwórz folder, aby używać Gita.</p>'; return; }
    const av = await App.apiQuiet('git:available').catch(() => ({ ok: false }));
    if (!av.ok) { body.innerHTML = `<div style="padding:12px"><p class="muted" style="margin-top:0">Nie znaleziono programu Git na tym komputerze.</p><button class="btn sm primary" data-dl>${icon('download')}Pobierz Git</button></div>`; $('[data-dl]', body).onclick = () => api('shell:external', 'https://git-scm.com/download/win'); return; }
    const st = await gitStatus();
    if (!st || !st.repo) {
      body.innerHTML = `<div style="padding:12px"><p class="muted" style="margin-top:0">Ten folder nie jest repozytorium Git. Repozytorium zapisuje historię zmian – możesz wrócić do dowolnej wersji skryptu i wysłać go na GitHuba.</p><button class="btn sm primary" data-init>${icon('plus')}Utwórz repozytorium</button></div>`;
      $('[data-init]', body).onclick = async () => { await api('git:init', S.root); toast('Utworzono repozytorium'); sideGit(side); }; return;
    }
    const staged = st.files.filter(f => f.staged); const work = st.files.filter(f => !f.staged || (f.work && f.work !== ' '));
    body.innerHTML = `<div class="git-branch"><button class="btn sm ghost" data-br title="Zmień gałąź">${icon('branch')}${esc(st.branch || '(brak commitów)')}</button><span class="dim">${st.upstream ? `${st.ahead ? '↑' + st.ahead : ''} ${st.behind ? '↓' + st.behind : ''}` : 'bez zdalnego'}</span><span class="grow"></span><button class="btn sm ghost icon" data-pull title="Pobierz zmiany (pull)">${icon('import')}</button><button class="btn sm ghost icon" data-push title="Wyślij commity (push)">${icon('update')}</button></div>
      <div class="git-commit"><textarea class="input" rows="2" placeholder="Opis zmian (Ctrl+Enter – commit)" data-msg></textarea><button class="btn sm primary" data-commit>${icon('check')}${staged.length ? 'Commit' : 'Commit wszystkich zmian'}</button></div>
      ${staged.length ? `<div class="git-group"><div class="gh"><span>Przygotowane (${staged.length})</span><button class="btn ghost sm icon" data-unall title="Cofnij przygotowanie wszystkich">−</button></div><div data-list="staged"></div></div>` : ''}
      <div class="git-group"><div class="gh"><span>Zmiany (${work.length})</span>${work.length ? `<button class="btn ghost sm icon" data-stall title="Przygotuj wszystkie">+</button>` : ''}</div><div data-list="work">${work.length ? '' : '<p class="dim" style="padding:4px 10px;margin:0">Brak zmian od ostatniego commita.</p>'}</div></div>`;
    const abs = f => P().join(st.root, f.path);
    const row = (f, isStaged) => {
      const [code, label, cls] = fileState(f);
      const el = h(`<div class="git-file" title="${esc(f.path)}${label ? ' – ' + label : ''}"><span class="gs ${cls}">${esc(code)}</span><span class="nm">${esc(P().basename(f.path))}</span><span class="dim pth">${esc(P().dirname(f.path) === '.' ? '' : P().dirname(f.path))}</span><span class="acts">${isStaged ? `<button data-x="unstage" title="Cofnij przygotowanie">−</button>` : `${!f.untracked ? `<button data-x="discard" title="Odrzuć zmiany">↺</button>` : ''}<button data-x="stage" title="Przygotuj do commita">+</button>`}</span></div>`);
      el.onclick = async e => {
        const x = e.target.closest('[data-x]');
        if (!x) { if (f.index === 'D' || f.work === 'D') return; const head = await App.apiQuiet('git:head', st.root, abs(f)).catch(() => ''); const cur = await App.apiQuiet('fs:readFile', abs(f)).catch(() => ({ content: '' })); ed().showDiff(head, cur.content, `${P().basename(f.path)} (HEAD)`, `${P().basename(f.path)} (teraz)`, EditorLangs.languageFor(f.path)); return; }
        if (x.dataset.x === 'stage') await api('git:stage', st.root, [abs(f)]);
        if (x.dataset.x === 'unstage') await api('git:unstage', st.root, [abs(f)]);
        if (x.dataset.x === 'discard') { if (!(await App.confirmBox('Odrzucić zmiany?', `Plik <b>${esc(f.path)}</b> wróci do wersji z ostatniego commita. Tego nie da się cofnąć.`, 'Odrzuć', true))) return; await api('git:discard', st.root, [abs(f)]); const t = S.tabs.find(tt => tt.path === abs(f)); if (t) { const d = await App.apiQuiet('fs:readFile', t.path); t.model.setValue(d.content); t.saved = t.model.getAlternativeVersionId(); } }
        sideGit(side);
      };
      el.ondblclick = e => { if (!e.target.closest('[data-x]')) ed().openFile(abs(f)); };
      return el;
    };
    staged.forEach(f => $('[data-list=staged]', body).appendChild(row(f, true)));
    work.forEach(f => $('[data-list=work]', body).appendChild(row(f, false)));
    const msg = $('[data-msg]', body);
    const doCommit = async () => {
      const m = msg.value.trim(); if (!m) { toast('Wpisz opis zmian', 'warn'); msg.focus(); return; }
      if (!staged.length && !work.length) { toast('Nie ma zmian do zapisania', 'warn'); return; }
      if (S.tabs.some(t => t.model.getAlternativeVersionId() !== t.saved && !t.untitled) && !(await App.confirmBox('Niezapisane pliki', 'Część otwartych plików ma niezapisane zmiany – nie trafią do commita. Kontynuować?', 'Commit'))) return;
      const s = App.state.settings;
      if (!staged.length) await api('git:stageAll', st.root);
      try { await window.cm.call('git:commit', st.root, m, { author: s.gitName && s.gitEmail ? { name: s.gitName, email: s.gitEmail } : null }); toast('Zapisano commit'); }
      catch (e) { if (/user\.name|user\.email|identity|Please tell me who you are/i.test(e.message)) gitIdentity(() => doCommit()); else toast(e.message, 'error', 9000); return; }
      sideGit(side);
    };
    $('[data-commit]', body).onclick = doCommit;
    msg.onkeydown = e => { if (e.ctrlKey && e.key === 'Enter') doCommit(); };
    const st1 = $('[data-stall]', body); if (st1) st1.onclick = async () => { await api('git:stageAll', st.root); sideGit(side); };
    const un = $('[data-unall]', body); if (un) un.onclick = async () => { await api('git:unstage', st.root, staged.map(abs)); sideGit(side); };
    $('[data-pull]', body).onclick = async e => { e.currentTarget.disabled = true; try { await window.cm.call('git:pull', st.root); toast('Pobrano zmiany'); for (const t of S.tabs) { if (t.untitled || t.model.getAlternativeVersionId() !== t.saved) continue; const d = await App.apiQuiet('fs:readFile', t.path).catch(() => null); if (d && d.content !== t.model.getValue()) { t.model.setValue(d.content); t.saved = t.model.getAlternativeVersionId(); } } } catch (er) { toast(er.message, 'error', 9000); } sideGit(side); };
    $('[data-push]', body).onclick = async e => {
      const remote = await App.apiQuiet('git:remote', st.root).catch(() => '');
      if (!remote) { const url = await App.promptBox('Zdalne repozytorium', 'Adres repozytorium (np. https://github.com/nick/projekt.git)', ''); if (!url) return; await api('git:setRemote', st.root, url.trim()); }
      e.currentTarget.disabled = true; try { await window.cm.call('git:push', st.root); toast('Wysłano commity'); } catch (er) { toast(/Authentication|could not read Username|403/i.test(er.message) ? 'Brak logowania do GitHuba. Zaloguj się raz w terminalu (git push) albo użyj Git Credential Manager – potem CodeManager będzie wysyłał bez pytania.' : er.message, 'error', 12000); } sideGit(side);
    };
    $('[data-br]', body).onclick = () => branchPicker(st, () => sideGit(side));
  }
  function gitIdentity(after) {
    const s = App.state.settings;
    modal({ title: 'Kim jesteś w Gicie?', body: `<p class="muted" style="margin-top:0">Git zapisuje autora każdego commita. Podaj nazwę i e-mail (np. ten z GitHuba).</p><div class="field"><label>Nazwa</label><input class="input" data-n value="${esc(s.gitName || '')}"></div><div class="field"><label>E-mail</label><input class="input" data-e value="${esc(s.gitEmail || '')}"></div>`,
      actions: [{ label: 'Anuluj' }, { label: 'Zapisz i zrób commit', primary: true, onClick: async ({ body }) => { const n = $('[data-n]', body).value.trim(), e = $('[data-e]', body).value.trim(); if (!n || !e) { toast('Wypełnij oba pola', 'warn'); return false; } Object.assign(App.state.settings, { gitName: n, gitEmail: e }); await api('settings:set', { gitName: n, gitEmail: e }); setTimeout(after, 50); } }] });
  }
  async function branchPicker(st, after) {
    const list = await api('git:branches', st.root);
    const body = h(`<div><div class="pick-list">${list.map(b => `<button class="pick ${b.current ? 'on' : ''}" data-b="${esc(b.name)}">${icon('branch')}<span>${esc(b.name)}</span>${b.current ? '<span class="chip ok">bieżąca</span>' : ''}</button>`).join('') || '<p class="muted">Brak gałęzi – zrób pierwszy commit.</p>'}</div><div class="field" style="margin-top:12px"><label>Nowa gałąź</label><div class="inline-input"><input class="input mono" data-new placeholder="np. nowa-funkcja"><button class="btn" data-create>${icon('plus')}Utwórz</button></div></div></div>`);
    const m = modal({ title: 'Gałęzie', body });
    $$('[data-b]', body).forEach(b => b.onclick = async () => { try { await window.cm.call('git:checkout', st.root, b.dataset.b); toast('Przełączono na ' + b.dataset.b); m.close(); after(); } catch (e) { toast(e.message, 'error', 9000); } });
    $('[data-create]', body).onclick = async () => { const n = $('[data-new]', body).value.trim(); if (!n) return; try { await window.cm.call('git:checkout', st.root, n, true); m.close(); after(); } catch (e) { toast(e.message, 'error', 9000); } };
  }
  async function gitLog() {
    const S = ed().S; const st = gitCache || await gitStatus(); if (!st || !st.repo) return;
    const list = await api('git:log', st.root);
    const body = h(`<div class="git-log">${list.map(c => `<button class="gl" data-h="${esc(c.hash)}"><span class="mono dim">${esc(c.short)}</span><span class="s">${esc(c.subject)}</span><span class="dim">${esc(c.author)} · ${esc(c.date)}</span></button>`).join('') || '<p class="muted">Brak commitów.</p>'}</div>`);
    modal({ title: 'Historia commitów', wide: true, body });
    $$('[data-h]', body).forEach(b => b.onclick = async () => { const txt = await api('git:show', st.root, b.dataset.h); modal({ title: 'Commit ' + b.dataset.h.slice(0, 8), wide: true, body: `<pre class="joblog" style="max-height:60vh">${esc(txt)}</pre>` }); });
    void S;
  }

  App.edExt = {
    sides: { git: sideGit },
    editorReady(m) { monaco = m; registerProviders(); },
    opened(t) { lspOpen(t); },
    changed(t) { if (!t.lsp || !t.lspUri) return; clearTimeout(t.lspT); t.lspT = setTimeout(() => window.cm.call('lsp:change', t.lsp.lang, t.lsp.root, t.lsp.profile, t.path, t.model.getValue()).catch(() => {}), 250); },
    closed(t) { if (t.lsp) window.cm.call('lsp:close', t.lsp.lang, t.lsp.root, t.lsp.profile, t.path).catch(() => {}); },
    saved(t) { if (ed().S.side === 'git' && ed().S.sideOpen) { const side = $('.ed-side', ed().S.el); if (side) sideGit(side); } else gitStatus(); void t; },
    status(t) { updateLspBtn(t); if (!gitCache || gitCache.dir !== ed().S.root) gitStatus(); else updateGitBtn(); void t; },
  };
})();
