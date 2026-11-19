// Edytor: asystent AI (czat, tryb agenta z dostępem do plików, zewnętrzni agenci CLI)
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  const P = () => window.cm.path;
  const ed = () => App.ed;
  const LS = k => { try { return JSON.parse(localStorage.getItem('cm.ai.' + k)); } catch { return null; } };
  const LSset = (k, v) => { try { localStorage.setItem('cm.ai.' + k, JSON.stringify(v)); } catch { /* */ } };
  const A = { session: 'ed-' + Date.now(), msgs: [], busy: false, providers: null, provider: LS('provider'), model: LS('model') || '', mode: LS('mode') || 'agent', autoApply: !!LS('autoApply'), allowEdits: LS('allowEdits') !== false, withFile: LS('withFile') !== false, codes: [], side: null };

  const QUICK = [
    ['Wyjaśnij zaznaczony kod', 'Wyjaśnij krok po kroku, co robi zaznaczony fragment (albo cały plik, jeśli nic nie zaznaczyłem).'],
    ['Napraw błędy w pliku', 'Napraw błędy i ostrzeżenia w otwartym pliku. Opisz krótko każdą poprawkę.'],
    ['Dodaj komentarze', 'Dodaj zwięzłe komentarze po polsku do otwartego pliku, nie zmieniając działania kodu.'],
    ['Sprawdź log serwera', 'Sprawdź konsolę uruchomionego serwera gry, znajdź błędy związane z moimi skryptami i zaproponuj poprawki.'],
  ];

  function context() {
    const S = ed().S; const t = S.tabs.find(x => x.path === S.active);
    const mon = window.monaco;
    const ctx = { root: S.root || (t && !t.untitled ? P().dirname(t.path) : null) };
    const markersOf = m => (mon ? mon.editor.getModelMarkers({ resource: m.uri }) : []).map(x => ({ line: x.startLineNumber, severity: x.severity === 8 ? 'błąd' : x.severity === 4 ? 'ostrzeżenie' : 'info', message: x.message }));
    ctx.allProblems = {};
    for (const tab of S.tabs) if (!tab.untitled) { const mk = markersOf(tab.model); if (mk.length) ctx.allProblems[tab.path] = mk; }
    if (t) {
      ctx.file = t.untitled ? null : t.path; ctx.rel = ctx.root && ctx.file ? P().relative(ctx.root, ctx.file) : t.name; ctx.language = t.model.getLanguageId();
      ctx.problems = markersOf(t.model);
      if (S.editor && S.editor.getModel() === t.model) {
        const sel = S.editor.getSelection(); const pos = S.editor.getPosition();
        if (pos) ctx.cursorLine = pos.lineNumber;
        if (sel && !sel.isEmpty()) { ctx.selection = t.model.getValueInRange(sel); ctx.selStart = sel.startLineNumber; ctx.selEnd = sel.endLineNumber; }
      }
      if (A.withFile) ctx.content = t.model.getValue();
      if (t.model.getLanguageId() === 'lua' && t._luaProfile) ctx.luaProfile = t._luaProfile;
    }
    return ctx;
  }

  async function loadProviders(force) { if (!A.providers || force) A.providers = await App.apiQuiet('assistant:providers').catch(() => ({ api: [], cli: {} })); return A.providers; }
  const isCli = id => A.providers && A.providers.cli && A.providers.cli[id];

  async function side(box) {
    A.side = box;
    const pr = await loadProviders();
    if (!A.provider || (!pr.api.some(p => p.id === A.provider && p.ready) && !(pr.cli[A.provider] || {}).installed)) A.provider = (pr.api.find(p => p.id === pr.current && p.ready) || pr.api.find(p => p.ready) || {}).id || Object.keys(pr.cli).find(k => pr.cli[k].installed) || null;
    const cur = pr.api.find(p => p.id === A.provider);
    box.innerHTML = `<div class="side-head"><span>Asystent AI</span><button class="btn ghost sm icon" data-new title="Nowa rozmowa">${icon('plus')}</button><button class="btn ghost sm icon" data-set title="Klucze API i dostawcy">${icon('settings')}</button></div>
      <div class="ai-side">
        <div class="ai-conf">
          <select class="input" data-prov>${pr.api.length ? `<optgroup label="Modele AI">${pr.api.map(p => `<option value="${p.id}" ${p.id === A.provider ? 'selected' : ''} ${p.ready ? '' : 'disabled'}>${esc(p.name)}${p.ready ? '' : ' – dodaj klucz'}</option>`).join('')}</optgroup>` : ''}<optgroup label="Agenci (programy na komputerze)">${Object.entries(pr.cli).map(([id, c]) => `<option value="${id}" ${id === A.provider ? 'selected' : ''} ${c.installed ? '' : 'disabled'}>${esc(c.name)}${c.installed ? '' : ' – nie zainstalowano'}</option>`).join('')}</optgroup></select>
          ${isCli(A.provider) ? `<label class="check"><input type="checkbox" data-edits ${A.allowEdits ? 'checked' : ''}><span>Pozwól agentowi zmieniać pliki projektu</span></label>`
            : `<div class="inline-input"><input class="input mono" data-model list="ai-models" placeholder="${esc(cur ? cur.model || 'model' : 'model')}" value="${esc(A.model && A.provider === LS('modelFor') ? A.model : '')}" title="Model (puste = domyślny)"><datalist id="ai-models"></datalist></div>
              <div class="seg"><button data-mode="chat" class="${A.mode === 'chat' ? 'on' : ''}" title="Odpowiada na pytania, kod wstawiasz przyciskami">Czat</button><button data-mode="agent" class="${A.mode === 'agent' ? 'on' : ''}" title="Sam czyta pliki projektu, szuka, sprawdza błędy i logi, proponuje zmiany">Agent</button></div>
              ${A.mode === 'agent' ? `<label class="check"><input type="checkbox" data-auto ${A.autoApply ? 'checked' : ''}><span>Zapisuj zmiany bez pytania</span></label>` : ''}`}
          <label class="check"><input type="checkbox" data-wf ${A.withFile ? 'checked' : ''}><span>Dołącz otwarty plik i zaznaczenie</span></label>
        </div>
        <div class="ai-msgs" aria-live="polite"></div>
        <div class="ai-quick">${QUICK.map((q, i) => `<button data-q="${i}">${esc(q[0])}</button>`).join('')}</div>
        <div class="ai-input"><textarea class="input" rows="3" placeholder="${A.provider ? 'Napisz, co zrobić… (Enter – wyślij, Shift+Enter – nowy wiersz)' : 'Dodaj klucz API w Ustawieniach albo zainstaluj agenta'}" data-in ${A.provider ? '' : 'disabled'}></textarea>
          <div class="row"><span class="dim ai-hint">${A.provider ? (isCli(A.provider) ? 'Agent działa w folderze projektu' : A.mode === 'agent' ? 'Agent widzi pliki otwartego folderu' : 'Czat bez dostępu do plików') : ''}</span><span class="grow"></span><button class="btn sm primary" data-send ${A.provider ? '' : 'disabled'}>${A.busy ? icon('stop') + 'Zatrzymaj' : icon('sparkle') + 'Wyślij'}</button></div></div>
      </div>`;
    drawMsgs();
    $('[data-prov]', box).onchange = e => { A.provider = e.target.value; LSset('provider', A.provider); A.model = ''; side(box); };
    const mi = $('[data-model]', box);
    if (mi) { mi.onchange = () => { A.model = mi.value.trim(); LSset('model', A.model); LSset('modelFor', A.provider); api('assistant:setModel', A.provider, A.model); }; mi.onfocus = async () => { if (mi._loaded) return; mi._loaded = true; const list = await App.apiQuiet('assistant:models', A.provider).catch(() => []); $('#ai-models', box).innerHTML = list.slice(0, 300).map(m => `<option value="${esc(m)}">`).join(''); }; }
    $$('[data-mode]', box).forEach(b => b.onclick = () => { A.mode = b.dataset.mode; LSset('mode', A.mode); side(box); });
    const au = $('[data-auto]', box); if (au) au.onchange = e => { A.autoApply = e.target.checked; LSset('autoApply', A.autoApply); };
    const de = $('[data-edits]', box); if (de) de.onchange = e => { A.allowEdits = e.target.checked; LSset('allowEdits', A.allowEdits); };
    $('[data-wf]', box).onchange = e => { A.withFile = e.target.checked; LSset('withFile', A.withFile); };
    $('[data-new]', box).onclick = () => { api('assistant:reset', A.session); A.session = 'ed-' + Date.now(); A.msgs = []; A.codes = []; drawMsgs(); };
    $('[data-set]', box).onclick = () => App.go('settings', { section: 'ai' });
    const inp = $('[data-in]', box);
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('[data-send]', box).onclick = () => (A.busy ? cancel() : send());
    $$('[data-q]', box).forEach(b => b.onclick = () => { inp.value = QUICK[+b.dataset.q][1]; send(); });
  }

  // ---------- wiadomości ----------
  function renderText(text) {
    const parts = String(text || '').split(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g);
    let html = '';
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i] && parts[i].trim()) html += App.mt.md(parts[i]);
      if (i + 2 < parts.length) {
        const lang = parts[i + 1] || ''; const code = parts[i + 2].replace(/\n$/, '');
        const idx = A.codes.push({ lang, code }) - 1;
        html += `<div class="ai-codeblock"><div class="cb-h"><span class="dim">${esc(lang || 'kod')}</span><span class="grow"></span><button data-cb="ins" data-i="${idx}" title="Wstaw w miejscu kursora">Wstaw</button><button data-cb="rep" data-i="${idx}" title="Zastąp zaznaczony fragment w edytorze">Zastąp</button><button data-cb="new" data-i="${idx}" title="Otwórz jako nowy plik">Nowy</button><button data-cb="cp" data-i="${idx}">Kopiuj</button></div><pre>${esc(code)}</pre></div>`;
      }
    }
    return html;
  }
  function drawMsgs() {
    const box = A.side && $('.ai-msgs', A.side); if (!box) return;
    A.codes = [];
    if (!A.msgs.length) { box.innerHTML = `<div class="ai-empty">${icon('sparkle')}<b>Zapytaj o kod albo zleć zmianę</b><span>Np. „dodaj komendę /heal, która leczy gracza” albo „dlaczego serwer pokazuje błąd w tym zasobie?”. W trybie Agent asystent sam przeczyta pliki i pokaże zmiany do zatwierdzenia.</span></div>`; return; }
    box.innerHTML = A.msgs.map(m => {
      if (m.role === 'user') return `<div class="ai-msg user">${esc(m.text)}</div>`;
      if (m.role === 'step') return `<div class="ai-step">${m.kind === 'write' ? icon('save') : m.kind === 'info' ? icon('info') : icon('wrench')}<span>${esc(m.text)}</span></div>`;
      if (m.role === 'error') return `<div class="ai-msg err">${icon('error')}${esc(m.text)}</div>`;
      return `<div class="ai-msg bot">${renderText(m.text)}${m.meta ? `<div class="ai-meta">${esc(m.meta)}</div>` : ''}</div>`;
    }).join('') + (A.busy ? `<div class="ai-msg bot thinking"><span class="dots"><i></i><i></i><i></i></span>${A.stream ? `<div class="ai-stream">${esc(A.stream.slice(-3000))}</div>` : ''}</div>` : '');
    box.scrollTop = box.scrollHeight;
    $$('[data-cb]', box).forEach(b => b.onclick = () => codeAction(b.dataset.cb, A.codes[+b.dataset.i]));
  }
  async function codeAction(kind, c) {
    const S = ed().S;
    if (kind === 'cp') { navigator.clipboard.writeText(c.code).then(() => toast('Skopiowano kod')); return; }
    if (kind === 'new') { const ext = { lua: 'lua', python: 'py', py: 'py', javascript: 'js', js: 'js', json: 'json', java: 'java', csharp: 'cs', cs: 'cs', html: 'html', css: 'css', yaml: 'yml', toml: 'toml' }[c.lang.toLowerCase()] || 'txt'; ed().openUntitled('nowy.' + ext, c.code); return; }
    if (!S.editor || !S.editor.getModel()) { toast('Otwórz plik w edytorze', 'warn'); return; }
    const sel = S.editor.getSelection();
    const range = kind === 'rep' ? sel : new window.monaco.Range(sel.positionLineNumber, sel.positionColumn, sel.positionLineNumber, sel.positionColumn);
    if (kind === 'rep' && sel.isEmpty()) { toast('Zaznacz fragment, który ma zostać zastąpiony', 'warn'); return; }
    S.editor.executeEdits('ai', [{ range, text: c.code, forceMoveMarkers: true }]); S.editor.pushUndoStop(); S.editor.focus();
    toast(kind === 'rep' ? 'Zastąpiono zaznaczenie (Ctrl+Z cofa)' : 'Wstawiono kod (Ctrl+Z cofa)');
  }

  async function send() {
    const inp = A.side && $('[data-in]', A.side); const text = inp ? inp.value.trim() : ''; if (!text || A.busy) return;
    if (!A.provider) { toast('Wybierz dostawcę AI', 'warn'); return; }
    const S = ed().S; const t = S.tabs.find(x => x.path === S.active);
    if (t && t.model.getLanguageId() === 'lua' && window.EditorComplete) { try { const pr = await EditorComplete.profileFor(t.model); const meta = EditorComplete.LUA_PROFILES.find(x => x.id === pr.id); t._luaProfile = meta ? meta.name : null; } catch { /* */ } }
    const ctx = context();
    if (A.mode === 'agent' && !isCli(A.provider) && !ctx.root) toast('Otwórz folder projektu, żeby agent widział pliki – na razie odpowie jak w czacie.', 'warn', 6000);
    inp.value = '';
    A.msgs.push({ role: 'user', text }); A.busy = true; A.stream = ''; side(A.side);
    try {
      const r = await window.cm.call('assistant:send', A.session, { provider: A.provider, model: A.model || undefined, mode: A.mode, text, context: ctx, autoApply: A.autoApply, allowEdits: A.allowEdits });
      A.msgs.push({ role: 'bot', text: r.text || (r.written && r.written.length ? 'Gotowe.' : '(brak odpowiedzi)'), meta: `${r.provider}${r.model ? ' · ' + r.model : ''}${r.written && r.written.length ? ` · zmienione pliki: ${r.written.length}` : ''}` });
      if (r.cli) await reloadOpen();
    } catch (e) { A.msgs.push({ role: 'error', text: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); }
    A.busy = false; A.stream = ''; if (A.side && A.side.isConnected) side(A.side);
  }
  async function cancel() { await api('assistant:cancel', A.session); }
  async function reloadOpen(onlyFile) {
    const S = ed().S;
    for (const t of S.tabs) {
      if (t.untitled || (onlyFile && t.path !== onlyFile)) continue;
      const d = await App.apiQuiet('fs:readFile', t.path).catch(() => null); if (!d || d.content === t.model.getValue()) continue;
      if (t.model.getAlternativeVersionId() !== t.saved) { toast(`${t.name}: plik zmieniono na dysku, ale masz niezapisane zmiany – nie nadpisałem ich.`, 'warn', 8000); continue; }
      t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: d.content }], () => null); t.saved = t.model.getAlternativeVersionId();
    }
    ed().renderTabs();
    if (S.side === 'explorer' || S.side === 'git') ed().renderSide();
  }

  window.cm.on('assistant:step', d => {
    if (d.session !== A.session) return;
    if (d.kind === 'stream') { A.stream = (A.stream || '') + d.text; drawMsgs(); return; }
    const names = { list_files: 'Przegląda pliki', read_file: 'Czyta', search: 'Szuka', edit_file: 'Proponuje zmianę w', write_file: 'Zapisuje', get_problems: 'Sprawdza błędy edytora', server_log: 'Czyta konsolę serwera', Read: 'Czyta', Edit: 'Zmienia', Write: 'Zapisuje', Bash: 'Polecenie', Grep: 'Szuka', Glob: 'Szuka plików' };
    const text = d.kind === 'tool' ? `${names[d.name] || d.name}${d.summary ? ': ' + d.summary : ''}` : d.kind === 'write' ? `Zapisano ${P().basename(d.file)}` : d.kind === 'thought' ? d.text.slice(0, 300) : d.text;
    A.msgs.push({ role: 'step', kind: d.kind, text }); drawMsgs();
  });
  window.cm.on('assistant:written', d => reloadOpen(d.file));
  window.cm.on('assistant:approve', d => approveModal(d));

  // ---------- zatwierdzanie zmian: podgląd różnic ----------
  async function approveModal(d) {
    await ed().ensureEditor();
    const mon = window.monaco;
    const body = h(`<div><p class="muted" style="margin:0 0 8px">${d.before == null ? 'Nowy plik' : 'Zmiana w pliku'} <span class="mono">${esc(d.rel)}</span></p><div class="ai-diff"></div></div>`);
    let decided = false;
    const lang = EditorLangs.languageFor(d.file);
    const m1 = mon.editor.createModel(d.before || '', lang), m2 = mon.editor.createModel(d.after, lang);
    let de = null;
    const done = ok => { if (decided) return; decided = true; api('assistant:approval', d.id, ok); setTimeout(() => { try { de && de.dispose(); m1.dispose(); m2.dispose(); } catch { /* */ } }, 50); };
    modal({ title: 'Asystent chce zmienić plik', wide: true, body, onClose: () => done(false), actions: [{ label: 'Odrzuć', onClick: () => done(false) }, { label: 'Zapisz zmianę', primary: true, icon: 'check', onClick: () => done(true) }] });
    de = mon.editor.createDiffEditor($('.ai-diff', body), { theme: 'codemanager', automaticLayout: true, readOnly: true, renderSideBySide: false, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false });
    de.setModel({ original: m1, modified: m2 });
  }

  // ---------- podpięcie do edytora ----------
  const ext = App.edExt; ext.sides.ai = side;
  const prevReady = ext.editorReady;
  ext.editorReady = (m, editor) => {
    prevReady(m, editor);
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyI, () => { const S = ed().S; S.side = 'ai'; S.sideOpen = true; ed().renderSide(); setTimeout(() => { const i = A.side && $('[data-in]', A.side); if (i) i.focus(); }, 50); });
    editor.addAction({ id: 'cm.ai.explain', label: 'Asystent AI: wyjaśnij zaznaczenie', contextMenuGroupId: '9_ai', run: () => quick(0) });
    editor.addAction({ id: 'cm.ai.fix', label: 'Asystent AI: napraw błędy w pliku', contextMenuGroupId: '9_ai', run: () => quick(1) });
  };
  function quick(i) { const S = ed().S; S.side = 'ai'; S.sideOpen = true; ed().renderSide(); setTimeout(() => { const inp = A.side && $('[data-in]', A.side); if (inp) { inp.value = QUICK[i][1]; send(); } }, 120); }
  App.aiProviders = loadProviders;
})();
